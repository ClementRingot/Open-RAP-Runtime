# Décisions techniques

Décisions prises le 2026-11-09, après validation du principe par le porteur du projet
(« prends les décisions techniques que tu penses les meilleures ; toutes les fonctionnalités
d'un BO RAP non-draft doivent être respectées »). Chaque entrée donne la décision, la raison
et la conséquence. Les numéros D1 à D13 correspondent aux points 1 à 13 du §11 de PLAN.md.

## D1 — Grammaire BDEF écrite avec Chevrotain

- **Décision** : grammaire Chevrotain pour les BDEF (behavior managed et projection) ;
  le parser BDEF d'abaplint sert d'oracle dans les tests.
- **Pourquoi** : AST typé, messages d'erreur positionnés, contrôle total sur le traitement des
  constructions hors périmètre. Le parser d'abaplint ne produit qu'un arbre générique.
- **Conséquence** : deux parsers à maintenir alignés ; un test compare les entités, alias et
  opérations trouvés par chacun.

## D2 — ABP : types dérivés générés et réécriture source à source

- **Décision** : le compilateur génère, pour chaque BDEF managed, une interface ABAP
  (`ZRAP_DT_<BDEF>`) contenant les types dérivés RAP (`%tky`, `%control`, tables `FOR …`,
  réponses `FAILED/REPORTED/MAPPED`, demandes et résultats d'autorisation et de feature control),
  puis réécrit le behavior pool avant de le donner au transpiler :
  signatures des handlers, références `TYPE TABLE|STRUCTURE|RESPONSE FOR …`, suppression de
  `FOR BEHAVIOR OF`, et **toutes** les instructions EML (`READ`, `MODIFY`, `COMMIT`, `ROLLBACK
  ENTITIES`, formes longues et courtes) abaissées en appels de la classe noyau `ZRAP_EML`
  (`begin`, opérations, `end`). Les `#` des opérandes deviennent le type dérivé attendu ; les
  déclarations en ligne (`RESULT DATA(x)`) sont remontées en `DATA x TYPE …`.
- **Ajustement (J4)** : l'EML est analysé par un parser à base de jetons propre au projet
  (`gen/abap/eml.ts`), et non plus laissé à l'abaissement du transpiler : abaplint ne reconnaît
  pas toutes les formes (`CREATE AUTO FILL CID SET FIELDS WITH` est une instruction inconnue pour
  lui), et l'abaissement du transpiler perdait `IN LOCAL MODE`, `BY \_assoc`, `LINK` et
  `CREATE BY`. Le contrôle ABAP complet (types compris) s'exécute sur les sources réécrites, avec
  la configuration du transpiler ; chaque remplacement garde le nombre de lignes du texte
  remplacé, de sorte que les erreurs (ABP004) pointent sur la ligne d'origine.
- **Pourquoi** : abaplint type ces constructions en `void` et le transpiler refuse alors l'ABP.
  Le PoC (PLAN.md, V10) a prouvé l'approche avec les paquets publiés ; J4 l'a généralisée.
- **Conséquence** : on ne patche ni ne monkeypatche jamais le transpiler ou le runtime ; on leur
  donne de l'ABAP standard. Les méthodes de `ZRAP_EML`, classe « clean-room » du projet, sont
  remplacées à l'exécution par le noyau JavaScript (`runtime/src/rap/kernel.ts`). Toute
  construction que la passe ne sait pas traiter produit un diagnostic (ABP005 à ABP007) et une
  entrée dans KNOWN_GAPS.md. Une contribution upstream (types dérivés dans abaplint) reste
  souhaitable ; elle est publique et ne sera proposée qu'avec l'accord du porteur du projet.

## D3 — Fastify plutôt qu'Express

- **Pourquoi** : `inject()` permet de tester le serveur sans réseau ; plugins encapsulés ;
  bon typage TypeScript ; performances.

## D4 — Lectures OData via des vues SQL générées

- **Décision** : chaque vue CDS devient une vue PostgreSQL (`zr_*` sur les tables, puis `zc_*`
  sur `zr_*`). Les lectures OData interrogent les vues `zc_*` ; les écritures passent par le
  runtime RAP, vers les tables.
- **Pourquoi** : c'est la séparation de RAP (requête via la projection CDS, transaction via le
  BO). Les expressions CDS futures (CASE, CAST…) se traduiront directement en SQL.

## D5 — Périmètre OData étendu à ce qu'une List Report / Object Page V4 envoie

- **Décision** : en plus de la liste initiale : navigation `Entité(…)/_Assoc` (lecture et
  création), `ge`, `le`, `not`, `startswith`, `endswith`, segment `/$count`, `$search` simple,
  jeton CSRF, `IEEE754Compatible=true`, deep insert sur un niveau, en-tête `sap-messages`,
  références `$<Content-ID>` dans un changeset, paramètres `sap-*` ignorés.
- **Pourquoi** : sans eux, une application Fiori Elements V4 (ou notre UI OpenUI5, qui utilise le
  même ODataModel) ne fonctionne pas entièrement.

## D6 — Chemin du service calqué sur RAP

- **Décision** : par défaut `/sap/opu/odata4/sap/<binding>/srvd/sap/<srvd>/0001/`, configurable.
- **Pourquoi** : une application Fiori Elements existante peut pointer sur le service sans
  modifier son manifest.

## D7 — Fixture activable telle quelle sur un vrai système

- **Décision** : la fixture `fixtures/travel` est un export abapGit complet et cohérent
  (strict(2), autorisation globale, numérotation managed…). L'autorisation n'est plus ignorée :
  elle fait partie des fonctionnalités non-draft prises en charge (D14).
- **Pourquoi** : le comportement de référence peut être vérifié sur un système SAP.

## D8 — Horodatages en `timestamptz(6)`

- **Décision** : `TIMESTAMPL`/`UTCLONG` → `timestamptz(6)`, `TIMESTAMP` → `timestamptz(0)`.
- **Pourquoi** : type naturel en SQL et pour les filtres OData. Les horodatages générés par le
  runtime sont à la microseconde, ce qui garde les ETag stables.
- **Conséquence** : la septième décimale ABAP est perdue (KNOWN_GAPS.md).
- **Ajustement (J4)** : `@abaplint/runtime` 2.14.24 stocke les nombres packed sous forme exacte
  (entier `BigInt` mis à l'échelle). Les conversions entre le buffer et l'ABAP passent par du
  texte (`toFixed`) : un `TIMESTAMPL` arrive intact dans l'ABP et en revient intact. Seules les
  opérations arithmétiques du runtime sur des packed passent par des nombres JavaScript
  (KNOWN_GAPS.md). Les ETag sont des valeurs canoniques du buffer, jamais recalculées par l'ABP.

## D9 — Mandant retiré

- **Décision** : la colonne `CLNT` (`CLIENT`, `MANDT`) est retirée des tables ; application
  mono-tenant.

## D10 — UI OpenUI5 1.136 LTS en freestyle

- **Décision** : contrôles `sap.m`, `sap.f`, `sap.uxap`, `sap.ui.layout`, thème `sap_horizon`,
  ODataModel V4 avec `autoExpandSelect`. `sap.ui.mdc` est une évolution possible.
- **Pourquoi** : bibliothèques Apache-2.0 ; le ODataModel V4 est celui de Fiori Elements V4.
- **Réalisation (J5)** : `rapt build` écrit `ui/` : une vue XML de List Report par entity set
  racine et une vue d'Object Page par entity set, générées depuis les annotations `@UI` (même
  dérivation que le CSDL), et des contrôleurs génériques pilotés par `ui/model/layout.json`
  (filtres, recherche, création non-draft, édition et sauvegarde par `submitBatch`, suppression,
  actions avec dialogue de paramètres, actions factory, tables de compositions éditables,
  messages). Le feature control passe par `__OperationControl`, `__EntityControl` et
  `__FieldControl`, que l'ODataModel sélectionne lui-même.

## D11 — Exécution ABP sérialisée, réentrante dans un même LUW

- **Décision** : un verrou par processus encadre les appels ABP ; il est réentrant pour le LUW
  qui le détient (une détermination qui exécute une action interne ne se bloque pas elle-même).
- **Pourquoi** : le runtime abaplint a un état global (`sy-*`, attributs statiques).
- **Conséquence** : montée en charge par processus ou conteneurs.
- **Réalisation (J4)** : `RapRuntime.transaction` enchaîne les LUW sur une promesse (un LUW à la
  fois par processus) ; le LUW courant est porté par `AsyncLocalStorage`, ce qui rend réentrants
  les appels EML des handlers. Entre processus, les verrous sont des verrous de ligne PostgreSQL
  (`SELECT … FOR UPDATE NOWAIT` sur l'instance du `lock master`, cause `locked` si refusé).

## D12 — Nommage et licence

- **Décision** : paquets `@rap-transpiler/model`, `@rap-transpiler/compiler`,
  `@rap-transpiler/runtime` ; CLI `rapt` ; licence MIT pour ce dépôt.

## D13 — Corpus de test des parsers

- **Décision initiale** : un extrait de sources BDEF et CDS des dépôts SAP-samples (Apache-2.0).
- **Ajustement (J1)** : les dépôts SAP-samples ont été réorganisés et leurs chemins ne sont plus
  trouvables par la recherche de code. Le corpus est donc écrit pour le projet
  (`packages/compiler/test/bdef-parser.test.ts`) : noms à namespace, options d'opérations,
  actions statiques, factory et internes, fonctions, side effects, mappings `control`, et les
  constructions hors périmètre (draft, late numbering, événements…). Les mêmes sources sont
  comparées au parser BDEF d'abaplint (D1). Un extrait SAP-samples pourra s'ajouter plus tard.

## D14 — Périmètre fonctionnel : un BO RAP managed non-draft complet

- **Décision** : la cible est l'ensemble des fonctionnalités d'un BO managed sans draft, suivi
  dans [FEATURES.md](FEATURES.md). Cela ajoute au MVP initial : autorisations (globales et
  d'instance), feature control statique et dynamique, numérotation externe, actions statiques,
  factory, internes et avec paramètre, déterminations on save, precheck, side effects (CSDL),
  messages T100, lectures et créations par association dans l'ABP.
- **Restent hors périmètre**, avec leur raison dans FEATURES.md : draft (exclu par le cahier des
  charges), implémentation unmanaged, late numbering, événements, change documents, extensions,
  analytique. `with additional save` et `with unmanaged save`, d'abord exclus, sont pris en
  charge depuis D30.

## D15 — Runtime générique piloté par l'IR

- **Décision** : l'application générée contient un runtime générique (`@rap-transpiler/runtime`)
  qui lit `model.json`. Seuls le SQL, le CSDL, le JavaScript de l'ABP, l'UI et le packaging sont
  générés. Le runtime est embarqué sous forme de tarball dans `vendor/`.
- **Pourquoi** : un seul runtime testé pour tous les BO ; une sortie autonome sans registre privé.
- **Ajustement (J6)** : plutôt qu'un tarball, `vendor/` contient les paquets `runtime` et `model`
  compilés (`dist/` et un `package.json` de production) ; leur version porte une empreinte de
  leur contenu, pour que `npm install` les mette à jour après un nouveau `rapt build`. Le
  `.npmrc` (`install-links=true`) les installe comme des paquets ordinaires. `server.mjs` appelle
  `start()` du runtime, configuré par variables d'environnement (`.env.example`).

## D16 — Représentation canonique des valeurs

- **Décision** : dans le buffer transactionnel, les valeurs sont des valeurs JavaScript
  canoniques : chaînes pour CHAR, NUMC et STRING (blancs finaux supprimés) ; chaînes pour les
  décimaux et INT8 (pas de perte de précision) ; `AAAA-MM-JJ` pour les dates (initiale = `null`) ;
  `HH:MM:SS` pour les heures ; ISO 8601 UTC à la microseconde pour les horodatages ; UUID en
  minuscules avec tirets ; booléens pour `ABAP_BOOLEAN`.
- **Pourquoi** : une seule forme pivot entre ABAP, SQL et OData ; les conversions sont isolées et
  testées.

## D17 — Chaîne d'outils

- **Décision** : TypeScript 7.0 (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM `NodeNext` avec spécificateurs
  `.js`, compilation `tsc` vers `dist/`, Vitest (alias vers les sources), workspaces pnpm.

## D18 — Base de données des tests

- **Décision** : PGlite (PostgreSQL en WASM, en processus) pour les tests d'intégration ; un vrai
  PostgreSQL pour l'e2e.

## D19 — DDIC « ombre » pour le transpiler

- **Décision** : le registre passé au transpiler reçoit les tables du modèle avec des types
  prédéfinis (DATATYPE, LENG, DECIMALS), les éléments de données du catalogue standard et du
  projet ; pas de vues CDS.
- **Pourquoi** : la couche SQL du transpiler échoue sur les associations et ne connaît pas les
  éléments de données SAP standard ; les types de l'ABP viennent de l'interface dérivée (D2) ;
  notre SQL vient de l'IR.
- **Conséquence** : un type `TYPE zr_travel` (vue CDS) n'était pas disponible dans l'ABP ; les
  types dérivés et les tables l'étaient.
- **Ajusté (D26)** : les entités CDS sont données comme tables « ombre » de mêmes nom et éléments
  (types prédéfinis, sans associations), pour l'ABAP SQL ; `TYPE zr_travel` est donc typé. Les
  tables ombre n'ont plus de colonne mandant (D9). Les vues CDS elles-mêmes restent hors du
  registre du transpiler.

## D20 — `field ( mandatory )` sans contrôle à l'exécution

- **Décision** : comme RAP, aucun contrôle runtime ; `Common.FieldControl` Mandatory dans le
  CSDL et champ requis dans l'UI. `mandatory : create`, lui, est contrôlé à la création, comme
  dans RAP.

## D21 — Déclenchement des déterminations et validations

- **Décision** : les déterminations on modify s'exécutent à la fin de chaque requête de
  modification, par tours successifs : un tour traite les instances dont un trigger a été touché
  depuis le passage précédent de cette détermination ; une détermination n'est pas redéclenchée
  par ses propres modifications ; la boucle est bornée (erreur au-delà de 20 tours).
  Les validations et les déterminations on save s'exécutent dans la séquence de sauvegarde, sur
  les changements cumulés du LUW.

## D22 — Causes d'échec RAP et statuts HTTP

- **Décision** : la première entrée de `failed` donne le statut de l'erreur OData :
  `unspecific` 400, `unauthorized` 403, `not_found` 404, `locked` et `conflict` 409, `readonly`
  400, `disabled` 409, `dependency` 424 ; un `If-Match` absent sur PATCH, PUT et DELETE d'une
  entité à ETag donne 428, un ETag périmé 412. Le message principal est le premier message
  d'erreur de `reported` ; les autres messages vont dans `details`. Sans message, un texte
  générique décrit la cause (« Travel(…) is locked by another user »).
- **Pourquoi** : SAP ne publie pas de table de correspondance ; ces statuts sont ceux du
  protocole HTTP pour chaque cause, et Fiori elements affiche le message quel que soit le statut.

## D23 — Un LUW par requête ou par change set ; réponses rendues après le commit

- **Décision** : une requête de modification (ou un change set de `$batch`) est un LUW : les
  opérations, les déterminations on modify à la fin de chaque requête (D21), puis la séquence de
  sauvegarde, dans une transaction PostgreSQL. Les réponses (entité créée, résultat d'action…)
  sont lues après le commit dans les vues de projection ; dans un change set, elles sont
  différées jusqu'à la fin du change set. Un échec annule tout le change set, qui reçoit une seule
  réponse d'erreur.
- **Pourquoi** : la réponse montre l'état sauvegardé (déterminations, champs d'administration,
  ETag), comme RAP, et les lectures n'ont jamais à voir le buffer non sauvegardé. Les navigations
  d'une écriture (`$1/_Booking`, `Travel(…)/_Booking(…)`) sont résolues dans le LUW, qui voit les
  instances créées plus tôt dans le change set.

## D24 — Socle ABAP « clean-room » étendu

- **Décision** : en plus de `if_abap_behv`, `cl_abap_behavior_handler` et `cl_abap_context_info`,
  le compilateur fournit `if_message`, `if_t100_message`, `if_t100_dyn_msg`,
  `if_abap_behv_message`, `cx_root` (et `cx_static_check`, `cx_dynamic_check`, `cx_no_check`,
  les classes des erreurs d'exécution), `cl_system_uuid`, la structure `scx_t100key` et les
  éléments de données standard du catalogue DDIC. Le texte d'une exception est son message T100,
  ses attributs résolus par nom (méthode native `ZRAP_EML=>exception_text`).
- **Pourquoi** : les behavior pools réels utilisent des classes d'exception de messages (motif
  `/DMO/CM_FLIGHT_MESSAGES`), `cl_system_uuid` et ces types. Le transpiler fait de toute classe
  nommée `CX_ROOT` une sous-classe d'`Error` JavaScript : il suffit de la fournir.
- **Conséquence** : ces objets sont écrits à partir des signatures publiques de SAP (LICENSES.md) ;
  un objet du projet de même nom a priorité.

## D25 — Contrôles de l'interface OData des écritures

- **Décision** : les propriétés `readonly`, de numérotation managed et les champs
  d'administration envoyés par un client OData sont ignorés (comme `Core.Computed` le prévoit) ;
  une propriété inconnue donne 400. Les opérations non exposées (`use create` absent, opération
  `internal`) donnent 405. Les clés d'une entité ne changent pas par PATCH (400).
  Le feature control (`__EntityControl`, `__OperationControl`, `__FieldControl`) n'est calculé que
  si la requête sélectionne ces propriétés (ou n'a pas de `$select`). Le feature control global
  d'`update`, de `delete` et des actions d'instance y figure aussi, avec la même valeur pour toutes
  les instances : RAP le présente comme le feature control d'instance (« consumer hint »).
  Dans les vues générées, ces valeurs sont lues par `%{…}` (valeur brute) : `${…}` donnerait le
  texte formaté par le type OData (`"1"` pour un Edm.Byte), et la comparaison échouerait.
- **Pourquoi** : c'est le comportement attendu par l'ODataModel V4 de Fiori elements ; le calcul
  du feature control appelle l'ABP et ne doit pas pénaliser les lectures qui ne l'utilisent pas.

## D26 — ABAP SQL en lecture dans l'ABP

- **Décision initiale** : toute instruction ABAP SQL dans un behavior pool était une erreur de
  compilation (ABP007), faute de connexion à la base pour le runtime abaplint.
- **Décision révisée** : `SELECT` (simple, `SINGLE`, `INTO TABLE`, `FOR ALL ENTRIES`, jointures,
  agrégats, sous-requêtes, `SELECT … ENDSELECT` avec `SELECT *`) lit les tables et les entités
  CDS du projet. Les écritures (`INSERT`, `UPDATE`, `MODIFY`, `DELETE` sur une table) sont
  refusées dans les handlers (ABP007) : un BO managed est écrit par le runtime RAP, le code le
  modifie par EML. Elles sont permises dans le saver (`save_modified`) d'un BO avec additional ou
  unmanaged save (D30). Les expressions de table communes (`WITH`) restent refusées.
- **Réalisation** :
  - le SQL que génère `@abaplint/transpiler` suppose des colonnes au format ABAP (ses propres
    schémas stockent les dates en `NCHAR(8)`, les UUID en 32 chiffres hexadécimaux). Le schéma
    généré ajoute donc un schéma `rapt_abap` de vues, une par table (sans colonne mandant, D9) et
    par entité CDS, noms de colonnes en minuscules : dates `YYYYMMDD`, heures `HHMMSS`, UUID et
    binaires en hexadécimal majuscule, booléens `X`/espace, horodatages en nombres packed
    (`YYYYMMDDhhmmss.fffffff`), valeurs initiales ABAP à la place des `NULL`. Les types caractère
    de longueur fixe deviennent `bpchar`, dont les comparaisons ignorent les blancs finaux comme
    ABAP. `abap.dbo.schemaPrefix` (option du runtime abaplint) fait lire ces vues au code transpilé ;
  - le runtime enregistre un client de base de données en lecture seule (`DatabaseClient` du
    runtime abaplint) qui exécute la requête dans la transaction de la LUW en cours, après une
    traduction vers PostgreSQL : `UP TO n ROWS` → `LIMIT`, `ORDER BY PRIMARY KEY`, `ASCENDING`,
    opérateurs `EQ`/`GE`…, `alias~champ`, identifiants en minuscules. Seules les vues de
    `rapt_abap` sont lisibles. Chaque requête s'exécute dans un savepoint : une erreur SQL laisse
    la transaction de la LUW utilisable. `COMMIT WORK`/`ROLLBACK WORK` sont une erreur à
    l'exécution, comme dans RAP ;
  - les entités CDS sont données au transpiler comme tables « ombre » de mêmes nom et éléments
    (D19) : `SELECT FROM zr_travel` et `DATA ls TYPE zr_travel` sont typés ;
  - abaplint ne type pas la déclaration en ligne du résultat d'un littéral, d'un agrégat autre
    que `COUNT(*)` ou d'une expression : la méthode transpilée échouerait à son démarrage. La
    passe de réécriture déclare les deux formes les plus courantes (test d'existence
    `SELECT SINGLE @abap_true … INTO @DATA(x)` : `abap_boolean` ; `MAX( col )`/`MIN( col )` d'une
    seule source, motif de numérotation du tutoriel RAP100 : le type de la colonne) ; les autres
    sont signalées à la compilation (ABP009) ;
  - `MESSAGE … INTO` prend ses textes dans les classes de messages du projet.
- **Sémantique** : comme dans RAP, `SELECT` lit la base, pas le buffer transactionnel : les
  changements non sauvegardés de la LUW n'y sont pas visibles (lire le BO par EML pour cela).
- **Pourquoi** : la lecture SQL de tables de contrôle, l'unicité d'un identifiant ou la
  numérotation par `MAX` sont courantes dans les behavior pools réels ; des vues au format ABAP
  laissent le SQL du transpiler presque intact et donnent la sémantique ABAP des comparaisons.
  Contrepartie : une condition sur une colonne convertie (date, UUID, horodatage) ne peut pas
  utiliser d'index (KNOWN_GAPS.md).
- **Correction associée** : l'échec d'un verrou (`FOR UPDATE NOWAIT`) laissait la transaction
  PostgreSQL de la LUW en état d'erreur ; il est lui aussi isolé dans un savepoint (test
  `rap-locks.test.ts` sur un vrai PostgreSQL).

## D27 — Ressources OpenUI5 servies depuis les paquets npm

- **Décision** : le runtime sert `/resources/` à partir des paquets npm d'OpenUI5 (`@openui5/*`
  1.136, Apache-2.0) : les sources des bibliothèques telles quelles, et les thèmes compilés à la
  première demande avec `less-openui5` (Apache-2.0), puis gardés en mémoire. `/ui/` sert
  l'application générée.
- **Pourquoi** : le CDN d'OpenUI5 n'est pas toujours joignable (il ne l'est pas depuis
  l'environnement de développement de ce projet) et une application autonome ne doit pas en
  dépendre ; npm suffit, sans outillage UI5 au démarrage. Le premier chargement demande environ
  400 modules : un bundle construit par l'outillage UI5 (`ui5 build`) est prévu pour l'image
  Docker (J6).

## D28 — Sessions OIDC sans dépendance supplémentaire

- **Décision** : le flux « authorization code » avec PKCE est écrit avec `jose` (déjà utilisé
  pour les jetons porteurs) : état de connexion et session dans des cookies signés (HMAC-SHA256,
  HttpOnly, SameSite=Lax), sans stockage côté serveur ; jeton CSRF lié à la session ; découverte
  possible sur une URL interne (`OIDC_DISCOVERY_URL`) distincte de l'émetteur public. Les tests
  utilisent un fournisseur OIDC écrit pour eux (découverte, autorisation, jeton, JWKS).
- **Ajustement du PLAN.md** : `openid-client`, `@fastify/secure-session` et `oauth2-mock-server`
  ne sont pas ajoutés. `openid-client` exige que l'émetteur soit l'URL de découverte, ce qui ne
  convient pas à Keycloak dans docker-compose (le navigateur voit `localhost:8180`, le conteneur
  de l'application `keycloak:8080`).
- **Conséquence** : la session dure 8 heures (`maxAge`) ; il n'y a ni rafraîchissement de jeton,
  ni révocation côté serveur avant expiration (KNOWN_GAPS.md).

## D29 — Test de bout en bout et CI

- **Décision** : le test e2e (`packages/runtime/test/e2e.test.ts`) part de la CLI compilée :
  `rapt build` de la fixture, `npm install` de l'application générée, `node server.mjs` sur un
  vrai PostgreSQL (celui de `RAPT_E2E_DATABASE_URL`, sinon un serveur démarré pour le test, sinon
  PGlite), puis le service OData et l'UI dans Chromium. La CI fournit un service PostgreSQL 16 et
  Chromium. Un second job construit l'image et démarre le `docker-compose.yml` généré
  (`--wait`, contrôles HTTP du service et de l'UI). Vérifié aussi dans l'environnement de
  développement : image construite, PostgreSQL et application démarrés par compose, création,
  création par association, action et UI servies par le conteneur.
- **Pourquoi** : c'est l'artefact livré qui est testé, pas les sources du runtime.
- **Note** : TypeScript 7.0.2 compile `new (x as T).Builder()` sans les parenthèses ; seul le
  JavaScript compilé (dist) le montre, Vitest compilant les sources autrement. Le test e2e, qui
  exécute le dist, l'a révélé ; le code évite cette forme.

## D30 — Additional et unmanaged save dans un BO managed

- **Décision** : `managed with additional save` et `managed with unmanaged save` (en-tête de la
  BDEF, ou `with additional save` / `with unmanaged save` par entité, `with full data` accepté)
  sont pris en charge, avec la classe saver locale du behavior pool (`lsc_…` héritant de
  `cl_abap_behavior_saver` ou `cl_abap_behavior_saver_failed`) : `save_modified` (obligatoire) et
  `cleanup`. Additional save : le runtime écrit les tables persistantes, puis appelle
  `save_modified`. Unmanaged save : l'entité n'a pas de table persistante, le runtime lit et
  verrouille les instances à travers la vue CDS et `save_modified` les écrit.
- **Réalisation** :
  - types dérivés `TYPE TABLE FOR CHANGE`, `TYPE REQUEST FOR CHANGE` et `TYPE REQUEST FOR DELETE` ;
    la passe de réécriture déclare `save_modified` avec ses paramètres (`create`, `update`,
    `delete`, `reported`, et `failed` pour `cl_abap_behavior_saver_failed`) ; `adjust_numbers`
    (late numbering) est refusé (ABP007) ;
  - les écritures ABAP SQL ne sont permises que dans la classe saver (ABP007 ailleurs) et, à
    l'exécution, pendant `save_modified` seulement. Les formes propres à RAP
    (`… FROM [TABLE] @source [INDICATORS SET STRUCTURE %control] MAPPING FROM ENTITY`), que le
    transpiler ne connaît pas, sont abaissées vers le kernel, qui applique le mapping de la BDEF
    et écrit avec les types de la base, valeurs exactes ;
  - les autres écritures passent par le transpiler et les vues du schéma `rapt_abap` (D26) : un
    trigger `INSTEAD OF` par table écrit la table, valeurs reconverties depuis leur forme ABAP
    (fonctions `rapt_abap.to_date`, `to_uuid`, `to_timestamp`…) ;
  - les lignes de `update` portent toutes les valeurs (comme `with full data`), `%control` les
    champs modifiés ; `delete` contient aussi les compositions supprimées en cascade ;
  - un `failed` du saver (`cl_abap_behavior_saver_failed`) annule la LUW, comme une validation ;
    les messages de `reported` sont renvoyés au client ;
  - toutes les tables transparentes du projet entrent dans le modèle (base et types du
    transpiler), pas seulement celles des vues CDS et des tables persistantes : une table de log
    ou de contrôle est lisible et inscriptible par l'ABAP SQL. Une table qu'aucune entité
    n'utilise et qui ne peut être construite est laissée de côté (information DDIC005).
- **Défaut du transpiler contourné** : `DELETE dbtab FROM @wa` lui fait perdre la ligne, et la
  requête supprimerait toute la table : refusé à la compilation (ABP007) et, par sécurité, un
  `DELETE` sans condition est refusé à l'exécution.
- **Pourquoi** : c'est le moyen RAP d'écrire des tables existantes ou de journaliser les
  changements d'un BO, fréquent dans les projets réels ; l'ABAP SQL du saver réutilise les vues de
  D26.

## D31 — Consommation d'API distantes dans l'ABP (HTTP, client proxy OData, SCM et SCM2)

- **Décision** : un behavior pool peut appeler des API distantes avec les API d'ABAP Cloud,
  réécrites en clean-room d'après leurs signatures publiques :
  - client HTTP : `cl_http_destination_provider` (`create_by_url`,
    `create_by_comm_arrangement`, `create_by_cloud_destination`), `cl_web_http_client_manager`,
    `if_web_http_client`, `if_web_http_request` (chemin, requête, en-têtes, corps texte ou
    binaire, formulaire, authentification basic ou bearer), `if_web_http_response`,
    `if_web_http_header`, `if_a4c_cp_service` ;
  - client proxy OData du service consumption model : `/iwbep/cl_cp_factory_remote` et
    `cl_web_odata_client_factory` (`create_v2_remote_proxy`, `create_v4_remote_proxy`) ;
    lecture de liste (`create_by_range` des filtres combinés par `and`/`or`/`not`, `$select`,
    `$orderby`, `$top`, `$skip`, `request_count`, `request_no_business_data`), lecture par clé
    (`navigate_with_key`), création, mise à jour (`PATCH`/`PUT`, propriétés fournies,
    `set_if_match`), suppression ;
  - exceptions `cx_http_dest_provider_error`, `cx_web_http_client_error`,
    `cx_web_message_error`, `/iwbep/cx_gateway`, `/iwbep/cx_cp_remote` (`http_status_code`,
    `http_error_body`), avec le texte de l'erreur pour `get_text( )`.
- **Destinations** : sur SAP, elles viennent du destination service de BTP ou d'un
  communication arrangement ; l'application générée les lit dans son environnement :
  `DESTINATION_<NOM>_URL`, puis `_USER` et `_PASSWORD` (basic), `_TOKEN` (bearer) ou `_HEADERS`
  (objet JSON : clé d'API…). `<NOM>` est le nom de `create_by_cloud_destination`, ou
  `<SCENARIO>_<SERVICE_ID>` puis `<SCENARIO>` pour `create_by_comm_arrangement`
  (`comm_system_id` ignoré). Les identifiants restent dans le noyau : l'ABAP ne voit que l'URL.
  `rapt build` liste les destinations nommées par des littéraux dans le `.env.example` et le
  README de l'application.
- **Service consumption model** :
  - SCM2 : la classe de modèle de consommation (`INHERITING FROM
    /iwbep/cl_v4_abs_pm_model_prov`) est gardée pour ses types (`tys_…`, `tyt_…`) et ses
    constantes (`gcs_entity_set`, `gcs_entity_type`) ; la passe de réécriture retire la
    définition du modèle (`define`, `def_…`), écrite avec les interfaces `/iwbep/if_v4_pm_*` de
    SAP Gateway ;
  - SCM : les entités abstraites générées (champs `_vc` de value control compris) typent les
    données ; ce sont des structures pour l'ABAP (DDIC ombre). La définition de service générée
    pour le client proxy n'a pas de binding : quand il y a plusieurs définitions, celle qui a un
    binding est construite (SRVD007) ;
  - le proxy lit le `$metadata` du service distant une fois : entity sets, clés, types des
    propriétés. Les noms internes de l'ABAP (`TRAVEL_ID`, `'TRAVEL'`) sont rapprochés des noms
    EDM sans tenir compte de la casse ni des `_` (`TravelID`). Les valeurs sont converties selon
    le type EDM et le type ABAP : dates, heures, horodatages (`/Date(ms)/` en V2, ISO en V4 avec
    la précision de la propriété), UUID, décimaux exacts en texte (`IEEE754Compatible=true` en
    V4), booléens, binaire ; les blancs de fin des champs `c` ne sont pas envoyés ; l'ETag
    (`@odata.etag`, `__metadata.etag`) remplit le composant `etag` des classes SCM2 ;
  - requêtes modifiantes : jeton CSRF demandé par `HEAD` sur la racine du service
    (`X-CSRF-Token: Fetch`, désactivable par `iv_do_fetch_csrf_token`), cookies de session
    conservés, nouvel essai avec un nouveau jeton après `403` + `X-CSRF-Token: Required`, comme
    SAP Gateway le demande.
- **Réalisation** : l'ABAP garde l'état des objets (requête, en-têtes, filtres) ; le noyau
  (`ZRAP_EML`) fait les appels réseau (`fetch` de Node.js, 60 s par défaut ou `i_timeout`), lit
  le `$metadata` (fast-xml-parser, déjà utilisé par le compilateur) et convertit les valeurs.
- **Pourquoi** : appeler une API depuis une action, une détermination ou une validation est un
  besoin courant (extension side-by-side, enrichissement, contrôle d'un autre système) ; le
  développeur garde le code qu'il écrit sur SAP. Les classes de SAP Gateway n'existent pas hors
  d'un système SAP : elles sont réimplémentées, sans code SAP.
- **Tests** : `rap-variant-remote.test.ts` (API REST : destination avec basic auth, en-têtes,
  statut, destination absente, connexion refusée ; OData V4 avec une classe SCM2 vers
  l'application de la fixture servie sur un port : filtre, `$select`, `$orderby`, `$top`,
  `$count`, lecture par clé ; écritures V4 vers un service simulé : CSRF, cookies, ETags,
  renouvellement du jeton, erreur 409 ; OData V2 avec l'entité abstraite d'un SCM :
  `d.results`, `__count`, `/Date()/`), `http-client.test.ts`, `app-scaffold.test.ts`.

## D32 — ETag dépendant et ETag dans un change set

- **Décision** : une entité `etag dependent by _Assoc` a l'ETag de son maître : l'ETag est la
  valeur du champ ETag de l'instance maître atteinte par les associations `by` (une ou plusieurs,
  jusqu'à un `etag master`). Le service l'expose (`@odata.etag` des instances, en-tête `ETag`,
  `Core.OptimisticConcurrency` avec le chemin `_Travel/LocalLastChangedAt`) et contrôle
  `If-Match` sur les modifications de l'entité dépendante (428 sans en-tête, 412 si périmé).
- **Le maître change avec ses dépendants** : la règle SAP veut que le champ ETag soit mis à jour
  à chaque changement de l'instance qu'il couvre ; quand une instance dépendante est créée,
  modifiée ou supprimée, le runtime met à jour le champ ETag du maître s'il le gère (horodatage
  administratif `localInstanceLastChangedAt` ou `lastChangedAt`, maître écrit par le runtime),
  une fois par LUW, au moment de la sauvegarde. Un maître en unmanaged save ou avec un autre
  champ ETag doit être mis à jour par l'application.
- **`If-Match` dans un change set** : il est comparé à l'ETag de l'instance au début de la LUW,
  l'état que le client a lu. Les requêtes d'un change set portent les ETags lus avant lui : une
  modification antérieure du même change set (la requête précédente, ou une détermination qui
  recalcule le voyage quand une réservation change) ne les rend pas périmés. Les modifications
  des autres clients restent détectées : la LUW verrouille les instances qu'elle modifie.
- **Pourquoi** : sans cela, l'Object Page d'un BO non draft qui enregistre un voyage et ses
  réservations dans un même change set échouerait en 412 dès qu'une détermination touche le
  voyage ; et une entité dépendante n'aurait aucune protection de concurrence.
- **Réalisation** : modèle OData (`etagPath`), CSDL, lecture (sous-requêtes scalaires le long des
  navigations, dans les listes, les lectures unitaires et `$expand`), contrôle d'écriture
  (`Transaction.etagValue`), mise à jour du maître (`refreshEtagMasters`, avant l'écriture).
  Tests : `rap-variant-etag.test.ts`.
