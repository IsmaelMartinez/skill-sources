# 0004 — Markers are opaque comparable strings per source type

Status: accepted, 2026-07

## Context

Drift detection reduces to one question per source: is the marker resolved
today the same string a human last reviewed? Different upstream kinds have
different natural notions of "version", and the tool should not need to
understand any of them.

## Decision

A resolver's whole contract is turning a locator into an opaque, comparable
marker; markers are compared as strings and never interpreted. Per type: git
uses the SHA of the last commit touching the path (ADR 0003); `url` prefers
a strong `ETag`, falls back to `Last-Modified`, and falls back again to a
sha256 of the fetched body, with weak ETags deliberately skipped because
they promise only semantic equivalence, so two different documents can share
one; `confluence` uses the page's own version counter, which moves on
exactly the edits a human would call a change and not on re-renders. An
absent marker is its own status — `unreviewed` — reported separately so a
half-populated manifest cannot masquerade as everything being fine, and an
unresolvable source fails the gate rather than passing silently.

## Consequences

The type list is open: adding a source type is one resolver with no changes
to comparison, classification, or output. Dynamically assembled pages
produce noisy body hashes; that is a property of the page and the tool does
not try to hide it.

## Alternatives considered

Structured version objects with ordering (newer/older): richer reports, but
every type would need a total order that several upstreams simply do not
have. Interpreting markers also invites the tool to judge "how much" drifted,
which is the reviewer's call (ADR 0002).
