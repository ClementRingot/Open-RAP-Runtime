# rap-transpiler

**Développez, testez et déployez vos business objects RAP sans système SAP.**

Vous écrivez votre BO RAP comme dans les ABAP Development Tools — tables, vues CDS, annotations UI,
behavior definition, behavior pool en ABAP, service — et rap-transpiler en fait une application
qui tourne partout : un service OData V4, le runtime RAP managed avec votre code ABAP, une base
PostgreSQL et une interface List Report / Object Page en OpenUI5. Les mêmes sources s'importent
ensuite dans SAP avec abapGit.

![List Report généré](docs/images/list-report.png)

## À quoi ça sert

- **Apprendre et enseigner RAP** sans licence ni système : le cycle complet BDEF → behavior pool →
  OData → Fiori, en local, en quelques secondes.
- **Prototyper** un BO et le montrer à un client ou à un métier avant d'ouvrir un système.
- **Tester** la logique d'un BO (déterminations, validations, actions, autorisations) en CI.
- **Livrer une petite application autonome** (Docker, SAP BTP Cloud Foundry, un serveur interne)
  quand un système SAP n'est pas justifié.
- **Ouvrir le BO aux agents IA** : le service devient un serveur MCP dont chaque outil applique
  les contrôles du BO.

Tout est open source et sous licences permissives : ni CAP, ni SAPUI5, ni bibliothèque SAP
propriétaire ([LICENSES.md](LICENSES.md)).

## Démarrer en deux minutes

**Dans VS Code** : installer l'extension `rap-transpiler-vscode.vsix` (elle contient tout), puis
*RAP : Nouveau business object* et *RAP : Lancer rapt dev*. Le navigateur s'ouvre sur le
launchpad de développement.

**En ligne de commande** (Node.js 22, depuis un clone : `pnpm install && pnpm build`, puis
`node packages/compiler/dist/cli.js` à la place de `rapt`) :

```sh
rapt new mon-projet Travel --prefix ZRT    # un BO managed complet, avec des données
rapt dev mon-projet                         # http://localhost:8080/ — rechargé à chaque enregistrement
```

![Launchpad de développement](docs/images/dev-launchpad.png)

## Ce que vous obtenez

| Vous écrivez (format abapGit) | rap-transpiler produit |
|---|---|
| Tables (`define table`, comme dans ADT) | Tables PostgreSQL, données initiales |
| Vues CDS, projections, DCL | Vues SQL, `$metadata` OData V4, contrôles d'accès par utilisateur |
| Metadata extensions (`@UI`) | List Report (filtres Fiori, vues de l'utilisateur, value helps) et Object Page |
| Behavior definition | Runtime RAP managed : verrous, ETags, numérotation, autorisations, feature control, déterminations, validations, actions |
| Behavior pool (ABAP Cloud) | Le même code, transpilé et exécuté : EML, messages, ABAP SQL, classes libérées (JSON, HTTP, bgPF, e-mail…) |
| Définition de service | Service OData V4 aux chemins de SAP, `$batch`, CSRF, OIDC |
| `rapt/mcp.json` | Serveur MCP pour les agents IA |
| `launchpad.json` | Launchpad OpenUI5 : spaces, pages, tuiles par rôle, connexion unique |

![Object Page en édition](docs/images/object-page.png)

## Fonctionnalités clés

- **Écrire seulement de l'ABAP** : `rapt new` (un BO complet), `rapt generate` (une table, une vue
  depuis sa table, une projection, une BDEF avec ses compositions, un behavior pool…),
  `rapt abapgit` (les XML pour l'import dans SAP).
- **Boucle de développement** `rapt dev` : base embarquée, reconstruction à chaque enregistrement,
  diagnostics positionnés (`fichier:ligne:colonne`), launchpad de développement avec la
  documentation intégrée.
- **Modes** : `standard` (strictement comme SAP, activable sur SAP) ou `enhanced` (extensions :
  champs obligatoires contrôlés automatiquement, BO managed sur entité custom).
- **Vues standards** `I_Currency`, `I_UnitOfMeasure`, `I_Country`, `I_Language` avec leurs
  données, pour vos value helps.
- **UI Fiori** : filtres avec conditions (`>100`, `1...5`, `*abc*`), vues enregistrées par
  utilisateur, paramètres du tableau, aide à la saisie, actions, compositions éditables.
- **Sécurité** : OIDC (Keycloak, SAP Cloud Identity Services, Entra ID…), objets d'autorisation et
  `AUTHORITY-CHECK`, DCL, rôles.
- **Déploiement** : Docker, `docker compose`, SAP BTP Cloud Foundry (`cf push`), n'importe quel
  serveur Node.js.
- **Extension VS Code** : commandes, diagnostics dans l'onglet Problèmes, coloration ABAP, CDS et
  BDEF.

## Documentation

| Document | Contenu |
|---|---|
| [Guide](docs/GUIDE.md) | Tout ce que fait rap-transpiler et comment s'en servir (humains et agents IA) |
| [Fonctionnalités](docs/FEATURES.md) | Couverture RAP, fonctionnalité par fonctionnalité |
| [Diagnostics](docs/DIAGNOSTICS.md) | Les codes de `rapt check` |
| [Serveur MCP](docs/MCP.md) | Le service pour les agents IA |
| [Déploiement](docs/DEPLOIEMENT.md) | Docker, SAP BTP Cloud Foundry, HTTPS |
| [Classes utilitaires](docs/UTILITAIRES.md), [API distantes](docs/API_DISTANTES.md) | Le behavior pool au-delà de RAP |
| [Écarts connus](KNOWN_GAPS.md), [Feuille de route](docs/ROADMAP.md) | Ce qui manque, ce qui vient (draft, table entities…) |
| [Décisions](docs/DECISIONS.md), [Plan](PLAN.md) | Les choix techniques et leurs raisons |

La même documentation s'ouvre depuis le launchpad de `rapt dev` (tuile *Documentation*).

## Contribuer

```sh
pnpm install
pnpm build
pnpm test                    # vitest : compilateur, runtime, navigateur (Playwright si présent)
```

```
packages/model/      types de l'IR (model.json), conventions de nommage partagées
packages/compiler/   CLI rapt, parsers (BDEF, CDS, SRVD, DCL), IR, générateurs
packages/runtime/    runtime des applications générées (OData V4, RAP managed, launchpad, MCP)
packages/vscode/     extension VS Code (appelle la CLI rapt)
fixtures/            BO de référence : travel (Travel / Booking), custom-entity
```

Les règles de travail sur le dépôt (pour les humains comme pour les agents) sont dans
[AGENTS.md](AGENTS.md).

## Licence

MIT ([LICENSE](LICENSE)) ; dépendances sous licences permissives ([LICENSES.md](LICENSES.md)).
