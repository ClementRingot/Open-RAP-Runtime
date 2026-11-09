# rap-transpiler

Compilateur open source qui transforme les sources d'un business object RAP (tables, vues CDS,
métadonnées d'extension, BDEF, behavior pool ABAP, définition de service), exportées au format
abapGit, en une application Node.js autonome : service OData V4, base PostgreSQL, interface
OpenUI5 de type List Report / Object Page, sans système SAP.

- 100 % open source, licences permissives ([LICENSES.md](LICENSES.md)) ; aucune bibliothèque SAP
  propriétaire (ni CAP, ni SAPUI5, ni `sap.fe`).
- Cible : un BO RAP **managed non-draft** complet ([docs/FEATURES.md](docs/FEATURES.md)).
- Plan, choix techniques et décisions : [PLAN.md](PLAN.md), [docs/DECISIONS.md](docs/DECISIONS.md).
- Écarts connus : [KNOWN_GAPS.md](KNOWN_GAPS.md).

## État

| Jalon | Contenu | État |
|---|---|---|
| J1 | Parser BDEF (Chevrotain), parser SRVD, adaptateur CDS (abaplint), IR, `rapt check`, `rapt ir` | fait |
| J2 | Générateurs SQL (PostgreSQL) et `$metadata` (CSDL), `rapt build` | fait |
| J3 | Runtime OData V4 en lecture (Fastify, `$batch`, CSRF, OIDC Bearer) | fait |
| J4 | Écriture, runtime RAP managed, EML, behavior pool transpilé | fait |
| J5 | UI OpenUI5 générée (List Report, Object Page) | fait |
| J6 | Docker, OIDC, tests de bout en bout | à faire |

## Démarrage

Prérequis : Node.js 22+, pnpm 10.

```sh
pnpm install
pnpm build
pnpm test
node packages/compiler/dist/cli.js check fixtures/travel     # diagnostics
node packages/compiler/dist/cli.js ir fixtures/travel        # représentation intermédiaire (JSON)
node packages/compiler/dist/cli.js build fixtures/travel --out out/travel   # application générée
```

Le dossier source est un export abapGit (`.abapgit.xml` et `src/`) ; la fixture de référence est
[fixtures/travel](fixtures/travel). Les codes de diagnostic sont décrits dans
[docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md).

## Application générée (`rapt build`)

```
model/model.json     IR lue par le runtime
db/schema.sql        tables et vues PostgreSQL
odata/metadata.xml   $metadata (CSDL avec annotations UI)
abap/*.mjs           behavior pool transpilé (abap/init.mjs charge l'ensemble)
abap/src/            ABAP donné au transpiler : sources réécrites, types dérivés, socle clean-room
ui/                  UI OpenUI5 : List Report et Object Pages générées depuis les annotations @UI
```

Le behavior pool est réécrit avant transpilation : types dérivés de la BDEF, signatures des
handlers, EML abaissé vers la classe noyau `ZRAP_EML` (décision D2). Les diagnostics ABAP
(ABP004 à ABP008) pointent sur les lignes des sources d'origine.

## Organisation

```
packages/model/      types de l'IR (model.json), conventions de nommage partagées
packages/compiler/   CLI rapt, parsers, construction de l'IR, générateurs
packages/runtime/    runtime des applications générées (OData V4, RAP managed)
fixtures/travel/     BO de référence Travel / Booking (format abapGit)
```
