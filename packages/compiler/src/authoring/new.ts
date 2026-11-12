/**
 * `rapt new` (decision D42): the sources of a new managed business object, ready to run with
 * `rapt dev` and to pull into an SAP system with abapGit — a table written as source, the root
 * and projection CDS entities with UI annotations, the behavior definitions and pool, the service
 * definition and binding, seed data — then their abapGit XML (`rapt abapgit`).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { abapGitXml, xmlElement } from "../ddic/table-source.js";
import { generateAbapGitFiles } from "./abapgit.js";

export interface NewBoOptions {
  /** Prefix of the object names (default Z): ZRT → table zrt_travel, ZRT_R_Travel, ZBP_RT_R_TRAVEL. */
  prefix?: string;
  /** Description of the business object (default: the entity name). */
  description?: string;
}

export interface NewBoResult {
  /** Files written, relative to the project root. */
  written: string[];
  error?: string;
}

const pad = (text: string, width: number): string => text.padEnd(width);

export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

interface Names {
  entity: string;
  snake: string;
  table: string;
  root: string;
  projection: string;
  pool: string;
  service: string;
  binding: string;
  description: string;
}

export function boNames(entity: string, options: NewBoOptions = {}): Names | { error: string } {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(entity)) {
    return { error: `${entity}: the entity name is made of letters and digits, e.g. Travel or SalesOrder` };
  }
  const prefix = (options.prefix ?? "Z").toUpperCase().replace(/_+$/, "");
  if (!/^[ZY][A-Z0-9_]*$/.test(prefix)) {
    return { error: `${prefix}: the prefix starts with Z or Y (customer namespace)` };
  }
  const name = entity.charAt(0).toUpperCase() + entity.slice(1);
  const snake = snakeCase(name);
  const short = prefix.replace(/^[ZY]_?/, "");
  const names: Names = {
    entity: name,
    snake,
    table: `${prefix}_${snake}`.toLowerCase(),
    root: `${prefix}_R_${name}`,
    projection: `${prefix}_C_${name}`,
    pool: `${prefix.charAt(0)}BP_${short === "" ? "" : `${short}_`}R_${snake}`.toLowerCase(),
    service: `${prefix}_UI_${snake}`.toUpperCase(),
    binding: `${prefix}_UI_${snake}_O4`.toUpperCase(),
    description: options.description ?? name,
  };
  if (names.table.length > 16) {
    return { error: `${names.table}: a table name has at most 16 characters, use a shorter prefix or entity name` };
  }
  for (const n of [names.root, names.projection, names.pool, names.service, names.binding]) {
    if (n.length > 30) {
      return { error: `${n}: an object name has at most 30 characters, use a shorter prefix or entity name` };
    }
  }
  return names;
}

interface Field {
  column: string;
  element: string;
  type: string;
  /** Administrative field: CDS annotation. */
  semantics?: string;
  label: string;
}

function fields(n: Names): Field[] {
  return [
    { column: `${n.snake}_uuid`, element: `${n.entity}UUID`, type: "sysuuid_x16", label: "UUID" },
    { column: `${n.snake}_id`, element: `${n.entity}ID`, type: "abap.numc(8)", label: `${n.entity} ID` },
    { column: "description", element: "Description", type: "abap.char(256)", label: "Description" },
    { column: "status", element: "Status", type: "abap.char(1)", label: "Status" },
    { column: "created_by", element: "CreatedBy", type: "abp_creation_user", semantics: "@Semantics.user.createdBy: true", label: "Created By" },
    { column: "created_at", element: "CreatedAt", type: "abp_creation_tstmpl", semantics: "@Semantics.systemDateTime.createdAt: true", label: "Created At" },
    { column: "last_changed_by", element: "LastChangedBy", type: "abp_lastchange_user", semantics: "@Semantics.user.lastChangedBy: true", label: "Changed By" },
    { column: "last_changed_at", element: "LastChangedAt", type: "abp_lastchange_tstmpl", semantics: "@Semantics.systemDateTime.lastChangedAt: true", label: "Changed At" },
    {
      column: "local_last_changed_at",
      element: "LocalLastChangedAt",
      type: "abp_locinst_lastchange_tstmpl",
      semantics: "@Semantics.systemDateTime.localInstanceLastChangedAt: true",
      label: "Local Changed At",
    },
  ];
}

function tableSource(n: Names): string {
  const all = fields(n);
  const width = Math.max(...all.map((f) => f.column.length), "client".length) + 4;
  const lines = [
    `  key ${pad("client", width - 4)} : abap.clnt not null;`,
    ...all.map((f, i) => (i === 0 ? `  key ${pad(f.column, width - 4)} : ${f.type} not null;` : `  ${pad(f.column, width)} : ${f.type};`)),
  ];
  return `@EndUserText.label : '${n.description}'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table ${n.table} {
${lines.join("\n")}
}
`;
}

function rootView(n: Names): string {
  const all = fields(n);
  const width = Math.max(...all.map((f) => f.column.length)) + 1;
  const elements = all.map((f, i) => {
    const annotations = [`@EndUserText.label: '${f.label}'`, ...(f.semantics === undefined ? [] : [f.semantics])].map((a) => `      ${a}\n`).join("");
    return `${annotations}${i === 0 ? "  key " : "      "}${pad(f.column, width)}as ${f.element}`;
  });
  return `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: '${n.description}'
define root view entity ${n.root}
  as select from ${n.table}
{
${elements.join(",\n")}
}
`;
}

function projectionView(n: Names): string {
  const all = fields(n);
  const elements = all.map((f, i) => {
    const search = f.element === `${n.entity}ID` || f.element === "Description" ? "      @Search.defaultSearchElement: true\n" : "";
    return `${search}${i === 0 ? "  key " : "      "}${f.element}`;
  });
  return `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: '${n.description} (projection)'
@Metadata.allowExtensions: true
@Search.searchable: true
define root view entity ${n.projection}
  provider contract transactional_query
  as projection on ${n.root}
{
${elements.join(",\n")}
}
`;
}

function metadataExtension(n: Names): string {
  const plural = n.entity.endsWith("s") ? n.entity : `${n.entity}s`;
  return `@Metadata.layer: #CORE
@UI.headerInfo: {
  typeName: '${n.description}',
  typeNamePlural: '${plural}',
  title: { type: #STANDARD, value: '${n.entity}ID' },
  description: { type: #STANDARD, value: 'Description' }
}
@UI.presentationVariant: [ { sortOrder: [ { by: '${n.entity}ID', direction: #DESC } ] } ]
annotate entity ${n.projection} with
{
  @UI.facet: [ { id: '${n.entity}', purpose: #STANDARD, type: #IDENTIFICATION_REFERENCE, label: '${n.description}', position: 10 } ]
  @UI.hidden: true
  ${n.entity}UUID;

  @UI: { lineItem:       [ { position: 10, importance: #HIGH } ],
         identification: [ { position: 10 } ],
         selectionField: [ { position: 10 } ] }
  ${n.entity}ID;

  @UI: { lineItem:       [ { position: 20, importance: #HIGH } ],
         identification: [ { position: 20 } ] }
  Description;

  @UI: { lineItem:       [ { position: 30, importance: #MEDIUM } ],
         identification: [ { position: 30 } ],
         selectionField: [ { position: 20 } ] }
  Status;

  @UI.identification: [ { position: 40 } ]
  CreatedBy;

  @UI.identification: [ { position: 50 } ]
  LastChangedAt;

  @UI.hidden: true
  CreatedAt;

  @UI.hidden: true
  LastChangedBy;

  @UI.hidden: true
  LocalLastChangedAt;
}
`;
}

function behavior(n: Names): string {
  const all = fields(n);
  const width = Math.max(...all.map((f) => f.element.length)) + 1;
  return `managed implementation in class ${n.pool} unique;
strict ( 2 );

define behavior for ${n.root} alias ${n.entity}
persistent table ${n.table}
lock master
authorization master ( global )
etag master LocalLastChangedAt
{
  create;
  update;
  delete;

  field ( numbering : managed, readonly ) ${n.entity}UUID;
  field ( readonly ) Status, CreatedBy, CreatedAt, LastChangedBy, LastChangedAt, LocalLastChangedAt;
  field ( mandatory ) ${n.entity}ID, Description;

  determination setStatus on modify { create; }

  mapping for ${n.table} corresponding
  {
${all.map((f) => `    ${pad(f.element, width)}= ${f.column};`).join("\n")}
  }
}
`;
}

function projectionBehavior(n: Names): string {
  return `projection;
strict ( 2 );

define behavior for ${n.projection} alias ${n.entity}
use etag
{
  use create;
  use update;
  use delete;
}
`;
}

function pool(n: Names): string {
  return `"! <p class="shorttext synchronized">Behavior pool of ${n.root.toUpperCase()}</p>
CLASS ${n.pool} DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF ${n.root.toLowerCase()}.
ENDCLASS.



CLASS ${n.pool} IMPLEMENTATION.
ENDCLASS.
`;
}

function handler(n: Names): string {
  const local = `lhc_${n.entity}`.slice(0, 30);
  return `CLASS ${local} DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR ${n.entity} RESULT result.

    METHODS setStatus FOR DETERMINE ON MODIFY
      IMPORTING keys FOR ${n.entity}~setStatus.
ENDCLASS.

CLASS ${local} IMPLEMENTATION.

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

  METHOD setStatus.
    " a new ${n.entity.toLowerCase()} starts with the status N (new)
    READ ENTITIES OF ${n.root.toLowerCase()} IN LOCAL MODE
      ENTITY ${n.entity}
        FIELDS ( Status ) WITH CORRESPONDING #( keys )
      RESULT DATA(instances).

    DELETE instances WHERE Status IS NOT INITIAL.
    CHECK instances IS NOT INITIAL.

    MODIFY ENTITIES OF ${n.root.toLowerCase()} IN LOCAL MODE
      ENTITY ${n.entity}
        UPDATE FIELDS ( Status )
        WITH VALUE #( FOR instance IN instances ( %tky = instance-%tky Status = 'N' ) ).
  ENDMETHOD.

ENDCLASS.
`;
}

function serviceDefinition(n: Names): string {
  return `@EndUserText.label: '${n.description} service'
define service ${n.service} {
  expose ${n.projection} as ${n.entity};
}
`;
}

function serviceBinding(n: Names): string {
  const services = `    <SERVICES>
     <item>
      <NAME>${n.binding}</NAME>
      <VERSIONS>
       <item>
        <SERVICE_VERSION>0001</SERVICE_VERSION>
        <SERVICE_DEFINITION>${n.service}</SERVICE_DEFINITION>
        <RELEASE_STATE>NOT_RELEASED</RELEASE_STATE>
       </item>
      </VERSIONS>
     </item>
    </SERVICES>`;
  const header = xmlElement(
    "SRVB",
    [
      ["NAME", n.binding],
      ["DESCRIPTION", `${n.description} service binding (OData V4, UI)`.slice(0, 60)],
      ["LANGUAGE", "EN"],
      ["BINDING_TYPE", "ODATA"],
      ["BINDING_TYPE_VERSION", "V4"],
      ["BINDING_TYPE_CATEGORY", "0"],
    ],
    3,
  );
  return abapGitXml("SRVB", header.replace(/\n {3}<\/SRVB>$/, `\n${services}\n   </SRVB>`));
}

function seed(n: Names): string {
  const rows = [1, 2].map((i) => ({ [`${n.snake}_id`]: String(i), description: `${n.description} ${i}`, status: "N" }));
  return `${JSON.stringify({ [n.table]: rows }, null, 2)}\n`;
}

/** AGENTS.md of a new project: how an AI agent works on a RAP project with Open RAP Runtime. */
function agentsFile(n: Names): string {
  return `# AGENTS.md

This project is a SAP RAP business object (${n.description}) in abapGit format, run without an SAP
system by Open RAP Runtime (\`rapt\`). The same sources are imported into SAP with abapGit.

## Commands

\`\`\`sh
rapt check .            # diagnostics: file:line:column: severity CODE message (--json for tools)
rapt dev .              # http://localhost:8080/: the app, rebuilt on every save (--json: events)
rapt generate . <kind> <name> [--from X]   # a new object with the right file names (no kind: list)
rapt abapgit .          # the abapGit XML files the sources lack
rapt mcp .              # rapt/mcp.json: the MCP tools of the service, to describe
rapt agent .            # MCP server (stdio) of rapt for coding agents: check, objects, documentation
\`\`\`

\`rapt\` is on the PATH of the terminals of VS Code with the Open RAP Runtime extension; elsewhere,
\`npm install -g open-rap-runtime\` (or \`npx open-rap-runtime …\`). In VS Code, the agent mode also
finds the MCP server of rapt (tools \`rapt_check\`, \`rapt_generate\`, \`rapt_docs_search\`…).

## Rules

- Write ABAP Cloud and CDS as in the ABAP Development Tools; RAP managed, with or without draft.
- Run \`rapt check .\` after every change until there is no error; the codes are explained in
  the documentation (tile *Documentation* of \`rapt dev\`, the tool \`rapt_docs_read\` of
  \`rapt agent\`, or https://clementringot.github.io/Open-Rap-Runtime/docs/diagnostics.html).
- Keep \`rapt/config.json\` in mode \`standard\` when the BO must activate on SAP; \`enhanced\`
  allows Open RAP Runtime extensions (mandatory fields checked automatically, managed BO on a
  custom entity).
- Objects: ${n.table} (table), ${n.root} (root view), ${n.projection} (projection and UI
  annotations), ${n.pool.toUpperCase()} (behavior pool), ${n.service} (service).
- \`rapt/\` holds the configuration of Open RAP Runtime (seed data, roles, number ranges, MCP); it is
  not imported into SAP. Never edit \`.rapt/\` (build output).
`;
}

/** Writes the sources of a new business object into the project `dir` (created if needed). */
export function newBusinessObject(dir: string, entity: string, options: NewBoOptions = {}): NewBoResult {
  const root = path.resolve(dir);
  const names = boNames(entity, options);
  if ("error" in names) {
    return { written: [], error: names.error };
  }
  const dotAbapGit = path.join(root, ".abapgit.xml");
  const folder = existsSync(dotAbapGit) ? (/<STARTING_FOLDER>([^<]*)<\/STARTING_FOLDER>/.exec(readFileSync(dotAbapGit, "utf8"))?.[1] ?? "/src/") : "/src/";
  const src = path.join(root, folder.replace(/^\/+/, ""));
  const files: [string, string][] = [
    [path.join(src, `${names.table}.tabl.astabl`), tableSource(names)],
    [path.join(src, `${names.root.toLowerCase()}.ddls.asddls`), rootView(names)],
    [path.join(src, `${names.projection.toLowerCase()}.ddls.asddls`), projectionView(names)],
    [path.join(src, `${names.projection.toLowerCase()}.ddlx.asddlxs`), metadataExtension(names)],
    [path.join(src, `${names.root.toLowerCase()}.bdef.asbdef`), behavior(names)],
    [path.join(src, `${names.projection.toLowerCase()}.bdef.asbdef`), projectionBehavior(names)],
    [path.join(src, `${names.pool}.clas.abap`), pool(names)],
    [path.join(src, `${names.pool}.clas.locals_imp.abap`), handler(names)],
    [path.join(src, `${names.service.toLowerCase()}.srvd.srvdsrv`), serviceDefinition(names)],
    [path.join(src, `${names.binding.toLowerCase()}.srvb.xml`), serviceBinding(names)],
  ];
  const seedFile = path.join(root, "rapt", "seed.json");
  if (!existsSync(seedFile)) {
    files.push([seedFile, seed(names)]);
  }
  // instructions for the AI agents working on the project
  const agents = path.join(root, "AGENTS.md");
  if (!existsSync(agents)) {
    files.push([agents, agentsFile(names)]);
  }
  const existing = files.filter(([file]) => existsSync(file)).map(([file]) => path.relative(root, file));
  if (existing.length > 0) {
    return { written: [], error: `already present: ${existing.join(", ")}` };
  }
  const written: string[] = [];
  for (const [file, content] of files) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    written.push(path.relative(root, file).split(path.sep).join("/"));
  }
  // the build and the database of rapt dev stay out of git
  const gitignore = path.join(root, ".gitignore");
  const ignored = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  const missing = [".rapt/", "node_modules/"].filter((line) => !ignored.split(/\r?\n/).includes(line));
  if (missing.length > 0) {
    appendFileSync(gitignore, `${ignored === "" || ignored.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
    written.push(".gitignore");
  }
  const abapGit = generateAbapGitFiles(root, { packageDescription: names.description });
  written.push(...abapGit.written.filter((f) => !written.includes(f)));
  return { written };
}
