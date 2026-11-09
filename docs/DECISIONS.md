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
  charges), implémentation unmanaged, late numbering, `with additional save` et
  `with unmanaged save` (il faudrait de l'ABAP SQL dans le saver), événements, change documents,
  extensions, analytique.

## D15 — Runtime générique piloté par l'IR

- **Décision** : l'application générée contient un runtime générique (`@rap-transpiler/runtime`)
  qui lit `model.json`. Seuls le SQL, le CSDL, le JavaScript de l'ABP, l'UI et le packaging sont
  générés. Le runtime est embarqué sous forme de tarball dans `vendor/`.
- **Pourquoi** : un seul runtime testé pour tous les BO ; une sortie autonome sans registre privé.

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
- **Conséquence** : un type `TYPE zr_travel` (vue CDS) n'est pas disponible dans l'ABP
  (KNOWN_GAPS.md) ; les types dérivés et les tables le sont.

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
  Le feature control d'instance (`__EntityControl`, `__OperationControl`, `__FieldControl`) n'est
  calculé que si la requête sélectionne ces propriétés (ou n'a pas de `$select`).
- **Pourquoi** : c'est le comportement attendu par l'ODataModel V4 de Fiori elements ; le calcul
  du feature control appelle l'ABP et ne doit pas pénaliser les lectures qui ne l'utilisent pas.

## D26 — ABAP SQL hors du périmètre de l'ABP

- **Décision** : une instruction ABAP SQL (`SELECT`, `INSERT`, `UPDATE`, `MODIFY`, `DELETE` sur une
  table) dans un behavior pool est une erreur de compilation (ABP007).
- **Pourquoi** : le runtime abaplint n'a pas de connexion à la base de l'application, et le
  modèle de persistance d'un BO managed passe par l'EML. Une erreur à la génération vaut mieux
  qu'une erreur à l'exécution. L'accès SQL en lecture (contrôle d'existence d'une agence, par
  exemple) est une évolution possible (KNOWN_GAPS.md).

