import { readFile, writeFile } from "node:fs/promises";
import { parseDocument } from "yaml";

export const DEFAULT_MANIFEST = "skill-sources.yml";

const TYPES = new Set(["git", "url", "confluence"]);

/**
 * A manifest is loaded as a yaml Document rather than a plain object so that
 * `seed` can write markers back without reformatting the file or dropping the
 * comments people leave next to an entry.
 */
export async function loadManifest(path) {
  let raw;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new UserError(
        `No manifest at ${path}. Run \`skill-sources init\` to create one.`,
      );
    }
    throw err;
  }

  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    throw new UserError(`${path} is not valid YAML: ${doc.errors[0].message}`);
  }

  const data = doc.toJS() ?? {};
  return { doc, entries: validate(data, path) };
}

export class UserError extends Error {}

/**
 * Flattens the manifest into one record per (skill, upstream) pair, which is
 * the unit everything downstream works in.
 */
export function validate(data, path = DEFAULT_MANIFEST) {
  if (data.version !== undefined && data.version !== 1) {
    throw new UserError(
      `${path}: unsupported version ${data.version}, expected 1`,
    );
  }
  const sources = data.sources;
  if (sources === undefined || sources === null) return [];
  if (!Array.isArray(sources)) {
    throw new UserError(`${path}: 'sources' must be a list`);
  }

  const entries = [];
  sources.forEach((entry, i) => {
    const where = `${path}: sources[${i}]`;
    if (!entry || typeof entry !== "object")
      throw new UserError(`${where} must be a mapping`);
    if (!entry.skill) throw new UserError(`${where} is missing 'skill'`);
    if (!Array.isArray(entry.upstream) || entry.upstream.length === 0) {
      throw new UserError(
        `${where} (${entry.skill}) needs a non-empty 'upstream' list`,
      );
    }

    entry.upstream.forEach((up, j) => {
      const at = `${where}.upstream[${j}] (${entry.skill})`;
      if (!up || typeof up !== "object")
        throw new UserError(`${at} must be a mapping`);
      if (!TYPES.has(up.type)) {
        throw new UserError(
          `${at} has unknown type '${up.type}', expected one of ${[...TYPES].join(", ")}`,
        );
      }
      if (up.type === "git") {
        for (const field of ["repo", "path"]) {
          if (!up[field])
            throw new UserError(`${at} is a git source missing '${field}'`);
        }
      } else if (!up.uri) {
        throw new UserError(`${at} is a ${up.type} source missing 'uri'`);
      }

      // An absent marker and the empty string the init template leaves both
      // mean "never reviewed"; normalised here so downstream tests one value.
      const marker = up["last-reviewed"] ?? null;
      entries.push({
        skill: entry.skill,
        index: [i, j],
        key: `${i}.${j}`,
        upstream: up,
        recorded: marker === "" ? null : marker,
      });
    });
  });

  return entries;
}

/** A stable one-line identity for an upstream, used in output and as a map key. */
export function describe(upstream) {
  if (upstream.type === "git") {
    const ref = upstream.ref ? `@${upstream.ref}` : "";
    return `git:${upstream.repo}${ref}:${upstream.path}`;
  }
  return `${upstream.type}:${upstream.uri}`;
}

/**
 * Writes resolved markers back into the document in place. `updates` maps
 * "i.j" index pairs to their new marker.
 */
export async function writeMarkers(path, doc, updates) {
  for (const [key, marker] of updates) {
    const [i, j] = key.split(".").map(Number);
    doc.setIn(["sources", i, "upstream", j, "last-reviewed"], marker);
  }
  await writeFile(path, doc.toString(), "utf-8");
}
