# 0006 — A hand-rolled linear-time glob matcher

Status: accepted, 2026-07

## Context

`--verify-skills` takes a user-supplied glob. The obvious implementation
turns it into a regular expression, but each `*` becomes `[^/]*`, and a
segment carrying several of those makes the engine try every way of
splitting the name between them — `a*a*a*a*a*a*a*a*a*a*z` against a
forty-character directory name took seven seconds, and a run of bare stars
far worse. A glob is attacker-adjacent input in CI, and a matcher that can
be made quadratic (or worse) is a denial-of-service surface.

## Decision

Match by walking the pattern and the name once, remembering only the last
`*` to fall back to, so cost stays proportional to the strings' lengths.
The dialect is deliberately small: only `*`, only within a path segment —
skill layouts are a fixed depth below the root, so that is the whole of what
a layout needs to say. A glob that matches no directories is an error rather
than a report that every skill is unknown, because that output reads as a
catastrophe when it is actually a typo.

## Consequences

No pathological inputs, no regex dependency, and the dialect's limits are
documented behaviour rather than accident. Anyone extending the pattern
language must preserve the linear-time property.

## Alternatives considered

Regex compilation (the measured seven-second case above), and a glob
library — a dependency with a far larger dialect than layouts need, whose
own complexity guarantees would then need auditing.
