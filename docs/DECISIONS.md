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

## D33 — PGlite et Keycloak éprouvés de bout en bout

- **PGlite** (`PGLITE_DIR`) : le test e2e démarre l'application générée sur sa base embarquée,
  crée un voyage, l'arrête et la redémarre : le schéma est réappliqué (idempotent) et les données
  sont là. Le test a révélé que l'application ne démarrait pas sur PGlite : le schéma était
  envoyé en une requête de plusieurs instructions, que le protocole étendu de PGlite refuse
  (`cannot insert multiple commands into a prepared statement`). Il est désormais découpé en
  instructions (`splitStatements` : littéraux, identifiants, corps `$f$…$f$` et commentaires
  respectés) et appliqué dans une transaction.
- **Keycloak** : `keycloak.test.ts` joue le navigateur contre un vrai Keycloak avec le realm
  généré : redirection vers Keycloak, envoi du formulaire de connexion d'`alice`, retour sur
  `/auth/callback` (code d'autorisation avec PKCE), session sur l'UI et sur le service OData
  (jeton CSRF, création attribuée à `ALICE`), déconnexion vers le point de fin de session de
  Keycloak ; puis un jeton porteur émis par Keycloak (client public créé par l'API
  d'administration, password grant) vérifié par le JWKS, et un jeton falsifié refusé. Exécuté
  contre la distribution Keycloak 26.8.2 (Maven Central, Java 21) dans l'environnement de
  développement, et en CI contre l'image du `docker-compose.yml` généré (`--profile oidc`).
- **CI** : le contrôle de santé du service PostgreSQL utilise `pg_isready -U postgres`.

## D34 — Autorisations : objets d'autorisation, rôles OIDC, AUTHORITY-CHECK

- **Problème** : l'ABAP environment répartit les autorisations entre l'IAM (IAM apps, business
  catalogs, business roles avec leurs restrictions, affectés aux business users) et le code
  (`AUTHORITY-CHECK` dans les handlers, contrôles d'accès DCL). Hors SAP, il n'y a pas d'IAM ;
  OIDC authentifie et transporte des rôles, mais ne dit pas quelles valeurs d'objets
  d'autorisation un rôle accorde. Le transpiler, lui, traduit `AUTHORITY-CHECK` en un appel à
  une classe noyau `KERNEL_AUTHORITY_CHECK` que l'application ne fournissait pas : l'instruction
  compilait mais échouait à l'exécution (500).
- **Décision** :
  - les objets d'autorisation viennent des sources abapGit (SUSO : champs `FIEL1…`, activités
    `TACTZ`), ou de la section `objects` du fichier des rôles ;
  - les rôles sont dans `rapt/authorizations.json`, à la racine du projet abapGit, versionné avec
    les sources (hors du dossier `src/`, abapGit l'ignore) : nom du rôle de l'IdP → autorisations,
    instances d'objets avec leurs valeurs, comme une business role et ses restrictions ;
  - valeurs à la manière de PFCG : valeur, motif `07*`, `*`, plage `{ "from", "to" }`, et valeurs
    issues d'un claim du jeton (`{claim:agency}` : l'agence de l'utilisateur, attribut de l'IdP),
    pour ne pas créer un rôle par valeur ;
  - `AUTHORITY-CHECK` est évalué par le noyau sur les rôles de l'utilisateur de la requête :
    `sy-subrc` 0 quand une autorisation de l'objet accepte tous les champs vérifiés (`DUMMY` n'est
    pas vérifié), 4 sinon, 12 sans autorisation pour l'objet, 40 pour `FOR USER` d'un autre
    utilisateur ; le code ABAP reste celui de SAP ;
  - l'IdP (Keycloak, Entra ID, SAP Cloud Identity Services…) affecte les rôles aux utilisateurs
    (`OIDC_ROLES_CLAIM`) et porte les attributs ; l'application garde les claims lus par les rôles
    (session comprise) ; `OIDC_REQUIRED_ROLE` reste le droit d'accès à l'application ;
  - en développement (`AUTH_MODE=none`), l'utilisateur a toutes les autorisations (comme SAP_ALL
    dans un système de développement), sauf si `DEV_ROLES` (et `DEV_ATTRIBUTES`) sont donnés ;
    `AUTHORIZATIONS_FILE` remplace les rôles au déploiement ;
  - le compilateur contrôle les rôles contre les objets (AUTH001…AUTH004) et les
    `AUTHORITY-CHECK` du code (ABP010, ABP011) ; le realm Keycloak généré contient les rôles
    (donnés à `alice`), un attribut utilisateur déclaré dans le profil et un mapper vers le jeton
    pour chaque claim lu.
- **Pourquoi** : le même behavior pool tourne sur SAP et ici ; la définition des rôles reste
  revue et versionnée comme les objets IAM ; l'administration des utilisateurs reste dans l'IdP.
- **Fixture** : le BO de référence vérifie l'objet `ZAO_TRAVL` (activité, agence) dans ses
  autorisations globale et d'instance, comme le scénario de référence /DMO/ de SAP ; rôles
  `travel_manager`, `travel_agent` (agence du claim `agency`), `travel_viewer`.
- **Tests** : `rap-authorizations.test.ts` (jetons signés localement), `authorizations.test.ts`
  (sémantique de `sy-subrc`), `authorizations.test.ts` du compilateur (diagnostics),
  `keycloak.test.ts` (un agent créé dans Keycloak avec son attribut d'agence).

## D35 — Contrôles d'accès (DCL) sur les lectures

- **Décision** : les rôles CDS des sources abapGit (objets DCLS : `define role R { grant select
  on E where … ; }`) restreignent les lignes que le service OData renvoie à l'utilisateur de la
  requête, dans les listes, `$count`, les lectures unitaires, `$expand` et les navigations. Une
  ligne est accordée quand une condition d'un rôle de l'entité est vraie ; une entité sans rôle
  est lisible entièrement (comme en ABAP CDS).
- **Conditions évaluées** : `( E1, E2 ) = aspect pfcg_auth( OBJ, F1, F2, ACTVT = '03' )` sur les
  autorisations de l'utilisateur (D34 : valeurs, motifs, plages, claims ; aucune autorisation →
  aucune ligne), `E ?= aspect user` / `= aspect user` (nom ABAP de l'utilisateur), comparaisons à
  des littéraux (format ABAP : dates `YYYYMMDD`), `like`, `is [not] null`, `and`, `or`, `not`,
  parenthèses, chemins d'une association to-one (`_Travel.AgencyID`, lu par une sous-requête sur
  la vue cible) et `inheriting conditions from entity B` : une projection reprend les
  conditions de sa vue de base, ses éléments renommés comme elle les expose.
- **Sécurité** : ce qui n'est pas évaluable (autres aspects, chemins plus longs, élément non
  exposé par la projection) n'accorde rien (refus par défaut), avec un diagnostic (DCL002,
  DCL003). Une lecture hors requête n'accorde rien. L'utilisateur de développement sans
  `DEV_ROLES` n'est pas restreint.
- **Ce qui n'est pas filtré** : l'EML et l'ABAP SQL du behavior pool (comme `WITH PRIVILEGED
  ACCESS`) ; les modifications passent par l'autorisation d'instance, comme dans RAP.
- **Réalisation** : parseur DCL (`dcl/parser.ts`), résolution pour les entités exposées
  (`ir/access-controls.ts`, conditions dans `model.accessControls`), condition SQL calculée par
  requête (`odata/access.ts`, utilisateur porté par un `AsyncLocalStorage`) et ajoutée au `WHERE`
  du moteur de lecture.
- **Fixture** : rôles `ZRT_R_TRAVEL` (agence par `pfcg_auth( ZAO_TRAVL, ZAGENCY, ACTVT = '03' )`),
  `ZRT_C_TRAVEL` (hérite de la vue de base), `ZRT_C_BOOKING` (agence du voyage,
  `_Travel.AgencyID`).

## D36 — Autorisations dans les indications aux consommateurs (UI)

- **Décision** : comme RAP, qui présente le feature control et le contrôle d'autorisation sous
  forme d'indications aux consommateurs, les entités dont le BO a des handlers d'autorisation
  (maître avec handler global ou d'instance, ou entité dépendante d'un tel maître) exposent
  `__EntityControl` (`Updatable`, `Deletable`) et `__OperationControl` (actions d'instance,
  création par association) ; leurs valeurs combinent, pour l'utilisateur de la requête, les
  feature controls et les autorisations globale et d'instance. Le `$metadata` les annonce
  (`UpdateRestrictions`, `DeleteRestrictions`, `NavigationRestrictions` par chemin,
  `Core.OperationAvailable`), utilisables aussi par une application Fiori elements.
- **Création** : elle ne dépend d'aucune instance ; le service répond à `GET <racine>$permissions`
  (créations permises par entity set : autorisation globale et feature control global) et l'UI
  générée masque Create quand elle est refusée.
- **Création par association** : pour l'entité maître, elle a son propre indicateur
  (`%assoc-_Booking`), comme sur SAP ; pour une entité dépendante, l'autorisation d'update du
  maître s'applique. La fixture accorde la création des réservations avec l'update du voyage.
- **Tests** : `rap-authorizations.test.ts` (contrôles par profil, `$permissions`, création de
  réservations), `ui-authorizations.test.ts` (navigateur : un viewer ne voit pas Create, Edit,
  Delete et l'action sont désactivés).

## D37 — Launchpad des applications (OpenUI5)

- **Décision** : `rapt launchpad <launchpad.json> --out <dossier>` génère un launchpad,
  l'équivalent du SAP Fiori launchpad construit avec OpenUI5. Le shell de SAP (`sap.ushell`)
  n'existe que dans SAPUI5, sous licence SAP, et la règle du projet l'exclut. Le launchpad est
  fait de `sap.f.ShellBar` (accueil, recherche des tuiles, menu utilisateur avec déconnexion) et
  de groupes de `sap.m.GenericTile`. Une tuile dynamique (`NumericContent`) affiche le `$count`
  d'un entity set, avec un filtre éventuel. La navigation se fait par intent (`/#Travel-manage`,
  `/go/Travel-manage?…`).
- **Contenu** : `launchpad.json` est versionné avec les sources, comme le contenu du launchpad
  (catalogues, groupes, tuiles, target mappings). Il liste les applications (dossier généré par
  `rapt build`, URL interne) et les groupes de tuiles. Une tuile est affectée à des rôles de
  l'IdP, l'équivalent du business catalog d'un business role ; sans rôle, tout utilisateur la
  voit. Le compilateur résout les chemins de service et contrôle les entity sets des compteurs,
  les intents et les rôles (`LPD001` à `LPD007`) ; il reprend les rôles et les claims des
  applications pour le realm et la session.
- **Architecture, une seule origine** : le serveur front-end de SAP sert le launchpad, les
  applications et leurs services sous un même domaine. Ici, le serveur du launchpad monte l'UI de
  chaque application sous `/apps/<id>/` et relaie ses services à leurs propres chemins
  (`/sap/opu/odata4/…`, uniques par service) ; les redirections des applications sont réécrites
  sous leur point de montage. Le navigateur ne voit qu'une origine : pas de CORS, l'UI lit les
  compteurs directement, les cookies sont partagés.
- **Connexion unique** : le launchpad ouvre la session OIDC (code + PKCE). Les applications
  derrière lui ont le même `SESSION_SECRET` (et le client et `PUBLIC_URL` du launchpad) et lisent
  cette session : utilisateur, rôles, claims lus par leurs autorisations. Chaque application garde
  ses autorisations (D34), ses contrôles d'accès (D35) et son rôle obligatoire, désormais vérifié
  à chaque requête : une session ouverte par le launchpad pour un utilisateur sans ce rôle reçoit
  un 403. Les jetons porteurs des clients d'API sont relayés tels quels.
- **Déconnexion** : l'ID token de la connexion est gardé dans un cookie HttpOnly séparé
  (`rapt_idt`) et passé en `id_token_hint` au point de fin de session. Le fournisseur termine
  alors sa session sans page de confirmation, même avec un jeton expiré, comme le prévoit OIDC
  RP-Initiated Logout (vérifié avec Keycloak). Cela vaut aussi pour une application seule.
- **Pourquoi pas le jeton relayé (BFF)** : relayer le jeton d'accès de l'utilisateur aurait
  demandé de conserver les jetons côté serveur et de les rafraîchir (5 minutes par défaut chez
  Keycloak). La session signée partagée reste sans état, comme celle des applications (D28).
- **Dans les applications** : l'UI générée, servie derrière un launchpad (`/launchpad/config`
  répond), affiche la barre shell du launchpad au-dessus de ses pages (accueil, utilisateur,
  déconnexion). Seule, elle est inchangée. Chaque application reste déployable seule.
- **Exploitation** : le dossier généré contient `server.mjs`, un Dockerfile et un
  `docker-compose.yml` : le launchpad, chaque application construite depuis son dossier avec sa
  base PostgreSQL, et Keycloak dans le profil `oidc` (client `rapt-launchpad`). S'y ajoutent
  `.env.example` (`APP_<ID>_URL`) et un README.
- **Tests** : `runtime/test/launchpad.test.ts` couvre les tuiles par rôle et la connexion contre
  un fournisseur OIDC de test, puis la lecture de la session par l'application. Il vérifie aussi,
  à travers la passerelle, le DCL, les autorisations, le CSRF et les jetons porteurs, ainsi que
  les intents, la réécriture des redirections, le 502 et le rôle obligatoire.
  `runtime/test/launchpad-ui.test.ts` teste dans le navigateur les tuiles d'un viewer, le
  compteur, la recherche, l'application ouverte avec la barre shell, le retour et l'intent.
  `compiler/test/launchpad.test.ts` couvre les diagnostics, les fichiers générés et la CLI.

## D38 — Boucle de développement (`rapt dev`)

- **Contexte** : construire, installer et lancer l'application générée prend quatre commandes
  (`rapt build`, `npm install`, une base PostgreSQL, `npm start`) à chaque modification d'une
  source. L'application autonome est la cible : la boucle d'édition doit être immédiate.
- **Décision** : `rapt dev <src>` construit l'application sans son scaffold (ni `vendor/`, ni
  `package.json`, ni Docker) dans `<src>/.rapt/dev`, la démarre, surveille les sources et
  recommence à chaque modification (regroupées sur 150 ms, une construction à la fois).
  - **Dépendances** : le `node_modules` de la construction est un lien (une jonction sous
    Windows) vers celui du paquet `@rap-transpiler/runtime`, qui contient le runtime abaplint,
    PGlite et OpenUI5. Le module ABAP transpilé et le runtime chargent ainsi le même
    `@abaplint/runtime`. Aucune installation npm.
  - **Processus enfant** : le serveur tourne dans un processus séparé (`dev-server.mjs`), arrêté
    par un message IPC (PGlite ferme ses fichiers) puis relancé. Le code ABAP transpilé pose un
    état global (l'objet `abap`) et les modules ES ne se déchargent pas : un redémarrage dans le
    même processus garderait l'ancien behavior pool.
  - **Erreurs** : une construction en erreur ne touche pas à l'application qui tourne ; les
    diagnostics gardent le format de `rapt check`.
  - **Base** : PGlite dans `.rapt/dev/data`, gardée entre les constructions. Le schéma appliqué
    est mémorisé ; s'il change, la base est supprimée et recréée (données de développement,
    pas de migration). Avec `DATABASE_URL`, la base donnée est utilisée telle quelle.
  - **Surveillance** : un `fs.watch` par dossier, pas le mode récursif. Sous Linux, le mode
    récursif de Node.js perd les fichiers remplacés par un renommage, ce que font la plupart des
    éditeurs à l'enregistrement. Les dossiers commençant par un point et `node_modules` sont
    ignorés, sauf `.abapgit.xml`.
  - **Valeurs par défaut** : `AUTH_MODE=none`, `HOST=127.0.0.1`, `LOG_LEVEL=warn` ; chaque
    variable de l'environnement les remplace.
- **Tests** : `compiler/test/dev.test.ts` couvre la construction, le behavior pool exécuté, la
  conservation des données, la construction en erreur, la réinitialisation sur changement de
  schéma et la surveillance d'un fichier remplacé par un renommage.

## D39 — Sortie JSON de la CLI et extension VS Code

- **Contexte** : tout doit pouvoir se faire en ligne de commande, ou visuellement dans VS Code.
  Deux implémentations du compilateur divergeraient.
- **Décision** : la CLI reste le seul moteur ; l'extension VS Code ([packages/vscode](../packages/vscode))
  l'appelle et affiche ses résultats.
  - **`--json`** : `rapt check` et `rapt build` écrivent un objet JSON (`command`, `ok`, `root`,
    `counts`, `diagnostics` avec, en plus de `file`, le chemin absolu `path`) ; `rapt build`
    ajoute `out` et `files`. `rapt dev` écrit un événement JSON par ligne (`building`,
    `changed`, `diagnostics`, `ready`, `failed`, `database-reset`, `server-failed`,
    `server-stopped`, `error`, `log` pour les journaux du serveur). Le texte de `rapt dev` est
    dérivé des mêmes événements (`formatDevEvent`).
  - **Extension** : diagnostics dans l'onglet Problèmes (à chaque enregistrement, ou par
    `rapt dev` quand il tourne sur le projet), commandes *Vérifier le BO*, *Générer
    l'application*, *Lancer / Arrêter rapt dev*, *Ouvrir l'application*, état dans la barre
    d'état, menus de l'explorateur et de la barre de titre. Un projet est le dossier de
    `.abapgit.xml` (à défaut, le parent de `src`).
  - **Extension autonome** : le `.vsix` (~31 Mo, ~9 100 fichiers) contient `rapt/` : les paquets
    du dépôt (`pnpm pack`) installés par npm, à plat, avec leurs dépendances de production et ce
    que `rapt dev` sert (OpenUI5, `less-openui5`, PGlite, aux versions du runtime), sans cartes
    de sources, types, documentation, tests des paquets, design time OpenUI5 ni extensions
    PGlite (`scripts/stage-rapt.mjs`). Un téléchargement au premier lancement aurait allégé le
    `.vsix`, mais demandé l'accès au registre npm (souvent filtré en entreprise) et du code de
    cache ; le `.vsix` passe par VS Code, hors ligne une fois installé, et rapt y a toujours la
    version de l'extension.
  - **Node.js de VS Code** : rapt tourne sur l'exécutable de VS Code avec
    `ELECTRON_RUN_AS_NODE=1` (Node.js 22 depuis VS Code 1.101, version minimale de
    l'extension) ; le serveur de `rapt dev` hérite de la variable. Vérifié avec Electron 37 :
    `check`, `dev`, PGlite, behavior pool, arrêt du serveur quand `rapt dev` est tué.
  - **`rapt dev` installé à plat** : le `node_modules` lié dans `.rapt/dev` est le premier
    dossier, du runtime vers la racine, qui contient `@abaplint/runtime` (celui du runtime dans
    le dépôt pnpm, celui de `rapt/` dans l'extension).
  - **CLI trouvée** : réglage `rapt.cliPath`, sinon le rapt intégré, sinon un clone
    rap-transpiler ou un `node_modules` de l'espace de travail, sinon `rapt` du PATH ; Node.js
    par `rapt.nodePath`, sinon celui de VS Code.
  - **CI** : le job `test` construit le `.vsix`, vérifie la fixture avec le rapt intégré et
    publie le `.vsix` en artefact (`rap-transpiler-vscode`).
  - **Arrêt de `rapt dev`** : SIGINT. Sous Windows, où ce signal termine le processus, le
    serveur s'arrête quand son canal IPC avec `rapt dev` se ferme (D38).
  - **Construction** : sources ESM vérifiées par `tsc`, livrées en un fichier CommonJS par
    esbuild (`dist/extension.cjs`, `vscode` externe), sans dépendance à l'exécution ; `.vsix`
    par `vsce package`.
- **Tests** : `vscode/test/rapt.test.ts` couvre la recherche du projet et de la CLI, la lecture
  des lignes JSON, `rapt check --json` et `rapt dev --json` lancés réellement.
  `compiler/test/cli.test.ts` et `dev.test.ts` couvrent la sortie JSON et les événements.
  L'interface de l'extension (commandes, barre d'état) n'est pas testée dans VS Code.

## D40 — Classes utilitaires d'ABAP Cloud dans le behavior pool

- **Contexte** : après le client HTTP (D31), les behavior pools ont besoin des autres classes
  libérées d'usage courant : JSON pour les API, encodages, numérotation, dates, journal
  applicatif, hachage, aléatoire, expressions régulières, RTTS. Sans elles, du code ABAP Cloud
  ordinaire ne passe pas la vérification.
- **Décision** : une implémentation clean-room en ABAP de ces classes
  (`gen/abap/framework-utils.ts`), écrite à partir des signatures publiques documentées par SAP,
  avec des méthodes du noyau `ZRAP_EML` pour ce que l'ABAP ne peut pas faire seul
  (`runtime/src/abap/utils.ts`). Guide : [UTILITAIRES.md](UTILITAIRES.md).
  - **Fermeture** : seuls les objets nommés par les sources du projet, puis ceux qu'ils nomment,
    sont donnés au transpiler. Un projet qui n'en utilise aucun garde la même construction et le
    même temps de vérification ; un objet du projet de même nom l'emporte.
  - **Le noyau** : JSON (analyseur qui garde les nombres tels qu'écrits, parcours des données
    de `@abaplint/runtime` par type, noms des membres selon le mode), pages de codes, base64,
    gzip (zlib), hachage et HMAC (crypto), graine aléatoire, expressions régulières (RegExp avec
    `d` pour les sous-correspondances, mode étendu et classes POSIX traduits), calendrier et
    horodatages en dixièmes de microseconde (BigInt), description d'une donnée pour les RTTS.
    Les RTTS se construisent en ABAP, un niveau à la fois : `ASSIGN COMPONENT` pour les
    structures, `CREATE DATA … LIKE LINE OF` pour les tables.
  - **Numérotation** : intervalles de `rapt/number-ranges.json` (diagnostic NR001), insérés par
    `db/schema.sql` sans toucher au numéro courant ; table `rapt_number_range`, écrite dans la LUW
    (les LUW sont sérialisées : pas de conflit). Un intervalle non configuré commence à 1, pour
    développer sans configuration.
  - **Journal applicatif** : tables `rapt_application_log` et `rapt_application_log_item`, dans la
    LUW ; lecture par filtre.
  - **Tables** : générées seulement quand le code utilise `cl_numberrange_runtime` ou
    `cl_bali_*` (`model.services`), pour ne pas changer le schéma des autres applications.
  - **Types globaux** : `string_table`, `xstring_table`, `match_result(_tab)`,
    `submatch_result(_tab)` comme objets DDIC (TABL, TTYP), et un type-pool `ABAP`
    (`abap_compdescr_tab`, `abap_component_tab`…), que l'analyse d'abaplint résout.
  - **Constructeurs de classe** : ils s'exécutent au chargement des modules, avant le noyau ;
    ceux des utilitaires n'appellent donc pas `ZRAP_EML` (`cl_abap_char_utilities` écrit ses
    caractères de contrôle en littéraux).
- **Tests** : `runtime/test/utilities.test.ts` exécute un auto-test écrit en ABAP dans un behavior
  pool (`test/utilities/selftest.abap` : plus de soixante-dix vérifications sur toutes les classes,
  dont les valeurs de référence de SHA-256, MD5 et HMAC), tire des numéros jusqu'à épuisement d'un
  intervalle et écrit puis relit un journal. `compiler/test/utilities.test.ts` couvre la
  fermeture, la vérification de toutes les classes et `rapt/number-ranges.json`.

## D41 — Traitement en arrière-plan (bgPF) et e-mail

- **Contexte** : `cl_bgmc_process_factory` et `cl_bcs_mail_message` sont d'usage courant dans les
  BO RAP (travail différé après la sauvegarde, notifications). Les deux s'appuient sur la LUW : le
  processus ne démarre et le mail ne part qu'après le `COMMIT WORK`.
- **Décision** : le runtime garde, pour chaque LUW, le travail à faire après sa validation
  (`LuwContext.afterCommit`). Une LUW annulée l'oublie ; une LUW validée le démarre après la
  réponse (`setImmediate`), chaque élément dans une LUW à lui, sérialisée avec les autres.
  - **bgPF** : `save_for_execution` écrit le processus (`rapt_background_process`, `NEW`) dans la
    LUW et garde la référence de l'opération ABAP. L'exécution appelle `execute` dans une LUW
    marquée « arrière-plan » : contrôlée (`if_bgmc_op_single`), l'EML est sauvegardé à la fin et
    l'ABAP SQL écrit après `cl_abap_tx=>save( )` ; non contrôlée, l'ABAP SQL écrit toujours,
    `COMMIT ENTITIES` lance la séquence de sauvegarde (une fois) et `ROLLBACK ENTITIES` annule la
    LUW. Hors arrière-plan, `COMMIT ENTITIES` reste refusé dans un behavior pool. L'état final
    (`SUCCESSFUL`, `ERRONEOUS` avec le texte de l'exception) est écrit dans une LUW séparée, pour
    survivre à l'annulation de celle de l'opération.
  - **Pourquoi en mémoire** : SAP sérialise l'objet opération pour l'exécuter plus tard, ailleurs.
    Sérialiser un objet du runtime d'abaplint (références, objets imbriqués) demanderait un
    mécanisme général ; l'application étant un seul processus, la référence suffit. Limite : un
    processus non exécuté à l'arrêt n'est pas repris.
  - **E-mail** : `send( )` compose le message MIME avec nodemailer (MIT-0), le garde dans
    `rapt_mail` (`WAITING`), puis l'envoie après la validation par le serveur de `MAIL_SMTP_URL`
    (`SENT` / `ERROR`). Sans serveur, le mail reste dans la table (`STORED`) avec son message
    complet : le développement n'a besoin d'aucun serveur. `MAIL_FROM` donne l'expéditeur par
    défaut ; les deux variables sont dans le `.env.example` des applications qui envoient des
    mails.
  - **Tables** : générées seulement si le code utilise `cl_bgmc_process_factory` ou
    `cl_bcs_mail_message` (`model.services`, D40).
- **Tests** : `runtime/test/background.test.ts` : une action lance trois processus (contrôlé avec
  EML, non contrôlé avec `COMMIT ENTITIES`, en échec) et vérifie leurs états et leurs effets ; une
  autre envoie un mail (HTML, copie, pièces jointes texte et binaire), gardé sans serveur, envoyé
  à un serveur SMTP de test avec `MAIL_SMTP_URL`, et rien n'est envoyé quand la LUW est annulée.

## D42 — Écrire seulement de l'ABAP : tables en source, `rapt abapgit`, `rapt new`, données initiales

- **Contexte** : un export abapGit demande, pour chaque objet, un fichier XML de métadonnées, et
  les tables n'existent qu'en XML (DD02V, DD09L, DD03P). Écrire ces fichiers à la main décourage un
  développeur qui veut écrire son BO dans VS Code sans système SAP.
- **Décision** :
  - **Tables en source** : `nom.tabl.astabl`, avec la syntaxe de l'éditeur de tables des ABAP
    Development Tools (`define table … { key client : abap.clnt not null; … }`, annotations
    `@EndUserText.label`, `@AbapCatalog.*`, `@Semantics.amount.currencyCode` /
    `@Semantics.quantity.unitOfMeasure` pour les références, `include`, `define structure`).
    `loadProject` en tire le XML abapGit en mémoire : le reste du compilateur ne lit que le XML, et
    les diagnostics des tables portent la ligne du champ dans la source. La source l'emporte sur un
    XML présent à côté. Les clés étrangères (`with foreign key`) sont signalées (TABL002) et non
    transférées.
  - **`rapt abapgit <src>`** écrit ce qui manque pour qu'abapGit puisse importer le dépôt dans un
    système SAP : `.abapgit.xml` (qui ignore `*.astabl`, inconnu d'abapGit), `package.devc.xml`, le
    XML des tables en source (régénéré à chaque fois), et le XML absent des entités CDS (type de
    source déduit : vue, projection, entité abstraite, custom entity…), metadata extensions,
    access controls, BDEF, SRVD, classes et interfaces (description de `@EndUserText.label` ou du
    texte court ABAP Doc). Un XML présent n'est jamais modifié. `--check` ne fait que signaler ce
    qui manque (code retour 1), pour la CI.
  - **`rapt new <src> <Entité> [--prefix ZRT] [--description …]`** écrit un BO managed complet et
    activable sur SAP : table en source, vue racine et projection, metadata extension (List Report
    et Object Page), BDEF et projection, behavior pool (autorisation globale, une détermination),
    SRVD et SRVB OData V4, `rapt/seed.json`, `.gitignore` (`.rapt/`, `node_modules/`), puis les XML
    de `rapt abapgit`. Les fichiers existants ne sont jamais écrasés. Commande *RAP : Nouveau
    business object* dans l'extension.
  - **Données initiales** : `rapt/seed.json` (table → lignes, noms de champs du dictionnaire, en
    minuscules, sans le mandant) et `rapt/seed.sql`, vérifiés à la compilation (SEED001, SEED002)
    et copiés dans `db/` de l'application. Avec `SEED=auto` (valeur par défaut de `rapt dev`),
    l'application les charge à son premier démarrage, quand toutes ses tables sont vides : une
    clé UUID absente est tirée au hasard, un NUMC reçoit ses zéros de tête. Sans `SEED=auto` (en
    production par défaut), rien n'est chargé.
- **Pourquoi pas un XML « sans source »** : abapGit ne sait sérialiser les tables qu'en XML ; la
  source `.astabl` est ce qu'un développeur ADT lit et écrit déjà, et la conversion vers le XML
  est déterministe. Garder les deux fichiers dans le dépôt (le XML régénéré par `rapt abapgit`)
  permet l'import dans SAP sans outil.
- **Tests** : `compiler/test/authoring.test.ts` (la source de `zrt_booking` donne le même XML et le
  même modèle que la fixture ; erreurs positionnées ; `rapt abapgit` recrée les XML retirés de la
  fixture à l'identique ; `rapt new` produit un BO qui compile sans diagnostic) et
  `runtime/test/seed.test.ts`.

## D43 — Entités custom (unmanaged query) et BO managed sur une entité custom

- **Contexte** : les données d'un BO viennent parfois d'API, pas de tables. ABAP Cloud les expose
  avec une entité custom (`define custom entity`) dont une classe de requête
  (`@ObjectModel.query.implementedBy: 'ABAP:<classe>'`, interface `if_rap_query_provider`) fournit
  les lignes.
- **Décision** :
  - **Entité custom** (activable sur SAP) : le modèle la garde sans vue SQL, avec sa classe de
    requête, ses éléments typés et ses associations (`_X : association … to … on …`). Les lectures
    OData (collection, instance, navigation, `$count`, `$expand` d'un niveau, vers ou depuis une
    entité custom) appellent `select` avec la requête d'ABAP Cloud : filtre en chaîne ABAP SQL
    (`get_as_sql_string`) et en plages (`get_as_ranges`, `cx_rap_query_filter_no_range` quand le
    filtre ne s'y prête pas), tri, pagination (`get_paging`), éléments demandés,
    `is_total_numb_of_rec_requested`, `is_data_requested`, recherche. `set_data` et
    `set_total_number_of_records` rendent le résultat au runtime (kernel `zrap_eml=>query_data`,
    `query_total`). Comme dans SAP, la classe applique elle-même filtre, tri et pagination ; le
    runtime garantit seulement les clés et les conditions de navigation (lignes en trop
    écartées) et coupe la page à `$top`. Les interfaces et classes de la requête sont écrites
    d'après leurs signatures publiques (D24).
  - **BO managed with unmanaged save sur une entité custom** (propre à rap-transpiler,
    avertissement BDEF027) : le runtime RAP lit les instances (READ ENTITIES, contrôle de
    l'existence, ETag, associations) par la classe de requête, avec un filtre sur les clés, dans
    la LUW en cours ; `save_modified` écrit les changements vers l'API. Pas de verrou en base : les
    LUW de l'application sont sérialisées. Sur SAP, le même besoin se traite par un BO unmanaged.
- **Pourquoi** : c'est la manière d'ABAP Cloud de lire une API ; le BO managed sur l'entité custom
  évite d'écrire à la main le buffer transactionnel d'un BO unmanaged, au prix d'un écart
  assumé et signalé.
- **Tests** : fixture `fixtures/custom-entity` (produits lus depuis une « API » simulée par une
  table, avis en constantes) ; `runtime/test/custom-entity.test.ts` (plages, tri, pagination,
  compte, navigation, `$expand`, filtre refusé, création, doublon, validation, modification,
  suppression) et `compiler/test/custom-entity.test.ts`.


## D44 — Vues standards de SAP (I_Currency…) et value helps

- **Contexte** : sur SAP (ABAP Cloud comme S/4HANA), les vues CDS libérées `I_Currency`,
  `I_UnitOfMeasure`, `I_Country`, `I_Language` et leurs vues de textes existent dans tout système,
  avec un contenu livré et maintenu par SAP (devises ISO, unités, pays, langues). Un BO RAP s'en
  sert pour ses value helps (`@Consumption.valueHelpDefinition`) et ses associations. Sans elles,
  une source activable sur SAP échouait ici (CDS005) et le value help était ignoré.
- **Décision** :
  - **Vues standards** : une source du projet qui nomme une de ces vues sans la définir la reçoit,
    avec sa vue de textes (`_Text`, catégorie `#TEXT`) et ses tables (`rapt_currency`,
    `rapt_currencyt`, `rapt_uom`, `rapt_uomt`, `rapt_country`, `rapt_countryt`, `rapt_language`,
    `rapt_languaget`). Les éléments ont les noms de SAP ; les tables sont propres à rap-transpiler
    (le code ABAP Cloud ne lit pas les tables de SAP). Une vue définie par le projet l'emporte.
    Les fichiers sont virtuels (`<standard>/…`) : `rapt abapgit` ne les écrit jamais.
  - **Données de référence** : devises ISO 4217 (avec leurs décimales), pays ISO 3166 (code à trois
    lettres, devise, appartenance à l'UE), unités courantes (code SAP, code ISO, dimension),
    langues (clé SAP d'un caractère, code ISO) ; textes en anglais. `db/schema.sql` les insère
    (`ON CONFLICT DO NOTHING`) : une ligne ajoutée ou changée par l'application reste. Les tables
    standards ne comptent pas pour « toutes les tables sont vides » des données initiales (D42).
  - **Value helps** : comme RAP, l'entité d'un value help et sa vue de textes sont exposées
    implicitement par le service, en lecture seule, sans page dans l'UI. `$metadata` porte
    `Common.ValueList` (`CollectionPath`, paramètre `InOut`, colonnes `DisplayOnly`). L'UI ouvre
    un dialogue de sélection (recherche sur les colonnes texte et sur les descriptions) depuis
    les champs de l'Object Page et les filtres du List Report.
- **Réponse à la question « faut-il maintenir les devises comme sur BTP ? »** : sur BTP, le
  contenu de ces vues est livré par SAP et n'est pas à saisir ; ici il est livré avec
  rap-transpiler de la même façon. Les autres vues libérées utiles ensuite : `I_Region`,
  `I_CalendarDate` (calendrier), `I_Timezone`, `I_BusinessUserBasic` (utilisateurs, à relier à
  l'IdP), `I_ExchangeRate` (taux de change, à relier à une source de taux).
- **Vues ajoutées ensuite** : `I_Region` et `I_RegionText` (régions des États-Unis, du Canada, de
  l'Allemagne et de l'Australie), `I_CalendarDate` (calendrier de 1990 à 2060 calculé par
  `generate_series` : année, trimestre, mois, semaine ISO, jour de la semaine), `I_TimeZone` et
  `I_TimeZoneText` (fuseaux IANA courants), `I_BusinessUserBasic` (un utilisateur de l'IdP y est
  enregistré à chaque requête authentifiée : identifiant, nom, e-mail) et `I_ExchangeRate`
  (table vide `rapt_exchrate` : les taux sont des données de l'application). Une définition de
  service qui expose une vue standard la reçoit aussi.
- **Tests** : `compiler/test/standard.test.ts`, `runtime/test/standard-views.test.ts` (lecture,
  textes, lecture seule, value help dans le navigateur, calendrier, utilisateurs).

## D45 — Modes `standard` et `enhanced`

- **Décision** : `rapt/config.json` (`{ "mode": "enhanced" }`) ou `--mode` choisit le mode du
  projet. `standard` (par défaut) : les sources se comportent comme sur SAP et ce que SAP refuse
  est refusé ; un projet qui se construit dans ce mode s'importe et s'active sur SAP.
  `enhanced` : les extensions de rap-transpiler, qui n'existent pas sur SAP :
  - BO managed avec unmanaged save sur une entité custom (D43) : erreur BDEF027 en `standard`,
    information en `enhanced` ;
  - `field ( mandatory )` contrôlé à la sauvegarde sans validation : chaque instance créée ou
    modifiée dont un champ obligatoire est initial échoue, avec un message par champ (`%element`).
    En `standard`, comme RAP (D20), seul `mandatory : create` est contrôlé.
- **Pourquoi un fichier** : le mode est une propriété du projet, versionnée avec ses sources ; la
  CLI, `rapt dev` et l'extension VS Code (commande *Choisir le mode du projet*) le lisent.
- **Tests** : `compiler/test/config.test.ts`, `runtime/test/custom-entity.test.ts`.

## D46 — `rapt generate` : un objet à la fois, dérivé des objets existants

- **Décision** : `rapt generate <src> <type> <nom> [--from X] [--for Y] [--expose A,B] [--root]`
  écrit un objet avec les noms de fichiers d'abapGit, puis son XML : table, vue (depuis une table,
  éléments en CamelCase, annotations administratives), projection (associations redirigées par le
  même renommage : `ZC_Travel ← ZR_Travel` donne `ZC_Booking`), metadata extension, access
  control, BDEF (managed avec ses compositions : verrous, autorisations et ETag des enfants,
  numérotation UUID, champs administratifs en lecture seule, mapping ; ou BDEF de projection),
  behavior pool (un handler par entité, autorisation globale), entité abstraite, entité custom et
  sa classe de requête, classe, interface, définition et binding de service. Un fichier existant
  n'est jamais écrasé.
- **Pourquoi** : les assistants de création d'ADT dérivent un objet du précédent ; `rapt new`
  écrit un BO entier, `rapt generate` accompagne la construction pas à pas.
- **VS Code** : *Nouvel objet RAP…* (type, objet source choisi dans une liste, nom proposé).
- **Tests** : `compiler/test/generate.test.ts` (un BO complet construit commande par commande,
  sans diagnostic), `vscode/test/rapt.test.ts`.

## D47 — Serveur MCP du service

- **Décision** : `rapt mcp <src>` écrit `rapt/mcp.json`, un outil par opération du service
  (`<Set>_list`, `_get`, `_create`, `_update`, `_delete`, `_create<_Composition>`, `_<action>`),
  chacun avec une description à compléter pour expliquer à un agent ce que fait l'outil et quand
  s'en servir ; `false` retire un outil. Relancer la commande garde les descriptions écrites,
  ajoute les nouveaux outils et retire ceux que le service n'a plus. L'application construite avec
  ce fichier sert les outils sur `/mcp` (Model Context Protocol, transport « Streamable HTTP »,
  réponses JSON, sans flux SSE).
- **Exécution** : chaque appel est une requête OData exécutée par le service, pour l'utilisateur
  de la requête MCP : autorisations, DCL, feature control, validations et messages sont ceux de
  l'OData. Les erreurs du BO reviennent en texte (`isError`), le résultat en `structuredContent`.
- **Authentification** : jeton porteur (OIDC) ou utilisateur de développement ; jamais le cookie de
  session du navigateur (une page web pourrait sinon appeler les outils au nom de l'utilisateur).
- **Tests** : `compiler/test/mcp.test.ts`, `runtime/test/mcp.test.ts` (protocole, lecture,
  écriture avec messages, actions, création par composition).

## D48 — Spaces et pages du launchpad

- **Décision** : `launchpad.json` accepte `spaces` (titre, rôles) → `pages` → `sections` de tuiles,
  comme le SAP Fiori launchpad en mode spaces. Un utilisateur voit les spaces de ses rôles en
  onglets, les pages d'un space dans une liste ; le dernier space est mémorisé (stockage local du
  navigateur) ; la recherche couvre tous les spaces. Un fichier avec `groups` seulement donne un
  space d'une page. `groups` du modèle reste la liste de toutes les sections (intents, recherche).
- **Tests** : `compiler/test/launchpad.test.ts`, `runtime/test/launchpad-ui.test.ts`.

## D49 — Launchpad de développement et application de documentation

- **Décision** : `rapt dev` sert à `/` un launchpad de développement : l'application (avec le
  nombre d'instances de sa liste), la documentation de rap-transpiler, le `$metadata` et, avec
  `rapt/mcp.json`, le serveur MCP. L'application et la documentation y affichent la barre shell.
  La documentation est une application OpenUI5 (liste des pages, recherche, liens entre pages)
  dont les pages sont rendues depuis le Markdown du dépôt à la construction (rendu propre, sans
  dépendance) ; elle est copiée à côté du compilateur (`packages/compiler/docs`) pour que le rapt
  empaqueté (npm, extension VS Code) l'ait aussi. Rien de cela n'est dans `rapt build` : c'est un
  outil de développement.
- **Tests** : `compiler/test/docs.test.ts`, `compiler/test/dev.test.ts`.

## D50 — Déploiement hors de localhost

- **Décision** : l'application et le launchpad générés se déploient tels quels partout où Node.js
  22 ou un conteneur tourne. En plus du Dockerfile, ils ont un `manifest.yml` Cloud Foundry (SAP
  BTP) et un `.cfignore`. Le runtime lit l'environnement de Cloud Foundry : `PUBLIC_URL` depuis la
  route (`VCAP_APPLICATION`), `DATABASE_URL` et `DATABASE_CA` depuis un service PostgreSQL lié
  (`VCAP_SERVICES`) ; une variable donnée explicitement l'emporte. `DATABASE_CA` donne le
  certificat du serveur PostgreSQL (connexion TLS vérifiée). `rapt dev --host 0.0.0.0` ouvre le
  serveur de développement au réseau. Guide : [DEPLOIEMENT.md](DEPLOIEMENT.md).
- **Tests** : `runtime/test/platform.test.ts`, `compiler/test/app-scaffold.test.ts`.

## D51 — UI : barre de filtres, variantes de l'utilisateur, rafraîchissement

- **Barre de filtres** : les boutons *Go*, *Clear* et *Adapt Filters* sont alignés sur les champs.
  Chaque filtre accepte des conditions comme SAP Fiori (`=x`, `!=x`, `>x`, `>=x`, `<x`, `<=x`,
  `a...b`, `*x*`, `x*`, `*x` ; une valeur seule : « contient » pour un texte, « égal » sinon),
  plusieurs par champ (jetons : valeurs incluses en OU, exclusions en ET) ; une suite de chiffres
  (NUMC) se saisit sans ses zéros de tête ; dates en plage, date-heure par jours entiers (UTC).
  *Adapt Filters* ajoute les colonnes de la liste comme filtres. Le résumé « Filtered By » s'affiche
  quand l'en-tête est replié.
- **Variantes** : `sap.m.VariantManagement` (OpenUI5) : filtres, filtres visibles, colonnes
  visibles et tri (*paramètres du tableau*) enregistrés par utilisateur par le service
  (`$variants?page=…`, table `rapt_ui_variant` créée au premier usage), variante par défaut,
  favoris, renommage et suppression ; dans le stockage local du navigateur si le service ne les
  garde pas.
- **Rafraîchissement** : la liste se recharge quand on y revient après une modification
  enregistrée sur une Object Page (suppression, sauvegarde, action) ; le titre du tableau donne le
  nombre de lignes.
- **Object Page** : fil d'Ariane vers la liste ; les modifications non enregistrées sont
  abandonnées (avec confirmation) en quittant la page, et ne partent plus avec la sauvegarde
  suivante.
- **Tests** : `compiler/test/ui.test.ts` (conditions), `runtime/test/ui.test.ts` (dans le navigateur).

## D52 — `$apply` : agrégation dans le runtime OData

- **Contexte** : l'Analytical List Page et l'Overview Page (D53) ont besoin de totaux et de
  groupes ; Fiori Elements les demande par `$apply` (OData Data Aggregation).
- **Décision** : le runtime lit `$apply` avec `filter(…)`, puis une transformation
  `groupby((P,…))`, `groupby((P,…),aggregate(…))` ou `aggregate(…)` ; méthodes `sum`, `min`,
  `max`, `average`, `countdistinct` et `$count as Alias`. La requête SQL est un `GROUP BY` sur la
  vue de l'entité, avec les contrôles d'accès (DCL) de l'utilisateur ; `$orderby` sur les
  dimensions et les alias, `$top`, `$skip`, `$count`. Les autres transformations (`topcount`,
  `compute`, une transformation après le groupement…) répondent 501.
- **Pourquoi** : c'est la partie d'OData Data Aggregation que les floorplans utilisent ; le reste
  demande l'annotation `@Aggregation` que les BO transactionnels n'ont pas.
- **Tests** : `runtime/test/odata-apply.test.ts`.

## D53 — Floorplans : Worklist, Analytical List Page, Overview Page, Form entry

- **Contexte** : Fiori Elements choisit le floorplan dans le descripteur de l'application ; les
  sources RAP n'en disent rien. Le floorplan est donc un réglage du projet.
- **Décision** : `ui` de `rapt/config.json` :
  `{ "floorplans": { "<EntitySet>": "listReport" | "worklist" | "analyticalListPage" | "formEntry" },
  "overview": { "title": "…", "cards": [ … ] } }`.
  - *Worklist* : liste sans barre de filtres, un onglet par `@UI.selectionVariant` qualifié de
    l'entité, avec le nombre d'instances de chaque onglet ;
  - *Analytical List Page* : le premier `@UI.chart` de l'entité (dimension, mesures, `#COLUMN`,
    `#BAR`, `#LINE`, `#PIE`, `#DONUT`) au-dessus du tableau, lu par `$apply` (D52) ; une valeur choisie
    dans le graphique filtre le tableau ; vue graphique, tableau ou les deux ;
  - *Form entry* : l'Object Page en création seule ; après l'enregistrement, un nouveau
    formulaire vide ;
  - *Overview Page* : page d'accueil de cartes (`kpi` : agrégat d'une mesure ou compte ; `list`,
    `table` : instances filtrées et triées ; `chart` : un `@UI.chart`), chaque carte ouvre la liste
    ou l'instance.
  Le graphique est un contrôle OpenUI5 propre en SVG (`sap.viz` n'existe que dans SAPUI5).
- **Pourquoi** : mêmes annotations que Fiori Elements (`UI.chart`, `UI.selectionVariant`), sans
  bibliothèque propriétaire ; un réglage contrôlé (CFG003) plutôt qu'un descripteur à écrire.
- **Tests** : `compiler/test/config.test.ts`, `compiler/test/ui.test.ts`,
  `runtime/test/ui-floorplans.test.ts` (navigateur).

## D54 — Draft (`with draft`)

- **Contexte** : le draft est la façon standard d'éditer dans Fiori Elements V4 ; un BO RAP
  managed le déclare par `with draft;` et une `draft table` par entité.
- **Décision** :
  - **BDEF** : `with draft`, `draft table`, `total etag`, `draft action Edit`, `Activate
    optimized`, `Discard`, `Resume`, `draft determine action Prepare` ; une entité sans `draft
    table` : BDEF028.
  - **Base** : une table de brouillons par entité (les éléments de l'entité, `DraftUUID`,
    `HasActiveEntity`, dates du brouillon) et `rapt_draft_admin` (utilisateur, création, dernière
    modification) ; une vue `<projection>_all` réunit instances actives et brouillons.
  - **OData** : clé `IsActiveEntity`, propriétés `HasActiveEntity`, `HasDraftEntity`, navigation
    `DraftAdministrativeData`, actions `Edit`, `Activate`, `Prepare`, `Resume`, `Discard`,
    `Common.DraftRoot` / `DraftNode`. Un utilisateur ne lit que ses propres brouillons.
  - **Runtime** : création, modification et suppression dans le brouillon sans détermination ni
    validation ; `Edit` copie l'instance et ses compositions (un brouillon par instance, verrou
    exclusif de 15 minutes comme SAP) ; `Activate` rejoue le brouillon dans le runtime managed dans
    le LUW de la requête (déterminations, validations, saver), clés conservées, puis supprime le
    brouillon ; une instance active qui a un brouillon n'est pas modifiable directement (409).
  - **UI** : Create ouvre un brouillon, chaque champ y est enregistré à la sortie, Save active,
    Cancel et *Discard Draft* abandonnent ; la liste montre l'état d'édition.
- **Pourquoi** : le comportement observable de SAP (URL, clés, actions, verrou) pour que les
  sources et les clients restent ceux d'un système SAP.
- **Tests** : `runtime/test/draft.test.ts`, `runtime/test/ui-draft.test.ts` (navigateur),
  `compiler/test/ir.test.ts` (BDEF028).

## D55 — Table entities, types simples et types énumérés CDS

- **Contexte** : ABAP Cloud récent ajoute les CDS table entities (`define table entity` : une
  table et son entité en un objet, persistance d'un BO RAP) et les types CDS (`define type`, objets
  DRTY) : types simples et types énumérés (`enum`). SAP n'expose pas les types énumérés dans les
  services OData RAP (« Development Constraints » de RAP).
- **Décision** :
  - **Types CDS** (`<nom>.drty.acds`, lus par rap-transpiler : abaplint connaît l'objet sans
    l'analyser) : un type simple vaut son type de base (type intégré, élément de données ou autre
    type CDS), avec son libellé ; un type énuméré a un type de base (`abap.int1`, `int2`, `int4`,
    `char(1..8)`, `numc(1..8)`), exactement une constante `initial`, des constantes et des
    valeurs uniques (TYPE001 à TYPE003). Un type typé par un type énuméré en reprend les constantes.
    Ils typent les éléments des table entities, des entités abstraites et custom.
  - **Table entity** : une table du même nom (éléments en minuscules ; `NOT NULL` sauf `null` ;
    clés en tête ; `abap.string` déclaré `null`, CDS019-CDS020) et une view entity sur cette table.
    Une BDEF managed sur la table entity n'écrit pas `persistent table` : la table entity est sa
    persistance. Les vues et projections la lisent comme une entité ; l'ABAP SQL du behavior pool
    lit et écrit sa table.
  - **Valeurs énumérées** : stockées en base avec leur valeur de base. Dans le behavior pool, le
    type est donné au transpiler comme un élément de données de son type de base et chaque
    constante `type-constante` devient le littéral de sa valeur (même ligne, même sens).
  - **OData** : en mode `standard`, un élément énuméré dans une entité exposée est une erreur
    (CDS021), comme sur SAP. En mode `enhanced`, il devient un `EnumType` du `$metadata` : membres
    nommés comme les constantes, valeur entière (la valeur de base si elle est entière, la position
    sinon), libellé en `Core.Description`. Le JSON porte le nom du membre (`"Status": "OPEN"`) ;
    `$filter` accepte `Status eq 'OPEN'`, `Ns.Type'OPEN'` et la valeur entière ; une valeur hors
    du type est refusée (400). L'UI affiche les libellés et propose une liste de choix (OpenUI5 ne
    sait pas écrire les littéraux d'énumération : le filtre passe par `$filter`).
  - `rapt generate tableentity|type|enum`, DDLS de type `T` pour `rapt abapgit`. Un type CDS est
    un objet au format AFF d'abapGit (dépôt SAP/abap-file-formats) : la source `<nom>.drty.acds`
    et ses métadonnées `<nom>.drty.json` (`formatVersion`, description, langue), écrites par
    `rapt abapgit` (`.drty.asdrty` reste lu).
- **Pourquoi** : la table entity est un BO complet en deux fichiers ; les types énumérés donnent
  des valeurs nommées à l'API sans changer le stockage. Le mode `standard` reste activable sur SAP,
  l'exposition en énumération est une extension (D45).
- **Tests** : `compiler/test/table-entity.test.ts`, `runtime/test/table-entity.test.ts`
  (OData, ABAP, navigateur), fixture `fixtures/table-entity`.

## D56 — Value helps : liaisons, validation, valeurs fixes, paramètres d'action

- **Contexte** : D44 donnait le value help simple (`entity: { name, element }`) ; les BO RAP
  utilisent aussi `additionalBinding`, `useForValidation` et des listes déroulantes.
- **Décision** :
  - `additionalBinding: [{ localElement, element, usage }]` : `#FILTER` restreint la liste par la
    valeur locale (`Common.ValueListParameterIn`), `#RESULT` copie l'élément de la ligne choisie
    dans l'élément local (`ValueListParameterOut`), sans usage les deux (`InOut`) ;
  - `useForValidation: true` : `Common.ValueListForValidation` ; l'UI signale une valeur saisie
    absente de la liste (état d'erreur du champ) ;
  - `@ObjectModel.resultSet.sizeCategory: #XS` sur l'entité du value help :
    `Common.ValueListWithFixedValues`, et une liste déroulante (valeur et description) dans l'UI ;
  - les paramètres d'action (entité abstraite) ont leur value help dans le dialogue, si son
    entité est exposée par le service (comme RAP, qui ne l'ajoute pas implicitement).
- **Pourquoi** : ce sont les formes de value help des BO RAP courants, et Fiori Elements les
  interprète depuis le `$metadata`.
- **Tests** : `compiler/test/table-entity.test.ts` (CSDL), `runtime/test/table-entity.test.ts`
  (liste déroulante qui remplit la devise, validation, dans le navigateur),
  `runtime/test/standard-views.test.ts`.

## D57 — Annotations d'affichage : criticité, textes, en-tête, liens, filtres

- **Contexte** : l'UI générée suivait les annotations de structure (`lineItem`, `identification`,
  `facet`…) mais pas celles d'affichage courantes des BO RAP ; la table complète est dans
  [ANNOTATIONS.md](ANNOTATIONS.md).
- **Décision** :
  - `criticality` (line item, identification, data point) : `ObjectStatus` ou `ObjectNumber`
    coloré (1 négatif, 2 critique, 3 positif) ;
  - `@ObjectModel.text.element` + `@UI.textArrangement` : « Texte (ID) » (défaut, comme Fiori
    Elements), « ID (Texte) », texte seul, séparé ;
  - `@UI.dataPoint` (`UI.DataPoint`, qualifié par son `qualifier` ou le nom de l'élément) et
    `@UI.facet` purpose `#HEADER` (`#DATAPOINT_REFERENCE`, `#FIELDGROUP_REFERENCE`) : en-tête de
    l'Object Page, barre de progression (`#PROGRESS`, `targetValue`), notation (`#RATING`), nombre ;
  - `@UI.multiLineText` : zone de texte ; `@Semantics.email.address`, `@Semantics.telephone.type` :
    liens `mailto:` / `tel:` (vocabulaire `Communication`) ; line item `#WITH_URL` : lien ;
  - `@Consumption.filter.defaultValue` (filtre initial, appliqué par la variante standard),
    `mandatory` (filtre obligatoire, `FilterRestrictions`), `selectionType` /
    `multipleSelections` (une valeur) ;
  - `@Consumption.hidden` : élément non exposé, sauf une clé ou l'élément d'une association.
  - Correctif : `@UI.facet: […]` puis `@UI: { … }` sur le même élément gardent les deux (la
    seconde annotation remplaçait la première).
- **Pourquoi** : ce sont les annotations que les exemples SAP (RAP100, Flight) utilisent sur
  chaque BO ; elles changent ce que voit l'utilisateur sans changer le BO.
- **Tests** : `compiler/test/table-entity.test.ts` (CSDL), `runtime/test/table-entity.test.ts`
  (navigateur), fixture `fixtures/table-entity`.

## D58 — UI du draft comme Fiori Elements

- **Contexte** : la première UI du draft (D54) éditait et activait, mais sans les repères de
  Fiori Elements : la liste montrait l'instance active même quand l'utilisateur avait un
  brouillon, sans filtre d'état d'édition ni indicateur d'enregistrement.
- **Décision** :
  - **List Report** : filtre *Editing Status* (*All*, *Own Draft*, *Locked by Another User*,
    *No Changes*) ; *All* montre les brouillons de l'utilisateur à la place de leurs instances
    actives (`IsActiveEntity eq false or HasDraftEntity eq false or
    DraftAdministrativeData/InProcessByUser ne '<utilisateur>'`, comme `SiblingEntity` chez SAP) ;
    marqueurs *Draft* et *Locked by X* (`ObjectMarker`). L'instance active pointe vers les
    données d'administration de son brouillon (`DraftUUID`), comme SAP.
  - **Object Page** : marqueur *Draft* dans l'en-tête, *Locked by X* sur une instance qu'un autre
    utilisateur édite, `DraftIndicator` dans le pied (« Saving draft… », « Draft updated ») ;
    *Discard Draft* demande « Discard all changes? » ; quitter la page en brouillon propose
    *Keep Draft* / *Discard Draft* (le brouillon reste dans la liste).
  - L'utilisateur courant est donné à l'UI par `$permissions` (`$user`).
- **Pourquoi** : un utilisateur de Fiori Elements retrouve les mêmes gestes ; aucune bibliothèque
  SAP (contrôles OpenUI5 `ObjectMarker`, `DraftIndicator`).
- **Tests** : `runtime/test/ui-draft.test.ts` (navigateur).

## D59 — Collaborative draft

- **Contexte** : `with collaborative draft;` et `draft action Share;` (ABAP Cloud) permettent à
  plusieurs utilisateurs d'éditer le même brouillon ; les utilisateurs invités par `Share` ou qui
  rejoignent le brouillon le modifient, l'activent ou l'abandonnent.
- **Décision** :
  - BDEF : `with collaborative draft;` dans l'en-tête, `draft action Share;` obligatoire (BDEF029),
    `use action Share;` dans la projection.
  - Base : `rapt_draft_user` (brouillon, utilisateur, rôle `O` propriétaire / `E` éditeur).
  - OData : action `Share(Users: Collection(DraftAdministrativeUserInput{UserID, UserAccessRole}),
    ShareAll)`, `Common.DraftRoot/ShareAction`, entité `DraftAdministrativeUser`
    (navigation `DraftAdministrativeData/DraftAdministrativeUser`).
  - Runtime : le créateur est propriétaire ; `Edit` d'une instance dont un autre utilisateur a le
    brouillon fait rejoindre le brouillon (au lieu de 409) ; tout utilisateur du brouillon le
    lit, le modifie, l'active, l'abandonne ; les autres reçoivent 409 / 404 comme pour un brouillon
    exclusif.
  - UI : en brouillon, les utilisateurs (avatars) et *Invite* (`Share`) ; la page relit le
    brouillon toutes les 5 secondes pour montrer les changements des autres.
- **Pourquoi** : le comportement de SAP (actions, entités, annotation) pour que Fiori Elements et
  les clients OData s'y retrouvent ; le rafraîchissement périodique remplace les WebSockets
  (ABAP Channels) de SAP.
- **Tests** : `runtime/test/draft-collaborative.test.ts` (OData, navigateur, BDEF029).

## D60 — API Web : binding OData V4 - Web API, OAuth 2.0 (client credentials, PKCE)

- **Contexte** : un service RAP s'expose aussi en API pour d'autres systèmes (binding *OData V4 -
  Web API*). Les appelants s'authentifient par OAuth 2.0 : *client credentials* (machine à
  machine) ou *authorization code* avec PKCE (application au nom d'un utilisateur).
- **Décision** :
  - **Binding** : `BINDING_TYPE_CATEGORY` 1 du SRVB, ou `--binding-type webapi`, ou
    `rapt generate binding … --binding-type webapi`. Comme SAP : pas d'annotation `UI.*`, ni value
    help, ni side effects, ni feature control (`__EntityControl`…) dans le service (les contrôles
    restent appliqués par le runtime) ; pas d'UI générée ; un BO draft n'expose que ses instances
    actives (écritures directes, sans `IsActiveEntity`).
  - **Production** (`AUTH_MODE=oidc`) : le service accepte les jetons de l'IdP (Keycloak, SAP Cloud
    Identity Services, Entra ID…) obtenus par l'un ou l'autre flux ; un jeton *client credentials*
    sans `preferred_username` désigne son client (`client_id`) comme utilisateur technique ; ses
    rôles peuvent venir de `scope` (`OIDC_ROLES_CLAIM=scope`). Les sessions du navigateur
    utilisaient déjà le flux PKCE.
  - **Développement** : `rapt dev` (et une application démarrée avec `AUTH_MODE=none` et
    `DEV_OAUTH=on`) sert un serveur d'autorisation de développement sous `/oauth` : découverte
    OIDC, JWKS, `/oauth/token` (`client_credentials` avec `rapt-client` / `rapt-secret`,
    `authorization_code` avec vérification PKCE S256), `/oauth/authorize` (page de choix de
    l'utilisateur et de ses rôles) ; clients configurables (`DEV_OAUTH_CLIENTS`). Ses jetons
    (RS256, clé générée au démarrage) donnent un utilisateur de développement.
- **Pourquoi** : tester une API exactement comme ses clients l'appelleront (Postman, Bruno, un
  autre système) sans installer d'IdP ; en production, l'IdP reste la seule source de jetons.
- **Tests** : `runtime/test/web-api.test.ts` (binding, client credentials, PKCE),
  `runtime/test/auth.test.ts` (jeton de client).

## D61 — Création guidée des objets, floorplan, parité CLI / extension

- **Contexte** : ADT guide la création d'un objet (*New ABAP Repository Object* : types par
  catégorie, description, objet de référence) ; l'extension n'offrait qu'une suite de listes
  rapides, et le floorplan de l'UI ne se choisissait qu'en éditant `rapt/config.json`.
- **Décision** :
  - **Catalogue** : `authoring/catalog.ts` décrit chaque type d'objet (catégorie, libellé,
    description, fichiers, longueur du nom, champs : objet source, entités exposées, type de
    binding, type intégré) ; `rapt generate <src> --json` sans type le renvoie. L'extension en
    construit son assistant : la CLI reste la seule source.
  - **Assistant** (webview *Nouvel objet RAP*) : filtre, types par catégorie, formulaire du type
    (les objets du projet proposés comme source), *Créer* lance `rapt generate` (ou `rapt new` pour
    un BO complet) et ouvre le fichier. Nouveaux types : élément de données et domaine (`--type`).
  - **Vue *Objets RAP*** : les objets du projet groupés comme l'explorateur de projet d'ADT.
  - **Floorplan** : `rapt floorplan <src> [<EntitySet> <floorplan>]` lit et écrit
    `ui.floorplans` de `rapt/config.json` ; la commande VS Code décrit chaque floorplan (usage,
    annotations nécessaires).
  - **Parité** : chaque commande de la CLI a sa commande VS Code (`check`, `ir`, `build`,
    `launchpad`, `dev`, `new`, `abapgit`, `mcp`, `generate`, `floorplan`).
- **Pourquoi** : un développeur ABAP retrouve les gestes d'ADT ; le choix du floorplan devient
  explicite et documenté au moment de le faire.
- **Tests** : `vscode/test/rapt.test.ts` (catalogue, arguments de l'assistant, `rapt floorplan`,
  groupes), assistant vérifié dans Chromium.

## D62 — Site du projet et téléchargement de l'extension

- **Décision** : `site/` (HTML et CSS statiques, sans dépendance ni outil de construction) présente
  le projet ; le workflow `site.yml` le publie sur GitHub Pages avec les captures de `docs/images`
  et le `.vsix` construit depuis le même commit (bouton *Télécharger*). Les versions taguées
  restent publiées par `release.yml` (GitHub Release, Marketplace et Open VSX si leurs jetons sont
  configurés). À activer une fois : *Settings → Pages → Source : GitHub Actions*.
- **Pourquoi** : une adresse à partager, toujours à jour, sans serveur à maintenir.
- **Tests** : rendu vérifié dans Chromium (bureau, mobile sans défilement horizontal, mode sombre).

## D65 — Aide à la saisie des filtres : *Search and Select* et *Define Conditions*

- **Contexte** : les champs de filtre du List Report (et de l'ALP) acceptaient les conditions
  saisies (D51) et ouvraient, pour un champ avec value help, une liste de valeurs (D44) ; il
  manquait le dialogue de SAP Fiori elements où l'on compose les conditions (opérateur, valeurs,
  exclusions) à côté de la sélection dans le value help. Le dialogue de `sap.ui.comp` /
  `sap.ui.mdc` est SAPUI5 seulement.
- **Décision** :
  - l'icône de chaque champ de filtre à jetons (tous sauf booléens et types énumérés, qui restent
    des listes de choix) ouvre un dialogue construit en `sap.m` (`controller/conditions.js`) :
    onglet *Search and Select* (si le champ a un value help : recherche, table à sélection
    multiple ou simple, descriptions de la vue de textes), onglet *Define Conditions* (une ligne
    par condition : opérateur, valeur(s), aide à la saisie sur la valeur, *Add*), et en bas les
    jetons *Selected Items and Conditions* ;
  - opérateurs comme Fiori elements : *equal to*, *contains*, *starts with*, *ends with*,
    *between*, *less than*, *less than or equal to*, *greater than*, *greater than or equal to*,
    *empty*, et leurs exclusions (*not equal to*, *does not contain*, *not between*, *not empty*…),
    filtrés par type : texte tous, nombres et NUMC comparaisons, dates et heures comparaisons et
    *empty* (sélecteur de date / d'heure), UUID égal / différent ;
  - `$filter` : conditions incluses d'un champ en `or`, exclusions en `and not`, champs en `and` ;
    *empty* d'un texte = `''` ou `null` ; date-heure par jours entiers (UTC) ;
  - jetons écrits comme Fiori elements : valeur seule (avec sa description : « Euro (EUR) »),
    `!(=x)`, `*x*`, `a...b`, `<empty>`, `!(…)` ; la clé du jeton est la condition (`=x`, `!(*x*)`)
    relue à la recherche et gardée dans les variantes (les variantes antérieures restent lues, y
    compris les plages de dates `{ from, to }`) ;
  - saisie directe : `!(…)`, `<empty>` et `a - b` (dates) en plus de D51 ; une valeur seule est
    *contains* pour un texte libre, *equal to* pour une clé ou un champ avec value help ; les dates
    se saisissent au format de la langue ou en ISO ;
  - `@Consumption.filter.selectionType` (`AllowedExpressions` déjà dans le CSDL, D57) :
    `#SINGLE` égal seulement, `#INTERVAL` comparaisons et intervalles (sans motif), une seule
    condition si `multipleSelections: false` (sans exclusion pour `SingleRange`).
- **Pourquoi** : c'est le « matchcode » des filtres Fiori elements ; garder la sélection dans le
  value help et les conditions dans le même dialogue évite deux gestes différents pour un champ.
- **Limites** : pas d'opérateurs de dates relatives (*today*, *last week*…) ; les booléens et types
  énumérés gardent leur liste de choix ; une valeur saisie sans value help s'affiche sans
  description.
- **Tests** : `compiler/test/ui.test.ts` (lecture et écriture des conditions, opérateurs par type
  et `selectionType`, `$filter`), `runtime/test/table-entity.test.ts` (dialogue dans Chromium :
  sélection dans le value help, exclusion, conditions saisies, lignes filtrées).
