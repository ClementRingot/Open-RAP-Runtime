# AGENTS.md — working on Open RAP Runtime

Instructions for the AI agents (and the humans) who change this repository. To **use**
Open RAP Runtime in a RAP project, see section 13 of the [guide](docs/GUIDE.md); `rapt new` also
writes an `AGENTS.md` in the projects it creates.

## The project in short

A TypeScript compiler (pnpm monorepo) that turns the sources of a RAP BO (abapGit format) into a
Node.js application: OData V4, RAP managed runtime, ABAP transpiled by abaplint, PostgreSQL,
OpenUI5 UI. Read [README.md](README.md), [docs/GUIDE.md](docs/GUIDE.md) and the list of decisions
[docs/DECISIONS.md](docs/DECISIONS.md) (D1 to D78) first.

```
packages/model/      types of the IR (model.json) and shared derivations (OData, value helps, MCP)
packages/compiler/   rapt CLI (src/cli.ts), parsers (bdef/, cds/, srvd/, dcl/, ddic/), IR (ir/),
                     generators (gen/: sql, csdl, abap, ui, launchpad, docs, mcp, app),
                     object creation (authoring/: new, generate, abapgit, mcp), standard/ (SAP views)
packages/runtime/    Fastify server (app.ts, server.ts), OData (odata/), RAP (rap/), ABAP (abap/),
                     auth (auth/), launchpad (launchpad/), MCP (mcp/), UI (ui/), platform.ts
packages/vscode/     VS Code extension: calls the CLI with --json, compiles nothing
packages/cli/        npm package open-rap-runtime: the rapt command with what rapt dev needs
fixtures/travel      reference BO (must stay importable and activatable on SAP)
fixtures/custom-entity   custom entity, enhanced mode
fixtures/table-entity    BO on a table entity, simple and enumerated types, enhanced mode
site/                    project website (GitHub Pages, site.yml workflow, docs rendered by scripts/build-site.mjs)
```

## Commands

```sh
pnpm install
pnpm build          # tsc of each package; the compiler also copies docs/ into packages/compiler/docs
pnpm typecheck
pnpm test           # vitest, ~3 min; browser tests with Playwright when it is installed
npx vitest run packages/compiler/test/ui.test.ts      # one file
node packages/compiler/dist/cli.js check fixtures/travel
node packages/compiler/dist/cli.js dev fixtures/travel --port 8081
node scripts/build-site.mjs _site                     # the website, with the documentation pages
pnpm changeset      # the changeset of a pull request: the bump and its line in the changelog (D77)
pnpm check:version  # one version in every file that carries it
```

The runtime tests import the built `@open-rap/compiler`: run `pnpm build` before running them
after a change to the compiler.

## Rules

1. **SAP behavior first.** In `standard` mode, a source behaves as on SAP; a deliberate
   difference goes to the `enhanced` mode (D45) or into [KNOWN_GAPS.md](KNOWN_GAPS.md).
2. **No proprietary SAP library** (no SAPUI5, no `sap.fe`, no `sap.ushell`, no CAP);
   dependencies under permissive licenses, listed in [LICENSES.md](LICENSES.md), pinned versions.
3. **Do not work around abaplint**: an ABAP feature the transpiler does not handle is documented
   in KNOWN_GAPS.md (with the workaround) rather than patched.
4. **One decision per feature**: add a `Dnn` entry to docs/DECISIONS.md (context, decision, why,
   tests), update docs/FEATURES.md, docs/DIAGNOSTICS.md (new codes), KNOWN_GAPS.md and the guide.
5. **Positioned diagnostics**: `file:line:column`, one code per problem (`CDS0xx`, `BDEF0xx`,
   `ABP0xx`…), the right severity; never an uncaught exception on a wrong source.
6. **Tests**: each feature has its tests (compiler and runtime; browser for the UI). Variants of
   the fixture go through `generatedVariant` / `fixtureVariant` rather than changing
   `fixtures/travel` (whose snapshots are the reference).
7. **Generated UI**: ES5 JavaScript in TypeScript strings (`gen/ui/static.ts`); mind the escaping
   (`\\d` in the TS gives `\d` in the JS). The ids of the controls are used by the browser tests.
8. **Everything in English**: documentation, website, code, comments, messages, the README of
   the generated applications, and everything around the repository: commit messages, branch
   names, pull requests (title, description, review comments), issues and release notes.
9. **Generated files**: never edit `.rapt/`, `dist/`, `packages/compiler/docs/`, nor the virtual
   objects `<standard>/…` (standard views, D44).
10. **Versions** (D77): never change a version by hand. A pull request that changes what ships
    (sources of a package, `docs/`, the dependencies of a published package) adds a changeset
    (`pnpm changeset`: `patch` for a fix, `minor` for a feature; one line in English for the
    changelog), or `pnpm changeset add --empty` when it must not be released; the CI checks it.
    The *Version packages* pull request bumps the versions, its merge releases.

## Adding a feature, in practice

- CDS type (DRTY): `ddic/cds-types.ts` then `ir/dictionary.ts` (like a data element).
- CDS or BDEF construct: parser (`cds/adapter.ts`, `bdef/parser.ts`) → IR (`ir/`) → model
  (`packages/model`) → generators and runtime → tests → documentation.
- Released ABAP Cloud class: clean-room implementation in `gen/abap/framework-*.ts` (public
  signatures of SAP), JavaScript kernel in `runtime/src/abap/` when needed (D24, D40).
- UI annotation: `gen/ui/layout.ts` (layout.json), then views (`views.ts`) and controllers
  (`static.ts`).
- CLI command: `cli.ts` (usage, options, `--json`), then the VS Code command
  (`packages/vscode/src/extension.ts`, `package.json`), and the tool of `rapt agent` when an agent
  needs it (`compiler/src/agent/server.ts`).
