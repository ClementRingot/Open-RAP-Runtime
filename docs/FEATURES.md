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
| `lock master`, `lock dependent by` | 🟡 | Verrou de ligne PostgreSQL sur l'instance du lock master (`FOR UPDATE NOWAIT`, cause `locked`) ; un LUW à la fois par processus (D11). Conflit entre processus : test e2e en J6. |
| `etag master` | ✅ | `If-Match` exigé (428), ETag périmé 412, `*` accepté. |
| `etag dependent by` | 🟡 | Pas d'ETag exposé pour l'entité dépendante : `If-Match` n'y est pas contrôlé. |
| `authorization master ( global )`, `( instance )`, `( global, instance )` | ✅ | Handlers appelés hors local mode ; refus → 403. |
| `authorization dependent by` | ✅ | Contrôle du master (`%update`) pour les opérations de l'entité dépendante. |
| `early numbering` managed (UUID) | ✅ | |
| Numérotation externe (clé fournie, `mandatory : create`, `readonly : update`) | ✅ | |
| `early numbering` non managed (handler `FOR NUMBERING`) | 🟡 | Création directe : implémenté, non couvert par un test. Création par association (`FOR CREATE Travel\_Booking`) : non prise en charge. |
| `late numbering` | ❌ | Nécessite la phase `adjust_numbers` d'un saver. |
| `with additional save`, `with unmanaged save` | ❌ | Le saver ferait de l'ABAP SQL, exclu du périmètre ABP (D26). |
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
| `( features : global )` | 🟡 | Implémenté (handler `FOR GLOBAL FEATURES`), non couvert par un test. |
| `( precheck )` | ✅ | create, update, delete, actions, create par association. |

## Champs

| Fonctionnalité | Statut | Note |
|---|---|---|
| `readonly` | ✅ | Ignoré pour un consommateur OData (D25) ; modifiable en local mode. |
| `mandatory` | ✅ | Pas de contrôle runtime, comme RAP (D20). |
| `numbering : managed` | ✅ | |
| `readonly : update`, `mandatory : create` | ✅ | |
| `features : instance` (feature control dynamique des champs) | 🟡 | `__FieldControl` et refus d'une modification d'un champ en lecture seule ; non couvert par un test. |
| `suppress` | ✅ | Propriété absente du service. |

## Actions et fonctions

| Fonctionnalité | Statut | Note |
|---|---|---|
| Action d'instance, `result [1] $self` | ✅ | |
| Action sans résultat | ✅ | 204 en OData. |
| Résultat `entity …`, cardinalités `[0..*]` | 🟡 | Implémenté (collection, entité d'un autre entity set), non couvert par un test. |
| `internal action` | ✅ | Disponible en EML, non exposée en OData. |
| `static action` | ✅ | Liée à la collection ; résultat `$self` = l'instance créée. |
| `factory action` | ✅ | Le résultat est l'instance de `mapped` pour le `%cid` de l'appel. |
| Paramètre d'action (`parameter` vers une entité abstraite) | ✅ | |
| `( features : instance )` sur une action | ✅ | `Core.OperationAvailable` via `__OperationControl`. |
| `( features : global )` sur une action | 🟡 | Implémenté, non couvert par un test. |
| `function` d'instance | ✅ | GET ; résultat entité abstraite (type complexe). |
| `static function` | 🟡 | Implémenté, non couvert par un test. |
| `determine action` | ❌ | Prévu après le MVP. |

## Déterminations et validations

| Fonctionnalité | Statut | Note |
|---|---|---|
| `determination … on modify` (triggers `create`, `field`) | ✅ | Sémantique D21, par tours ; une action interne exécutée depuis une détermination. |
| Triggers `update`, `delete` | 🟡 | Implémentés, non couverts par un test. |
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
| ABAP SQL (`SELECT`…) dans l'ABP | ❌ | Diagnostic ABP007 (D26). |

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
| Side effects (`side effects { … }`) | 🟡 | Générés en `Common.SideEffects` ; non couverts par un test. |

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
