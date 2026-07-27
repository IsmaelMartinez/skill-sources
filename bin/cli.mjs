#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  DEFAULT_MANIFEST,
  loadManifest,
  writeMarkers,
  UserError,
} from "../src/manifest.js";
import { resolveAll, summarise, exitCodeFor } from "../src/check.js";
import { unknownSkills } from "../src/skills.js";

const HELP = `skill-sources — detect when the documents a skill derives from have moved

Usage
  skill-sources check     Report drift; exit 1 if anything drifted, 2 on error
  skill-sources report    Same as check, but always exit 0
  skill-sources seed      Record current markers into the manifest
  skill-sources init      Write a starter manifest

Options
  -m, --manifest <path>   Manifest to read (default: ${DEFAULT_MANIFEST})
      --verify-skills <glob>
                          Also check every declared skill exists on disk,
                          e.g. 'skills/*' or 'plugins/*/skills/*'
      --json              Machine-readable output
  -h, --help              Show this help

Exit codes
  0  everything fresh
  1  drift, a source with no recorded marker, or a skill that is not on disk
  2  a source could not be resolved
`;

const TEMPLATE = `version: 1
sources:
  # - skill: my-skill
  #   upstream:
  #     - type: git
  #       repo: https://github.com/example/standards.git
  #       path: rfcs/rfc-0059-events.md
  #       ref: main
  #       last-reviewed: ""
`;

async function main(argv) {
  const args = parse(argv);
  if (args.help || !args.command) {
    process.stdout.write(HELP);
    return args.command ? 0 : args.help ? 0 : 1;
  }

  if (args.command === "init") return init(args);
  if (!["check", "report", "seed"].includes(args.command)) {
    process.stderr.write(`Unknown command '${args.command}'\n\n${HELP}`);
    return 1;
  }

  const { doc, entries } = await loadManifest(args.manifest);
  if (entries.length === 0) {
    if (!args.json)
      process.stdout.write(`No sources declared in ${args.manifest}.\n`);
    else
      process.stdout.write(
        `${JSON.stringify({ results: [], counts: summarise([]), unknownSkills: [] })}\n`,
      );
    return 0;
  }

  // Checked before anything is resolved, so a mistyped glob fails in a second
  // rather than after every clone.
  const unknown = args.verifySkills
    ? await unknownSkills(entries, dirname(args.manifest), args.verifySkills)
    : [];

  const results = await resolveAll(entries);
  const counts = summarise(results);

  if (args.command === "seed") {
    const updates = new Map(
      results
        .filter((r) => r.status !== "error")
        .map((r) => [r.key, r.current]),
    );
    await writeMarkers(args.manifest, doc, updates);
    process.stdout.write(
      `Recorded ${updates.size} marker(s) in ${args.manifest}.\n`,
    );
    process.stdout.write(unknownReport(unknown, args.verifySkills));
    if (counts.error > 0) return 2;
    return unknown.length > 0 ? 1 : 0;
  }

  process.stdout.write(
    args.json
      ? `${JSON.stringify({ results, counts, unknownSkills: unknown }, null, 2)}\n`
      : render(results, counts) + unknownReport(unknown, args.verifySkills),
  );
  if (args.command === "report") return 0;
  // An entry for a skill that is not there is its own thing to fix, but never
  // more serious than a source that could not be resolved at all.
  return Math.max(exitCodeFor(counts), unknown.length > 0 ? 1 : 0);
}

function unknownReport(unknown, pattern) {
  if (unknown.length === 0) return "";
  return `\nDeclared but not on disk (no match under '${pattern}'):\n${unknown
    .map((skill) => `  ${skill}\n`)
    .join("")}`;
}

async function init(args) {
  if (existsSync(args.manifest)) {
    process.stderr.write(`${args.manifest} already exists.\n`);
    return 1;
  }
  await writeFile(args.manifest, TEMPLATE, "utf-8");
  process.stdout.write(`Wrote ${args.manifest}.\n`);
  return 0;
}

function render(results, counts) {
  const lines = [];
  const order = { drifted: 0, unreviewed: 1, error: 2, fresh: 3 };
  const label = {
    drifted: "drifted   ",
    unreviewed: "unreviewed",
    error: "error     ",
    fresh: "fresh     ",
  };

  for (const r of [...results].sort(
    (a, b) => order[a.status] - order[b.status],
  )) {
    lines.push(`  ${label[r.status]} ${r.skill}  ${r.source}`);
    if (r.status === "drifted")
      lines.push(`               ${r.recorded} -> ${r.current}`);
    if (r.status === "error") lines.push(`               ${r.error}`);
  }

  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`);
  lines.push("", parts.length ? parts.join(", ") : "nothing declared");
  return `${lines.join("\n")}\n`;
}

function parse(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    verifySkills: null,
    json: false,
    help: false,
    command: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "-m" || arg === "--manifest")
      args.manifest = requireValue(arg, argv[++i], "a path");
    else if (arg === "--verify-skills")
      args.verifySkills = requireValue(arg, argv[++i], "a glob");
    // A flag that silently keeps its default is worse than one that stops:
    // `--jsonn` in CI would quietly report human text and be believed.
    else if (arg.startsWith("-"))
      throw new UserError(`Unknown option '${arg}'`);
    else if (!args.command) args.command = arg;
  }
  return args;
}

/** The next argument, unless it is missing or is itself a flag. */
function requireValue(arg, value, what) {
  if (!value || value.startsWith("-")) {
    throw new UserError(`${arg} needs ${what}`);
  }
  return value;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  if (err instanceof UserError) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`${err?.stack ?? err}\n`);
    process.exitCode = 2;
  }
}
