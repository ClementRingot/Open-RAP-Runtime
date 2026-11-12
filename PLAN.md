# RAP compiler → standalone Node.js application — Plan

> **Status: approved on 2026-11-09, being implemented.** The decisions taken are in §11 and
> detailed in [docs/DECISIONS.md](docs/DECISIONS.md). The scope was widened to all the features
> of a non-draft managed RAP BO (decision D14), then to draft (D54); the coverage is tracked in
> [docs/FEATURES.md](docs/FEATURES.md). This plan is the original design document: the
> milestones and choices it describes are the starting point, the decisions record what changed.
> The findings of §2 come from checks made on 2026-11-09 on the published versions of the
> libraries, in a sandbox outside the repository.

## Contents

1. [Summary](#1-summary)
2. [Preliminary checks](#2-preliminary-checks)
3. [Architecture](#3-architecture)
4. [Technical choices and licenses](#4-technical-choices-and-licenses)
5. [Inputs, outputs, CLI](#5-inputs-outputs-cli)
6. [Detailed design](#6-detailed-design)
7. [Test strategy](#7-test-strategy)
8. [Milestones](#8-milestones)
9. [Risks](#9-risks)
10. [Travel / Booking fixture](#10-travel--booking-fixture)
11. [Decisions taken](#11-decisions-taken)
12. [Appendix A — requests of the conformance suite](#appendix-a--requests-of-the-conformance-suite)

---

## 1. Summary

- The `rapt` CLI (strict TypeScript, ESM, Node ≥ 22) reads an **abapGit** export (TABL, DDLS,
  DDLX, BDEF, SRVD, CLAS) and generates an application folder: OData V4 on Fastify, PostgreSQL
  through Kysely, behavior pool transpiled by `@abaplint/transpiler`, freestyle OpenUI5 UI,
  Dockerfile and docker-compose.
- The generated application bundles a **generic runtime** driven by the serialized IR
  (`model.json`). Only what has to be is generated: SQL, CSDL, JavaScript of the ABP, UI,
  packaging. The runtime is thus tested once for all BOs.
- **Hard point, de-risked.** abaplint types the RAP derived types (`TYPE TABLE FOR …`, `keys`,
  `failed`, `reported`, `result`) as `void`, and the transpiler then refuses the ABP. Proposed
  solution: generate these types in ABAP from the IR, then rewrite the ABP before transpilation
  (declarations of the handlers, `#` of the EML operands, inline `DATA(…)` of the EML responses).
  **A PoC validates it**: a validation and an action run end to end.
- **Good news.** Transpiler 2.14 already lowers `READ/MODIFY/COMMIT/ROLLBACK ENTITIES` to a
  "kernel" class `KERNEL_RAP_EML`, injected at runtime. Our EML layer consists in implementing
  this contract in TypeScript, on top of the transactional buffer.
- No SAP dependency: no `@sap/cds`, no SAPUI5, no `sap.fe`. All the licenses are MIT,
  Apache-2.0, BSD or PostgreSQL (§4).
- The 13 decisions of §11 are taken (details and reasons in docs/DECISIONS.md).

---

## 2. Preliminary checks

Tested versions: `@abaplint/core` 2.120.98, `@abaplint/transpiler` and `@abaplint/runtime`
2.14.24, Chevrotain 13.2, Node 22.23, pnpm 10.28.

| # | Subject | Finding | Consequence for the plan |
|---|---|---|---|
| V1 | CDS (`CDSParser` of abaplint) | Parses without errors `define root view entity … composition [0..*] of …`, `association to parent … on $projection.X = _P.X`, `as projection on … provider contract transactional_query`, `redirected to composition child`, and the DDLX `annotate entity … with { … }`. The annotations come out as a tree (objects, arrays, `#X` enumerations, strings, booleans). | No dedicated CDS parser for the MVP: an abaplint AST → IR adapter is enough. A complementary parser only if a gap shows up. |
| V2 | SRVD | Object recognized, but source not parsed. | Small Chevrotain grammar (`define service … { expose … as …; }`). |
| V3 | BDEF in abaplint | A combinator parser exists (≈ 30 expressions). It produces a generic tree abaplint mostly uses to resolve aliases. | We write the requested Chevrotain grammar (typed AST, precise errors). The abaplint parser is used as an **oracle** in the tests. |
| V4 | Derived types | `TYPE TABLE FOR …` gives a table of `void` (internal marker "RAP-TODO"); `keys`, `failed`, `reported`, `mapped`, `result` are `void`. The transpiler stops on `WITH CORRESPONDING #( keys )`: `TypeNameOrInfer, type not found: #`. | We must provide these types ourselves (§6.3). |
| V5 | EML in the transpiler | `READ/MODIFY/COMMIT/ROLLBACK ENTITIES` become calls `abap.Classes['KERNEL_RAP_EML'].begin/read/modify/execute/commit/rollback`. The names are passed as strings (`bdef`, `entity`, `operation`, `fields`…); the tables and the targets `MAPPED/FAILED/REPORTED/RESULT` are passed as is. The upstream tests inject the kernel with `abap.Classes["KERNEL_RAP_EML"] = …`. | The EML layer is a TypeScript implementation of this contract. |
| V6 | EML not lowered | `READ … BY \_assoc`, `CREATE BY \_assoc`, `LINK`, `OPERATIONS`, `RELATING TO`, `AUGMENTING`, functions, `IN SIMULATION MODE`: the generated code raises a "not supported" error at runtime. | KNOWN_GAPS.md entries, with a diagnostic at compile time. The fixture does not use these forms. Upstream contribution possible (§11). |
| V7 | `IN LOCAL MODE`, `PRIVILEGED` | Ignored by the lowering: the kernel does not know whether the call is local. | All the EML coming from the ABP is treated as `IN LOCAL MODE`. No effect in the MVP scope (no authorizations nor dynamic feature control). Documented. |
| V8 | SQL layer of the transpiler | The transpiler builds SQL views from the DDLS and fails on the associations (`unsupported database definition`). | The registry given to the transpiler receives "shadow" DDLS, without associations. Our SQL comes from the IR, not from the transpiler. |
| V9 | `%…` components | `%tky`, `%control`, `%param`, `%msg`, `%element` and `INCLUDE TYPE … AS %tky` (named, nested groups) pass the abaplint syntax check, the transpilation and the execution. | The derived types can be written in standard ABAP. |
| V10 | **End-to-end PoC** | ABP rewritten by hand as the tool would, generated type interface, in-memory JS kernel. `validateDates` fills `failed` and `reported` (`%msg` with its text, `%element-EndDate = mk-on`). `acceptTravel` chains `MODIFY … IN LOCAL MODE UPDATE FIELDS`, `READ … ALL FIELDS`, then fills `result` with `%param`. The methods in the `PRIVATE SECTION` are called through the "friends" mechanism of the generated code. | The approach of §6.3 is retained. |
| V11 | Existing work | **open-steamgate** (MIT) emulates a complete ABAP application server (ADT, OData V2/V4, RAP runtime written in ABAP). Its documentation describes the same `KERNEL_RAP_EML` contract and the same typing limit: the EML targets must be declared explicitly, and the project relies on patched builds of abaplint and of the transpiler. | Good source of inspiration. Our approach works with the published packages, without a fork. |
| V12 | Semantics of `field ( mandatory )` | The ABAP Cloud documentation says it: no check at runtime, it is a hint for the consumer. | We reproduce this behavior: no runtime check, `Common.FieldControl` Mandatory in the CSDL. The business check stays in a validation. |
| V13 | Environment | PostgreSQL 16 binaries present. Docker CLI present, daemon stopped. Chromium and Playwright pre-installed. | Fast tests on PGlite, e2e on a real PostgreSQL. Docker in CI, or here if the daemon starts. |

---

## 3. Architecture

```
 abapGit folder (fixtures/travel/src)
   TABL .xml · DDLS .asddls · DDLX .asddlxs · BDEF .asbdef · SRVD .srvdsrv · CLAS .abap
   │
   ▼
┌──────────────────────────── @open-rap/compiler ────────────────────────────┐
│ 1. Parsing                                                                        │
│    abaplint registry: CDS (DDLS, DDLX), DDIC (TABL, DTEL, DOMA) + std catalog     │
│    Chevrotain       : BDEF (behavior + projection), SRVD                          │
│ 2. IR (model.json) + semantic validation (diagnostics file:line:col)              │
│ 3. Generators                                                                     │
│    sql/   PostgreSQL DDL: tables + views (R layer then C layer)                   │
│    csdl/  $metadata XML + UI, Common, Core, Capabilities, Measures annotations    │
│    abap/  derived types → ABP rewrite → @abaplint/transpiler → .mjs modules       │
│    ui/    OpenUI5 application (List Report / Object Page, freestyle)              │
│    app/   package.json · server.mjs · Dockerfile · docker-compose · .env          │
└───────────────────────────────────────────────────────────────────────────────────┘
   │
   ▼
 output folder (standalone application) + bundled @open-rap/runtime (vendor/)

   browser (OpenUI5, ODataModel V4)
        │  $batch, GET, POST, PATCH, DELETE
        ▼
   OData V4 (Fastify) ── OIDC auth / dev mode ── CSRF token
        │ reads                       │ writes, actions
        ▼                             ▼
   SQL views zc_*             RAP managed runtime (buffer, triggers, save sequence)
        │                             │  ▲
        │                             │  └── KERNEL_RAP_EML ◄── transpiled ABP (@abaplint/runtime)
        ▼                             ▼
                 PostgreSQL (Kysely + pg)
```

pnpm monorepo:

```
packages/
  model/      @open-rap/model     types of the IR, (de)serialization, version of model.json
  compiler/   @open-rap/compiler  rapt CLI, parsers, IR construction, generators
  runtime/    @open-rap/runtime   OData V4, RAP managed runtime, EML kernel, auth, DB access
fixtures/travel/                        reference BO (abapGit format)
e2e/                                    end-to-end scenarios (HTTP + Playwright)
```

Internal dependencies: `compiler` → `model` ← `runtime`. The compiler only depends on the
runtime to bundle it into the output.

---

## 4. Technical choices and licenses

Licenses read on the npm registry on 2026-11-09. LICENSES.md is created in M1 and kept up to
date with each new dependency (name, version, license, use, date of the check).

| Building block | Choice | License | Reason, alternative |
|---|---|---|---|
| Language, tooling | TypeScript 7.0 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESM, Node ≥ 22, pnpm 10 (workspaces), Vitest 5 | Apache-2.0, MIT, MIT | Required by the specification. Fallback to TypeScript 5.9 if a tool is not yet compatible with 7. |
| ABAP and CDS parsing | `@abaplint/core` 2.120.98 | MIT | Required; sufficient CDS coverage (V1). Exact version pinned. |
| Transpilation of the ABP | `@abaplint/transpiler` and `@abaplint/runtime` 2.14.24 | MIT | Required. Same exact version for both, pinned. |
| BDEF, SRVD grammars, OData options | Chevrotain 13 | Apache-2.0 | Required for BDEF; reused for SRVD and `$filter`/`$orderby`/`$expand`. |
| HTTP server | Fastify 5 | MIT | `inject()` to test without a network, encapsulated plugins, good typing. Alternative: Express 5 (MIT). |
| Database | PostgreSQL 16+, `pg` 8, Kysely 0.29 | PostgreSQL, MIT, MIT | Required. Parameterized queries only. |
| Database for the tests | PGlite 0.5 + `kysely-pglite-dialect` 1.4 | Apache-2.0, MIT | Real in-process PostgreSQL engine (WASM), without Docker: fast integration tests. |
| OIDC | `jose` 6 (JWT, JWKS), `openid-client` 6 (code + PKCE), `@fastify/secure-session` 8 | MIT | Generic OIDC provider (Keycloak, Entra ID, Auth0…). |
| Static files | `@fastify/static` 10 | MIT | Serves the built UI. |
| OIDC tests | `oauth2-mock-server` 9 (dev); Keycloak (Docker image) | MIT, Apache-2.0 | Fake provider in Vitest; real Keycloak in e2e. |
| UI | OpenUI5 1.136 LTS: `sap.m`, `sap.f`, `sap.uxap`, `sap.ui.layout`, `sap.ui.core`, `sap_horizon` theme | Apache-2.0 | Allowed. The ODataModel V4 is the same as the one of Fiori Elements V4. `sap.fe`, `sap.ui.comp` and `sap.suite` are not part of OpenUI5 and are not used. |
| UI build | UI5 Tooling (`@ui5/cli` 4) | Apache-2.0 | `ui5 build self-contained`: standalone bundle, usable offline. |
| Browser E2E | Playwright 1.65 | Apache-2.0 | Chromium already installed here. |
| XML | in-house writing for the CSDL; `fast-xml-parser` 5 in dev | MIT | No runtime dependency for the XML. |
| CLI | `node:util` `parseArgs` | (Node, MIT) | No dependency. |
| Docker images | `node:22-alpine`, `postgres:16-alpine`, `quay.io/keycloak/keycloak` | MIT and free packages, PostgreSQL, Apache-2.0 | Official images. |
| Test corpus (option) | BDEF/CDS sources of the SAP-samples examples (refscen-flight, rap-opensap, fiori-feature-showcase) | Apache-2.0 | Robustness of the parsers, read-only, with attribution (decision 13). |

Prohibitions respected: no `@sap/cds` (CAP), no SAPUI5, no `sap.fe`, no library under the SAP
Developer License. The "clean-room" ABAP base (§6.3) is written from scratch from the documented
public signatures; no SAP code is copied.

---

## 5. Inputs, outputs, CLI

### Input: a folder in abapGit format

| Type | Files | MVP |
|---|---|---|
| TABL | `ztravel.tabl.xml` (DD02V, DD03P) | yes |
| DTEL, DOMA | `.dtel.xml`, `.doma.xml` | yes when present; otherwise, bundled catalog of the standard elements usual in RAP (`SYSUUID_X16`, `ABP_*`, `TIMESTAMPL`, `ABAP_BOOLEAN`…), type metadata only |
| DDLS | `.ddls.asddls` | yes |
| DDLX | `.ddlx.asddlxs` | yes |
| BDEF | `.bdef.asbdef` | yes (managed and projection) |
| SRVD | `.srvd.srvdsrv` | yes |
| SRVB | `.srvb.xml` | optional: name of the binding, version, path of the service |
| CLAS | `.clas.abap`, `.clas.locals_imp.abap`, `.clas.locals_def.abap` | yes (behavior pool) |
| MSAG | `.msag.xml` | "should": for `new_message( id = … number = … )` |

### CLI

```
rapt check <src>                                   diagnostics (parsing, RAP semantics, ABAP syntax check)
rapt ir    <src> --service ZUI_TRAVEL              IR as JSON (debugging, snapshots)
rapt build <src> --service ZUI_TRAVEL --out <dir> [--odata-path …] [--ui5-version …]
```

The diagnostics follow the format `file:line:column: error|warning CODE message`. The exit code
is non-zero on error.

### Output: a standalone folder

```
package.json          public dependencies (fastify, kysely, pg, @abaplint/runtime, jose, openid-client…)
vendor/               bundled runtime as a tarball: no private registry needed
server.mjs            startup: configuration (env) → DB schema → ABAP runtime → Fastify
model/model.json      serialized IR
odata/metadata.xml    CSDL ($metadata)
db/schema.sql         tables + views
abap/*.mjs            transpiled ABP, derived types, "clean-room" base
webapp/  ui5.yaml     OpenUI5 application, built as a standalone bundle in the Docker build
Dockerfile  docker-compose.yml  .env.example  keycloak/realm.json  README.md
```

Start: `npm start` (PostgreSQL through `DATABASE_URL`, `AUTH_MODE=none|oidc`) or
`docker compose up`.

---

## 6. Detailed design

### 6.1 Parsing

**BDEF (Chevrotain).** Case-insensitive lexer, `//` and `/* */` comments, namespaced names
(`/DMO/I_Travel`), `$self`, cardinalities `[1]`, `[0..*]`. MVP subset:

- header: `managed implementation in class … unique;`, `projection;`, `strict ( 2 );`;
- entity: `define [root] behavior for E [alias A]`, `persistent table T`, `lock master`,
  `lock dependent by _A`, `etag master F`, `etag dependent by _A`, `use etag` (projection);
- body: `create; update; delete;`, `association _A [{ create; }]`,
  `field ( readonly | mandatory | numbering : managed ) F1, F2;`,
  `determination d on modify { create; update; delete; field F1, F2; }`,
  `validation v on save { … }`, `action a [result [1] $self];`,
  `mapping for T [corresponding] { F = col; }`;
- projection: `use create`, `use update`, `use delete`, `use action a`,
  `use association _A [{ create; }]`.

The out-of-scope constructs are **recognized** by generic rules. The tool emits a clear
diagnostic instead of an opaque syntax error:

| Construct | Handling |
|---|---|
| `with draft`, `unmanaged`, `late numbering`, `with additional save`, `with unmanaged save`, `static` or `factory` actions, functions, `determine action`, `event` | **error**: out of the MVP scope |
| `authorization master`, `authorization dependent`, `side effects`, `features : instance`, `mandatory : create`, `readonly : update` | **warning**: accepted but ignored, gap described in KNOWN_GAPS.md |

**CDS (through abaplint).** The adapter extracts the name, the kind (root or child), the source
(table or entity), the select list with `key` and aliases, the associations and compositions
(cardinality, ON condition), `redirected to`, `provider contract`, and the entity and element
annotations converted to JSON. MVP: columns and aliases; expressions (CASE, CAST, calculations)
produce an "unsupported" diagnostic until an extension. Merge of the annotations: DDLX (layers
CUSTOMER > PARTNER > INDUSTRY > LOCALIZATION > CORE), then projection, then base view
(propagation), respecting `@Metadata.ignorePropagatedAnnotations`.

**SRVD.** `define service S { expose E [as Alias]; }`, with annotations.

**DDIC.** Tables read by abaplint (DD03P XML); DTEL and DOMA by abaplint; bundled catalog for
the standard elements. The client column (`CLNT`) is ignored (decision 9).

### 6.2 IR

Sketch of the types of the `model` package:

```ts
interface Model { version: 1; service: Service; bos: BusinessObject[]; projections: ProjectionBO[]; tables: Table[] }

type AbapType = { kind: "char" | "numc" | "string" | "dec" | "curr" | "quan" | "int1" | "int2" | "int4"
                      | "int8" | "fltp" | "dats" | "tims" | "timestamp" | "timestampl" | "utclong"
                      | "raw" | "rawstring" | "cuky" | "unit" | "bool";
                  length?: number; decimals?: number; ddic?: string };

interface Field { name: string; type: AbapType; column?: string; key: boolean;
                  semantics?: "createdBy" | "createdAt" | "lastChangedBy" | "lastChangedAt" | "localInstanceLastChangedAt";
                  currencyRef?: string; annotations: Annotations; src: SourceRef }

interface Entity { name: string; alias: string; root: boolean; table?: string; baseEntity?: string;
                   fields: Field[]; associations: Association[]; annotations: Annotations }

interface Association { name: string; target: string; kind: "composition" | "toParent" | "association";
                        cardinality: [min: number, max: number | "*"]; on: Array<[source: string, target: string]> }

interface Trigger { create?: true; update?: true; delete?: true; fields: string[] }
interface HandlerRef { abapClass: string; method: string; params: Record<string, string> }

interface EntityBehavior {
  entity: string; persistentTable: string;
  lock: { master: true } | { dependentBy: string };
  etag?: { master: string } | { dependentBy: string };
  operations: { create: boolean; update: boolean; delete: boolean; createBy: string[] };
  fieldControl: Record<string, Array<"readonly" | "mandatory">>; numberingManaged: string[];
  determinations: Array<{ name: string; on: "modify" | "save"; triggers: Trigger; handler: HandlerRef }>;
  validations: Array<{ name: string; triggers: Trigger; handler: HandlerRef }>;
  actions: Array<{ name: string; result?: { cardinality: "1"; self: true }; handler: HandlerRef }>;
  mapping: Record<string, string>; src: SourceRef }
```

Semantic validations (positioned diagnostics): known entity, field and association; BDEF mapping
consistent with the CDS view and the table; `etag master` field existing and of a timestamp type;
`numbering : managed` field a key of type RAW 16; fields of the triggers existing; the projection
only uses capabilities of the base; each validation, determination and action has a handler
method in the ABP.

### 6.3 ABP → JavaScript

1. abaplint **syntax check** of the original sources (ABAP for Cloud Development). The errors
   point to the original lines.
2. **Derived types.** For each BDEF, a generated ABAP interface (`ZRAP_DT_<BDEF>`, or a hashed
   name beyond 30 characters). Per entity: groups `%key`, `%pky`, `%tky`, `%data`, `%control`;
   tables `FOR CREATE`, `UPDATE`, `DELETE`, `READ IMPORT`, `READ RESULT`, `ACTION IMPORT`,
   `ACTION RESULT`; structures `RESPONSE FOR FAILED/REPORTED/MAPPED` (`%cid`, `%cid_ref`,
   `%fail`, `%msg`, `%element`, `%op`…). All according to the ABAP documentation of the BDEF
   derived types.
3. **Rewrite.** abaplint provides the AST and the positions; targeted text edits are applied,
   preserving the line numbers:

   | In the ABP | Becomes |
   |---|---|
   | `METHODS v FOR VALIDATE ON SAVE IMPORTING keys FOR Travel~v.` | `METHODS v IMPORTING keys TYPE <dt>=>tt_travel_keys CHANGING failed TYPE <dt>=>ts_failed reported TYPE <dt>=>ts_reported.` |
   | `FOR DETERMINE ON MODIFY …`, `FOR MODIFY IMPORTING keys FOR ACTION Travel~a RESULT result` | same principle; `result` and `mapped` typed according to the operation |
   | `TYPE TABLE FOR UPDATE zr_travel\\travel`, `TYPE STRUCTURE FOR …`, `TYPE RESPONSE FOR …` | `TYPE <dt>=>tt_travel_update`, etc. |
   | `RESULT DATA(x)`, `FAILED DATA(f)`, `REPORTED DATA(r)`, `MAPPED DATA(m)` of an EML statement | `DATA x TYPE …` hoisted on the same line, then `RESULT x` |
   | EML operand `CORRESPONDING #( … )` or `VALUE #( … )` | `#` replaced by the expected derived type |
   | handlers the tool does not call (for example `FOR GLOBAL AUTHORIZATION`) | signature typed the same way, so that the class transpiles; method never called |
   | everything else, EML statements included | unchanged: the transpiler lowers the EML to `KERNEL_RAP_EML` |

4. **Registry of the transpiler**: rewritten ABP, type interface, shadow DDLS (V8), tables, and
   a "clean-room" base written by us: `CL_ABAP_BEHAVIOR_HANDLER` (`new_message_with_text`,
   `new_message`), `IF_ABAP_BEHV` (`mk`, `cause`…), `IF_ABAP_BEHV_MESSAGE`.
5. **Transpilation** (`unknownTypes: compileError`) → `.mjs` modules. The tool writes the
   **registry of the handlers** into `model.json`: BDEF validation, determination or action →
   transpiled local class, method, names of the parameters.

Safeguard: the transpiler and the runtime are never patched, they are given standard ABAP. An
unhandled construct produces a diagnostic and an entry in KNOWN_GAPS.md.

**Execution.** The runtime instantiates the local class (for example
`abap.Classes['CLAS-ZBP_R_TRAVEL-LHC_TRAVEL']`). It builds `keys`, `failed`, `reported` and
`result` from the generated types, calls the method, then reads the responses back. The
`KERNEL_RAP_EML` kernel links each EML call to the buffer of the current LUW, found through
`AsyncLocalStorage`. The abaplint runtime has a **global state** (`sy-*`, static attributes)
shared between requests: the ABP calls are therefore **serialized** in a process. Scaling is done
with processes or containers (decision 11).

### 6.4 SQL (PostgreSQL)

The tables come from the TABLs: lower-case names, client column removed, primary key, child →
parent foreign key for the compositions, index on the parent key. A SQL view is generated for
each CDS view: `zr_*` on the tables, then `zc_*` on `zr_*`. The OData reads go through the
`zc_*` views; the writes go through the RAP runtime, to the tables. The DDL is idempotent
(`IF NOT EXISTS`). Schema evolution (ALTER) is not in the MVP.

| ABAP | PostgreSQL | Edm |
|---|---|---|
| CHAR(n) | `varchar(n)`, trailing blanks removed | String, MaxLength=n |
| NUMC(n) | `varchar(n)`, digits with leading zeros | String + `Common.IsDigitSequence` |
| STRING, SSTRING(n) | `text`, `varchar(n)` | String |
| INT1, INT2, INT4, INT8 | `smallint`, `smallint`, `integer`, `bigint` | Byte, Int16, Int32, Int64 |
| DEC, CURR, QUAN (p,s) | `numeric(p,s)` | Decimal, Precision and Scale |
| FLTP | `double precision` | Double |
| DATS | `date`; initial value `00000000` ↔ NULL | Date |
| TIMS | `time(0)` | TimeOfDay |
| TIMESTAMP (DEC 15) | `timestamptz(0)` | DateTimeOffset, Precision 0 |
| TIMESTAMPL (DEC 21,7), UTCLONG | `timestamptz(6)` | DateTimeOffset, Precision 7 |
| RAW(16) (`SYSUUID_X16`) | `uuid` | Guid |
| other RAW(n), RAWSTRING | `bytea` | Binary |
| CHAR(1) `ABAP_BOOLEAN` | `boolean` | Boolean |
| CUKY, UNIT | `varchar(5)`, `varchar(3)` | String; the amount carries `Measures.ISOCurrency` or `Measures.Unit` |

### 6.5 $metadata (CSDL XML)

Conventions taken from RAP, so that an existing Fiori Elements application finds what it
expects: schema `com.sap.gateway.srvd.<srvd>.v0001` (alias `SAP__self`), types `<Alias>Type`,
entity sets `<Alias>`, navigations with `Partner` and `NavigationPropertyBinding`, bound actions
with an `_it` parameter. The vocabularies (Core, Capabilities, Measures on the OASIS side;
Common, UI on the SAP side) are referenced by their public URL.

| Source | CSDL annotation |
|---|---|
| `@EndUserText.label` | `Common.Label` |
| `@UI.lineItem` (including `#FOR_ACTION`) | `UI.LineItem` (`UI.DataField`, `UI.DataFieldForAction`, `UI.Importance`) |
| `@UI.selectionField` | `UI.SelectionFields` |
| `@UI.headerInfo` | `UI.HeaderInfo` |
| `@UI.facet` | `UI.Facets`: `ReferenceFacet` to Identification, FieldGroup or the LineItem of an association; `CollectionFacet` |
| `@UI.identification`, `@UI.fieldGroup` | `UI.Identification`, `UI.FieldGroup#Qualifier` |
| `@UI.hidden` | `UI.Hidden` |
| `@ObjectModel.text.element` | `Common.Text` |
| `@Semantics.amount.currencyCode`, `@Semantics.quantity.unitOfMeasure` | `Measures.ISOCurrency`, `Measures.Unit` |
| `field ( readonly )`, `numbering : managed` | `Core.Computed` |
| `field ( mandatory )` | `Common.FieldControl` Mandatory |
| `etag master` | `Core.OptimisticConcurrency` on the entity set |
| available operations (create, update, delete, create by association) | `Capabilities.InsertRestrictions`, `UpdateRestrictions`, `DeleteRestrictions`, `NavigationRestrictions` |

### 6.6 OData V4 runtime

Goal: that an existing Fiori Elements V4 application (outside this project, used under the SAP
license of its owner) can consume the service. Our tests only use OpenUI5.

The table gives the requested scope, plus the additions I propose because a V4 List Report /
Object Page needs them (decision 5):

| Function | Requested | Proposed addition |
|---|---|---|
| Service document, `$metadata` | ✓ | |
| GET collection; GET entity, short key `Travel(<guid>)` and named key `Travel(TravelUUID=<guid>)` | ✓ | |
| GET through a navigation `Travel(…)/_Booking` (table of the Object Page) | | ✓ |
| `$filter`: eq, ne, gt, lt, and, or, contains | ✓ | ge, le, not, startswith, endswith, parentheses, `null` (the FE filter bar produces them) |
| `$orderby`, `$top`, `$skip`, `$count=true` | ✓ | `/$count` segment |
| One-level `$expand`, with nested `$select`, `$orderby`, `$top`, `$skip` | ✓ | |
| `$select` | ✓ | |
| Simple `$search` (ILIKE on the `@Search.defaultSearchElement` fields) | | ✓ |
| POST, PATCH, DELETE | ✓ | POST through a navigation `Travel(…)/_Booking`; one-level deep insert |
| Bound actions | ✓ | |
| Multipart `$batch`, atomic changesets, `Content-ID` | ✓ | `$<id>` references inside a changeset |
| ETag: `@odata.etag`, `If-Match`, 412 on a mismatch | ✓ | 428 when `If-Match` is missing |
| `IEEE754Compatible=true` (Decimal and Int64 as strings) | | ✓ (UI5 always sends it) |
| CSRF token (`X-CSRF-Token: Fetch` on HEAD or GET) | | ✓ |
| Messages: V4 error with `target` and `@Common.numericSeverity`; success and warnings in the `sap-messages` header | | ✓ |
| `sap-*` parameters (sap-client, sap-language…) | | accepted and ignored |

Implementation: a Fastify plugin; the system options are parsed by Chevrotain, then the AST is
translated into parameterized Kysely queries (never SQL concatenation), with an allow list of
properties from the IR. A changeset corresponds to a RAP LUW and to a PostgreSQL transaction.
The JSON `$batch` format (OData 4.01) is not in the MVP.

Path of the service: by default the one of a RAP binding,
`/sap/opu/odata4/sap/<binding>/srvd/sap/<srvd>/0001/`, so that an existing FE application points
to it without changing its manifest. The path is configurable (decision 6).

### 6.7 RAP managed runtime (without draft)

- **Transactional buffer** per LUW: instances per entity (state loaded, created, updated or
  deleted), changed fields (to evaluate the triggers), mapping `%cid` ↔ keys.
- **Operations**:
  - create, with `managed` numbering (UUID v4);
  - update driven by `%control` (a PATCH sets the fields it sends);
  - delete, cascading on the compositions;
  - create by association, with propagation of the parent key;
  - instance actions (`result [1] $self`).
- **Fields**:
  - `readonly`: ignored or refused for an external consumer (OData), allowed in local mode (ABP);
  - `mandatory`: no runtime check, as in RAP (V12);
  - administrative fields filled according to `@Semantics.user.createdBy`, `lastChangedBy`,
    `@Semantics.systemDateTime.createdAt`, `lastChangedAt` and `localInstanceLastChangedAt`.
- **On modify determinations**: run at the end of each modifying request, for the instances
  whose trigger (`create`, `update`, `delete`, `field …`) was touched. They can trigger others;
  the loop is bounded.
- **Save sequence**:
  1. finalize (on save determinations);
  2. check_before_save (validations whose triggers were touched in the LUW);
  3. if `failed` is not empty: rollback, then OData error with the messages of `reported`;
  4. otherwise save (INSERT, UPDATE, DELETE), COMMIT, cleanup.
- **ETag**: check of `If-Match` on the `etag master` field before update, delete and action.
- **Lock**: `lock master` → `SELECT … FOR UPDATE NOWAIT` on the root row, in the transaction of
  the changeset; `lock dependent` → lock of the root. The HTTP code returned when the instance is
  locked will be aligned with SAP (to check).
- **Identity**: the authenticated user feeds `sy-uname` and the `createdBy`/`lastChangedBy`
  fields.

### 6.8 Authentication

- `AUTH_MODE=none` (dev): fixed, configurable user.
- `AUTH_MODE=oidc`, generic (discovery through `/.well-known/openid-configuration`):
  - API: Bearer JWT token verified through JWKS with `jose` (`iss`, `aud`, `exp`, optional
    required role);
  - browser: BFF pattern, Authorization Code + PKCE with `openid-client`, session in an
    encrypted cookie (`HttpOnly`, `SameSite=Lax`), CSRF token required on the modifying requests.
- The claim that feeds `sy-uname` is configurable (`preferred_username` by default). The CHAR(12)
  user columns are truncated, with a warning.
- Keycloak: docker-compose profile with a realm import (client, test users). In Vitest: fake OIDC
  provider (`oauth2-mock-server`).

### 6.9 Generated OpenUI5 UI (freestyle, without sap.fe)

- `sap.ui.model.odata.v4.ODataModel` of OpenUI5, with `autoExpandSelect`. It is the model of
  Fiori Elements V4: the `$batch` requests have the same shape.
- **List Report**:
  - `sap.f.DynamicPage`;
  - filter bar generated from `UI.selectionField`, the control depending on the Edm type;
    search field if `@Search.searchable`;
  - `sap.m.Table` from `UI.lineItem` (sorting, growing, `$count`);
  - Create and Delete buttons according to the capabilities; action buttons from `#FOR_ACTION`.
- **Object Page**:
  - `sap.uxap.ObjectPageLayout`, header from `UI.headerInfo`;
  - sections from `UI.facet`: forms for Identification and FieldGroup, table for the
    composition;
  - display and edit modes, Save / Cancel, actions;
  - `mandatory` → required field, checked on the client before the save; `readonly` → not
    editable;
  - messages in a `MessagePopover`.
- The child object page (Booking) is generated the same way; the i18n labels come from
  `@EndUserText`.
- `sap.ui.mdc` (present in OpenUI5) is a possible evolution, not in the MVP. OpenUI5 version
  pinned on an LTS, 1.136 by default.

### 6.10 Packaging

- Multi-stage **Dockerfile**: UI build (`ui5 build self-contained`), installation of the
  production dependencies, `node:22-alpine` image, non-root user, `HEALTHCHECK`.
- **docker-compose**: `app` + `postgres:16-alpine` (volume, healthcheck); `auth` profile with
  Keycloak.
- On startup, the application applies `db/schema.sql` (idempotent) and keeps a schema version
  table.

---

## 7. Test strategy

| Level | Content | Tools |
|---|---|---|
| Unit | Grammars (positive and negative cases, error positions), IR construction, generators (assertions + snapshots), OData parsers, ABAP ↔ SQL ↔ Edm type conversions | Vitest |
| Oracle | BDEF compared with the abaplint parser; CDS and BDEF of the SAP-samples corpus, read-only | Vitest |
| ABP | Snapshots of the rewrite; transpilation then execution of the handlers on a fake kernel; tests of the `KERNEL_RAP_EML` contract and of the access to the private methods | Vitest + abaplint |
| Integration | RAP runtime + SQL on a real in-memory PostgreSQL engine | PGlite |
| OData conformance | Requests as Fiori sends them (appendix A), including raw `$batch` bodies. First written from the URLs of a V4 List Report, then completed with real traces: the OpenUI5 ODataModel V4 is driven with Playwright and the captured requests are frozen in reference files. | `fastify.inject` + PGlite |
| E2E | `rapt build` on the fixture → `docker compose up` → HTTP scenarios and UI journeys (filter, open, edit, action, create, delete). Variant without Docker on a local PostgreSQL. | Playwright |

CI: GitHub Actions (typecheck and tests on each push, Docker e2e job).

---

## 8. Milestones

Each milestone ends with green Vitest tests, a commit pushed to the branch and a short report.

### M1 — Foundation, fixture, BDEF parser, IR

- **Deliverables**
  - Monorepo foundation (pnpm, strict TypeScript, ESM, Vitest, CI), LICENSES.md, KNOWN_GAPS.md,
    README.
  - Complete `fixtures/travel/` fixture in abapGit format (§10), ABP included (used from M4).
  - Chevrotain BDEF (managed and projection) and SRVD grammars; abaplint CDS, DDLX and DDIC
    adapters; catalog of the standard data elements.
  - `model` package: types of the IR, construction, semantic validations, positioned
    diagnostics.
  - `rapt check` and `rapt ir` CLI.
- **Tests**: grammar (positive, negative, error positions); abaplint oracle (same entities,
  aliases, operations); snapshot of the IR of the fixture; diagnostics on deliberately wrong
  sources.
- **Exit**: `rapt check fixtures/travel` without errors; `rapt ir` produces a complete and stable
  IR.

### M2 — SQL and $metadata generators

- **Deliverables**: DDL (tables, constraints, R and C views); CSDL with annotations; `rapt build`
  writes `db/schema.sql` and `odata/metadata.xml`.
- **Tests**: DDL run on PGlite, then insertion and read through the views; well-formed CSDL,
  XPath assertions, snapshot; IR ↔ CSDL cross-check.
- **Exit**: green tests.

### M3 — OData read runtime (and authentication foundation)

- **Deliverables**: Fastify plugin; parsers of the URLs and options (Chevrotain); V4 JSON
  serialization; read `$batch`; CSRF; errors; authentication in dev mode and Bearer.
- **Tests**: parsers; "read" conformance suite (appendix A, requests 1 to 11); security
  (injection attempts, unknown properties).
- **Exit**: the read requests of a List Report and of an Object Page pass.

### M4 — Writes, EML, transpiled ABP

- **Deliverables**: RAP managed runtime (§6.7), ABP chain (§6.3), EML kernel, OData writes and
  changesets, messages.
- **Tests**
  - Unit: buffer, triggers, save sequence, snapshots of the rewrite, contract of the kernel.
  - Integration through OData on PGlite:
    - creation of a Travel → `OverallStatus = 'O'` (determination);
    - inconsistent dates → 400, message targeted on `EndDate`, rollback;
    - stale ETag → 412;
    - `acceptTravel` → `'A'`;
    - creation of a Booking through `_Booking`;
    - cascading delete;
    - atomic changeset.
- **Exit**: green tests; KNOWN_GAPS.md up to date.

### M5 — Generated UI

- **Deliverables**: OpenUI5 generator (§6.9).
- **Tests**: snapshots of the views and of the manifest; Playwright journey on the application
  (PGlite or local PostgreSQL): list, filter, sort, open, edit, save, run the action, create with
  children, delete, see a validation message.
- **Exit**: green journey.

### M6 — Docker packaging, complete OIDC, e2e

- **Deliverables**: package.json, Dockerfile, docker-compose (app + Postgres, Keycloak profile);
  bundled runtime; OIDC BFF; README of the generated application.
- **Tests**: e2e — build of the fixture, `docker compose up`, HTTP and Playwright suite, with and
  without Keycloak; variant without Docker.
- **Exit**: green tests locally and in CI.

---

## 9. Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| RAP derived types not resolved by abaplint (V4) | observed | blocking for the ABP | Generated types + rewrite (PoC V10); eventually, an upstream contribution. |
| EML forms not lowered (V6), especially `READ … BY \_Booking`, common in real determinations | high | real ABPs refused | Diagnostic at compile time, KNOWN_GAPS entry; upstream contribution if you accept it. |
| Very active abaplint libraries (daily releases). The `KERNEL_RAP_EML` contract is recent; the access to the private methods goes through an internal detail of the generated code (`FRIENDS_ACCESS_INSTANCE`). | medium | breakage on upgrade | Exact pinned versions, dedicated contract tests, explicit upgrades. |
| Global state of the ABAP runtime (`sy-*`, static attributes) shared between requests | certain | data crossed between requests | Serialized ABP calls; scaling with processes. |
| RAP semantic fidelity (order of the determinations, triggers, HTTP codes, format of the messages) | medium | behavior different from SAP | Behavior tests written from the ABAP documentation; gaps listed in KNOWN_GAPS. |
| OData V4 conformance with UI5 and FE (IEEE754Compatible, `$batch`, ETag, messages) | medium | UI that does not work | Conformance suite on real requests + e2e with the real OpenUI5 ODataModel V4. |
| CDS coverage beyond the MVP (CASE, CAST, joins, parameters, unions) | low for the MVP | parser or SQL to extend | Isolated adapter; complementary parser if needed. |
| Precision of the timestamps (7 decimals in ABAP, 6 in PostgreSQL) | certain | low | Timestamps generated to the microsecond; documented. |
| Security: injection through `$filter`, CSRF, XSS in the UI | low | high | Parameterized queries, allow list of properties, CSRF token, CSP headers, dedicated tests. |
| Legal: "clean-room" base (`CL_ABAP_BEHAVIOR_HANDLER`…) | low | medium | Written from scratch from the public signatures; no SAP code copied; no SAP dependency. |
| Duration and size of the OpenUI5 build | medium | low | Build in a Docker stage, with a cache; OpenUI5 CDN in dev mode. |
| Docker unavailable in some environments (like this one) | medium | Docker e2e cannot run | Equivalent e2e on a local PostgreSQL; Docker job in CI. |

Gaps already identified, which will go to KNOWN_GAPS.md: EML forms of V6; `IN LOCAL MODE` and
`PRIVILEGED` ignored (V7); authorizations, dynamic feature control and side effects ignored with
a warning; conversion exits (ALPHA…) and ISO conversion of the languages not handled; precision
of the timestamps; client ignored; serialized ABP execution.

---

## 10. Travel / Booking fixture

The fixture is delivered in [fixtures/travel](fixtures/travel) (abapGit format); its detailed
description is in [fixtures/travel/README.md](fixtures/travel/README.md). The objects carry the
`ZRT_` prefix to avoid collisions with the objects of the RAP tutorials when it is imported into
a real system.

| Object | Type | Role |
|---|---|---|
| `ZRT_TRAVEL`, `ZRT_BOOKING` | TABL | Persistent tables |
| `ZRT_R_TRAVEL` | DDLS | Root view entity, `composition [0..*] of ZRT_R_Booking` |
| `ZRT_R_BOOKING` | DDLS | Child view entity, `association to parent` |
| `ZRT_C_TRAVEL`, `ZRT_C_BOOKING` | DDLS, DDLX | Projections and UI annotations |
| `ZRT_R_TRAVEL`, `ZRT_C_TRAVEL` | BDEF | Managed strict(2) behavior and projection |
| `ZBP_RT_R_TRAVEL` | CLAS | Behavior pool |
| `ZRT_UI_TRAVEL`, `ZRT_UI_TRAVEL_O4` | SRVD, SRVB | Service and OData V4 binding |

Compared with the initial sketch, the fixture covers more non-draft features (decision D14):
global authorization, instance feature control on the `acceptTravel` action, internal action
`reCalcTotalPrice` called by two `calculateTotalPrice` determinations (on Travel and on Booking),
with a `READ … BY \_Booking` and a `READ … BY \_Travel` read.

---

## 11. Decisions taken

The owner of the project delegated the technical choices, with one requirement: all the features
of a non-draft RAP BO must be respected. The recommendations were all retained, with three
adjustments due to this requirement. The details are in [docs/DECISIONS.md](docs/DECISIONS.md).

| # | Decision | Adjustment |
|---|---|---|
| 1 | Chevrotain BDEF grammar, abaplint parser as an oracle (D1) | |
| 2 | Generated derived types + rewrite of the ABP (D2) | The pass also lowers `READ … BY \_assoc`, `LINK` and `CREATE BY \_assoc`, which the transpiler does not handle: they are common features of a non-draft BO. |
| 3 | Fastify (D3) | |
| 4 | Reads through generated SQL views (D4) | |
| 5 | Additions to the OData scope (D5) | |
| 6 | Path of the service modeled on RAP, configurable (D6) | |
| 7 | Fixture activatable on a real system (D7) | The global authorization of the fixture is really run, not only accepted. |
| 8 | Timestamps as `timestamptz(6)` (D8) | |
| 9 | Client removed (D9) | |
| 10 | OpenUI5 1.136 LTS, `sap.m`, `sap.f`, `sap.uxap` (D10) | |
| 11 | Serialized ABP execution (D11) | The lock is reentrant for the LUW that holds it. |
| 12 | `@open-rap/*`, `rapt` CLI, MIT license (D12) | |
| 13 | Extract of the SAP-samples corpus to test the parsers (D13) | |

Complementary decisions (D14 to D21): complete non-draft scope, runtime driven by the IR,
canonical representation of the values, toolchain, PGlite for the tests, "shadow" DDIC for the
transpiler, semantics of `mandatory`, triggering of the determinations.

---

## Appendix A — requests of the conformance suite

Shapes sent by the UI5 ODataModel V4 and by a Fiori Elements V4 List Report / Object Page. Paths
relative to the root of the service, except the first line.

```
HEAD /sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001/       X-CSRF-Token: Fetch
GET  $metadata                                                         Accept: application/xml
POST $batch                         Content-Type: multipart/mixed;boundary=batch_id-1731160000000-12

--batch_id-1731160000000-12
Content-Type:application/http
Content-Transfer-Encoding:binary

GET Travel?$count=true&$select=AgencyID,BeginDate,CurrencyCode,EndDate,OverallStatus,TotalPrice,TravelID,TravelUUID&$skip=0&$top=30 HTTP/1.1
Accept:application/json;odata.metadata=minimal;IEEE754Compatible=true
Accept-Language:en


--batch_id-1731160000000-12--
```

| # | Case | Request (in the `$batch`) |
|---|---|---|
| 1 | Initial list | `GET Travel?$count=true&$select=…&$skip=0&$top=30` |
| 2 | Filter bar | `GET Travel?$count=true&$filter=OverallStatus eq 'O' and (AgencyID eq '070001' or AgencyID eq '070002')&$select=…&$skip=0&$top=30` |
| 3 | Date range | `$filter=BeginDate ge 2026-01-01 and BeginDate le 2026-12-31` |
| 4 | Contains, starts with | `$filter=contains(Description,'Paris')`, `$filter=startswith(TravelID,'000')` |
| 5 | Exclusion | `$filter=not (OverallStatus eq 'X')`, `$filter=OverallStatus ne 'X'` |
| 6 | Sorting | `$orderby=BeginDate desc,TravelID` |
| 7 | Search | `$search=Paris` |
| 8 | Scrolling | `$skip=30&$top=30` |
| 9 | Object Page | `GET Travel(3f2504e0-4f89-11d3-9a0c-0305e82c3301)?$select=…` |
| 10 | Table of the Object Page | `GET Travel(3f2504e0-…)/_Booking?$count=true&$orderby=BookingID&$select=BookingID,BookingUUID,CurrencyCode,FlightDate,FlightPrice&$skip=0&$top=10` |
| 11 | Expand | `GET Booking(…)?$select=…&$expand=_Travel($select=TravelID,TravelUUID)` |
| 12 | Update (changeset) | `PATCH Travel(…)`, `If-Match: W/"…"`, body `{"EndDate":"2026-12-24"}` |
| 13 | Creation with children (changeset) | `POST Travel`, body `{"TravelID":"00000042", …, "_Booking":[{…}]}` |
| 14 | Creation of a child (changeset) | `POST Travel(…)/_Booking` |
| 15 | Deletion (changeset) | `DELETE Booking(…)`, `If-Match: W/"…"` |
| 16 | Action | `POST Travel(…)/com.sap.gateway.srvd.zrt_ui_travel.v0001.acceptTravel`, `If-Match`, body `{}`, possibly followed by `?$select=…` |
| 17 | Error cases | Stale ETag → 412; missing `If-Match` → 428; unknown property in `$select` → 400; failed validation → 400 with `details[].target`; unknown key → 404 |
