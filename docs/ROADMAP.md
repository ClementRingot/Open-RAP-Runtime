# Roadmap

What is planned, with the design elements already known. The available features are in
[FEATURES.md](FEATURES.md), the accepted gaps in [KNOWN_GAPS.md](../KNOWN_GAPS.md), the decisions
taken in [DECISIONS.md](DECISIONS.md).

## Goal: fidelity to the SAP BTP ABAP environment

Open RAP Runtime must behave like the ABAP environment of SAP BTP:

- the code written in `standard` mode activates as is on SAP;
- what SAP BTP refuses, the `standard` mode refuses too;
- the experience is faithful to RAP and SAP Fiori elements.

Two rules frame the work below:

- **Measure before building.** The protocol cases of phase 0 turn each Fiori elements gap into
  failing tests; the round trip to an SAP BTP trial is then the oracle of every other decision.
- **No SAPUI5, anywhere.** SAPUI5 (`sap.fe`, `sap.ovp`, `sap.ushell`) is licensed by SAP under
  the SAP Developer License: the project does not load it, not in the repository, not in the
  published packages, not in the CI, not from the CDN. Compatibility with SAP Fiori elements is
  shown by OData protocol tests written by the project; running the real `sap.fe` against
  Open RAP Runtime is done by each user, locally, under their own license, and its results are
  not published. Only a written agreement of SAP would change this rule.

## Phases

| Phase | Decisions | Why in this order |
|---|---|---|
| **0. Measure** | Fiori elements protocol conformance · round trip to SAP BTP · conformance metrics in the CI · abaplint gaps fixed in our layers | Makes the Fiori elements gaps measurable, at a moderate cost and without risk for the existing code. The gaps of abaplint are fixed early, in the rewriting pass and the kernel. |
| **1. Transactional Fiori elements** | Complete draft protocol (`SiblingEntity` first) · nested `$expand`, `any`/`all`, JSON batch · applied side effects | `SiblingEntity` blocks the draft List Report of Fiori elements, the rest of the draft blocks the Object Page. The order follows the failing protocol cases. |
| **2. Fiori elements generation and analytics** | Generation of Fiori elements applications · ALP and OVP driven by annotations · extended `$apply` | Fiori elements applications are generated once they work. The analytical list page needs `Aggregation.ApplySupported`. |
| **3. ABAP test foundation** | ABAP Unit · catchable SQL errors | ABAP Unit is a tool and an oracle: the same tests run on the trial and here. Catchable SQL errors are small and unlock negative tests. |
| **4. CDS and RAP fidelity** | CDS views · currencies and conversion exits · late numbering · complete EML · events, change documents, extensions, attachments · exact decimals | The core of RAP, in the order of frequency of use in real RAP code. |
| **5. Standard layer** | Repository of the released objects · extended and multilingual standard views | The repository makes the refusal exact and feeds the standard views, so that only views released on SAP BTP are provided. |
| **6. Tools** | ABAP debugging · data preview, SQL trace, runtime errors · ATC-like checks and clean-up | The SQL trace and the runtime errors reuse the source maps of the debugger. |
| **7. Complements** | Real-time collaborative draft · OData V2 | The collaborative draft depends on the public documentation of its protocol; OData V2 has the lowest priority. |

The repository of the released objects has no technical dependency: it can move forward in
parallel with phase 1.

## Planned decisions

The numbers are provisional: each decision takes the next free number of
[DECISIONS.md](DECISIONS.md) when its pull request is opened, and the table below is updated.
The sections below use the provisional numbers, unless they say "final".

| Provisional | Final | Decision | Phase |
|---|---|---|---|
| D79 | D79 | Fiori elements OData protocol conformance, without SAPUI5 | 0 |
| D80 | — | Generation of Fiori elements applications, next to the OpenUI5 UI | 2 |
| D81 | D81 | Complete draft protocol (a: `SiblingEntity`; b: logic of the BO on the draft; c: state messages) | 1 |
| D82 | — | Applied side effects and `determine action` | 1 |
| D83 | D82 (part of a) | OData complements: (a) nested `$expand` and `any`/`all` (final D82), JSON batch, `$value`; (b) extended `$apply` | 1, 2 |
| D84 | — | ALP and OVP driven by CDS annotations | 2 |
| D85 | — | OData V2 at the Gateway URL | 7 |
| D86 | — | CDS: joins, WHERE, paths, parameters, unions, hierarchies, `$session`, aggregates | 4 |
| D87 | — | Late numbering | 4 |
| D88 | — | Complete EML | 4 |
| D89 | — | Business events, change documents, extensions, attachments | 4 |
| D90 | — | Exact decimal numbers and `TIMESTAMPL` | 4 |
| D91 | — | Catchable SQL errors in ABAP | 3 |
| D92 | — | Conversion exits, currency decimals and currency conversion | 4 |
| D93 | — | Real-time collaborative draft | 7 |
| D94 | — | Objects not in the project: APIs of SAP (released, not provided, deprecated, not released), namespaces and other repositories, sources of dependencies | 5 |
| D95 | — | Extended and multilingual standard layer | 5 |
| D96 | — | ABAP Unit: `rapt test` and VS Code | 3 |
| D97 | — | ABAP debugging in VS Code | 6 |
| D98 | — | Data preview, SQL trace, runtime errors | 6 |
| — | D83 | Guided recording of the Fiori elements protocol on the SAP BTP trial, renamed copy for a shared system | 0 |
| — | D85 | First pull and activation on the SAP BTP trial: abapGit XML of DDLX and SRVB, `total etag`, authorizations | 0 |
| — | D86 | `use side effects`, value help and side effects of the draft fixture | 0 |
| — | D93 | The identifiers of the interfaces of SAP (`SAP__Messages`, `sap-messages`, `com.sap.vocabularies.*`…) are kept | 0 |
| — | D92 | The `$metadata` closer to SAP BTP: `OnDelete`, nullability, `Prepare` and `Resume` without result, controls and draft fields hidden, side effects `SAP__Field_*`, actions with their binding, draft nodes, administrative fields | 0 |
| — | D91 | `fixtures/negative`: sources SAP BTP must refuse, on the trial and in `rapt check`; system fields and function modules refused | 0 |
| — | D89 | `__CreateByAssociationControl`, `Edit` under operation control, advertised actions, as on SAP BTP | 0 |
| — | D88 | `Prefer` and `Preference-Applied`, the `ETag` of a `204`, `201` and `Location` of `Edit` and `Activate`, `204` of `Prepare`, as on SAP BTP | 0 |
| — | D87 | The administrative data of the drafts as on SAP BTP: `I_DraftAdministrativeData`, `DraftEntityCreationDateTime`, `DraftEntityLastChangeDateTime` | 0 |
| D99 | D84 (part a), D90 (part b) | Round-trip protocol to an SAP BTP ABAP trial (a: the repository for the trial, final D84; b: the comparison of the `$metadata`, final D90) | 0 |
| D100 | — | Conformance metrics in the CI | 0 |
| D101 | — | ATC-like quality checks and clean-up | 6 |
| D102 | D80 | abaplint gaps fixed in our layers, without upstream issue | 0 |

## Phase 0: measure

- **Fiori elements protocol conformance (D79).** Requests recorded in HAR files of the
  Fiori elements preview on an SAP BTP trial (SAP backend, SAPUI5 under the license of SAP) are
  turned, locally and outside the repository, into protocol test cases written by the project
  (`packages/runtime/test/fe-protocol/`): only the shape of the requests (method, path, system
  query options, OData headers, batch structure), re-expressed on the fixtures of the project.
  The responses are compared on their structure (properties, control annotations, status codes,
  `sap-messages`), never on SAP content. Each case is green, or marked as failing with the
  decision that will fix it. `rapt dev --fe-check` tells a user where to point their own
  Fiori elements application, locally.
- **Round trip to SAP BTP (D99).** `scripts/btp-roundtrip.mjs` writes, for each fixture and each
  `standard` variant, an abapGit repository and the expected outcome (activation or refusal);
  `fixtures/negative/` holds sources SAP must refuse. The results of SAP (activation messages,
  `$metadata`, responses, ABAP Unit results, export of the released objects) go to
  `conformance/btp/<release>/`; `rapt conformance compare` confronts them with Open RAP Runtime.
- **Conformance metrics (D100).** `pnpm conformance` writes `conformance/report.json`: verdicts
  identical to SAP BTP, normalized `$metadata` difference, green protocol cases, identical
  ABAP Unit results, number of known gaps per section. The CI fails when an indicator goes back
  compared to `main`; the website publishes the report and its history.
- **abaplint gaps (provisional D102, final D80).** Each gap of the transpiler and runtime listed in KNOWN_GAPS.md was
  checked again on the latest versions (2.14.33) and fixed in our layers when possible: exact
  classic SQL writes and `DELETE dbtab FROM @wa` by the kernel, typed aggregates, `SELECT …
  ENDSELECT` with a field list, `int8` loop bounds, enumerated objects as text. No upstream issue
  (decision of the maintainer); the packed arithmetic of the runtime stays a known gap.

## Phase 1: transactional Fiori elements

- **Complete draft (D81).** The draft becomes a second persistence of the same managed runtime:
  the buffer is keyed by `%tky`, and operations, determinations, validations, actions and EML go
  through it. `SiblingEntity` (to-one navigation to the instance with the same key and the
  opposite `IsActiveEntity`) replaces the workaround of D58. `on modify` determinations run on
  each change of the draft; `Prepare` runs exactly what `draft determine action Prepare` lists;
  `Activate` runs `Prepare` then the save sequence. State messages are stored per `%state_area`
  and exposed through `SAP__Messages` and `Common.Messages`. Actions run on a draft instance.
- **OData complements (D83a).** Nested `$expand` (one query per level, no N+1, configurable
  maximum depth), `any`/`all` as `EXISTS` subqueries with the DCL of the target applied, JSON
  batch (OData 4.01, `atomicityGroup` as a LUW), `$value`.
- **Side effects (D82).** `determine action`, and side effects that trigger it
  (`Common.SideEffects` with `TriggerAction`); the OpenUI5 UI calls `requestSideEffects` on the
  declared targets instead of reading the whole object again.

## Phase 2: Fiori elements generation and analytics

- **Fiori elements applications (D80).** `"ui": { "kind": "openui5" | "fiori-elements" }` in
  `rapt/config.json` (default `openui5`), also offered by `rapt floorplan --kind`, the VS Code
  command and `rapt agent`. In `fiori-elements` mode, our generator writes a `webapp/` folder
  (manifest, component, i18n, `index.html`, `ui5.yaml`) with a relative bootstrap and no CDN URL:
  SAPUI5 is provided by the SAP platform where the application is deployed, under the license
  of the customer. `rapt dev` neither serves SAPUI5 nor runs this application. The OpenUI5 UI
  stays the default.
- **ALP and OVP (D84).** All the qualified `@UI.chart`, `@UI.presentationVariant` and
  `@UI.selectionPresentationVariant`; visual filters; `@Aggregation.default` gives
  `Aggregation.ApplySupported`. The content of the OVP cards comes from qualified annotations;
  `rapt/config.json` keeps only what SAP puts in the manifest.
- **Extended `$apply` (D83b).** The pipeline compiled to a chain of CTEs: `compute`,
  `topcount`/`bottomcount`, `concat`, transformations after `groupby`; hierarchy functions with
  the CDS hierarchies.

## Phase 3: ABAP test foundation

- **ABAP Unit (D96).** The test classes are transpiled; clean-room `cl_abap_unit_assert`, SQL and
  CDS test doubles (temporary PostgreSQL schema), RAP BO test doubles, after checking that each
  class is released for SAP BTP. `rapt test [--json]` on a fresh database, a Test Explorer in
  VS Code and a `rapt agent` tool.
- **Catchable SQL errors (D91).** Our database adapter turns a PostgreSQL error into a
  `CX_SY_OPEN_SQL_DB` exception, catchable in ABAP; the savepoint keeps the LUW usable.

## Phase 4: CDS and RAP fidelity

- **CDS (D86)**, one pull request per item: `$session.user`, `system_language`, `client`; to-one
  association paths; WHERE and explicit joins; aggregates and `GROUP BY` (non-transactional
  view); unions; parameters; hierarchies. Everything stays compiled to PostgreSQL views.
- **Currencies and conversion exits (D92).** Conversion exits allowed in ABAP Cloud (`ALPHA`,
  `ISOLA`, `CUNIT`), applied in the OData layer and `/ui2/cl_json`; shift of the currency
  decimals in OData (as with TCURX); `CURRENCY_CONVERSION` in CDS on the exchange rates.
- **Late numbering (D87).** `adjust_numbers` in the save sequence, provisional keys rewritten in
  the buffer, final keys returned after the commit, `CONVERT KEY`.
- **Complete EML (D88).** `MODIFY ENTITIES OPERATIONS`, `GET PERMISSIONS`, `SET LOCKS`, EML on a
  projection BDEF, `AUGMENTING` and `RELATING TO`.
- **Events, change documents, extensions, attachments (D89).** `RAISE ENTITY EVENT` published
  after the commit, local event handlers; change documents written by the managed runtime;
  `extensible` and extensions merged in the IR; `Edm.Stream` attachments with `$value`.
- **Exact decimals (D90).** The classic SQL writes from a work area or a table are exact (final D80);
  `UPDATE … SET` and the packed arithmetic of the abaplint runtime (JavaScript numbers) are left:
  an exact arithmetic would need a decimal operand rewriting of every expression, to weigh. The
  seventh decimal of `TIMESTAMPL` stays lost.

## Phase 5: standard layer

- **Objects that are not in the project (D94).** Today an object the project uses and Open RAP
  Runtime does not have stops the build (the transpiler runs with `unknownTypes: compileError`,
  and abaplint reports "contains unknown", or CDS005): the application is not generated, whatever
  the object. The Cloudification Repository of SAP (Apache-2.0, read with the loader of ROSA)
  only lists the APIs of SAP: content under a namespace such as the Flight reference scenario
  (`/DMO/I_Agency` is not in the SAP BTP set, although the trial has it) or the objects of other
  software components of a customer are not there. So the check tells apart three families, from
  a versioned snapshot of the SAP BTP set, offline:
  - **An object of SAP** (no customer namespace, not Z or Y: `I_*`, `CL_*`, `IF_*`, SAP tables):
    - released and provided by Open RAP Runtime: nothing to report;
    - released on SAP BTP but not provided by Open RAP Runtime: valid on SAP, so not refused in
      `standard` mode: a warning ("released on SAP, not provided by Open RAP Runtime", pointing to
      KNOWN_GAPS.md), and the application is built; the ABAP that uses the object fails at runtime
      only when it runs (a runtime error naming the object, as a short dump would), the rest of
      the application works. A CDS view that reads or associates such a view cannot be compiled to
      SQL: an error with the same message, and the view is listed in the needs of the standard
      layer (D95);
    - deprecated: a warning with its successor, offered only when released on SAP BTP (a successor
      of SAP Cloud ERP only is named as such);
    - not in the SAP BTP set: an error, as SAP refuses it ("not released for ABAP Cloud
      development"): `MARA`, `CL_GUI_ALV_GRID`.
  - **An object under a namespace** (`/DMO/`, `/XYZ/`): never "not released": an error "not in the
    project", with the way to add its sources.
  - **A Z or Y object not in the project** (another package, another repository): the same.
  - **Sources of other repositories**: `rapt/config.json` declares folders of abapGit sources
    (another repository of the customer, an open-source library, the Flight reference scenario
    once its license is checked), compiled with the project and never written by `rapt abapgit`.
  - The check stays per object (SAP releases objects, not methods). `rapt new` also declares ROSA
    among the MCP servers of the created projects. Low priority: after the fidelity of the draft,
    OData and CDS.
- **Standard views (D95).** Only views released on SAP BTP, completed with their published
  elements; one consistent set of reference data with integrity tests; texts from CLDR (EN, FR,
  DE, then ES, IT, JA); units from UN/ECE Recommendation 20, with a mapping to the common SAP
  codes written by the project; session language from `sap-language` or `Accept-Language`.

## Phase 6: tools

- **ABAP debugging (D97).** Source maps to the ABAP sources, `rapt dev --inspect`, breakpoints in
  ABAP files and a `rapt` debug type delegating to the Node.js debugger of VS Code, with ABAP
  values shown as ABAP.
- **Data preview, SQL trace, runtime errors (D98).** Under `/$rapt/` in `rapt dev` only: preview
  of any entity or table, trace of each statement with its ABAP position, runtime errors stored
  with their ABAP stack and opened at the faulty line from VS Code.
- **Quality and clean-up (D101).** `rapt check --quality` with abaplint rules close to the cloud
  ATC variant of SAP (`ATC0xx` diagnostics); `rapt clean` with the quick fixes of abaplint, and
  ABAP cleaner when the user has installed it.

## Phase 7: complements

- **Real-time collaborative draft (D93).** WebSocket instead of polling, field locks, `ShareAll`.
  Based on the public documentation of SAP only; if it is not enough for a protocol compatible
  with Fiori elements, the channel stays specific to Open RAP Runtime and the gap goes to
  KNOWN_GAPS.md.
- **OData V2 (D85).** A V2 protocol adapter on the same layers, at the Gateway URL
  (`/sap/opu/odata/sap/<binding>/`), for the `ODATA V2 - UI` and `ODATA V2 - Web API` bindings;
  draft not covered.

## Other leads

- CDS expressions: `CAST` to a CDS type or an enumerated type, `Type.#CONST` constants in the
  views, `BETWEEN`.
- Value helps: fixed values of the domains, several qualified value helps per element.
- Variants shared between users, order of the columns.
- Personalization of the launchpad by the user, notifications.
- MCP: stdio transport, resources (the `$metadata`, the documentation), OAuth authorization of
  the protocol.

## Not planned

See the *Not planned* section of [KNOWN_GAPS.md](../KNOWN_GAPS.md).
