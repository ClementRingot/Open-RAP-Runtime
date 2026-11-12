# rap-transpiler guide

This guide describes everything rap-transpiler can do and how to use it. It is written for ABAP
developers and for AI agents who write a RAP business object (BO) with it: each section gives the
command, the file to write and the resulting behavior, with a link to the technical decision
(`Dxx`, in [DECISIONS.md](DECISIONS.md)) that gives the details.

- Status, feature by feature: [FEATURES.md](FEATURES.md)
- Diagnostic codes: [DIAGNOSTICS.md](DIAGNOSTICS.md)
- Known gaps: [KNOWN_GAPS.md](../KNOWN_GAPS.md) · Roadmap: [ROADMAP.md](ROADMAP.md)

## 1. The principle

You write a RAP BO as in the ABAP Development Tools (ADT): tables, CDS views, metadata
extensions, behavior definition (BDEF), behavior pool in ABAP, service definition and binding.
rap-transpiler compiles these sources (abapGit format) into a standalone Node.js application:

- an **OData V4** service identical to the one of SAP (same paths, `$metadata`, `$batch`, ETags);
- the **RAP managed runtime**: locks, numbering, authorizations, feature control,
  determinations, validations, actions, messages, EML;
- the **ABAP behavior pool transpiled** to JavaScript (abaplint), run as is;
- a **PostgreSQL** database (or embedded PGlite in development);
- an **OpenUI5 UI** List Report / Object Page generated from the `@UI` annotations;
- a **launchpad**, an **MCP server** for AI agents, **deployment** files.

The sources stay activatable on SAP: the same abapGit repository is imported into an ABAP Cloud
or S/4HANA system (in `standard` mode, see §4).

## 2. Getting started

### With VS Code (recommended)

Install the `rap-transpiler-vscode.vsix` extension (it contains rapt, OpenUI5 and PGlite:
nothing else to install), then in the command palette (`Ctrl+Shift+P`):

| Command | Effect |
|---|---|
| *RAP: New complete business object…* | `rapt new`: a complete managed BO (table, CDS, BDEF, behavior pool, service, binding), with initial data; possible in an empty folder |
| *RAP: New RAP object…* | create object by object with the wizard, like *New ABAP Repository Object* of ADT: the types by category (Dictionary, Core Data Services, Behavior, Business Services, Source Code Library), a filter, a description, the fields of the type (source object, exposed entities, binding type…) |
| *RAP: Choose the floorplan of the application…* | `rapt floorplan`: List Report, Worklist, Analytical List Page or Form Entry, with what each one needs; asked anyway before the first generation |
| *RAP: Show the intermediate representation* | `rapt ir`: the model (`model.json`) in an editor |
| *RAP: Generate a launchpad* | `rapt launchpad`: the launchpad of several applications |
| *RAP: Start rapt dev* | builds, starts and opens the development launchpad; restarts on each save |
| *RAP: Check the BO* | `rapt check`: diagnostics in the Problems tab (also on each save) |
| *RAP: Build the application…* | `rapt build`: the deployable application |
| *RAP: Generate the abapGit files* | `rapt abapgit`: the missing XML files for the import into SAP |
| *RAP: Generate the MCP server of the service* | `rapt mcp`: the tools for AI agents |
| *RAP: Choose the project mode* | `standard` or `enhanced` (`rapt/config.json`) |

A right click on a folder of the explorer arranges these commands in three groups: **create**
(complete BO, object by object), **project** (check, abapGit), **application** (floorplan, rapt
dev, build). A command is greyed out as long as it is not possible: the project commands outside
an abapGit project, the application commands as long as the project has no service definition.
Before the application is built or started, the floorplan of each root entity must have been
chosen: the extension asks for it when it was not ([D66](DECISIONS.md)).

The **RAP Objects** view of the explorer arranges the objects of the project like the project
explorer of ADT (dictionary, data definitions, metadata extensions, access controls, behavior
definitions, services, classes); its title bar creates an object, checks the project and starts
`rapt dev` ([D61](DECISIONS.md)).

Syntax highlighting covers ABAP, CDS (DDLS, DDLX, DCL, SRVD, tables, types) and BDEF.

The integrated terminals of VS Code have the `rapt` command of the extension (setting
`rapt.terminal.addToPath`), and the agent mode of VS Code finds the MCP server of rapt (§13).

### On the command line

```sh
rapt new my-project Travel --prefix ZRT    # a complete managed BO
rapt dev my-project                         # http://localhost:8080/: development launchpad
```

Install it with `npm install -g rap-transpiler` (Node.js 22): the package installs the `rapt`
command with everything it needs (runtime, OpenUI5, PGlite) ([D65](DECISIONS.md)). Without a
global installation: `npx rap-transpiler <command>` (for example `npx rap-transpiler check
my-project` in a CI), or `rap-transpiler` as a `devDependency` of the project and `npx rapt …`.
The libraries `@rap-transpiler/compiler`, `@rap-transpiler/runtime` and `@rap-transpiler/model`
are published separately too. From a clone of the repository: `pnpm install && pnpm build`,
then `node packages/compiler/dist/cli.js` instead of `rapt`.

## 3. The project

```
my-project/
  .abapgit.xml                 folder of the sources (STARTING_FOLDER), written by rapt abapgit
  src/                         the objects, in abapGit format
    zrt_travel.tabl.astabl     table written as source (ADT "define table" syntax)
    zrt_r_travel.ddls.asddls   root CDS view
    zrt_c_travel.ddls.asddls   projection
    zrt_c_travel.ddlx.asddlxs  metadata extension (UI)
    zrt_r_travel.bdef.asbdef   behavior definition
    zbp_rt_r_travel.clas.*     behavior pool
    zrt_ui_travel.srvd.srvdsrv service definition
    *.xml                      abapGit metadata (generated by rapt abapgit)
  rapt/                        configuration of rap-transpiler (never imported into SAP)
    config.json                mode of the project (standard / enhanced)
    seed.json, seed.sql        initial data of rapt dev
    authorizations.json        roles → authorizations (authorization objects)
    number-ranges.json         number range intervals
    mcp.json                   MCP tools and their descriptions
  .rapt/                       build of rapt dev (ignored by git)
```

Tables are written as source (`.tabl.astabl`): `rapt abapgit` derives the XML abapGit expects
from them ([D42](DECISIONS.md)). The other XML files are generated when they are missing; an
existing XML file is never changed.

## 4. `standard` and `enhanced` modes

`rapt/config.json` ([D45](DECISIONS.md)):

```json
{ "mode": "enhanced" }
```

| | `standard` (default) | `enhanced` |
|---|---|---|
| Goal | As on SAP: what builds activates on SAP | Extensions of rap-transpiler |
| Managed BO + unmanaged save on a custom entity | refused (BDEF027) | allowed ([D43](DECISIONS.md)) |
| `field ( mandatory )` | a hint for the UI, as in RAP | checked on save, one message per field, without a validation to write |
| Exposed element of a CDS enumerated type | refused as on SAP (CDS021) | OData `EnumType`: `"Status": "OPEN"`, labels and choice list in the UI ([D55](DECISIONS.md)) |

`rapt check --mode enhanced` (or `build`, `dev`) overrides the mode of the file.

## 5. Writing the objects

### Creating an object: `rapt generate`

```sh
rapt generate . table zshop_order
rapt generate . view ZR_ShopOrder --from zshop_order --root
rapt generate . projection ZC_ShopOrder --from ZR_ShopOrder
rapt generate . metadata ZC_ShopOrder
rapt generate . behavior ZR_ShopOrder          # managed BDEF, with the compositions
rapt generate . pool ZBP_R_SHOPORDER           # handlers of the BDEF that names the class
rapt generate . behavior ZC_ShopOrder          # projection BDEF
rapt generate . access ZC_ShopOrder            # DCL
rapt generate . service ZUI_SHOPORDER --expose ZC_ShopOrder,ZC_ShopItem
rapt generate . binding ZUI_SHOPORDER_O4 --for ZUI_SHOPORDER
rapt generate . dataelement ZSHOP_ORDER_NO --type abap.numc(8)
rapt generate . domain ZSHOP_STATUS --type abap.char(1)
rapt generate . tableentity ZSHOP_ITEM --root   # table entity: table and entity in one object
rapt generate . type ZSHOP_NAME                 # CDS simple type
rapt generate . enum ZSHOP_STATUS               # CDS enumerated type
```

`rapt generate . ` without a type lists the types. Each object is derived from the previous one as
in the wizards of ADT; the abapGit XML is written with it ([D46](DECISIONS.md)).

### CDS

- `define [root] view entity … as select from <table>`, `as projection on`, `provider contract
  transactional_query`, `composition`, `association to parent`, associations, `redirected to`.
- Metadata extensions (`@Metadata.allowExtensions: true`) merged with the view.
- Abstract entities (action parameters), custom entities (`@ObjectModel.query.implementedBy`,
  `if_rap_query_provider` class).
- Access controls (DCL): `grant select … where`, `aspect pfcg_auth`, `aspect user`
  ([D35](DECISIONS.md)).
- No expressions in the select list (CASE, CAST, calculations, paths): CDS002.

#### Table entities and CDS types ([D55](DECISIONS.md))

A table entity combines the table and the entity; a managed BO is written directly on it, without
a `persistent table`:

```cds
@ClientHandling.type: #CLIENT_DEPENDENT
@AbapCatalog.deliveryClass: #APPLICATION_DATA
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Orders'
define root table entity ZRT_ORDER
{
  key OrderId  : abap.numc(8);
      Name     : zrt_order_name;     // CDS simple type
      Status   : zrt_order_status;   // CDS enumerated type
      Note     : abap.string null;
}
```

CDS types are `<name>.drty.acds` sources (AFF format of abapGit, metadata `<name>.drty.json`
written by `rapt abapgit`):

```cds
@EndUserText.label: 'Order status'
define type ZRT_ORDER_STATUS : abap.char(1) enum
{
  @EndUserText.label: 'New'
  NEW = initial;
  @EndUserText.label: 'Open'
  OPEN = 'O';
}
```

The database keeps the base value (`'O'`); the behavior pool writes the constants as on SAP
(`Status = zrt_order_status-open`). SAP does not expose enumerated types in a RAP OData service:
in `standard` mode, CDS021; in `enhanced` mode, the `$metadata` has an `EnumType`, the JSON
carries the name of the member (`"Status": "OPEN"`) and `$filter=Status eq 'OPEN'` works.
Complete example: `fixtures/table-entity`.

### SAP standard views

`I_Currency`, `I_UnitOfMeasure`, `I_Country`, `I_Language`, `I_Region`, `I_TimeZone` and their
text views, `I_CalendarDate` (calendar 1990-2060), `I_BusinessUserBasic` (the users of the IdP,
recorded on their first request) and `I_ExchangeRate` (rates to load) exist as on SAP, with their
data: just name them ([D44](DECISIONS.md)).

```cds
@Consumption.valueHelpDefinition: [{ entity: { name: 'I_Currency', element: 'Currency' } }]
CurrencyCode,
```

The entity of the value help is exposed automatically (as in RAP); the UI opens a selection
dialog with the descriptions. `additionalBinding` (`#FILTER`, `#RESULT`),
`useForValidation: true` and an entity with `@ObjectModel.resultSet.sizeCategory: #XS`
(drop-down list) are supported ([D56](DECISIONS.md)).

### Behavior definition

A complete managed RAP BO, with or without draft: `strict ( 2 )`, `lock master` / `dependent`,
`etag master` / `dependent`, `global` / `instance` authorizations, managed, external or early
numbering, `create`/`update`/`delete` (internal, `precheck`, `features`), `readonly`,
`mandatory`, `readonly : update`, `features : instance` fields, `on modify` / `on save`
determinations, validations, actions (instance, static, factory, internal, with parameters and
results), functions, `with additional save`, `with unmanaged save`, `with privileged mode`,
projections (`use …`), side effects. Details and exceptions: [FEATURES.md](FEATURES.md).

**Draft** ([D54](DECISIONS.md)): `with draft;`, one `draft table` per entity (BDEF028
otherwise), `total etag`, `draft action Edit; draft action Activate optimized; draft action
Discard; draft action Resume; draft determine action Prepare;`. The draft table does not have to
exist: it is generated. The service has the `IsActiveEntity` key, `HasDraftEntity`,
`DraftAdministrativeData` and the actions of SAP; determinations and validations run on
activation. The UI follows Fiori Elements: *Editing Status* filter, *Locked by X*,
"Draft updated", *Keep Draft* when leaving the page ([D58](DECISIONS.md)).

**Collaborative draft** ([D59](DECISIONS.md)): `with collaborative draft;` and `draft action
Share;`; several users edit the same draft (*Invite* button, or *Edit* on an instance already in
draft).

### Behavior pool (ABAP)

The ABAP Cloud code of the handlers and of the saver is transpiled as is: complete EML
(`READ`/`MODIFY ENTITIES`, `IN LOCAL MODE`, `BY \_assoc`, `EXECUTE`), `failed`/`reported`/`mapped`,
messages (`new_message_with_text`, message classes, exception classes), `AUTHORITY-CHECK`, ABAP
SQL reads on the tables and entities of the project, writes in `save_modified`.

Available released classes: JSON (`/ui2/cl_json`, `xco_cp_json`), encodings, dates
(`cl_abap_tstmp`, `xco_cp_time`), numbering (`cl_numberrange_runtime`), application log
(`cl_bali_*`), hashing, random numbers, regular expressions, RTTS ([UTILITIES.md](UTILITIES.md)),
background processing (`cl_bgmc_process_factory`) and e-mail (`cl_bcs_mail_message`)
([D41](DECISIONS.md)), HTTP client and OData client proxy ([REMOTE_APIS.md](REMOTE_APIS.md)).

### The `rapt/` configuration

| File | Content | Decision |
|---|---|---|
| `config.json` | `{ "mode": "standard" \| "enhanced", "ui": { "floorplans": …, "overview": … } }` | [D45](DECISIONS.md), [D53](DECISIONS.md) |
| `seed.json` | `{ "table": [ { "field": "value" } ] }`: data loaded on the first start of `rapt dev` (`SEED=auto`); random UUID keys | [D42](DECISIONS.md) |
| `seed.sql` | data in SQL | [D42](DECISIONS.md) |
| `authorizations.json` | roles of the IdP → authorization objects and values (`{claim:agency}`: value read from the token) | [D34](DECISIONS.md) |
| `number-ranges.json` | intervals of `cl_numberrange_runtime` | [D40](DECISIONS.md) |
| `mcp.json` | MCP tools and their descriptions | [D47](DECISIONS.md) |

## 6. The generated UI

The List Report and the Object Page follow the `@UI` annotations: `headerInfo`, `lineItem`
(columns and table actions), `selectionField`, `identification` (header fields and actions),
`fieldGroup`, `facet` (sections, tables of the compositions, header), `dataPoint`,
`presentationVariant` (sorting), `hidden`, `multiLineText`, `textArrangement`, criticality,
`@Consumption.filter`. The complete list, annotation by annotation: [ANNOTATIONS.md](ANNOTATIONS.md).

- **Filters**: conditions as in SAP Fiori, several per field:

  | Input | Meaning |
  |---|---|
  | `Rome` | text: contains "Rome" (case-insensitive); other types: equal |
  | `=Rome`, `!=Rome` | equal, not equal |
  | `>100`, `>=100`, `<100`, `<=100` | comparisons |
  | `1...5` | range (bounds included) |
  | `Ro*`, `*me`, `*om*` | starts with, ends with, contains |
  | `<empty>` | empty (text: `''` or `null`) |
  | `!(*om*)`, `!(1...5)`, `!(<empty>)` | exclusions: does not contain, outside the range, not empty… |

  A string of digits (NUMC) is entered without its leading zeros (`3` finds `00000003`); a single
  value looks for equality for a key or a field with a value help. Dates are entered in the
  format of the language or in ISO (`Jun 1, 2026 - Jul 31, 2026`, `2026-06-01...2026-07-31`).
  The icon of the field opens the dialog of SAP Fiori elements ([D68](DECISIONS.md)): *Search
  and Select* (values of the value help, when the field has one) and *Define Conditions*
  (operator and values per row: *equal to*, *contains*, *between*, *greater than*, *empty*, their
  exclusions…, according to the type of the field and `@Consumption.filter.selectionType`); the
  included conditions of a field are combined with "or", the exclusions with "and not". *Adapt
  Filters* adds the columns as filters; *Clear* empties everything.
- **User views** (variants): the title of the List Report opens the view management: save the
  filters, the visible columns and the sorting under a name, choose the default view. They are
  saved per user in the database of the application ([D51](DECISIONS.md)).
- **Table settings** (gear icon): visible columns, sorting.
- **Object Page**: edit, create, delete, actions (parameter dialog), editable tables of the
  compositions, value helps, breadcrumbs, messages of the BO.
- The buttons follow the authorizations and the feature control of the user.
- **Draft**: Create and Edit open a draft, each field is saved in it, Save activates, Cancel
  discards; the list shows the instances being edited.

**Floorplans** ([D53](DECISIONS.md)): the List Report is the default on the command line. To
choose one: *RAP: Choose the floorplan of the application…* in VS Code (each floorplan is
described with the annotations it reads; the extension also asks for it before building or
starting an application whose floorplan was not chosen), or `rapt floorplan . Travel worklist`;
without arguments, `rapt floorplan .` lists the entity sets, their floorplan and whether it was
chosen. Both write `rapt/config.json` (the List Report too, once chosen):

```json
{
  "ui": {
    "floorplans": { "Travel": "analyticalListPage" },
    "overview": {
      "title": "Travel Overview",
      "cards": [
        { "type": "kpi", "entitySet": "Travel", "title": "Revenue", "measure": "TotalPrice" },
        { "type": "list", "entitySet": "Travel", "title": "Open travels", "filter": "OverallStatus eq 'O'", "top": 4 },
        { "type": "chart", "entitySet": "Travel", "title": "By currency", "chart": "ByCurrency" }
      ]
    }
  }
}
```

| Floorplan | Annotations read |
|---|---|
| `listReport` | `lineItem`, `selectionField`, `presentationVariant` |
| `worklist` | one tab per qualified `@UI.selectionVariant` (`filter: 'OverallStatus EQ ''O'''`) |
| `analyticalListPage` | the first `@UI.chart` (dimension, measures, `#COLUMN`, `#BAR`, `#LINE`, `#PIE`, `#DONUT`), read with `$apply` |
| `formEntry` | the Object Page, for creation only |
| `overview` | `kpi`, `list`, `table`, `chart` cards of `rapt/config.json` |

## 7. Developing: `rapt dev`

```sh
rapt dev my-project [--port 8080] [--host 0.0.0.0] [--mode enhanced]
```

- Builds the application, starts it with an embedded PGlite database (`.rapt/dev/data`),
  rebuilds it on each save; a build in error keeps the previous one running.
- `http://localhost:8080/`: the **development launchpad** — the application (with the number of
  its instances), the **documentation** (this documentation, with search), the `$metadata` and,
  with `rapt/mcp.json`, the MCP server ([D49](DECISIONS.md)).
- Data kept between builds; database reset when the schema changes.
- No sign-in (`AUTH_MODE=none`); `DEV_ROLES` and `DEV_ATTRIBUTES` simulate a user and their
  authorizations.

## 8. AI agents: MCP server

`rapt mcp` writes `rapt/mcp.json`; the application then serves `/mcp`: one tool per operation of
the service (list, read, create, update, delete, actions), run with the checks of the BO. Guide:
[MCP.md](MCP.md).

## 9. Launchpad

`rapt launchpad launchpad.json --out out/launchpad` builds an OpenUI5 launchpad in front of
several applications: a single origin, a single OIDC sign-in, tiles by role, counters, intent
navigation ([D37](DECISIONS.md)). Content in groups, or in **spaces and pages**
([D48](DECISIONS.md)):

```json
{
  "title": "Travel Agency",
  "apps": [{ "id": "travel", "build": "out/travel", "url": "http://localhost:8080/" }],
  "spaces": [{
    "title": "Travels", "roles": ["travel_agent"],
    "pages": [{ "title": "Management", "sections": [{
      "title": "Travel Management",
      "tiles": [{ "title": "Manage Travels", "app": "travel", "intent": "Travel-manage",
                  "icon": "sap-icon://flight", "count": "Travel" }]
    }] }]
  }]
}
```

## 10. Shipping

- `rapt build my-project --out out/travel`: the application (Node.js, Docker, Cloud Foundry).
- `rapt abapgit my-project`: the XML files to import the repository into SAP with abapGit
  (`--check` in CI).
- Deployment (Docker, SAP BTP Cloud Foundry, local network, HTTPS): [DEPLOYMENT.md](DEPLOYMENT.md).

The folder of a generated application:

```
model/model.json     intermediate representation read by the runtime
db/schema.sql        PostgreSQL tables and views (reference data of the standard views included)
odata/metadata.xml   $metadata (CSDL with the UI annotations)
abap/                transpiled behavior pool; abap/src/: the ABAP given to the transpiler
ui/                  OpenUI5 UI (List Report, Object Pages)
mcp/tools.json       MCP tools (with rapt/mcp.json)
package.json, server.mjs, vendor/   startup; vendor/ bundles the runtime
Dockerfile, docker-compose.yml, keycloak/, manifest.yml   container, PostgreSQL, Keycloak, Cloud Foundry
```

## 11. CLI reference

`rapt` comes with the VS Code extension (on the PATH of its terminals) or from npm
(`npm install -g rap-transpiler`, [D65](DECISIONS.md)).


| Command | Purpose |
|---|---|
| `rapt check <src>` | diagnostics (`file:line:column: severity CODE message`), exit code 1 on error |
| `rapt build <src> --out <dir>` | generated application |
| `rapt dev <src>` | development loop |
| `rapt new <src> <Entity> [--prefix ZRT] [--description …]` | complete BO |
| `rapt generate <src> <type> <name> [--from X] [--for Y] [--expose A,B] [--root]` | one object |
| `rapt floorplan <src> [<EntitySet> <floorplan>]` | floorplan of the application |
| `rapt abapgit <src> [--check]` | missing abapGit XML files |
| `rapt mcp <src>` | MCP tools (`rapt/mcp.json`) |
| `rapt launchpad <launchpad.json> --out <dir>` | launchpad |
| `rapt ir <src> [--out f]` | intermediate representation (JSON) |
| `rapt agent [<workspace>]` | MCP server (stdio) of rapt for AI coding agents (§13) |

Common options: `--service <SRVD>` (several service definitions), `--mode`, `--json` (output for
tools: one JSON object; one event per line for `rapt dev`), `--warnings-as-errors`.

## 12. Environment variables of the application

| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `HOST` | 8080, 0.0.0.0 | listening |
| `PUBLIC_URL` | `http://localhost:<PORT>/` | public address (OIDC); Cloud Foundry route |
| `DATABASE_URL`, `DATABASE_CA` | — | PostgreSQL and certificate; bound Cloud Foundry service |
| `PGLITE_DIR` | — | embedded database (development) |
| `SCHEMA` | `apply` | `skip`: schema managed separately |
| `SEED` | — | `auto`: initial data on the first start |
| `AUTH_MODE` | `none` | `oidc`: bearer tokens and browser sessions |
| `DEV_USER`, `DEV_ROLES`, `DEV_ATTRIBUTES` | — | development user |
| `DEV_OAUTH`, `DEV_OAUTH_CLIENTS` | `on` in `rapt dev` | development OAuth 2.0 server under `/oauth` (D60) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUDIENCE`, `OIDC_REQUIRED_ROLE` | — | identity provider |
| `SESSION_SECRET` | — | signature of the sessions (shared with the launchpad) |
| `AUTHORIZATIONS_FILE` | — | roles replacing `rapt/authorizations.json` |
| `DESTINATION_<NAME>_URL`, `_USER`, `_PASSWORD`, `_TOKEN`, `_HEADERS` | — | remote APIs |
| `MAIL_SMTP_URL`, `MAIL_FROM` | — | e-mails |
| `MCP` | — | `off`: no MCP server |
| `UI` | — | `off`: no UI |
| `LOG_LEVEL` | `info` | log |

## 12b. Web APIs and OAuth 2.0

A service bound as *OData V4 - Web API* (`BINDING_TYPE_CATEGORY` 1 in the SRVB, or
`rapt generate . binding ZAPI_TRAVEL_O4 --for ZUI_TRAVEL --binding-type webapi`) has neither UI
nor UI annotations; a draft BO only exposes its active instances there ([D60](DECISIONS.md)).

In development, `rapt dev` serves an OAuth 2.0 server under `/oauth`:

```sh
# client credentials (machine to machine)
curl -u rapt-client:rapt-secret -d grant_type=client_credentials http://localhost:8080/oauth/token
curl -H "Authorization: Bearer <access_token>" http://localhost:8080/sap/opu/odata4/…/Travel

# authorization code + PKCE (Postman, Bruno…): client rapt-pkce, without a secret
#   Auth URL  http://localhost:8080/oauth/authorize   Token URL  http://localhost:8080/oauth/token
#   Code challenge method SHA-256; the sign-in page asks for the user and their roles
```

In production (`AUTH_MODE=oidc`), the tokens come from the IdP, with either flow; a *client
credentials* token acts on behalf of its client (technical user), with the roles of the token
(`OIDC_ROLES_CLAIM=scope` to read the scopes).

## 13. For an AI agent writing a BO

An agent uses rapt in either of two ways ([D64](DECISIONS.md)):

- **Commands**: `rapt check <src> --json` and the other commands of §11. In VS Code, `rapt` is on
  the PATH of the integrated terminals; elsewhere, `npm install -g rap-transpiler`.
- **MCP server** `rapt agent`: in VS Code, the agent mode finds it by itself (*RAP Transpiler*
  extension, setting `rapt.agent.enabled`). Other clients start it:
  `claude mcp add rapt -- rapt agent .` (Claude Code), or in a `.mcp.json` file
  `{ "mcpServers": { "rapt": { "command": "rapt", "args": ["agent", "."] } } }`.

| Tool | Purpose |
|---|---|
| `rapt_projects` | the RAP projects of the workspace |
| `rapt_check` | diagnostics of a project (compiled, nothing written) |
| `rapt_object_types` | the object types of `rapt_generate` and the floorplans |
| `rapt_generate`, `rapt_new_business_object` | create an object, or a complete business object |
| `rapt_floorplan`, `rapt_abapgit` | floorplan of the UI, abapGit XML files |
| `rapt_docs_search`, `rapt_docs_read` | the documentation of rap-transpiler (this guide, codes, annotations, known gaps…) |

Then:

1. Read the project (`src/`, `rapt/`); `rapt check <src> --json` gives the diagnostics with
   absolute paths, line and column.
2. Write the sources as in ADT; for a new object, prefer `rapt generate` (right file names and
   XML); for a new BO, `rapt new`.
3. After each change: `rapt check` until there are zero errors; the codes are explained in
   [DIAGNOSTICS.md](DIAGNOSTICS.md); what is not supported is in
   [KNOWN_GAPS.md](../KNOWN_GAPS.md) with the workaround.
4. Check the behavior: `rapt dev <src> --json` (`ready` event), then the OData
   (`/sap/opu/odata4/…`) or the MCP server (`/mcp`).
5. Stay in `standard` mode if the BO must activate on SAP; only switch to `enhanced` for its
   extensions, explicitly.
6. Never edit `.rapt/` nor the `<standard>/…` files (generated).
