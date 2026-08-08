# 0008 — Release when the version number changes

Status: accepted, 2026-08

## Context

Merging to main is not the same event as releasing. Docs fixes, refactors
and Dependabot bumps land continuously, and cutting a release for each one
would burn version numbers and push consumers a stream of changes nobody
asked for. The opposite failure is worse: a release step that only ever runs
by hand quietly stops running, and the registry drifts behind main.

What is wanted is batching by default with a deliberate, in-repo signal for
"this batch is a release" — and the signal already exists, because a release
requires bumping `version` in `package.json` anyway.

## Decision

On every push to main, `release-on-version-change.yml` compares `version`
against the same field in the parent commit. When it has changed and that
version is not already on the npm registry, the workflow creates the tag and
the GitHub Release, then explicitly dispatches `publish.yml`.

Idempotency comes from asking the registry, not from reading git history.
"Is there a tag for this?" answers differently under squash-versus-merge, a
force-push that replays the bump commit, and a re-run of the workflow itself;
"is this version already public?" answers all three identically, and is the
only question with consequences.

The dispatch is not redundant with the release event. GitHub does not trigger
workflows from events created with the default `GITHUB_TOKEN`, so the
`release: [published]` trigger in `publish.yml` never fires here;
`workflow_dispatch` is one of the documented exceptions. Publishing stays in
`publish.yml` because npm's trusted publisher matches on that filename
(ADR 0007) — an `npm publish` in any other workflow file cannot authenticate.

## Consequences

Releasing costs one line in a pull request, and the version bump becomes the
reviewable statement of intent. The corollary is that a bump merged for any
other reason releases; there is no second confirmation. This workflow needs
`contents: write` and `actions: write`, where the rest of CI is read-only.

## Alternatives considered

Triggering on a pushed tag, which works but puts the manual step back and
lets tag and manifest disagree. A release bot (release-please, changesets),
which brings a changelog and a config surface out of proportion to a
single-package repository. And moving `npm publish` into this workflow, which
would silently break trusted publishing for the reason above.
