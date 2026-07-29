# 0005 — Credentials arrive as environment variable names, never values

Status: accepted, 2026-07

## Context

The Confluence resolver needs an account email and API token. A pipeline
that already holds them exposes them under its own variable names, and
should not have to rename its secrets to suit this tool. Passing values on
the command line is out: an argument is visible in the process list and
lands in shell history.

## Decision

Flags name variables, not values — `--confluence-email-env` and
`--confluence-token-env` say *where* to look (defaulting to
`CONFLUENCE_EMAIL` and `CONFLUENCE_API_TOKEN`), and the values are read from
the environment at resolve time. A missing variable produces an error that
names the variables it looked for.

## Consequences

No secret ever appears in `argv`, the manifest, or the tool's output. The
pattern generalises to future resolvers that need credentials. The git
resolver needs none of this: it inherits whatever credential helpers the
caller's git already uses (ADR 0003).

## Alternatives considered

Values as flags (process-list leak), a config file (a second place secrets
live, and one more file to secure), fixed variable names only (forces
renames in pipelines that already have the secret under another name).
