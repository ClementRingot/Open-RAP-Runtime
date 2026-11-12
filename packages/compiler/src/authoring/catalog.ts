/**
 * The catalog of the objects `rapt generate` creates (D61), grouped as in the "New ABAP Repository
 * Object" wizard of ADT: what each one is, what it derives from, which inputs it asks. The VS Code
 * extension builds its creation wizard from it (`rapt generate <src> --json` without a kind), so
 * the command line stays the single source of truth.
 *
 * And the floorplans of the generated UI (D53), with what each one is for, for `rapt floorplan`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ObjectCategory = "Business Object" | "Dictionary" | "Core Data Services" | "Behavior" | "Business Services" | "Source Code Library";

export interface ObjectInput {
  /** The CLI option: --from, --for, --expose, --root, --binding-type, --type. */
  option: "--from" | "--for" | "--expose" | "--root" | "--binding-type" | "--type";
  label: string;
  /** What to pick from: the objects of the project of that kind, or fixed values. */
  of?: "table" | "entity" | "bdef" | "srvd" | "domain";
  values?: string[];
  required: boolean;
  /** --expose: several objects. */
  multiple?: boolean;
  default?: string;
}

export interface CatalogEntry {
  kind: string;
  category: ObjectCategory;
  label: string;
  description: string;
  /** The files written (abapGit names). */
  files: string;
  maxLength: number;
  /** A name to start from: ZR_…, ZC_… */
  namePattern: string;
  inputs: ObjectInput[];
}

export const OBJECT_CATALOG: CatalogEntry[] = [
  {
    kind: "bo",
    category: "Business Object",
    label: "Complete business object",
    description: "Table, view, projection, metadata extension, BDEF, behavior pool, service and binding of a managed BO, with data (rapt new).",
    files: "all the objects of the BO",
    maxLength: 30,
    namePattern: "Travel",
    inputs: [],
  },
  { kind: "table", category: "Dictionary", label: "Database table", description: "Transparent table written as in ADT (define table).", files: ".tabl.astabl, .tabl.xml", maxLength: 16, namePattern: "zxx_order", inputs: [] },
  {
    kind: "dataelement",
    category: "Dictionary",
    label: "Data element",
    description: "Semantic type of a field: a domain, or a built-in type, with its labels.",
    files: ".dtel.xml",
    maxLength: 30,
    namePattern: "ZXX_ORDER_ID",
    inputs: [
      { option: "--from", label: "Domain (optional)", of: "domain", required: false },
      { option: "--type", label: "Built-in type (no domain)", required: false, default: "abap.char(10)" },
    ],
  },
  { kind: "domain", category: "Dictionary", label: "Domain", description: "Technical domain of a built-in type.", files: ".doma.xml", maxLength: 30, namePattern: "ZXX_STATUS", inputs: [{ option: "--type", label: "Built-in type", required: true, default: "abap.char(1)" }] },
  {
    kind: "view",
    category: "Core Data Services",
    label: "Data definition: view entity",
    description: "CDS view on a table, its elements in CamelCase (define view entity).",
    files: ".ddls.asddls, .ddls.xml",
    maxLength: 30,
    namePattern: "ZR_Order",
    inputs: [
      { option: "--from", label: "Source table", of: "table", required: true },
      { option: "--root", label: "Root entity", required: false, values: ["true", "false"], default: "true" },
    ],
  },
  { kind: "projection", category: "Core Data Services", label: "Data definition: projection", description: "Projection of a view (as projection on), provider contract transactional_query.", files: ".ddls.asddls, .ddls.xml", maxLength: 30, namePattern: "ZC_Order", inputs: [{ option: "--from", label: "Projected view", of: "entity", required: true }] },
  {
    kind: "tableentity",
    category: "Core Data Services",
    label: "Data definition: table entity",
    description: "Table and entity in one object, the persistence of a BO (define table entity).",
    files: ".ddls.asddls, .ddls.xml",
    maxLength: 25,
    namePattern: "ZXX_ORDER",
    inputs: [{ option: "--root", label: "Root entity", required: false, values: ["true", "false"], default: "true" }],
  },
  { kind: "abstract", category: "Core Data Services", label: "Data definition: abstract entity", description: "Parameter or result structure of an action.", files: ".ddls.asddls, .ddls.xml", maxLength: 30, namePattern: "ZA_OrderParam", inputs: [] },
  { kind: "custom", category: "Core Data Services", label: "Data definition: custom entity", description: "Entity read by an ABAP query class (if_rap_query_provider), and that class.", files: ".ddls.asddls, .clas.abap", maxLength: 30, namePattern: "ZCE_Order", inputs: [] },
  { kind: "metadata", category: "Core Data Services", label: "Metadata extension", description: "UI annotations (@UI) of an entity, by layer.", files: ".ddlx.asddlxs, .ddlx.xml", maxLength: 30, namePattern: "ZC_Order", inputs: [{ option: "--from", label: "Annotated entity", of: "entity", required: true }] },
  { kind: "access", category: "Core Data Services", label: "Access control (DCL)", description: "Read access control of an entity (define role).", files: ".dcls.asdcls, .dcls.xml", maxLength: 30, namePattern: "ZC_Order", inputs: [{ option: "--from", label: "Protected entity", of: "entity", required: true }] },
  { kind: "type", category: "Core Data Services", label: "CDS simple type", description: "Reusable CDS type (define type x : abap.char(40)).", files: ".drty.acds, .drty.json", maxLength: 30, namePattern: "ZXX_NAME", inputs: [] },
  { kind: "enum", category: "Core Data Services", label: "CDS enumerated type", description: "Named values of a base type (define type … enum).", files: ".drty.acds, .drty.json", maxLength: 30, namePattern: "ZXX_STATUS", inputs: [] },
  { kind: "behavior", category: "Behavior", label: "Behavior definition", description: "Managed BDEF of a root view (with its compositions), or projection BDEF.", files: ".bdef.asbdef, .bdef.xml", maxLength: 30, namePattern: "ZR_Order", inputs: [{ option: "--from", label: "Root entity (view or projection)", of: "entity", required: true }] },
  { kind: "pool", category: "Behavior", label: "Behavior pool", description: "Implementation class of a BDEF, with its handlers (determinations, validations, actions).", files: ".clas.abap, .clas.locals_imp.abap", maxLength: 30, namePattern: "ZBP_R_ORDER", inputs: [{ option: "--for", label: "Behavior definition", of: "bdef", required: true }] },
  { kind: "service", category: "Business Services", label: "Service definition", description: "The entities the service exposes.", files: ".srvd.srvdsrv, .srvd.xml", maxLength: 30, namePattern: "ZUI_ORDER", inputs: [{ option: "--expose", label: "Exposed entities", of: "entity", required: true, multiple: true }] },
  {
    kind: "binding",
    category: "Business Services",
    label: "Service binding",
    description: "OData V4 binding of a service definition: UI (Fiori) or Web API.",
    files: ".srvb.xml",
    maxLength: 30,
    namePattern: "ZUI_ORDER_O4",
    inputs: [
      { option: "--for", label: "Service definition", of: "srvd", required: true },
      { option: "--binding-type", label: "Binding type", values: ["ui", "webapi"], required: false, default: "ui" },
    ],
  },
  { kind: "class", category: "Source Code Library", label: "ABAP class", description: "ABAP Cloud global class.", files: ".clas.abap, .clas.xml", maxLength: 30, namePattern: "ZCL_ORDER_UTIL", inputs: [] },
  { kind: "interface", category: "Source Code Library", label: "ABAP interface", description: "ABAP Cloud global interface.", files: ".intf.abap, .intf.xml", maxLength: 30, namePattern: "ZIF_ORDER", inputs: [] },
];

export type FloorplanName = "listReport" | "worklist" | "analyticalListPage" | "formEntry";

export const FLOORPLAN_CATALOG: Array<{ floorplan: FloorplanName; label: string; description: string; needs: string }> = [
  { floorplan: "listReport", label: "List Report / Object Page", description: "Search, filter and sort objects, then open and edit them. The default.", needs: "@UI.lineItem, @UI.selectionField, @UI.facet" },
  { floorplan: "worklist", label: "Worklist", description: "A list of work items to process, without a filter bar, with tabs (open, accepted…).", needs: "@UI.lineItem, qualified @UI.selectionVariant (one tab each)" },
  { floorplan: "analyticalListPage", label: "Analytical List Page", description: "A chart above the list to analyze, then filter by clicking in the chart.", needs: "@UI.chart (dimension, measures), @Aggregation.default" },
  { floorplan: "formEntry", label: "Form Entry Object Page", description: "A quick entry form: create an object, then another one.", needs: "@UI.facet, @UI.identification" },
];

/** The floorplans of rapt/config.json (`ui.floorplans`). */
export function readFloorplans(dir: string): Record<string, string> {
  const file = path.join(dir, "rapt", "config.json");
  if (!existsSync(file)) {
    return {};
  }
  const config = JSON.parse(readFileSync(file, "utf8")) as { ui?: { floorplans?: Record<string, string> } };
  return { ...(config.ui?.floorplans ?? {}) };
}

/** Sets the floorplan of an entity set in rapt/config.json, keeping the rest of the file. */
export function writeFloorplan(dir: string, set: string, floorplan: FloorplanName): string {
  const file = path.join(dir, "rapt", "config.json");
  const config = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  const ui = typeof config["ui"] === "object" && config["ui"] !== null ? (config["ui"] as Record<string, unknown>) : {};
  const floorplans = typeof ui["floorplans"] === "object" && ui["floorplans"] !== null ? (ui["floorplans"] as Record<string, string>) : {};
  if (floorplan === "listReport") {
    delete floorplans[set];
  } else {
    floorplans[set] = floorplan;
  }
  if (Object.keys(floorplans).length > 0) {
    ui["floorplans"] = floorplans;
  } else {
    delete ui["floorplans"];
  }
  if (Object.keys(ui).length > 0) {
    config["ui"] = ui;
  } else {
    delete config["ui"];
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return path.relative(dir, file).split(path.sep).join("/");
}
