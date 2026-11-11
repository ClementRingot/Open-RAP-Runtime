# AGENTS.md — travailler sur rap-transpiler

Instructions pour les agents IA (et les humains) qui modifient ce dépôt. Pour **utiliser**
rap-transpiler dans un projet RAP, voir la section 13 du [guide](docs/GUIDE.md) ; `rapt new` écrit
aussi un `AGENTS.md` dans les projets qu'il crée.

## Le projet en bref

Compilateur TypeScript (monorepo pnpm) qui transforme les sources d'un BO RAP (format abapGit) en
application Node.js : OData V4, runtime RAP managed, ABAP transpilé par abaplint, PostgreSQL, UI
OpenUI5. Lire d'abord [README.md](README.md), [docs/GUIDE.md](docs/GUIDE.md) et la liste des
décisions [docs/DECISIONS.md](docs/DECISIONS.md) (D1 à D55).

```
packages/model/      types de l'IR (model.json) et dérivations partagées (OData, value helps, MCP)
packages/compiler/   CLI rapt (src/cli.ts), parsers (bdef/, cds/, srvd/, dcl/, ddic/), IR (ir/),
                     générateurs (gen/ : sql, csdl, abap, ui, launchpad, docs, mcp, app),
                     création d'objets (authoring/ : new, generate, abapgit, mcp), standard/ (vues SAP)
packages/runtime/    serveur Fastify (app.ts, server.ts), OData (odata/), RAP (rap/), ABAP (abap/),
                     auth (auth/), launchpad (launchpad/), MCP (mcp/), UI (ui/), platform.ts
packages/vscode/     extension VS Code : appelle la CLI avec --json, ne compile rien
fixtures/travel      BO de référence (doit rester importable et activable sur SAP)
fixtures/custom-entity   entité custom, mode enhanced
fixtures/table-entity    BO sur une table entity, types simples et énumérés, mode enhanced
```

## Commandes

```sh
pnpm install
pnpm build          # tsc de chaque paquet ; le compilateur copie aussi docs/ dans packages/compiler/docs
pnpm typecheck
pnpm test           # vitest, ~3 min ; tests navigateur avec Playwright s'il est installé
npx vitest run packages/compiler/test/ui.test.ts      # un fichier
node packages/compiler/dist/cli.js check fixtures/travel
node packages/compiler/dist/cli.js dev fixtures/travel --port 8081
```

Les tests du runtime importent `@rap-transpiler/compiler` construit : `pnpm build` avant de les
lancer après une modification du compilateur.

## Règles

1. **Comportement de SAP d'abord.** En mode `standard`, une source se comporte comme sur SAP ;
   une différence volontaire va en mode `enhanced` (D45) ou dans [KNOWN_GAPS.md](KNOWN_GAPS.md).
2. **Aucune bibliothèque SAP propriétaire** (ni SAPUI5, ni `sap.fe`, ni `sap.ushell`, ni CAP) ;
   dépendances sous licences permissives, listées dans [LICENSES.md](LICENSES.md), versions
   épinglées.
3. **Ne pas contourner abaplint** : une fonctionnalité ABAP que le transpiler ne traite pas se
   documente dans KNOWN_GAPS.md (avec le contournement) plutôt que d'être bricolée.
4. **Une décision par fonctionnalité** : ajouter une entrée `Dnn` à docs/DECISIONS.md (contexte,
   décision, pourquoi, tests), mettre à jour docs/FEATURES.md, docs/DIAGNOSTICS.md (nouveaux
   codes), KNOWN_GAPS.md et le guide.
5. **Diagnostics positionnés** : `fichier:ligne:colonne`, un code par problème (`CDS0xx`,
   `BDEF0xx`, `ABP0xx`…), sévérité juste ; jamais d'exception non rattrapée sur une source fausse.
6. **Tests** : chaque fonctionnalité a ses tests (compilateur et runtime ; navigateur pour l'UI).
   Les variantes de la fixture passent par `generatedVariant` / `fixtureVariant` plutôt que de
   modifier `fixtures/travel` (dont les snapshots servent de référence).
7. **UI générée** : JavaScript ES5 dans des chaînes TypeScript (`gen/ui/static.ts`) ; attention à
   l'échappement (`\\d` dans le TS donne `\d` dans le JS). Les ids de contrôles sont utilisés par
   les tests navigateur.
8. **Documentation en français**, code et commentaires en anglais ; le README des applications
   générées est en anglais.
9. **Fichiers générés** : ne jamais éditer `.rapt/`, `dist/`, `packages/compiler/docs/`, ni les
   objets virtuels `<standard>/…` (vues standards, D44).

## Ajouter une fonctionnalité, en pratique

- Type CDS (DRTY) : `ddic/cds-types.ts` puis `ir/dictionary.ts` (comme un élément de données).
- Construction CDS ou BDEF : parser (`cds/adapter.ts`, `bdef/parser.ts`) → IR (`ir/`) → modèle
  (`packages/model`) → générateurs et runtime → tests → documentation.
- Classe ABAP Cloud libérée : implémentation clean-room dans `gen/abap/framework-*.ts` (signatures
  publiques de SAP), noyau JavaScript dans `runtime/src/abap/` si nécessaire (D24, D40).
- Annotation UI : `gen/ui/layout.ts` (layout.json), puis vues (`views.ts`) et contrôleurs
  (`static.ts`).
- Commande de la CLI : `cli.ts` (usage, options, `--json`), puis la commande VS Code
  (`packages/vscode/src/extension.ts`, `package.json`).
