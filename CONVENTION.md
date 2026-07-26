# Upstream source declaration for agent skills

A declaration-only convention for recording the documents a skill derives from,
so tooling can tell when those documents have moved and the skill needs
re-reviewing.

This is an authoring-side convention. It changes nothing about how a skill is
loaded or run, and asks nothing of the
[Agent Skills specification](https://github.com/agentskills/agentskills). It is
written down here so more than one tool can agree on it. See
[discussion #436](https://github.com/agentskills/agentskills/discussions/436) for
the background.

## The problem

Many skills are not original prose. They distil a source of truth — an ADR, an
RFC, a standards page, a wiki article — into instructions an agent can act on.

When that upstream document changes, nothing happens. The skill keeps asserting
what the document used to say, and the divergence is invisible until someone
notices the agent giving outdated guidance. Nothing in the skill records where
its knowledge came from, so nothing can detect the drift.

## What this is not

It is not a way to regenerate a skill. Re-distilling an RFC into usable guidance
is human judgement, and a tool that rewrote the skill automatically would
launder that judgement away. Detecting drift must open a review, never a
rewrite. This is the property that separates the problem from build-time
composition, where regeneration is exactly the point.

It is also not versioning, integrity, signing, licensing, or attribution. It
records provenance for one purpose: knowing when to look again.

## The declaration

Sources are declared in a single manifest at the repository root, named
`skill-sources.yml`.

```yaml
version: 1
sources:
  - skill: event-structure
    upstream:
      - type: git
        repo: https://github.com/example/standards.git
        path: rfcs/rfc-0059-events.md
        ref: main
        last-reviewed: ae408acae79bf58e086d6c86a9f12408b760b188

      - type: url
        uri: https://example.com/handbook/logging
        last-reviewed: "sha256:9f2b1c…"

      - type: confluence
        uri: https://example.atlassian.net/wiki/spaces/ENG/pages/12345/Logging
        last-reviewed: "27"
```

`skill` names the skill directory. `upstream` lists one or more documents it
derives from. `last-reviewed` is the opaque marker that was current when a human
last reconciled the skill with that document — a commit SHA, a content hash, a
page version. Tooling compares the marker it resolves today against the recorded
one; different means drift.

A skill that codifies internal convention with no external upstream simply has
no entry.

### Why one manifest rather than per-skill declaration

This is the part worth arguing, because the intuitive answer is the other one.
Colocating provenance with the skill reads better and was the first thing we
tried, as a `sources` key in `SKILL.md` frontmatter. We removed it after two
months in production across ~34 skills:

`sources` is not a recognised frontmatter field, so spec validators warned about
it and we had to suppress them. Any per-skill scheme that lives in frontmatter
inherits that problem. A sidecar file avoids it, at the cost of a second file
per skill.

The declaration duplicated a central mapping the pipeline already read, and the
CI check that cross-validated the two spent its life catching mismatches the
duplication itself had created.

Human-readable attribution was already in the skill body as prose links, which
is what actually serves a reader.

The operational argument is enumeration. Answering "what do we depend on, and
what has moved?" is one file read, and a CI job can assert every entry points at
a real skill directory. A per-skill scheme has to walk the tree to reconstruct
the same list, and nothing stops a skill from quietly having no declaration at
all.

None of this makes a sidecar wrong. If a repository has one skill, colocation is
obviously better. The convention above is what survived contact with a
multi-skill registry.

## Source types

`git` identifies a file inside a git repository, by `repo`, `path` and `ref`.
The marker is the SHA of the last commit that touched that path — file-level, not
repository-level, so unrelated commits do not raise false drift. Resolving it
needs only `git` and whatever credentials the user already has, which is what
makes the type host-agnostic: GitHub, GitLab, self-hosted, SSH or HTTPS all work
without an API token or a host-specific code path.

`url` identifies a document by address. The marker prefers a strong `ETag`, falls
back to `Last-Modified`, and falls back again to a hash of the fetched body.
Pages that are dynamically assembled will produce noisy hashes; that is a
property of the page, and the convention does not try to hide it.

`confluence` identifies a wiki page, whose version number is a far better marker
than its rendered body. Requires credentials.

The type list is open. A resolver only has to turn a locator into a comparable
opaque marker.

## Reviewing drift

When a marker differs, the skill is not necessarily wrong — the upstream change
may be irrelevant to it. The reviewer's job is to decide, then either update the
skill or accept it as still-accurate. Either way, the recorded marker moves
forward to close the loop, which means acceptance has to be as cheap as
updating. Tooling that only offers "update the skill" will be routed around.

## Prior art

[`skill-drift`](https://github.com/coskunarif/skill-drift) detects skills that
have gone stale relative to the codebase they describe, using glob patterns and
a `verified_at` date in frontmatter. Same family, different axis: it watches code
in the same repository, this watches documents outside it.

[`nbp-skillforge`](https://github.com/nbpadilha/nbp-skillforge) builds skills
from shared bricks and gates on internal drift between a generated skill and its
recipe. Complementary: that drift is regenerable, this one is not.
