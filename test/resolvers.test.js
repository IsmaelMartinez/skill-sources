import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createGitResolver } from "../src/resolvers/git.js";
import { createUrlResolver } from "../src/resolvers/url.js";
import {
  parsePageUrl,
  createConfluenceResolver,
} from "../src/resolvers/confluence.js";

const run = promisify(execFile);

function response({ status = 200, headers = {}, body = "" }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

describe("git resolver", () => {
  // A real repository on disk — the resolver's whole point is that it uses git
  // rather than a host API, so mocking git would test nothing.
  let dir;
  let shaTouchingDoc;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "skill-sources-git-"));
    const git = (...args) => run("git", args, { cwd: dir });
    await git("init", "-q", "-b", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "Test");
    await git("config", "commit.gpgsign", "false");

    await writeFile(join(dir, "doc.md"), "v1\n");
    await writeFile(join(dir, "other.md"), "x\n");
    await git("add", ".");
    await git("commit", "-qm", "first");

    await writeFile(join(dir, "doc.md"), "v2\n");
    await git("add", "doc.md");
    await git("commit", "-qm", "touch doc");
    shaTouchingDoc = (
      await run("git", ["rev-parse", "HEAD"], { cwd: dir })
    ).stdout.trim();

    // A later commit that leaves doc.md alone must not move its marker.
    await writeFile(join(dir, "other.md"), "y\n");
    await git("add", "other.md");
    await git("commit", "-qm", "touch other");
  }, 60_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves the last commit that touched the path, not repo HEAD", async () => {
    const resolver = createGitResolver();
    try {
      const marker = await resolver.resolve({
        repo: dir,
        path: "doc.md",
        ref: "main",
      });
      expect(marker).toBe(shaTouchingDoc);
    } finally {
      await resolver.cleanup();
    }
  }, 60_000);

  it("reuses one clone across entries from the same repo", async () => {
    const resolver = createGitResolver();
    try {
      const [a, b] = await Promise.all([
        resolver.resolve({ repo: dir, path: "doc.md", ref: "main" }),
        resolver.resolve({ repo: dir, path: "other.md", ref: "main" }),
      ]);
      expect(a).toBe(shaTouchingDoc);
      expect(b).not.toBe(a);
    } finally {
      await resolver.cleanup();
    }
  }, 60_000);

  it("fails loudly when the path does not exist upstream", async () => {
    const resolver = createGitResolver();
    try {
      await expect(
        resolver.resolve({ repo: dir, path: "missing.md", ref: "main" }),
      ).rejects.toThrow(/no commits touch/);
    } finally {
      await resolver.cleanup();
    }
  }, 60_000);
});

describe("url resolver", () => {
  it("prefers a strong ETag from HEAD", async () => {
    const resolver = createUrlResolver({
      fetchImpl: async () => response({ headers: { etag: '"abc123"' } }),
    });
    expect(await resolver.resolve({ uri: "https://x/y" })).toBe("etag:abc123");
  });

  it("ignores a weak ETag, which promises only semantic equivalence", async () => {
    const resolver = createUrlResolver({
      fetchImpl: async () =>
        response({
          headers: {
            etag: 'W/"abc"',
            "last-modified": "Wed, 21 Oct 2026 07:28:00 GMT",
          },
        }),
    });
    expect(await resolver.resolve({ uri: "https://x/y" })).toBe(
      "modified:2026-10-21T07:28:00.000Z",
    );
  });

  it("falls back to hashing the body when no validator is offered", async () => {
    const resolver = createUrlResolver({
      fetchImpl: async () => response({ body: "hello" }),
    });
    const marker = await resolver.resolve({ uri: "https://x/y" });
    expect(marker).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("produces a different marker when the body changes", async () => {
    const make = (body) =>
      createUrlResolver({ fetchImpl: async () => response({ body }) });
    const a = await make("one").resolve({ uri: "https://x/y" });
    const b = await make("two").resolve({ uri: "https://x/y" });
    expect(a).not.toBe(b);
  });

  it("falls through to GET when HEAD is rejected", async () => {
    let first = true;
    const resolver = createUrlResolver({
      fetchImpl: async () => {
        if (first) {
          first = false;
          throw new Error("HEAD not allowed");
        }
        return response({ body: "body" });
      },
    });
    expect(await resolver.resolve({ uri: "https://x/y" })).toMatch(/^sha256:/);
  });

  it("surfaces a non-ok GET as an error rather than hashing the error page", async () => {
    const resolver = createUrlResolver({
      fetchImpl: async () => response({ status: 404, body: "nope" }),
    });
    await expect(resolver.resolve({ uri: "https://x/y" })).rejects.toThrow(
      /HTTP 404/,
    );
  });
});

describe("confluence resolver", () => {
  it("extracts origin and page id from a page url", () => {
    expect(
      parsePageUrl(
        "https://x.atlassian.net/wiki/spaces/ENG/pages/12345/Logging",
      ),
    ).toEqual({
      origin: "https://x.atlassian.net",
      pageId: "12345",
    });
  });

  it("rejects a url with no page id", () => {
    expect(() =>
      parsePageUrl("https://x.atlassian.net/wiki/spaces/ENG"),
    ).toThrow(/page id/);
  });

  it("returns the page version as the marker", async () => {
    const resolver = createConfluenceResolver({
      email: "a@b.c",
      token: "t",
      fetchImpl: async () =>
        response({ body: JSON.stringify({ version: { number: 27 } }) }),
    });
    const marker = await resolver.resolve({
      uri: "https://x.atlassian.net/wiki/spaces/ENG/pages/12345/Logging",
    });
    expect(marker).toBe("27");
  });

  it("explains itself when credentials are missing", async () => {
    const resolver = createConfluenceResolver({
      email: undefined,
      token: undefined,
    });
    await expect(
      resolver.resolve({
        uri: "https://x.atlassian.net/wiki/spaces/ENG/pages/1/T",
      }),
    ).rejects.toThrow(/CONFLUENCE_EMAIL/);
  });
});
