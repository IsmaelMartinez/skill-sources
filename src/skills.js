import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { UserError } from "./manifest.js";

/**
 * Expands a directory glob into the directories it matches, relative to `root`.
 *
 * Only `*` is supported, and only within a segment. Skill layouts differ
 * between repositories, but every one of them is a fixed depth below the root,
 * so that is the whole of what a layout needs to say.
 */
export async function findSkillDirs(root, pattern) {
  let dirs = [""];
  for (const segment of pattern.split("/").filter(Boolean)) {
    const matches = segmentMatcher(segment);
    const next = [];
    for (const dir of dirs) {
      const found = await readdir(join(root, dir), {
        withFileTypes: true,
      }).catch(() => []);
      for (const child of found) {
        if (child.isDirectory() && matches(child.name)) {
          next.push(join(dir, child.name));
        }
      }
    }
    dirs = next;
  }
  return dirs;
}

/**
 * Skills the manifest declares that no directory under `pattern` provides.
 * An entry left behind by a renamed or deleted skill keeps resolving its
 * upstream happily, so nothing else notices it.
 */
export async function unknownSkills(entries, root, pattern) {
  const dirs = await findSkillDirs(root, pattern);
  if (dirs.length === 0) {
    // Every skill would be reported unknown, which reads as a catastrophe
    // rather than as the typo in the glob that it is.
    throw new UserError(`'${pattern}' matched no directories under ${root}`);
  }

  const present = new Set(dirs.map((dir) => basename(dir)));
  const declared = new Set(entries.map((entry) => entry.skill));
  return [...declared].filter((skill) => !present.has(skill));
}

function segmentMatcher(segment) {
  const pattern = segment.split("*").map(escapeRegExp).join("[^/]*");
  const regex = new RegExp(`^${pattern}$`);
  return (name) => regex.test(name);
}

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
