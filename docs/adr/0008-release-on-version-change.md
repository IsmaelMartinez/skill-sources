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

On every push to main, `release-on-version-change.yml` asks the npm registry
whether the `version` in `package.json` has already been published. When it
has not, the workflow creates the tag and the GitHub Release, then explicitly
dispatches `publish.yml`. Nothing else is consulted — no diff against the
previous commit, no tag lookup, no history at all.

That single question carries the whole decision because it is the only one
with consequences: a version already on npm can never be published again, so
"already public" and "nothing to release" are the same statement. Comparing
against the previous commit merely resembles it and is wrong in ordinary
cases — a push carrying several commits hides the bump behind its followers,
leaving both ends of the diff reading the new version and the release quietly
skipped. Tag lookups are no better, answering differently under
squash-versus-merge, a force-push that replays the bump, and a re-run of the
workflow itself. The registry answers all of those identically.

A registry that cannot answer is not a registry saying no. Only npm's
explicit E404 counts as "not published"; any other failure aborts the run,
because reading an outage as "unpublished" would tag and re-announce a
release that already shipped. Creating the release is likewise treated as resumable rather than
one-shot: an existing release for the tag is adopted and the run continues to
the dispatch, so an attempt that tagged and then died is repaired by the next
run instead of failing on its own leftovers.

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
The dispatch is also fire-and-forget — `gh workflow run` reports success once
the request is accepted, so a `publish.yml` run that never starts or that
fails leaves this workflow green and the failure visible only in Actions.

## Alternatives considered

Triggering on a pushed tag, which works but puts the manual step back and
lets tag and manifest disagree. A release bot (release-please, changesets),
which brings a changelog and a config surface out of proportion to a
single-package repository. And moving `npm publish` into this workflow, which
would silently break trusted publishing for the reason above.
