import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSkillDirs, unknownSkills } from "../src/skills.js";
import { validate } from "../src/manifest.js";

describe("findSkillDirs", () => {
  let root;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "skill-sources-layout-"));
    for (const dir of [
      "skills/alpha",
      "skills/beta",
      "plugins/one/skills/gamma",
      "plugins/two/skills/delta",
      "docs/not-a-skill",
      // Long enough that a backtracking matcher would not finish on it.
      "a".repeat(60),
    ]) {
      await mkdir(join(root, dir), { recursive: true });
    }
    // A file where a directory would match must not count as a skill.
    await writeFile(join(root, "skills", "readme.md"), "x\n");

    // Symlinking a skill into place is a normal layout; a dirent calls it a
    // link rather than a directory, so it needs following.
    await mkdir(join(root, "linked"), { recursive: true });
    await symlink(join(root, "skills", "alpha"), join(root, "linked/via-link"));
    await symlink(join(root, "nowhere"), join(root, "linked/dangling"));
    await symlink(
      join(root, "skills", "readme.md"),
      join(root, "linked/to-a-file"),
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("matches a flat layout", async () => {
    expect((await findSkillDirs(root, "skills/*")).sort()).toEqual([
      "skills/alpha",
      "skills/beta",
    ]);
  });

  it("matches a nested layout with a wildcard at each level", async () => {
    expect((await findSkillDirs(root, "plugins/*/skills/*")).sort()).toEqual([
      "plugins/one/skills/gamma",
      "plugins/two/skills/delta",
    ]);
  });

  it("matches a wildcard inside a segment", async () => {
    expect(await findSkillDirs(root, "plugins/o*")).toEqual(["plugins/one"]);
  });

  it("anchors what follows a wildcard, at the end and in the middle", async () => {
    expect(await findSkillDirs(root, "plugins/*e")).toEqual(["plugins/one"]);
    expect(await findSkillDirs(root, "plugins/t*o")).toEqual(["plugins/two"]);
    expect(await findSkillDirs(root, "plugins/*n")).toEqual([]);
  });

  it("matches a segment with no wildcard exactly", async () => {
    expect(await findSkillDirs(root, "plugins/one")).toEqual(["plugins/one"]);
    expect(await findSkillDirs(root, "plugins/on")).toEqual([]);
  });

  it("returns nothing for a layout that is not there", async () => {
    expect(await findSkillDirs(root, "nowhere/*")).toEqual([]);
  });

  it("ignores a leading ./, which readdir never yields", async () => {
    expect((await findSkillDirs(root, "./skills/*")).sort()).toEqual([
      "skills/alpha",
      "skills/beta",
    ]);
  });

  // Left to walk no segments at all, this would return the root itself, whose
  // basename matches no skill — reporting every skill in the manifest as gone.
  it("refuses a pattern that names no directory", async () => {
    await expect(findSkillDirs(root, "/")).rejects.toThrow(
      /names no directory/,
    );
    await expect(findSkillDirs(root, ".")).rejects.toThrow(
      /names no directory/,
    );
  });

  it("follows a symlink that points at a directory", async () => {
    expect((await findSkillDirs(root, "linked/*")).sort()).toEqual([
      "linked/via-link",
    ]);
  });

  // A regex-based matcher took over a minute on each of these, because every
  // `*` multiplies the ways the name can be split between them.
  it("does not backtrack catastrophically on a run of stars", async () => {
    const started = Date.now();
    expect(await findSkillDirs(root, `${"*".repeat(12)}nomatch`)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("does not backtrack catastrophically on stars split by literals", async () => {
    const started = Date.now();
    expect(await findSkillDirs(root, `${"a*".repeat(12)}z`)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("treats a run of stars as one, since globstar is not implemented", async () => {
    expect(await findSkillDirs(root, "skills/**")).toEqual(
      await findSkillDirs(root, "skills/*"),
    );
  });
});

describe("unknownSkills", () => {
  let root;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "skill-sources-declared-"));
    await mkdir(join(root, "skills", "alpha"), { recursive: true });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const entries = validate({
    sources: [
      { skill: "alpha", upstream: [{ type: "url", uri: "a" }] },
      { skill: "gone", upstream: [{ type: "url", uri: "b" }] },
      { skill: "gone", upstream: [{ type: "url", uri: "c" }] },
    ],
  });

  it("names a declared skill with no directory, once per skill", async () => {
    expect(await unknownSkills(entries, root, "skills/*")).toEqual(["gone"]);
  });

  it("blames the glob rather than every skill when nothing matches", async () => {
    await expect(unknownSkills(entries, root, "plugins/*")).rejects.toThrow(
      /'plugins\/\*' matched no directories/,
    );
  });
});
