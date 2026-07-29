# 0002 — Report drift, never rewrite skills

Status: accepted, 2026-07

## Context

Once drift is detected, the tempting next feature is closing the loop:
re-generate the skill from its upstream. But a skill is a human distillation
of a source document into something an agent can act on. A tool that rewrote
it automatically would launder that judgement away, and its output would be
trusted precisely because a tool produced it.

## Decision

The tool reports; it never rewrites. Drift opens a review. The only thing
`seed` ever writes is the `last-reviewed` marker in the manifest — after a
human has decided the skill is still accurate (or has updated it), the marker
moves forward to close the loop.

## Consequences

Accepting an upstream change as irrelevant must be as cheap as updating the
skill, or reviewers will route around the tool — this is why `seed` exists
as a first-class command. The write path to skill files is not just unbuilt
but deliberately out of scope, which keeps the tool safe to run from CI with
no permissions beyond reading the manifest.

## Alternatives considered

Build-time composition (as in nbp-skillforge), where regeneration is exactly
the point: correct for skills assembled from bricks, wrong for skills that
embody editorial judgement. The two are complementary, not competing.
