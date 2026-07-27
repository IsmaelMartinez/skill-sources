import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const CLI = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "bin",
  "cli.mjs",
);

function runCli(args, cwd) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd },
      (err, stdout, stderr) => {
        resolve({ stdout, stderr, code: err?.code ?? 0 });
      },
    );
  });
}

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "skill-sources-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("cli argument handling", () => {
  it("rejects an unknown option rather than ignoring it", async () => {
    const res = await runCli(["check", "--jsonn"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/Unknown option '--jsonn'/);
  });

  it("rejects --manifest with no value", async () => {
    const res = await runCli(["check", "--manifest"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/needs a path/);
  });

  it("rejects --manifest followed by another flag", async () => {
    const res = await runCli(["check", "--manifest", "--json"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/needs a path/);
  });

  it("explains a missing manifest instead of throwing", async () => {
    await withDir(async (dir) => {
      const res = await runCli(["check"], dir);
      expect(res.code).toBe(2);
      expect(res.stderr).toMatch(/No manifest at/);
      expect(res.stderr).not.toMatch(/ERR_INVALID_ARG_TYPE|at Object\./);
    });
  });

  it("rejects --confluence-token-env with no value", async () => {
    const res = await runCli(["check", "--confluence-token-env"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/needs a variable name/);
  });

  it("rejects an unknown command", async () => {
    const res = await runCli(["frobnicate"]);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/Unknown command/);
  });
});

describe("cli end to end", () => {
  it("init then check reports an unreviewed source and fails", async () => {
    await withDir(async (dir) => {
      await runCli(["init"], dir);
      await writeFile(
        join(dir, "skill-sources.yml"),
        `version: 1
sources:
  - skill: a
    upstream:
      - type: url
        uri: https://example.invalid/doc
`,
      );
      const res = await runCli(["check"], dir);
      // An unresolvable source is an error, not a silent pass.
      expect(res.code).toBe(2);
    });
  }, 60_000);

  it("reports nothing to do for an empty manifest", async () => {
    await withDir(async (dir) => {
      await writeFile(
        join(dir, "skill-sources.yml"),
        "version: 1\nsources: []\n",
      );
      const res = await runCli(["check"], dir);
      expect(res.code).toBe(0);
      expect(res.stdout).toMatch(/No sources declared/);
    });
  });

  it("refuses to overwrite an existing manifest on init", async () => {
    await withDir(async (dir) => {
      await writeFile(join(dir, "skill-sources.yml"), "version: 1\n");
      const res = await runCli(["init"], dir);
      expect(res.code).toBe(1);
      expect(res.stderr).toMatch(/already exists/);
    });
  });

  it("asks for the confluence variables it was pointed at", async () => {
    await withDir(async (dir) => {
      await writeFile(
        join(dir, "skill-sources.yml"),
        `version: 1
sources:
  - skill: a
    upstream:
      - type: confluence
        uri: https://x.atlassian.net/wiki/spaces/ENG/pages/1/T
        last-reviewed: "3"
`,
      );
      const res = await runCli(
        [
          "check",
          "--confluence-email-env",
          "SYNC_CONFLUENCE_EMAIL",
          "--confluence-token-env",
          "SYNC_CONFLUENCE_TOKEN",
        ],
        dir,
      );
      expect(res.code).toBe(2);
      expect(res.stdout).toContain("SYNC_CONFLUENCE_TOKEN");
      expect(res.stdout).not.toContain("CONFLUENCE_API_TOKEN");
    });
  }, 60_000);

  it("emits valid json even when a source errors", async () => {
    await withDir(async (dir) => {
      await writeFile(
        join(dir, "skill-sources.yml"),
        `version: 1
sources:
  - skill: a
    upstream:
      - type: git
        repo: /nonexistent/repo.git
        path: x.md
        ref: main
        last-reviewed: old
`,
      );
      const res = await runCli(["report", "--json"], dir);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.counts.error).toBe(1);
      expect(parsed.results[0].error).toBeTypeOf("string");
    });
  }, 60_000);
});

describe("seed", () => {
  it("is idempotent and leaves the file fresh", async () => {
    await withDir(async (dir) => {
      const manifest = join(dir, "skill-sources.yml");
      // A file:// URL to this repo is a stable, network-free git source.
      const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
      await writeFile(
        manifest,
        `version: 1
sources:
  # provenance for the readme
  - skill: docs
    upstream:
      - type: git
        repo: ${repo}
        path: README.md
        last-reviewed: ""
`,
      );

      const first = await runCli(["seed"], dir);
      expect(first.code).toBe(0);

      const after = await readFile(manifest, "utf-8");
      expect(after).toMatch(/last-reviewed: "?[0-9a-f]{40}"?/);
      expect(after).toContain("# provenance for the readme");

      const check = await runCli(["check"], dir);
      expect(check.code).toBe(0);

      await runCli(["seed"], dir);
      expect(await readFile(manifest, "utf-8")).toBe(after);
    });
  }, 60_000);

  it("refuses to record a marker for a path that is gone", async () => {
    await withDir(async (dir) => {
      const repo = join(dir, "upstream");
      await mkdir(repo);
      const git = (...args) => run("git", args, { cwd: repo });
      await git("init", "-q", "-b", "main");
      await git("config", "user.email", "t@e.c");
      await git("config", "user.name", "T");
      await git("config", "commit.gpgsign", "false");
      await writeFile(join(repo, "old.md"), "v1\n");
      await git("add", "-A");
      await git("commit", "-qm", "one");
      await git("mv", "old.md", "new.md");
      await git("commit", "-qm", "rename");

      const manifest = join(dir, "skill-sources.yml");
      const body = `version: 1
sources:
  - skill: docs
    upstream:
      - type: git
        repo: ${repo}
        path: old.md
        ref: main
        last-reviewed: ""
`;
      await writeFile(manifest, body);

      const res = await runCli(["seed"], dir);
      expect(res.code).toBe(1);
      expect(res.stdout).toMatch(/Recorded 0 marker/);
      expect(await readFile(manifest, "utf-8")).toBe(body);
    });
  }, 60_000);
});

describe("--verify-skills", () => {
  // Seeded first so every source is fresh: whatever the exit code turns out to
  // be, it can only have come from the skill that is not on disk.
  async function withSeeded(fn) {
    return withDir(async (dir) => {
      const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
      await mkdir(join(dir, "skills", "present"), { recursive: true });
      await writeFile(
        join(dir, "skill-sources.yml"),
        `version: 1
sources:
  - skill: present
    upstream:
      - type: git
        repo: ${repo}
        path: README.md
        last-reviewed: ""
  - skill: vanished
    upstream:
      - type: git
        repo: ${repo}
        path: README.md
        last-reviewed: ""
`,
      );
      await runCli(["seed"], dir);
      return fn(dir);
    });
  }

  it("names a declared skill that has no directory", async () => {
    await withSeeded(async (dir) => {
      const res = await runCli(["check", "--verify-skills", "skills/*"], dir);
      expect(res.code).toBe(1);
      expect(res.stdout).toMatch(/Declared but not on disk/);
      expect(res.stdout).toContain("vanished");
    });
  }, 60_000);

  it("passes once every declared skill is on disk", async () => {
    await withSeeded(async (dir) => {
      await mkdir(join(dir, "skills", "vanished"), { recursive: true });
      const res = await runCli(["check", "--verify-skills", "skills/*"], dir);
      expect(res.code).toBe(0);
      expect(res.stdout).not.toMatch(/Declared but not on disk/);
    });
  }, 60_000);

  it("reports unknown skills in json too", async () => {
    await withSeeded(async (dir) => {
      const res = await runCli(
        ["report", "--json", "--verify-skills", "skills/*"],
        dir,
      );
      expect(JSON.parse(res.stdout).unknownSkills).toEqual(["vanished"]);
    });
  }, 60_000);

  it("stops on a glob that matches nothing rather than blaming every skill", async () => {
    await withSeeded(async (dir) => {
      const res = await runCli(["check", "--verify-skills", "nope/*"], dir);
      expect(res.code).toBe(2);
      expect(res.stderr).toMatch(/matched no directories/);
    });
  }, 60_000);

  it("rejects --verify-skills with no value", async () => {
    const res = await runCli(["check", "--verify-skills"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/needs a glob/);
  });
});
