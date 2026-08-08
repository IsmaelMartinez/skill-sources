# 0007 — Publish from CI with OIDC trusted publishing

Status: accepted, 2026-07

## Context

The 2025 npm supply-chain attacks were built on stolen long-lived tokens,
and npm responded by revoking classic tokens, clamping granular-token
lifetimes, and recommending OIDC trusted publishing. A package like this one
— run via `npx` inside other people's CI — owes its consumers a publishing
path with no standing credential to steal.

## Decision

Publishing happens only from GitHub Actions (`publish.yml`, on a published
release or manual dispatch), never from a developer machine. The workflow
runs the test suite, then `npm publish --provenance` authenticated by the
Actions OIDC token against a trusted publisher configured on npmjs.com. A
trusted publisher cannot create a brand-new package, so the first-ever
publish bootstraps with a short-lived granular token that is deleted as soon
as the trusted publisher exists.

## Consequences

No long-lived npm credential exists anywhere, and every published version
carries a public provenance attestation tying it to the exact workflow run
and commit. The workflow needs `id-token: write` and npm ≥ 11.5.1, which the
job installs explicitly rather than inferring from the Node version — the
reason sits next to the install step.

## Alternatives considered

Publishing locally (explicitly ruled out), and a long-lived automation token
in repository secrets — the pre-2025 default, and precisely the artefact the
attacks monetised.
