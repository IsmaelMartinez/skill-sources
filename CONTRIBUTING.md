# Contributing

Thanks for your interest in improving skill-sources.

The project needs Node 20 or later. Clone the repository, run `npm ci`, and
you have everything: `npm test` runs the vitest suite, and `npm run format`
keeps the code in Prettier's style (`npm run format:check` is what CI runs).

Before opening a pull request, please make sure the tests and the format
check pass. New behaviour should come with a test — the suite is the only
thing standing between the resolvers and regressions, since some of the
upstreams they talk to (Confluence, plain URLs) are only covered by mocked
fetches.

For anything larger than a small fix, open an issue first so we can talk it
through. The design rationale for the single-manifest convention lives in
[CONVENTION.md](CONVENTION.md) and is worth reading before proposing changes
to the manifest format.
