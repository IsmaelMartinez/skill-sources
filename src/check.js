import { describe } from "./manifest.js";
import { createGitResolver } from "./resolvers/git.js";
import { createUrlResolver } from "./resolvers/url.js";
import { createConfluenceResolver } from "./resolvers/confluence.js";

/** Per-type factory options, so callers never import a resolver directly. */
export function defaultResolvers(options = {}) {
  return {
    git: createGitResolver(options.git),
    url: createUrlResolver(options.url),
    confluence: createConfluenceResolver(options.confluence),
  };
}

/**
 * Resolves every entry and classifies it. Entries are resolved concurrently but
 * bounded, because a manifest with many git sources would otherwise start one
 * clone per entry at once.
 */
export async function resolveAll(
  entries,
  { resolvers = defaultResolvers(), concurrency = 4 } = {},
) {
  const results = new Array(entries.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= entries.length) return;
      results[i] = await resolveOne(entries[i], resolvers);
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, entries.length) }, worker),
    );
  } finally {
    for (const resolver of new Set(Object.values(resolvers))) {
      await resolver.cleanup?.().catch(() => {});
    }
  }

  return results;
}

async function resolveOne(entry, resolvers) {
  const base = {
    skill: entry.skill,
    source: describe(entry.upstream),
    type: entry.upstream.type,
    key: entry.key,
    recorded: entry.recorded,
  };

  const resolver = resolvers[entry.upstream.type];
  if (!resolver) {
    return {
      ...base,
      status: "error",
      error: `no resolver for type '${entry.upstream.type}'`,
    };
  }

  try {
    // Asked before resolving, because a locator that points at nothing has no
    // marker worth comparing: advancing it would record a commit that can never
    // move again and leave the entry looking permanently healthy.
    if (resolver.exists && !(await resolver.exists(entry.upstream))) {
      return { ...base, status: "missing" };
    }

    const current = await resolver.resolve(entry.upstream);
    if (entry.recorded === null) {
      // Nothing to compare against yet: reported separately from drift so a
      // half-populated manifest doesn't masquerade as everything being fine.
      return { ...base, current, status: "unreviewed" };
    }
    return {
      ...base,
      current,
      status: String(entry.recorded) === String(current) ? "fresh" : "drifted",
    };
  } catch (err) {
    return { ...base, status: "error", error: err.message };
  }
}

export function summarise(results) {
  const counts = { fresh: 0, drifted: 0, missing: 0, unreviewed: 0, error: 0 };
  for (const r of results) counts[r.status]++;
  return counts;
}

/**
 * Drift and errors both fail. An unresolvable source is not evidence that the
 * skill is current, and silently passing would make the gate untrustworthy in
 * exactly the case it exists for.
 */
export function exitCodeFor(counts) {
  if (counts.error > 0) return 2;
  return counts.drifted > 0 || counts.unreviewed > 0 || counts.missing > 0
    ? 1
    : 0;
}
