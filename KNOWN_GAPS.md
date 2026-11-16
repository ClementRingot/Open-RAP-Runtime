# Known gaps

This file lists what is not (yet) supported, in particular the ABAP features
`@abaplint/transpiler` does not handle: the rule of the project is to document them here rather
than to work around the transpiler. The overall feature coverage is tracked in
[docs/FEATURES.md](docs/FEATURES.md).

Reference versions: `@abaplint/core` 2.120.107, `@abaplint/transpiler` 2.14.33,
`@abaplint/runtime` 2.14.33.

## Not planned

What the project deliberately leaves out; the planned work is in
[docs/ROADMAP.md](docs/ROADMAP.md).

| Item | Reason |
|---|---|
| Classic ABAP: reports, module pools, dynpros, Adobe forms | Not part of ABAP Cloud: the target is the ABAP environment of SAP BTP, where they do not exist. |
| Table functions (`define table function`, AMDP) | They run SQLScript, the proprietary language of SAP HANA; translating it to PostgreSQL would not be faithful. They will be refused with a positioned diagnostic. |
| SAPUI5 (`sap.fe`, `sap.ovp`, `sap.ushell`) in the repository, the published packages or the CI | Licensed by SAP under the SAP Developer License. Compatibility with SAP Fiori elements is shown by OData protocol tests written by the project; running the real `sap.fe` against Open RAP Runtime is done by each user, locally, under their own license. Only a written agreement of SAP would change this. |
| ABAP cleaner embedded in the tools | A Java tool: offered when the user has installed it, never shipped. |
| Release check method by method | SAP releases objects (classes, interfaces, views), not single methods; the clean-room base only exposes the public signatures of the released classes (D24). |

## abaplint transpiler and runtime

| Gap | Effect | Workaround | Tracking |
|---|---|---|---|
| The RAP derived types (`TYPE TABLE FOR …`, `keys`, `failed`, `reported`, `result`) are typed `void` by abaplint. | The transpiler refuses the ABP (`TypeNameOrInfer, type not found: #`). | The compiler generates the types and rewrites the ABP before transpilation (D2). | Solved (M4) |
| abaplint does not parse all the EML forms (`CREATE AUTO FILL CID SET FIELDS WITH`, `CREATE BY \_assoc SET FIELDS WITH` are unknown statements for it), and the EML lowering of the transpiler handles neither `BY \_assoc`, nor `LINK`, nor `CREATE BY`, nor `IN LOCAL MODE`. | Syntax error or "not supported" at runtime. | Our own EML parser and lowering to `ZRAP_EML` by the rewriting pass (D2). | Solved (M4) |
| The arithmetic operations of the runtime on packed numbers (`p`) go through JavaScript numbers (the storage itself is exact). | A calculation beyond about 15 significant digits can lose decimals. | The values travel as exact text between the buffer and the ABP (D8); usual amounts are not affected. | — |
| The SQL layer of the transpiler fails on CDS associations. | Transpilation impossible with the original DDLS. | "Shadow" DDIC without CDS views (D19). | Solved (M4) |
| The private methods of the local classes are only reachable through `FRIENDS_ACCESS_INSTANCE`, an internal detail of the generated code. | May change with a version of the transpiler. | Pinned versions; the tests of M4 call all the handlers through this path. | — |
| Namespaced objects (`/DMO/…`) give modules named with `#`, imported as `%23`. | The module loader of Vitest does not find them. | The modules are renamed (`#` → `_`) on generation. | Solved (M4) |
| abaplint does not type the inline declaration of the result of a `SELECT` with a literal, an aggregate or an expression (`void` type "SELECT_todo"). | The transpiled method fails as soon as it is called. | The rewriting pass declares the existence check (`@abap_true`: `abap_boolean`), `MAX`/`MIN`/`SUM` of a single source (type of the column), `AVG` (`f`) and `COUNT` (`int8`); diagnostic ABP009 for the other forms (D26, D80). | Worked around |
| The transpiler reads a component host (`@ls-comp`) as a subtraction (`ls - comp`) when the `SELECT` uses fields prefixed by an alias (`t~col`). | Invalid or ambiguous SQL at runtime. | The rewriting pass writes it `@( ls-comp )` (equivalent host expression) in these `SELECT`s. | Worked around |
| `SELECT … ENDSELECT` reads whole rows of the table then assigns them to the target. | With a field list, elementary target failing, shorter structure filled by position. | The rewriting pass reads a loop with a field list into a table, then `LOOP AT` (D80); `sy-dbcnt` is not counted in the loop. ABP007 for an inline target, a list of targets, `PACKAGE SIZE`, `APPENDING`. | Worked around |
| An `int8` value (`get_offset( )`, `get_page_size( )` of the paging of a query) in `LOOP AT … FROM`/`TO` | The runtime mixes BigInt and numbers: exception "Cannot mix BigInt" | The rewriting pass writes the bounds `CONV i( … )` (D80). | Worked around |
| An enumerated object converted to `c` or `string` (string template, `&&`, `CONV string( … )`, assignment to a character-like variable) gives its base value (`1`), not the name of its constant (`M`). | Texts and messages differ from SAP. | The rewriting pass calls the kernel with the members of the enumerated type (D80). Other conversions (a component of a structure, a method parameter of type `string`, `WRITE … TO`) keep the base value. | Worked around |
| `OPEN CURSOR … ORDER BY`: the transpiler writes `ORDER BY` twice; `FETCH NEXT CURSOR … INTO TABLE @DATA(…)` makes it fail ("InlineDeclarations"). | — | The duplicate is removed on SQL translation; declare the target of the `FETCH`. Cursors are not part of ABAP Cloud anyway (refused by the check). | — |

## Behavior pool (ABAP)

| Gap | Status |
|---|---|
| ABAP SQL writes (`INSERT`, `UPDATE`, `MODIFY`, `DELETE` on a table) outside the saver, `WITH` | Diagnostic ABP007 (D26): the RAP runtime writes the BO, change it with EML. Allowed in `save_modified` (D30). |
| Classic ABAP SQL writes of packed numbers (including `TIMESTAMPL`) | Exact for `INSERT|UPDATE|MODIFY|DELETE dbtab FROM @wa`, `FROM TABLE @itab` and `INSERT INTO dbtab VALUES @wa`, written by the kernel (D80), and for `MAPPING FROM ENTITY`. `UPDATE dbtab SET col = @value WHERE …` goes through the abaplint runtime: about 15 significant digits, the microseconds of a timestamp are lost. |
| `DELETE dbtab FROM @wa` | Deletes the row of the key of the work area, written by the kernel (D80); the transpiler alone would empty the table. A `DELETE` without a condition is refused at runtime. |
| Tables and views outside the project in a `SELECT` (`/dmo/agency`, SAP tables) | Error ABP004: only the tables and CDS entities of the project exist in the generated database. |
| `SELECT` and unsaved changes of the LUW | Not visible, as in RAP: `SELECT` reads the database (read the BO with EML to see the buffer). |
| `SELECT` conditions on a date, a UUID, a timestamp or a boolean | Evaluated on the ABAP form computed by the view: no usable index, sequential read of the table (D26). |
| ABAP SQL functions (`concat`, `division`, `dats_days_between`, `tstmp_*`…) | Passed as is: only those that exist under the same name in PostgreSQL work. |
| SQL error at runtime | Runtime error (500), no catchable `CX_SY_OPEN_SQL_DB` exception; the transaction of the LUW stays usable (savepoint). |
| `SELECT … FOR UPDATE`, `OFFSET`, `CLIENT SPECIFIED`, `USING CLIENT`, secondary connections | Not supported by the transpiler or irrelevant (single tenant, D9). |
| Saver class (`lsc_…`) | `save_modified` and `cleanup` for additional and unmanaged save (D30). `adjust_numbers` (late numbering): ABP007; the other methods are not called (ABP003). The rows of `update` always carry all the values. |
| Unmanaged save: database constraints | No child → parent foreign key (the BDEF has no persistent table): `save_modified` deletes the children (`delete` contains them). |
| EML on a projection BDEF (`MODIFY ENTITIES OF zc_travel`) | Diagnostic ABP007: use the base BDEF. |
| `MODIFY ENTITIES OPERATIONS` (dynamic EML), `RELATING TO`, `AUGMENTING`, `COMMIT ENTITIES RESPONSES`, `GET PERMISSIONS`, `SET LOCKS`, `RAISE ENTITY EVENT` | Diagnostics ABP005/ABP007. |
| Late numbering (`adjust_numbers`) | Not supported (ABP007). Early numbering, direct or by association, is. |
| `COMMIT ENTITIES` and `ROLLBACK ENTITIES` in a handler | Runtime error, as in RAP. |
| Responses of an EML statement | Replace the content of the given `FAILED`/`REPORTED`/`MAPPED` targets; `sy-subrc` is 4 when `failed` is not empty (convention, not documented by SAP). |
| Seventh decimal of the generated `TIMESTAMPL`s | The runtime generates them to the microsecond (D8). |

## Remote APIs (D31)

| Gap | Status |
|---|---|
| Client proxy: `$batch` (`create_request_for_batch`), `$expand`, deep insert, navigation by association (`navigate_to_many`…), actions and functions of the remote service, `$search`, delta | Not supported: methods missing from the base (ABAP check error). |
| Value controls (`value_controls` of the SCM2 classes, `_vc` fields of the abstract entities) | Neither read nor filled: a `null` value of the service gives the initial value; updating a value to `null` is not possible. |
| `comm_system_id`, `i_service_instance_name`, `i_authn_mode` | Ignored: a destination is a set of environment variables. No user propagation (principal propagation) nor OAuth client credentials: a fixed token can be given with `_TOKEN`. |
| Parameters `is_proxy_model_key`, `iv_service_definition_name` | Ignored: the proxy reads the `$metadata` of the remote service (one more call per proxy). |
| Destination named by a variable | Works, but is not listed in the generated `.env.example` (only literals are). |
| Communication targets (COTA), SOAP (`cl_soap_destination_provider`), RFC | Not supported. |
| Outgoing HTTP proxy | The `fetch` of Node.js only reads `HTTPS_PROXY` with `NODE_USE_ENV_PROXY=1` (or `--use-env-proxy`). |
| Remote calls and LUW | The call goes out during the interaction (action, determination…): a rollback of the LUW does not undo what was written remotely, as on SAP. |

## CDS

| Gap | Status |
|---|---|
| Expressions in the select list (D67): `$session.user`, `$session.client`, `$session.system_language`, `BETWEEN`, aggregates, SQL functions outside the list of D67 | Diagnostic CDS002 |
| Calculated elements read with EML in the behavior pool (D67) | Value of the active view (last save), not recomputed on the changes of the transaction; initial value for a draft instance. |
| Association paths in the select list (`_Agency.Name`), including in an expression | Diagnostic CDS002 |
| Joins, WHERE clause | Diagnostic CDS002 (WHERE ignored with a warning) |
| Views with parameters, unions, hierarchies | Diagnostic CDS002 |
| Custom entities (D43): parameters, aggregation (`get_aggregation`), nested `$expand`; DCL not applied (the query class filters itself) | Not handled |
| Custom entities: a `$filter` outside ranges (OR between elements, functions other than `contains`/`startswith`/`endswith`, comparison between elements) | `get_as_ranges` raises `cx_rap_query_filter_no_range`, as in SAP; `get_as_sql_string` stays available. Functions and expressions that cannot be translated: 501. |
| Managed BO with unmanaged save on a custom entity (D43) | Specific to Open RAP Runtime (BDEF027 warning); no database lock: the LUWs of the application are serialized, the target API keeps its own checks. |
| DCL access control: EML and ABAP SQL of the behavior pool | Not filtered (like `WITH PRIVILEGED ACCESS`); only the OData reads are (D35). As in RAP, changes go through the instance authorization, not through the DCL. |
| DCL access control: other aspects (`bypass when`, user-defined aspects), paths of several associations | A condition that is not evaluated grants no row (DCL002). The subqueries of `$filter` on a navigation (`_Travel/…`, `any`/`all`) apply the DCL of their target (D82). |
| `@AccessControl.authorizationCheck` | Informative: a role applies if it exists, whatever the value. |
| Included structures (`.INCLUDE`) in the tables | Diagnostic DDIC003 |
| Table entities (D55): `@ClientHandling.type` | Read, without effect: no client column (D9). |
| Table entities: `null` columns | The PostgreSQL column keeps its default value (ABAP initial value) like the others; `null` is a distinct state only for the types without an initial value. |
| Table entities: `SOURCE_TYPE` of the abapGit XML written by `rapt abapgit` | `T`, derived from the documentation: to check on the first import; ADT rewrites the XML on activation. |
| Enumerated types: `CAST( x AS enum )`, constant `Type.#CONST` in a view, `cl_abap_enumdescr` | Not handled: only the `CAST`s to an `abap.xxx` type or a data element are supported (D67). In the behavior pool, an ABAP enumerated object converted to text gives the name of its constant (D80); a CDS enumerated type is its base value. |
| Enumerated types exposed in OData | Refused in `standard` mode as on SAP (CDS021); `EnumType` in `enhanced` mode only. |
| Conversion exits (ALPHA…), ISO conversion of the languages | Not handled |

## Database

| Gap | Status |
|---|---|
| Client column (`CLNT`) | Removed: single-tenant applications (D9) |
| Seventh decimal of the `TIMESTAMPL`s | Lost: `timestamptz(6)` (D8) |

## OData

| Gap | Status |
|---|---|
| `lt`/`le` comparisons on an initial date: in ABAP `00000000` is lower than any date; here the initial value is `NULL` and no comparison keeps it (OData semantics of `null`). | Accepted |
| JSON batch, `$value`; `any`/`all` on a path of several navigations or on a custom entity; nested `$expand` of a custom entity, deeper than 5 levels | 501 or 400 response |
| `$apply` (D52): transformations other than `filter`, `groupby`, `aggregate` (`topcount`, `compute`, `concat`…), transformation after a grouping, `@Aggregation` annotation | 501 response; the aggregates are on the properties of the type, without hierarchy. |
| Enumeration literals (D55): a single member (`Ns.Type'A'`, no `'A,B'` flags), `has` operator | The first member is taken; `has`: 400. |
| `etag dependent by`: master with unmanaged save, or ETag field of the master that is not an administrative timestamp | The runtime does not change the ETag of the master when a dependent entity changes: `save_modified` or the application must do it (D32). |
| `etag dependent by` through a projection that does not expose the association | No ETag for the dependent entity (neither `@odata.etag`, nor `If-Match` check). |
| Global feature control (`features : global`) in the reads | Exposed like the instance feature control (`__EntityControl`, `__OperationControl`: same value for all the instances), computed again on each request, without a cache. Static action: checked at runtime only (no instance for `Core.OperationAvailable`). |

## Generated application

| Gap | Status |
|---|---|
| First load of the UI: about 400 OpenUI5 modules served one by one (no `ui5 build` bundle) | Accepted (D27); one-hour HTTP caching. |
| Sessions: neither token refresh, nor revocation before the expiry of the cookie (8 h) | Accepted (D28). |
| Locks between several instances of the application | PostgreSQL row locks (`NOWAIT`), tested against another transaction (`rap-locks.test.ts`); no load test. |
| TypeScript 7.0.2 compiles `new (x as T).Y()` without parentheses | Form avoided in the code (D29). |

## Launchpad (D37)

| Gap | Status |
|---|---|
| Navigation between applications from an application (CrossApplicationNavigation, intent links in an Object Page) | Not planned: intents are opened from the launchpad (`/#…`, `/go/…`). |
| Intent parameters passed in the query string, which the generated UI does not use (no direct opening of an instance) | Gap. |
| Application loaded full page, not in a container of the shell | Accepted: one application per page; the shell bar is shown by the application. |
| Personalization (groups and tiles of the user), notifications, enterprise search | Not planned. Spaces and pages are supported (D48). |
| Pages of a space: drop-down list above the sections | Accepted: SAP shows them in the menu of the tab of the space. |
| Tile counters read on load only | Gap: no refresh interval. |
| Shared session: same `SESSION_SECRET` for the launchpad and its applications, no revocation before expiry | Accepted: one level of trust, like the sessions (D28). |
| Applications behind the launchpad in `AUTH_MODE=none`: their development user, independent of the one of the launchpad | Development only. |
| OpenUI5 resources served by each application (`/apps/<id>/resources/`) | Accepted: no cache shared between the applications. |

## ABAP Cloud utilities (D40)

| Gap | Status |
|---|---|
| Time zone of the user | UTC: `xco_cp_time=>time_zone->user` and `->utc` give the same values, `systemtstmp_*` does not convert. |
| Numbering and application log | Written in the LUW of the request: rolled back if it fails (on SAP, a drawn number is consumed). `use_2nd_db_connection` is ignored. |
| Number range interval not configured | Created on the first request, from 1 to 99999999999999999999 (on SAP: `cx_nr_object_not_found`). External numbering and alphanumeric intervals not supported. |
| `/ui2/cl_json` | No `generate` (dynamic data), nor `assoc_arrays`, nor `conversion_exits`, nor `type_descr`; object references are written `null`. Invalid JSON leaves the data unchanged. |
| `xco_cp_json` | `from_abap` writes the `abap_bool`s as `"X"`/`""`; the names of the members are matched ignoring case and `_` on read. |
| `cl_abap_regex`, `cl_abap_matcher` | Regular expression engine of JavaScript: the constructs specific to PCRE (possessive quantifiers, `\K`, recursion…) are not supported (`cx_sy_regex`, or another meaning); the POSIX syntax is approximated (classes `[:alpha:]`…, `\<`, `\>`). `FIND … REGEX object` with a `cl_abap_regex` object is not supported. |
| RTTS | `describe_by_name` raises `cx_sy_rtti_type_not_released`; no creation of types (`cl_abap_structdescr=>create`, `CREATE DATA … TYPE HANDLE`), no attributes nor methods in `cl_abap_classdescr`. `absolute_name` comes from the qualified name of the transpiler. |
| `cl_abap_random*` | Park-Miller generator (not cryptographic): the sequences differ from those of SAP for the same seed. No `cl_abap_random_packed*` nor `decfloat16`. |
| `cl_abap_char_utilities=>minchar` | Missing (null character). |
| Background processing (D41) | The operations stay in memory until they run: a process not yet run when the application stops never is (it stays `NEW`). No restart nor retry of an `ERRONEOUS` process, no queue by name (`set_name` is used for tracking), no check of the transactional phase of the call (on SAP, `save_for_execution` of a controlled operation happens in the save phase). `if_bgmc_process_monitor`: states `NEW`, `SUCCESSFUL`, `ERRONEOUS` (names specific to Open RAP Runtime). A single `COMMIT ENTITIES` per operation. |
| E-mail (D41) | Sent after the commit of the LUW, without retry; `send( )` always returns the state `W` (waiting). No e-mail templates (`cl_bcs_mail_message=>create_instance_by_template`), nor signature, nor encryption. |

## Standard views and value helps (D44)

| Gap | Status |
|---|---|
| Available standard views | `I_Currency`, `I_UnitOfMeasure`, `I_Country`, `I_Language`, `I_Region`, `I_TimeZone` and their text views, `I_CalendarDate`, `I_BusinessUserBasic`, `I_ExchangeRate`. The other released views are not provided: CDS005. |
| `I_Region` | Regions of the United States, Canada, Germany and Australia only. |
| `I_ExchangeRate` | No rate delivered (empty table `rapt_exchrate`): to load by the application or `rapt/seed.json`. No currency conversion (`CURRENCY_CONVERSION`). |
| `I_BusinessUserBasic` | A user only appears after their first request; no synchronization with the IdP (departures, name changes). |
| Reference data | Texts in English only; units: about thirty common units (the content of SAP has many more); no shift of the decimals (`TCURX`): `Decimals` is informative. |
| Elements of the standard views | The commonly used ones; the other elements of the SAP views (and their associations) do not exist. |
| Value help | A single value help per element (the first one if several, without `qualifier`); `useForValidation` checked in the UI, not by the service (as in RAP); no `distinctValues`, nor `presentationVariantQualifier`. |

## Round trip to SAP BTP (D84)

| Gap | Status |
|---|---|
| The authorization object `ZAO_TRAVL` of `fixtures/travel` names the authorization field `ZAGENCY`, which the fixture does not define (nor its data element, nor the object class `ZRT`) | The Travel fixture does not activate on SAP as is; the `trial` variant leaves the authorizations out. To fix with the first activation results. |
| The `trial` variant replaces each `AUTHORITY-CHECK` and its `COND #( WHEN sy-subrc = 0 … )` by `if_abap_behv=>auth-allowed` (writing `sy-subrc` is refused by ABAP Cloud, D85), and the access conditions by an unconditional `grant select` (SAP warns: `Conditions defined by full access rule in role …`) | A trial user cannot be granted authorizations of their own; the behavior of the authorizations is not compared with SAP. |
| Draft tables written for SAP: element names, types and the reference fields of the amounts derived from the model | No message on them at the first activation on the trial (2611, D85); not compared field by field with the tables ADT generates. |
| No `authorization:` addition per association (`create ( authorization : … )`): a creation by association is always authorized as an update of its source (D85) | As SAP by default; the own indicator `%assoc` of such an addition is not supported. |
| The DDLX and SRVB written flat were refused by the abapGit of SAP BTP at the first pull (D85) | Written in the format of SAP BTP since D85; an existing flat XML file of a project is not rewritten by `rapt abapgit`. |

## Draft (D54)

| Gap | Status |
|---|---|
| Logic of the BO on a draft (D81) | Runs in a transaction of its own whose buffer holds the draft, on each request: what the handlers write elsewhere (another instance through EML, the database) is dropped; ABAP SQL in a handler reads the active instances, not the draft (as on SAP). |
| Actions of the application on a draft | Instance actions run (D81); static and factory actions: 501, activate first. |
| `draft query view`, `with draft` on a BO with unmanaged save | Not supported. |
| Collaborative draft (D59) | No real time (WebSocket): the Object Page reads the draft again every 5 s; no field lock; `ShareAll` ignored; joining a draft only checks the Edit authorization; two-segment navigation `DraftAdministrativeData/DraftAdministrativeUser`: read `DraftAdministrativeUser?$filter=DraftUUID eq …`. |
| State messages (D81) | Stored by `Prepare` and read in `SAP__Messages` of the draft entity types only (on SAP, every entity type of a UI service has the property); the messages of a refused activation are returned, not stored (the LUW is rolled back). |
| Exclusive lock | Taken over by another user after 15 minutes without a change, as on SAP; no adjustable duration. |

## Floorplans (D53)

| Gap | Status |
|---|---|
| Analytical List Page | One chart (the first `@UI.chart`) and one dimension; no visual filter bar, nor multiple charts, nor `@Aggregation` measures. |
| Overview Page | `kpi`, `list`, `table`, `chart` cards described in `rapt/config.json` (no `@UI.dataPoint` / `@UI.kpi` annotations), without a global filter. |
| Charts | Our own SVG control: columns, bars, lines, pie, donut; no zoom, rich tooltip nor export. |

## Web APIs and OAuth 2.0 (D60)

| Gap | Status |
|---|---|
| Development OAuth server | Development only: no refresh token, nor consent, nor revocation; signing key regenerated on each start. |
| Web API of a draft BO | Active instances only (the draft is not exposed). |
| Service with a UI and a Web API binding | One binding served at a time: the UI one by default, the Web API with `rapt dev --binding <name>` (D76). On SAP, both are published. |
| OData V2 | Not supported: the generated service is always OData V4 (SRVD003). |

## Enhanced mode (D45)

| Gap | Status |
|---|---|
| Check of the mandatory fields | On save only (not while typing); fields under dynamic feature control (instance `fc-mandatory`) not checked. |

## MCP (D47)

| Gap | Status |
|---|---|
| Transport | HTTP, JSON responses; no SSE stream, nor MCP session, nor server notifications. No stdio transport (a client that only speaks stdio goes through an HTTP relay). |
| Authentication | Bearer token or development user; no OAuth authorization built into the MCP protocol (OAuth metadata discovery). |
| Tools | No MCP resources nor prompts; `$expand` not offered in `_list`. |

## UI variants (D51)

| Gap | Status |
|---|---|
| Shared (public) variants, variant applied automatically, contexts | Not supported: personal variants. |
| Order of the columns, grouping | Not supported (visibility and sorting only). |

## rapt agent (D64)

| Gap | Status |
|---|---|
| Transport | stdio only; one request at a time (the compiler is not reentrant on a project). |
| Running the application | No tool starts `rapt dev`: the user starts it (a long-running server is not a tool call); the agent then uses the OData service or the MCP server of the service. |
| Agent mode of VS Code | Needs VS Code 1.101 or later (the MCP server API); one server per workspace folder. |

## Website (D63)

| Gap | Status |
|---|---|
| Documentation of the website | Rendered at each publication from `docs/`: the website shows the documentation of the `main` branch, not of each version. |
