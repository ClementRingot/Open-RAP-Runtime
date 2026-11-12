# Technical decisions

Decisions taken on 2026-11-09, after the owner of the project approved the principle ("take the
technical decisions you think are the best; all the features of a non-draft RAP BO must be
respected"). Each entry gives the decision, the reason and the consequence. Numbers D1 to D13
correspond to points 1 to 13 of §11 of PLAN.md. The milestones M1 to M6 are those of PLAN.md §8.

## D1 — BDEF grammar written with Chevrotain

- **Decision**: Chevrotain grammar for the BDEFs (managed behavior and projection); the BDEF
  parser of abaplint is used as an oracle in the tests.
- **Why**: typed AST, positioned error messages, full control over the handling of the
  out-of-scope constructs. The parser of abaplint only produces a generic tree.
- **Consequence**: two parsers to keep aligned; a test compares the entities, aliases and
  operations each one finds.

## D2 — ABP: generated derived types and source-to-source rewrite

- **Decision**: for each managed BDEF, the compiler generates an ABAP interface
  (`ZRAP_DT_<BDEF>`) containing the RAP derived types (`%tky`, `%control`, `FOR …` tables,
  `FAILED/REPORTED/MAPPED` responses, authorization and feature control requests and results),
  then rewrites the behavior pool before giving it to the transpiler: signatures of the handlers,
  `TYPE TABLE|STRUCTURE|RESPONSE FOR …` references, removal of `FOR BEHAVIOR OF`, and **all** the
  EML statements (`READ`, `MODIFY`, `COMMIT`, `ROLLBACK ENTITIES`, long and short forms) lowered
  into calls of the kernel class `ZRAP_EML` (`begin`, operations, `end`). The `#` of the operands
  become the expected derived type; the inline declarations (`RESULT DATA(x)`) are hoisted as
  `DATA x TYPE …`.
- **Adjustment (M4)**: the EML is parsed by a token-based parser of the project
  (`gen/abap/eml.ts`), and no longer left to the lowering of the transpiler: abaplint does not
  recognize all the forms (`CREATE AUTO FILL CID SET FIELDS WITH` is an unknown statement for
  it), and the lowering of the transpiler lost `IN LOCAL MODE`, `BY \_assoc`, `LINK` and
  `CREATE BY`. The complete ABAP check (types included) runs on the rewritten sources, with the
  configuration of the transpiler; each replacement keeps the number of lines of the replaced
  text, so that the errors (ABP004) point to the original line.
- **Adjustment (feature control)**: as on SAP, the feature control requests and results
  (`FOR INSTANCE FEATURES`, `FOR GLOBAL FEATURES`) only contain what the BDEF declares at the
  matching level: `%create`, `%update`, `%delete` of the `( features : … )` operations,
  `%action-x` of the `( features : … )` actions, `%assoc-_x` of the `create ( features : … )`,
  `%field-x` of the `field ( features : instance )` fields. A pool that writes `%update` without
  `update ( features : instance )` is refused (ABP004) instead of passing `rapt check` and then
  failing on activation on SAP.
- **Why**: abaplint types these constructs as `void` and the transpiler then refuses the ABP.
  The PoC (PLAN.md, V10) proved the approach with the published packages; M4 generalized it.
- **Consequence**: the transpiler and the runtime are never patched nor monkeypatched; they are
  given standard ABAP. The methods of `ZRAP_EML`, a "clean-room" class of the project, are
  replaced at runtime by the JavaScript kernel (`runtime/src/rap/kernel.ts`). Any construct the
  pass cannot handle produces a diagnostic (ABP005 to ABP007) and an entry in KNOWN_GAPS.md. An
  upstream contribution (derived types in abaplint) remains desirable; it is public and will
  only be proposed with the agreement of the owner of the project.

## D3 — Fastify rather than Express

- **Why**: `inject()` lets the server be tested without a network; encapsulated plugins; good
  TypeScript typing; performance.

## D4 — OData reads through generated SQL views

- **Decision**: each CDS view becomes a PostgreSQL view (`zr_*` on the tables, then `zc_*` on
  `zr_*`). The OData reads query the `zc_*` views; the writes go through the RAP runtime, to the
  tables.
- **Why**: it is the separation of RAP (query through the CDS projection, transaction through
  the BO). Future CDS expressions (CASE, CAST…) will translate directly into SQL.

## D5 — OData scope extended to what a V4 List Report / Object Page sends

- **Decision**: in addition to the initial list: navigation `Entity(…)/_Assoc` (read and
  creation), `ge`, `le`, `not`, `startswith`, `endswith`, `/$count` segment, simple `$search`,
  CSRF token, `IEEE754Compatible=true`, one-level deep insert, `sap-messages` header,
  `$<Content-ID>` references in a changeset, `sap-*` parameters ignored.
- **Why**: without them, a Fiori Elements V4 application (or our OpenUI5 UI, which uses the same
  ODataModel) does not fully work.

## D6 — Path of the service modeled on RAP

- **Decision**: by default `/sap/opu/odata4/sap/<binding>/srvd/sap/<srvd>/0001/`, configurable.
- **Why**: an existing Fiori Elements application can point to the service without changing its
  manifest.

## D7 — Fixture activatable as is on a real system

- **Decision**: the `fixtures/travel` fixture is a complete and consistent abapGit export
  (strict(2), global authorization, managed numbering…). The authorization is no longer ignored:
  it is part of the supported non-draft features (D14).
- **Why**: the reference behavior can be checked on an SAP system.

## D8 — Timestamps as `timestamptz(6)`

- **Decision**: `TIMESTAMPL`/`UTCLONG` → `timestamptz(6)`, `TIMESTAMP` → `timestamptz(0)`.
- **Why**: natural type in SQL and for the OData filters. The timestamps generated by the runtime
  are to the microsecond, which keeps the ETags stable.
- **Consequence**: the seventh ABAP decimal is lost (KNOWN_GAPS.md).
- **Adjustment (M4)**: `@abaplint/runtime` 2.14.24 stores the packed numbers in an exact form
  (scaled `BigInt` integer). The conversions between the buffer and ABAP go through text
  (`toFixed`): a `TIMESTAMPL` reaches the ABP intact and comes back intact. Only the arithmetic
  operations of the runtime on packed numbers go through JavaScript numbers (KNOWN_GAPS.md). The
  ETags are canonical values of the buffer, never recomputed by the ABP.

## D9 — Client removed

- **Decision**: the `CLNT` column (`CLIENT`, `MANDT`) is removed from the tables; single-tenant
  application.

## D10 — Freestyle OpenUI5 1.136 LTS UI

- **Decision**: `sap.m`, `sap.f`, `sap.uxap`, `sap.ui.layout` controls, `sap_horizon` theme,
  ODataModel V4 with `autoExpandSelect`. `sap.ui.mdc` is a possible evolution.
- **Why**: Apache-2.0 libraries; the ODataModel V4 is the one of Fiori Elements V4.
- **Implementation (M5)**: `rapt build` writes `ui/`: one List Report XML view per root entity
  set and one Object Page view per entity set, generated from the `@UI` annotations (same
  derivation as the CSDL), and generic controllers driven by `ui/model/layout.json` (filters,
  search, non-draft creation, edit and save with `submitBatch`, deletion, actions with a
  parameter dialog, factory actions, editable composition tables, messages). The feature control
  goes through `__OperationControl`, `__EntityControl` and `__FieldControl`, which the ODataModel
  selects itself.

## D11 — Serialized ABP execution, reentrant within a LUW

- **Decision**: a lock per process wraps the ABP calls; it is reentrant for the LUW that holds
  it (a determination that runs an internal action does not block itself).
- **Why**: the abaplint runtime has a global state (`sy-*`, static attributes).
- **Consequence**: scaling with processes or containers.
- **Implementation (M4)**: `RapRuntime.transaction` chains the LUWs on a promise (one LUW at a
  time per process); the current LUW is carried by `AsyncLocalStorage`, which makes the EML calls
  of the handlers reentrant. Between processes, the locks are PostgreSQL row locks
  (`SELECT … FOR UPDATE NOWAIT` on the instance of the `lock master`, cause `locked` when refused).

## D12 — Naming and license

- **Decision**: packages `@open-rap/model`, `@open-rap/compiler`,
  `@open-rap/runtime`; `rapt` CLI; MIT license for this repository.

## D13 — Test corpus of the parsers

- **Initial decision**: an extract of BDEF and CDS sources of the SAP-samples repositories
  (Apache-2.0).
- **Adjustment (M1)**: the SAP-samples repositories were reorganized and their paths can no
  longer be found by code search. The corpus is therefore written for the project
  (`packages/compiler/test/bdef-parser.test.ts`): namespaced names, operation options, static,
  factory and internal actions, functions, side effects, `control` mappings, and the
  out-of-scope constructs (draft, late numbering, events…). The same sources are compared with
  the BDEF parser of abaplint (D1). An SAP-samples extract may be added later.

## D14 — Functional scope: a complete non-draft managed RAP BO

- **Decision**: the target is the set of features of a managed BO without draft, tracked in
  [FEATURES.md](FEATURES.md). It adds to the initial MVP: authorizations (global and instance),
  static and dynamic feature control, external numbering, static, factory, internal actions and
  actions with a parameter, on save determinations, precheck, side effects (CSDL), T100 messages,
  reads and creations by association in the ABP.
- **Still out of scope**, with their reason in FEATURES.md: draft (excluded by the
  specification, then added by D54), unmanaged implementation, late numbering, events, change
  documents, extensions, analytics. `with additional save` and `with unmanaged save`, excluded at
  first, are supported since D30.

## D15 — Generic runtime driven by the IR

- **Decision**: the generated application contains a generic runtime (`@open-rap/runtime`)
  that reads `model.json`. Only the SQL, the CSDL, the JavaScript of the ABP, the UI and the
  packaging are generated. The runtime is bundled as a tarball in `vendor/`.
- **Why**: a single runtime tested for all BOs; a standalone output without a private registry.
- **Adjustment (M6)**: rather than a tarball, `vendor/` contains the compiled `runtime` and
  `model` packages (`dist/` and a production `package.json`); their version carries a hash of
  their content, so that `npm install` updates them after a new `rapt build`. The `.npmrc`
  (`install-links=true`) installs them as ordinary packages. `server.mjs` calls `start()` of the
  runtime, configured by environment variables (`.env.example`).

## D16 — Canonical representation of the values

- **Decision**: in the transactional buffer, the values are canonical JavaScript values: strings
  for CHAR, NUMC and STRING (trailing blanks removed); strings for decimals and INT8 (no loss of
  precision); `YYYY-MM-DD` for dates (initial = `null`); `HH:MM:SS` for times; ISO 8601 UTC to
  the microsecond for timestamps; lower-case UUIDs with dashes; booleans for `ABAP_BOOLEAN`.
- **Why**: a single pivot form between ABAP, SQL and OData; the conversions are isolated and
  tested.

## D17 — Toolchain

- **Decision**: TypeScript 7.0 (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM `NodeNext` with `.js` specifiers,
  `tsc` compilation to `dist/`, Vitest (aliases to the sources), pnpm workspaces.

## D18 — Database of the tests

- **Decision**: PGlite (PostgreSQL in WASM, in process) for the integration tests; a real
  PostgreSQL for the e2e.

## D19 — "Shadow" DDIC for the transpiler

- **Decision**: the registry given to the transpiler receives the tables of the model with
  predefined types (DATATYPE, LENG, DECIMALS), the data elements of the standard catalog and of
  the project; no CDS views.
- **Why**: the SQL layer of the transpiler fails on associations and does not know the standard
  SAP data elements; the types of the ABP come from the derived interface (D2); our SQL comes
  from the IR.
- **Consequence**: a `TYPE zr_travel` type (CDS view) was not available in the ABP; the derived
  types and the tables were.
- **Adjusted (D26)**: the CDS entities are given as "shadow" tables with the same name and
  elements (predefined types, without associations), for ABAP SQL; `TYPE zr_travel` is therefore
  typed. The shadow tables no longer have a client column (D9). The CDS views themselves stay out
  of the registry of the transpiler.

## D20 — `field ( mandatory )` without a check at runtime

- **Decision**: as in RAP, no runtime check; `Common.FieldControl` Mandatory in the CSDL and
  required field in the UI. `mandatory : create`, on the other hand, is checked on creation, as
  in RAP.

## D21 — Triggering of the determinations and validations

- **Decision**: the on modify determinations run at the end of each modifying request, in
  successive rounds: a round handles the instances whose trigger was touched since the previous
  run of this determination; a determination is not triggered again by its own changes; the loop
  is bounded (error beyond 20 rounds). The validations and the on save determinations run in the
  save sequence, on the accumulated changes of the LUW.

## D22 — RAP failure causes and HTTP statuses

- **Decision**: the first entry of `failed` gives the status of the OData error: `unspecific`
  400, `unauthorized` 403, `not_found` 404, `locked` and `conflict` 409, `readonly` 400,
  `disabled` 409, `dependency` 424; a missing `If-Match` on PATCH, PUT and DELETE of an entity
  with an ETag gives 428, a stale ETag 412. The main message is the first error message of
  `reported`; the other messages go into `details`. Without a message, a generic text describes
  the cause ("Travel(…) is locked by another user").
- **Why**: SAP does not publish a mapping table; these statuses are those of the HTTP protocol
  for each cause, and Fiori elements shows the message whatever the status.

## D23 — One LUW per request or per change set; responses rendered after the commit

- **Decision**: a modifying request (or a change set of a `$batch`) is a LUW: the operations, the
  on modify determinations at the end of each request (D21), then the save sequence, in a
  PostgreSQL transaction. The responses (created entity, result of an action…) are read after the
  commit in the projection views; in a change set, they are deferred until the end of the change
  set. A failure rolls back the whole change set, which receives a single error response.
- **Why**: the response shows the saved state (determinations, administrative fields, ETag), as
  in RAP, and the reads never have to see the unsaved buffer. The navigations of a write
  (`$1/_Booking`, `Travel(…)/_Booking(…)`) are resolved in the LUW, which sees the instances
  created earlier in the change set.

## D24 — Extended "clean-room" ABAP base

- **Decision**: in addition to `if_abap_behv`, `cl_abap_behavior_handler` and
  `cl_abap_context_info`, the compiler provides `if_message`, `if_t100_message`,
  `if_t100_dyn_msg`, `if_abap_behv_message`, `cx_root` (and `cx_static_check`,
  `cx_dynamic_check`, `cx_no_check`, the classes of the runtime errors), `cl_system_uuid`, the
  `scx_t100key` structure and the standard data elements of the DDIC catalog. The text of an
  exception is its T100 message, its attributes resolved by name (native method
  `ZRAP_EML=>exception_text`).
- **Why**: real behavior pools use message exception classes (pattern
  `/DMO/CM_FLIGHT_MESSAGES`), `cl_system_uuid` and these types. The transpiler turns any class
  named `CX_ROOT` into a subclass of the JavaScript `Error`: it is enough to provide it.
- **Consequence**: these objects are written from the public signatures of SAP (LICENSES.md); an
  object of the project with the same name takes precedence.

## D25 — Checks of the OData interface of the writes

- **Decision**: the `readonly` properties, the managed numbering properties and the
  administrative fields sent by an OData client are ignored (as `Core.Computed` provides); an
  unknown property gives 400. The operations that are not exposed (`use create` missing,
  `internal` operation) give 405. The keys of an entity do not change with PATCH (400). The
  feature control (`__EntityControl`, `__OperationControl`, `__FieldControl`) is only computed
  when the request selects these properties (or has no `$select`). The global feature control of
  `update`, `delete` and the instance actions is also there, with the same value for all the
  instances: RAP presents it like the instance feature control ("consumer hint"). In the
  generated views, these values are read with `%{…}` (raw value): `${…}` would give the text
  formatted by the OData type (`"1"` for an Edm.Byte), and the comparison would fail.
- **Why**: it is the behavior the ODataModel V4 of Fiori elements expects; computing the feature
  control calls the ABP and must not slow down the reads that do not use it.

## D26 — Read ABAP SQL in the ABP

- **Initial decision**: any ABAP SQL statement in a behavior pool was a compile error (ABP007),
  for lack of a database connection for the abaplint runtime.
- **Revised decision**: `SELECT` (simple, `SINGLE`, `INTO TABLE`, `FOR ALL ENTRIES`, joins,
  aggregates, subqueries, `SELECT … ENDSELECT` with `SELECT *`) reads the tables and the CDS
  entities of the project. The writes (`INSERT`, `UPDATE`, `MODIFY`, `DELETE` on a table) are
  refused in the handlers (ABP007): a managed BO is written by the RAP runtime, the code changes
  it with EML. They are allowed in the saver (`save_modified`) of a BO with additional or
  unmanaged save (D30). Common table expressions (`WITH`) stay refused.
- **Implementation**:
  - the SQL `@abaplint/transpiler` generates assumes columns in ABAP format (its own schemas store
    dates as `NCHAR(8)`, UUIDs as 32 hexadecimal digits). The generated schema therefore adds a
    `rapt_abap` schema of views, one per table (without a client column, D9) and per CDS entity,
    lower-case column names: dates `YYYYMMDD`, times `HHMMSS`, UUIDs and binaries in upper-case
    hexadecimal, booleans `X`/space, timestamps as packed numbers (`YYYYMMDDhhmmss.fffffff`), ABAP
    initial values instead of `NULL`s. Fixed-length character types become `bpchar`, whose
    comparisons ignore trailing blanks like ABAP. `abap.dbo.schemaPrefix` (option of the abaplint
    runtime) makes the transpiled code read these views;
  - the runtime registers a read-only database client (`DatabaseClient` of the abaplint runtime)
    that runs the query in the transaction of the current LUW, after a translation to PostgreSQL:
    `UP TO n ROWS` → `LIMIT`, `ORDER BY PRIMARY KEY`, `ASCENDING`, operators `EQ`/`GE`…,
    `alias~field`, lower-case identifiers. Only the views of `rapt_abap` are readable. Each query
    runs in a savepoint: an SQL error leaves the transaction of the LUW usable.
    `COMMIT WORK`/`ROLLBACK WORK` are a runtime error, as in RAP;
  - the CDS entities are given to the transpiler as "shadow" tables with the same name and
    elements (D19): `SELECT FROM zr_travel` and `DATA ls TYPE zr_travel` are typed;
  - abaplint does not type the inline declaration of the result of a literal, of an aggregate
    other than `COUNT(*)` or of an expression: the transpiled method would fail on start. The
    rewriting pass declares the two most common forms (existence check
    `SELECT SINGLE @abap_true … INTO @DATA(x)`: `abap_boolean`; `MAX( col )`/`MIN( col )` of a
    single source, numbering pattern of the RAP100 tutorial: the type of the column); the others
    are reported at compile time (ABP009);
  - `MESSAGE … INTO` takes its texts from the message classes of the project.
- **Semantics**: as in RAP, `SELECT` reads the database, not the transactional buffer: the
  unsaved changes of the LUW are not visible in it (read the BO with EML for that).
- **Why**: reading control tables with SQL, the uniqueness of an identifier or numbering with
  `MAX` are common in real behavior pools; views in ABAP format leave the SQL of the transpiler
  almost intact and give the ABAP semantics of the comparisons. Trade-off: a condition on a
  converted column (date, UUID, timestamp) cannot use an index (KNOWN_GAPS.md).
- **Related fix**: the failure of a lock (`FOR UPDATE NOWAIT`) left the PostgreSQL transaction
  of the LUW in an error state; it is also isolated in a savepoint (test `rap-locks.test.ts` on a
  real PostgreSQL).

## D27 — OpenUI5 resources served from the npm packages

- **Decision**: the runtime serves `/resources/` from the npm packages of OpenUI5 (`@openui5/*`
  1.136, Apache-2.0): the sources of the libraries as they are, and the themes compiled on the
  first request with `less-openui5` (Apache-2.0), then kept in memory. `/ui/` serves the
  generated application.
- **Why**: the OpenUI5 CDN is not always reachable (it is not from the development environment
  of this project) and a standalone application must not depend on it; npm is enough, without
  UI5 tooling on startup. The first load requests about 400 modules: a bundle built by the UI5
  tooling (`ui5 build`) is planned for the Docker image (M6).

## D28 — OIDC sessions without an additional dependency

- **Decision**: the "authorization code" flow with PKCE is written with `jose` (already used for
  the bearer tokens): sign-in state and session in signed cookies (HMAC-SHA256, HttpOnly,
  SameSite=Lax), without storage on the server; CSRF token bound to the session; discovery
  possible on an internal URL (`OIDC_DISCOVERY_URL`) distinct from the public issuer. The tests
  use an OIDC provider written for them (discovery, authorization, token, JWKS).
- **Adjustment of PLAN.md**: `openid-client`, `@fastify/secure-session` and `oauth2-mock-server`
  are not added. `openid-client` requires the issuer to be the discovery URL, which does not suit
  Keycloak in docker-compose (the browser sees `localhost:8180`, the container of the
  application `keycloak:8080`).
- **Consequence**: the session lasts 8 hours (`maxAge`); there is neither token refresh nor
  revocation on the server before expiry (KNOWN_GAPS.md).

## D29 — End-to-end test and CI

- **Decision**: the e2e test (`packages/runtime/test/e2e.test.ts`) starts from the compiled CLI:
  `rapt build` of the fixture, `npm install` of the generated application, `node server.mjs` on a
  real PostgreSQL (the one of `RAPT_E2E_DATABASE_URL`, otherwise a server started for the test,
  otherwise PGlite), then the OData service and the UI in Chromium. The CI provides a
  PostgreSQL 16 service and Chromium. A second job builds the image and starts the generated
  `docker-compose.yml` (`--wait`, HTTP checks of the service and of the UI). Also checked in the
  development environment: image built, PostgreSQL and application started by compose, creation,
  creation by association, action and UI served by the container.
- **Why**: it is the delivered artifact that is tested, not the sources of the runtime.
- **Note**: TypeScript 7.0.2 compiles `new (x as T).Builder()` without the parentheses; only the
  compiled JavaScript (dist) shows it, Vitest compiling the sources differently. The e2e test,
  which runs the dist, revealed it; the code avoids this form.

## D30 — Additional and unmanaged save in a managed BO

- **Decision**: `managed with additional save` and `managed with unmanaged save` (header of the
  BDEF, or `with additional save` / `with unmanaged save` per entity, `with full data` accepted)
  are supported, with the local saver class of the behavior pool (`lsc_…` inheriting from
  `cl_abap_behavior_saver` or `cl_abap_behavior_saver_failed`): `save_modified` (mandatory) and
  `cleanup`. Additional save: the runtime writes the persistent tables, then calls
  `save_modified`. Unmanaged save: the entity has no persistent table, the runtime reads and
  locks the instances through the CDS view and `save_modified` writes them.
- **Implementation**:
  - derived types `TYPE TABLE FOR CHANGE`, `TYPE REQUEST FOR CHANGE` and
    `TYPE REQUEST FOR DELETE`; the rewriting pass declares `save_modified` with its parameters
    (`create`, `update`, `delete`, `reported`, and `failed` for `cl_abap_behavior_saver_failed`);
    `adjust_numbers` (late numbering) is refused (ABP007);
  - ABAP SQL writes are only allowed in the saver class (ABP007 elsewhere) and, at runtime,
    during `save_modified` only. The RAP-specific forms
    (`… FROM [TABLE] @source [INDICATORS SET STRUCTURE %control] MAPPING FROM ENTITY`), which the
    transpiler does not know, are lowered to the kernel, which applies the mapping of the BDEF
    and writes with the types of the database, exact values;
  - the other writes go through the transpiler and the views of the `rapt_abap` schema (D26): an
    `INSTEAD OF` trigger per table writes the table, values converted back from their ABAP form
    (functions `rapt_abap.to_date`, `to_uuid`, `to_timestamp`…);
  - the rows of `update` carry all the values (like `with full data`), `%control` the changed
    fields; `delete` also contains the compositions deleted in cascade;
  - a `failed` of the saver (`cl_abap_behavior_saver_failed`) rolls back the LUW, like a
    validation; the messages of `reported` are returned to the client;
  - all the transparent tables of the project enter the model (database and types of the
    transpiler), not only those of the CDS views and of the persistent tables: a log or control
    table can be read and written by ABAP SQL. A table no entity uses and that cannot be built is
    left aside (information DDIC005).
- **Transpiler defect worked around**: `DELETE dbtab FROM @wa` makes it lose the row, and the
  query would delete the whole table: refused at compile time (ABP007) and, for safety, a
  `DELETE` without a condition is refused at runtime.
- **Why**: it is the RAP way to write existing tables or to log the changes of a BO, frequent in
  real projects; the ABAP SQL of the saver reuses the views of D26.

## D31 — Consuming remote APIs in the ABP (HTTP, OData client proxy, SCM and SCM2)

- **Decision**: a behavior pool can call remote APIs with the APIs of ABAP Cloud, rewritten in
  clean-room from their public signatures:
  - HTTP client: `cl_http_destination_provider` (`create_by_url`,
    `create_by_comm_arrangement`, `create_by_cloud_destination`), `cl_web_http_client_manager`,
    `if_web_http_client`, `if_web_http_request` (path, query, headers, text or binary body, form,
    basic or bearer authentication), `if_web_http_response`, `if_web_http_header`,
    `if_a4c_cp_service`;
  - OData client proxy of the service consumption model: `/iwbep/cl_cp_factory_remote` and
    `cl_web_odata_client_factory` (`create_v2_remote_proxy`, `create_v4_remote_proxy`); list read
    (`create_by_range` of the filters combined with `and`/`or`/`not`, `$select`, `$orderby`,
    `$top`, `$skip`, `request_count`, `request_no_business_data`), read by key
    (`navigate_with_key`), create, update (`PATCH`/`PUT`, provided properties, `set_if_match`),
    delete;
  - exceptions `cx_http_dest_provider_error`, `cx_web_http_client_error`,
    `cx_web_message_error`, `/iwbep/cx_gateway`, `/iwbep/cx_cp_remote` (`http_status_code`,
    `http_error_body`), with the text of the error for `get_text( )`.
- **Destinations**: on SAP, they come from the destination service of BTP or from a
  communication arrangement; the generated application reads them from its environment:
  `DESTINATION_<NAME>_URL`, then `_USER` and `_PASSWORD` (basic), `_TOKEN` (bearer) or
  `_HEADERS` (JSON object: API key…). `<NAME>` is the name of `create_by_cloud_destination`, or
  `<SCENARIO>_<SERVICE_ID>` then `<SCENARIO>` for `create_by_comm_arrangement`
  (`comm_system_id` ignored). The credentials stay in the kernel: the ABAP only sees the URL.
  `rapt build` lists the destinations named by literals in the `.env.example` and the README of
  the application.
- **Service consumption model**:
  - SCM2: the consumption model class (`INHERITING FROM /iwbep/cl_v4_abs_pm_model_prov`) is kept
    for its types (`tys_…`, `tyt_…`) and its constants (`gcs_entity_set`, `gcs_entity_type`); the
    rewriting pass removes the definition of the model (`define`, `def_…`), written with the
    `/iwbep/if_v4_pm_*` interfaces of SAP Gateway;
  - SCM: the generated abstract entities (`_vc` value control fields included) type the data;
    they are structures for the ABAP (shadow DDIC). The service definition generated for the
    client proxy has no binding: when there are several definitions, the one with a binding is
    built (SRVD007);
  - the proxy reads the `$metadata` of the remote service once: entity sets, keys, types of the
    properties. The internal ABAP names (`TRAVEL_ID`, `'TRAVEL'`) are matched with the EDM names
    ignoring case and `_` (`TravelID`). The values are converted according to the EDM type and
    the ABAP type: dates, times, timestamps (`/Date(ms)/` in V2, ISO in V4 with the precision of
    the property), UUIDs, exact decimals as text (`IEEE754Compatible=true` in V4), booleans,
    binary; the trailing blanks of the `c` fields are not sent; the ETag (`@odata.etag`,
    `__metadata.etag`) fills the `etag` component of the SCM2 classes;
  - modifying requests: CSRF token requested with `HEAD` on the root of the service
    (`X-CSRF-Token: Fetch`, can be disabled with `iv_do_fetch_csrf_token`), session cookies
    kept, retry with a new token after `403` + `X-CSRF-Token: Required`, as SAP Gateway requires.
- **Implementation**: the ABAP keeps the state of the objects (request, headers, filters); the
  kernel (`ZRAP_EML`) makes the network calls (`fetch` of Node.js, 60 s by default or
  `i_timeout`), reads the `$metadata` (fast-xml-parser, already used by the compiler) and
  converts the values.
- **Why**: calling an API from an action, a determination or a validation is a common need
  (side-by-side extension, enrichment, check against another system); the developer keeps the
  code they write on SAP. The SAP Gateway classes do not exist outside an SAP system: they are
  reimplemented, without SAP code.
- **Tests**: `rap-variant-remote.test.ts` (REST API: destination with basic auth, headers,
  status, missing destination, refused connection; OData V4 with an SCM2 class to the
  application of the fixture served on a port: filter, `$select`, `$orderby`, `$top`, `$count`,
  read by key; V4 writes to a simulated service: CSRF, cookies, ETags, token renewal, 409 error;
  OData V2 with the abstract entity of an SCM: `d.results`, `__count`, `/Date()/`),
  `http-client.test.ts`, `app-scaffold.test.ts`.

## D32 — Dependent ETag and ETag in a change set

- **Decision**: an `etag dependent by _Assoc` entity has the ETag of its master: the ETag is the
  value of the ETag field of the master instance reached through the `by` associations (one or
  several, up to an `etag master`). The service exposes it (`@odata.etag` of the instances,
  `ETag` header, `Core.OptimisticConcurrency` with the path `_Travel/LocalLastChangedAt`) and
  checks `If-Match` on the changes of the dependent entity (428 without the header, 412 when
  stale).
- **The master changes with its dependents**: the SAP rule is that the ETag field is updated on
  each change of the instance it covers; when a dependent instance is created, changed or
  deleted, the runtime updates the ETag field of the master when it manages it (administrative
  timestamp `localInstanceLastChangedAt` or `lastChangedAt`, master written by the runtime), once
  per LUW, at save time. A master with unmanaged save or with another ETag field must be updated
  by the application.
- **`If-Match` in a change set**: it is compared with the ETag of the instance at the beginning
  of the LUW, the state the client read. The requests of a change set carry the ETags read before
  it: an earlier change in the same change set (the previous request, or a determination that
  recomputes the travel when a booking changes) does not make them stale. The changes of the
  other clients are still detected: the LUW locks the instances it changes.
- **Why**: without it, the Object Page of a non-draft BO that saves a travel and its bookings in
  one change set would fail with 412 as soon as a determination touches the travel; and a
  dependent entity would have no concurrency protection.
- **Implementation**: OData model (`etagPath`), CSDL, read (scalar subqueries along the
  navigations, in the lists, the single reads and `$expand`), write check
  (`Transaction.etagValue`), update of the master (`refreshEtagMasters`, before the write).
  Tests: `rap-variant-etag.test.ts`.

## D33 — PGlite and Keycloak proven end to end

- **PGlite** (`PGLITE_DIR`): the e2e test starts the generated application on its embedded
  database, creates a travel, stops it and starts it again: the schema is applied again
  (idempotent) and the data is there. The test revealed that the application did not start on
  PGlite: the schema was sent as one query of several statements, which the extended protocol of
  PGlite refuses (`cannot insert multiple commands into a prepared statement`). It is now split
  into statements (`splitStatements`: literals, identifiers, `$f$…$f$` bodies and comments
  respected) and applied in a transaction.
- **Keycloak**: `keycloak.test.ts` plays the browser against a real Keycloak with the generated
  realm: redirect to Keycloak, submission of the sign-in form of `alice`, return to
  `/auth/callback` (authorization code with PKCE), session on the UI and on the OData service
  (CSRF token, creation attributed to `ALICE`), sign-out to the end-session endpoint of Keycloak;
  then a bearer token issued by Keycloak (public client created through the admin API, password
  grant) verified by the JWKS, and a forged token refused. Run against the Keycloak 26.8.2
  distribution (Maven Central, Java 21) in the development environment, and in CI against the
  image of the generated `docker-compose.yml` (`--profile oidc`).
- **CI**: the health check of the PostgreSQL service uses `pg_isready -U postgres`.

## D34 — Authorizations: authorization objects, OIDC roles, AUTHORITY-CHECK

- **Problem**: the ABAP environment splits the authorizations between the IAM (IAM apps,
  business catalogs, business roles with their restrictions, assigned to business users) and the
  code (`AUTHORITY-CHECK` in the handlers, DCL access controls). Outside SAP, there is no IAM;
  OIDC authenticates and carries roles, but does not say which values of authorization objects a
  role grants. The transpiler translates `AUTHORITY-CHECK` into a call to a kernel class
  `KERNEL_AUTHORITY_CHECK` the application did not provide: the statement compiled but failed at
  runtime (500).
- **Decision**:
  - the authorization objects come from the abapGit sources (SUSO: fields `FIEL1…`, activities
    `TACTZ`), or from the `objects` section of the roles file;
  - the roles are in `rapt/authorizations.json`, at the root of the abapGit project, versioned
    with the sources (outside the `src/` folder, abapGit ignores it): name of the role of the
    IdP → authorizations, instances of objects with their values, like a business role and its
    restrictions;
  - values in the PFCG way: value, pattern `07*`, `*`, range `{ "from", "to" }`, and values from
    a claim of the token (`{claim:agency}`: the agency of the user, attribute of the IdP), so as
    not to create one role per value;
  - `AUTHORITY-CHECK` is evaluated by the kernel on the roles of the user of the request:
    `sy-subrc` 0 when an authorization of the object accepts all the checked fields (`DUMMY` is
    not checked), 4 otherwise, 12 without an authorization for the object, 40 for `FOR USER` of
    another user; the ABAP code stays the one of SAP;
  - the IdP (Keycloak, Entra ID, SAP Cloud Identity Services…) assigns the roles to the users
    (`OIDC_ROLES_CLAIM`) and carries the attributes; the application keeps the claims read by the
    roles (session included); `OIDC_REQUIRED_ROLE` stays the right to access the application;
  - in development (`AUTH_MODE=none`), the user has all the authorizations (like SAP_ALL in a
    development system), unless `DEV_ROLES` (and `DEV_ATTRIBUTES`) are given;
    `AUTHORIZATIONS_FILE` replaces the roles on deployment;
  - the compiler checks the roles against the objects (AUTH001…AUTH004) and the
    `AUTHORITY-CHECK`s of the code (ABP010, ABP011); the generated Keycloak realm contains the
    roles (given to `alice`), a user attribute declared in the profile and a mapper to the token
    for each claim read.
- **Why**: the same behavior pool runs on SAP and here; the definition of the roles stays
  reviewed and versioned like the IAM objects; the administration of the users stays in the IdP.
- **Fixture**: the reference BO checks the `ZAO_TRAVL` object (activity, agency) in its global
  and instance authorizations, like the /DMO/ reference scenario of SAP; roles `travel_manager`,
  `travel_agent` (agency from the `agency` claim), `travel_viewer`.
- **Tests**: `rap-authorizations.test.ts` (locally signed tokens), `authorizations.test.ts`
  (semantics of `sy-subrc`), `authorizations.test.ts` of the compiler (diagnostics),
  `keycloak.test.ts` (an agent created in Keycloak with their agency attribute).

## D35 — Access controls (DCL) on the reads

- **Decision**: the CDS roles of the abapGit sources (DCLS objects: `define role R { grant select
  on E where … ; }`) restrict the rows the OData service returns to the user of the request, in
  the lists, `$count`, the single reads, `$expand` and the navigations. A row is granted when a
  condition of a role of the entity is true; an entity without a role is fully readable (as in
  ABAP CDS).
- **Evaluated conditions**: `( E1, E2 ) = aspect pfcg_auth( OBJ, F1, F2, ACTVT = '03' )` on the
  authorizations of the user (D34: values, patterns, ranges, claims; no authorization → no row),
  `E ?= aspect user` / `= aspect user` (ABAP name of the user), comparisons with literals (ABAP
  format: dates `YYYYMMDD`), `like`, `is [not] null`, `and`, `or`, `not`, parentheses, paths of a
  to-one association (`_Travel.AgencyID`, read by a subquery on the target view) and
  `inheriting conditions from entity B`: a projection takes the conditions of its base view, its
  elements renamed as it exposes them.
- **Security**: what cannot be evaluated (other aspects, longer paths, element not exposed by the
  projection) grants nothing (deny by default), with a diagnostic (DCL002, DCL003). A read outside
  a request grants nothing. The development user without `DEV_ROLES` is not restricted.
- **What is not filtered**: the EML and the ABAP SQL of the behavior pool (like
  `WITH PRIVILEGED ACCESS`); the changes go through the instance authorization, as in RAP.
- **Implementation**: DCL parser (`dcl/parser.ts`), resolution for the exposed entities
  (`ir/access-controls.ts`, conditions in `model.accessControls`), SQL condition computed per
  request (`odata/access.ts`, user carried by an `AsyncLocalStorage`) and added to the `WHERE` of
  the read engine.
- **Fixture**: roles `ZRT_R_TRAVEL` (agency through
  `pfcg_auth( ZAO_TRAVL, ZAGENCY, ACTVT = '03' )`), `ZRT_C_TRAVEL` (inherits from the base view),
  `ZRT_C_BOOKING` (agency of the travel, `_Travel.AgencyID`).

## D36 — Authorizations in the consumer hints (UI)

- **Decision**: like RAP, which presents the feature control and the authorization check as
  consumer hints, the entities whose BO has authorization handlers (master with a global or
  instance handler, or entity dependent on such a master) expose `__EntityControl` (`Updatable`,
  `Deletable`) and `__OperationControl` (instance actions, create by association); their values
  combine, for the user of the request, the feature controls and the global and instance
  authorizations. The `$metadata` announces them (`UpdateRestrictions`, `DeleteRestrictions`,
  `NavigationRestrictions` per path, `Core.OperationAvailable`), usable by a Fiori elements
  application as well.
- **Creation**: it depends on no instance; the service answers `GET <root>$permissions` (creations
  allowed per entity set: global authorization and global feature control) and the generated UI
  hides Create when it is refused.
- **Create by association**: for the master entity, it has its own indicator
  (`%assoc-_Booking`), as on SAP; for a dependent entity, the update authorization of the master
  applies. The fixture grants the creation of bookings with the update of the travel.
- **Tests**: `rap-authorizations.test.ts` (checks per profile, `$permissions`, creation of
  bookings), `ui-authorizations.test.ts` (browser: a viewer does not see Create, Edit, Delete and
  the action are disabled).

## D37 — Launchpad of the applications (OpenUI5)

- **Decision**: `rapt launchpad <launchpad.json> --out <folder>` generates a launchpad, the
  equivalent of the SAP Fiori launchpad built with OpenUI5. The SAP shell (`sap.ushell`) only
  exists in SAPUI5, under an SAP license, and the rule of the project excludes it. The launchpad
  is made of a `sap.f.ShellBar` (home, tile search, user menu with sign-out) and of groups of
  `sap.m.GenericTile`. A dynamic tile (`NumericContent`) shows the `$count` of an entity set,
  with an optional filter. Navigation is by intent (`/#Travel-manage`, `/go/Travel-manage?…`).
- **Content**: `launchpad.json` is versioned with the sources, like the content of the launchpad
  (catalogs, groups, tiles, target mappings). It lists the applications (folder generated by
  `rapt build`, internal URL) and the groups of tiles. A tile is assigned to roles of the IdP, the
  equivalent of the business catalog of a business role; without a role, every user sees it. The
  compiler resolves the service paths and checks the entity sets of the counters, the intents and
  the roles (`LPD001` to `LPD007`); it takes the roles and the claims of the applications for the
  realm and the session.
- **Architecture, a single origin**: the SAP front-end server serves the launchpad, the
  applications and their services under one domain. Here, the server of the launchpad mounts the
  UI of each application under `/apps/<id>/` and relays its services at their own paths
  (`/sap/opu/odata4/…`, unique per service); the redirects of the applications are rewritten
  under their mount point. The browser sees a single origin: no CORS, the UI reads the counters
  directly, the cookies are shared.
- **Single sign-on**: the launchpad opens the OIDC session (code + PKCE). The applications behind
  it have the same `SESSION_SECRET` (and the client and `PUBLIC_URL` of the launchpad) and read
  this session: user, roles, claims read by their authorizations. Each application keeps its
  authorizations (D34), its access controls (D35) and its required role, now checked on each
  request: a session opened by the launchpad for a user without this role receives a 403. The
  bearer tokens of the API clients are relayed as is.
- **Sign-out**: the ID token of the sign-in is kept in a separate HttpOnly cookie (`rapt_idt`)
  and passed as `id_token_hint` to the end-session endpoint. The provider then ends its session
  without a confirmation page, even with an expired token, as OIDC RP-Initiated Logout provides
  (checked with Keycloak). This also applies to a standalone application.
- **Why not the relayed token (BFF)**: relaying the access token of the user would have required
  keeping the tokens on the server and refreshing them (5 minutes by default with Keycloak). The
  shared signed session stays stateless, like the one of the applications (D28).
- **In the applications**: the generated UI, served behind a launchpad (`/launchpad/config`
  answers), shows the shell bar of the launchpad above its pages (home, user, sign-out). Alone,
  it is unchanged. Each application stays deployable on its own.
- **Operations**: the generated folder contains `server.mjs`, a Dockerfile and a
  `docker-compose.yml`: the launchpad, each application built from its folder with its PostgreSQL
  database, and Keycloak in the `oidc` profile (client `rapt-launchpad`). Plus `.env.example`
  (`APP_<ID>_URL`) and a README.
- **Tests**: `runtime/test/launchpad.test.ts` covers the tiles per role and the sign-in against a
  test OIDC provider, then the reading of the session by the application. It also checks,
  through the gateway, the DCL, the authorizations, the CSRF and the bearer tokens, as well as
  the intents, the rewriting of the redirects, the 502 and the required role.
  `runtime/test/launchpad-ui.test.ts` tests in the browser the tiles of a viewer, the counter,
  the search, the application opened with the shell bar, the way back and the intent.
  `compiler/test/launchpad.test.ts` covers the diagnostics, the generated files and the CLI.

## D38 — Development loop (`rapt dev`)

- **Context**: building, installing and starting the generated application takes four commands
  (`rapt build`, `npm install`, a PostgreSQL database, `npm start`) at each change of a source.
  The standalone application is the target: the editing loop must be immediate.
- **Decision**: `rapt dev <src>` builds the application without its scaffold (no `vendor/`, no
  `package.json`, no Docker) into `<src>/.rapt/dev`, starts it, watches the sources and starts
  again on each change (grouped over 150 ms, one build at a time).
  - **Dependencies**: the `node_modules` of the build is a link (a junction on Windows) to the one
    of the `@open-rap/runtime` package, which contains the abaplint runtime, PGlite and
    OpenUI5. The transpiled ABAP module and the runtime thus load the same `@abaplint/runtime`. No
    npm installation.
  - **Child process**: the server runs in a separate process (`dev-server.mjs`), stopped by an
    IPC message (PGlite closes its files) then started again. The transpiled ABAP code sets a
    global state (the `abap` object) and ES modules cannot be unloaded: a restart in the same
    process would keep the old behavior pool.
  - **Errors**: a build in error does not touch the running application; the diagnostics keep the
    format of `rapt check`.
  - **Database**: PGlite in `.rapt/dev/data`, kept between builds. The applied schema is
    remembered; when it changes, the database is deleted and created again (development data, no
    migration). With `DATABASE_URL`, the given database is used as is.
  - **Watching**: one `fs.watch` per folder, not the recursive mode. On Linux, the recursive mode
    of Node.js loses the files replaced by a rename, which most editors do on save. Folders
    starting with a dot and `node_modules` are ignored, except `.abapgit.xml`.
  - **Defaults**: `AUTH_MODE=none`, `HOST=127.0.0.1`, `LOG_LEVEL=warn`; each environment
    variable overrides them.
- **Tests**: `compiler/test/dev.test.ts` covers the build, the behavior pool run, the data kept,
  the build in error, the reset on a schema change and the watching of a file replaced by a
  rename.

## D39 — JSON output of the CLI and VS Code extension

- **Context**: everything must be possible on the command line, or visually in VS Code. Two
  implementations of the compiler would diverge.
- **Decision**: the CLI stays the only engine; the VS Code extension
  ([packages/vscode](../packages/vscode)) calls it and shows its results.
  - **`--json`**: `rapt check` and `rapt build` write a JSON object (`command`, `ok`, `root`,
    `counts`, `diagnostics` with, in addition to `file`, the absolute path `path`); `rapt build`
    adds `out` and `files`. `rapt dev` writes one JSON event per line (`building`, `changed`,
    `diagnostics`, `ready`, `failed`, `database-reset`, `server-failed`, `server-stopped`,
    `error`, `log` for the logs of the server). The text of `rapt dev` is derived from the same
    events (`formatDevEvent`).
  - **Extension**: diagnostics in the Problems tab (on each save, or from `rapt dev` when it runs
    on the project), commands *Check the BO*, *Build the application*, *Start / Stop rapt dev*,
    *Open the application*, state in the status bar, menus of the explorer and of the title bar.
    A project is the folder of `.abapgit.xml` (otherwise, the parent of `src`).
  - **Standalone extension**: the `.vsix` (~31 MB, ~9,100 files) contains `rapt/`: the packages
    of the repository (`pnpm pack`) installed by npm, flat, with their production dependencies
    and what `rapt dev` serves (OpenUI5, `less-openui5`, PGlite, at the versions of the runtime),
    without source maps, types, documentation, tests of the packages, OpenUI5 design time nor
    PGlite extensions (`scripts/stage-rapt.mjs`). A download on first start would have made the
    `.vsix` lighter, but required access to the npm registry (often filtered in companies) and
    cache code; the `.vsix` goes through VS Code, offline once installed, and rapt always has the
    version of the extension.
  - **Node.js of VS Code**: rapt runs on the executable of VS Code with `ELECTRON_RUN_AS_NODE=1`
    (Node.js 22 since VS Code 1.101, minimum version of the extension); the server of `rapt dev`
    inherits the variable. Checked with Electron 37: `check`, `dev`, PGlite, behavior pool, stop
    of the server when `rapt dev` is killed.
  - **`rapt dev` installed flat**: the `node_modules` linked in `.rapt/dev` is the first folder,
    from the runtime to the root, that contains `@abaplint/runtime` (the one of the runtime in
    the pnpm repository, the one of `rapt/` in the extension).
  - **CLI found**: `rapt.cliPath` setting, otherwise the bundled rapt, otherwise an Open RAP Runtime
    clone or a `node_modules` of the workspace, otherwise `rapt` from the PATH; Node.js from
    `rapt.nodePath`, otherwise the one of VS Code.
  - **CI**: the `test` job builds the `.vsix`, checks the fixture with the bundled rapt and
    publishes the `.vsix` as an artifact (`open-rap-runtime-vscode`).
  - **Stopping `rapt dev`**: SIGINT. On Windows, where this signal terminates the process, the
    server stops when its IPC channel with `rapt dev` closes (D38).
  - **Build**: ESM sources checked by `tsc`, delivered as one CommonJS file by esbuild
    (`dist/extension.cjs`, `vscode` external), without a runtime dependency; `.vsix` by
    `vsce package`.
- **Tests**: `vscode/test/rapt.test.ts` covers the search of the project and of the CLI, the
  reading of the JSON lines, `rapt check --json` and `rapt dev --json` really started.
  `compiler/test/cli.test.ts` and `dev.test.ts` cover the JSON output and the events. The
  interface of the extension (commands, status bar) is not tested in VS Code.

## D40 — ABAP Cloud utility classes in the behavior pool

- **Context**: after the HTTP client (D31), the behavior pools need the other commonly used
  released classes: JSON for the APIs, encodings, numbering, dates, application log, hashing,
  random numbers, regular expressions, RTTS. Without them, ordinary ABAP Cloud code does not pass
  the check.
- **Decision**: a clean-room implementation in ABAP of these classes
  (`gen/abap/framework-utils.ts`), written from the public signatures documented by SAP, with
  methods of the `ZRAP_EML` kernel for what ABAP cannot do alone (`runtime/src/abap/utils.ts`).
  Guide: [UTILITIES.md](UTILITIES.md).
  - **Closure**: only the objects named by the sources of the project, then those they name, are
    given to the transpiler. A project that uses none of them keeps the same build and the same
    check time; an object of the project with the same name wins.
  - **The kernel**: JSON (parser that keeps the numbers as written, traversal of the data of
    `@abaplint/runtime` by type, names of the members according to the mode), code pages, base64,
    gzip (zlib), hashing and HMAC (crypto), random seed, regular expressions (RegExp with `d` for
    the submatches, extended mode and POSIX classes translated), calendar and timestamps in
    tenths of a microsecond (BigInt), description of a data object for the RTTS. The RTTS are
    built in ABAP, one level at a time: `ASSIGN COMPONENT` for the structures,
    `CREATE DATA … LIKE LINE OF` for the tables.
  - **Numbering**: intervals of `rapt/number-ranges.json` (diagnostic NR001), inserted by
    `db/schema.sql` without touching the current number; table `rapt_number_range`, written in the
    LUW (the LUWs are serialized: no conflict). An interval that is not configured starts at 1, to
    develop without configuration.
  - **Application log**: tables `rapt_application_log` and `rapt_application_log_item`, in the
    LUW; read by filter.
  - **Tables**: generated only when the code uses `cl_numberrange_runtime` or `cl_bali_*`
    (`model.services`), so as not to change the schema of the other applications.
  - **Global types**: `string_table`, `xstring_table`, `match_result(_tab)`,
    `submatch_result(_tab)` as DDIC objects (TABL, TTYP), and an `ABAP` type pool
    (`abap_compdescr_tab`, `abap_component_tab`…), which the analysis of abaplint resolves.
  - **Class constructors**: they run when the modules are loaded, before the kernel; those of the
    utilities therefore do not call `ZRAP_EML` (`cl_abap_char_utilities` writes its control
    characters as literals).
- **Tests**: `runtime/test/utilities.test.ts` runs a self-test written in ABAP in a behavior pool
  (`test/utilities/selftest.abap`: more than seventy checks on all the classes, including the
  reference values of SHA-256, MD5 and HMAC), draws numbers until an interval is exhausted and
  writes then reads a log. `compiler/test/utilities.test.ts` covers the closure, the check of all
  the classes and `rapt/number-ranges.json`.

## D41 — Background processing (bgPF) and e-mail

- **Context**: `cl_bgmc_process_factory` and `cl_bcs_mail_message` are commonly used in RAP BOs
  (deferred work after the save, notifications). Both rely on the LUW: the process only starts
  and the mail only leaves after the `COMMIT WORK`.
- **Decision**: the runtime keeps, for each LUW, the work to do after its commit
  (`LuwContext.afterCommit`). A rolled-back LUW forgets it; a committed LUW starts it after the
  response (`setImmediate`), each item in a LUW of its own, serialized with the others.
  - **bgPF**: `save_for_execution` writes the process (`rapt_background_process`, `NEW`) in the
    LUW and keeps the reference of the ABAP operation. The execution calls `execute` in a LUW
    marked "background": controlled (`if_bgmc_op_single`), the EML is saved at the end and ABAP
    SQL writes after `cl_abap_tx=>save( )`; uncontrolled, ABAP SQL always writes,
    `COMMIT ENTITIES` starts the save sequence (once) and `ROLLBACK ENTITIES` rolls back the LUW.
    Outside the background, `COMMIT ENTITIES` stays refused in a behavior pool. The final state
    (`SUCCESSFUL`, `ERRONEOUS` with the text of the exception) is written in a separate LUW, to
    survive the rollback of the one of the operation.
  - **Why in memory**: SAP serializes the operation object to run it later, elsewhere.
    Serializing an object of the abaplint runtime (references, nested objects) would require a
    general mechanism; the application being a single process, the reference is enough. Limit: a
    process not run at shutdown is not resumed.
  - **E-mail**: `send( )` composes the MIME message with nodemailer (MIT-0), keeps it in
    `rapt_mail` (`WAITING`), then sends it after the commit through the server of
    `MAIL_SMTP_URL` (`SENT` / `ERROR`). Without a server, the mail stays in the table (`STORED`)
    with its complete message: development needs no server. `MAIL_FROM` gives the default sender;
    both variables are in the `.env.example` of the applications that send mails.
  - **Tables**: generated only if the code uses `cl_bgmc_process_factory` or
    `cl_bcs_mail_message` (`model.services`, D40).
- **Tests**: `runtime/test/background.test.ts`: an action starts three processes (controlled
  with EML, uncontrolled with `COMMIT ENTITIES`, failing) and checks their states and effects;
  another sends a mail (HTML, copy, text and binary attachments), kept without a server, sent to
  a test SMTP server with `MAIL_SMTP_URL`, and nothing is sent when the LUW is rolled back.

## D42 — Writing only ABAP: tables as source, `rapt abapgit`, `rapt new`, initial data

- **Context**: an abapGit export requires, for each object, an XML metadata file, and the tables
  only exist as XML (DD02V, DD09L, DD03P). Writing these files by hand discourages a developer
  who wants to write their BO in VS Code without an SAP system.
- **Decision**:
  - **Tables as source**: `name.tabl.astabl`, with the syntax of the table editor of the ABAP
    Development Tools (`define table … { key client : abap.clnt not null; … }`, annotations
    `@EndUserText.label`, `@AbapCatalog.*`, `@Semantics.amount.currencyCode` /
    `@Semantics.quantity.unitOfMeasure` for the references, `include`, `define structure`).
    `loadProject` derives the abapGit XML from it in memory: the rest of the compiler only reads
    the XML, and the diagnostics of the tables carry the line of the field in the source. The
    source wins over an XML next to it. Foreign keys (`with foreign key`) are reported (TABL002)
    and not carried over.
  - **`rapt abapgit <src>`** writes what is missing for abapGit to import the repository into an
    SAP system: `.abapgit.xml` (which ignores `*.astabl`, unknown to abapGit),
    `package.devc.xml`, the XML of the tables written as source (regenerated each time), and the
    missing XML of the CDS entities (source type derived: view, projection, abstract entity,
    custom entity…), metadata extensions, access controls, BDEF, SRVD, classes and interfaces
    (description from `@EndUserText.label` or from the ABAP Doc short text). An existing XML is
    never changed. `--check` only reports what is missing (exit code 1), for the CI.
  - **`rapt new <src> <Entity> [--prefix ZRT] [--description …]`** writes a complete managed BO,
    activatable on SAP: table as source, root view and projection, metadata extension (List
    Report and Object Page), BDEF and projection, behavior pool (global authorization, one
    determination), SRVD and SRVB OData V4, `rapt/seed.json`, `.gitignore` (`.rapt/`,
    `node_modules/`), then the XML files of `rapt abapgit`. Existing files are never overwritten.
    Command *RAP: New business object* in the extension.
  - **Initial data**: `rapt/seed.json` (table → rows, field names of the dictionary, in lower
    case, without the client) and `rapt/seed.sql`, checked at compile time (SEED001, SEED002) and
    copied into `db/` of the application. With `SEED=auto` (default of `rapt dev`), the
    application loads them on its first start, when all its tables are empty: a missing UUID key
    is drawn at random, a NUMC receives its leading zeros. Without `SEED=auto` (in production by
    default), nothing is loaded.
- **Why not a "source-less" XML**: abapGit can only serialize tables as XML; the `.astabl` source
  is what an ADT developer already reads and writes, and the conversion to XML is deterministic.
  Keeping both files in the repository (the XML regenerated by `rapt abapgit`) allows the import
  into SAP without a tool.
- **Tests**: `compiler/test/authoring.test.ts` (the source of `zrt_booking` gives the same XML
  and the same model as the fixture; positioned errors; `rapt abapgit` recreates the XML files
  removed from the fixture identically; `rapt new` produces a BO that compiles without a
  diagnostic) and `runtime/test/seed.test.ts`.

## D43 — Custom entities (unmanaged query) and managed BO on a custom entity

- **Context**: the data of a BO sometimes comes from APIs, not tables. ABAP Cloud exposes it with
  a custom entity (`define custom entity`) whose query class
  (`@ObjectModel.query.implementedBy: 'ABAP:<class>'`, interface `if_rap_query_provider`)
  provides the rows.
- **Decision**:
  - **Custom entity** (activatable on SAP): the model keeps it without an SQL view, with its
    query class, its typed elements and its associations (`_X : association … to … on …`). The
    OData reads (collection, instance, navigation, `$count`, one-level `$expand`, to or from a
    custom entity) call `select` with the request of ABAP Cloud: filter as an ABAP SQL string
    (`get_as_sql_string`) and as ranges (`get_as_ranges`, `cx_rap_query_filter_no_range` when the
    filter does not fit), sorting, paging (`get_paging`), requested elements,
    `is_total_numb_of_rec_requested`, `is_data_requested`, search. `set_data` and
    `set_total_number_of_records` give the result back to the runtime (kernel
    `zrap_eml=>query_data`, `query_total`). As in SAP, the class applies the filter, the sorting
    and the paging itself; the runtime only guarantees the keys and the navigation conditions
    (extra rows dropped) and cuts the page at `$top`. The interfaces and classes of the query are
    written from their public signatures (D24).
  - **Managed BO with unmanaged save on a custom entity** (specific to Open RAP Runtime, warning
    BDEF027): the RAP runtime reads the instances (READ ENTITIES, existence check, ETag,
    associations) through the query class, with a filter on the keys, in the current LUW;
    `save_modified` writes the changes to the API. No database lock: the LUWs of the application
    are serialized. On SAP, the same need is handled by an unmanaged BO.
- **Why**: it is the ABAP Cloud way to read an API; the managed BO on the custom entity avoids
  writing by hand the transactional buffer of an unmanaged BO, at the price of an accepted and
  reported gap.
- **Tests**: fixture `fixtures/custom-entity` (products read from an "API" simulated by a table,
  reviews as constants); `runtime/test/custom-entity.test.ts` (ranges, sorting, paging, count,
  navigation, `$expand`, refused filter, creation, duplicate, validation, change, deletion) and
  `compiler/test/custom-entity.test.ts`.

## D44 — SAP standard views (I_Currency…) and value helps

- **Context**: on SAP (ABAP Cloud as well as S/4HANA), the released CDS views `I_Currency`,
  `I_UnitOfMeasure`, `I_Country`, `I_Language` and their text views exist in every system, with
  content delivered and maintained by SAP (ISO currencies, units, countries, languages). A RAP BO
  uses them for its value helps (`@Consumption.valueHelpDefinition`) and its associations.
  Without them, a source activatable on SAP failed here (CDS005) and the value help was ignored.
- **Decision**:
  - **Standard views**: a source of the project that names one of these views without defining
    it receives it, with its text view (`_Text`, category `#TEXT`) and its tables
    (`rapt_currency`, `rapt_currencyt`, `rapt_uom`, `rapt_uomt`, `rapt_country`,
    `rapt_countryt`, `rapt_language`, `rapt_languaget`). The elements have the SAP names; the
    tables are specific to Open RAP Runtime (ABAP Cloud code does not read the SAP tables). A view
    defined by the project wins. The files are virtual (`<standard>/…`): `rapt abapgit` never
    writes them.
  - **Reference data**: ISO 4217 currencies (with their decimals), ISO 3166 countries
    (three-letter code, currency, EU membership), common units (SAP code, ISO code, dimension),
    languages (one-character SAP key, ISO code); texts in English. `db/schema.sql` inserts them
    (`ON CONFLICT DO NOTHING`): a row added or changed by the application stays. The standard
    tables do not count for "all the tables are empty" of the initial data (D42).
  - **Value helps**: as in RAP, the entity of a value help and its text view are exposed
    implicitly by the service, read-only, without a page in the UI. `$metadata` carries
    `Common.ValueList` (`CollectionPath`, `InOut` parameter, `DisplayOnly` columns). The UI opens
    a selection dialog (search on the text columns and on the descriptions) from the fields of the
    Object Page and the filters of the List Report.
- **Answer to the question "must the currencies be maintained as on BTP?"**: on BTP, the content
  of these views is delivered by SAP and is not to be entered; here it is delivered with
  Open RAP Runtime the same way. The other released views useful next: `I_Region`,
  `I_CalendarDate` (calendar), `I_Timezone`, `I_BusinessUserBasic` (users, to link to the IdP),
  `I_ExchangeRate` (exchange rates, to link to a source of rates).
- **Views added afterwards**: `I_Region` and `I_RegionText` (regions of the United States,
  Canada, Germany and Australia), `I_CalendarDate` (calendar from 1990 to 2060 computed by
  `generate_series`: year, quarter, month, ISO week, day of the week), `I_TimeZone` and
  `I_TimeZoneText` (common IANA time zones), `I_BusinessUserBasic` (a user of the IdP is recorded
  in it on each authenticated request: identifier, name, e-mail) and `I_ExchangeRate` (empty
  table `rapt_exchrate`: the rates are data of the application). A service definition that
  exposes a standard view receives it too.
- **Tests**: `compiler/test/standard.test.ts`, `runtime/test/standard-views.test.ts` (read,
  texts, read-only, value help in the browser, calendar, users).

## D45 — `standard` and `enhanced` modes

- **Decision**: `rapt/config.json` (`{ "mode": "enhanced" }`) or `--mode` chooses the mode of
  the project. `standard` (default): the sources behave as on SAP and what SAP refuses is
  refused; a project that builds in this mode imports and activates on SAP. `enhanced`: the
  extensions of Open RAP Runtime, which do not exist on SAP:
  - managed BO with unmanaged save on a custom entity (D43): error BDEF027 in `standard`,
    information in `enhanced`;
  - `field ( mandatory )` checked on save without a validation: each created or changed instance
    with an initial mandatory field fails, with one message per field (`%element`). In
    `standard`, as in RAP (D20), only `mandatory : create` is checked.
- **Why a file**: the mode is a property of the project, versioned with its sources; the CLI,
  `rapt dev` and the VS Code extension (command *Choose the project mode*) read it.
- **Tests**: `compiler/test/config.test.ts`, `runtime/test/custom-entity.test.ts`.

## D46 — `rapt generate`: one object at a time, derived from the existing objects

- **Decision**: `rapt generate <src> <type> <name> [--from X] [--for Y] [--expose A,B] [--root]`
  writes an object with the file names of abapGit, then its XML: table, view (from a table,
  elements in CamelCase, administrative annotations), projection (associations redirected by the
  same renaming: `ZC_Travel ← ZR_Travel` gives `ZC_Booking`), metadata extension, access control,
  BDEF (managed with its compositions: locks, authorizations and ETag of the children, UUID
  numbering, read-only administrative fields, mapping; or projection BDEF), behavior pool (one
  handler per entity, global authorization), abstract entity, custom entity and its query class,
  class, interface, service definition and binding. An existing file is never overwritten.
- **Why**: the creation wizards of ADT derive an object from the previous one; `rapt new` writes
  a whole BO, `rapt generate` accompanies the construction step by step.
- **VS Code**: *New RAP object…* (type, source object picked in a list, proposed name).
- **Tests**: `compiler/test/generate.test.ts` (a complete BO built command by command, without a
  diagnostic), `vscode/test/rapt.test.ts`.

## D47 — MCP server of the service

- **Decision**: `rapt mcp <src>` writes `rapt/mcp.json`, one tool per operation of the service
  (`<Set>_list`, `_get`, `_create`, `_update`, `_delete`, `_create<_Composition>`, `_<action>`),
  each with a description to complete to explain to an agent what the tool does and when to use
  it; `false` removes a tool. Running the command again keeps the written descriptions, adds the
  new tools and removes those the service no longer has. The application built with this file
  serves the tools on `/mcp` (Model Context Protocol, "Streamable HTTP" transport, JSON
  responses, without an SSE stream).
- **Execution**: each call is an OData request run by the service, for the user of the MCP
  request: authorizations, DCL, feature control, validations and messages are those of the
  OData. The errors of the BO come back as text (`isError`), the result as `structuredContent`.
- **Authentication**: bearer token (OIDC) or development user; never the session cookie of the
  browser (a web page could otherwise call the tools on behalf of the user).
- **Tests**: `compiler/test/mcp.test.ts`, `runtime/test/mcp.test.ts` (protocol, read, write with
  messages, actions, create by composition).

## D48 — Spaces and pages of the launchpad

- **Decision**: `launchpad.json` accepts `spaces` (title, roles) → `pages` → `sections` of tiles,
  like the SAP Fiori launchpad in spaces mode. A user sees the spaces of their roles as tabs, the
  pages of a space in a list; the last space is remembered (local storage of the browser); the
  search covers all the spaces. A file with `groups` only gives a space of one page. `groups` of
  the model stays the list of all the sections (intents, search).
- **Tests**: `compiler/test/launchpad.test.ts`, `runtime/test/launchpad-ui.test.ts`.

## D49 — Development launchpad and documentation application

- **Decision**: `rapt dev` serves at `/` a development launchpad: the application (with the
  number of instances of its list), the documentation of Open RAP Runtime, the `$metadata` and,
  with `rapt/mcp.json`, the MCP server. The application and the documentation show the shell bar
  there. The documentation is an OpenUI5 application (list of the pages, search, links between
  pages) whose pages are rendered from the Markdown of the repository at build time (our own
  renderer, without a dependency); it is copied next to the compiler (`packages/compiler/docs`)
  so that the packaged rapt (npm, VS Code extension) has it too. None of this is in
  `rapt build`: it is a development tool.
- **Tests**: `compiler/test/docs.test.ts`, `compiler/test/dev.test.ts`.

## D50 — Deployment outside localhost

- **Decision**: the generated application and launchpad deploy as is anywhere Node.js 22 or a
  container runs. In addition to the Dockerfile, they have a Cloud Foundry `manifest.yml` (SAP
  BTP) and a `.cfignore`. The runtime reads the environment of Cloud Foundry: `PUBLIC_URL` from
  the route (`VCAP_APPLICATION`), `DATABASE_URL` and `DATABASE_CA` from a bound PostgreSQL
  service (`VCAP_SERVICES`); a variable given explicitly wins. `DATABASE_CA` gives the
  certificate of the PostgreSQL server (verified TLS connection). `rapt dev --host 0.0.0.0` opens
  the development server to the network. Guide: [DEPLOYMENT.md](DEPLOYMENT.md).
- **Tests**: `runtime/test/platform.test.ts`, `compiler/test/app-scaffold.test.ts`.

## D51 — UI: filter bar, user variants, refresh

- **Filter bar**: the *Go*, *Clear* and *Adapt Filters* buttons are aligned with the fields. Each
  filter accepts conditions as in SAP Fiori (`=x`, `!=x`, `>x`, `>=x`, `<x`, `<=x`, `a...b`,
  `*x*`, `x*`, `*x`; a single value: "contains" for a text, "equal" otherwise), several per field
  (tokens: included values combined with OR, exclusions with AND); a string of digits (NUMC) is
  entered without its leading zeros; dates as ranges, date-times by whole days (UTC). *Adapt
  Filters* adds the columns of the list as filters. The "Filtered By" summary shows when the
  header is collapsed.
- **Variants**: `sap.m.VariantManagement` (OpenUI5): filters, visible filters, visible columns
  and sorting (*table settings*) saved per user by the service (`$variants?page=…`, table
  `rapt_ui_variant` created on first use), default variant, favorites, renaming and deletion; in
  the local storage of the browser when the service does not keep them.
- **Refresh**: the list reloads when you come back to it after a change saved on an Object Page
  (deletion, save, action); the title of the table gives the number of rows.
- **Object Page**: breadcrumbs to the list; unsaved changes are discarded (with a confirmation)
  when leaving the page, and are no longer sent with the next save.
- **Tests**: `compiler/test/ui.test.ts` (conditions), `runtime/test/ui.test.ts` (in the browser).

## D52 — `$apply`: aggregation in the OData runtime

- **Context**: the Analytical List Page and the Overview Page (D53) need totals and groups;
  Fiori Elements requests them with `$apply` (OData Data Aggregation).
- **Decision**: the runtime reads `$apply` with `filter(…)`, then a `groupby((P,…))`,
  `groupby((P,…),aggregate(…))` or `aggregate(…)` transformation; methods `sum`, `min`, `max`,
  `average`, `countdistinct` and `$count as Alias`. The SQL query is a `GROUP BY` on the view of
  the entity, with the access controls (DCL) of the user; `$orderby` on the dimensions and the
  aliases, `$top`, `$skip`, `$count`. The other transformations (`topcount`, `compute`, a
  transformation after the grouping…) answer 501.
- **Why**: it is the part of OData Data Aggregation the floorplans use; the rest requires the
  `@Aggregation` annotation transactional BOs do not have.
- **Tests**: `runtime/test/odata-apply.test.ts`.

## D53 — Floorplans: Worklist, Analytical List Page, Overview Page, Form entry

- **Context**: Fiori Elements chooses the floorplan in the descriptor of the application; the
  RAP sources say nothing about it. The floorplan is therefore a setting of the project.
- **Decision**: `ui` of `rapt/config.json`:
  `{ "floorplans": { "<EntitySet>": "listReport" | "worklist" | "analyticalListPage" | "formEntry" },
  "overview": { "title": "…", "cards": [ … ] } }`.
  - *Worklist*: list without a filter bar, one tab per qualified `@UI.selectionVariant` of the
    entity, with the number of instances of each tab;
  - *Analytical List Page*: the first `@UI.chart` of the entity (dimension, measures, `#COLUMN`,
    `#BAR`, `#LINE`, `#PIE`, `#DONUT`) above the table, read with `$apply` (D52); a value chosen
    in the chart filters the table; chart view, table view or both;
  - *Form entry*: the Object Page for creation only; after the save, a new empty form;
  - *Overview Page*: home page of cards (`kpi`: aggregate of a measure or count; `list`,
    `table`: filtered and sorted instances; `chart`: a `@UI.chart`), each card opens the list or
    the instance.
  The chart is our own OpenUI5 control in SVG (`sap.viz` only exists in SAPUI5).
- **Why**: the same annotations as Fiori Elements (`UI.chart`, `UI.selectionVariant`), without a
  proprietary library; a checked setting (CFG003) rather than a descriptor to write.
- **Tests**: `compiler/test/config.test.ts`, `compiler/test/ui.test.ts`,
  `runtime/test/ui-floorplans.test.ts` (browser).

## D54 — Draft (`with draft`)

- **Context**: draft is the standard way to edit in Fiori Elements V4; a managed RAP BO declares
  it with `with draft;` and one `draft table` per entity.
- **Decision**:
  - **BDEF**: `with draft`, `draft table`, `total etag`, `draft action Edit`, `Activate
    optimized`, `Discard`, `Resume`, `draft determine action Prepare`; an entity without a
    `draft table`: BDEF028.
  - **Database**: one draft table per entity (the elements of the entity, `DraftUUID`,
    `HasActiveEntity`, dates of the draft) and `rapt_draft_admin` (user, creation, last change);
    a `<projection>_all` view combines active instances and drafts.
  - **OData**: `IsActiveEntity` key, properties `HasActiveEntity`, `HasDraftEntity`, navigation
    `DraftAdministrativeData`, actions `Edit`, `Activate`, `Prepare`, `Resume`, `Discard`,
    `Common.DraftRoot` / `DraftNode`. A user only reads their own drafts.
  - **Runtime**: creation, change and deletion in the draft without determinations nor
    validations; `Edit` copies the instance and its compositions (one draft per instance,
    exclusive lock of 15 minutes as SAP); `Activate` replays the draft in the managed runtime in
    the LUW of the request (determinations, validations, saver), keys kept, then deletes the
    draft; an active instance that has a draft cannot be changed directly (409).
  - **UI**: Create opens a draft, each field is saved in it when leaving it, Save activates,
    Cancel and *Discard Draft* discard; the list shows the editing status.
- **Why**: the observable behavior of SAP (URLs, keys, actions, lock) so that the sources and the
  clients stay those of an SAP system.
- **Tests**: `runtime/test/draft.test.ts`, `runtime/test/ui-draft.test.ts` (browser),
  `compiler/test/ir.test.ts` (BDEF028).

## D55 — Table entities, CDS simple types and enumerated types

- **Context**: recent ABAP Cloud adds CDS table entities (`define table entity`: a table and its
  entity in one object, persistence of a RAP BO) and CDS types (`define type`, DRTY objects):
  simple types and enumerated types (`enum`). SAP does not expose enumerated types in RAP OData
  services ("Development Constraints" of RAP).
- **Decision**:
  - **CDS types** (`<name>.drty.acds`, read by Open RAP Runtime: abaplint knows the object without
    parsing it): a simple type is worth its base type (built-in type, data element or another CDS
    type), with its label; an enumerated type has a base type (`abap.int1`, `int2`, `int4`,
    `char(1..8)`, `numc(1..8)`), exactly one `initial` constant, unique constants and values
    (TYPE001 to TYPE003). A type typed by an enumerated type takes its constants. They type the
    elements of the table entities, of the abstract and custom entities.
  - **Table entity**: a table with the same name (elements in lower case; `NOT NULL` unless
    `null`; keys first; `abap.string` declared `null`, CDS019-CDS020) and a view entity on this
    table. A managed BDEF on the table entity does not write `persistent table`: the table entity
    is its persistence. Views and projections read it as an entity; the ABAP SQL of the behavior
    pool reads and writes its table.
  - **Enumerated values**: stored in the database with their base value. In the behavior pool,
    the type is given to the transpiler as a data element of its base type and each
    `type-constant` constant becomes the literal of its value (same line, same meaning).
  - **OData**: in `standard` mode, an enumerated element in an exposed entity is an error
    (CDS021), as on SAP. In `enhanced` mode, it becomes an `EnumType` of the `$metadata`: members
    named like the constants, integer value (the base value when it is an integer, the position
    otherwise), label as `Core.Description`. The JSON carries the name of the member
    (`"Status": "OPEN"`); `$filter` accepts `Status eq 'OPEN'`, `Ns.Type'OPEN'` and the integer
    value; a value outside the type is refused (400). The UI shows the labels and offers a choice
    list (OpenUI5 cannot write enumeration literals: the filter goes through `$filter`).
  - `rapt generate tableentity|type|enum`, DDLS of type `T` for `rapt abapgit`. A CDS type is an
    object in the AFF format of abapGit (SAP/abap-file-formats repository): the source
    `<name>.drty.acds` and its metadata `<name>.drty.json` (`formatVersion`, description,
    language), written by `rapt abapgit` (`.drty.asdrty` is still read).
- **Why**: the table entity is a complete BO in two files; enumerated types give named values to
  the API without changing the storage. The `standard` mode stays activatable on SAP, the
  exposure as an enumeration is an extension (D45).
- **Tests**: `compiler/test/table-entity.test.ts`, `runtime/test/table-entity.test.ts` (OData,
  ABAP, browser), fixture `fixtures/table-entity`.

## D56 — Value helps: bindings, validation, fixed values, action parameters

- **Context**: D44 gave the simple value help (`entity: { name, element }`); RAP BOs also use
  `additionalBinding`, `useForValidation` and drop-down lists.
- **Decision**:
  - `additionalBinding: [{ localElement, element, usage }]`: `#FILTER` restricts the list by the
    local value (`Common.ValueListParameterIn`), `#RESULT` copies the element of the chosen row
    into the local element (`ValueListParameterOut`), without a usage both (`InOut`);
  - `useForValidation: true`: `Common.ValueListForValidation`; the UI reports an entered value
    missing from the list (error state of the field);
  - `@ObjectModel.resultSet.sizeCategory: #XS` on the entity of the value help:
    `Common.ValueListWithFixedValues`, and a drop-down list (value and description) in the UI;
  - the action parameters (abstract entity) have their value help in the dialog, if its entity is
    exposed by the service (as in RAP, which does not add it implicitly).
- **Why**: they are the value help forms of common RAP BOs, and Fiori Elements interprets them
  from the `$metadata`.
- **Tests**: `compiler/test/table-entity.test.ts` (CSDL), `runtime/test/table-entity.test.ts`
  (drop-down list that fills the currency, validation, in the browser),
  `runtime/test/standard-views.test.ts`.

## D57 — Display annotations: criticality, texts, header, links, filters

- **Context**: the generated UI followed the structure annotations (`lineItem`,
  `identification`, `facet`…) but not the common display annotations of RAP BOs; the complete
  table is in [ANNOTATIONS.md](ANNOTATIONS.md).
- **Decision**:
  - `criticality` (line item, identification, data point): colored `ObjectStatus` or
    `ObjectNumber` (1 negative, 2 critical, 3 positive);
  - `@ObjectModel.text.element` + `@UI.textArrangement`: "Text (ID)" (default, as in Fiori
    Elements), "ID (Text)", text only, separate;
  - `@UI.dataPoint` (`UI.DataPoint`, qualified by its `qualifier` or the name of the element) and
    `@UI.facet` purpose `#HEADER` (`#DATAPOINT_REFERENCE`, `#FIELDGROUP_REFERENCE`): header of
    the Object Page, progress bar (`#PROGRESS`, `targetValue`), rating (`#RATING`), number;
  - `@UI.multiLineText`: text area; `@Semantics.email.address`, `@Semantics.telephone.type`:
    `mailto:` / `tel:` links (`Communication` vocabulary); `#WITH_URL` line item: link;
  - `@Consumption.filter.defaultValue` (initial filter, applied by the standard variant),
    `mandatory` (mandatory filter, `FilterRestrictions`), `selectionType` /
    `multipleSelections` (one value);
  - `@Consumption.hidden`: element not exposed, except a key or the element of an association.
  - Fix: `@UI.facet: […]` then `@UI: { … }` on the same element keep both (the second
    annotation replaced the first one).
- **Why**: they are the annotations the SAP examples (RAP100, Flight) use on each BO; they change
  what the user sees without changing the BO.
- **Tests**: `compiler/test/table-entity.test.ts` (CSDL), `runtime/test/table-entity.test.ts`
  (browser), fixture `fixtures/table-entity`.

## D58 — Draft UI as in Fiori Elements

- **Context**: the first draft UI (D54) edited and activated, but without the landmarks of Fiori
  Elements: the list showed the active instance even when the user had a draft, without an
  editing status filter nor a saving indicator.
- **Decision**:
  - **List Report**: *Editing Status* filter (*All*, *Own Draft*, *Locked by Another User*,
    *No Changes*); *All* shows the drafts of the user instead of their active instances
    (`IsActiveEntity eq false or HasDraftEntity eq false or
    DraftAdministrativeData/InProcessByUser ne '<user>'`, like `SiblingEntity` at SAP); *Draft*
    and *Locked by X* markers (`ObjectMarker`). The active instance points to the administrative
    data of its draft (`DraftUUID`), as at SAP.
  - **Object Page**: *Draft* marker in the header, *Locked by X* on an instance another user is
    editing, `DraftIndicator` in the footer ("Saving draft…", "Draft updated"); *Discard Draft*
    asks "Discard all changes?"; leaving the page in draft offers *Keep Draft* / *Discard Draft*
    (the draft stays in the list).
  - The current user is given to the UI by `$permissions` (`$user`).
- **Why**: a Fiori Elements user finds the same gestures; no SAP library (OpenUI5 controls
  `ObjectMarker`, `DraftIndicator`).
- **Tests**: `runtime/test/ui-draft.test.ts` (browser).

## D59 — Collaborative draft

- **Context**: `with collaborative draft;` and `draft action Share;` (ABAP Cloud) let several
  users edit the same draft; the users invited with `Share` or who join the draft change it,
  activate it or discard it.
- **Decision**:
  - BDEF: `with collaborative draft;` in the header, `draft action Share;` mandatory (BDEF029),
    `use action Share;` in the projection.
  - Database: `rapt_draft_user` (draft, user, role `O` owner / `E` editor).
  - OData: action `Share(Users: Collection(DraftAdministrativeUserInput{UserID, UserAccessRole}),
    ShareAll)`, `Common.DraftRoot/ShareAction`, entity `DraftAdministrativeUser` (navigation
    `DraftAdministrativeData/DraftAdministrativeUser`).
  - Runtime: the creator is the owner; `Edit` of an instance whose draft another user has makes
    the user join the draft (instead of 409); every user of the draft reads it, changes it,
    activates it, discards it; the others receive 409 / 404 as for an exclusive draft.
  - UI: in draft, the users (avatars) and *Invite* (`Share`); the page reads the draft again
    every 5 seconds to show the changes of the others.
- **Why**: the behavior of SAP (actions, entities, annotation) so that Fiori Elements and the
  OData clients find their way; the periodic refresh replaces the WebSockets (ABAP Channels) of
  SAP.
- **Tests**: `runtime/test/draft-collaborative.test.ts` (OData, browser, BDEF029).

## D60 — Web APIs: OData V4 - Web API binding, OAuth 2.0 (client credentials, PKCE)

- **Context**: a RAP service is also exposed as an API for other systems (*OData V4 - Web API*
  binding). The callers authenticate with OAuth 2.0: *client credentials* (machine to machine)
  or *authorization code* with PKCE (application on behalf of a user).
- **Decision**:
  - **Binding**: `BINDING_TYPE_CATEGORY` 1 of the SRVB, or `--binding-type webapi`, or
    `rapt generate binding … --binding-type webapi`. As at SAP: no `UI.*` annotation, nor value
    help, nor side effects, nor feature control (`__EntityControl`…) in the service (the checks
    are still applied by the runtime); no generated UI; a draft BO only exposes its active
    instances (direct writes, without `IsActiveEntity`).
  - **Production** (`AUTH_MODE=oidc`): the service accepts the tokens of the IdP (Keycloak, SAP
    Cloud Identity Services, Entra ID…) obtained with either flow; a *client credentials* token
    without `preferred_username` designates its client (`client_id`) as a technical user; its
    roles can come from `scope` (`OIDC_ROLES_CLAIM=scope`). The browser sessions already used the
    PKCE flow.
  - **Development**: `rapt dev` (and an application started with `AUTH_MODE=none` and
    `DEV_OAUTH=on`) serves a development authorization server under `/oauth`: OIDC discovery,
    JWKS, `/oauth/token` (`client_credentials` with `rapt-client` / `rapt-secret`,
    `authorization_code` with S256 PKCE verification), `/oauth/authorize` (page to choose the user
    and their roles); configurable clients (`DEV_OAUTH_CLIENTS`). Its tokens (RS256, key generated
    on start) give a development user.
- **Why**: test an API exactly as its clients will call it (Postman, Bruno, another system)
  without installing an IdP; in production, the IdP stays the only source of tokens.
- **Tests**: `runtime/test/web-api.test.ts` (binding, client credentials, PKCE),
  `runtime/test/auth.test.ts` (client token).

## D61 — Guided creation of the objects, floorplan, CLI / extension parity

- **Context**: ADT guides the creation of an object (*New ABAP Repository Object*: types by
  category, description, reference object); the extension only offered a series of quick picks,
  and the floorplan of the UI could only be chosen by editing `rapt/config.json`.
- **Decision**:
  - **Catalog**: `authoring/catalog.ts` describes each object type (category, label,
    description, files, length of the name, fields: source object, exposed entities, binding type,
    built-in type); `rapt generate <src> --json` without a type returns it. The extension builds
    its wizard from it: the CLI stays the only source.
  - **Wizard** (*New RAP object* webview): filter, types by category, form of the type (the
    objects of the project offered as source), *Create* runs `rapt generate` (or `rapt new` for a
    complete BO) and opens the file. New types: data element and domain (`--type`).
  - ***RAP Objects* view**: the objects of the project grouped like the project explorer of ADT.
  - **Floorplan**: `rapt floorplan <src> [<EntitySet> <floorplan>]` reads and writes
    `ui.floorplans` of `rapt/config.json`; the VS Code command describes each floorplan (use,
    required annotations).
  - **Parity**: each command of the CLI has its VS Code command (`check`, `ir`, `build`,
    `launchpad`, `dev`, `new`, `abapgit`, `mcp`, `generate`, `floorplan`).
- **Why**: an ABAP developer finds the gestures of ADT; the choice of the floorplan becomes
  explicit and documented at the moment it is made.
- **Tests**: `vscode/test/rapt.test.ts` (catalog, arguments of the wizard, `rapt floorplan`,
  groups), wizard checked in Chromium.

## D62 — Website of the project and download of the extension

- **Decision**: `site/` (static HTML and CSS, without a dependency nor a build tool) presents the
  project; the `site.yml` workflow publishes it on GitHub Pages with the screenshots of
  `docs/images` and the `.vsix` built from the same commit (*Download* button). The tagged
  versions are still published by `release.yml` (GitHub Release, Marketplace and Open VSX when
  their tokens are configured). To enable once: *Settings → Pages → Source: GitHub Actions*.
- **Why**: one address to share, always up to date, without a server to maintain.
- **Tests**: rendering checked in Chromium (desktop, mobile without horizontal scrolling, dark
  mode).

## D63 — English everywhere; documentation pages on the website

- **Context**: the project was documented in French, and the website linked to pages of the
  GitHub repository, which is private: visitors could not read the guide.
- **Decision**:
  - **English**: documentation, website, VS Code extension (commands, wizard, settings), object
    and floorplan catalog, messages and comments are in English (AGENTS.md rule 8). The documents
    with French names were renamed (`DEPLOYMENT.md`, `UTILITIES.md`, `REMOTE_APIS.md`).
  - **Documentation on the website**: `scripts/build-site.mjs` renders each Markdown document of
    the documentation app (same list and order as `rapt dev`, D49) into a static page
    `docs/<name>.html` of the website, with the Markdown renderer of the compiler, a navigation
    between the pages and the style of the website. Links between documents point to the rendered
    pages; links to files of the repository that are not published (sources, fixtures) are shown
    as plain text. The `site.yml` workflow runs the script after `pnpm build`. The website no
    longer links to GitHub.
- **Why**: a private repository cannot be the documentation of a public website; rendering from
  the same Markdown keeps a single source, already shown in `rapt dev`.
- **Tests**: `compiler/test/docs.test.ts` (rendering of the links for the website), website
  checked in Chromium (pages, navigation, mobile, dark mode).

## D64 — rapt for AI coding agents: `rapt agent`, `rapt` in the terminals of VS Code

- **Context**: AI agents (GitHub Copilot in agent mode, Claude Code, Cursor…) write more and more
  of the RAP sources. With a shell, they can run `rapt check --json`; but in VS Code `rapt` was
  only inside the extension (not on the PATH), and the documentation of Open RAP Runtime (codes,
  annotations, known gaps and their workarounds) is not in the project of the user, so an agent
  could not find it. Also, the `.vsix` lost this documentation: the staging of the extension
  removed the `docs` folders and the `.md` files of the packages, and the documentation app of
  `rapt dev` was empty when started from the extension.
- **Decision**:
  - **`rapt agent [<workspace>]`**: an MCP server over stdio (newline-delimited JSON-RPC) with the
    tools `rapt_projects`, `rapt_check` (diagnostics, without writing), `rapt_object_types` (the
    catalog of D61), `rapt_generate`, `rapt_new_business_object`, `rapt_floorplan`,
    `rapt_abapgit`, `rapt_docs_search` (sections of the documentation by relevance) and
    `rapt_docs_read` (a page or a section, as Markdown), and instructions given on
    `initialize` (check after each change, standard mode, read the documentation). The paths are
    relative to the workspace; a path outside it is refused. The project is given, or the only
    one of the workspace. Distinct from `rapt mcp` (D47), the MCP server of a *service*.
  - **VS Code**: the extension registers `rapt agent` for the agent mode of VS Code
    (`vscode.lm.registerMcpServerDefinitionProvider`, contribution `mcpServerDefinitionProviders`,
    one server per workspace folder, setting `rapt.agent.enabled`); and it puts `rapt` on the
    PATH of its integrated terminals (`environmentVariableCollection`): shims `rapt` (sh) and
    `rapt.cmd` (Windows) in the storage of the extension start the CLI the extension uses, with
    the Node.js of VS Code (setting `rapt.terminal.addToPath`). An agent of the terminal (Claude
    Code) then runs `rapt` or `claude mcp add rapt -- rapt agent .` without installing anything.
  - **Documentation in the `.vsix`**: the staging keeps `@open-rap/compiler/docs` and fails
    when it is missing; the documentation app shows "Documentation not found" instead of an empty
    list if the documentation is ever missing.
- **Why an MCP server and not only the CLI**: the CLI with `--json` and the AGENTS.md of the
  project are enough for an agent with a shell; the MCP server adds what the CLI does not give:
  discovery without configuration in VS Code, typed inputs (the catalog of the objects as enums),
  and the documentation of Open RAP Runtime, searchable, wherever the extension or the npm package
  is installed. It reuses the functions of the CLI: one engine (D39).
- **Tests**: `compiler/test/agent.test.ts` (protocol, business object created, checked, object
  generated, floorplan, abapGit, paths outside the workspace, several projects, documentation,
  stdio of the built CLI), `vscode/test/rapt.test.ts` (shims run `rapt check` through the PATH,
  server definitions), `compiler/test/docs.test.ts` (empty documentation); `.vsix` built and its
  `rapt dev` checked to serve the 14 documentation pages.

## D65 — npm package `open-rap-runtime`

- **Context**: outside VS Code (CI pipelines, a terminal agent, another editor), rapt needed a
  clone of the repository.
- **Decision**: the package `open-rap-runtime` (`packages/cli`) gives the `rapt` command
  (`npm install -g open-rap-runtime`, `npx open-rap-runtime check .`, or a `devDependency` of the
  project and `npx rapt …`). It depends on `@open-rap/compiler` and
  `@open-rap/runtime` and on what `rapt dev` serves (OpenUI5, PGlite, less-openui5, at the
  versions of the runtime, checked by a test), like the `rapt/` of the extension (D39). Its
  `dist/rapt.js` calls `main` of `@open-rap/compiler/cli` (new export); `cli.js` runs
  itself only when it is the program (`isEntryPoint`: real paths compared, symbolic links and
  Windows paths included), so the command runs once. The compiler no longer declares a `bin`:
  one package gives `rapt`. `COMPILER_VERSION` is read from the `package.json` of the compiler.
  Each package has a README for npm; `@open-rap/model`, `compiler` and `runtime` are also
  usable as libraries.
- **Release**: the `npm` job of `release.yml` sets the version of the tag on the four packages,
  builds them, packs them (`pnpm pack`), installs the archives with npm in an empty folder and
  runs `rapt --help`, `rapt check` and `rapt build` of the fixture; then, when the secret
  `NPM_TOKEN` is set, publishes them (`workspace:*` becomes the version of the tag). npm
  provenance is added when the repository is public. Once: create the `open-rap-runtime`
  organization on npmjs.com and the `NPM_TOKEN` secret ([DEPLOYMENT.md](DEPLOYMENT.md)). The name
  `rapt` is taken on npm, hence `open-rap-runtime`.
- **Why**: the same CLI everywhere; CI can check RAP sources without VS Code; a terminal agent
  can install it in one command.
- **Note**: publishing makes the compiled code public on npm, as the `.vsix` of the website
  already does.
- **Tests**: `cli/test/package.test.ts` (dependencies, a single run), `cli/test/cli.test.ts`
  (`rapt check`, `rapt agent` in the help), `compiler/test/cli.test.ts` (`isEntryPoint`); the four
  packages packed and installed with npm in an empty folder: `rapt check`, `rapt dev` (UI,
  OpenUI5, OData, documentation) work; `pnpm publish --dry-run`.

## D66 — Menus of the extension: two ways to create, greyed-out commands, required floorplan

- **Context**: the right click of the explorer showed three creation entries (*New business
  object*, *New RAP object (wizard)…*, *New RAP object… (table, view…)*), all the commands were
  active even outside a project, and the application was generated as a List Report without the
  floorplan having been chosen.
- **Decision**:
  - **Create**: two entries. *New complete business object…* (`rapt new`, possible in an empty
    folder) builds the whole BO; *New RAP object…* (the wizard, D61) creates object by object.
    The quick picks of D46 (`rapt.generate`) stay a command, outside the menus and the palette.
  - **Groups** of the menu: create, project (check, abapGit), application (floorplan, rapt dev,
    build); the *RAP Objects* view offers the same on a project, and a *New complete business
    object* button when the workspace has no project.
  - **Greyed out**: the extension computes the folders of the projects (`rapt.projects`) and
    those of the projects that have a service definition (`rapt.apps`) from the sources of the
    workspace, updated when a file is created or deleted. The commands have an `enablement`:
    `resourcePath in rapt.projects` (or `rapt.apps`) in the explorer, a project (or a service) in
    the workspace elsewhere; *Stop* and *Open the application* when rapt dev runs.
  - **Required floorplan**: *Build the application…* and *Start rapt dev* ask for the floorplan
    of each root entity set that has none; cancelling writes nothing and builds nothing.
    `rapt floorplan --json` gives `chosen` per entity set, and `rapt floorplan . Set listReport`
    writes the List Report in `rapt/config.json` (instead of removing it) to keep the choice. The
    CLI keeps the List Report as the default.
- **Why**: one way to do each gesture, an impossible command is not offered, and the floorplan is
  a design choice of the application, not a default one suffers.
- **Tests**: `vscode/test/rapt.test.ts` (folders of the projects and of the applications,
  `chosen`, List Report kept).

## D67 — Expressions in the elements of the CDS views

- **Context**: a calculated element of the select list (`CASE`, `CAST`, calculation, function,
  literal) was refused (CDS002), while RAP views often have some (status text, total amount,
  duration).
- **Decision**: the adapter turns the expression parsed by abaplint into a tree; the IR resolves
  and types it (`FieldModel.expression` instead of `column`); the SQL generator translates it to
  PostgreSQL in the view (`CAST(… AS type)` around the result, for a stable column type).
  - **Supported**: literals (string, integer, decimal, `abap.xxx'…'`), columns of the source,
    `$projection.Element`, `+ - * /` and parentheses, simple and searched `CASE`
    (`= <> < > <= >=`, `[NOT] LIKE`, `IS [NOT] NULL`, `AND`, `OR`, `NOT`), `CAST( x AS abap.xxx )`
    or to a data element, functions `concat`, `concat_with_space`, `substring`, `upper`, `lower`,
    `length`, `left`, `right`, `ltrim`, `rtrim`, `replace`, `coalesce`, `div`, `division`, `mod`,
    `abs`, `round`, `ceil`, `floor`, `dats_days_between`, `dats_add_days`, and
    `$session.system_date` (`current_date`). A projection takes the calculated elements of its
    view and accepts expressions itself on the elements of the projected entity.
  - **Typing**: the explicit `CAST` wins; otherwise, calculation on numbers (integers: the
    largest; decimals: precision and scale combined, 31 digits at most; `/`: `decfloat34`),
    string for `concat` (lengths added), common type of the branches of a `CASE`. When the type
    cannot be derived (`NULL` alone, `+` on a string), CDS022 asks for a `CAST`.
  - **ABAP semantics**: `CHAR` strings lose their trailing blanks in `concat` and `length`; `div`
    is an integer division, `division( a, b, d )` rounds to `d` decimals; `/` gives a decimal (no
    integer division of PostgreSQL).
  - **Read-only**: a calculated element cannot be a key (CDS022); it is neither in the mapping of
    the BDEF, nor in the draft table, nor in the writes. In OData, it is `Core.Computed` and
    ignored in the body of the requests (OData convention of computed properties).
  - **Drafts**: the draft view computes the expression on the values of the draft; a column of
    the source that the entity does not expose is `NULL` there. In the behavior pool (EML), the
    value read is the one of the active view: it reflects the last save, not the current changes
    of the transaction; a draft instance has the initial value there.
  - **Still CDS002** (message naming the construct): `$session.user`, `$session.client`,
    `$session.system_language` (the SQL views do not have the session of the request),
    association paths (`_Assoc.field`), associations in an expression, `BETWEEN`, aggregates, SQL
    functions not listed, parameters and path filters. Joins and `WHERE` unchanged.
- **Why**: PostgreSQL computes on read, like the HANA database: `$filter` and `$orderby` on a
  calculated element work without code at runtime, and the value stays consistent with the data.
- **Tests**: tree of the adapter, inferred types and diagnostics (CDS002, CDS004, CDS022), schema
  applied on PGlite and values read in the view and the projection, `$metadata`
  (`Core.Computed`), OData read, `PATCH` ignored and values computed on a draft then after
  activation.

## D68 — Filter value help: *Search and Select* and *Define Conditions*

- **Context**: the filter fields of the List Report (and of the ALP) accepted typed conditions
  (D51) and opened, for a field with a value help, a list of values (D44); the dialog of SAP
  Fiori elements where conditions are composed (operator, values, exclusions) next to the
  selection in the value help was missing. The dialog of `sap.ui.comp` / `sap.ui.mdc` is SAPUI5
  only.
- **Decision**:
  - the icon of each token filter field (all but booleans and enumerated types, which stay choice
    lists) opens a dialog built with `sap.m` (`controller/conditions.js`): a *Search and Select*
    tab (when the field has a value help: search, table with multiple or single selection,
    descriptions of the text view), a *Define Conditions* tab (one row per condition: operator,
    value(s), value help on the value, *Add*), and at the bottom the *Selected Items and
    Conditions* tokens;
  - operators as in Fiori elements: *equal to*, *contains*, *starts with*, *ends with*,
    *between*, *less than*, *less than or equal to*, *greater than*, *greater than or equal to*,
    *empty*, and their exclusions (*not equal to*, *does not contain*, *not between*, *not
    empty*…), filtered by type: text all of them, numbers and NUMC comparisons, dates and times
    comparisons and *empty* (date / time picker), UUID equal / not equal;
  - `$filter`: included conditions of a field with `or`, exclusions with `and not`, fields with
    `and`; *empty* of a text = `''` or `null`; date-time by whole days (UTC);
  - tokens written as in Fiori elements: value alone (with its description: "Euro (EUR)"),
    `!(=x)`, `*x*`, `a...b`, `<empty>`, `!(…)`; the key of the token is the condition (`=x`,
    `!(*x*)`) read again for the search and kept in the variants (earlier variants are still
    read, including the date ranges `{ from, to }`);
  - direct input: `!(…)`, `<empty>` and `a - b` (dates) in addition to D51; a single value is
    *contains* for a free text, *equal to* for a key or a field with a value help; dates are
    entered in the format of the language or in ISO;
  - `@Consumption.filter.selectionType` (`AllowedExpressions` already in the CSDL, D57):
    `#SINGLE` equal only, `#INTERVAL` comparisons and ranges (without patterns), a single
    condition when `multipleSelections: false` (without exclusions for `SingleRange`).
- **Why**: it is the "match code" of the Fiori elements filters; keeping the selection in the
  value help and the conditions in the same dialog avoids two different gestures for one field.
- **Limits**: no relative date operators (*today*, *last week*…); booleans and enumerated types
  keep their choice list; a value entered without a value help is shown without a description.
- **Tests**: `compiler/test/ui.test.ts` (reading and writing of the conditions, operators by type
  and `selectionType`, `$filter`), `runtime/test/table-entity.test.ts` (dialog in Chromium:
  selection in the value help, exclusion, typed conditions, filtered rows).

## D69 — One launchpad per workspace, applications added when they are created

- **Context**: `launchpad.json` was written by hand (D37) and only referenced applications
  already built (`build`). In a workspace of several applications (`rap-apps/helpdesk-tickets`,
  `rap-apps/project-tracker`…), you had to write it, build each application then the launchpad,
  and nothing said that only one was needed.
- **Decision**:
  - **One launchpad per workspace**, titled "Launchpad". The CLI looks for `launchpad.json` in
    the folder of the project then its parents (4 levels, stopping after a folder that contains
    `.git`, never in the root of the disk, the home folder or the temporary folder); without it,
    it creates it in the **parent folder of the project** (the workspace), or in the project when
    it is the root of a git repository or when its parent is one of these system folders.
    `--launchpad <file>` designates another file. The extension always passes `--launchpad`: next
    to the saved `.code-workspace`, otherwise in the **first folder** of the workspace — a single
    launchpad, even for a multi-root workspace.
  - **Added on creation**: `rapt new` (complete BO) and `rapt floorplan <src> <Set> <floorplan>`
    (choosing the floorplan creates the Fiori application) add the application; `--no-launchpad`
    refrains from it; `rapt launchpad add <src>` adds it on demand (`--json`). The `apps` entry
    references the **sources** (`"source": "helpdesk-tickets"`, relative to the launchpad.json),
    its `id` comes from the name of the folder, its `url` (local start) takes the first free port
    from 8081. The tile goes into the "Applications" group (or the "Applications" section of the
    first page of the first space): title of the application, intent `<EntitySet>-manage`
    (`process` for a Worklist, `analyze` for an Analytical List Page, `create` for a Form Entry),
    icon and counter of the starting entity set. **Idempotent**: an application already present
    (same sources, or same id without sources) is not changed, nothing the user wrote is
    rewritten; an unreadable file is not overwritten.
  - **Build**: `rapt launchpad launchpad.json --out out/launchpad` also builds each application
    referenced by `source` in `out/launchpad/apps/<id>`; `docker-compose.yml` builds them from
    this folder (one PostgreSQL each) and the image of the launchpad ignores it. `source` and
    `build` together are refused (LPD009); `build` stays possible for an application built
    separately.
  - **Two deployment modes**: the **launchpad with all its applications** (`rapt launchpad`), or
    **one application alone** (`rapt build`), which does not depend on the launchpad: its shell
    bar only shows if `/launchpad/config` answers. The extension asks for the mode in *Build the
    application…* ("Launchpad (all the applications)" / "Application alone (standalone)");
    *Build the launchpad…* builds the one of the workspace (`rapt.hasLaunchpad`). `rapt dev` keeps
    its development launchpad (D49).
- **Why**: the user creates applications, not configuration files; a single entry point per
  workspace, like the Fiori Launchpad of a system, and the choice of shipping one application
  alone stays open.
- **Tests**: `compiler/test/launchpad.test.ts` (creation titled "Launchpad", idempotent addition
  without rewriting a changed tile, two projects of one folder in the same launchpad, `rapt new`,
  `--no-launchpad`, `--launchpad`, build of the applications with the launchpad, LPD009);
  `vscode/test/rapt.test.ts` (file of the workspace, `rapt floorplan` and `rapt launchpad add` in
  JSON).

## D70 — Name: Open RAP Runtime

- **Context**: "rap-transpiler" described one step of the tool (abaplint transpiles the ABAP);
  the project is a runtime for RAP business objects outside SAP (OData V4, RAP managed runtime,
  UI, launchpad, MCP), with a compiler and a VS Code extension around it.
- **Decision**: the project is named **Open RAP Runtime**. The npm package of the command line is
  `open-rap-runtime`, the libraries `@open-rap/model`, `@open-rap/compiler`, `@open-rap/runtime`
  (npm organization `open-rap`), the VS Code extension `open-rap-runtime-vscode` ("Open RAP
  Runtime"). Unchanged, so that existing projects keep working: the `rapt` command, the `rapt/`
  folder of the projects, the `.rapt/` build folder, the `rapt_*` tables, the `ZRAP_*` ABAP
  objects. The URL of the website follows the name of the GitHub repository
  (`RAP-Transpiler`) until it is renamed.
- **Why**: "Open" says open source and without proprietary SAP libraries; "RAP Runtime" says
  what the application runs. The website states that the project is not affiliated with SAP SE.
- **Tests**: the whole suite (package names, generated applications with `vendor/open-rap-*`,
  extension), the `.vsix` built and its `rapt dev` checked.
