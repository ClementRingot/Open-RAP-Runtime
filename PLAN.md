# Compilateur RAP → application Node.js autonome — Plan

> **Statut : validé le 2026-11-09, en cours de réalisation.** Les décisions prises sont au §11
> et détaillées dans [docs/DECISIONS.md](docs/DECISIONS.md). Le périmètre a été élargi à toutes
> les fonctionnalités d'un BO RAP managed non-draft (décision D14) ; la couverture est suivie
> dans [docs/FEATURES.md](docs/FEATURES.md).
> Les constats du §2 viennent de vérifications faites le 2026-11-09 sur les versions publiées
> des bibliothèques, dans un bac à sable hors dépôt.

## Sommaire

1. [Résumé](#1-résumé)
2. [Vérifications préalables](#2-vérifications-préalables)
3. [Architecture](#3-architecture)
4. [Choix techniques et licences](#4-choix-techniques-et-licences)
5. [Entrées, sorties, CLI](#5-entrées-sorties-cli)
6. [Conception détaillée](#6-conception-détaillée)
7. [Stratégie de test](#7-stratégie-de-test)
8. [Jalons](#8-jalons)
9. [Risques](#9-risques)
10. [Fixture Travel / Booking](#10-fixture-travel--booking)
11. [Décisions prises](#11-décisions-prises)
12. [Annexe A — requêtes de la suite de conformité](#annexe-a--requêtes-de-la-suite-de-conformité)

---

## 1. Résumé

- Le CLI `rapt` (TypeScript strict, ESM, Node ≥ 22) lit un export **abapGit** (TABL, DDLS, DDLX,
  BDEF, SRVD, CLAS) et génère un dossier d'application : OData V4 sur Fastify, PostgreSQL via
  Kysely, behavior pool transpilé par `@abaplint/transpiler`, UI OpenUI5 freestyle,
  Dockerfile et docker-compose.
- L'application générée embarque un **runtime générique** piloté par l'IR sérialisé
  (`model.json`). On ne génère que ce qui doit l'être : SQL, CSDL, JavaScript de l'ABP, UI,
  packaging. Le runtime est ainsi testé une seule fois pour tous les BO.
- **Point dur, dé-risqué.** abaplint type les types dérivés RAP (`TYPE TABLE FOR …`, `keys`,
  `failed`, `reported`, `result`) en `void`, et le transpiler refuse alors l'ABP. Solution
  proposée : générer ces types en ABAP depuis l'IR, puis réécrire l'ABP avant transpilation
  (déclarations des handlers, `#` des opérandes EML, `DATA(…)` inline des réponses EML).
  **Un PoC le valide** : une validation et une action s'exécutent de bout en bout.
- **Bonne nouvelle.** Le transpiler 2.14 abaisse déjà `READ/MODIFY/COMMIT/ROLLBACK ENTITIES`
  vers une classe « kernel » `KERNEL_RAP_EML`, injectée à l'exécution. Notre couche EML
  consiste à implémenter ce contrat en TypeScript, au-dessus du buffer transactionnel.
- Aucune dépendance SAP : ni `@sap/cds`, ni SAPUI5, ni `sap.fe`. Toutes les licences sont MIT,
  Apache-2.0, BSD ou PostgreSQL (§4).
- Les 13 décisions du §11 sont prises (détail et raisons dans docs/DECISIONS.md).

---

## 2. Vérifications préalables

Versions testées : `@abaplint/core` 2.120.98, `@abaplint/transpiler` et `@abaplint/runtime`
2.14.24, Chevrotain 13.2, Node 22.23, pnpm 10.28.

| # | Sujet | Constat | Conséquence pour le plan |
|---|---|---|---|
| V1 | CDS (`CDSParser` d'abaplint) | Parse sans erreur `define root view entity … composition [0..*] of …`, `association to parent … on $projection.X = _P.X`, `as projection on … provider contract transactional_query`, `redirected to composition child`, et les DDLX `annotate entity … with { … }`. Les annotations sortent en arbre (objets, tableaux, énumérations `#X`, chaînes, booléens). | Pas de parser CDS dédié pour le MVP : un adaptateur AST abaplint → IR suffit. Parser complémentaire seulement si un trou apparaît. |
| V2 | SRVD | Objet reconnu, mais source non analysée. | Petite grammaire Chevrotain (`define service … { expose … as …; }`). |
| V3 | BDEF dans abaplint | Un parser à combinateurs existe (≈ 30 expressions). Il produit un arbre générique dont abaplint se sert surtout pour résoudre les alias. | On écrit la grammaire Chevrotain demandée (AST typé, erreurs précises). Le parser abaplint sert d'**oracle** dans les tests. |
| V4 | Types dérivés | `TYPE TABLE FOR …` donne une table de `void` (marqueur interne « RAP-TODO ») ; `keys`, `failed`, `reported`, `mapped`, `result` sont `void`. Le transpiler s'arrête sur `WITH CORRESPONDING #( keys )` : `TypeNameOrInfer, type not found: #`. | Il faut fournir ces types nous-mêmes (§6.3). |
| V5 | EML dans le transpiler | `READ/MODIFY/COMMIT/ROLLBACK ENTITIES` deviennent des appels `abap.Classes['KERNEL_RAP_EML'].begin/read/modify/execute/commit/rollback`. Les noms passent en chaînes (`bdef`, `entity`, `operation`, `fields`…) ; les tables et les cibles `MAPPED/FAILED/REPORTED/RESULT` passent telles quelles. Les tests upstream injectent le kernel par `abap.Classes["KERNEL_RAP_EML"] = …`. | La couche EML est une implémentation TypeScript de ce contrat. |
| V6 | EML non abaissé | `READ … BY \_assoc`, `CREATE BY \_assoc`, `LINK`, `OPERATIONS`, `RELATING TO`, `AUGMENTING`, fonctions, `IN SIMULATION MODE` : le code généré lève une erreur « not supported » à l'exécution. | Entrées de KNOWN_GAPS.md, avec un diagnostic dès la compilation. La fixture n'utilise pas ces formes. Contribution upstream possible (§11). |
| V7 | `IN LOCAL MODE`, `PRIVILEGED` | Ignorés par l'abaissement : le kernel ne sait pas si l'appel est local. | Tout EML venant de l'ABP est traité comme `IN LOCAL MODE`. Sans effet dans le périmètre MVP (pas d'autorisations ni de feature control dynamique). Documenté. |
| V8 | Couche SQL du transpiler | Le transpiler construit des vues SQL à partir des DDLS et échoue sur les associations (`unsupported database definition`). | Le registre passé au transpiler reçoit des DDLS « ombre », sans associations. Notre SQL vient de l'IR, pas du transpiler. |
| V9 | Composants `%…` | `%tky`, `%control`, `%param`, `%msg`, `%element` et `INCLUDE TYPE … AS %tky` (groupes nommés, imbriqués) passent la syntaxe abaplint, la transpilation et l'exécution. | Les types dérivés peuvent s'écrire en ABAP standard. |
| V10 | **PoC de bout en bout** | ABP réécrit à la main comme le ferait l'outil, interface de types générée, kernel JS en mémoire. `validateDates` remplit `failed` et `reported` (`%msg` avec son texte, `%element-EndDate = mk-on`). `acceptTravel` enchaîne `MODIFY … IN LOCAL MODE UPDATE FIELDS`, `READ … ALL FIELDS`, puis remplit `result` avec `%param`. Les méthodes en `PRIVATE SECTION` sont appelées via le mécanisme « friends » du code généré. | L'approche du §6.3 est retenue. |
| V11 | Existant | **open-steamgate** (MIT) émule un serveur d'application ABAP complet (ADT, OData V2/V4, runtime RAP écrit en ABAP). Sa documentation décrit le même contrat `KERNEL_RAP_EML` et la même limite de typage : les cibles EML doivent être déclarées explicitement, et le projet s'appuie sur des builds patchés d'abaplint et du transpiler. | Bonne source d'inspiration. Notre approche marche avec les paquets publiés, sans fork. |
| V12 | Sémantique de `field ( mandatory )` | La doc ABAP Cloud l'indique : aucun contrôle à l'exécution, c'est une indication pour le consommateur. | On reproduit ce comportement : pas de contrôle runtime, `Common.FieldControl` Mandatory dans le CSDL. Le contrôle métier reste dans une validation. |
| V13 | Environnement | Binaires PostgreSQL 16 présents. Docker CLI présent, démon arrêté. Chromium et Playwright préinstallés. | Tests rapides sur PGlite, e2e sur un vrai PostgreSQL. Docker en CI, ou ici si le démon démarre. |

---

## 3. Architecture

```
 dossier abapGit (fixtures/travel/src)
   TABL .xml · DDLS .asddls · DDLX .asddlxs · BDEF .asbdef · SRVD .srvdsrv · CLAS .abap
   │
   ▼
┌──────────────────────────── @rap-transpiler/compiler ────────────────────────────┐
│ 1. Parsing                                                                        │
│    registre abaplint : CDS (DDLS, DDLX), DDIC (TABL, DTEL, DOMA) + catalogue std  │
│    Chevrotain        : BDEF (behavior + projection), SRVD                         │
│ 2. IR (model.json) + validation sémantique (diagnostics fichier:ligne:col)        │
│ 3. Générateurs                                                                    │
│    sql/   DDL PostgreSQL : tables + vues (couche R puis C)                        │
│    csdl/  $metadata XML + annotations UI, Common, Core, Capabilities, Measures    │
│    abap/  types dérivés → réécriture ABP → @abaplint/transpiler → modules .mjs    │
│    ui/    application OpenUI5 (List Report / Object Page en freestyle)            │
│    app/   package.json · server.mjs · Dockerfile · docker-compose · .env          │
└───────────────────────────────────────────────────────────────────────────────────┘
   │
   ▼
 dossier de sortie (application autonome) + @rap-transpiler/runtime embarqué (vendor/)

   navigateur (OpenUI5, ODataModel V4)
        │  $batch, GET, POST, PATCH, DELETE
        ▼
   OData V4 (Fastify) ── auth OIDC / mode dev ── jeton CSRF
        │ lectures                    │ écritures, actions
        ▼                             ▼
   vues SQL zc_*              runtime RAP managed (buffer, triggers, save sequence)
        │                             │  ▲
        │                             │  └── KERNEL_RAP_EML ◄── ABP transpilé (@abaplint/runtime)
        ▼                             ▼
                 PostgreSQL (Kysely + pg)
```

Monorepo pnpm :

```
packages/
  model/      @rap-transpiler/model     types de l'IR, (dé)sérialisation, version de model.json
  compiler/   @rap-transpiler/compiler  CLI rapt, parsers, construction de l'IR, générateurs
  runtime/    @rap-transpiler/runtime   OData V4, runtime RAP managed, kernel EML, auth, accès DB
fixtures/travel/                        BO de référence (format abapGit)
e2e/                                    scénarios de bout en bout (HTTP + Playwright)
```

Dépendances internes : `compiler` → `model` ← `runtime`. Le compilateur ne dépend du runtime
que pour l'embarquer dans la sortie.

---

## 4. Choix techniques et licences

Licences relevées sur le registre npm le 2026-11-09. LICENSES.md sera créé au J1 et tenu à jour
à chaque ajout de dépendance (nom, version, licence, usage, date de vérification).

| Brique | Choix | Licence | Raison, alternative |
|---|---|---|---|
| Langage, outillage | TypeScript 7.0 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESM, Node ≥ 22, pnpm 10 (workspaces), Vitest 5 | Apache-2.0, MIT, MIT | Imposés par le cahier des charges. Repli sur TypeScript 5.9 si un outil n'est pas encore compatible avec la 7. |
| Parsing ABAP et CDS | `@abaplint/core` 2.120.98 | MIT | Imposé ; couverture CDS suffisante (V1). Version exacte épinglée. |
| Transpilation de l'ABP | `@abaplint/transpiler` et `@abaplint/runtime` 2.14.24 | MIT | Imposé. Même version exacte pour les deux, épinglée. |
| Grammaires BDEF, SRVD, options OData | Chevrotain 13 | Apache-2.0 | Imposé pour BDEF ; réutilisé pour SRVD et `$filter`/`$orderby`/`$expand`. |
| Serveur HTTP | Fastify 5 | MIT | `inject()` pour tester sans réseau, plugins encapsulés, bon typage. Alternative : Express 5 (MIT). |
| Base de données | PostgreSQL 16+, `pg` 8, Kysely 0.29 | PostgreSQL, MIT, MIT | Imposés. Requêtes paramétrées uniquement. |
| Base pour les tests | PGlite 0.5 + `kysely-pglite-dialect` 1.4 | Apache-2.0, MIT | Vrai moteur PostgreSQL en processus (WASM), sans Docker : tests d'intégration rapides. |
| OIDC | `jose` 6 (JWT, JWKS), `openid-client` 6 (code + PKCE), `@fastify/secure-session` 8 | MIT | Fournisseur OIDC générique (Keycloak, Entra ID, Auth0…). |
| Fichiers statiques | `@fastify/static` 10 | MIT | Sert l'UI construite. |
| Tests OIDC | `oauth2-mock-server` 9 (dev) ; Keycloak (image Docker) | MIT, Apache-2.0 | Faux fournisseur en Vitest ; vrai Keycloak en e2e. |
| UI | OpenUI5 1.136 LTS : `sap.m`, `sap.f`, `sap.uxap`, `sap.ui.layout`, `sap.ui.core`, thème `sap_horizon` | Apache-2.0 | Autorisé. Le ODataModel V4 est le même que celui de Fiori Elements V4. `sap.fe`, `sap.ui.comp` et `sap.suite` ne font pas partie d'OpenUI5 et ne sont pas utilisés. |
| Build de l'UI | UI5 Tooling (`@ui5/cli` 4) | Apache-2.0 | `ui5 build self-contained` : bundle autonome, utilisable hors ligne. |
| E2E navigateur | Playwright 1.65 | Apache-2.0 | Chromium déjà installé ici. |
| XML | écriture maison pour le CSDL ; `fast-xml-parser` 5 en dev | MIT | Pas de dépendance à l'exécution pour le XML. |
| CLI | `node:util` `parseArgs` | (Node, MIT) | Aucune dépendance. |
| Images Docker | `node:22-alpine`, `postgres:16-alpine`, `quay.io/keycloak/keycloak` | MIT et paquets libres, PostgreSQL, Apache-2.0 | Images officielles. |
| Corpus de test (option) | sources BDEF/CDS des exemples SAP-samples (refscen-flight, rap-opensap, fiori-feature-showcase) | Apache-2.0 | Robustesse des parsers, en lecture seule, avec attribution (décision 13). |

Interdits respectés : aucun `@sap/cds` (CAP), aucun SAPUI5, aucun `sap.fe`, aucune bibliothèque
sous SAP Developer License. Le socle ABAP « clean-room » (§6.3) est écrit de zéro d'après les
signatures publiques documentées ; aucun code SAP n'est copié.

---

## 5. Entrées, sorties, CLI

### Entrée : un dossier au format abapGit

| Type | Fichiers | MVP |
|---|---|---|
| TABL | `ztravel.tabl.xml` (DD02V, DD03P) | oui |
| DTEL, DOMA | `.dtel.xml`, `.doma.xml` | oui s'ils sont présents ; sinon, catalogue embarqué des éléments standard usuels en RAP (`SYSUUID_X16`, `ABP_*`, `TIMESTAMPL`, `ABAP_BOOLEAN`…), métadonnées de type uniquement |
| DDLS | `.ddls.asddls` | oui |
| DDLX | `.ddlx.asddlxs` | oui |
| BDEF | `.bdef.asbdef` | oui (managed et projection) |
| SRVD | `.srvd.srvdsrv` | oui |
| SRVB | `.srvb.xml` | optionnel : nom du binding, version, chemin du service |
| CLAS | `.clas.abap`, `.clas.locals_imp.abap`, `.clas.locals_def.abap` | oui (behavior pool) |
| MSAG | `.msag.xml` | « should » : pour `new_message( id = … number = … )` |

### CLI

```
rapt check <src>                                   diagnostics (parse, sémantique RAP, syntax check ABAP)
rapt ir    <src> --service ZUI_TRAVEL              IR en JSON (débogage, snapshots)
rapt build <src> --service ZUI_TRAVEL --out <dir> [--odata-path …] [--ui5-version …]
```

Les diagnostics suivent le format `fichier:ligne:colonne: error|warning CODE message`. Le code de
retour est non nul en cas d'erreur.

### Sortie : un dossier autonome

```
package.json          dépendances publiques (fastify, kysely, pg, @abaplint/runtime, jose, openid-client…)
vendor/               runtime embarqué en tarball : aucun registre privé nécessaire
server.mjs            démarrage : configuration (env) → schéma DB → runtime ABAP → Fastify
model/model.json      IR sérialisé
odata/metadata.xml    CSDL ($metadata)
db/schema.sql         tables + vues
abap/*.mjs            ABP transpilé, types dérivés, socle « clean-room »
webapp/  ui5.yaml     application OpenUI5, construite en bundle autonome au build Docker
Dockerfile  docker-compose.yml  .env.example  keycloak/realm.json  README.md
```

Lancement : `npm start` (PostgreSQL via `DATABASE_URL`, `AUTH_MODE=none|oidc`) ou
`docker compose up`.

---

## 6. Conception détaillée

### 6.1 Parsing

**BDEF (Chevrotain).** Lexer insensible à la casse, commentaires `//` et `/* */`, noms avec
namespace (`/DMO/I_Travel`), `$self`, cardinalités `[1]`, `[0..*]`. Sous-ensemble MVP :

- en-tête : `managed implementation in class … unique;`, `projection;`, `strict ( 2 );` ;
- entité : `define [root] behavior for E [alias A]`, `persistent table T`, `lock master`,
  `lock dependent by _A`, `etag master F`, `etag dependent by _A`, `use etag` (projection) ;
- corps : `create; update; delete;`, `association _A [{ create; }]`,
  `field ( readonly | mandatory | numbering : managed ) F1, F2;`,
  `determination d on modify { create; update; delete; field F1, F2; }`,
  `validation v on save { … }`, `action a [result [1] $self];`,
  `mapping for T [corresponding] { F = col; }` ;
- projection : `use create`, `use update`, `use delete`, `use action a`,
  `use association _A [{ create; }]`.

Les constructions hors périmètre sont **reconnues** par des règles génériques. L'outil émet un
diagnostic clair au lieu d'une erreur de syntaxe opaque :

| Construction | Traitement |
|---|---|
| `with draft`, `unmanaged`, `late numbering`, `with additional save`, `with unmanaged save`, actions `static` ou `factory`, fonctions, `determine action`, `event` | **erreur** : hors périmètre MVP |
| `authorization master`, `authorization dependent`, `side effects`, `features : instance`, `mandatory : create`, `readonly : update` | **avertissement** : accepté mais ignoré, écart décrit dans KNOWN_GAPS.md |

**CDS (via abaplint).** L'adaptateur extrait le nom, la nature (root ou enfant), la source
(table ou entité), la liste de sélection avec `key` et alias, les associations et compositions
(cardinalité, condition ON), `redirected to`, `provider contract`, et les annotations d'entité et
d'élément converties en JSON. MVP : colonnes et alias ; les expressions (CASE, CAST, calculs)
produisent un diagnostic « non supporté » en attendant une extension. Fusion des annotations :
DDLX (couches CUSTOMER > PARTNER > INDUSTRY > LOCALIZATION > CORE), puis projection, puis vue
de base (propagation), en respectant `@Metadata.ignorePropagatedAnnotations`.

**SRVD.** `define service S { expose E [as Alias]; }`, avec annotations.

**DDIC.** Tables lues par abaplint (XML DD03P) ; DTEL et DOMA par abaplint ; catalogue embarqué
pour les éléments standard. La colonne mandant (`CLNT`) est ignorée (décision 9).

### 6.2 IR

Esquisse des types du package `model` :

```ts
interface Model { version: 1; service: Service; bos: BusinessObject[]; projections: ProjectionBO[]; tables: Table[] }

type AbapType = { kind: "char" | "numc" | "string" | "dec" | "curr" | "quan" | "int1" | "int2" | "int4"
                      | "int8" | "fltp" | "dats" | "tims" | "timestamp" | "timestampl" | "utclong"
                      | "raw" | "rawstring" | "cuky" | "unit" | "bool";
                  length?: number; decimals?: number; ddic?: string };

interface Field { name: string; type: AbapType; column?: string; key: boolean;
                  semantics?: "createdBy" | "createdAt" | "lastChangedBy" | "lastChangedAt" | "localInstanceLastChangedAt";
                  currencyRef?: string; annotations: Annotations; src: SourceRef }

interface Entity { name: string; alias: string; root: boolean; table?: string; baseEntity?: string;
                   fields: Field[]; associations: Association[]; annotations: Annotations }

interface Association { name: string; target: string; kind: "composition" | "toParent" | "association";
                        cardinality: [min: number, max: number | "*"]; on: Array<[source: string, target: string]> }

interface Trigger { create?: true; update?: true; delete?: true; fields: string[] }
interface HandlerRef { abapClass: string; method: string; params: Record<string, string> }

interface EntityBehavior {
  entity: string; persistentTable: string;
  lock: { master: true } | { dependentBy: string };
  etag?: { master: string } | { dependentBy: string };
  operations: { create: boolean; update: boolean; delete: boolean; createBy: string[] };
  fieldControl: Record<string, Array<"readonly" | "mandatory">>; numberingManaged: string[];
  determinations: Array<{ name: string; on: "modify" | "save"; triggers: Trigger; handler: HandlerRef }>;
  validations: Array<{ name: string; triggers: Trigger; handler: HandlerRef }>;
  actions: Array<{ name: string; result?: { cardinality: "1"; self: true }; handler: HandlerRef }>;
  mapping: Record<string, string>; src: SourceRef }
```

Validations sémantiques (diagnostics positionnés) : entité, champ et association connus ;
mapping BDEF cohérent avec la vue CDS et la table ; champ `etag master` existant et de type
horodatage ; champ `numbering : managed` clé et de type RAW 16 ; champs des triggers existants ;
la projection n'utilise que des capacités de la base ; chaque validation, détermination et action
a une méthode de handler dans l'ABP.

### 6.3 ABP → JavaScript

1. **Syntax check** abaplint des sources d'origine (ABAP for Cloud Development). Les erreurs
   pointent les lignes d'origine.
2. **Types dérivés.** Pour chaque BDEF, une interface ABAP générée (`ZRAP_DT_<BDEF>`, ou un nom
   haché au-delà de 30 caractères). Par entité : groupes `%key`, `%pky`, `%tky`, `%data`,
   `%control` ; tables `FOR CREATE`, `UPDATE`, `DELETE`, `READ IMPORT`, `READ RESULT`,
   `ACTION IMPORT`, `ACTION RESULT` ; structures `RESPONSE FOR FAILED/REPORTED/MAPPED` (`%cid`,
   `%cid_ref`, `%fail`, `%msg`, `%element`, `%op`…). Le tout d'après la documentation ABAP des
   types dérivés BDEF.
3. **Réécriture.** abaplint fournit l'AST et les positions ; on applique des éditions textuelles
   ciblées en préservant les numéros de ligne :

   | Dans l'ABP | Devient |
   |---|---|
   | `METHODS v FOR VALIDATE ON SAVE IMPORTING keys FOR Travel~v.` | `METHODS v IMPORTING keys TYPE <dt>=>tt_travel_keys CHANGING failed TYPE <dt>=>ts_failed reported TYPE <dt>=>ts_reported.` |
   | `FOR DETERMINE ON MODIFY …`, `FOR MODIFY IMPORTING keys FOR ACTION Travel~a RESULT result` | même principe ; `result` et `mapped` typés selon l'opération |
   | `TYPE TABLE FOR UPDATE zr_travel\\travel`, `TYPE STRUCTURE FOR …`, `TYPE RESPONSE FOR …` | `TYPE <dt>=>tt_travel_update`, etc. |
   | `RESULT DATA(x)`, `FAILED DATA(f)`, `REPORTED DATA(r)`, `MAPPED DATA(m)` d'une instruction EML | `DATA x TYPE …` hissé sur la même ligne, puis `RESULT x` |
   | opérande EML `CORRESPONDING #( … )` ou `VALUE #( … )` | `#` remplacé par le type dérivé attendu |
   | handlers que l'outil n'appelle pas (par exemple `FOR GLOBAL AUTHORIZATION`) | signature typée de la même façon, pour que la classe se transpile ; méthode jamais appelée |
   | tout le reste, instructions EML comprises | inchangé : le transpiler abaisse l'EML vers `KERNEL_RAP_EML` |

4. **Registre du transpiler** : ABP réécrit, interface de types, DDLS ombre (V8), tables, et
   socle « clean-room » écrit par nous : `CL_ABAP_BEHAVIOR_HANDLER` (`new_message_with_text`,
   `new_message`), `IF_ABAP_BEHV` (`mk`, `cause`…), `IF_ABAP_BEHV_MESSAGE`.
5. **Transpilation** (`unknownTypes: compileError`) → modules `.mjs`. L'outil écrit dans
   `model.json` le **registre des handlers** : validation, détermination ou action BDEF →
   classe locale transpilée, méthode, noms des paramètres.

Garde-fou : on ne patche jamais le transpiler ni le runtime, on leur donne de l'ABAP standard.
Une construction non gérée produit un diagnostic et une entrée dans KNOWN_GAPS.md.

**Exécution.** Le runtime instancie la classe locale (par exemple
`abap.Classes['CLAS-ZBP_R_TRAVEL-LHC_TRAVEL']`). Il construit `keys`, `failed`, `reported` et
`result` à partir des types générés, appelle la méthode, puis relit les réponses. Le kernel
`KERNEL_RAP_EML` relie chaque appel EML au buffer du LUW courant, retrouvé via
`AsyncLocalStorage`. Le runtime abaplint a un **état global** (`sy-*`, attributs statiques)
partagé entre requêtes : les appels ABP sont donc **sérialisés** dans un processus. La montée en
charge se fait par processus ou conteneurs (décision 11).

### 6.4 SQL (PostgreSQL)

Les tables viennent des TABL : noms en minuscules, colonne mandant retirée, clé primaire, clé
étrangère enfant → parent pour les compositions, index sur la clé parent. Une vue SQL est
générée pour chaque vue CDS : `zr_*` sur les tables, puis `zc_*` sur `zr_*`. Les lectures
OData passent par les vues `zc_*` ; les écritures passent par le runtime RAP, vers les tables.
Le DDL est idempotent (`IF NOT EXISTS`). L'évolution de schéma (ALTER) est hors MVP.

| ABAP | PostgreSQL | Edm |
|---|---|---|
| CHAR(n) | `varchar(n)`, blancs finaux supprimés | String, MaxLength=n |
| NUMC(n) | `varchar(n)`, chiffres avec zéros à gauche | String + `Common.IsDigitSequence` |
| STRING, SSTRING(n) | `text`, `varchar(n)` | String |
| INT1, INT2, INT4, INT8 | `smallint`, `smallint`, `integer`, `bigint` | Byte, Int16, Int32, Int64 |
| DEC, CURR, QUAN (p,s) | `numeric(p,s)` | Decimal, Precision et Scale |
| FLTP | `double precision` | Double |
| DATS | `date` ; valeur initiale `00000000` ↔ NULL | Date |
| TIMS | `time(0)` | TimeOfDay |
| TIMESTAMP (DEC 15) | `timestamptz(0)` | DateTimeOffset, Precision 0 |
| TIMESTAMPL (DEC 21,7), UTCLONG | `timestamptz(6)` | DateTimeOffset, Precision 7 |
| RAW(16) (`SYSUUID_X16`) | `uuid` | Guid |
| autres RAW(n), RAWSTRING | `bytea` | Binary |
| CHAR(1) `ABAP_BOOLEAN` | `boolean` | Boolean |
| CUKY, UNIT | `varchar(5)`, `varchar(3)` | String ; le montant porte `Measures.ISOCurrency` ou `Measures.Unit` |

### 6.5 $metadata (CSDL XML)

Conventions reprises de RAP, pour qu'une application Fiori Elements existante trouve ce qu'elle
attend : schéma `com.sap.gateway.srvd.<srvd>.v0001` (alias `SAP__self`), types `<Alias>Type`,
entity sets `<Alias>`, navigations avec `Partner` et `NavigationPropertyBinding`, actions liées
avec un paramètre `_it`. Les vocabulaires (Core, Capabilities, Measures côté OASIS ; Common, UI
côté SAP) sont référencés par leur URL publique.

| Source | Annotation CSDL |
|---|---|
| `@EndUserText.label` | `Common.Label` |
| `@UI.lineItem` (dont `#FOR_ACTION`) | `UI.LineItem` (`UI.DataField`, `UI.DataFieldForAction`, `UI.Importance`) |
| `@UI.selectionField` | `UI.SelectionFields` |
| `@UI.headerInfo` | `UI.HeaderInfo` |
| `@UI.facet` | `UI.Facets` : `ReferenceFacet` vers Identification, FieldGroup ou le LineItem d'une association ; `CollectionFacet` |
| `@UI.identification`, `@UI.fieldGroup` | `UI.Identification`, `UI.FieldGroup#Qualifier` |
| `@UI.hidden` | `UI.Hidden` |
| `@ObjectModel.text.element` | `Common.Text` |
| `@Semantics.amount.currencyCode`, `@Semantics.quantity.unitOfMeasure` | `Measures.ISOCurrency`, `Measures.Unit` |
| `field ( readonly )`, `numbering : managed` | `Core.Computed` |
| `field ( mandatory )` | `Common.FieldControl` Mandatory |
| `etag master` | `Core.OptimisticConcurrency` sur l'entity set |
| opérations disponibles (create, update, delete, create par association) | `Capabilities.InsertRestrictions`, `UpdateRestrictions`, `DeleteRestrictions`, `NavigationRestrictions` |

### 6.6 Runtime OData V4

Objectif : qu'une application Fiori Elements V4 existante (hors de ce projet, utilisée sous la
licence SAP de son propriétaire) puisse consommer le service. Nos tests n'utilisent qu'OpenUI5.

Le tableau donne le périmètre demandé, plus les ajouts que je propose parce qu'une List Report /
Object Page V4 en a besoin (décision 5) :

| Fonction | Demandé | Ajout proposé |
|---|---|---|
| Document de service, `$metadata` | ✓ | |
| GET collection ; GET entité, clé courte `Travel(<guid>)` et clé nommée `Travel(TravelUUID=<guid>)` | ✓ | |
| GET via navigation `Travel(…)/_Booking` (table de l'Object Page) | | ✓ |
| `$filter` : eq, ne, gt, lt, and, or, contains | ✓ | ge, le, not, startswith, endswith, parenthèses, `null` (la barre de filtres FE les produit) |
| `$orderby`, `$top`, `$skip`, `$count=true` | ✓ | segment `/$count` |
| `$expand` sur 1 niveau, avec `$select`, `$orderby`, `$top`, `$skip` imbriqués | ✓ | |
| `$select` | ✓ | |
| `$search` simple (ILIKE sur les champs `@Search.defaultSearchElement`) | | ✓ |
| POST, PATCH, DELETE | ✓ | POST via navigation `Travel(…)/_Booking` ; deep insert sur 1 niveau |
| Actions liées | ✓ | |
| `$batch` multipart, changesets atomiques, `Content-ID` | ✓ | références `$<id>` à l'intérieur d'un changeset |
| ETag : `@odata.etag`, `If-Match`, 412 en cas d'écart | ✓ | 428 si `If-Match` manque |
| `IEEE754Compatible=true` (Decimal et Int64 en chaînes) | | ✓ (UI5 l'envoie systématiquement) |
| Jeton CSRF (`X-CSRF-Token: Fetch` sur HEAD ou GET) | | ✓ |
| Messages : erreur V4 avec `target` et `@Common.numericSeverity` ; succès et avertissements dans l'en-tête `sap-messages` | | ✓ |
| Paramètres `sap-*` (sap-client, sap-language…) | | acceptés et ignorés |

Implémentation : un plugin Fastify ; les options système sont analysées par Chevrotain, puis
l'AST est traduit en requêtes Kysely paramétrées (jamais de concaténation SQL), avec une liste
blanche de propriétés issue de l'IR. Un changeset correspond à un LUW RAP et à une transaction
PostgreSQL. Le `$batch` au format JSON (OData 4.01) est hors MVP.

Chemin du service : par défaut celui d'un binding RAP,
`/sap/opu/odata4/sap/<binding>/srvd/sap/<srvd>/0001/`, pour qu'une application FE existante y
pointe sans modifier son manifest. Le chemin est configurable (décision 6).

### 6.7 Runtime RAP managed (sans draft)

- **Buffer transactionnel** par LUW : instances par entité (état chargé, créé, modifié ou
  supprimé), champs modifiés (pour évaluer les triggers), correspondance `%cid` ↔ clés.
- **Opérations** :
  - create, avec numérotation `managed` (UUID v4) ;
  - update piloté par `%control` (un PATCH positionne les champs envoyés) ;
  - delete, en cascade sur les compositions ;
  - create par association, avec propagation de la clé parent ;
  - actions d'instance (`result [1] $self`).
- **Champs** :
  - `readonly` : ignoré ou refusé pour un consommateur externe (OData), autorisé en local mode
    (ABP) ;
  - `mandatory` : pas de contrôle runtime, comme RAP (V12) ;
  - champs d'administration remplis d'après `@Semantics.user.createdBy`, `lastChangedBy`,
    `@Semantics.systemDateTime.createdAt`, `lastChangedAt` et `localInstanceLastChangedAt`.
- **Déterminations on modify** : exécutées à la fin de chaque requête de modification, pour les
  instances dont un trigger (`create`, `update`, `delete`, `field …`) a été touché. Elles peuvent
  en déclencher d'autres ; la boucle est bornée.
- **Séquence de sauvegarde** :
  1. finalize (déterminations on save) ;
  2. check_before_save (validations dont les triggers ont été touchés dans le LUW) ;
  3. si `failed` n'est pas vide : rollback, puis erreur OData avec les messages de `reported` ;
  4. sinon save (INSERT, UPDATE, DELETE), COMMIT, cleanup.
- **ETag** : contrôle d'`If-Match` sur le champ `etag master` avant update, delete et action.
- **Verrou** : `lock master` → `SELECT … FOR UPDATE NOWAIT` sur la ligne racine, dans la
  transaction du changeset ; `lock dependent` → verrou de la racine. Le code HTTP renvoyé quand
  l'instance est verrouillée sera aligné sur SAP (à vérifier).
- **Identité** : l'utilisateur authentifié alimente `sy-uname` et les champs
  `createdBy`/`lastChangedBy`.

### 6.8 Authentification

- `AUTH_MODE=none` (dev) : utilisateur fixe, configurable.
- `AUTH_MODE=oidc`, générique (découverte via `/.well-known/openid-configuration`) :
  - API : jeton Bearer JWT vérifié via JWKS avec `jose` (`iss`, `aud`, `exp`, rôle requis
    optionnel) ;
  - navigateur : pattern BFF, Authorization Code + PKCE avec `openid-client`, session dans un
    cookie chiffré (`HttpOnly`, `SameSite=Lax`), jeton CSRF exigé sur les requêtes qui modifient.
- Le claim qui alimente `sy-uname` est configurable (`preferred_username` par défaut). Les
  colonnes utilisateur en CHAR(12) sont tronquées, avec un avertissement.
- Keycloak : profil docker-compose avec import de realm (client, utilisateurs de test). En
  Vitest : faux fournisseur OIDC (`oauth2-mock-server`).

### 6.9 UI OpenUI5 générée (freestyle, sans sap.fe)

- `sap.ui.model.odata.v4.ODataModel` d'OpenUI5, avec `autoExpandSelect`. C'est le modèle de
  Fiori Elements V4 : les requêtes `$batch` ont la même forme.
- **List Report** :
  - `sap.f.DynamicPage` ;
  - barre de filtres générée depuis `UI.selectionField`, le contrôle dépendant du type Edm ;
    champ de recherche si `@Search.searchable` ;
  - `sap.m.Table` depuis `UI.lineItem` (tri, chargement progressif, `$count`) ;
  - boutons Créer et Supprimer selon les capacités ; boutons d'action depuis `#FOR_ACTION`.
- **Object Page** :
  - `sap.uxap.ObjectPageLayout`, en-tête depuis `UI.headerInfo` ;
  - sections depuis `UI.facet` : formulaires pour Identification et FieldGroup, table pour la
    composition ;
  - modes affichage et édition, Enregistrer / Annuler, actions ;
  - `mandatory` → champ requis, contrôlé côté client avant l'enregistrement ; `readonly` → non
    éditable ;
  - messages dans un `MessagePopover`.
- La page objet enfant (Booking) est générée de la même façon ; les libellés i18n viennent de
  `@EndUserText`.
- `sap.ui.mdc` (présent dans OpenUI5) est une évolution possible, hors MVP. Version d'OpenUI5
  épinglée sur une LTS, 1.136 par défaut.

### 6.10 Packaging

- **Dockerfile** multi-étapes : build de l'UI (`ui5 build self-contained`), installation des
  dépendances de production, image `node:22-alpine`, utilisateur non root, `HEALTHCHECK`.
- **docker-compose** : `app` + `postgres:16-alpine` (volume, healthcheck) ; profil `auth` avec
  Keycloak.
- Au démarrage, l'application applique `db/schema.sql` (idempotent) et tient une table de
  version du schéma.

---

## 7. Stratégie de test

| Niveau | Contenu | Outils |
|---|---|---|
| Unitaire | Grammaires (cas positifs, négatifs, positions d'erreur), construction de l'IR, générateurs (assertions + snapshots), parseurs OData, conversions de types ABAP ↔ SQL ↔ Edm | Vitest |
| Oracle | BDEF comparé au parser abaplint ; CDS et BDEF du corpus SAP-samples, en lecture seule | Vitest |
| ABP | Snapshots de la réécriture ; transpilation puis exécution des handlers sur un faux kernel ; tests du contrat `KERNEL_RAP_EML` et de l'accès aux méthodes privées | Vitest + abaplint |
| Intégration | Runtime RAP + SQL sur un vrai moteur PostgreSQL en mémoire | PGlite |
| Conformité OData | Requêtes telles que Fiori les envoie (annexe A), y compris des corps `$batch` bruts. D'abord écrites d'après les URLs d'une List Report V4, puis complétées par des traces réelles : on pilote le ODataModel V4 d'OpenUI5 avec Playwright et on fige les requêtes capturées en fichiers de référence. | `fastify.inject` + PGlite |
| E2E | `rapt build` sur la fixture → `docker compose up` → scénarios HTTP et parcours UI (filtrer, ouvrir, modifier, action, créer, supprimer). Variante sans Docker sur un PostgreSQL local. | Playwright |

CI : GitHub Actions (typecheck et tests à chaque push, job e2e Docker).

---

## 8. Jalons

Chaque jalon se termine par des tests Vitest verts, un commit poussé sur la branche et un court
compte rendu.

### J1 — Socle, fixture, parser BDEF, IR

- **Livrables**
  - Socle monorepo (pnpm, TypeScript strict, ESM, Vitest, CI), LICENSES.md, KNOWN_GAPS.md,
    README.
  - Fixture `fixtures/travel/` complète au format abapGit (§10), ABP compris (utilisé à partir
    du J4).
  - Grammaires Chevrotain BDEF (managed et projection) et SRVD ; adaptateurs abaplint CDS, DDLX
    et DDIC ; catalogue des éléments de données standard.
  - Package `model` : types de l'IR, construction, validations sémantiques, diagnostics
    positionnés.
  - CLI `rapt check` et `rapt ir`.
- **Tests** : grammaire (positifs, négatifs, positions d'erreur) ; oracle abaplint (mêmes
  entités, alias, opérations) ; snapshot de l'IR de la fixture ; diagnostics sur des sources
  volontairement fautives.
- **Sortie** : `rapt check fixtures/travel` sans erreur ; `rapt ir` produit un IR complet et
  stable.

### J2 — Générateurs SQL et $metadata

- **Livrables** : DDL (tables, contraintes, vues R et C) ; CSDL avec annotations ;
  `rapt build` écrit `db/schema.sql` et `odata/metadata.xml`.
- **Tests** : DDL exécuté sur PGlite, puis insertion et lecture via les vues ; CSDL bien formé,
  assertions XPath, snapshot ; contrôle croisé IR ↔ CSDL.
- **Sortie** : tests verts.

### J3 — Runtime OData en lecture (et socle d'authentification)

- **Livrables** : plugin Fastify ; parseurs des URLs et des options (Chevrotain) ; sérialisation
  JSON V4 ; `$batch` en lecture ; CSRF ; erreurs ; authentification en mode dev et Bearer.
- **Tests** : parseurs ; suite de conformité « lecture » (annexe A, requêtes 1 à 11) ; sécurité
  (tentatives d'injection, propriétés inconnues).
- **Sortie** : les requêtes de lecture d'une List Report et d'une Object Page passent.

### J4 — Écriture, EML, ABP transpilé

- **Livrables** : runtime RAP managed (§6.7), chaîne ABP (§6.3), kernel EML, écritures OData et
  changesets, messages.
- **Tests**
  - Unitaires : buffer, triggers, séquence de sauvegarde, snapshots de la réécriture, contrat du
    kernel.
  - Intégration via OData sur PGlite :
    - création d'un Travel → `OverallStatus = 'O'` (détermination) ;
    - dates incohérentes → 400, message ciblé sur `EndDate`, rollback ;
    - ETag périmé → 412 ;
    - `acceptTravel` → `'A'` ;
    - création d'un Booking via `_Booking` ;
    - suppression en cascade ;
    - changeset atomique.
- **Sortie** : tests verts ; KNOWN_GAPS.md à jour.

### J5 — UI générée

- **Livrables** : générateur OpenUI5 (§6.9).
- **Tests** : snapshots des vues et du manifest ; parcours Playwright sur l'application
  (PGlite ou PostgreSQL local) : lister, filtrer, trier, ouvrir, éditer, enregistrer, lancer
  l'action, créer avec des enfants, supprimer, voir un message de validation.
- **Sortie** : parcours vert.

### J6 — Packaging Docker, OIDC complet, e2e

- **Livrables** : package.json, Dockerfile, docker-compose (app + Postgres, profil Keycloak) ;
  runtime embarqué ; BFF OIDC ; README de l'application générée.
- **Tests** : e2e — build de la fixture, `docker compose up`, suite HTTP et Playwright, avec et
  sans Keycloak ; variante sans Docker.
- **Sortie** : tests verts en local et en CI.

---

## 9. Risques

| Risque | Probabilité | Impact | Parade |
|---|---|---|---|
| Types dérivés RAP non résolus par abaplint (V4) | constaté | bloquant pour l'ABP | Types générés + réécriture (PoC V10) ; à terme, contribution upstream. |
| Formes EML non abaissées (V6), surtout `READ … BY \_Booking`, courant dans les déterminations réelles | élevée | ABP réels refusés | Diagnostic dès la compilation, entrée KNOWN_GAPS ; contribution upstream si vous l'acceptez. |
| Bibliothèques abaplint très actives (publications quotidiennes). Le contrat `KERNEL_RAP_EML` est récent ; l'accès aux méthodes privées passe par un détail interne du code généré (`FRIENDS_ACCESS_INSTANCE`). | moyenne | casse à la montée de version | Versions exactes épinglées, tests de contrat dédiés, montées de version explicites. |
| État global du runtime ABAP (`sy-*`, attributs statiques) partagé entre requêtes | certaine | données croisées entre requêtes | Appels ABP sérialisés ; montée en charge par processus. |
| Fidélité sémantique RAP (ordre des déterminations, triggers, codes HTTP, format des messages) | moyenne | comportement différent de SAP | Tests de comportement écrits d'après la documentation ABAP ; écarts listés dans KNOWN_GAPS. |
| Conformité OData V4 face à UI5 et FE (IEEE754Compatible, `$batch`, ETag, messages) | moyenne | UI qui ne fonctionne pas | Suite de conformité sur requêtes réelles + e2e avec le vrai ODataModel V4 d'OpenUI5. |
| Couverture CDS au-delà du MVP (CASE, CAST, jointures, paramètres, unions) | faible pour le MVP | parser ou SQL à étendre | Adaptateur isolé ; parser complémentaire si besoin. |
| Précision des horodatages (7 décimales en ABAP, 6 en PostgreSQL) | certaine | faible | Horodatages générés à la microseconde ; documenté. |
| Sécurité : injection via `$filter`, CSRF, XSS dans l'UI | faible | élevé | Requêtes paramétrées, liste blanche de propriétés, jeton CSRF, en-têtes CSP, tests dédiés. |
| Juridique : socle « clean-room » (`CL_ABAP_BEHAVIOR_HANDLER`…) | faible | moyen | Écrit de zéro d'après les signatures publiques ; aucun code SAP copié ; aucune dépendance SAP. |
| Durée et taille du build OpenUI5 | moyenne | faible | Build dans une étape Docker, avec cache ; CDN OpenUI5 en mode dev. |
| Docker indisponible dans certains environnements (comme celui-ci) | moyenne | e2e Docker non exécutables | E2E équivalents sur un PostgreSQL local ; job Docker en CI. |

Écarts déjà identifiés, qui iront dans KNOWN_GAPS.md : formes EML de V6 ; `IN LOCAL MODE` et
`PRIVILEGED` ignorés (V7) ; autorisations, feature control dynamique et side effects ignorés
avec avertissement ; conversion exits (ALPHA…) et conversion ISO des langues non gérées ;
précision des horodatages ; mandant ignoré ; exécution ABP sérialisée.

---

## 10. Fixture Travel / Booking

La fixture est livrée dans [fixtures/travel](fixtures/travel) (format abapGit) ; sa description
détaillée est dans [fixtures/travel/README.md](fixtures/travel/README.md). Les objets portent le
préfixe `ZRT_` pour éviter les collisions avec les objets des tutoriels RAP si on l'importe sur
un vrai système.

| Objet | Type | Rôle |
|---|---|---|
| `ZRT_TRAVEL`, `ZRT_BOOKING` | TABL | Tables persistantes |
| `ZRT_R_TRAVEL` | DDLS | Root view entity, `composition [0..*] of ZRT_R_Booking` |
| `ZRT_R_BOOKING` | DDLS | View entity enfant, `association to parent` |
| `ZRT_C_TRAVEL`, `ZRT_C_BOOKING` | DDLS, DDLX | Projections et annotations UI |
| `ZRT_R_TRAVEL`, `ZRT_C_TRAVEL` | BDEF | Comportement managed strict(2) et projection |
| `ZBP_RT_R_TRAVEL` | CLAS | Behavior pool |
| `ZRT_UI_TRAVEL`, `ZRT_UI_TRAVEL_O4` | SRVD, SRVB | Service et binding OData V4 |

Par rapport à l'esquisse initiale, la fixture couvre davantage de fonctionnalités non-draft
(décision D14) : autorisation globale, feature control d'instance sur l'action `acceptTravel`,
action interne `reCalcTotalPrice` appelée par deux déterminations `calculateTotalPrice`
(sur Travel et sur Booking), avec une lecture `READ … BY \_Booking` et `READ … BY \_Travel`.

---

## 11. Décisions prises

Le porteur du projet a délégué les choix techniques, avec une exigence : toutes les
fonctionnalités d'un BO RAP non-draft doivent être respectées. Les recommandations ont toutes
été retenues, avec trois ajustements dus à cette exigence. Le détail est dans
[docs/DECISIONS.md](docs/DECISIONS.md).

| # | Décision | Ajustement |
|---|---|---|
| 1 | Grammaire BDEF Chevrotain, parser abaplint comme oracle (D1) | |
| 2 | Types dérivés générés + réécriture de l'ABP (D2) | La passe abaisse aussi `READ … BY \_assoc`, `LINK` et `CREATE BY \_assoc`, que le transpiler ne traite pas : ce sont des fonctionnalités courantes d'un BO non-draft. |
| 3 | Fastify (D3) | |
| 4 | Lectures via des vues SQL générées (D4) | |
| 5 | Ajouts au périmètre OData (D5) | |
| 6 | Chemin du service calqué sur RAP, configurable (D6) | |
| 7 | Fixture activable sur un vrai système (D7) | L'autorisation globale de la fixture est réellement exécutée, plus seulement acceptée. |
| 8 | Horodatages en `timestamptz(6)` (D8) | |
| 9 | Mandant retiré (D9) | |
| 10 | OpenUI5 1.136 LTS, `sap.m`, `sap.f`, `sap.uxap` (D10) | |
| 11 | Exécution ABP sérialisée (D11) | Le verrou est réentrant pour le LUW qui le détient. |
| 12 | `@rap-transpiler/*`, CLI `rapt`, licence MIT (D12) | |
| 13 | Extrait du corpus SAP-samples pour tester les parsers (D13) | |

Décisions complémentaires (D14 à D21) : périmètre non-draft complet, runtime piloté par l'IR,
représentation canonique des valeurs, chaîne d'outils, PGlite pour les tests, DDIC « ombre »
pour le transpiler, sémantique de `mandatory`, déclenchement des déterminations.

---

## Annexe A — requêtes de la suite de conformité

Formes envoyées par le ODataModel V4 d'UI5 et par une List Report / Object Page Fiori Elements
V4. Chemins relatifs à la racine du service, sauf la première ligne.

```
HEAD /sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001/       X-CSRF-Token: Fetch
GET  $metadata                                                         Accept: application/xml
POST $batch                         Content-Type: multipart/mixed;boundary=batch_id-1731160000000-12

--batch_id-1731160000000-12
Content-Type:application/http
Content-Transfer-Encoding:binary

GET Travel?$count=true&$select=AgencyID,BeginDate,CurrencyCode,EndDate,OverallStatus,TotalPrice,TravelID,TravelUUID&$skip=0&$top=30 HTTP/1.1
Accept:application/json;odata.metadata=minimal;IEEE754Compatible=true
Accept-Language:fr


--batch_id-1731160000000-12--
```

| # | Cas | Requête (dans le `$batch`) |
|---|---|---|
| 1 | Liste initiale | `GET Travel?$count=true&$select=…&$skip=0&$top=30` |
| 2 | Barre de filtres | `GET Travel?$count=true&$filter=OverallStatus eq 'O' and (AgencyID eq '070001' or AgencyID eq '070002')&$select=…&$skip=0&$top=30` |
| 3 | Intervalle de dates | `$filter=BeginDate ge 2026-01-01 and BeginDate le 2026-12-31` |
| 4 | Contient, commence par | `$filter=contains(Description,'Paris')`, `$filter=startswith(TravelID,'000')` |
| 5 | Exclusion | `$filter=not (OverallStatus eq 'X')`, `$filter=OverallStatus ne 'X'` |
| 6 | Tri | `$orderby=BeginDate desc,TravelID` |
| 7 | Recherche | `$search=Paris` |
| 8 | Défilement | `$skip=30&$top=30` |
| 9 | Object Page | `GET Travel(3f2504e0-4f89-11d3-9a0c-0305e82c3301)?$select=…` |
| 10 | Table de l'Object Page | `GET Travel(3f2504e0-…)/_Booking?$count=true&$orderby=BookingID&$select=BookingID,BookingUUID,CurrencyCode,FlightDate,FlightPrice&$skip=0&$top=10` |
| 11 | Expand | `GET Booking(…)?$select=…&$expand=_Travel($select=TravelID,TravelUUID)` |
| 12 | Modification (changeset) | `PATCH Travel(…)`, `If-Match: W/"…"`, corps `{"EndDate":"2026-12-24"}` |
| 13 | Création avec enfants (changeset) | `POST Travel`, corps `{"TravelID":"00000042", …, "_Booking":[{…}]}` |
| 14 | Création d'un enfant (changeset) | `POST Travel(…)/_Booking` |
| 15 | Suppression (changeset) | `DELETE Booking(…)`, `If-Match: W/"…"` |
| 16 | Action | `POST Travel(…)/com.sap.gateway.srvd.zrt_ui_travel.v0001.acceptTravel`, `If-Match`, corps `{}`, éventuellement suivi de `?$select=…` |
| 17 | Cas d'erreur | ETag périmé → 412 ; `If-Match` absent → 428 ; propriété inconnue dans `$select` → 400 ; validation en échec → 400 avec `details[].target` ; clé inexistante → 404 |
