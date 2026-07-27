import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createGitResolver,
  gitReason,
  remoteRefState,
} from "../src/resolvers/git.js";

const run = promisify(execFile);

describe("git resolver — refs beyond a branch name", () => {
  let dir;
  let tagSha;
  let headSha;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "skill-sources-refs-"));
    const git = (...args) => run("git", args, { cwd: dir });
    await git("init", "-q", "-b", "main");
    await git("config", "user.email", "t@e.c");
    await git("config", "user.name", "T");
    await git("config", "commit.gpgsign", "false");

    await writeFile(join(dir, "doc.md"), "v1\n");
    await git("add", "-A");
    await git("commit", "-qm", "one");
    await git("tag", "v1.0");
    tagSha = (
      await run("git", ["rev-parse", "HEAD"], { cwd: dir })
    ).stdout.trim();

    await writeFile(join(dir, "doc.md"), "v2\n");
    await git("add", "-A");
    await git("commit", "-qm", "two");
    headSha = (
      await run("git", ["rev-parse", "HEAD"], { cwd: dir })
    ).stdout.trim();
  }, 60_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts a tag as the ref", async () => {
    const resolver = createGitResolver();
    try {
      expect(
        await resolver.resolve({ repo: dir, path: "doc.md", ref: "v1.0" }),
      ).toBe(tagSha);
    } finally {
      await resolver.cleanup();
    }
  }, 60_000);

  // `git clone --branch` rejects a commit, so pinning to one has to widen the
  // clone rather than fail.
  it("accepts a commit SHA as the ref", async () => {
    const resolver = createGitResolver();
    try {
      expect(
        await resolver.resolve({ repo: dir, path: "doc.md", ref: headSha }),
      ).toBe(headSha);
    } finally {
      await resolver.cleanup();
    }
  }, 60_000);

  it("resolves against the default branch when no ref is given", async () => {
    const resolver = createGitResolver();
    try {
      expect(await resolver.resolve({ repo: dir, path: "doc.md" })).toBe(
        headSha,
      );
    } finally {
      await resolver.cleanup();
    }
  }, 60_000);

  // The message is the evidence that the ref was settled against the remote
  // rather than by widening: had it cloned, the failure would have come from
  // `git log` failing to resolve the revision, and read quite differently.
  it("names the ref and repo when the ref does not exist", async () => {
    const resolver = createGitResolver();
    try {
      const err = await resolver
        .resolve({ repo: dir, path: "doc.md", ref: "nope" })
        .catch((e) => e);
      expect(err.message).toMatch(/ref 'nope' not found in/);
      expect(err.message).not.toMatch(/git clone|--filter/);
    } finally {
      await resolver.cleanup();
    }
  }, 60_000);

  // Tested directly because the resolver cannot distinguish the two outcomes
  // from the outside: `cloneError` happens to produce the same sentence for a
  // ref the remote does not have, so an assertion on the message would pass
  // even if the discrimination were removed entirely.
  it("tells a remote with no such ref apart from a remote that will not answer", async () => {
    expect(await remoteRefState(dir, "main")).toBe("present");
    expect(await remoteRefState(dir, "v1.0")).toBe("present");
    expect(await remoteRefState(dir, "nope")).toBe("absent");
    expect(await remoteRefState("/nonexistent/repo.git", "main")).toBe(
      "unreachable",
    );
  }, 60_000);

  it("reports an unreachable repository even when the ref is a sha", async () => {
    const resolver = createGitResolver();
    try {
      const err = await resolver
        .resolve({
          repo: "/nonexistent/repo.git",
          path: "doc.md",
          ref: headSha,
        })
        .catch((e) => e);
      expect(err.message).toMatch(/cannot read|no access/);
      expect(err.message).not.toMatch(/skill-sources-/);
    } finally {
      await resolver.cleanup();
    }
  }, 60_000);

  it("reports an unreachable repository without dumping the command", async () => {
    const resolver = createGitResolver();
    try {
      const err = await resolver
        .resolve({ repo: "/nonexistent/repo.git", path: "doc.md", ref: "main" })
        .catch((e) => e);
      expect(err.message).toMatch(/cannot read|no access/);
      expect(err.message).not.toMatch(/--no-checkout|skill-sources-/);
    } finally {
      await resolver.cleanup();
    }
  }, 60_000);
});

describe("gitReason", () => {
  it("keeps git's diagnosis and drops the command line", () => {
    const err = {
      message: "Command failed: git clone --filter=blob:none /tmp/xyz",
      stderr:
        "warning: --filter is ignored in local clones\nfatal: repository 'x' does not exist\n",
    };
    expect(gitReason(err)).toBe("repository 'x' does not exist");
  });

  it("explains a missing git binary", () => {
    expect(gitReason({ code: "ENOENT", message: "spawn git ENOENT" })).toMatch(
      /not installed/,
    );
  });
});
