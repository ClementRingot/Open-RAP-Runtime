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
| **0. Measure** | Fiori elements protocol conformance · round trip to SAP BTP · conformance metrics in the CI · abaplint gaps reported upstream (ongoing) | Makes the Fiori elements gaps measurable, at a moderate cost and without risk for the existing code. Upstream delays are external: the issues start early. |
| **1. Transactional Fiori elements** | Complete draft protocol (`SiblingEntity` first) · nested `$expand`, `any`/`all`, JSON batch · applied side effects | `SiblingEntity` blocks the draft List Report of Fiori elements, the rest of the draft blocks the Object Page. The order follows the failing protocol cases. |
| **2. Fiori elements generation and analytics** | Generation of Fiori elements applications · ALP and OVP driven by annotations · extended `$apply` | Fiori elements applications are generated once they work. The analytical list page needs `Aggregation.ApplySupported`. |
| **3. ABAP test foundation** | ABAP Unit · catchable SQL errors | ABAP Unit is a tool and an oracle: the same tests run on the trial and here. Catchable SQL errors are small and unlock negative tests. |
| **4. CDS and RAP fidelity** | CDS views · currencies and conversion exits · late numbering · complete EML · events, change documents, extensions, attachments · exact decimals (upstream) | The core of RAP, in the order of frequency of use in real RAP code. |
| **5. Standard layer** | Repository of the released objects · extended and multilingual standard views | The repository makes the refusal exact and feeds the standard views, so that only views released on SAP BTP are provided. |
| **6. Tools** | ABAP debugging · data preview, SQL trace, runtime errors · ATC-like checks and clean-up | The SQL trace and the runtime errors reuse the source maps of the debugger. |
| **7. Complements** | Real-time collaborative draft · OData V2 | The collaborative draft depends on the public documentation of its protocol; OData V2 has the lowest priority. |

The repository of the released objects has no technical dependency: it can move forward in
parallel with phase 1.

## Planned decisions

The numbers are provisional: each decision takes the next free number of
[DECISIONS.md](DECISIONS.md) when its pull request is opened, and the table below is updated.

| Provisional | Final | Decision | Phase |
|---|---|---|---|
| D79 | — | Fiori elements OData protocol conformance, without SAPUI5 | 0 |
| D80 | — | Generation of Fiori elements applications, next to the OpenUI5 UI | 2 |
| D81 | — | Complete draft protocol | 1 |
| D82 | — | Applied side effects and `determine action` | 1 |
| D83 | — | OData complements: (a) nested `$expand`, `any`/`all`, JSON batch, `$value`; (b) extended `$apply` | 1, 2 |
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
| D94 | — | Repository of the released objects, "not released" refusal with successor | 5 |
| D95 | — | Extended and multilingual standard layer | 5 |
| D96 | — | ABAP Unit: `rapt test` and VS Code | 3 |
| D97 | — | ABAP debugging in VS Code | 6 |
| D98 | — | Data preview, SQL trace, runtime errors | 6 |
| D99 | — | Round-trip protocol to an SAP BTP ABAP trial | 0 |
| D100 | — | Conformance metrics in the CI | 0 |
| D101 | — | ATC-like quality checks and clean-up | 6 |
| D102 | — | abaplint gaps reported upstream | 0 (ongoing) |

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
- **abaplint gaps upstream (D102).** Each gap of the transpiler and runtime listed in
  KNOWN_GAPS.md is checked again on the latest versions, then reported upstream with a minimal
  reproduction; the link goes to the *Tracking* column.

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
- **Exact decimals (D90).** Exact packed arithmetic and exact classic SQL writes are fixed
  upstream (D102); fidelity tests wait for them. The seventh decimal of `TIMESTAMPL` stays lost.

## Phase 5: standard layer

- **Released objects (D94).** A versioned snapshot of the released objects of SAP BTP, built
  from the Cloudification Repository of SAP (Apache-2.0) with the loader of ROSA. `rapt check`
  stays offline and tells apart an object not released for ABAP Cloud, a deprecated object (with
  its successor) and an object released on SAP but not provided by Open RAP Runtime. A successor
  is offered only when it is released on SAP BTP. `rapt new` also declares ROSA among the MCP
  servers of the created projects.
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
