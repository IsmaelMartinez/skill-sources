import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadManifest,
  validate,
  describe as describeSource,
  writeMarkers,
} from "../src/manifest.js";

const VALID = `version: 1
sources:
  - skill: event-structure
    upstream:
      # keep this comment
      - type: git
        repo: https://example.com/standards.git
        path: rfcs/rfc-59.md
        ref: main
        last-reviewed: aaaa111
      - type: url
        uri: https://example.com/handbook
        last-reviewed: "etag:abc"
`;

async function withManifest(body, fn) {
  const dir = await mkdtemp(join(tmpdir(), "skill-sources-test-"));
  const path = join(dir, "skill-sources.yml");
  await writeFile(path, body, "utf-8");
  try {
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("validate", () => {
  it("flattens each skill/upstream pair into its own entry", () => {
    const entries = validate({
      sources: [
        {
          skill: "a",
          upstream: [
            { type: "git", repo: "r", path: "p" },
            { type: "url", uri: "u" },
          ],
        },
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.index)).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });

  it("treats an absent sources key as empty rather than an error", () => {
    expect(validate({ version: 1 })).toEqual([]);
  });

  it("rejects an unsupported version", () => {
    expect(() => validate({ version: 2, sources: [] })).toThrow(
      /unsupported version 2/,
    );
  });

  it("names the offending skill when an upstream is malformed", () => {
    expect(() =>
      validate({
        sources: [{ skill: "billing", upstream: [{ type: "git", repo: "r" }] }],
      }),
    ).toThrow(/billing.*missing 'path'/);
  });

  it("rejects an unknown source type", () => {
    expect(() =>
      validate({ sources: [{ skill: "a", upstream: [{ type: "smoke" }] }] }),
    ).toThrow(/unknown type 'smoke'/);
  });

  it("records a missing marker as null so it can be reported as unreviewed", () => {
    const [entry] = validate({
      sources: [{ skill: "a", upstream: [{ type: "url", uri: "u" }] }],
    });
    expect(entry.recorded).toBeNull();
  });
});

describe("describe", () => {
  it("identifies a git source by repo, ref and path", () => {
    expect(
      describeSource({ type: "git", repo: "r", path: "p", ref: "main" }),
    ).toBe("git:r@main:p");
  });

  it("identifies a url source by its address", () => {
    expect(describeSource({ type: "url", uri: "https://x/y" })).toBe(
      "url:https://x/y",
    );
  });
});

describe("loadManifest / writeMarkers", () => {
  it("reads entries and reports a clear error for a missing file", async () => {
    await expect(loadManifest("/nope/skill-sources.yml")).rejects.toThrow(
      /No manifest at/,
    );
  });

  it("rewrites markers in place without dropping comments", async () => {
    await withManifest(VALID, async (path) => {
      const { doc, entries } = await loadManifest(path);
      expect(entries).toHaveLength(2);

      await writeMarkers(path, doc, new Map([["0.0", "bbbb222"]]));

      const after = await readFile(path, "utf-8");
      expect(after).toContain("bbbb222");
      expect(after).not.toContain("aaaa111");
      expect(after).toContain("# keep this comment");
      // Untouched entries keep their recorded marker.
      expect(after).toContain("etag:abc");
    });
  });
});
