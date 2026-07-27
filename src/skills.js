import { readdir, stat } from "node:fs/promises";
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
  // `.` segments are dropped rather than matched, since readdir never yields
  // one. Dropping them can leave nothing at all — `/` and `.` both do — and a
  // walk over no segments would return the root and call every skill unknown.
  const segments = pattern.split("/").filter((s) => s && s !== ".");
  if (segments.length === 0) {
    throw new UserError(
      `'${pattern}' names no directory; give a layout such as 'skills/*'`,
    );
  }

  let dirs = [""];
  for (const segment of segments) {
    const next = [];
    for (const dir of dirs) {
      const found = await readdir(join(root, dir), {
        withFileTypes: true,
      }).catch(() => []);
      for (const child of found) {
        if (
          matchesSegment(segment, child.name) &&
          (await isDirectory(root, dir, child))
        ) {
          next.push(join(dir, child.name));
        }
      }
    }
    dirs = next;
  }
  return dirs;
}

/**
 * A dirent reports a symlink as a symlink, never as a directory, and skills
 * symlinked into a flat directory is a normal enough layout that treating one
 * as absent would fail a build for no reason.
 */
async function isDirectory(root, dir, child) {
  if (child.isDirectory()) return true;
  if (!child.isSymbolicLink()) return false;
  return stat(join(root, dir, child.name)).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
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

/**
 * Matches one name against one segment, where `*` stands for any run of
 * characters and everything else is literal.
 *
 * Deliberately not a regular expression. Building one turns each `*` into
 * `[^/]*`, and a segment carrying several of those makes the engine try every
 * way of splitting the name between them — `a*a*a*a*a*a*a*a*a*a*z` against a
 * forty-character directory took seven seconds, and a run of bare stars far
 * worse. This walks the two strings once, remembering only the last `*` to
 * fall back to, so the cost stays proportional to their lengths.
 */
function matchesSegment(segment, name) {
  let s = 0;
  let n = 0;
  let star = -1;
  let retry = 0;

  while (n < name.length) {
    if (s < segment.length && segment[s] === name[n]) {
      s++;
      n++;
    } else if (s < segment.length && segment[s] === "*") {
      star = s++;
      retry = n;
    } else if (star >= 0) {
      // Give the last `*` one more character and carry on from there.
      s = star + 1;
      n = ++retry;
    } else {
      return false;
    }
  }

  while (s < segment.length && segment[s] === "*") s++;
  return s === segment.length;
}
