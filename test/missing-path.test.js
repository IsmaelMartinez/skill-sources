import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createGitResolver } from "../src/resolvers/git.js";
import { validate } from "../src/manifest.js";
import { resolveAll } from "../src/check.js";

const run = promisify(execFile);

/**
 * A rename is the case that motivated the status: `git log` answers for the old
 * path with the commit that renamed it, so the entry looks like ordinary drift,
 * and seeding it pins the marker to a path nothing will ever touch again.
 */
describe("an upstream path that is gone", () => {
  let dir;
  let firstSha;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "skill-sources-gone-"));
    const git = (...args) => run("git", args, { cwd: dir });
    await git("init", "-q", "-b", "main");
    await git("config", "user.email", "t@e.c");
    await git("config", "user.name", "T");
    await git("config", "commit.gpgsign", "false");

    await writeFile(join(dir, "old-name.md"), "v1\n");
    await writeFile(join(dir, "kept.md"), "k\n");
    await git("add", "-A");
    await git("commit", "-qm", "one");
    firstSha = (
      await run("git", ["rev-parse", "HEAD"], { cwd: dir })
    ).stdout.trim();

    await git("mv", "old-name.md", "new-name.md");
    await git("commit", "-qm", "rename");
  }, 60_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function entry(path, recorded, ref = "main") {
    return validate({
      sources: [
        {
          skill: "s",
          upstream: [
            {
              type: "git",
              repo: dir,
              path,
              ref,
              "last-reviewed": recorded,
            },
          ],
        },
      ],
    });
  }

  it("reports a renamed path as missing rather than drifted", async () => {
    const [result] = await resolveAll(entry("old-name.md", firstSha), {
      resolvers: { git: createGitResolver() },
    });
    expect(result.status).toBe("missing");
    // No marker at all, so nothing downstream can record one.
    expect(result.current).toBeUndefined();
  });

  it("reports a path that never existed as missing, not as an error", async () => {
    const [result] = await resolveAll(entry("never-here.md", firstSha), {
      resolvers: { git: createGitResolver() },
    });
    expect(result.status).toBe("missing");
  });

  it("still resolves a path that is present", async () => {
    const [result] = await resolveAll(entry("new-name.md", firstSha), {
      resolvers: { git: createGitResolver() },
    });
    expect(result.status).toBe("drifted");
    expect(result.current).toMatch(/^[0-9a-f]{40}$/);
  });

  // `git log` matches a pathspec, `ls-tree` does not. Reporting such a path as
  // gone would be a lie that `seed` could never clear.
  it("leaves a wildcard path to resolve rather than calling it gone", async () => {
    const [result] = await resolveAll(entry("*.md", firstSha), {
      resolvers: { git: createGitResolver() },
    });
    expect(result.status).toBe("drifted");
    expect(result.current).toMatch(/^[0-9a-f]{40}$/);
  });

  it("reports an unreadable ref without dumping the command", async () => {
    const absent = "0123456789abcdef0123456789abcdef01234567";
    const [result] = await resolveAll(entry("kept.md", firstSha, absent), {
      resolvers: { git: createGitResolver() },
    });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/could not read/);
    expect(result.error).not.toMatch(/git ls-tree|--name-only/);
  });

  it("answers exists for a path still in the tree", async () => {
    const resolver = createGitResolver();
    try {
      const upstream = { repo: dir, ref: "main" };
      expect(await resolver.exists({ ...upstream, path: "kept.md" })).toBe(
        true,
      );
      expect(await resolver.exists({ ...upstream, path: "old-name.md" })).toBe(
        false,
      );
    } finally {
      await resolver.cleanup();
    }
  }, 60_000);
});
