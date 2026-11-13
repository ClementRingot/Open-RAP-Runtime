# Changesets

Each pull request that changes what Open RAP Runtime ships (the sources of a package, the
documentation copied into the compiler, the dependencies of a published package) adds a changeset:

```sh
pnpm changeset          # choose the bump (patch, minor, major) and write one line for the changelog
```

The five packages (`open-rap-runtime`, `@open-rap/model`, `@open-rap/compiler`,
`@open-rap/runtime` and the VS Code extension) share one version: choosing any of them bumps all
of them. A change that should not be released records it with `pnpm changeset add --empty`.

On `main`, the *Changesets* workflow opens the *Version packages* pull request (versions,
changelogs); merging it releases the version (decision D77 of docs/DECISIONS.md, and
docs/DEPLOYMENT.md).
