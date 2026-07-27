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
| `report` | Same output, always exit 0. |
| `seed` | Record current markers into the manifest. |
| `init` | Write a starter manifest. |

`-m, --manifest <path>` reads a different file. `--json` emits machine-readable
output.

An unreviewed source — one with no `last-reviewed` yet — fails `check` rather
than passing, because a missing marker is not evidence that a skill is current.

## In CI

Opening the pull request is deliberately left to you, so the tool stays
host-agnostic. `--json` gives you what you need.

### Reaching a private upstream

The repository being watched is not the repository the job runs in, and a
checkout token scoped to the current project grants nothing against it. Git
sources are resolved by running `git clone`, with whatever credentials git is
already configured with — the tool carries no token of its own. So a runner
starts with no way in, and the first run fails on an access error that does not
obviously point at its cause.

Give the runner either a read-only SSH deploy key, or an HTTPS token. Put the
token in git's own configuration rather than in the manifest, rewriting the
upstream URL with `insteadOf`, and the file you commit stays free of
credentials.

Confluence is the exception: it goes through the Confluence REST API rather
than git, so it needs `CONFLUENCE_EMAIL` and `CONFLUENCE_API_TOKEN` in the job
environment whatever you do about git.

### GitHub Actions

```yaml
name: skill sources
on:
  schedule: [{ cron: "0 6 * * 1" }]
  workflow_dispatch:

jobs:
  drift:
    runs-on: ubuntu-latest
    # The workflow token is read-only by default, and opening the pull request
    # also needs "Allow GitHub Actions to create and approve pull requests" in
    # the repository or organisation settings.
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22

      # Only needed for a private upstream. Omit for public ones. Scoped to the
      # upstream org, so this does not rewrite the URL of the repository being
      # checked out or the one the pull request is pushed to.
      - name: Authenticate to the upstream
        env:
          UPSTREAM_TOKEN: ${{ secrets.UPSTREAM_TOKEN }}
        run: |
          git config --global \
            url."https://x-access-token:${UPSTREAM_TOKEN}@github.com/upstream-org/".insteadOf \
            "https://github.com/upstream-org/"

      # Both steps fail by design — check on drift, seed when it leaves a gone
      # path alone — and the pull request is the whole point of the run.
      - run: npx skill-sources check --json > drift.json
        continue-on-error: true
        env:
          CONFLUENCE_EMAIL: ${{ secrets.CONFLUENCE_EMAIL }}
          CONFLUENCE_API_TOKEN: ${{ secrets.CONFLUENCE_API_TOKEN }}

      - run: npx skill-sources seed
        continue-on-error: true
        env:
          CONFLUENCE_EMAIL: ${{ secrets.CONFLUENCE_EMAIL }}
          CONFLUENCE_API_TOKEN: ${{ secrets.CONFLUENCE_API_TOKEN }}

      - uses: peter-evans/create-pull-request@v6
        with:
          title: "Upstream sources have moved"
          body-path: drift.json
```

For a deploy key instead of a token, write the key to `~/.ssh` and add the
upstream host to `known_hosts` before the check step:

```yaml
      - name: Authenticate to the upstream
        env:
          DEPLOY_KEY: ${{ secrets.UPSTREAM_DEPLOY_KEY }}
        run: |
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          printf '%s\n' "$DEPLOY_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          ssh-keyscan github.com >> ~/.ssh/known_hosts
```

### GitLab CI

```yaml
skill-sources:
  image: node:22
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  before_script:
    # A masked variable holding a token with read_repository on the repository
    # being watched, not on this one. CONFLUENCE_* are masked variables too.
    # Scoped to the upstream group so the job's own checkout is left alone.
    - git config --global url."https://oauth2:${UPSTREAM_TOKEN}@gitlab.com/upstream-group/".insteadOf "https://gitlab.com/upstream-group/"
  script:
    - npx skill-sources check --json > drift.json
  artifacts:
    when: always
    paths: [drift.json]
```

The job fails on drift, which is the point of a gate. To have it open a merge
request instead, run `report --json` so it always succeeds, then `seed`, then
push a branch and call the MR API — the same shape as the Actions example.

Review the change either way, decide whether each skill still says the right
thing, and merge to move the baseline forward. Accepting an upstream change as
irrelevant should be as cheap as acting on it — otherwise the gate gets routed
around.

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
