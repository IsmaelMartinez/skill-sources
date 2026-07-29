# 0003 — Resolve git sources with plain git and blobless clones

Status: accepted, 2026-07

## Context

The marker for a git source is the last commit that touched one path —
file-level, not repository-level, so unrelated commits do not raise false
drift. Answering that needs history, not a snapshot. Host APIs (GitHub,
GitLab, Bitbucket) can answer it too, but each needs its own code path and
its own token.

## Decision

Shell out to `git`. Sources are cloned `--filter=blob:none --no-checkout`,
which keeps the commit and tree objects the question requires while leaving
file contents on the server — cost close to a shallow clone without losing
the path history that `--depth` would discard. For a branch or tag ref a
narrow `--single-branch` clone is tried first and widened only when needed;
a ref pinned to a commit SHA can only come from the wider clone. Clones are
memoised for the run and created in temporary directories that are removed
afterwards.

## Consequences

Any host, self-hosted included, over SSH or HTTPS, works with whatever
credentials the caller already has — no API tokens, no host-specific code.
The cost is a dependency on a `git` binary on PATH, and clone traffic that
an API call would avoid. Two known edges are tracked openly: cloning a
repository that is itself shallow misbehaves (CI checks out with
`fetch-depth: 0` for this reason), and a manifest naming one repository
under several refs clones it once per ref
([#17](https://github.com/IsmaelMartinez/skill-sources/issues/17)).

## Alternatives considered

Host APIs: fewer bytes moved, but a per-host matrix of authentication and
endpoints, and self-hosted instances become second-class. Full clones:
simpler, but linearly worse on large upstreams. Shallow clones: cheapest,
but `--depth` truncates exactly the path history the marker is made of.
