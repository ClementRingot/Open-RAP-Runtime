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
| J2 | Générateurs SQL (PostgreSQL) et `$metadata` (CSDL) | à faire |
| J3 | Runtime OData V4 en lecture | à faire |
| J4 | Écriture, runtime RAP managed, EML, behavior pool transpilé | à faire |
| J5 | UI OpenUI5 générée | à faire |
| J6 | Docker, OIDC, tests de bout en bout | à faire |

## Démarrage

Prérequis : Node.js 22+, pnpm 10.

```sh
pnpm install
pnpm build
pnpm test
node packages/compiler/dist/cli.js check fixtures/travel     # diagnostics
node packages/compiler/dist/cli.js ir fixtures/travel        # représentation intermédiaire (JSON)
```

Le dossier source est un export abapGit (`.abapgit.xml` et `src/`) ; la fixture de référence est
[fixtures/travel](fixtures/travel). Les codes de diagnostic sont décrits dans
[docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md).

## Organisation

```
packages/model/      types de l'IR (model.json), conventions de nommage partagées
packages/compiler/   CLI rapt, parsers, construction de l'IR, générateurs
packages/runtime/    runtime des applications générées (OData V4, RAP managed)
fixtures/travel/     BO de référence Travel / Booking (format abapGit)
```
