# Diagnostic codes

`rapt check` prints the diagnostics in the format `file:line:column: severity CODE message`. The
exit code is 1 as soon as there is an error (or a warning with `--warnings-as-errors`).

| Code | Severity | Meaning |
|---|---|---|
| PRJ001 | error | No service definition, or several without `--service` |
| PRJ002 | error | The requested service definition does not exist |
| SRVD001 | error | Syntax error in a service definition |
| SRVD002 | warning | Several bindings for the service |
| SRVD003 | warning | Binding that is not OData V4 |
| SRVD004 | error | Entity set exposed twice |
| SRVD005 | error | Exposed entity not found |
| SRVD006 | info | Association to an entity that is not exposed: navigation omitted |
| SRVD007 | info | Several service definitions: the one with a binding is built (the others, of a service consumption model for example, are not) |
| SRVD008 | error | `--binding-type` other than `ui` or `webapi` (D60) |
| CDS001 | error | Unreadable CDS source |
| CDS002 | error or warning | Unsupported CDS construct; in a calculated element, the message names the construct (association path, session variable other than `$session.system_date`, `BETWEEN`, aggregate, unsupported SQL function) (D67) |
| CDS003 | error | Unknown data source or projected entity |
| CDS004 | error | Unknown element in the source |
| CDS005 | error | Unknown association or redirection target |
| CDS006 | warning | Metadata extension for an unknown entity |
| CDS007 | warning | Metadata extension ignored (`@Metadata.allowExtensions` missing) |
| CDS008 | warning | Metadata extension on an unknown element |
| CDS009 | warning | Client field not exposed |
| CDS010 | error | Unsupported ON condition |
| CDS011 | error | Entity without a key |
| CDS012 | warning | Composition or association to parent not redirected in the projection |
| CDS013 | error | The projection does not expose the fields an association needs |
| CDS014 | error | Unknown type in an abstract entity |
| CDS015 | error | Composition without an association to parent in the child |
| CDS016 | error | Custom entity without `@ObjectModel.query.implementedBy: 'ABAP:<class>'` |
| CDS017 | error | Query class of a custom entity missing from the sources |
| CDS018 | warning | Value help (`@Consumption.valueHelpDefinition`) on an unknown entity: value help omitted |
| CDS019 | error | Table entity name longer than 25 characters (D55) |
| CDS020 | error | Table entity element: `null` key, key after a non-key element, `abap.string` or `abap.rawstring` without `null` (D55) |
| CDS021 | error | Element of a CDS enumerated type in an exposed entity: SAP does not expose enumerated types in RAP OData services. In `enhanced` mode, OData enumeration type (D55) |
| CDS022 | error | Invalid calculated element: type that cannot be derived (`NULL` alone, calculation on a string: add a `CAST`), unknown type in a `CAST`, number of arguments of a function, circular or unknown `$projection` reference, calculated element that is a key or has no alias (D67) |
| TYPE001 | error | Unreadable CDS type source (`.drty.acds`), or name different from the one of the file (D55) |
| TYPE002 | error | CDS type based on an unknown type (D55) |
| TYPE003 | error | Wrong CDS enumerated type: base type (`abap.int1`, `int2`, `int4`, `char(1..8)`, `numc(1..8)`), not exactly one `initial` constant, value outside the base type, duplicate constants or values (D55) |
| DDIC001 | error | Unknown data element |
| DDIC002 | error | Unsupported data type |
| DDIC003 | error | Unsupported included structure |
| DDIC004 | warning | Table class other than transparent |
| DDIC005 | info | Table of the project left out of the database (it cannot be built and no entity uses it) |
| DDIC010 | error | Unreadable table definition |
| TABL001 | error | Error in the source of a table (`.tabl.astabl`): syntax, unknown type, name different from the one of the file, table without a key |
| TABL002 | warning | Construct of the source of a table not carried over to the abapGit XML (foreign key) |
| BDEF001 | error | BDEF syntax error |
| BDEF002 | error | Out-of-scope feature (unmanaged, late numbering…) |
| BDEF003 | warning | Construct ignored |
| BDEF004 | error | Unknown CDS entity |
| BDEF005 | error | Unknown element |
| BDEF006 | error | Unknown association |
| BDEF007 | error | Unknown persistent table |
| BDEF008 | error | Mapping inconsistent with the CDS view or the table |
| BDEF009 | error | Element without a matching column |
| BDEF010 | error | Implementation type missing |
| BDEF011 | error | Behavior pool required |
| BDEF012 | error | Statement forbidden in this type of BDEF |
| BDEF013 | error | Managed BDEF on something other than a view entity |
| BDEF014 | error | Persistent table missing |
| BDEF015 | error | Lock definition missing or invalid |
| BDEF016 | warning | Strict mode without an authorization definition |
| BDEF017 | error | `numbering : managed` on a field that is not a UUID key |
| BDEF018 | warning | `create` on a child entity |
| BDEF019 | error | Create by association on something other than a composition |
| BDEF020 | warning | Determination without a trigger |
| BDEF021 | error | Unknown parameter or result entity |
| BDEF022 | error | Factory action with a result, or function without a result |
| BDEF023 | error | The projection reuses a feature missing from the base |
| BDEF024 | error | Composition child without behavior |
| BDEF025 | error | Child entity without an association to parent |
| BDEF026 | error | Projection BDEF on something other than a projection of a managed BO |
| BDEF027 | error or info | Managed BO with unmanaged save on a custom entity: an extension of rap-transpiler, not activatable on SAP (D43). Error in `standard` mode, info in `enhanced` mode (D45) |
| BDEF028 | error | Draft BO (`with draft`) with an entity without a `draft table` (D54) |
| BDEF029 | error | `with collaborative draft` without `draft action Share` (D59) |
| ABP001 | error | Behavior pool not found |
| ABP002 | error | Missing handler method, or missing saver class (with `save_modified`) for additional or unmanaged save |
| ABP003 | warning | Handler or saver method without a matching BDEF element (including an undeclared precheck, a saver without additional or unmanaged save): it is not called |
| ABP004 | error | ABAP error (abaplint): syntax of the original sources, complete check of the rewritten sources, at the original line |
| ABP005 | error | Malformed EML statement or unsupported form (`OPERATIONS`, `RELATING TO`…) |
| ABP006 | error | Unknown name in the EML or a derived type: BDEF, entity, field, association, action |
| ABP007 | error | Unsupported construct: ABAP SQL write outside the saver class, `DELETE dbtab FROM @wa`, `WITH`, `SELECT … ENDSELECT` with a field list, `adjust_numbers`, EML on a projection, `GET PERMISSIONS`, out-of-scope derived type or handler |
| ABP008 | error | Internal error (generated ABAP) or error of the transpiler |
| ABP009 | error | Result of a `SELECT` abaplint does not type (literal, aggregate other than `COUNT(*)`, `MAX` and `MIN`, expression) in an inline declaration: declare the target |
| ABP010 | error | `AUTHORITY-CHECK` on a field the authorization object does not have |
| ABP011 | warning | `AUTHORITY-CHECK` on an authorization object neither in the sources (SUSO) nor in `rapt/authorizations.json`: no role grants it |
| DCL001 | error | Unreadable access control (DCL), or circular inheritance |
| DCL002 | warning | Condition of an access control the application does not evaluate: it grants no row |
| DCL003 | warning | Unknown element, association or entity in an access control, or not exposed by the projection: the condition grants no row |
| DCL004 | error or warning | `aspect pfcg_auth` on a field the authorization object does not have (error), or on an unknown object (warning) |
| AUTH001 | error | Unreadable or malformed authorization object or `rapt/authorizations.json` |
| AUTH002 | warning | Role granting an unknown authorization object (its fields are not checked) |
| AUTH003 | error | Role giving a value to a field the authorization object does not have |
| AUTH004 | warning | Role granting an activity (`ACTVT`) the authorization object does not allow |
| LPD001 | error | Unreadable or malformed `launchpad.json`: groups, titles, id or URL of an application, roles of a tile |
| LPD002 | error | Tile without a target, with two targets (`app` and `url`), or of an unknown application |
| LPD003 | error or warning | Application folder not generated by `rapt build` (error); application whose services are not known, neither `build` nor `servicePaths` (warning) |
| LPD004 | error | Intent not of the form `SemanticObject-action` |
| LPD005 | error | Service path under a path of the launchpad (`/ui`, `/apps`, `/auth`…), or served by two applications |
| LPD006 | error | Counter on an entity set unknown to the service, or on a tile without an application |
| LPD007 | warning | Role of a tile missing from the `rapt/authorizations.json` of the applications (the IdP must still give it) |
| LPD008 | error | Malformed space or page in `launchpad.json` (title, pages, sections, roles) (D48) |
| SEED001 | error | Unreadable or malformed `rapt/seed.json` (object table → array of rows expected) |
| SEED002 | error | `rapt/seed.json`: table or field unknown to the application |
| NR001 | error | Unreadable or malformed `rapt/number-ranges.json`: object longer than 10 characters, interval longer than 2 characters, non-numeric or inverted bounds |
| CFG001 | error | Unreadable `rapt/config.json`, or unknown mode (`standard` or `enhanced`), in the file or `--mode` (D45) |
| CFG002 | warning | Unknown setting in `rapt/config.json`, ignored |
| CFG003 | error | Malformed `ui` of `rapt/config.json`: unknown floorplan, incomplete Overview Page card, entity set missing from the service (D53) |
| MCP001 | error | Unreadable or malformed `rapt/mcp.json` (D47) |
| MCP002 | warning | `rapt/mcp.json` describes a tool the service no longer has: run `rapt mcp` again |
| APP001 | error | Runtime packages not found (`dist/` not built) for the generated application: `--runtime <folder>` or `pnpm build` |
