import { describe, it, expect } from "vitest";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadManifest } from "../src/manifest.js";

const EXAMPLES = fileURLToPath(new URL("../examples", import.meta.url));

/**
 * The examples are documentation, and documentation that no longer parses is
 * worse than none — a reader copies it and blames their own file. Discovered
 * from the directory rather than listed here, so an example added later is
 * covered without anyone remembering to come back.
 */
const manifests = (await readdir(EXAMPLES)).filter((f) => f.endsWith(".yml"));

describe("examples", () => {
  it("ships some", () => {
    expect(manifests.length).toBeGreaterThan(0);
  });

  it.each(manifests)("%s loads through the real parser", async (file) => {
    const { entries } = await loadManifest(join(EXAMPLES, file));
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(entry.skill).toBeTruthy();
      // `recorded` is null for a deliberately unreviewed entry, which
      // all-source-types.yml carries on purpose; the point is that the field is
      // normalised rather than absent.
      expect(entry).toHaveProperty("recorded");
    }
  });

  // The unreviewed entry is the one thing here a reader is most likely to hit
  // in anger, so it is worth knowing it survives a schema change intact.
  it("keeps an unreviewed upstream to demonstrate that check fails on one", async () => {
    const { entries } = await loadManifest(
      join(EXAMPLES, "all-source-types.yml"),
    );
    expect(entries.some((e) => e.recorded === null)).toBe(true);
  });
});
