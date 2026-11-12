# Feature coverage: managed RAP BO

Target (decision D14): all the features of a managed RAP BO; draft came afterwards (D54).
This table is updated at each milestone.

Legend: ✅ supported and tested · 🟡 partial or not covered by a test (see the note) ·
⏳ planned (milestone given) · ❌ out of scope (reason given).

Since M1, all the constructs of these tables are parsed and represented in the IR, with a
positioned diagnostic for those that are out of scope; the status gives the behavior of the
generated application. The tests of M4 use the Travel/Booking fixture and its variants
(`packages/runtime/test/variants.ts`, `rap-variant*.test.ts` tests) which add what the fixture
does not use: numbering, global feature control, saver (additional, unmanaged), ABAP SQL,
dependent ETag, remote APIs.

## BDEF: header and entities

| Feature | Status | Note |
|---|---|---|
| `managed implementation in class … unique` | ✅ | |
| `strict`, `strict ( 2 )` | ✅ | Accepted; the strict rules are those of SAP, the tool does not check them all again. |
| `define root behavior for` / child entity, `alias` | ✅ | |
| `persistent table`, `mapping for … corresponding` | ✅ | |
| `lock master`, `lock dependent by` | ✅ | PostgreSQL row lock on the instance of the lock master (`FOR UPDATE NOWAIT`, cause `locked`, 409); one LUW at a time per process (D11). Conflict with another transaction tested on PostgreSQL (`rap-locks.test.ts`), including a lock refused in EML: the LUW goes on. |
| `etag master` | ✅ | `If-Match` required (428), stale ETag 412, `*` accepted; in a change set, compared with the state read before it (D32). |
| `etag dependent by` | ✅ | ETag of the master (`@odata.etag`, `Core.OptimisticConcurrency` through the navigation), checked on changes; a change of the dependent entity changes the ETag of the master (D32). Test `rap-variant-etag.test.ts`. |
| `authorization master ( global )`, `( instance )`, `( global, instance )` | ✅ | Handlers called outside local mode; refusal → 403. |
| `authorization dependent by` | ✅ | Check of the master (`%update`) for the operations of the dependent entity. |
| `AUTHORITY-CHECK OBJECT … ID … FIELD …` (`DUMMY`, `sy-subrc` 0/4/12) | ✅ | Authorization objects of abapGit (SUSO), roles of `rapt/authorizations.json` given by the roles of the OIDC token, values from the claims (D34). Tests `rap-authorizations.test.ts`, `keycloak.test.ts`. |
| Managed `early numbering` (UUID) | ✅ | |
| External numbering (key given, `mandatory : create`, `readonly : update`) | ✅ | |
| Unmanaged `early numbering` (`FOR NUMBERING` handler) | ✅ | Direct creation (`rap-variant-features.test.ts`) and creation by association, deep create included (`FOR CREATE Travel\_Booking`, one call for all the parents, `failed`/`reported`; `rap-variant-numbering.test.ts`). |
| `late numbering` | ❌ | Needs the `adjust_numbers` phase of a saver. |
| `with additional save`, `with unmanaged save` (header or entity, `with full data`) | ✅ | Saver class `lsc_…`: `save_modified` and `cleanup`; unmanaged: reads and locks through the CDS view (D30). Tests `rap-variant-additional-save`, `rap-variant-unmanaged-save`. |
| Saver inheriting from `cl_abap_behavior_saver_failed` (`failed` in `save_modified`) | ✅ | Rolls back the LUW, managed write included; message returned to the client. |
| `with draft`, `draft table`, `total etag`, `draft action Edit / Activate optimized / Discard / Resume`, `draft determine action Prepare` | ✅ | Draft tables, `IsActiveEntity`, exclusive lock, activation by the managed runtime (D54). See the gaps in [KNOWN_GAPS.md](../KNOWN_GAPS.md). |
| `unmanaged` implementation | ❌ | Out of the target (managed BO). |
| `with privileged mode` | ✅ | `PRIVILEGED` skips the authorization checks. |
| `changedocuments`, `event`, `extensible` | ❌ | No equivalent infrastructure. |

## Operations

| Feature | Status | Note |
|---|---|---|
| `create`, `update`, `delete` | ✅ | OData (POST, PATCH, PUT, DELETE) and EML. |
| `internal create/update/delete` | ✅ | Available in EML, not exposed in OData (405). |
| Cascading delete of the compositions | ✅ | |
| `association _X { create; }` (create by association) | ✅ | OData (navigation, deep insert) and EML. |
| `( features : instance )` on the operations | ✅ | `__EntityControl`, `__OperationControl`; refused operation → 409. |
| `( features : global )` | ✅ | `FOR GLOBAL FEATURES` handler; refused operation → 409; exposed like the instance feature control (`__EntityControl`), Delete button disabled in the UI. |
| `( precheck )` | ✅ | create, update, delete, actions, create by association. |

## Fields

| Feature | Status | Note |
|---|---|---|
| `readonly` | ✅ | Ignored for an OData consumer (D25); changeable in local mode. |
| `mandatory` | ✅ | No runtime check, as in RAP (D20). In `enhanced` mode (D45): checked on save, without a validation, one message per field. |
| `numbering : managed` | ✅ | |
| `readonly : update`, `mandatory : create` | ✅ | |
| `features : instance` (dynamic field feature control) | ✅ | `__FieldControl` (`Common.FieldControl`), change of a read-only field refused (400), field not editable in the UI. |
| `suppress` | ✅ | Property absent from the service. |

## Actions and functions

| Feature | Status | Note |
|---|---|---|
| Instance action, `result [1] $self` | ✅ | |
| Action without a result | ✅ | 204 in OData. |
| Result `entity …`, cardinalities `[0..*]` | ✅ | Collection of entities of another entity set. |
| `internal action` | ✅ | Available in EML, not exposed in OData. |
| `static action` | ✅ | Bound to the collection; result `$self` = the created instance. |
| `factory action` | ✅ | The result is the instance of `mapped` for the `%cid` of the call. |
| Action parameter (`parameter` to an abstract entity) | ✅ | |
| `( features : instance )` on an action | ✅ | `Core.OperationAvailable` through `__OperationControl`. |
| `( features : global )` on an action | ✅ | Instance action: `Core.OperationAvailable` through `__OperationControl` (one value for all the instances); static action: check at runtime only. |
| Instance `function` | ✅ | GET; abstract entity result (complex type). |
| `static function` | ✅ | GET on the collection. |
| `determine action` | ❌ | Planned after the MVP. |

## Determinations and validations

| Feature | Status | Note |
|---|---|---|
| `determination … on modify` (triggers `create`, `field`) | ✅ | D21 semantics, in rounds; an internal action run from a determination. |
| `update`, `delete` triggers | ✅ | `delete`: the determination receives the keys of the deleted instances (still in the database until the save). |
| `determination … on save` | ✅ | |
| `validation … on save` | ✅ | Failure → 400 and rollback of the LUW. |

## Messages and responses

| Feature | Status | Note |
|---|---|---|
| `failed`, `reported`, `mapped` | ✅ | |
| `new_message_with_text` | ✅ | |
| `new_message` (T100 message class, MSAG) | ✅ | OData code `CLASS/NNN`. |
| Exception classes implementing `if_abap_behv_message` | ✅ | Clean-room `cx_root` base (D24); attributes of the message resolved by name. |
| `%element` → OData `target` | ✅ | Relative to the resource of the request, otherwise absolute `/Set(key)/Property`. |
| Severities → OData error or `sap-messages` header | ✅ | |
| `%state_area`, state messages | 🟡 | Without draft, the messages are returned as transition messages. |

## EML in the ABP

| Feature | Status | Note |
|---|---|---|
| `READ ENTITIES` / `READ ENTITY` (`FIELDS`, `ALL FIELDS`, `FROM`), `RESULT`, `FAILED`, `REPORTED` | ✅ | Lowered by our pass (D2). |
| `READ … BY \_assoc`, `LINK` | ✅ | |
| `READ … EXECUTE` (functions) | ✅ | |
| `MODIFY ENTITIES` `CREATE`, `UPDATE`, `DELETE`, `EXECUTE` (`FIELDS`, `SET FIELDS`, `FROM`, `AUTO FILL CID`) | ✅ | Including the forms abaplint does not parse (`AUTO FILL CID SET FIELDS`). |
| `MODIFY … CREATE BY \_assoc` | ✅ | |
| `IN LOCAL MODE`, `PRIVILEGED` | ✅ | Local mode: neither authorization nor feature control, read-only fields changeable. |
| `COMMIT ENTITIES`, `ROLLBACK ENTITIES` in a handler | ✅ | Forbidden, as in RAP (runtime error). |
| `GET PERMISSIONS`, `SET LOCKS`, `MODIFY … OPERATIONS`, `RELATING TO`, `AUGMENTING`, `RAISE ENTITY EVENT` | ❌ | Diagnostic ABP005/ABP007. |

## ABAP SQL in the ABP

| Feature | Status | Note |
|---|---|---|
| `SELECT` on the tables and CDS entities of the project: `SINGLE`, `INTO TABLE`, `APPENDING`, `CORRESPONDING`, `WHERE` (including `IN` on a range, `LIKE`, `BETWEEN`, `EXISTS`), `ORDER BY` (including `PRIMARY KEY`), `UP TO n ROWS`, `GROUP BY`/`HAVING`, aggregates, joins, `FOR ALL ENTRIES` | ✅ | Views in ABAP format of the `rapt_abap` schema, in the transaction of the LUW (D26). Test `rap-variant-sql.test.ts`. |
| Existence check `SELECT SINGLE @abap_true … INTO @DATA(x)`, `MAX`/`MIN` in an inline declaration | ✅ | Declared by the rewriting pass (abaplint does not type them). |
| Other literals, aggregates or expressions in an inline declaration | ❌ | Diagnostic ABP009: declare the target. |
| `SELECT … ENDSELECT` | 🟡 | With `SELECT *` only (ABP007 otherwise). |
| `OPEN CURSOR`, `FETCH NEXT CURSOR` | 🟡 | Not ABAP Cloud (refused by the check, as on SAP); supported by the runtime. |
| Types of the CDS entities in the ABP (`DATA ls TYPE zr_travel`) | ✅ | "Shadow" tables (D19, D26). |
| `MESSAGE … INTO` | ✅ | Texts of the message classes of the project. |
| `INSERT`, `UPDATE`, `MODIFY`, `DELETE` in the saver (`save_modified`) | ✅ | Exact `MAPPING FROM ENTITY` and `INDICATORS SET STRUCTURE %control` (kernel); classic writes through the `rapt_abap` views and their triggers (D30). |
| `INSERT`, `UPDATE`, `MODIFY`, `DELETE` in a handler; `WITH` | ❌ | Diagnostic ABP007: the RAP runtime writes the BO, change it with EML. |

## Remote APIs in the ABP (D31)

| Feature | Status | Note |
|---|---|---|
| HTTP client: `cl_http_destination_provider` (`create_by_url`, `create_by_comm_arrangement`, `create_by_cloud_destination`), `cl_web_http_client_manager`, `if_web_http_client`, `if_web_http_request`, `if_web_http_response` | ✅ | Path, query, headers, text or binary body, form, basic/bearer, status, headers and body of the response. Test `rap-variant-remote.test.ts`. |
| Destinations | ✅ | Environment variables `DESTINATION_<NAME>_URL`, `_USER`/`_PASSWORD`, `_TOKEN`, `_HEADERS`; listed in the generated `.env.example`. |
| OData V4 client proxy (`/iwbep/cl_cp_factory_remote`, `cl_web_odata_client_factory`) with the class of an SCM2 | ✅ | List read (`create_by_range`, `and`/`or`/`not`, `$select`, `$orderby`, `$top`, `$skip`, `$count`), read by key, create, update, delete, ETag, CSRF token. |
| OData V2 client proxy with the abstract entities of an SCM | ✅ | `d.results`, `__count`, `/Date()/`, `$inlinecount`, `substringof`. |
| Exceptions `cx_http_dest_provider_error`, `cx_web_http_client_error`, `/iwbep/cx_gateway`, `/iwbep/cx_cp_remote` | ✅ | `get_text( )`, `http_status_code`, `http_error_body`. |
| `$batch`, `$expand`, deep insert, navigation by association, remote actions and functions, value controls | ❌ | See KNOWN_GAPS.md. |
| Communication targets, SOAP (`cl_soap_destination_provider`), RFC | ❌ | |

## ABAP Cloud utility classes in the ABP (D40)

| Feature | Status | Note |
|---|---|---|
| JSON: `/ui2/cl_json` (`serialize`, `deserialize`), `xco_cp_json` (`from_string`, `from_abap`, `apply`, `write_to`, `builder`) | ✅ | Naming modes, `compress`, `name_mappings`, booleans, dates, ISO timestamps, base64. Guide: [UTILITIES.md](UTILITIES.md). |
| Encodings: `cl_web_http_utility`, `cl_abap_conv_codepage`, `cl_abap_gzip`, `xco_cp=>string` / `xstring` | ✅ | Base64, UTF-8/16, ISO-8859-1, windows-1252, URL, HTML, gzip. |
| Text: `cl_abap_char_utilities`, `cl_abap_string_utilities`, types `string_table`, `xstring_table` | ✅ | |
| Numbering: `cl_numberrange_runtime` | ✅ | Intervals of `rapt/number-ranges.json`, table `rapt_number_range`. |
| Dates: `cl_abap_tstmp`, `cl_abap_utclong`, `xco_cp=>sy`, `xco_cp_time` | ✅ | UTC time zone. |
| Application log: `cl_bali_*` | ✅ | Tables `rapt_application_log(_item)`, read by filter. |
| Hashing: `cl_abap_message_digest`, `cl_abap_hmac` | ✅ | MD5, SHA1, SHA2. |
| Random numbers: `cl_abap_random*` | ✅ | Deterministic generator by seed (not cryptographic). |
| Regular expressions: `cl_abap_regex`, `cl_abap_matcher`, types `match_result(_tab)` | ✅ | JavaScript engine. |
| RTTS: `cl_abap_typedescr` and subclasses | 🟡 | `describe_by_data(_ref)`, `describe_by_object_ref`; not `describe_by_name` nor the creation of types. |
| Background processing: `cl_bgmc_process_factory`, `if_bgmc_op_single`, `if_bgmc_op_single_tx_uncontr`, `cl_abap_tx` (D41) | ✅ | After the commit of the LUW, in a separate LUW; `COMMIT ENTITIES` in an uncontrolled operation; state in `rapt_background_process`. Test `background.test.ts`. |
| E-mail: `cl_bcs_mail_message`, `cl_bcs_mail_textpart`, `cl_bcs_mail_binarypart` (D41) | ✅ | Sent after the commit of the LUW through `MAIL_SMTP_URL`, otherwise kept in `rapt_mail`. |

## Projection

| Feature | Status | Note |
|---|---|---|
| `projection` BDEF: `use create/update/delete/action/function/association` | ✅ | |
| `use etag` | ✅ | |
| Elements renamed or omitted in the projection | ✅ | |
| `augment`, precheck and actions of the projection itself | ❌ | Planned after the MVP. |

## CDS and service

| Feature | Status | Note |
|---|---|---|
| `define root view entity`, `define view entity`, `as projection on`, `provider contract` | ✅ | |
| `composition`, `association to parent`, `redirected to` | ✅ | |
| Associations to entities without a BO (read-only entity sets) | ✅ | Entities exposed without behavior: read-only. |
| Metadata extensions (DDLX) and merge of the annotations | ✅ | |
| Abstract entities (parameters and results of actions and functions) | ✅ | |
| Custom entities (`define custom entity`, `@ObjectModel.query.implementedBy`, `if_rap_query_provider`) | ✅ | OData reads through the query class: ranges and SQL string of the filter, sorting, paging, count, navigation, `$expand` (D43). |
| `managed with unmanaged save` BO on a custom entity | ✅ | `enhanced` mode only (`rapt/config.json`, D45): instances read by the query class, written by `save_modified` to the API (D43). |
| Standard views `I_Currency`, `I_UnitOfMeasure`, `I_Country`, `I_Language` and their texts | ✅ | Added when a source names them, with their reference data (D44). |
| Value helps (`@Consumption.valueHelpDefinition`) | ✅ | Entity and text view exposed implicitly as read-only, `Common.ValueList` (D44); `additionalBinding` (filter, result), `useForValidation`, drop-down list (`sizeCategory: #XS`), action parameters (D56). |
| Table entities (`define [root] table entity`) | ✅ | Table and view entity; implicit persistence of a managed BO; `null`, keys, associations, compositions (D55). |
| CDS simple types (`define type x : abap.char(40);`) | ✅ | DRTY objects (`.drty.acds`): type and label of the elements (D55). |
| CDS enumerated types (`define type x : abap.char(1) enum { … }`) | ✅ | Base values in the database; constants usable in the behavior pool. OData exposure: refused in `standard` mode as on SAP (CDS021), `EnumType` in `enhanced` mode (D55). |
| Standard views `I_Region`, `I_CalendarDate`, `I_TimeZone`, `I_BusinessUserBasic`, `I_ExchangeRate` | ✅ | Generated calendar, users of the IdP recorded on sign-in, exchange rates to maintain (D44). |
| CDS expressions in the select list (CASE, CAST, calculations, SQL functions, literals, `$projection`) | ✅ | Computed by the PostgreSQL view, type inferred or given by `CAST` (CDS022 otherwise), read-only (`Core.Computed`), projections, drafts (D67). Still CDS002: `$session.user`/`client`/`system_language`, association paths, `BETWEEN`, aggregates, other functions. |
| DCL access control (`define role … grant select on … where …`) | ✅ | OData reads filtered for the user: `aspect pfcg_auth` (filters `ACTVT = '03'`, tuples), `aspect user`, `?=`, comparisons, `like`, `is [not] null`, `and`/`or`/`not`, paths `_Assoc.Element` (to-one), `inheriting conditions from entity` (D35). Tests `rap-authorizations.test.ts`, `dcl.test.ts`. |
| Side effects (`side effects { … }`) | ✅ | `Common.SideEffects` in the `$metadata`; the generated UI does not use them yet (the object is reloaded after a save). |

## OData V4 service

| Feature | Status | Note |
|---|---|---|
| Service document, `$metadata` (CSDL with annotations) | ✅ | |
| GET collection, GET entity (short and named key) | ✅ | |
| Navigation `Entity(…)/_Assoc`, key on the navigation, `/$count` | ✅ | |
| `$filter`: eq, ne, gt, ge, lt, le, and, or, not, in, parentheses, `null` | ✅ | Parameterized SQL queries. |
| `$filter`: contains, startswith, endswith, tolower, toupper, trim, length, indexof, substring, concat, year…second, now | ✅ | `%` and `_` are literal characters. |
| `$filter` on a to-one navigation (`_Travel/Status`) | ✅ | Scalar subquery. |
| `$filter` with `any`/`all` on a collection | ❌ | 501 response. |
| `$orderby`, `$top`, `$skip`, `$count` | ✅ | The keys complete the sorting: stable paging. |
| `$select` | ✅ | Keys and ETag always read. |
| One-level `$expand`, with nested `$select`, `$orderby`, `$filter`, `$top`, `$skip`, `$count` | ✅ | `$top`/`$skip` per parent (`row_number()`). Nested `$expand`: 501. |
| Simple `$search` | ✅ | ILIKE on the `@Search.defaultSearchElement` fields, each term required. |
| `IEEE754Compatible=true` (Decimal and Int64 as strings) | ✅ | Exact JSON numbers otherwise, on read and on write. |
| ETag (`@odata.etag`, `ETag` header), `If-Match` | ✅ | |
| POST, PATCH, PUT, DELETE, deep insert, creation through a navigation | ✅ | `Location`, `Prefer: return=minimal`. |
| Bound and static actions (POST), functions (GET) | ✅ | |
| Multipart `$batch`: reads and change sets | ✅ | One change set = one LUW, `$<Content-ID>` references, deferred responses (D23). |
| Instance feature control in the reads | ✅ | `__EntityControl`, `__OperationControl`, `__FieldControl` (D25). |
| CSRF token (`X-CSRF-Token: Fetch`) | ✅ | Required for cookie sessions (M6). |
| Errors in OData V4 format (`@Common.numericSeverity`, `details`, `target`) | ✅ | Status according to the cause of the failure (D22). |
| `sap-*` parameters | ✅ | Ignored. |
| Authentication: dev mode, Bearer JWT (OIDC, JWKS) | ✅ | Browser sessions (PKCE): M6; *client credentials* tokens (technical user); development OAuth 2.0 server (`/oauth`, client credentials and PKCE) in `rapt dev` (D60). |
| *OData V4 - Web API* binding | ✅ | Without UI annotations, value helps, side effects, feature control; active instances of a draft BO (D60). |
| `$apply`: `filter`, `groupby`, `aggregate` (`sum`, `min`, `max`, `average`, `countdistinct`, `$count`) | ✅ | With the DCL of the user; other transformations: 501 (D52). |
| Enumeration types (`EnumType`): JSON by member name, literals `Ns.Type'M'` | ✅ | `enhanced` mode, CDS enumerated types (D55). |
| JSON batch, `$value`, single properties | ❌ | Not in the MVP. |

## Generated UI (OpenUI5)

| Feature | Status | Note |
|---|---|---|
| List Report: columns (`UI.lineItem`), sorting (`UI.presentationVariant`), growing | ✅ | `sap.f.DynamicPage`, `sap.m.Table`. |
| Filter fields (`UI.selectionField`), search (`@Search.searchable`) | ✅ | Conditions as in SAP Fiori (`=`, `!=`, `>`, `>=`, `<`, `<=`, `a...b`, `*x*`, `<empty>`, exclusions `!(…)`), several values per field, NUMC without leading zeros, dates in the format of the language; *Search and Select* / *Define Conditions* dialog as in Fiori elements, operators according to the type and `selectionType` (D68); *Clear*, *Adapt Filters* (columns added as filters), "Filtered By" summary (D51). |
| User variants (`sap.m.VariantManagement`) | ✅ | Filters, filters and visible columns, sorting; saved per user by the service (`$variants`); default variant, favorites (D51). |
| Table settings: visible columns, sorting | ✅ | `sap.m.p13n.Popup`; number of rows in the title of the table. |
| Value help (`@Consumption.valueHelpDefinition`) | ✅ | Entity exposed implicitly, `Common.ValueList`, dialog with the descriptions of the text view, in the Object Page (D44) and in the filter dialog with the conditions (D68). |
| Refresh of the list after a change on the Object Page, breadcrumbs | ✅ | D51. |
| Non-draft creation from the List Report | ✅ | Object Page in create mode, `POST` on save. |
| Delete, table actions (`#FOR_ACTION` in `UI.lineItem`) | ✅ | On the selected row. |
| Object Page: header (`UI.headerInfo`), sections (`UI.facet`: identification, field groups, tables) | ✅ | `sap.uxap.ObjectPageLayout`. |
| Edit and save (PATCH in a change set, `If-Match`) | ✅ | Cancel with `resetChanges`. |
| Tables of the compositions, creation and deletion of children in edit mode | ✅ | New row at the top of the table, creation and deletion sent in the same change set on save. |
| Header actions (`UI.identification`), parameters (dialog), factory actions | ✅ | Parameter dialog, error message of the action, opening of the instance created by a factory action. |
| Feature control: actions (`__OperationControl`), Edit/Delete (`__EntityControl`), fields (`__FieldControl`) | ✅ | Instance and global; tested in the browser (`ui-features.test.ts`). |
| Read-only fields, mandatory fields, fields editable on create only | ✅ | From the field characteristics of the BDEF. |
| Messages (errors, success) | ✅ | `MessageBox`, `MessageToast`, `MessagePopover`. |
| Buttons according to the authorizations of the user | ✅ | Create hidden without the global create authorization (`$permissions`); Edit, Delete, actions and creation of children disabled per instance (`__EntityControl`, `__OperationControl`, D36). Test `ui-authorizations.test.ts`. |
| Worklist, Analytical List Page, Overview Page, Form entry floorplans | ✅ | `ui` of `rapt/config.json`, written by `rapt floorplan` or the VS Code command (D61), which asks for it before generating the application (D66); `@UI.chart` charts in SVG, `@UI.selectionVariant` tabs (D53). |
| Draft in the UI: creation and editing in a draft, fields saved, Save / Discard, editing status in the list | ✅ | D54; as in Fiori Elements: *Editing Status* filter, draft of the user instead of the active instance, *Locked by X*, `DraftIndicator`, *Keep Draft* / *Discard Draft* (D58). |
| Collaborative draft (`with collaborative draft`, `draft action Share`) | ✅ | Users of the draft, invitation, joining with Edit, refresh every 5 s (D59). |
| Values of an enumerated type: labels, choice list in edit mode and in the filter | ✅ | `enhanced` mode (D55). |

## Launchpad (D37)

| Feature | Status | Note |
|---|---|---|
| Groups and tiles (`launchpad.json`): title, subtitle, footer, icon | ✅ | `sap.m.GenericTile`; `rapt launchpad` checks the content (LPD001 to LPD007). |
| Tiles assigned to roles of the IdP (business catalog of a business role) | ✅ | Filtered by the server; without a role, visible to everyone. |
| Dynamic tiles: `$count` of an entity set, `$filter` | ✅ | With the access controls of the user (DCL); read on load. |
| Intent navigation (`/#Object-action`, `/go/Object-action?…`) | ✅ | Parameters passed to the application in the query string. |
| Shell bar: home, tile search, user, sign-out | ✅ | `sap.f.ShellBar`, also above the applications opened from the launchpad. |
| A single origin: UI of the applications under `/apps/<id>/`, services at their paths | ✅ | Redirects rewritten; 502 when an application does not answer. |
| Single sign-on: OIDC session of the launchpad read by the applications | ✅ | Authorizations, DCL, CSRF and required role of each application kept; tested (`launchpad.test.ts`). |
| External tiles (URL) | ✅ | Opened in a new tab. |
| Docker: launchpad, applications and their databases, Keycloak (`oidc` profile) | ✅ | Generated `docker-compose.yml`. |
| Spaces and pages (`spaces` → `pages` → `sections`), assigned to roles | ✅ | Space tabs, list of the pages, last space remembered (D48). |
| Development launchpad (`rapt dev`): application, documentation, `$metadata`, MCP | ✅ | D49. |
| One "Launchpad" per workspace, applications added when they are created (`rapt new`, `rapt floorplan`, `rapt launchpad add`) | ✅ | D69; idempotent, `--launchpad`, `--no-launchpad`. |
| Applications built with the launchpad from their sources (`source`); deployment of the complete launchpad or of one application alone | ✅ | D69; `out/launchpad/apps/<id>`, LPD009. |
| Personalization by the user, notifications, navigation between applications from an application | ❌ | See KNOWN_GAPS. |

## Generated application and operations

| Feature | Status | Note |
|---|---|---|
| `package.json`, `server.mjs`, bundled runtime (`vendor/`), `npm install` | ✅ | e2e test. |
| Configuration by environment variables (`.env.example`) | ✅ | |
| PostgreSQL (`DATABASE_URL`), schema applied on startup | ✅ | e2e test on PostgreSQL 16. |
| Embedded PGlite (`PGLITE_DIR`) for development | ✅ | e2e test: startup, data kept after a restart (D33). |
| Multi-stage Dockerfile, `docker-compose.yml` (app + PostgreSQL) | ✅ | Image built and `docker compose up` checked (OData service, actions, UI); `docker` CI job. |
| Keycloak profile (imported realm: client `rapt-app`, user `alice`) | ✅ | `keycloak.test.ts` against a real Keycloak: sign-in form, PKCE, session, CSRF, sign-out, bearer tokens (JWKS); in CI with the `oidc` profile of the generated docker-compose (D33). |
| OIDC: bearer tokens (JWKS), browser sessions (code + PKCE), CSRF, sign-out | ✅ | Sign-out with `id_token_hint`: no confirmation page at the provider (D37). |
| Required role (`OIDC_REQUIRED_ROLE`) | ✅ | Keycloak roles (`realm_access.roles`) or configurable claim. |
| Optimized UI5 bundle (`ui5 build`) | ❌ | Resources served from the npm sources (D27). |
| Cloud Foundry (SAP BTP): `manifest.yml`, route and bound PostgreSQL read from `VCAP_*` | ✅ | D50, guide [DEPLOYMENT.md](DEPLOYMENT.md). |
| MCP server of the service (`rapt mcp`, `/mcp`) | ✅ | One tool per operation, descriptions in `rapt/mcp.json` (D47, guide [MCP.md](MCP.md)). |

## Tooling

| Feature | Status | Note |
|---|---|---|
| VS Code extension: commands of the CLI, Problems, wizard, *RAP Objects* view, floorplans | ✅ | D39, D61. |
| `rapt` on the PATH of the terminals of VS Code | ✅ | Shims of the extension (D64). |
| MCP server of rapt for AI coding agents (`rapt agent`), registered in the agent mode of VS Code | ✅ | Check, objects, floorplans, abapGit, documentation (D64). |
| npm package `open-rap-runtime` (`rapt`, `npx open-rap-runtime`) | ✅ | D65; archives of `pnpm pack` checked on each tag before publication with `NPM_TOKEN`. |
| Website with the documentation | ✅ | D62, D63. |
| Feedback form (website, *RAP: Report a bug or request a feature…*) to the issues of the repository | ✅ | D71, D74. |
