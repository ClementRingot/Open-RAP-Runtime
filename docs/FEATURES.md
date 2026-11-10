# Couverture fonctionnelle : BO RAP managed non-draft

Cible (décision D14) : toutes les fonctionnalités d'un BO RAP managed sans draft.
Ce tableau est mis à jour à chaque jalon.

Légende : ✅ pris en charge et testé · 🟡 partiel ou non couvert par un test (voir la note) ·
⏳ prévu (jalon indiqué) · ❌ hors périmètre (raison indiquée).

Depuis J1, toutes les constructions de ces tableaux sont analysées et représentées dans l'IR,
avec un diagnostic positionné pour celles qui sont hors périmètre ; le statut indique le
comportement de l'application générée. Les tests de J4 portent sur la fixture Travel/Booking et
sur deux variantes (`packages/runtime/test/rap-variant*.test.ts`) qui ajoutent ce que la fixture
n'utilise pas.

## BDEF : en-tête et entités

| Fonctionnalité | Statut | Note |
|---|---|---|
| `managed implementation in class … unique` | ✅ | |
| `strict`, `strict ( 2 )` | ✅ | Accepté ; les règles strictes sont celles de SAP, l'outil ne les revérifie pas toutes. |
| `define root behavior for` / entité enfant, `alias` | ✅ | |
| `persistent table`, `mapping for … corresponding` | ✅ | |
| `lock master`, `lock dependent by` | ✅ | Verrou de ligne PostgreSQL sur l'instance du lock master (`FOR UPDATE NOWAIT`, cause `locked`, 409) ; un LUW à la fois par processus (D11). Conflit avec une autre transaction testé sur PostgreSQL (`rap-locks.test.ts`), y compris un verrou refusé en EML : la LUW continue. |
| `etag master` | ✅ | `If-Match` exigé (428), ETag périmé 412, `*` accepté. |
| `etag dependent by` | 🟡 | Pas d'ETag exposé pour l'entité dépendante : `If-Match` n'y est pas contrôlé. |
| `authorization master ( global )`, `( instance )`, `( global, instance )` | ✅ | Handlers appelés hors local mode ; refus → 403. |
| `authorization dependent by` | ✅ | Contrôle du master (`%update`) pour les opérations de l'entité dépendante. |
| `early numbering` managed (UUID) | ✅ | |
| Numérotation externe (clé fournie, `mandatory : create`, `readonly : update`) | ✅ | |
| `early numbering` non managed (handler `FOR NUMBERING`) | 🟡 | Création directe : ✅ (`rap-variant-features.test.ts`). Création par association (`FOR CREATE Travel\_Booking`) : non prise en charge. |
| `late numbering` | ❌ | Nécessite la phase `adjust_numbers` d'un saver. |
| `with additional save`, `with unmanaged save` (en-tête ou entité, `with full data`) | ✅ | Classe saver `lsc_…` : `save_modified` et `cleanup` ; unmanaged : lecture et verrous par la vue CDS (D30). Tests `rap-variant-additional-save`, `rap-variant-unmanaged-save`. |
| Saver hérité de `cl_abap_behavior_saver_failed` (`failed` dans `save_modified`) | ✅ | Annule la LUW, écriture managed comprise ; message renvoyé au client. |
| `with draft` | ❌ | Exclu par le cahier des charges. |
| Implémentation `unmanaged` | ❌ | Hors cible (BO managed). |
| `with privileged mode` | ✅ | `PRIVILEGED` saute les contrôles d'autorisation. |
| `changedocuments`, `event`, `extensible` | ❌ | Pas d'infrastructure équivalente. |

## Opérations

| Fonctionnalité | Statut | Note |
|---|---|---|
| `create`, `update`, `delete` | ✅ | OData (POST, PATCH, PUT, DELETE) et EML. |
| `internal create/update/delete` | ✅ | Disponibles en EML, non exposés en OData (405). |
| Suppression en cascade des compositions | ✅ | |
| `association _X { create; }` (create par association) | ✅ | OData (navigation, deep insert) et EML. |
| `( features : instance )` sur les opérations | ✅ | `__EntityControl`, `__OperationControl` ; opération refusée → 409. |
| `( features : global )` | ✅ | Handler `FOR GLOBAL FEATURES` ; opération refusée → 409 ; exposé comme le feature control d'instance (`__EntityControl`), bouton Delete désactivé dans l'UI. |
| `( precheck )` | ✅ | create, update, delete, actions, create par association. |

## Champs

| Fonctionnalité | Statut | Note |
|---|---|---|
| `readonly` | ✅ | Ignoré pour un consommateur OData (D25) ; modifiable en local mode. |
| `mandatory` | ✅ | Pas de contrôle runtime, comme RAP (D20). |
| `numbering : managed` | ✅ | |
| `readonly : update`, `mandatory : create` | ✅ | |
| `features : instance` (feature control dynamique des champs) | ✅ | `__FieldControl` (`Common.FieldControl`), modification d'un champ en lecture seule refusée (400), champ non modifiable dans l'UI. |
| `suppress` | ✅ | Propriété absente du service. |

## Actions et fonctions

| Fonctionnalité | Statut | Note |
|---|---|---|
| Action d'instance, `result [1] $self` | ✅ | |
| Action sans résultat | ✅ | 204 en OData. |
| Résultat `entity …`, cardinalités `[0..*]` | ✅ | Collection d'entités d'un autre entity set. |
| `internal action` | ✅ | Disponible en EML, non exposée en OData. |
| `static action` | ✅ | Liée à la collection ; résultat `$self` = l'instance créée. |
| `factory action` | ✅ | Le résultat est l'instance de `mapped` pour le `%cid` de l'appel. |
| Paramètre d'action (`parameter` vers une entité abstraite) | ✅ | |
| `( features : instance )` sur une action | ✅ | `Core.OperationAvailable` via `__OperationControl`. |
| `( features : global )` sur une action | ✅ | Action d'instance : `Core.OperationAvailable` via `__OperationControl` (valeur commune à toutes les instances) ; action statique : contrôle à l'exécution seulement. |
| `function` d'instance | ✅ | GET ; résultat entité abstraite (type complexe). |
| `static function` | ✅ | GET sur la collection. |
| `determine action` | ❌ | Prévu après le MVP. |

## Déterminations et validations

| Fonctionnalité | Statut | Note |
|---|---|---|
| `determination … on modify` (triggers `create`, `field`) | ✅ | Sémantique D21, par tours ; une action interne exécutée depuis une détermination. |
| Triggers `update`, `delete` | ✅ | `delete` : la détermination reçoit les clés des instances supprimées (encore en base jusqu'à la sauvegarde). |
| `determination … on save` | ✅ | |
| `validation … on save` | ✅ | Échec → 400 et annulation du LUW. |

## Messages et réponses

| Fonctionnalité | Statut | Note |
|---|---|---|
| `failed`, `reported`, `mapped` | ✅ | |
| `new_message_with_text` | ✅ | |
| `new_message` (classe de messages T100, MSAG) | ✅ | Code OData `CLASSE/NNN`. |
| Classes d'exception implémentant `if_abap_behv_message` | ✅ | Socle « clean-room » `cx_root` (D24) ; attributs du message résolus par nom. |
| `%element` → `target` OData | ✅ | Relatif à la ressource de la requête, sinon absolu `/Set(clé)/Propriété`. |
| Sévérités → erreur OData ou en-tête `sap-messages` | ✅ | |
| `%state_area`, messages d'état | 🟡 | Sans draft, les messages sont renvoyés comme messages de transition. |

## EML dans l'ABP

| Fonctionnalité | Statut | Note |
|---|---|---|
| `READ ENTITIES` / `READ ENTITY` (`FIELDS`, `ALL FIELDS`, `FROM`), `RESULT`, `FAILED`, `REPORTED` | ✅ | Abaissé par notre passe (D2). |
| `READ … BY \_assoc`, `LINK` | ✅ | |
| `READ … EXECUTE` (fonctions) | ✅ | |
| `MODIFY ENTITIES` `CREATE`, `UPDATE`, `DELETE`, `EXECUTE` (`FIELDS`, `SET FIELDS`, `FROM`, `AUTO FILL CID`) | ✅ | Y compris les formes qu'abaplint n'analyse pas (`AUTO FILL CID SET FIELDS`). |
| `MODIFY … CREATE BY \_assoc` | ✅ | |
| `IN LOCAL MODE`, `PRIVILEGED` | ✅ | Local mode : ni autorisation ni feature control, champs en lecture seule modifiables. |
| `COMMIT ENTITIES`, `ROLLBACK ENTITIES` dans un handler | ✅ | Interdits, comme dans RAP (erreur à l'exécution). |
| `GET PERMISSIONS`, `SET LOCKS`, `MODIFY … OPERATIONS`, `RELATING TO`, `AUGMENTING`, `RAISE ENTITY EVENT` | ❌ | Diagnostic ABP005/ABP007. |

## ABAP SQL dans l'ABP

| Fonctionnalité | Statut | Note |
|---|---|---|
| `SELECT` sur les tables et entités CDS du projet : `SINGLE`, `INTO TABLE`, `APPENDING`, `CORRESPONDING`, `WHERE` (dont `IN` sur un range, `LIKE`, `BETWEEN`, `EXISTS`), `ORDER BY` (dont `PRIMARY KEY`), `UP TO n ROWS`, `GROUP BY`/`HAVING`, agrégats, jointures, `FOR ALL ENTRIES` | ✅ | Vues au format ABAP du schéma `rapt_abap`, dans la transaction de la LUW (D26). Test `rap-variant-sql.test.ts`. |
| Test d'existence `SELECT SINGLE @abap_true … INTO @DATA(x)`, `MAX`/`MIN` en déclaration en ligne | ✅ | Déclarés par la passe de réécriture (abaplint ne les type pas). |
| Autres littéraux, agrégats ou expressions en déclaration en ligne | ❌ | Diagnostic ABP009 : déclarer la cible. |
| `SELECT … ENDSELECT` | 🟡 | Avec `SELECT *` seulement (ABP007 sinon). |
| `OPEN CURSOR`, `FETCH NEXT CURSOR` | 🟡 | Hors ABAP Cloud (refusés par la vérification, comme sur SAP) ; pris en charge par le runtime. |
| Types des entités CDS dans l'ABP (`DATA ls TYPE zr_travel`) | ✅ | Tables « ombre » (D19, D26). |
| `MESSAGE … INTO` | ✅ | Textes des classes de messages du projet. |
| `INSERT`, `UPDATE`, `MODIFY`, `DELETE` dans le saver (`save_modified`) | ✅ | `MAPPING FROM ENTITY` et `INDICATORS SET STRUCTURE %control` exacts (kernel) ; écritures classiques par les vues `rapt_abap` et leurs triggers (D30). |
| `INSERT`, `UPDATE`, `MODIFY`, `DELETE` dans un handler ; `WITH` | ❌ | Diagnostic ABP007 : le runtime RAP écrit le BO, le modifier par EML. |

## API distantes dans l'ABP (D31)

| Fonctionnalité | Statut | Note |
|---|---|---|
| Client HTTP : `cl_http_destination_provider` (`create_by_url`, `create_by_comm_arrangement`, `create_by_cloud_destination`), `cl_web_http_client_manager`, `if_web_http_client`, `if_web_http_request`, `if_web_http_response` | ✅ | Chemin, requête, en-têtes, corps texte ou binaire, formulaire, basic/bearer, statut, en-têtes et corps de la réponse. Test `rap-variant-remote.test.ts`. |
| Destinations | ✅ | Variables d'environnement `DESTINATION_<NOM>_URL`, `_USER`/`_PASSWORD`, `_TOKEN`, `_HEADERS` ; listées dans le `.env.example` généré. |
| Client proxy OData V4 (`/iwbep/cl_cp_factory_remote`, `cl_web_odata_client_factory`) avec la classe d'un SCM2 | ✅ | Lecture de liste (`create_by_range`, `and`/`or`/`not`, `$select`, `$orderby`, `$top`, `$skip`, `$count`), lecture par clé, création, mise à jour, suppression, ETag, jeton CSRF. |
| Client proxy OData V2 avec les entités abstraites d'un SCM | ✅ | `d.results`, `__count`, `/Date()/`, `$inlinecount`, `substringof`. |
| Exceptions `cx_http_dest_provider_error`, `cx_web_http_client_error`, `/iwbep/cx_gateway`, `/iwbep/cx_cp_remote` | ✅ | `get_text( )`, `http_status_code`, `http_error_body`. |
| `$batch`, `$expand`, deep insert, navigation par association, actions et fonctions distantes, value controls | ❌ | Voir KNOWN_GAPS.md. |
| Communication targets, SOAP (`cl_soap_destination_provider`), RFC | ❌ | |

## Projection

| Fonctionnalité | Statut | Note |
|---|---|---|
| BDEF `projection` : `use create/update/delete/action/function/association` | ✅ | |
| `use etag` | ✅ | |
| Éléments renommés ou omis dans la projection | ✅ | |
| `augment`, precheck et actions propres à la projection | ❌ | Prévu après le MVP. |

## CDS et service

| Fonctionnalité | Statut | Note |
|---|---|---|
| `define root view entity`, `define view entity`, `as projection on`, `provider contract` | ✅ | |
| `composition`, `association to parent`, `redirected to` | ✅ | |
| Associations vers des entités sans BO (entity sets en lecture seule) | ✅ | Entités exposées sans comportement : lecture seule. |
| Métadonnées d'extension (DDLX) et fusion des annotations | ✅ | |
| Entités abstraites (paramètres et résultats d'actions et de fonctions) | ✅ | |
| Expressions CDS (CASE, CAST, calculs, littéraux) | ❌ | Prévu après le MVP. |
| Contrôle d'accès DCL | ❌ | `@AccessControl.authorizationCheck` est ignoré. |
| Side effects (`side effects { … }`) | ✅ | `Common.SideEffects` dans le `$metadata` ; l'UI générée ne les exploite pas encore (rechargement de l'objet après sauvegarde). |

## Service OData V4

| Fonctionnalité | Statut | Note |
|---|---|---|
| Document de service, `$metadata` (CSDL avec annotations) | ✅ | |
| GET collection, GET entité (clé courte et nommée) | ✅ | |
| Navigation `Entité(…)/_Assoc`, clé sur la navigation, `/$count` | ✅ | |
| `$filter` : eq, ne, gt, ge, lt, le, and, or, not, in, parenthèses, `null` | ✅ | Requêtes SQL paramétrées. |
| `$filter` : contains, startswith, endswith, tolower, toupper, trim, length, indexof, substring, concat, year…second, now | ✅ | `%` et `_` sont des caractères littéraux. |
| `$filter` sur une navigation vers un (`_Travel/Status`) | ✅ | Sous-requête scalaire. |
| `$filter` avec `any`/`all` sur une collection | ❌ | Réponse 501. |
| `$orderby`, `$top`, `$skip`, `$count` | ✅ | Les clés complètent le tri : pagination stable. |
| `$select` | ✅ | Clés et ETag toujours lus. |
| `$expand` un niveau, avec `$select`, `$orderby`, `$filter`, `$top`, `$skip`, `$count` imbriqués | ✅ | `$top`/`$skip` par parent (`row_number()`). `$expand` imbriqué : 501. |
| `$search` simple | ✅ | ILIKE sur les champs `@Search.defaultSearchElement`, chaque terme requis. |
| `IEEE754Compatible=true` (Decimal et Int64 en chaînes) | ✅ | Nombres JSON exacts sinon, en lecture comme en écriture. |
| ETag (`@odata.etag`, en-tête `ETag`), `If-Match` | ✅ | |
| POST, PATCH, PUT, DELETE, deep insert, création par navigation | ✅ | `Location`, `Prefer: return=minimal`. |
| Actions liées et statiques (POST), fonctions (GET) | ✅ | |
| `$batch` multipart : lectures et change sets | ✅ | Un change set = un LUW, références `$<Content-ID>`, réponses différées (D23). |
| Feature control d'instance dans les lectures | ✅ | `__EntityControl`, `__OperationControl`, `__FieldControl` (D25). |
| Jeton CSRF (`X-CSRF-Token: Fetch`) | ✅ | Exigé pour les sessions par cookie (J6). |
| Erreurs au format OData V4 (`@Common.numericSeverity`, `details`, `target`) | ✅ | Statut selon la cause d'échec (D22). |
| Paramètres `sap-*` | ✅ | Ignorés. |
| Authentification : mode dev, Bearer JWT (OIDC, JWKS) | ✅ | Sessions navigateur : J6. |
| `$apply`, JSON batch, `$value`, propriétés seules | ❌ | Hors MVP. |

## UI générée (OpenUI5)

| Fonctionnalité | Statut | Note |
|---|---|---|
| List Report : colonnes (`UI.lineItem`), tri (`UI.presentationVariant`), pagination continue | ✅ | `sap.f.DynamicPage`, `sap.m.Table`. |
| Champs de filtre (`UI.selectionField`), recherche (`@Search.searchable`) | ✅ | Texte : `contains` insensible à la casse ; dates et nombres : égalité. |
| Création non-draft depuis la List Report | ✅ | Object Page en mode création, `POST` à l'enregistrement. |
| Suppression, actions de la table (`#FOR_ACTION` dans `UI.lineItem`) | ✅ | Sur la ligne sélectionnée. |
| Object Page : en-tête (`UI.headerInfo`), sections (`UI.facet` : identification, groupes de champs, tables) | ✅ | `sap.uxap.ObjectPageLayout`. |
| Édition et sauvegarde (PATCH dans un change set, `If-Match`) | ✅ | Annulation par `resetChanges`. |
| Tables des compositions, création et suppression d'enfants en mode édition | ✅ | Nouvelle ligne en tête de table, création et suppression envoyées dans le même change set à l'enregistrement. |
| Actions d'en-tête (`UI.identification`), paramètres (dialogue), actions factory | ✅ | Dialogue des paramètres, message d'erreur de l'action, ouverture de l'instance créée par une action factory. |
| Feature control : actions (`__OperationControl`), Edit/Delete (`__EntityControl`), champs (`__FieldControl`) | ✅ | Instance et global ; testé dans le navigateur (`ui-features.test.ts`). |
| Champs en lecture seule, obligatoires, modifiables à la création seulement | ✅ | Depuis les caractéristiques de champ de la BDEF. |
| Messages (erreurs, succès) | ✅ | `MessageBox`, `MessageToast`, `MessagePopover`. |
| Aide à la saisie (value help), variantes, personnalisation de table | ❌ | Prévu après le MVP. |

## Application générée et exploitation

| Fonctionnalité | Statut | Note |
|---|---|---|
| `package.json`, `server.mjs`, runtime embarqué (`vendor/`), `npm install` | ✅ | Test e2e. |
| Configuration par variables d'environnement (`.env.example`) | ✅ | |
| PostgreSQL (`DATABASE_URL`), schéma appliqué au démarrage | ✅ | Test e2e sur PostgreSQL 16. |
| PGlite embarqué (`PGLITE_DIR`) pour le développement | 🟡 | Repli du test e2e quand aucun PostgreSQL n'est disponible. |
| Dockerfile multi-étapes, `docker-compose.yml` (app + PostgreSQL) | ✅ | Image construite et `docker compose up` vérifié (service OData, actions, UI) ; job CI `docker`. |
| Profil Keycloak (realm importé : client `rapt-app`, utilisateur `alice`) | 🟡 | Non exécuté contre un vrai Keycloak ; le flux est testé avec un fournisseur simulé. |
| OIDC : jetons porteurs (JWKS), sessions navigateur (code + PKCE), CSRF, déconnexion | ✅ | |
| Rôle obligatoire (`OIDC_REQUIRED_ROLE`) | ✅ | Rôles Keycloak (`realm_access.roles`) ou revendication configurable. |
| Bundle UI5 optimisé (`ui5 build`) | ❌ | Ressources servies depuis les sources npm (D27). |

