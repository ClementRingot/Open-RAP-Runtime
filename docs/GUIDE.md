# Guide de rap-transpiler

Ce guide décrit tout ce que rap-transpiler sait faire et comment s'en servir. Il s'adresse aux
développeurs ABAP et aux agents IA qui écrivent un business object (BO) RAP avec lui : chaque
section donne la commande, le fichier à écrire et le comportement obtenu, avec un lien vers la
décision technique (`Dxx`, dans [DECISIONS.md](DECISIONS.md)) qui en donne les détails.

- Statut fonctionnalité par fonctionnalité : [FEATURES.md](FEATURES.md)
- Codes de diagnostic : [DIAGNOSTICS.md](DIAGNOSTICS.md)
- Écarts connus : [KNOWN_GAPS.md](../KNOWN_GAPS.md) · Feuille de route : [ROADMAP.md](ROADMAP.md)

## 1. Le principe

Vous écrivez un BO RAP comme dans les ABAP Development Tools (ADT) : tables, vues CDS, metadata
extensions, behavior definition (BDEF), behavior pool en ABAP, définition et binding de service.
rap-transpiler compile ces sources (format abapGit) en une application Node.js autonome :

- un service **OData V4** identique à celui de SAP (mêmes chemins, `$metadata`, `$batch`, ETags) ;
- le **runtime RAP managed** : verrous, numérotation, autorisations, feature control,
  déterminations, validations, actions, messages, EML ;
- le **behavior pool ABAP transpilé** en JavaScript (abaplint), exécuté tel quel ;
- une base **PostgreSQL** (ou PGlite embarqué en développement) ;
- une **UI OpenUI5** List Report / Object Page générée depuis les annotations `@UI` ;
- un **launchpad**, un **serveur MCP** pour les agents IA, des fichiers de **déploiement**.

Les sources restent activables sur SAP : le même dépôt abapGit s'importe dans un système ABAP
Cloud ou S/4HANA (en mode `standard`, voir §4).

## 2. Démarrer

### Avec VS Code (recommandé)

Installer l'extension `rap-transpiler-vscode.vsix` (elle contient rapt, OpenUI5 et PGlite : rien
d'autre à installer), puis dans la palette de commandes (`Ctrl+Shift+P`) :

| Commande | Effet |
|---|---|
| *RAP : Nouveau business object* | `rapt new` : un BO managed complet, avec données initiales |
| *RAP : Nouvel objet RAP…* | `rapt generate` : une table, une vue, une BDEF, un behavior pool… |
| *RAP : Lancer rapt dev* | construit, lance et ouvre le launchpad de développement ; relance à chaque enregistrement |
| *RAP : Vérifier le BO* | `rapt check` : diagnostics dans l'onglet Problèmes (aussi à chaque enregistrement) |
| *RAP : Générer l'application* | `rapt build` : l'application déployable |
| *RAP : Générer les fichiers abapGit* | `rapt abapgit` : les XML qui manquent pour l'import dans SAP |
| *RAP : Générer le serveur MCP du service* | `rapt mcp` : les outils pour les agents IA |
| *RAP : Choisir le mode du projet* | `standard` ou `enhanced` (`rapt/config.json`) |

La coloration syntaxique couvre ABAP, CDS (DDLS, DDLX, DCL, SRVD, tables) et BDEF.

### En ligne de commande

```sh
rapt new mon-projet Travel --prefix ZRT    # un BO managed complet
rapt dev mon-projet                         # http://localhost:8080/ : launchpad de développement
```

Depuis un clone du dépôt : `pnpm install && pnpm build`, puis `node packages/compiler/dist/cli.js`
à la place de `rapt`.

## 3. Le projet

```
mon-projet/
  .abapgit.xml                 dossier des sources (STARTING_FOLDER), écrit par rapt abapgit
  src/                         les objets, au format abapGit
    zrt_travel.tabl.astabl     table écrite en source (syntaxe ADT « define table »)
    zrt_r_travel.ddls.asddls   vue CDS racine
    zrt_c_travel.ddls.asddls   projection
    zrt_c_travel.ddlx.asddlxs  metadata extension (UI)
    zrt_r_travel.bdef.asbdef   behavior definition
    zbp_rt_r_travel.clas.*     behavior pool
    zrt_ui_travel.srvd.srvdsrv définition de service
    *.xml                      métadonnées abapGit (générées par rapt abapgit)
  rapt/                        configuration propre à rap-transpiler (jamais importée dans SAP)
    config.json                mode du projet (standard / enhanced)
    seed.json, seed.sql        données initiales de rapt dev
    authorizations.json        rôles → autorisations (objets d'autorisation)
    number-ranges.json         intervalles de numérotation
    mcp.json                   outils MCP et leurs descriptions
  .rapt/                       construction de rapt dev (ignorée par git)
```

Les tables s'écrivent en source (`.tabl.astabl`) : `rapt abapgit` en tire le XML qu'abapGit
attend ([D42](DECISIONS.md)). Les autres XML sont générés quand ils manquent ; un XML présent n'est
jamais modifié.

## 4. Modes `standard` et `enhanced`

`rapt/config.json` ([D45](DECISIONS.md)) :

```json
{ "mode": "enhanced" }
```

| | `standard` (par défaut) | `enhanced` |
|---|---|---|
| Objectif | Comme sur SAP : ce qui se construit s'active sur SAP | Extensions de rap-transpiler |
| BO managed + unmanaged save sur une entité custom | refusé (BDEF027) | permis ([D43](DECISIONS.md)) |
| `field ( mandatory )` | indication pour l'UI, comme RAP | contrôlé à la sauvegarde, un message par champ, sans validation à écrire |
| Élément d'un type énuméré CDS exposé | refusé comme sur SAP (CDS021) | `EnumType` OData : `"Status": "OPEN"`, libellés et liste de choix dans l'UI ([D55](DECISIONS.md)) |

`rapt check --mode enhanced` (ou `build`, `dev`) remplace le mode du fichier.

## 5. Écrire les objets

### Créer un objet : `rapt generate`

```sh
rapt generate . table zshop_order
rapt generate . view ZR_ShopOrder --from zshop_order --root
rapt generate . projection ZC_ShopOrder --from ZR_ShopOrder
rapt generate . metadata ZC_ShopOrder
rapt generate . behavior ZR_ShopOrder          # BDEF managed, avec les compositions
rapt generate . pool ZBP_R_SHOPORDER           # handlers de la BDEF qui nomme la classe
rapt generate . behavior ZC_ShopOrder          # BDEF de projection
rapt generate . access ZC_ShopOrder            # DCL
rapt generate . service ZUI_SHOPORDER --expose ZC_ShopOrder,ZC_ShopItem
rapt generate . binding ZUI_SHOPORDER_O4 --for ZUI_SHOPORDER
rapt generate . tableentity ZSHOP_ITEM --root   # table entity : table et entité en un objet
rapt generate . type ZSHOP_NAME                 # type simple CDS
rapt generate . enum ZSHOP_STATUS               # type énuméré CDS
```

`rapt generate . ` sans type liste les types. Chaque objet est dérivé du précédent comme dans les
assistants d'ADT ; le XML abapGit est écrit avec ([D46](DECISIONS.md)).

### CDS

- `define [root] view entity … as select from <table>`, `as projection on`, `provider contract
  transactional_query`, `composition`, `association to parent`, associations, `redirected to`.
- Metadata extensions (`@Metadata.allowExtensions: true`) fusionnées avec la vue.
- Entités abstraites (paramètres d'actions), entités custom (`@ObjectModel.query.implementedBy`,
  classe `if_rap_query_provider`).
- Contrôles d'accès (DCL) : `grant select … where`, `aspect pfcg_auth`, `aspect user`
  ([D35](DECISIONS.md)).
- Pas d'expressions dans la liste de sélection (CASE, CAST, calculs, chemins) : CDS002.

#### Table entities et types CDS ([D55](DECISIONS.md))

Une table entity réunit la table et l'entité ; un BO managed s'écrit directement dessus, sans
`persistent table` :

```cds
@ClientHandling.type: #CLIENT_DEPENDENT
@AbapCatalog.deliveryClass: #APPLICATION_DATA
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Orders'
define root table entity ZRT_ORDER
{
  key OrderId  : abap.numc(8);
      Name     : zrt_order_name;     // type simple CDS
      Status   : zrt_order_status;   // type énuméré CDS
      Note     : abap.string null;
}
```

Les types CDS sont des sources `<nom>.drty.acds` (format AFF d'abapGit, métadonnées `<nom>.drty.json` écrites par `rapt abapgit`) :

```cds
@EndUserText.label: 'Order status'
define type ZRT_ORDER_STATUS : abap.char(1) enum
{
  @EndUserText.label: 'New'
  NEW = initial;
  @EndUserText.label: 'Open'
  OPEN = 'O';
}
```

La base garde la valeur de base (`'O'`) ; le behavior pool écrit les constantes comme sur SAP
(`Status = zrt_order_status-open`). SAP n'expose pas les types énumérés dans un service OData
RAP : en mode `standard`, CDS021 ; en mode `enhanced`, le `$metadata` a un `EnumType`, le JSON
porte le nom du membre (`"Status": "OPEN"`) et `$filter=Status eq 'OPEN'` fonctionne. Exemple
complet : `fixtures/table-entity`.

### Vues standards de SAP

`I_Currency`, `I_UnitOfMeasure`, `I_Country`, `I_Language`, `I_Region`, `I_TimeZone` et leurs vues
de textes, `I_CalendarDate` (calendrier 1990-2060), `I_BusinessUserBasic` (les utilisateurs de
l'IdP, enregistrés à leur première requête) et `I_ExchangeRate` (taux à charger) existent comme
sur SAP, avec leurs données : il suffit de les nommer ([D44](DECISIONS.md)).

```cds
@Consumption.valueHelpDefinition: [{ entity: { name: 'I_Currency', element: 'Currency' } }]
CurrencyCode,
```

L'entité du value help est exposée automatiquement (comme RAP) ; l'UI ouvre un dialogue de
sélection avec les descriptions. `additionalBinding` (`#FILTER`, `#RESULT`), `useForValidation:
true` et une entité `@ObjectModel.resultSet.sizeCategory: #XS` (liste déroulante) sont pris en
charge ([D56](DECISIONS.md)).

### Behavior definition

Tout un BO RAP managed, avec ou sans draft : `strict ( 2 )`, `lock master` / `dependent`, `etag master` /
`dependent`, autorisations `global` / `instance`, numérotation managed, externe ou anticipée,
`create`/`update`/`delete` (internes, `precheck`, `features`), champs `readonly`, `mandatory`,
`readonly : update`, `features : instance`, déterminations `on modify` / `on save`, validations,
actions (instance, statiques, factory, internes, avec paramètres et résultats), fonctions,
`with additional save`, `with unmanaged save`, `with privileged mode`, projections (`use …`),
side effects. Détails et exceptions : [FEATURES.md](FEATURES.md).

**Draft** ([D54](DECISIONS.md)) : `with draft;`, une `draft table` par entité (BDEF028 sinon),
`total etag`, `draft action Edit; draft action Activate optimized; draft action Discard; draft
action Resume; draft determine action Prepare;`. La table de brouillons n'a pas à exister : elle
est générée. Le service a la clé `IsActiveEntity`, `HasDraftEntity`, `DraftAdministrativeData` et
les actions de SAP ; déterminations et validations s'exécutent à l'activation. L'UI suit Fiori
Elements : filtre *Editing Status*, *Locked by X*, « Draft updated », *Keep Draft* en quittant
la page ([D58](DECISIONS.md)).

**Collaborative draft** ([D59](DECISIONS.md)) : `with collaborative draft;` et `draft action
Share;` ; plusieurs utilisateurs éditent le même brouillon (bouton *Invite*, ou *Edit* sur une
instance déjà en brouillon).

### Behavior pool (ABAP)

Le code ABAP Cloud des handlers et du saver est transpilé tel quel : EML complet (`READ`/`MODIFY
ENTITIES`, `IN LOCAL MODE`, `BY \_assoc`, `EXECUTE`), `failed`/`reported`/`mapped`, messages
(`new_message_with_text`, classes de messages, classes d'exception), `AUTHORITY-CHECK`, ABAP SQL en
lecture sur les tables et entités du projet, écritures dans `save_modified`.

Classes libérées disponibles : JSON (`/ui2/cl_json`, `xco_cp_json`), encodages, dates
(`cl_abap_tstmp`, `xco_cp_time`), numérotation (`cl_numberrange_runtime`), journal applicatif
(`cl_bali_*`), hachage, aléatoire, expressions régulières, RTTS ([UTILITAIRES.md](UTILITAIRES.md)),
traitement en arrière-plan (`cl_bgmc_process_factory`) et e-mail (`cl_bcs_mail_message`)
([D41](DECISIONS.md)), client HTTP et client proxy OData ([API_DISTANTES.md](API_DISTANTES.md)).

### Configuration `rapt/`

| Fichier | Contenu | Décision |
|---|---|---|
| `config.json` | `{ "mode": "standard" \| "enhanced", "ui": { "floorplans": …, "overview": … } }` | [D45](DECISIONS.md), [D53](DECISIONS.md) |
| `seed.json` | `{ "table": [ { "champ": "valeur" } ] }` : données chargées au premier démarrage de `rapt dev` (`SEED=auto`) ; clés UUID tirées au hasard | [D42](DECISIONS.md) |
| `seed.sql` | données en SQL | [D42](DECISIONS.md) |
| `authorizations.json` | rôles de l'IdP → objets d'autorisation et valeurs (`{claim:agency}` : valeur lue du jeton) | [D34](DECISIONS.md) |
| `number-ranges.json` | intervalles de `cl_numberrange_runtime` | [D40](DECISIONS.md) |
| `mcp.json` | outils MCP et leurs descriptions | [D47](DECISIONS.md) |

## 6. L'interface générée

Le List Report et l'Object Page suivent les annotations `@UI` : `headerInfo`, `lineItem` (colonnes
et actions de table), `selectionField`, `identification` (champs et actions d'en-tête),
`fieldGroup`, `facet` (sections, tables des compositions, en-tête), `dataPoint`, `presentationVariant`
(tri), `hidden`, `multiLineText`, `textArrangement`, la criticité, `@Consumption.filter`. La liste
complète, annotation par annotation : [ANNOTATIONS.md](ANNOTATIONS.md).

- **Filtres** : conditions comme SAP Fiori, plusieurs par champ :

  | Saisie | Signification |
  |---|---|
  | `Rome` | texte : contient « Rome » (sans la casse) ; autre type : égal |
  | `=Rome`, `!=Rome` | égal, différent |
  | `>100`, `>=100`, `<100`, `<=100` | comparaisons |
  | `1...5` | intervalle (bornes comprises) |
  | `Ro*`, `*me`, `*om*` | commence par, finit par, contient |

  Une suite de chiffres (NUMC) se saisit sans ses zéros de tête (`3` cherche `00000003`) ; les dates
  se filtrent par plage. *Adapt Filters* ajoute les colonnes comme filtres ; *Clear* vide tout.
- **Vues de l'utilisateur** (variantes) : le titre du List Report ouvre la gestion des vues :
  enregistrer les filtres, les colonnes visibles et le tri sous un nom, choisir la vue par défaut.
  Elles sont enregistrées par utilisateur dans la base de l'application ([D51](DECISIONS.md)).
- **Paramètres du tableau** (roue dentée) : colonnes visibles, tri.
- **Object Page** : édition, création, suppression, actions (dialogue des paramètres), tables des
  compositions éditables, value helps, fil d'Ariane, messages du BO.
- Les boutons suivent les autorisations et le feature control de l'utilisateur.
- **Draft** : Create et Edit ouvrent un brouillon, chaque champ y est enregistré, Save active,
  Cancel abandonne ; la liste montre les instances en cours d'édition.

**Floorplans** ([D53](DECISIONS.md)) : le List Report est le défaut ; `rapt/config.json` en choisit
un autre par entity set :

```json
{
  "ui": {
    "floorplans": { "Travel": "analyticalListPage" },
    "overview": {
      "title": "Travel Overview",
      "cards": [
        { "type": "kpi", "entitySet": "Travel", "title": "Revenue", "measure": "TotalPrice" },
        { "type": "list", "entitySet": "Travel", "title": "Open travels", "filter": "OverallStatus eq 'O'", "top": 4 },
        { "type": "chart", "entitySet": "Travel", "title": "By currency", "chart": "ByCurrency" }
      ]
    }
  }
}
```

| Floorplan | Annotations lues |
|---|---|
| `listReport` | `lineItem`, `selectionField`, `presentationVariant` |
| `worklist` | un onglet par `@UI.selectionVariant` qualifié (`filter: 'OverallStatus EQ ''O'''`) |
| `analyticalListPage` | le premier `@UI.chart` (dimension, mesures, `#COLUMN`, `#BAR`, `#LINE`, `#PIE`, `#DONUT`), lu par `$apply` |
| `formEntry` | l'Object Page, en création seule |
| `overview` | cartes `kpi`, `list`, `table`, `chart` de `rapt/config.json` |

## 7. Développer : `rapt dev`

```sh
rapt dev mon-projet [--port 8080] [--host 0.0.0.0] [--mode enhanced]
```

- Construit l'application, la lance avec une base PGlite embarquée (`.rapt/dev/data`), la
  reconstruit à chaque enregistrement ; une construction en erreur laisse tourner la précédente.
- `http://localhost:8080/` : le **launchpad de développement** — l'application (avec le nombre de
  ses instances), la **documentation** (cette documentation, avec recherche), le `$metadata` et,
  avec `rapt/mcp.json`, le serveur MCP ([D49](DECISIONS.md)).
- Données conservées entre les constructions ; base réinitialisée quand le schéma change.
- Pas de connexion (`AUTH_MODE=none`) ; `DEV_ROLES` et `DEV_ATTRIBUTES` simulent un utilisateur
  et ses autorisations.

## 8. Agents IA : serveur MCP

`rapt mcp` écrit `rapt/mcp.json` ; l'application sert alors `/mcp` : un outil par opération du
service (lister, lire, créer, modifier, supprimer, actions), exécuté avec les contrôles du BO.
Guide : [MCP.md](MCP.md).

## 9. Launchpad

`rapt launchpad launchpad.json --out out/launchpad` construit un launchpad OpenUI5 devant
plusieurs applications : une seule origine, une seule connexion OIDC, tuiles par rôle, compteurs,
navigation par intent ([D37](DECISIONS.md)). Contenu en groupes, ou en **spaces et pages**
([D48](DECISIONS.md)) :

```json
{
  "title": "Travel Agency",
  "apps": [{ "id": "travel", "build": "out/travel", "url": "http://localhost:8080/" }],
  "spaces": [{
    "title": "Voyages", "roles": ["travel_agent"],
    "pages": [{ "title": "Gestion", "sections": [{
      "title": "Travel Management",
      "tiles": [{ "title": "Manage Travels", "app": "travel", "intent": "Travel-manage",
                  "icon": "sap-icon://flight", "count": "Travel" }]
    }] }]
  }]
}
```

## 10. Livrer

- `rapt build mon-projet --out out/travel` : l'application (Node.js, Docker, Cloud Foundry).
- `rapt abapgit mon-projet` : les XML pour importer le dépôt dans SAP avec abapGit
  (`--check` en CI).
- Déploiement (Docker, SAP BTP Cloud Foundry, réseau local, HTTPS) : [DEPLOIEMENT.md](DEPLOIEMENT.md).

Le dossier d'une application générée :

```
model/model.json     représentation intermédiaire lue par le runtime
db/schema.sql        tables et vues PostgreSQL (données de référence des vues standards comprises)
odata/metadata.xml   $metadata (CSDL avec les annotations UI)
abap/                behavior pool transpilé ; abap/src/ : l'ABAP donné au transpiler
ui/                  UI OpenUI5 (List Report, Object Pages)
mcp/tools.json       outils MCP (avec rapt/mcp.json)
package.json, server.mjs, vendor/   démarrage ; vendor/ embarque le runtime
Dockerfile, docker-compose.yml, keycloak/, manifest.yml   conteneur, PostgreSQL, Keycloak, Cloud Foundry
```

## 11. Référence de la CLI

| Commande | Rôle |
|---|---|
| `rapt check <src>` | diagnostics (`fichier:ligne:colonne: sévérité CODE message`), code retour 1 en cas d'erreur |
| `rapt build <src> --out <dir>` | application générée |
| `rapt dev <src>` | boucle de développement |
| `rapt new <src> <Entité> [--prefix ZRT] [--description …]` | BO complet |
| `rapt generate <src> <type> <nom> [--from X] [--for Y] [--expose A,B] [--root]` | un objet |
| `rapt abapgit <src> [--check]` | XML abapGit manquants |
| `rapt mcp <src>` | outils MCP (`rapt/mcp.json`) |
| `rapt launchpad <launchpad.json> --out <dir>` | launchpad |
| `rapt ir <src> [--out f]` | représentation intermédiaire (JSON) |

Options communes : `--service <SRVD>` (plusieurs définitions de service), `--mode`, `--json`
(sortie pour les outils : un objet JSON ; un événement par ligne pour `rapt dev`),
`--warnings-as-errors`.

## 12. Variables d'environnement de l'application

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT`, `HOST` | 8080, 0.0.0.0 | écoute |
| `PUBLIC_URL` | `http://localhost:<PORT>/` | adresse publique (OIDC) ; route Cloud Foundry |
| `DATABASE_URL`, `DATABASE_CA` | — | PostgreSQL et certificat ; service lié Cloud Foundry |
| `PGLITE_DIR` | — | base embarquée (développement) |
| `SCHEMA` | `apply` | `skip` : schéma géré à part |
| `SEED` | — | `auto` : données initiales au premier démarrage |
| `AUTH_MODE` | `none` | `oidc` : jetons porteurs et sessions navigateur |
| `DEV_USER`, `DEV_ROLES`, `DEV_ATTRIBUTES` | — | utilisateur de développement |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUDIENCE`, `OIDC_REQUIRED_ROLE` | — | fournisseur d'identité |
| `SESSION_SECRET` | — | signature des sessions (partagé avec le launchpad) |
| `AUTHORIZATIONS_FILE` | — | rôles remplaçant `rapt/authorizations.json` |
| `DESTINATION_<NOM>_URL`, `_USER`, `_PASSWORD`, `_TOKEN`, `_HEADERS` | — | API distantes |
| `MAIL_SMTP_URL`, `MAIL_FROM` | — | e-mails |
| `MCP` | — | `off` : pas de serveur MCP |
| `UI` | — | `off` : pas d'UI |
| `LOG_LEVEL` | `info` | journal |

## 13. Pour un agent IA qui écrit un BO

1. Lire le projet (`src/`, `rapt/`) ; `rapt check <src> --json` donne les diagnostics avec chemins
   absolus, ligne et colonne.
2. Écrire les sources comme dans ADT ; pour un nouvel objet, préférer `rapt generate` (noms de
   fichiers et XML corrects) ; pour un nouveau BO, `rapt new`.
3. Après chaque modification : `rapt check` jusqu'à zéro erreur ; les codes sont expliqués dans
   [DIAGNOSTICS.md](DIAGNOSTICS.md) ; ce qui n'est pas pris en charge est dans
   [KNOWN_GAPS.md](../KNOWN_GAPS.md) avec le contournement.
4. Vérifier le comportement : `rapt dev <src> --json` (événement `ready`), puis l'OData
   (`/sap/opu/odata4/…`) ou le serveur MCP (`/mcp`).
5. Rester en mode `standard` si le BO doit s'activer sur SAP ; ne passer en `enhanced` que pour
   ses extensions, explicitement.
6. Ne jamais éditer `.rapt/` ni les fichiers `<standard>/…` (générés).
