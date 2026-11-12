# Couverture fonctionnelle : BO RAP managed

Cible (décision D14) : toutes les fonctionnalités d'un BO RAP managed ; le draft est venu ensuite
(D54).
Ce tableau est mis à jour à chaque jalon.

Légende : ✅ pris en charge et testé · 🟡 partiel ou non couvert par un test (voir la note) ·
⏳ prévu (jalon indiqué) · ❌ hors périmètre (raison indiquée).

Depuis J1, toutes les constructions de ces tableaux sont analysées et représentées dans l'IR,
avec un diagnostic positionné pour celles qui sont hors périmètre ; le statut indique le
comportement de l'application générée. Les tests de J4 portent sur la fixture Travel/Booking et
sur ses variantes (`packages/runtime/test/variants.ts`, tests `rap-variant*.test.ts`) qui
ajoutent ce que la fixture n'utilise pas : numérotation, feature control global, saver
(additional, unmanaged), ABAP SQL, ETag dépendant, API distantes.

## BDEF : en-tête et entités

| Fonctionnalité | Statut | Note |
|---|---|---|
| `managed implementation in class … unique` | ✅ | |
| `strict`, `strict ( 2 )` | ✅ | Accepté ; les règles strictes sont celles de SAP, l'outil ne les revérifie pas toutes. |
| `define root behavior for` / entité enfant, `alias` | ✅ | |
| `persistent table`, `mapping for … corresponding` | ✅ | |
| `lock master`, `lock dependent by` | ✅ | Verrou de ligne PostgreSQL sur l'instance du lock master (`FOR UPDATE NOWAIT`, cause `locked`, 409) ; un LUW à la fois par processus (D11). Conflit avec une autre transaction testé sur PostgreSQL (`rap-locks.test.ts`), y compris un verrou refusé en EML : la LUW continue. |
| `etag master` | ✅ | `If-Match` exigé (428), ETag périmé 412, `*` accepté ; dans un change set, comparé à l'état lu avant lui (D32). |
| `etag dependent by` | ✅ | ETag du maître (`@odata.etag`, `Core.OptimisticConcurrency` par la navigation), contrôlé sur les modifications ; un changement de l'entité dépendante change l'ETag du maître (D32). Test `rap-variant-etag.test.ts`. |
| `authorization master ( global )`, `( instance )`, `( global, instance )` | ✅ | Handlers appelés hors local mode ; refus → 403. |
| `authorization dependent by` | ✅ | Contrôle du master (`%update`) pour les opérations de l'entité dépendante. |
| `AUTHORITY-CHECK OBJECT … ID … FIELD …` (`DUMMY`, `sy-subrc` 0/4/12) | ✅ | Objets d'autorisation de abapGit (SUSO), rôles de `rapt/authorizations.json` donnés par les rôles du jeton OIDC, valeurs issues des claims (D34). Tests `rap-authorizations.test.ts`, `keycloak.test.ts`. |
| `early numbering` managed (UUID) | ✅ | |
| Numérotation externe (clé fournie, `mandatory : create`, `readonly : update`) | ✅ | |
| `early numbering` non managed (handler `FOR NUMBERING`) | ✅ | Création directe (`rap-variant-features.test.ts`) et création par association, deep create compris (`FOR CREATE Travel\_Booking`, un appel pour tous les parents, `failed`/`reported` ; `rap-variant-numbering.test.ts`). |
| `late numbering` | ❌ | Nécessite la phase `adjust_numbers` d'un saver. |
| `with additional save`, `with unmanaged save` (en-tête ou entité, `with full data`) | ✅ | Classe saver `lsc_…` : `save_modified` et `cleanup` ; unmanaged : lecture et verrous par la vue CDS (D30). Tests `rap-variant-additional-save`, `rap-variant-unmanaged-save`. |
| Saver hérité de `cl_abap_behavior_saver_failed` (`failed` dans `save_modified`) | ✅ | Annule la LUW, écriture managed comprise ; message renvoyé au client. |
| `with draft`, `draft table`, `total etag`, `draft action Edit / Activate optimized / Discard / Resume`, `draft determine action Prepare` | ✅ | Tables de brouillons, `IsActiveEntity`, verrou exclusif, activation par le runtime managed (D54). Voir les écarts dans [KNOWN_GAPS.md](../KNOWN_GAPS.md). |
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
| `mandatory` | ✅ | Pas de contrôle runtime, comme RAP (D20). En mode `enhanced` (D45) : contrôlé à la sauvegarde, sans validation, un message par champ. |
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

## Classes utilitaires d'ABAP Cloud dans l'ABP (D40)

| Fonctionnalité | Statut | Note |
|---|---|---|
| JSON : `/ui2/cl_json` (`serialize`, `deserialize`), `xco_cp_json` (`from_string`, `from_abap`, `apply`, `write_to`, `builder`) | ✅ | Modes de nommage, `compress`, `name_mappings`, booléens, dates, horodatages ISO, base64. Guide : [UTILITAIRES.md](UTILITAIRES.md). |
| Encodages : `cl_web_http_utility`, `cl_abap_conv_codepage`, `cl_abap_gzip`, `xco_cp=>string` / `xstring` | ✅ | Base64, UTF-8/16, ISO-8859-1, windows-1252, URL, HTML, gzip. |
| Texte : `cl_abap_char_utilities`, `cl_abap_string_utilities`, types `string_table`, `xstring_table` | ✅ | |
| Numérotation : `cl_numberrange_runtime` | ✅ | Intervalles de `rapt/number-ranges.json`, table `rapt_number_range`. |
| Dates : `cl_abap_tstmp`, `cl_abap_utclong`, `xco_cp=>sy`, `xco_cp_time` | ✅ | Fuseau UTC. |
| Journal applicatif : `cl_bali_*` | ✅ | Tables `rapt_application_log(_item)`, lecture par filtre. |
| Hachage : `cl_abap_message_digest`, `cl_abap_hmac` | ✅ | MD5, SHA1, SHA2. |
| Nombres aléatoires : `cl_abap_random*` | ✅ | Générateur déterministe par graine (non cryptographique). |
| Expressions régulières : `cl_abap_regex`, `cl_abap_matcher`, types `match_result(_tab)` | ✅ | Moteur JavaScript. |
| RTTS : `cl_abap_typedescr` et sous-classes | 🟡 | `describe_by_data(_ref)`, `describe_by_object_ref` ; pas `describe_by_name` ni la création de types. |
| Traitement en arrière-plan : `cl_bgmc_process_factory`, `if_bgmc_op_single`, `if_bgmc_op_single_tx_uncontr`, `cl_abap_tx` (D41) | ✅ | Après la validation de la LUW, dans une LUW à part ; `COMMIT ENTITIES` dans une opération non contrôlée ; état dans `rapt_background_process`. Test `background.test.ts`. |
| E-mail : `cl_bcs_mail_message`, `cl_bcs_mail_textpart`, `cl_bcs_mail_binarypart` (D41) | ✅ | Envoyé après la validation de la LUW par `MAIL_SMTP_URL`, sinon gardé dans `rapt_mail`. |

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
| Entités custom (`define custom entity`, `@ObjectModel.query.implementedBy`, `if_rap_query_provider`) | ✅ | Lectures OData par la classe de requête : plages et chaîne SQL du filtre, tri, pagination, compte, navigation, `$expand` (D43). |
| BO `managed with unmanaged save` sur une entité custom | ✅ | Mode `enhanced` seulement (`rapt/config.json`, D45) : instances lues par la classe de requête, écrites par `save_modified` vers l'API (D43). |
| Vues standards `I_Currency`, `I_UnitOfMeasure`, `I_Country`, `I_Language` et leurs textes | ✅ | Ajoutées quand une source les nomme, avec leurs données de référence (D44). |
| Value helps (`@Consumption.valueHelpDefinition`) | ✅ | Entité et vue de textes exposées implicitement en lecture seule, `Common.ValueList` (D44) ; `additionalBinding` (filtre, résultat), `useForValidation`, liste déroulante (`sizeCategory: #XS`), paramètres d'action (D56). |
| Table entities (`define [root] table entity`) | ✅ | Table et view entity ; persistance implicite d'un BO managed ; `null`, clés, associations, compositions (D55). |
| Types simples CDS (`define type x : abap.char(40);`) | ✅ | Objets DRTY (`.drty.acds`) : type et libellé des éléments (D55). |
| Types énumérés CDS (`define type x : abap.char(1) enum { … }`) | ✅ | Valeurs de base en base ; constantes utilisables dans le behavior pool. Exposition OData : refusée en mode `standard` comme sur SAP (CDS021), `EnumType` en mode `enhanced` (D55). |
| Vues standards `I_Region`, `I_CalendarDate`, `I_TimeZone`, `I_BusinessUserBasic`, `I_ExchangeRate` | ✅ | Calendrier généré, utilisateurs de l'IdP enregistrés à la connexion, taux de change à maintenir (D44). |
| Expressions CDS (CASE, CAST, calculs, littéraux) | ❌ | Prévu après le MVP. |
| Contrôle d'accès DCL (`define role … grant select on … where …`) | ✅ | Lectures OData filtrées pour l'utilisateur : `aspect pfcg_auth` (filtres `ACTVT = '03'`, n-uplets), `aspect user`, `?=`, comparaisons, `like`, `is [not] null`, `and`/`or`/`not`, chemins `_Assoc.Element` (to-one), `inheriting conditions from entity` (D35). Tests `rap-authorizations.test.ts`, `dcl.test.ts`. |
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
| Authentification : mode dev, Bearer JWT (OIDC, JWKS) | ✅ | Sessions navigateur (PKCE) : J6 ; jetons *client credentials* (utilisateur technique) ; serveur OAuth 2.0 de développement (`/oauth`, client credentials et PKCE) dans `rapt dev` (D60). |
| Binding *OData V4 - Web API* | ✅ | Sans annotations d'UI, value helps, side effects, feature control ; instances actives d'un BO draft (D60). |
| `$apply` : `filter`, `groupby`, `aggregate` (`sum`, `min`, `max`, `average`, `countdistinct`, `$count`) | ✅ | Avec le DCL de l'utilisateur ; autres transformations : 501 (D52). |
| Types énumération (`EnumType`) : JSON par nom de membre, littéraux `Ns.Type'M'` | ✅ | Mode `enhanced`, types énumérés CDS (D55). |
| JSON batch, `$value`, propriétés seules | ❌ | Hors MVP. |

## UI générée (OpenUI5)

| Fonctionnalité | Statut | Note |
|---|---|---|
| List Report : colonnes (`UI.lineItem`), tri (`UI.presentationVariant`), pagination continue | ✅ | `sap.f.DynamicPage`, `sap.m.Table`. |
| Champs de filtre (`UI.selectionField`), recherche (`@Search.searchable`) | ✅ | Conditions comme SAP Fiori (`=`, `!=`, `>`, `>=`, `<`, `<=`, `a...b`, `*x*`), plusieurs valeurs par champ, NUMC sans zéros de tête, plages de dates ; *Clear*, *Adapt Filters* (colonnes ajoutées comme filtres), résumé « Filtered By » (D51). |
| Variantes de l'utilisateur (`sap.m.VariantManagement`) | ✅ | Filtres, filtres et colonnes visibles, tri ; enregistrées par utilisateur par le service (`$variants`) ; variante par défaut, favoris (D51). |
| Paramètres du tableau : colonnes visibles, tri | ✅ | `sap.m.p13n.Popup` ; nombre de lignes dans le titre du tableau. |
| Aide à la saisie (`@Consumption.valueHelpDefinition`) | ✅ | Entité exposée implicitement, `Common.ValueList`, dialogue avec les descriptions de la vue de textes, dans les filtres et l'Object Page (D44). |
| Rafraîchissement de la liste après une modification sur l'Object Page, fil d'Ariane | ✅ | D51. |
| Création non-draft depuis la List Report | ✅ | Object Page en mode création, `POST` à l'enregistrement. |
| Suppression, actions de la table (`#FOR_ACTION` dans `UI.lineItem`) | ✅ | Sur la ligne sélectionnée. |
| Object Page : en-tête (`UI.headerInfo`), sections (`UI.facet` : identification, groupes de champs, tables) | ✅ | `sap.uxap.ObjectPageLayout`. |
| Édition et sauvegarde (PATCH dans un change set, `If-Match`) | ✅ | Annulation par `resetChanges`. |
| Tables des compositions, création et suppression d'enfants en mode édition | ✅ | Nouvelle ligne en tête de table, création et suppression envoyées dans le même change set à l'enregistrement. |
| Actions d'en-tête (`UI.identification`), paramètres (dialogue), actions factory | ✅ | Dialogue des paramètres, message d'erreur de l'action, ouverture de l'instance créée par une action factory. |
| Feature control : actions (`__OperationControl`), Edit/Delete (`__EntityControl`), champs (`__FieldControl`) | ✅ | Instance et global ; testé dans le navigateur (`ui-features.test.ts`). |
| Champs en lecture seule, obligatoires, modifiables à la création seulement | ✅ | Depuis les caractéristiques de champ de la BDEF. |
| Messages (erreurs, succès) | ✅ | `MessageBox`, `MessageToast`, `MessagePopover`. |
| Boutons selon les autorisations de l'utilisateur | ✅ | Create masqué sans autorisation globale de création (`$permissions`) ; Edit, Delete, actions et création d'enfants désactivés par instance (`__EntityControl`, `__OperationControl`, D36). Test `ui-authorizations.test.ts`. |
| Floorplans Worklist, Analytical List Page, Overview Page, Form entry | ✅ | `ui` de `rapt/config.json`, écrit par `rapt floorplan` ou la commande VS Code (D61) ; graphiques `@UI.chart` en SVG, onglets `@UI.selectionVariant` (D53). |
| Draft dans l'UI : création et édition en brouillon, enregistrement des champs, Save / Discard, état d'édition dans la liste | ✅ | D54 ; comme Fiori Elements : filtre *Editing Status*, brouillon de l'utilisateur à la place de l'instance active, *Locked by X*, `DraftIndicator`, *Keep Draft* / *Discard Draft* (D58). |
| Collaborative draft (`with collaborative draft`, `draft action Share`) | ✅ | Utilisateurs du brouillon, invitation, rejoindre par Edit, rafraîchissement toutes les 5 s (D59). |
| Valeurs d'un type énuméré : libellés, liste de choix en édition et en filtre | ✅ | Mode `enhanced` (D55). |

## Launchpad (D37)

| Fonctionnalité | Statut | Note |
|---|---|---|
| Groupes et tuiles (`launchpad.json`) : titre, sous-titre, pied, icône | ✅ | `sap.m.GenericTile` ; `rapt launchpad` contrôle le contenu (LPD001 à LPD007). |
| Tuiles affectées à des rôles de l'IdP (business catalog d'un business role) | ✅ | Filtrées par le serveur ; sans rôle, visibles par tous. |
| Tuiles dynamiques : `$count` d'un entity set, filtre `$filter` | ✅ | Avec les contrôles d'accès de l'utilisateur (DCL) ; lus au chargement. |
| Navigation par intent (`/#Objet-action`, `/go/Objet-action?…`) | ✅ | Paramètres transmis à l'application en query string. |
| Barre shell : accueil, recherche des tuiles, utilisateur, déconnexion | ✅ | `sap.f.ShellBar`, aussi au-dessus des applications ouvertes depuis le launchpad. |
| Une seule origine : UI des applications sous `/apps/<id>/`, services à leurs chemins | ✅ | Redirections réécrites ; 502 si une application ne répond pas. |
| Connexion unique : session OIDC du launchpad lue par les applications | ✅ | Autorisations, DCL, CSRF et rôle obligatoire de chaque application conservés ; testé (`launchpad.test.ts`). |
| Tuiles externes (URL) | ✅ | Ouvertes dans un nouvel onglet. |
| Docker : launchpad, applications et leurs bases, Keycloak (profil `oidc`) | ✅ | `docker-compose.yml` généré. |
| Spaces et pages (`spaces` → `pages` → `sections`), affectés à des rôles | ✅ | Onglets des spaces, liste des pages, dernier space mémorisé (D48). |
| Launchpad de développement (`rapt dev`) : application, documentation, `$metadata`, MCP | ✅ | D49. |
| Personnalisation par l'utilisateur, notifications, navigation entre applications depuis une application | ❌ | Voir KNOWN_GAPS. |

## Application générée et exploitation

| Fonctionnalité | Statut | Note |
|---|---|---|
| `package.json`, `server.mjs`, runtime embarqué (`vendor/`), `npm install` | ✅ | Test e2e. |
| CLI `rapt` publiée sur npm (`npm install -g rap-transpiler`, `npx rap-transpiler`) | ✅ | D66 ; archives de `pnpm pack` vérifiées à chaque tag avant publication. |
| Configuration par variables d'environnement (`.env.example`) | ✅ | |
| PostgreSQL (`DATABASE_URL`), schéma appliqué au démarrage | ✅ | Test e2e sur PostgreSQL 16. |
| PGlite embarqué (`PGLITE_DIR`) pour le développement | ✅ | Test e2e : démarrage, données conservées après un redémarrage (D33). |
| Dockerfile multi-étapes, `docker-compose.yml` (app + PostgreSQL) | ✅ | Image construite et `docker compose up` vérifié (service OData, actions, UI) ; job CI `docker`. |
| Profil Keycloak (realm importé : client `rapt-app`, utilisateur `alice`) | ✅ | `keycloak.test.ts` contre un vrai Keycloak : formulaire de connexion, PKCE, session, CSRF, déconnexion, jetons porteurs (JWKS) ; en CI avec le profil `oidc` du docker-compose généré (D33). |
| OIDC : jetons porteurs (JWKS), sessions navigateur (code + PKCE), CSRF, déconnexion | ✅ | Déconnexion avec `id_token_hint` : pas de page de confirmation chez le fournisseur (D37). |
| Rôle obligatoire (`OIDC_REQUIRED_ROLE`) | ✅ | Rôles Keycloak (`realm_access.roles`) ou revendication configurable. |
| Bundle UI5 optimisé (`ui5 build`) | ❌ | Ressources servies depuis les sources npm (D27). |
| Cloud Foundry (SAP BTP) : `manifest.yml`, route et PostgreSQL lié lus de `VCAP_*` | ✅ | D50, guide [DEPLOIEMENT.md](DEPLOIEMENT.md). |
| Serveur MCP du service (`rapt mcp`, `/mcp`) | ✅ | Un outil par opération, descriptions dans `rapt/mcp.json` (D47, guide [MCP.md](MCP.md)). |

