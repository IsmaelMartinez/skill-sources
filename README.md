# skill-sources

Detect when the upstream documents an agent skill derives from have moved.

Many skills are not original prose — they distil an ADR, an RFC, a standards
page or a wiki article into something an agent can act on. When that document
changes, nothing happens: the skill keeps asserting what it used to say, and
nobody finds out until the agent gives outdated guidance.

`skill-sources` records what each skill derives from, and tells you when those
documents move.

```console
$ npx skill-sources check
  drifted    event-structure  git:https://gitlab.com/org/knowledge.git@main:rfcs/rfc-0059.md
               ae408ac -> 5040059
  fresh      aws-tagging      git:https://gitlab.com/org/knowledge.git@main:rfcs/rfc-0013.md

1 drifted, 1 fresh
```

It reports; it never rewrites. Re-distilling a document into guidance is human
judgement, so drift opens a review rather than a patch.

## Install

Nothing to install — it runs from `npx`, and needs Node 20+.

```console
$ npx skill-sources init      # write a starter manifest
$ npx skill-sources check     # exit 1 if anything drifted
```

## The manifest

Sources live in one file at the repository root, `skill-sources.yml`:

```yaml
version: 1
sources:
  - skill: event-structure
    upstream:
      - type: git
        repo: https://gitlab.com/org/knowledge.git
        path: rfcs/rfc-0059-events.md
        ref: main
        last-reviewed: ae408acae79bf58e086d6c86a9f12408b760b188

      - type: confluence
        uri: https://org.atlassian.net/wiki/spaces/ENG/pages/12345/Logging
        last-reviewed: "27"
```

`last-reviewed` is whatever was current when a human last reconciled the skill
with that document. `seed` fills it in; `check` compares against it.

One manifest rather than per-skill declaration is a deliberate choice, argued
from production experience in [CONVENTION.md](CONVENTION.md).

## Source types

| Type | Locator | Marker |
| --- | --- | --- |
| `git` | `repo`, `path`, `ref` | SHA of the last commit touching `path` |
| `url` | `uri` | strong `ETag`, else `Last-Modified`, else a hash of the body |
| `confluence` | `uri` | the page's version number |

`git` goes through `git` itself rather than a host API, so GitHub, GitLab,
Bitbucket and self-hosted servers all work over SSH or HTTPS with the
credentials you already have, and no token to configure. The marker is
file-level, so unrelated commits to the repository do not raise false drift.

`confluence` needs `CONFLUENCE_EMAIL` and `CONFLUENCE_API_TOKEN`.

## Commands

| Command | Does |
| --- | --- |
| `check` | Report drift. Exit 1 on drift or an unreviewed source, 2 on error. |
| `report` | Same output, exit 0 whatever it finds. |
| `seed` | Record current markers into the manifest. |
| `init` | Write a starter manifest. |

`-m, --manifest <path>` reads a different file. `--json` emits machine-readable
output.

`--verify-skills <glob>` also checks that every declared skill is on disk.
Without it, an entry left behind by a renamed or deleted skill keeps resolving
its upstream quite happily and nothing notices. Layouts differ, so name yours:
`--verify-skills 'skills/*'`, or `'plugins/*/skills/*'` where skills are nested.

The glob is relative to the manifest's own directory, and matches directories
only — a symlink to one counts. `*` stands for any run of characters within a
single path segment; there is no `**`, so a run of stars means the same as one,
and the depth of your layout is the depth you write. Nothing is hidden from it,
including dot-directories.

An unreviewed source — one with no `last-reviewed` yet — fails `check` rather
than passing, because a missing marker is not evidence that a skill is current.

`report` never fails on what it finds, but a mistake in how it was called — no
manifest, a glob matching nothing — still exits 2, because that is not a
finding.

## In CI

Opening the pull request is deliberately left to you, so the tool stays
host-agnostic. `--json` gives you what you need:

```yaml
- run: npx skill-sources check --json > drift.json
  continue-on-error: true
- run: npx skill-sources seed
- uses: peter-evans/create-pull-request@v6
  with:
    title: "Upstream sources have moved"
    body-path: drift.json
```

Review the change, decide whether each skill still says the right thing, and
merge to move the baseline forward. Accepting an upstream change as irrelevant
should be as cheap as acting on it — otherwise the gate gets routed around.

## Related work

[`skill-drift`](https://github.com/coskunarif/skill-drift) detects skills gone
stale against the codebase they describe. Same family, different axis: it
watches code in the same repository, this watches documents outside it.

[`nbp-skillforge`](https://github.com/nbpadilha/nbp-skillforge) composes skills
from shared bricks and gates on drift between a generated skill and its recipe.
Complementary — that drift is regenerable, this one is not.

Background and design rationale:
[agentskills#436](https://github.com/agentskills/agentskills/discussions/436).

## License

MIT
