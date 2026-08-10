# Examples

Three manifests, each showing one thing the format has to be able to say. They
use illustrative addresses and demonstrate shape rather than live resolution.

If you want to see the tool actually work, the manifest to read is not in here:
it is [`skill-sources.yml`](../skill-sources.yml) at the repository root, which
declares this repository's own skill against the Agent Skills specification it
was distilled from. That one resolves, and a scheduled workflow runs it weekly,
so it is checked rather than asserted:

```console
$ npx skill-sources check --verify-skills 'skills/*'
  fresh      agent-skills-frontmatter  git:https://github.com/agentskills/agentskills.git@main:docs/specification.mdx

1 fresh
```

The marker was recorded with `skill-sources seed`, which is how you start the
clock on any source.

[`minimal.yml`](minimal.yml) is the smallest useful manifest: one skill, one git
upstream, one recorded marker. If you are adding this to a repository with a
single skill, it is very close to the whole of what you need.

[`all-source-types.yml`](all-source-types.yml) exercises `git`, `url` and
`confluence` together, and covers the two cases the minimal file cannot show — a
skill distilled from more than one document, where each upstream drifts
independently, and an entry with no `last-reviewed` yet. That last one is worth
reading before you run anything, because an unreviewed source fails `check`
rather than passing it. A missing marker is not evidence that a skill is
current, only that nobody has said so.

[`nested-layout.yml`](nested-layout.yml) is for repositories whose skills live
inside plugins rather than one flat directory. The manifest shape is unchanged;
what changes is the glob you pass to `--verify-skills`, which has to match your
layout's actual depth.

## Running them

`report` is the one to reach for here, because it prints what it finds and exits
zero whatever that is:

```console
$ npx skill-sources report -m examples/all-source-types.yml
```

`check` is the CI form and exits 1 on drift, on an unreviewed source, on a path
that has gone, or on a skill that is not on disk:

```console
$ npx skill-sources check -m examples/nested-layout.yml \
    --verify-skills 'plugins/*/skills/*'
```

One thing to expect. The upstreams named here are illustrative addresses on
`example.com` and `github.com/example`, and they do not resolve — `report`
against them prints an `error` line for each, which is itself worth seeing,
since it is what a genuine outage or a revoked credential looks like. These
three demonstrate that the manifest parses and how failures are reported; the
root manifest is the one that demonstrates drift detection.

Every file here is validated by `test/examples.test.js` against the real
manifest parser, so if the schema moves and these are not updated with it, the
suite fails.
