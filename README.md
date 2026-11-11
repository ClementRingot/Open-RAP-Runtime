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
| J6 | Application packagée (npm, Docker, docker-compose), sessions OIDC, test de bout en bout | fait |

## Démarrage

Prérequis : Node.js 22+, pnpm 10.

```sh
pnpm install
pnpm build
pnpm test
node packages/compiler/dist/cli.js check fixtures/travel     # diagnostics
node packages/compiler/dist/cli.js ir fixtures/travel        # représentation intermédiaire (JSON)
node packages/compiler/dist/cli.js build fixtures/travel --out out/travel   # application générée
node packages/compiler/dist/cli.js launchpad launchpad.json --out out/launchpad   # launchpad (D37)
```

Le dossier source est un export abapGit (`.abapgit.xml` et `src/`) ; la fixture de référence est
[fixtures/travel](fixtures/travel). Les codes de diagnostic sont décrits dans
[docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md).

## Boucle de développement (`rapt dev`)

```sh
node packages/compiler/dist/cli.js dev fixtures/travel      # http://localhost:8080/ui/index.html
```

`rapt dev` construit l'application, la démarre avec une base PGlite embarquée (sans Docker ni
PostgreSQL), puis la reconstruit et la redémarre à chaque modification des sources. Les
diagnostics s'affichent au format `fichier:ligne:colonne: sévérité CODE message`. Une
construction en erreur laisse tourner la précédente. Les données sont gardées d'une construction
à l'autre, sauf quand le schéma de la base change : la base de développement est alors
réinitialisée. La construction va dans `<src>/.rapt/dev` (`--out` pour un autre dossier), le port
est 8080 (`--port`). Les variables de l'application s'appliquent (`AUTH_MODE`, `DEV_ROLES`,
`DATABASE_URL` pour un PostgreSQL…) ; par défaut, `AUTH_MODE=none` et écoute sur 127.0.0.1
([D38](docs/DECISIONS.md)).

### Extension VS Code

[packages/vscode](packages/vscode) ajoute à VS Code les diagnostics de `rapt check` dans l'onglet
Problèmes à chaque enregistrement, les commandes *RAP : Lancer rapt dev*, *Vérifier le BO* et
*Générer l'application*, et l'état de `rapt dev` dans la barre d'état. Elle appelle la CLI avec
`--json` (une sortie JSON pour `check` et `build`, un événement JSON par ligne pour `dev`) et ne
compile rien elle-même ([D39](docs/DECISIONS.md)).

Le `.vsix` est autonome : il contient rapt, OpenUI5 et PGlite, et lance rapt avec le Node.js
de VS Code (1.101 ou plus). Rien d'autre à installer. La CI le publie en artefact
(`rap-transpiler-vscode`) ; pour le construire :

```sh
cd packages/vscode && pnpm run package && code --install-extension rap-transpiler-vscode.vsix
```

## Lancer l'application générée

```sh
node packages/compiler/dist/cli.js build fixtures/travel --out out/travel
cd out/travel
docker compose up --build                 # http://localhost:8080/ (sans connexion)
# ou, avec Node.js 22 et un PostgreSQL :
npm install && DATABASE_URL=postgres://user:password@localhost:5432/app npm start
```

Connexion OIDC (Keycloak fourni dans le profil `oidc` de docker-compose, utilisateur `alice`) :
`AUTH_MODE=oidc docker compose --profile oidc up --build`. Les variables sont décrites dans le
`README.md` et le `.env.example` de l'application générée.

Le behavior pool peut utiliser les classes utilitaires d'ABAP Cloud : `/ui2/cl_json` et
`xco_cp_json`, `cl_web_http_utility`, `cl_abap_conv_codepage`, `cl_numberrange_runtime`
(intervalles dans `rapt/number-ranges.json`), `cl_abap_tstmp` et `xco_cp_time`, journal
applicatif `cl_bali_*`, hachage, aléatoire, expressions régulières, RTTS, traitement en
arrière-plan `cl_bgmc_process_factory` et e-mail `cl_bcs_mail_message` (envoyé par
`MAIL_SMTP_URL`) ([guide](docs/UTILITAIRES.md), [D40, D41](docs/DECISIONS.md)).

Le behavior pool peut appeler des API distantes avec le client HTTP d'ABAP Cloud et le client
proxy OData d'un service consumption model (SCM, SCM2) ; chaque destination se configure par
variables d'environnement (`DESTINATION_<NOM>_URL`, `_USER`, `_PASSWORD`, `_TOKEN`, `_HEADERS`),
listées dans le `.env.example` généré ([guide](docs/API_DISTANTES.md), [D31](docs/DECISIONS.md)).

## Launchpad des applications (`rapt launchpad`)

Quand plusieurs applications sont générées, un launchpad en OpenUI5 sert de point d'entrée,
comme le Fiori launchpad (dont le shell n'existe que dans SAPUI5). Il affiche des tuiles affectées
aux rôles de l'IdP, avec des compteurs (`$count`), une barre shell et la navigation par intent.
Il sert les applications sous une même origine (`/apps/<id>/`, services à leurs chemins), avec
une seule connexion OIDC que les applications lisent ([D37](docs/DECISIONS.md)). Le contenu est
décrit dans un `launchpad.json` :

```json
{
  "title": "Travel Agency",
  "apps": [{ "id": "travel", "build": "out/travel", "url": "http://localhost:8080/" }],
  "groups": [{
    "title": "Travel Management",
    "tiles": [{ "title": "Manage Travels", "app": "travel", "intent": "Travel-manage",
                "icon": "sap-icon://flight", "count": "Travel",
                "roles": ["travel_manager", "travel_agent", "travel_viewer"] }]
  }]
}
```

```sh
node packages/compiler/dist/cli.js launchpad launchpad.json --out out/launchpad
cd out/launchpad && docker compose up --build     # http://localhost:8090/ : launchpad et applications
```

## Application générée (`rapt build`)

```
model/model.json     IR lue par le runtime
db/schema.sql        tables et vues PostgreSQL
odata/metadata.xml   $metadata (CSDL avec annotations UI)
abap/*.mjs           behavior pool transpilé (abap/init.mjs charge l'ensemble)
abap/src/            ABAP donné au transpiler : sources réécrites, types dérivés, socle clean-room
ui/                  UI OpenUI5 : List Report et Object Pages générées depuis les annotations @UI
package.json         dépendances ; vendor/ embarque le runtime et le modèle (aucun registre privé)
server.mjs           démarrage (variables d'environnement : .env.example)
Dockerfile, docker-compose.yml, keycloak/   image, PostgreSQL, Keycloak (profil oidc)
```

Le behavior pool est réécrit avant transpilation : types dérivés de la BDEF, signatures des
handlers, EML abaissé vers la classe noyau `ZRAP_EML` (décision D2). Les diagnostics ABAP
(ABP004 à ABP008) pointent sur les lignes des sources d'origine.

## Organisation

```
packages/model/      types de l'IR (model.json), conventions de nommage partagées
packages/compiler/   CLI rapt, parsers, construction de l'IR, générateurs
packages/runtime/    runtime des applications générées (OData V4, RAP managed)
packages/vscode/     extension VS Code (appelle la CLI rapt)
fixtures/travel/     BO de référence Travel / Booking (format abapGit)
```
