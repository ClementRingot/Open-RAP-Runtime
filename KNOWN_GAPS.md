# Écarts connus

Ce fichier recense ce qui n'est pas (encore) pris en charge, en particulier les fonctionnalités
ABAP que `@abaplint/transpiler` ne traite pas : la règle du projet est de les documenter ici
plutôt que de contourner le transpiler. La couverture fonctionnelle globale est suivie dans
[docs/FEATURES.md](docs/FEATURES.md).

Versions de référence : `@abaplint/core` 2.120.98, `@abaplint/transpiler` 2.14.24,
`@abaplint/runtime` 2.14.24.

## Transpiler et runtime abaplint

| Écart | Effet | Contournement | Suivi |
|---|---|---|---|
| Les types dérivés RAP (`TYPE TABLE FOR …`, `keys`, `failed`, `reported`, `result`) sont typés `void` par abaplint. | Le transpiler refuse l'ABP (`TypeNameOrInfer, type not found: #`). | Le compilateur génère les types et réécrit l'ABP avant transpilation (D2). | Résolu (J4) |
| abaplint n'analyse pas toutes les formes EML (`CREATE AUTO FILL CID SET FIELDS WITH`, `CREATE BY \_assoc SET FIELDS WITH` sont des instructions inconnues pour lui), et l'abaissement EML du transpiler ne traite ni `BY \_assoc`, ni `LINK`, ni `CREATE BY`, ni `IN LOCAL MODE`. | Erreur de syntaxe ou « not supported » à l'exécution. | Parser EML propre et abaissement vers `ZRAP_EML` par la passe de réécriture (D2). | Résolu (J4) |
| Les opérations arithmétiques du runtime sur des nombres packed (`p`) passent par des nombres JavaScript (le stockage, lui, est exact). | Un calcul au-delà d'environ 15 chiffres significatifs peut perdre des décimales. | Les valeurs passent en texte exact entre le buffer et l'ABP (D8) ; les montants usuels ne sont pas concernés. | — |
| La couche SQL du transpiler échoue sur les associations CDS. | Transpilation impossible avec les DDLS d'origine. | DDIC « ombre » sans vues CDS (D19). | Résolu (J4) |
| Les méthodes privées des classes locales ne sont accessibles qu'à travers `FRIENDS_ACCESS_INSTANCE`, un détail interne du code généré. | Peut changer avec une version du transpiler. | Versions épinglées ; les tests de J4 appellent tous les handlers par ce chemin. | — |
| Les objets à namespace (`/DMO/…`) donnent des modules nommés avec `#`, importés en `%23`. | Le chargeur de modules de Vitest ne les trouve pas. | Les modules sont renommés (`#` → `_`) à la génération. | Résolu (J4) |
| abaplint ne type pas la déclaration en ligne du résultat d'un `SELECT` avec un littéral, un agrégat autre que `COUNT(*)` ou une expression (type `void` « SELECT_todo »). | La méthode transpilée échoue dès son appel. | La passe de réécriture déclare le test d'existence (`@abap_true` : `abap_boolean`) et `MAX`/`MIN` d'une seule source (type de la colonne) ; diagnostic ABP009 pour les autres formes (D26). | Contourné |
| Le transpiler lit un hôte à composant (`@ls-comp`) comme une soustraction (`ls - comp`) quand le `SELECT` utilise des champs préfixés par un alias (`t~col`). | SQL invalide ou ambigu à l'exécution. | La passe de réécriture l'écrit `@( ls-comp )` (expression hôte équivalente) dans ces `SELECT`. | Contourné |
| `SELECT … ENDSELECT` lit des lignes entières de la table puis les affecte à la cible. | Avec une liste de champs, cible élémentaire en échec, structure plus courte remplie par position. | Diagnostic ABP007 : `SELECT *`, ou `INTO TABLE` puis `LOOP AT`. | — |
| Une valeur `int8` (`get_offset( )`, `get_page_size( )` de la pagination d'une requête) dans `LOOP AT … FROM`/`TO` | Le runtime mélange BigInt et nombres : l'exception « Cannot mix BigInt » | `CONV i( … )` avant le `LOOP`, comme dans la fixture `custom-entity`. | — |
| `OPEN CURSOR … ORDER BY` : le transpiler écrit deux fois `ORDER BY` ; `FETCH NEXT CURSOR … INTO TABLE @DATA(…)` le fait échouer (« InlineDeclarations »). | — | Le doublon est retiré à la traduction SQL ; déclarer la cible du `FETCH`. Les curseurs ne font de toute façon pas partie d'ABAP Cloud (refusés par la vérification). | — |

## Behavior pool (ABAP)

| Écart | Statut |
|---|---|
| Écriture ABAP SQL (`INSERT`, `UPDATE`, `MODIFY`, `DELETE` sur une table) hors du saver, `WITH` | Diagnostic ABP007 (D26) : le runtime RAP écrit le BO, le modifier par EML. Permise dans `save_modified` (D30). |
| Écritures ABAP SQL classiques de nombres packed (dont `TIMESTAMPL`) | Le runtime abaplint passe les valeurs par des nombres JavaScript : environ 15 chiffres significatifs, les microsecondes d'un horodatage sont perdues. `MAPPING FROM ENTITY` (kernel) est exact. |
| `DELETE dbtab FROM @wa` | Le transpiler perd la ligne (la requête viderait la table) : diagnostic ABP007 ; `DELETE FROM dbtab WHERE …`, `FROM TABLE` ou `MAPPING FROM ENTITY`. Un `DELETE` sans condition est refusé à l'exécution. |
| Tables et vues hors du projet dans un `SELECT` (`/dmo/agency`, tables SAP) | Erreur ABP004 : seules les tables et entités CDS du projet existent dans la base générée. |
| `SELECT` et changements non sauvegardés de la LUW | Non visibles, comme dans RAP : `SELECT` lit la base (lire le BO par EML pour voir le buffer). |
| Conditions `SELECT` sur une date, un UUID, un horodatage ou un booléen | Évaluées sur la forme ABAP calculée par la vue : pas d'index utilisable, lecture séquentielle de la table (D26). |
| Fonctions SQL ABAP (`concat`, `division`, `dats_days_between`, `tstmp_*`…) | Transmises telles quelles : seules celles qui existent sous le même nom en PostgreSQL fonctionnent. |
| Erreur SQL à l'exécution | Erreur d'exécution (500), pas d'exception `CX_SY_OPEN_SQL_DB` capturable ; la transaction de la LUW reste utilisable (savepoint). |
| `SELECT … FOR UPDATE`, `OFFSET`, `CLIENT SPECIFIED`, `USING CLIENT`, connexions secondaires | Non pris en charge par le transpiler ou sans objet (mono-tenant, D9). |
| Classe saver (`lsc_…`) | `save_modified` et `cleanup` pour additional et unmanaged save (D30). `adjust_numbers` (late numbering) : ABP007 ; les autres méthodes ne sont pas appelées (ABP003). Les lignes de `update` portent toujours toutes les valeurs. |
| Unmanaged save : contraintes de la base | Pas de clé étrangère enfant → parent (la BDEF n'a pas de table persistante) : `save_modified` supprime les enfants (`delete` les contient). |
| EML sur une BDEF de projection (`MODIFY ENTITIES OF zc_travel`) | Diagnostic ABP007 : utiliser la BDEF de base. |
| `MODIFY ENTITIES OPERATIONS` (EML dynamique), `RELATING TO`, `AUGMENTING`, `COMMIT ENTITIES RESPONSES`, `GET PERMISSIONS`, `SET LOCKS`, `RAISE ENTITY EVENT` | Diagnostics ABP005/ABP007. |
| Late numbering (`adjust_numbers`) | Non pris en charge (ABP007). La numérotation anticipée, directe ou par association, l'est. |
| `COMMIT ENTITIES` et `ROLLBACK ENTITIES` dans un handler | Erreur à l'exécution, comme dans RAP. |
| Réponses d'une instruction EML | Remplacent le contenu des cibles `FAILED`/`REPORTED`/`MAPPED` données ; `sy-subrc` vaut 4 quand `failed` n'est pas vide (convention, non documentée par SAP). |
| Septième décimale des `TIMESTAMPL` générés | Le runtime les génère à la microseconde (D8). |

## API distantes (D31)

| Écart | Statut |
|---|---|
| Client proxy : `$batch` (`create_request_for_batch`), `$expand`, deep insert, navigation par association (`navigate_to_many`…), actions et fonctions du service distant, `$search`, delta | Non pris en charge : méthodes absentes du socle (erreur de vérification ABAP). |
| Value controls (`value_controls` des classes SCM2, champs `_vc` des entités abstraites) | Ni lus ni remplis : une valeur `null` du service donne la valeur initiale ; la mise à jour d'une valeur à `null` n'est pas possible. |
| `comm_system_id`, `i_service_instance_name`, `i_authn_mode` | Ignorés : une destination est un jeu de variables d'environnement. Pas de propagation de l'utilisateur (principal propagation) ni d'OAuth client credentials : un jeton fixe peut être donné par `_TOKEN`. |
| Paramètres `is_proxy_model_key`, `iv_service_definition_name` | Ignorés : le proxy lit le `$metadata` du service distant (un appel de plus par proxy). |
| Destination nommée par une variable | Fonctionne, mais n'est pas listée dans le `.env.example` généré (seuls les littéraux le sont). |
| Communication targets (COTA), SOAP (`cl_soap_destination_provider`), RFC | Non pris en charge. |
| Proxy HTTP sortant | `fetch` de Node.js ne lit `HTTPS_PROXY` qu'avec `NODE_USE_ENV_PROXY=1` (ou `--use-env-proxy`). |
| Appels distants et LUW | L'appel part pendant l'interaction (action, détermination…) : un rollback de la LUW n'annule pas ce qui a été écrit à distance, comme sur SAP. |

## CDS

| Écart | Statut |
|---|---|
| Expressions dans la liste de sélection (CAST, CASE, calculs, littéraux) | Diagnostic CDS002 |
| Chemins d'association dans la liste de sélection (`_Agency.Name`) | Diagnostic CDS002 |
| Jointures, clause WHERE | Diagnostic CDS002 (WHERE ignoré avec avertissement) |
| Vues avec paramètres, unions, hiérarchies | Diagnostic CDS002 |
| Entités custom (D43) : paramètres, agrégation (`get_aggregation`), `$expand` imbriqué ; DCL non appliqué (la classe de requête filtre elle-même) | Non gérés |
| Entités custom : un `$filter` hors plages (OU entre éléments, fonctions autres que `contains`/`startswith`/`endswith`, comparaison entre éléments) | `get_as_ranges` lève `cx_rap_query_filter_no_range`, comme dans SAP ; `get_as_sql_string` reste disponible. Les fonctions et expressions non traduisibles : 501. |
| BO managed avec unmanaged save sur une entité custom (D43) | Propre à rap-transpiler (avertissement BDEF027) ; pas de verrou en base : les LUW de l'application sont sérialisées, l'API cible garde ses propres contrôles. |
| Contrôle d'accès DCL : EML et ABAP SQL du behavior pool | Non filtrés (comme `WITH PRIVILEGED ACCESS`) ; seules les lectures OData le sont (D35). Comme dans RAP, les modifications passent par l'autorisation d'instance, pas par le DCL. |
| Contrôle d'accès DCL : autres aspects (`bypass when`, aspects définis par l'utilisateur), chemins de plusieurs associations, `$filter` sur une navigation | Une condition non évaluée n'accorde aucune ligne (DCL002) ; la sous-requête d'un `$filter` sur `_Travel/…` lit la cible sans son DCL. |
| `@AccessControl.authorizationCheck` | Informatif : un rôle s'applique s'il existe, quelle que soit la valeur. |
| Structures incluses (`.INCLUDE`) dans les tables | Diagnostic DDIC003 |
| Conversion exits (ALPHA…), conversion ISO des langues | Non gérés |

## Base de données

| Écart | Statut |
|---|---|
| Colonne mandant (`CLNT`) | Retirée : applications mono-tenant (D9) |
| Septième décimale des `TIMESTAMPL` | Perdue : `timestamptz(6)` (D8) |

## OData

| Écart | Statut |
|---|---|
| Comparaisons `lt`/`le` sur une date initiale : en ABAP `00000000` est inférieure à toute date ; ici la valeur initiale est `NULL` et n'est retenue par aucune comparaison (sémantique OData de `null`). | Assumé |
| `$filter` avec `any`/`all`, `$expand` imbriqué, `$apply`, JSON batch, `$value` | Réponse 501 ou 400 |
| `etag dependent by` : maître en unmanaged save, ou champ ETag du maître qui n'est pas un horodatage administratif | Le runtime ne change pas l'ETag du maître quand une entité dépendante change : `save_modified` ou l'application doit le faire (D32). |
| `etag dependent by` à travers une projection qui n'expose pas l'association | Pas d'ETag pour l'entité dépendante (ni `@odata.etag`, ni contrôle de `If-Match`). |
| Feature control global (`features : global`) dans les lectures | Exposé comme le feature control d'instance (`__EntityControl`, `__OperationControl` : même valeur pour toutes les instances), recalculé à chaque requête, sans cache. Action statique : contrôlé à l'exécution seulement (pas d'instance pour `Core.OperationAvailable`). |

## Application générée

| Écart | Statut |
|---|---|
| Premier chargement de l'UI : environ 400 modules OpenUI5 servis un par un (pas de bundle `ui5 build`) | Assumé (D27) ; mise en cache HTTP d'une heure. |
| Sessions : ni rafraîchissement de jeton, ni révocation avant l'expiration du cookie (8 h) | Assumé (D28). |
| Verrous entre plusieurs instances de l'application | Verrous de ligne PostgreSQL (`NOWAIT`), testés contre une autre transaction (`rap-locks.test.ts`) ; pas de test de charge. |
| TypeScript 7.0.2 compile `new (x as T).Y()` sans parenthèses | Forme évitée dans le code (D29). |

## Launchpad (D37)

| Écart | Statut |
|---|---|
| Navigation entre applications depuis une application (CrossApplicationNavigation, liens d'intent dans une Object Page) | Non prévu : les intents s'ouvrent depuis le launchpad (`/#…`, `/go/…`). |
| Paramètres d'intent transmis en query string, que l'UI générée n'exploite pas (pas d'ouverture directe d'une instance) | Écart. |
| Application chargée en pleine page, pas dans un conteneur du shell | Assumé : une application par page ; la barre shell est affichée par l'application. |
| Personnalisation (groupes et tuiles de l'utilisateur), spaces et pages, notifications, recherche d'entreprise | Non prévu. |
| Compteurs des tuiles lus au chargement seulement | Écart : pas d'intervalle de rafraîchissement. |
| Session partagée : même `SESSION_SECRET` pour le launchpad et ses applications, pas de révocation avant l'expiration | Assumé : une même confiance, comme les sessions (D28). |
| Applications derrière le launchpad en `AUTH_MODE=none` : leur utilisateur de développement, indépendant de celui du launchpad | Développement seulement. |
| Ressources OpenUI5 servies par chaque application (`/apps/<id>/resources/`) | Assumé : pas de cache commun aux applications. |

## Utilitaires d'ABAP Cloud (D40)

| Écart | Statut |
|---|---|
| Fuseau horaire de l'utilisateur | UTC : `xco_cp_time=>time_zone->user` et `->utc` donnent les mêmes valeurs, `systemtstmp_*` ne convertit pas. |
| Numérotation et journal applicatif | Écrits dans la LUW de la requête : annulés si elle échoue (sur SAP, un numéro tiré est consommé). `use_2nd_db_connection` est ignoré. |
| Intervalle de numérotation non configuré | Créé à la première demande, de 1 à 99999999999999999999 (sur SAP : `cx_nr_object_not_found`). Numérotation externe et intervalles alphanumériques non pris en charge. |
| `/ui2/cl_json` | Pas de `generate` (données dynamiques), ni `assoc_arrays`, ni `conversion_exits`, ni `type_descr` ; les références d'objets sont écrites `null`. Un JSON invalide laisse les données inchangées. |
| `xco_cp_json` | `from_abap` écrit les `abap_bool` en `"X"`/`""` ; les noms des membres sont rapprochés sans tenir compte de la casse ni des `_` à la lecture. |
| `cl_abap_regex`, `cl_abap_matcher` | Moteur d'expressions régulières de JavaScript : les constructions propres à PCRE (quantificateurs possessifs, `\K`, récursion…) ne sont pas prises en charge (`cx_sy_regex`, ou un autre sens) ; la syntaxe POSIX est approchée (classes `[:alpha:]`…, `\<`, `\>`). `FIND … REGEX objet` avec un objet `cl_abap_regex` n'est pas pris en charge. |
| RTTS | `describe_by_name` lève `cx_sy_rtti_type_not_released` ; pas de création de types (`cl_abap_structdescr=>create`, `CREATE DATA … TYPE HANDLE`), pas d'attributs ni de méthodes dans `cl_abap_classdescr`. `absolute_name` vient du nom qualifié du transpiler. |
| `cl_abap_random*` | Générateur de Park-Miller (non cryptographique) : les suites diffèrent de celles de SAP pour une même graine. Pas de `cl_abap_random_packed*` ni `decfloat16`. |
| `cl_abap_char_utilities=>minchar` | Absent (caractère nul). |
| Traitement en arrière-plan (D41) | Les opérations restent en mémoire jusqu'à leur exécution : un processus pas encore exécuté quand l'application s'arrête ne l'est jamais (il reste `NEW`). Pas de reprise ni de nouvel essai d'un processus `ERRONEOUS`, pas de file par nom (`set_name` sert au suivi), pas de vérification de la phase transactionnelle d'appel (sur SAP, `save_for_execution` d'une opération contrôlée se fait en phase de sauvegarde). `if_bgmc_process_monitor` : états `NEW`, `SUCCESSFUL`, `ERRONEOUS` (noms propres à rap-transpiler). Un seul `COMMIT ENTITIES` par opération. |
| E-mail (D41) | Envoyé après la validation de la LUW, sans nouvel essai ; `send( )` rend toujours l'état `W` (en attente). Pas de modèles d'e-mail (`cl_bcs_mail_message=>create_instance_by_template`), ni de signature, ni de chiffrement. |

