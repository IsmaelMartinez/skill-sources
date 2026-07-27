import { describe, it, expect } from "vitest";
import { validate } from "../src/manifest.js";
import { resolveAll, summarise, exitCodeFor } from "../src/check.js";

function stubResolvers(markers, { failOn = null } = {}) {
  const resolver = {
    async resolve(upstream) {
      const id = upstream.uri ?? upstream.path;
      if (id === failOn) throw new Error("boom");
      return markers[id];
    },
    async cleanup() {},
  };
  return { git: resolver, url: resolver, confluence: resolver };
}

const entries = validate({
  sources: [
    {
      skill: "alpha",
      upstream: [
        { type: "url", uri: "same", "last-reviewed": "v1" },
        { type: "url", uri: "moved", "last-reviewed": "v1" },
      ],
    },
    {
      skill: "beta",
      upstream: [{ type: "url", uri: "fresh-too", "last-reviewed": "v9" }],
    },
  ],
});

describe("resolveAll", () => {
  it("classifies matching, differing and unresolvable sources", async () => {
    const results = await resolveAll(entries, {
      resolvers: stubResolvers({ same: "v1", moved: "v2", "fresh-too": "v9" }),
    });
    const byStatus = Object.fromEntries(
      results.map((r) => [r.source, r.status]),
    );
    expect(byStatus["url:same"]).toBe("fresh");
    expect(byStatus["url:moved"]).toBe("drifted");
    expect(byStatus["url:fresh-too"]).toBe("fresh");
  });

  it("reports a source with no recorded marker as unreviewed, not fresh", async () => {
    const unreviewed = validate({
      sources: [{ skill: "a", upstream: [{ type: "url", uri: "x" }] }],
    });
    const [result] = await resolveAll(unreviewed, {
      resolvers: stubResolvers({ x: "v1" }),
    });
    expect(result.status).toBe("unreviewed");
    expect(result.current).toBe("v1");
  });

  it("isolates a failing source instead of aborting the run", async () => {
    const results = await resolveAll(entries, {
      resolvers: stubResolvers(
        { same: "v1", "fresh-too": "v9" },
        { failOn: "moved" },
      ),
    });
    expect(summarise(results)).toMatchObject({ fresh: 2, error: 1 });
    expect(results.find((r) => r.source === "url:moved").error).toBe("boom");
  });

  it("compares markers as strings so a numeric version is not falsely drifted", async () => {
    const numeric = validate({
      sources: [
        {
          skill: "a",
          upstream: [{ type: "confluence", uri: "p", "last-reviewed": 27 }],
        },
      ],
    });
    const [result] = await resolveAll(numeric, {
      resolvers: stubResolvers({ p: "27" }),
    });
    expect(result.status).toBe("fresh");
  });

  it("marks a source whose locator points at nothing, without resolving it", async () => {
    let resolved = false;
    const gone = validate({
      sources: [
        {
          skill: "a",
          upstream: [
            { type: "git", repo: "r", path: "p", "last-reviewed": "v1" },
          ],
        },
      ],
    });
    const [result] = await resolveAll(gone, {
      resolvers: {
        git: {
          async exists() {
            return false;
          },
          async resolve() {
            resolved = true;
            return "v2";
          },
        },
      },
    });
    expect(result.status).toBe("missing");
    expect(resolved).toBe(false);
  });

  it("reports an unknown type as an error rather than throwing", async () => {
    const bad = validate({
      sources: [
        {
          skill: "a",
          upstream: [{ type: "url", uri: "x", "last-reviewed": "v" }],
        },
      ],
    });
    const [result] = await resolveAll(bad, { resolvers: {} });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/no resolver/);
  });
});

describe("exitCodeFor", () => {
  it("passes only when everything is fresh", () => {
    expect(exitCodeFor({ fresh: 3, drifted: 0, unreviewed: 0, error: 0 })).toBe(
      0,
    );
  });

  it("fails on drift", () => {
    expect(exitCodeFor({ fresh: 1, drifted: 1, unreviewed: 0, error: 0 })).toBe(
      1,
    );
  });

  it("fails on an unreviewed source, which is not evidence of freshness", () => {
    expect(exitCodeFor({ fresh: 1, drifted: 0, unreviewed: 1, error: 0 })).toBe(
      1,
    );
  });

  it("fails on a source whose path is gone", () => {
    expect(
      exitCodeFor({
        fresh: 1,
        drifted: 0,
        missing: 1,
        unreviewed: 0,
        error: 0,
      }),
    ).toBe(1);
  });

  it("distinguishes an unresolvable source from drift", () => {
    expect(exitCodeFor({ fresh: 0, drifted: 1, unreviewed: 0, error: 1 })).toBe(
      2,
    );
  });
});
