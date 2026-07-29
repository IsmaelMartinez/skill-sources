# 0001 — One manifest at the repository root

Status: accepted, 2026-07 (decision predates this repository; recorded here)

## Context

Skills distil upstream documents, and detecting drift needs each skill's
sources recorded somewhere machine-readable. The intuitive home is the skill
itself — a `sources` key in `SKILL.md` frontmatter — and that is what was
tried first, for two months across ~34 skills in a production registry.

It failed in three ways. Spec validators warned about the unrecognised
frontmatter field, and any per-skill scheme living in frontmatter inherits
that problem. The declarations duplicated a central mapping the pipeline
already read, and the CI check reconciling the two spent its life catching
mismatches the duplication itself created. And answering "what do we depend
on, and what has moved?" required walking the tree, while nothing stopped a
skill from quietly declaring nothing at all.

## Decision

Sources are declared in a single manifest at the repository root,
`skill-sources.yml`. The full argument, including the frontmatter history, is
in [CONVENTION.md](../../CONVENTION.md), which is the normative text; this
record exists so the decision appears in the log.

## Consequences

Enumeration is one file read, and CI can assert every entry names a real
skill directory (`--verify-skills`). Provenance is not colocated with the
skill, which reads worse; human-readable attribution stays in the skill body
as prose links, which is what actually serves a reader.

## Alternatives considered

Frontmatter declaration (tried, removed — above). A sidecar file per skill
avoids the validator problem at the cost of a second file per skill and the
same enumeration walk; for a repository with one skill it remains the better
choice, and the convention does not forbid it.
