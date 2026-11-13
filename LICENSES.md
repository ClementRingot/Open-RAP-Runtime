# Licenses of the dependencies

Rule of the project: only permissive open source licenses (MIT, Apache-2.0, BSD, PostgreSQL). No
SAP library under a proprietary license (`@sap/cds`, SAPUI5, `sap.fe`, SAP Developer License).
Each dependency is checked on the npm registry before it is added and recorded here. This
repository is under the MIT license ([LICENSE](LICENSE)).

Check command: `pnpm licenses list --prod` (and `--dev`).

## Distributed dependencies

### `@open-rap/compiler`

| Package | Version | License | Use | Checked on |
|---|---|---|---|---|
| `@abaplint/core` | 2.120.98 | MIT | ABAP and CDS parsing, syntax check | 2026-11-09 |
| `@abaplint/transpiler` | 2.14.24 | MIT | Transpilation of the behavior pool to JavaScript | 2026-11-09 |
| `chevrotain` | 13.2.0 | Apache-2.0 | BDEF and SRVD grammars | 2026-11-09 |
| `fast-xml-parser` | 5.12.0 | MIT | Reading of the abapGit XML files (TABL, DTEL, DOMA, MSAG, SRVB) | 2026-11-09 |

Transitive dependencies (production): `@chevrotain/*` (Apache-2.0), `source-map`
(BSD-3-Clause), `json5`, `vscode-languageserver-types`, `fast-xml-builder`, `strnum`, `anynum`,
`@nodable/entities`, `is-unsafe`, `path-expression-matcher`, `xml-naming` (MIT).

### `@open-rap/model`

No external dependency.

### `@open-rap/runtime`

| Package | Version | License | Use | Checked on |
|---|---|---|---|---|
| `fastify` | 5.12.8 | MIT | HTTP server | 2026-11-09 |
| `kysely` | 0.29.8 | MIT | Building parameterized SQL queries; built-in PGlite dialect | 2026-11-09 |
| `pg` | 8.23.1 | MIT | PostgreSQL driver | 2026-11-09 |
| `chevrotain` | 13.2.0 | Apache-2.0 | Grammar of the OData URLs (`$filter`, `$orderby`, `$select`, `$expand`) | 2026-11-09 |
| `jose` | 6.2.16 | MIT | Verification of JWTs and JWKS (OIDC) | 2026-11-09 |
| `nodemailer` | 10.5.0 | MIT-0 | MIME composition and SMTP sending of the mails of `cl_bcs_mail_message` (D41) | 2026-11-11 |
| `@abaplint/runtime` | 2.14.24 | MIT | Execution of the transpiled JavaScript of the ABP (ABAP types and statements) | 2026-11-09 |
| `fast-xml-parser` | 5.12.0 | MIT | Reading of the `$metadata` of the remote OData services (client proxy, D31) | 2026-11-10 |

Transitive dependencies (production): MIT for most of them (`avvio`, `find-my-way`,
`fast-json-stringify`, `pino`, `ajv`…), plus `fast-uri`, `light-my-request`,
`secure-json-parse` (BSD-3-Clause) and `fastq`, `pg-int8`, `semver`, `split2` (ISC);
`temporal-polyfill`, `temporal-utils` (MIT) and `temporal-spec` (Apache-2.0), dependencies of
`@abaplint/runtime`; the dependencies of `fast-xml-parser` (`strnum`, `fast-xml-builder`,
`@nodable/entities`, `is-unsafe`, `path-expression-matcher`, `xml-naming`, MIT).

The "clean-room" ABAP base generated in each application (`if_abap_behv`,
`cl_abap_behavior_handler`, `cl_abap_context_info`, `zrap_eml`, HTTP client
`cl_web_http_client_manager` and client proxy `/iwbep/cl_cp_factory_remote`…) is written for the
project from the public signatures documented by SAP; no SAP code is copied. It is under the MIT
license of the repository.

### Generated UI (OpenUI5)

Dependencies of the generated applications (M6); devDependencies of `@open-rap/runtime`
for its tests.

| Package | Version | License | Use | Checked on |
|---|---|---|---|---|
| `@openui5/sap.ui.core`, `sap.m`, `sap.f`, `sap.uxap`, `sap.ui.layout`, `sap.ui.unified` | 1.136.22 | Apache-2.0 | OpenUI5 libraries of the UI | 2026-11-09 |
| `@openui5/themelib_sap_horizon` | 1.136.22 | Apache-2.0 | SAP Horizon theme | 2026-11-09 |
| `less-openui5` | 0.12.0 | Apache-2.0 | Compilation of the themes on the first request (D27) | 2026-11-09 |

Transitive dependencies: `@adobe/css-tools` and `mime` (MIT).

## Development tooling (not distributed)

| Package | Version | License | Use |
|---|---|---|---|
| `typescript` | 7.0.2 | Apache-2.0 | Compilation and typecheck |
| `vitest` | 5.1.0 | MIT | Tests (required by the specification) |
| `@types/node` | 22.20.5 | MIT | Node.js types |
| `@electric-sql/pglite` | 0.5.16 | Apache-2.0 | In-process PostgreSQL (WASM) for the tests (D18) |
| `@types/pg` | 8.x | MIT | Types of `pg` |
| `playwright` | 1.63 | Apache-2.0 | Tests of the UI in Chromium (pre-installed in the development environment; added in M6 for the CI) |
| `@changesets/cli` | 3.0.3 | MIT | Versions and changelogs of the packages (D77) |

Transitive development dependencies: MIT for most of them, plus `picocolors` and `yaml` (ISC),
`source-map-js` (BSD-3-Clause), `detect-libc` and `expect-type` (Apache-2.0).

**Reported exception: `lightningcss` 1.33.0, MPL-2.0 license.** It is a dependency of Vite,
itself required by Vitest. It is only used to run the tests; it is neither distributed nor linked
to the code of the project or of the generated applications. The MPL-2.0 is an open source
license whose copyleft is limited to the files of the library itself, without effect on our code.

## Resources and tools outside npm

| Item | License | Use |
|---|---|---|
| PostgreSQL 16 | PostgreSQL License | Database of the generated applications (from M2) |
| `node:22-alpine` image | Node.js: MIT; Alpine: free packages | Base of the Docker image of the generated application |
| `postgres:16-alpine` image | PostgreSQL License | Database of the generated docker-compose |
| `quay.io/keycloak/keycloak:26.0` image | Apache-2.0 | OIDC provider of the `oidc` profile of the docker-compose (not bundled in the image of the application) |

### VS Code extension (`packages/vscode`)

The `.vsix` redistributes the compiler, the runtime and their production dependencies, as well
as OpenUI5, `less-openui5` and PGlite for `rapt dev` (D39): all under the licenses listed above
(MIT, Apache-2.0…), with their license files in `rapt/node_modules`. Build tools only, not
redistributed:

| Component | Version | License | Use |
|---|---|---|---|
| `esbuild` | 0.28.2 | MIT | Single CommonJS file of the extension |
| `@vscode/vsce` | 4.1.0 | MIT | Building of the `.vsix`, publication to the Marketplace by trusted publishing (D78) |
| `@types/vscode` | 1.101.0 | MIT | Types of the VS Code API |
| `vscode-textmate`, `vscode-oniguruma` | 9.3.2, 2.0.1 | MIT | Tests of the grammars (the highlighting engine of VS Code) |

Syntax highlighting (`packages/vscode/syntaxes`):

| File | Origin | License | Checked on |
|---|---|---|---|
| `abap.tmLanguage`, `abap.language-configuration.json` | [larshp/vscode-abap](https://github.com/larshp/vscode-abap) (commit `3ff1891`), copied as is | MIT (© 2016 Lars Hvam, `LICENSE-vscode-abap.txt`) | 2026-11-11 |
| `abap-cds.tmLanguage.json`, `abap-bdef.tmLanguage.json`, `cds.language-configuration.json` | written for the project (CDS, metadata extensions, DCL, SRVD, tables as source; BDEF) | MIT of the repository | 2026-11-11 |

The existing CDS grammars were not reused: the one of SAP-samples/vscode-abap-cds is under
Apache-2.0 and its copy FreHu/abap-cds-grammar declares itself "Unlicense" without the origin
clearly allowing it.

### npm package `open-rap-runtime` (`packages/cli`)

The `rapt` command (D65): it depends on the packages above and on what `rapt dev` serves
(OpenUI5, `less-openui5`, PGlite, at the versions of the runtime, licenses listed above). No other
dependency.

### Website (`site/`)

Static HTML and CSS written for the project (MIT of the repository); the documentation pages are
rendered from `docs/` by the Markdown renderer of the compiler (`scripts/build-site.mjs`). No
external dependency, no font or script loaded from a third party.
