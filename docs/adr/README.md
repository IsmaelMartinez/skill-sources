# Architecture decision records

One file per decision, numbered in the order they were made, in a light
[MADR](https://adr.github.io/madr/) shape: context, decision, consequences,
and the alternatives that were considered. A record is history, not
documentation — when a decision is reversed, a new record supersedes the old
one rather than editing it.

Much of the rationale here first lived as comments next to the code it
justifies, which remain the fine-grained source of truth. These records
collect the decisions that shape the whole tool, so a reviewer can read the
architecture without reading the source.

- [0001 — One manifest at the repository root](0001-single-root-manifest.md)
- [0002 — Report drift, never rewrite skills](0002-report-only-never-rewrite.md)
- [0003 — Resolve git sources with plain git and blobless clones](0003-git-resolution-via-plain-git.md)
- [0004 — Markers are opaque comparable strings per source type](0004-marker-semantics-per-source-type.md)
- [0005 — Credentials arrive as environment variable names, never values](0005-credentials-as-env-var-names.md)
- [0006 — A hand-rolled linear-time glob matcher](0006-linear-time-glob-matcher.md)
- [0007 — Publish from CI with OIDC trusted publishing](0007-publish-via-oidc-trusted-publishing.md)
- [0008 — Release when the version number changes](0008-release-on-version-change.md)
