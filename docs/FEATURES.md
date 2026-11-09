# Couverture fonctionnelle : BO RAP managed non-draft

Cible (décision D14) : toutes les fonctionnalités d'un BO RAP managed sans draft.
Ce tableau est mis à jour à chaque jalon.

Légende : ✅ pris en charge et testé · 🟡 partiel (voir la note) · ⏳ prévu (jalon indiqué) ·
❌ hors périmètre (raison indiquée).

Depuis J1, toutes les constructions de ces tableaux sont analysées et représentées dans l'IR,
avec un diagnostic positionné pour celles qui sont hors périmètre ; le statut indique le
comportement de l'application générée.

## BDEF : en-tête et entités

| Fonctionnalité | Statut | Note |
|---|---|---|
| `managed implementation in class … unique` | ✅ | |
| `strict`, `strict ( 2 )` | ✅ | Accepté ; les règles strictes sont celles de SAP, l'outil ne les revérifie pas toutes. |
| `define root behavior for` / entité enfant, `alias` | ✅ | |
| `persistent table` | ✅ | |
| `lock master`, `lock dependent by` | ⏳ J4 | `SELECT … FOR UPDATE NOWAIT` sur la racine. |
| `etag master`, `etag dependent by` | ⏳ J4 | |
| `authorization master ( global )`, `( instance )`, `( global, instance )` | ⏳ J4 | Handlers appelés pour les requêtes OData (pas en local mode). |
| `authorization dependent by` | ⏳ J4 | |
| `early numbering` managed (UUID) | ⏳ J4 | |
| Numérotation externe (clé fournie, `mandatory : create`, `readonly : update`) | ⏳ J4 | |
| `early numbering` non managed (handler `FOR NUMBERING`) | ⏳ J4 | |
| `late numbering` | ❌ | Nécessite la phase `adjust_numbers` d'un saver. |
| `with additional save`, `with unmanaged save` | ❌ | Le saver ferait de l'ABAP SQL, exclu du périmètre ABP. |
| `with draft` | ❌ | Exclu par le cahier des charges. |
| Implémentation `unmanaged` | ❌ | Hors cible (BO managed). |
| `with privileged mode` | ⏳ J4 | Accepté ; l'EML de l'ABP est toujours traité en local mode. |
| `changedocuments`, `event`, `extensible` | ❌ | Pas d'infrastructure équivalente. |

## Opérations

| Fonctionnalité | Statut | Note |
|---|---|---|
| `create`, `update`, `delete` | ⏳ J4 | |
| `internal create/update/delete` | ⏳ J4 | Disponibles en EML, non exposés en OData. |
| Suppression en cascade des compositions | ⏳ J4 | |
| `association _X { create; }` (create par association) | ⏳ J4 | OData (navigation, deep insert) et EML. |
| `( features : instance )`, `( features : global )` sur les opérations | ⏳ J4 | Exposé via `__EntityControl` et `Capabilities.*Restrictions`. |
| `( precheck )` | ⏳ J4 | |

## Champs

| Fonctionnalité | Statut | Note |
|---|---|---|
| `readonly` | ⏳ J4 | Ignoré pour un consommateur OData ; modifiable en local mode. |
| `mandatory` | ⏳ J4 | Pas de contrôle runtime, comme RAP (D20). |
| `numbering : managed` | ⏳ J4 | |
| `readonly : update`, `mandatory : create` | ⏳ J4 | |
| `features : instance` (feature control dynamique des champs) | ⏳ J4 | Exposé via `__FieldControl` et `Common.FieldControl`. |
| `suppress` | ⏳ J4 | |

## Actions et fonctions

| Fonctionnalité | Statut | Note |
|---|---|---|
| Action d'instance, `result [1] $self` | ⏳ J4 | |
| Action sans résultat, résultat `entity …`, cardinalités | ⏳ J4 | |
| `internal action` | ⏳ J4 | Disponible en EML, non exposée en OData. |
| `static action` | ⏳ J4 | |
| `factory action` | ⏳ J4 | |
| Paramètre d'action (`parameter` vers une entité abstraite) | ⏳ J4 | |
| `( features : instance )`, `( features : global )` sur une action | ⏳ J4 | `Core.OperationAvailable` via `__OperationControl`. |
| `function` | ⏳ J4 | Liée et statique. |
| `determine action` | ❌ | Prévu après le MVP. |

## Déterminations et validations

| Fonctionnalité | Statut | Note |
|---|---|---|
| `determination … on modify` (triggers `create`, `update`, `delete`, `field`) | ⏳ J4 | Sémantique D21. |
| `determination … on save` | ⏳ J4 | |
| `validation … on save` (triggers `create`, `update`, `delete`, `field`) | ⏳ J4 | |

## Messages et réponses

| Fonctionnalité | Statut | Note |
|---|---|---|
| `failed`, `reported`, `mapped` | ⏳ J4 | |
| `new_message_with_text` | ⏳ J4 | |
| `new_message` (classe de messages T100, MSAG) | ⏳ J4 | |
| Classes d'exception implémentant `if_abap_behv_message` | ⏳ J4 | Socle « clean-room » `cx_*`. |
| `%element` → `target` OData | ⏳ J4 | |
| Sévérités → erreur OData ou en-tête `sap-messages` | ⏳ J4 | |
| `%state_area`, messages d'état | 🟡 | Sans draft, les messages sont renvoyés comme messages de transition. |

## EML dans l'ABP

| Fonctionnalité | Statut | Note |
|---|---|---|
| `READ ENTITIES` (`FIELDS`, `ALL FIELDS`, `FROM`), `RESULT`, `FAILED`, `REPORTED` | ⏳ J4 | Abaissé par le transpiler. |
| `READ … BY \_assoc`, `LINK` | ⏳ J4 | Abaissé par notre passe (D2). |
| `MODIFY ENTITIES` `CREATE`, `UPDATE`, `DELETE`, `EXECUTE` (`FIELDS`, `SET FIELDS`, `FROM`, `AUTO FILL CID`) | ⏳ J4 | Abaissé par le transpiler. |
| `MODIFY … CREATE BY \_assoc` | ⏳ J4 | Abaissé par notre passe (D2). |
| `IN LOCAL MODE`, `PRIVILEGED` | 🟡 | Toujours traité comme local mode (PLAN.md, V7). |
| `COMMIT ENTITIES`, `ROLLBACK ENTITIES` dans un handler | ⏳ J4 | Interdits, comme dans RAP (erreur à l'exécution). |
| `GET PERMISSIONS`, `SET LOCKS`, `READ … EXECUTE`, `MODIFY … OPERATIONS`, `RELATING TO`, `AUGMENTING` | ❌ | Prévu après le MVP. |

## Projection

| Fonctionnalité | Statut | Note |
|---|---|---|
| BDEF `projection` : `use create/update/delete/action/association` | ✅ | |
| `use etag` | ⏳ J4 | |
| Éléments renommés ou omis dans la projection | ✅ | |
| `augment`, precheck et actions propres à la projection | ❌ | Prévu après le MVP. |

## CDS et service

| Fonctionnalité | Statut | Note |
|---|---|---|
| `define root view entity`, `define view entity`, `as projection on`, `provider contract` | ✅ | |
| `composition`, `association to parent`, `redirected to` | ✅ | |
| Associations vers des entités sans BO (entity sets en lecture seule) | ✅ | Entités exposées sans comportement : lecture seule. |
| Métadonnées d'extension (DDLX) et fusion des annotations | ✅ | |
| Entités abstraites (paramètres d'action) | ⏳ J4 | |
| Expressions CDS (CASE, CAST, calculs, littéraux) | ❌ | Prévu après le MVP. |
| Contrôle d'accès DCL | ❌ | `@AccessControl.authorizationCheck` est ignoré. |
| Side effects (`side effects { … }`) | ⏳ J4 | Générés en `Common.SideEffects`. |

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
| `IEEE754Compatible=true` (Decimal et Int64 en chaînes) | ✅ | Nombres JSON exacts sinon. |
| ETag (`@odata.etag`, en-tête `ETag`) | ✅ | `If-Match` : J4. |
| `$batch` multipart (lectures) | ✅ | Change sets : J4. |
| Jeton CSRF (`X-CSRF-Token: Fetch`) | ✅ | Exigé pour les sessions par cookie (J6). |
| Erreurs au format OData V4 (`@Common.numericSeverity`) | ✅ | |
| Paramètres `sap-*` | ✅ | Ignorés. |
| Authentification : mode dev, Bearer JWT (OIDC, JWKS) | ✅ | Sessions navigateur : J6. |
| `$apply`, JSON batch, `$value`, propriétés seules | ❌ | Hors MVP. |
