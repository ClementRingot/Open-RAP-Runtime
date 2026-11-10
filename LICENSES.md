# Licences des dépendances

Règle du projet : uniquement des licences open source permissives (MIT, Apache-2.0, BSD,
PostgreSQL). Aucune bibliothèque SAP sous licence propriétaire (`@sap/cds`, SAPUI5, `sap.fe`,
SAP Developer License). Chaque dépendance est vérifiée sur le registre npm avant son ajout et
consignée ici. Ce dépôt est sous licence MIT ([LICENSE](LICENSE)).

Commande de contrôle : `pnpm licenses list --prod` (et `--dev`).

## Dépendances distribuées

### `@rap-transpiler/compiler`

| Paquet | Version | Licence | Usage | Vérifié le |
|---|---|---|---|---|
| `@abaplint/core` | 2.120.98 | MIT | Parsing ABAP et CDS, syntax check | 2026-11-09 |
| `@abaplint/transpiler` | 2.14.24 | MIT | Transpilation du behavior pool en JavaScript | 2026-11-09 |
| `chevrotain` | 13.2.0 | Apache-2.0 | Grammaires BDEF et SRVD | 2026-11-09 |
| `fast-xml-parser` | 5.12.0 | MIT | Lecture des XML abapGit (TABL, DTEL, DOMA, MSAG, SRVB) | 2026-11-09 |

Dépendances transitives (production) : `@chevrotain/*` (Apache-2.0), `source-map` (BSD-3-Clause),
`json5`, `vscode-languageserver-types`, `fast-xml-builder`, `strnum`, `anynum`,
`@nodable/entities`, `is-unsafe`, `path-expression-matcher`, `xml-naming` (MIT).

### `@rap-transpiler/model`

Aucune dépendance externe.

### `@rap-transpiler/runtime`

| Paquet | Version | Licence | Usage | Vérifié le |
|---|---|---|---|---|
| `fastify` | 5.12.8 | MIT | Serveur HTTP | 2026-11-09 |
| `kysely` | 0.29.8 | MIT | Construction de requêtes SQL paramétrées ; dialecte PGlite intégré | 2026-11-09 |
| `pg` | 8.23.1 | MIT | Pilote PostgreSQL | 2026-11-09 |
| `chevrotain` | 13.2.0 | Apache-2.0 | Grammaire des URL OData (`$filter`, `$orderby`, `$select`, `$expand`) | 2026-11-09 |
| `jose` | 6.2.16 | MIT | Vérification des JWT et JWKS (OIDC) | 2026-11-09 |
| `@abaplint/runtime` | 2.14.24 | MIT | Exécution du JavaScript transpilé de l'ABP (types et instructions ABAP) | 2026-11-09 |

Dépendances transitives (production) : MIT pour la plupart (`avvio`, `find-my-way`,
`fast-json-stringify`, `pino`, `ajv`…), plus `fast-uri`, `light-my-request`,
`secure-json-parse` (BSD-3-Clause) et `fastq`, `pg-int8`, `semver`, `split2` (ISC) ;
`temporal-polyfill`, `temporal-utils` (MIT) et `temporal-spec` (Apache-2.0), dépendances de
`@abaplint/runtime`.

Le socle ABAP « clean-room » généré dans chaque application (`if_abap_behv`,
`cl_abap_behavior_handler`, `cl_abap_context_info`, `zrap_eml`…) est écrit pour le projet à
partir des signatures publiques documentées par SAP ; aucun code SAP n'est copié. Il est sous la
licence MIT du dépôt.

### Interface générée (OpenUI5)

Dépendances des applications générées (J6) ; devDependencies de `@rap-transpiler/runtime` pour
ses tests.

| Paquet | Version | Licence | Usage | Vérifié le |
|---|---|---|---|---|
| `@openui5/sap.ui.core`, `sap.m`, `sap.f`, `sap.uxap`, `sap.ui.layout`, `sap.ui.unified` | 1.136.22 | Apache-2.0 | Bibliothèques OpenUI5 de l'UI | 2026-11-09 |
| `@openui5/themelib_sap_horizon` | 1.136.22 | Apache-2.0 | Thème SAP Horizon | 2026-11-09 |
| `less-openui5` | 0.12.0 | Apache-2.0 | Compilation des thèmes à la première demande (D27) | 2026-11-09 |

Dépendances transitives : `@adobe/css-tools` et `mime` (MIT).

## Outillage de développement (non distribué)

| Paquet | Version | Licence | Usage |
|---|---|---|---|
| `typescript` | 7.0.2 | Apache-2.0 | Compilation et typecheck |
| `vitest` | 5.1.0 | MIT | Tests (imposé par le cahier des charges) |
| `@types/node` | 22.20.5 | MIT | Types Node.js |
| `@electric-sql/pglite` | 0.5.16 | Apache-2.0 | PostgreSQL en processus (WASM) pour les tests (D18) |
| `@types/pg` | 8.x | MIT | Types de `pg` |
| `playwright` | 1.63 | Apache-2.0 | Tests de l'UI dans Chromium (pré-installé dans l'environnement de développement ; ajouté en J6 pour la CI) |

Dépendances transitives de développement : MIT pour la plupart, plus `picocolors` (ISC),
`source-map-js` (BSD-3-Clause), `detect-libc` et `expect-type` (Apache-2.0).

**Exception signalée : `lightningcss` 1.33.0, licence MPL-2.0.** C'est une dépendance de Vite,
lui-même requis par Vitest. Elle ne sert qu'à exécuter les tests ; elle n'est ni distribuée ni
liée au code du projet ou des applications générées. La MPL-2.0 est une licence open source à
copyleft limité aux fichiers de la bibliothèque elle-même, sans effet sur notre code.

## Ressources et outils hors npm

| Élément | Licence | Usage |
|---|---|---|
| PostgreSQL 16 | PostgreSQL License | Base de données des applications générées (à partir de J2) |
| Image `node:22-alpine` | Node.js : MIT ; Alpine : paquets libres | Base de l'image Docker de l'application générée |
| Image `postgres:16-alpine` | PostgreSQL License | Base de données du docker-compose généré |
| Image `quay.io/keycloak/keycloak:26.0` | Apache-2.0 | Fournisseur OIDC du profil `oidc` du docker-compose (non embarqué dans l'image de l'application) |
