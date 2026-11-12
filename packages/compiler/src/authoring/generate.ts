/**
 * `rapt generate <src> <kind> <name>` (decision D46): one new object with the file names abapGit
 * expects, like the creation wizards of the ABAP Development Tools. A skeleton when there is
 * nothing to start from; derived from an existing object otherwise (`--from`): a view entity from
 * its table, a projection from its view, a metadata extension, an access control or a behavior
 * definition from an entity, a behavior pool from its behavior definition. The abapGit XML is
 * written too (`rapt abapgit`). An existing file is never overwritten.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getAnnotation, isUuid, type EntityModel, type FieldModel, type TableModel } from "@rap-transpiler/model";
import { parseBdef } from "../bdef/parser.js";
import { abapGitXml, xmlElement } from "../ddic/table-source.js";
import { Diagnostics } from "../diagnostics.js";
import { filesOfType, loadProject, type Project } from "../input/project.js";
import { Dictionary } from "../ir/dictionary.js";
import { EntityResolver } from "../ir/entities.js";
import { generateAbapGitFiles } from "./abapgit.js";

export const OBJECT_KINDS = {
  table: "database table (.tabl.astabl)",
  view: "CDS view entity, from a table with --from (.ddls.asddls)",
  projection: "CDS projection view, from a view with --from (.ddls.asddls)",
  abstract: "CDS abstract entity, e.g. an action parameter (.ddls.asddls)",
  custom: "CDS custom entity and its query class (.ddls.asddls, .clas.abap)",
  tableentity: "CDS table entity: a table and its entity, the persistence of a BO (.ddls.asddls)",
  type: "CDS simple type (.drty.acds)",
  enum: "CDS enumerated type (.drty.acds)",
  metadata: "metadata extension (UI annotations) of an entity (.ddlx.asddlxs)",
  access: "access control (DCL) of an entity (.dcls.asdcls)",
  behavior: "behavior definition of a root view or projection (.bdef.asbdef)",
  pool: "behavior pool of a behavior definition, with its handlers (.clas.abap, .clas.locals_imp.abap)",
  class: "ABAP class (.clas.abap)",
  interface: "ABAP interface (.intf.abap)",
  service: "service definition, exposing --expose A,B (.srvd.srvdsrv)",
  binding: "OData V4 UI service binding of a service definition --for (.srvb.xml)",
} as const;

export type ObjectKind = keyof typeof OBJECT_KINDS;

export interface GenerateObjectOptions {
  /** Object the new one is derived from: table (view), view (projection), entity (metadata, access, behavior). */
  from?: string;
  /** Behavior definition of a pool, service definition of a binding. */
  for?: string;
  /** Entities a service definition exposes. */
  expose?: string[];
  /** View entity: `define root view entity`. */
  root?: boolean;
  /** Binding: ui (default) or webapi (D60). */
  bindingType?: string;
  description?: string;
}

export interface GenerateObjectResult {
  /** Files written, relative to the project root. */
  written: string[];
  error?: string;
}

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function sourceFolder(root: string): string {
  const dotAbapGit = path.join(root, ".abapgit.xml");
  const folder = existsSync(dotAbapGit) ? (/<STARTING_FOLDER>([^<]*)<\/STARTING_FOLDER>/.exec(readFileSync(dotAbapGit, "utf8"))?.[1] ?? "/src/") : "/src/";
  return path.join(root, folder.replace(/^\/+/, ""));
}

/** `travel_uuid` → `TravelUUID`, `agency_id` → `AgencyID`, `begin_date` → `BeginDate`. */
export function elementName(column: string): string {
  return column
    .toLowerCase()
    .split("_")
    .filter((p) => p !== "")
    .map((p) => (p === "uuid" || p === "id" ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("");
}

/** `ZR_Travel` → `Travel`, `ZRT_C_Booking` → `Booking`: the alias of an entity in a BDEF. */
export function aliasOf(entity: string): string {
  const parts = entity.split("_");
  const last = parts[parts.length - 1] ?? entity;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/** The behavior pool of a BDEF, as SAP names it: `ZR_TRAVEL` → `ZBP_R_TRAVEL`. */
export function poolName(bdef: string): string {
  const upper = bdef.toUpperCase();
  const rest = upper.replace(/^[ZY]_?/, "");
  return `${upper.charAt(0) === "Y" ? "Y" : "Z"}BP_${rest}`.slice(0, 30);
}

const ADMIN: Record<string, string> = {
  ABP_CREATION_USER: "@Semantics.user.createdBy: true",
  ABP_CREATION_TSTMPL: "@Semantics.systemDateTime.createdAt: true",
  ABP_LASTCHANGE_USER: "@Semantics.user.lastChangedBy: true",
  ABP_LASTCHANGE_TSTMPL: "@Semantics.systemDateTime.lastChangedAt: true",
  ABP_LOCINST_LASTCHANGE_TSTMPL: "@Semantics.systemDateTime.localInstanceLastChangedAt: true",
};

const label = (text: string): string => text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/'/g, "''");

interface Context {
  project: Project;
  entities: EntityResolver;
  dictionary: Dictionary;
}

function context(root: string): Context {
  const project = loadProject(root);
  const diagnostics = new Diagnostics();
  const dictionary = new Dictionary(project, diagnostics);
  return { project, dictionary, entities: new EntityResolver(project, dictionary, diagnostics) };
}

function entity(ctx: Context, name: string | undefined, what: string): EntityModel | string {
  if (name === undefined) {
    return `${what}: give the entity with --from`;
  }
  return ctx.entities.resolve(name) ?? `${name}: no CDS entity of that name in the sources`;
}

// ------------------------------------------------------------------------------------- templates

function tableSource(name: string, description: string): string {
  return `@EndUserText.label : '${description}'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table ${name} {
  key client            : abap.clnt not null;
  key uuid              : sysuuid_x16 not null;
  description           : abap.char(256);
  created_by            : abp_creation_user;
  created_at            : abp_creation_tstmpl;
  last_changed_by       : abp_lastchange_user;
  last_changed_at       : abp_lastchange_tstmpl;
  local_last_changed_at : abp_locinst_lastchange_tstmpl;
}
`;
}

function viewSource(name: string, table: TableModel, root: boolean, description: string): string {
  const columns = table.columns.filter((c) => !c.client);
  const width = Math.max(...columns.map((c) => c.name.length)) + 1;
  const elements = columns.map((c) => {
    const admin = ADMIN[c.type.dataElement ?? ""];
    const lines = [`      @EndUserText.label: '${label(elementName(c.name))}'`, ...(admin === undefined ? [] : [`      ${admin}`])];
    return `${lines.join("\n")}\n${c.key ? "  key " : "      "}${c.name.padEnd(width)}as ${elementName(c.name)}`;
  });
  return `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: '${description}'
define ${root ? "root " : ""}view entity ${name}
  as select from ${table.name}
{
${elements.join(",\n")}
}
`;
}

/**
 * The name of the projection of another entity, by the same renaming as `name` ← `base`:
 * ZC_Travel ← ZR_Travel gives ZC_Booking ← ZR_Booking.
 */
function renamed(name: string, base: string, target: string): string {
  let common = 0;
  while (common < Math.min(name.length, base.length) && name[name.length - 1 - common]?.toUpperCase() === base[base.length - 1 - common]?.toUpperCase()) {
    common++;
  }
  const from = base.slice(0, base.length - common);
  const to = name.slice(0, name.length - common);
  return from !== "" && target.toUpperCase().startsWith(from.toUpperCase()) ? `${to}${target.slice(from.length)}` : target;
}

function projectionSource(name: string, base: EntityModel, description: string): string {
  const associations = base.associations.map((a) => {
    const target = renamed(name, base.name, a.target);
    switch (a.kind) {
      case "composition":
        return `      ${a.name} : redirected to composition child ${target}`;
      case "toParent":
        return `      ${a.name} : redirected to parent ${target}`;
      default:
        return `      ${a.name}`;
    }
  });
  const elements = [...base.fields.map((f) => `${f.key ? "  key " : "      "}${f.name}`), ...associations];
  return `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: '${description}'
@Metadata.allowExtensions: true
@Search.searchable: true
define ${base.root ? "root " : ""}view entity ${name}
  provider contract transactional_query
  as projection on ${base.name}
{
${elements.join(",\n")}
}
`;
}

function abstractSource(name: string, description: string): string {
  return `@EndUserText.label: '${description}'
define abstract entity ${name}
{
  Value : abap.char(40);
}
`;
}

function tableEntitySource(name: string, root: boolean, description: string): string {
  return `@ClientHandling.type: #CLIENT_DEPENDENT
@AbapCatalog.deliveryClass: #APPLICATION_DATA
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: '${description}'
define ${root ? "root " : ""}table entity ${name}
{
  key ID          : abap.char(10);
      Description : abap.char(40);
}
`;
}

function simpleTypeSource(name: string, description: string): string {
  return `@EndUserText.label: '${description}'
define type ${name} : abap.char(40);
`;
}

function enumTypeSource(name: string, description: string): string {
  return `@EndUserText.label: '${description}'
define type ${name} : abap.char(1) enum
{
  @EndUserText.label: 'Initial'
  INITIAL_VALUE = initial;
  @EndUserText.label: 'Value A'
  VALUE_A = 'A';
}
`;
}

function customSource(name: string, query: string, description: string): string {
  return `@EndUserText.label: '${description}'
@ObjectModel.query.implementedBy: 'ABAP:${query.toUpperCase()}'
define custom entity ${name}
{
  key ID          : abap.char(10);
      Description : abap.char(40);
}
`;
}

function queryClass(name: string, entityName: string): string {
  return `"! <p class="shorttext synchronized">Query of ${entityName}</p>
CLASS ${name.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_rap_query_provider.
ENDCLASS.



CLASS ${name.toLowerCase()} IMPLEMENTATION.

  METHOD if_rap_query_provider~select.
    DATA rows TYPE STANDARD TABLE OF ${entityName.toLowerCase()} WITH EMPTY KEY.
    " read the data (an API, a table…), then apply the filter, the sort order and the paging
    IF io_request->is_total_numb_of_rec_requested( ).
      io_response->set_total_number_of_records( lines( rows ) ).
    ENDIF.
    IF io_request->is_data_requested( ).
      io_response->set_data( rows ).
    ENDIF.
  ENDMETHOD.

ENDCLASS.
`;
}

function metadataSource(target: EntityModel): string {
  const visible = target.fields.filter((f) => !(isUuid(f.type) && f.key) && getAnnotation(f.annotations, "Semantics.systemDateTime.localInstanceLastChangedAt") !== true);
  const title = visible.find((f) => !f.key || target.fields.length === 1) ?? target.fields[0];
  const typeName = aliasOf(target.name);
  const blocks = target.fields.map((f, i) => {
    if (!visible.includes(f)) {
      return `${i === 0 ? "" : "\n"}  @UI.hidden: true\n  ${f.name};`;
    }
    const position = (visible.indexOf(f) + 1) * 10;
    const selection = visible.indexOf(f) < 3 ? `,\n         selectionField: [ { position: ${position} } ]` : "";
    return `${i === 0 ? "" : "\n"}  @UI: { lineItem:       [ { position: ${position}, importance: #${visible.indexOf(f) < 3 ? "HIGH" : "MEDIUM"} } ],
         identification: [ { position: ${position} } ]${selection} }
  ${f.name};`;
  });
  const facet = `  @UI.facet: [ { id: '${typeName}', purpose: #STANDARD, type: #IDENTIFICATION_REFERENCE, label: '${typeName}', position: 10 } ]\n`;
  return `@Metadata.layer: #CORE
@UI.headerInfo: {
  typeName: '${typeName}',
  typeNamePlural: '${typeName.endsWith("s") ? typeName : `${typeName}s`}'${title === undefined ? "" : `,\n  title: { type: #STANDARD, value: '${title.name}' }`}
}
annotate entity ${target.name} with
{
${facet}${blocks.join("\n")}
}
`;
}

function accessSource(target: EntityModel, description: string): string {
  return `@EndUserText.label: '${description}'
@MappingRole: true
define role ${target.name} {
  grant select on ${target.name};
}
`;
}

/** A managed BDEF on a root view entity and its compositions, or a projection BDEF. */
function behaviorSource(ctx: Context, rootEntity: EntityModel): string {
  const tree: Array<{ entity: EntityModel; parent?: { entity: EntityModel; toParent: string; foreignKey: string[] } }> = [];
  const walk = (current: EntityModel, parent?: { entity: EntityModel; toParent: string; foreignKey: string[] }): void => {
    tree.push(parent === undefined ? { entity: current } : { entity: current, parent });
    for (const composition of current.associations.filter((a) => a.kind === "composition")) {
      const child = ctx.entities.resolve(composition.target);
      const toParent = child?.associations.find((a) => a.kind === "toParent");
      if (child !== undefined && toParent !== undefined) {
        walk(child, { entity: current, toParent: toParent.name, foreignKey: toParent.on.map((o) => o.source) });
      }
    }
  };
  walk(rootEntity);
  const compositions = (e: EntityModel): string[] => e.associations.filter((a) => a.kind === "composition").map((a) => `  association ${a.name} { create; }`);
  if (rootEntity.kind === "projection") {
    return `projection;
strict ( 2 );
${tree
  .map(({ entity: e, parent }) => {
    const etag = e.fields.some((f) => isAdmin(f, "localInstanceLastChangedAt")) ? "\nuse etag" : "";
    const ops = parent === undefined ? ["  use create;", "  use update;", "  use delete;"] : ["  use update;", "  use delete;"];
    const associations = [...e.associations.filter((a) => a.kind === "composition").map((a) => `  use association ${a.name} { create; }`), ...(parent === undefined ? [] : [`  use association ${parent.toParent};`])];
    return `
define behavior for ${e.name} alias ${aliasOf(e.name)}${etag}
{
${[...ops, ...(associations.length === 0 ? [] : ["", ...associations])].join("\n")}
}`;
  })
  .join("\n")}
`;
  }
  const root = tree[0]?.entity ?? rootEntity;
  return `managed implementation in class ${poolName(root.name).toLowerCase()} unique;
strict ( 2 );
${tree
  .map(({ entity: e, parent }) => {
    const table = e.source ?? "";
    const etagField = e.fields.find((f) => isAdmin(f, "localInstanceLastChangedAt"));
    const uuidKeys = e.fields.filter((f) => f.key && isUuid(f.type));
    const readonly = e.fields.filter((f) => f.semantics !== undefined).map((f) => f.name);
    const parentKeys = parent === undefined ? [] : e.fields.filter((f) => !f.key && parent.foreignKey.some((k) => k.toUpperCase() === f.name.toUpperCase())).map((f) => f.name);
    const header = [
      `define behavior for ${e.name} alias ${aliasOf(e.name)}`,
      `persistent table ${table}`,
      parent === undefined ? "lock master" : `lock dependent by ${parent.toParent}`,
      parent === undefined ? "authorization master ( global )" : `authorization dependent by ${parent.toParent}`,
      ...(etagField === undefined ? [] : [`etag master ${etagField.name}`]),
    ];
    const body = [
      ...(parent === undefined ? ["  create;", "  update;", "  delete;"] : ["  update;", "  delete;"]),
      "",
      ...(uuidKeys.length === 1 ? [`  field ( numbering : managed, readonly ) ${uuidKeys[0]?.name ?? ""};`] : []),
      ...(readonly.length + parentKeys.length > 0 ? [`  field ( readonly ) ${[...parentKeys, ...readonly].join(", ")};`] : []),
      ...compositions(e),
      ...(parent === undefined ? [] : [`  association ${parent.toParent};`]),
      "",
      `  mapping for ${table} corresponding`,
      "  {",
      ...e.fields.filter((f) => f.column !== undefined).map((f) => `    ${f.name} = ${f.column ?? ""};`),
      "  }",
    ];
    return `\n${header.join("\n")}\n{\n${body.join("\n").replace(/\n\n\n/g, "\n\n")}\n}`;
  })
  .join("\n")}
`;
}

function isAdmin(field: FieldModel, semantics: string): boolean {
  return field.semantics === semantics;
}

function classSource(name: string, description: string): string {
  return `"! <p class="shorttext synchronized">${description}</p>
CLASS ${name.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.



CLASS ${name.toLowerCase()} IMPLEMENTATION.
ENDCLASS.
`;
}

function interfaceSource(name: string, description: string): string {
  return `"! <p class="shorttext synchronized">${description}</p>
INTERFACE ${name.toLowerCase()} PUBLIC.
ENDINTERFACE.
`;
}

/** The behavior pool of a managed BDEF: one handler per entity, global authorization. */
function poolSources(name: string, bdefName: string, bdefSource: string): { global: string; locals: string } | string {
  const parsed = parseBdef(bdefSource);
  if (parsed.ast === undefined) {
    return `${bdefName}: the behavior definition does not parse (${parsed.errors[0]?.message ?? ""})`;
  }
  const root = parsed.ast.behaviors.find((b) => b.root) ?? parsed.ast.behaviors[0];
  if (root === undefined) {
    return `${bdefName}: no "define behavior for" in the behavior definition`;
  }
  const handlers = parsed.ast.behaviors.map((b) => {
    const alias = b.alias?.text ?? b.entity.text;
    const local = `lhc_${alias}`.slice(0, 30);
    const authorization = b.options.some((o) => o.kind === "authorizationMaster");
    const definition = authorization
      ? `
  PRIVATE SECTION.
    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR ${alias} RESULT result.`
      : "";
    const implementation = authorization
      ? `
  METHOD get_global_authorizations.
    " every activity is allowed: check the authorizations here (AUTHORITY-CHECK OBJECT …)
    IF requested_authorizations-%create = if_abap_behv=>mk-on.
      result-%create = if_abap_behv=>auth-allowed.
    ENDIF.
    IF requested_authorizations-%update = if_abap_behv=>mk-on.
      result-%update = if_abap_behv=>auth-allowed.
    ENDIF.
    IF requested_authorizations-%delete = if_abap_behv=>mk-on.
      result-%delete = if_abap_behv=>auth-allowed.
    ENDIF.
  ENDMETHOD.
`
      : "";
    return `CLASS ${local} DEFINITION INHERITING FROM cl_abap_behavior_handler.${definition}
ENDCLASS.

CLASS ${local} IMPLEMENTATION.${implementation}
ENDCLASS.`;
  });
  return {
    global: `"! <p class="shorttext synchronized">Behavior pool of ${root.entity.text.toUpperCase()}</p>
CLASS ${name.toLowerCase()} DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF ${root.entity.text.toLowerCase()}.
ENDCLASS.



CLASS ${name.toLowerCase()} IMPLEMENTATION.
ENDCLASS.
`,
    locals: `${handlers.join("\n\n")}\n`,
  };
}

function serviceSource(name: string, exposed: string[], description: string): string {
  return `@EndUserText.label: '${description}'
define service ${name} {
${exposed.map((e) => `  expose ${e} as ${aliasOf(e)};`).join("\n")}
}
`;
}

function bindingSource(name: string, service: string, description: string, webApi = false): string {
  const services = `    <SERVICES>
     <item>
      <NAME>${name.toUpperCase()}</NAME>
      <VERSIONS>
       <item>
        <SERVICE_VERSION>0001</SERVICE_VERSION>
        <SERVICE_DEFINITION>${service.toUpperCase()}</SERVICE_DEFINITION>
        <RELEASE_STATE>NOT_RELEASED</RELEASE_STATE>
       </item>
      </VERSIONS>
     </item>
    </SERVICES>`;
  const header = xmlElement(
    "SRVB",
    [
      ["NAME", name.toUpperCase()],
      ["DESCRIPTION", description.slice(0, 60)],
      ["LANGUAGE", "EN"],
      ["BINDING_TYPE", "ODATA"],
      ["BINDING_TYPE_VERSION", "V4"],
      ["BINDING_TYPE_CATEGORY", webApi ? "1" : "0"],
    ],
    3,
  );
  return abapGitXml("SRVB", header.replace(/\n {3}<\/SRVB>$/, `\n${services}\n   </SRVB>`));
}

// ------------------------------------------------------------------------------------- command

/** Writes a new object into the project `dir`. */
export function generateObject(dir: string, kind: string, name: string, options: GenerateObjectOptions = {}): GenerateObjectResult {
  const root = path.resolve(dir);
  if (!(kind in OBJECT_KINDS)) {
    return { written: [], error: `${kind}: unknown kind, one of ${Object.keys(OBJECT_KINDS).join(", ")}` };
  }
  if (!NAME.test(name)) {
    return { written: [], error: `${name}: an object name is made of letters, digits and _, starting with a letter` };
  }
  const limit = kind === "table" ? 16 : kind === "tableentity" ? 25 : 30;
  if (name.length > limit) {
    return { written: [], error: `${name}: at most ${limit} characters` };
  }
  const src = sourceFolder(root);
  const description = options.description ?? label(aliasOf(name));
  const lower = name.toLowerCase();
  const files: Array<[string, string]> = [];
  const ctx = (): Context => context(root);
  switch (kind as ObjectKind) {
    case "table":
      files.push([`${lower}.tabl.astabl`, tableSource(lower, description)]);
      break;
    case "view": {
      if (options.from === undefined) {
        return { written: [], error: "rapt generate view needs the table: --from <table>" };
      }
      const table = ctx().dictionary.table(options.from.toLowerCase(), new Diagnostics());
      if (table === undefined) {
        return { written: [], error: `${options.from}: no table of that name in the sources` };
      }
      files.push([`${lower}.ddls.asddls`, viewSource(name, table, options.root === true, description)]);
      break;
    }
    case "projection": {
      const base = entity(ctx(), options.from, "rapt generate projection");
      if (typeof base === "string") return { written: [], error: base };
      files.push([`${lower}.ddls.asddls`, projectionSource(name, base, description)]);
      break;
    }
    case "abstract":
      files.push([`${lower}.ddls.asddls`, abstractSource(name, description)]);
      break;
    case "tableentity":
      files.push([`${lower}.ddls.asddls`, tableEntitySource(name, options.root === true, description)]);
      break;
    case "type":
      files.push([`${lower}.drty.acds`, simpleTypeSource(name, description)]);
      break;
    case "enum":
      files.push([`${lower}.drty.acds`, enumTypeSource(name, description)]);
      break;
    case "custom": {
      const query = options.for ?? `zcl_${lower.replace(/^[zy]_?/, "")}_query`.slice(0, 30);
      files.push([`${lower}.ddls.asddls`, customSource(name, query, description)], [`${query.toLowerCase()}.clas.abap`, queryClass(query, name)]);
      break;
    }
    case "metadata": {
      const target = entity(ctx(), options.from ?? name, "rapt generate metadata");
      if (typeof target === "string") return { written: [], error: target };
      files.push([`${lower}.ddlx.asddlxs`, metadataSource(target)]);
      break;
    }
    case "access": {
      const target = entity(ctx(), options.from ?? name, "rapt generate access");
      if (typeof target === "string") return { written: [], error: target };
      files.push([`${lower}.dcls.asdcls`, accessSource(target, description)]);
      break;
    }
    case "behavior": {
      const c = ctx();
      const target = entity(c, options.from ?? name, "rapt generate behavior");
      if (typeof target === "string") return { written: [], error: target };
      if (!target.root) {
        return { written: [], error: `${target.name}: a behavior definition is defined for a root entity` };
      }
      if (target.kind !== "view" && target.kind !== "projection") {
        return { written: [], error: `${target.name}: a behavior definition needs a view entity or a projection` };
      }
      files.push([`${lower}.bdef.asbdef`, behaviorSource(c, target)]);
      break;
    }
    case "pool": {
      const project = loadProject(root);
      const bdefs = filesOfType(project, "BDEF").filter((f) => f.extension === "asbdef");
      const bdef =
        options.for === undefined
          ? bdefs.find((f) => new RegExp(`implementation\\s+in\\s+class\\s+${name}\\b`, "i").test(f.content))
          : bdefs.find((f) => f.name === options.for?.toUpperCase());
      if (bdef === undefined) {
        return { written: [], error: options.for === undefined ? `no behavior definition names the class ${name}: give it with --for <BDEF>` : `${options.for}: no behavior definition of that name` };
      }
      const sources = poolSources(name, bdef.name, bdef.content);
      if (typeof sources === "string") return { written: [], error: sources };
      files.push([`${lower}.clas.abap`, sources.global], [`${lower}.clas.locals_imp.abap`, sources.locals]);
      break;
    }
    case "class":
      files.push([`${lower}.clas.abap`, classSource(name, description)]);
      break;
    case "interface":
      files.push([`${lower}.intf.abap`, interfaceSource(name, description)]);
      break;
    case "service": {
      const exposed = options.expose ?? (options.from === undefined ? [] : [options.from]);
      if (exposed.length === 0) {
        return { written: [], error: "rapt generate service needs the exposed entities: --expose A,B" };
      }
      files.push([`${lower}.srvd.srvdsrv`, serviceSource(name, exposed, description)]);
      break;
    }
    case "binding": {
      const service = options.for ?? options.from;
      if (service === undefined) {
        return { written: [], error: "rapt generate binding needs the service definition: --for <SRVD>" };
      }
      // --binding-type webapi: OData V4 - Web API (D60)
      const webApi = options.bindingType?.toLowerCase() === "webapi";
      files.push([`${lower}.srvb.xml`, bindingSource(name, service, `${description} (OData V4, ${webApi ? "Web API" : "UI"})`, webApi)]);
      break;
    }
  }
  const absolute = files.map(([file, content]): [string, string] => [path.join(src, file), content]);
  const existing = absolute.filter(([file]) => existsSync(file)).map(([file]) => path.relative(root, file));
  if (existing.length > 0) {
    return { written: [], error: `already present: ${existing.join(", ")}` };
  }
  const written: string[] = [];
  for (const [file, content] of absolute) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    written.push(path.relative(root, file).split(path.sep).join("/"));
  }
  const abapGit = generateAbapGitFiles(root);
  written.push(...abapGit.written.filter((f) => !written.includes(f)));
  return { written };
}
