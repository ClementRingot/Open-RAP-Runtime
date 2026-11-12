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
    label: "Business object complet",
    description: "Table, vue, projection, metadata extension, BDEF, behavior pool, service et binding d'un BO managed, avec des données (rapt new).",
    files: "tous les objets du BO",
    maxLength: 30,
    namePattern: "Travel",
    inputs: [],
  },
  { kind: "table", category: "Dictionary", label: "Table de base de données", description: "Table transparente écrite comme dans ADT (define table).", files: ".tabl.astabl, .tabl.xml", maxLength: 16, namePattern: "zxx_order", inputs: [] },
  {
    kind: "dataelement",
    category: "Dictionary",
    label: "Élément de données",
    description: "Type sémantique d'un champ : un domaine, ou un type intégré, avec ses libellés.",
    files: ".dtel.xml",
    maxLength: 30,
    namePattern: "ZXX_ORDER_ID",
    inputs: [
      { option: "--from", label: "Domaine (optionnel)", of: "domain", required: false },
      { option: "--type", label: "Type intégré (sans domaine)", required: false, default: "abap.char(10)" },
    ],
  },
  { kind: "domain", category: "Dictionary", label: "Domaine", description: "Domaine technique d'un type intégré.", files: ".doma.xml", maxLength: 30, namePattern: "ZXX_STATUS", inputs: [{ option: "--type", label: "Type intégré", required: true, default: "abap.char(1)" }] },
  {
    kind: "view",
    category: "Core Data Services",
    label: "Data definition : view entity",
    description: "Vue CDS sur une table, ses éléments en CamelCase (define view entity).",
    files: ".ddls.asddls, .ddls.xml",
    maxLength: 30,
    namePattern: "ZR_Order",
    inputs: [
      { option: "--from", label: "Table source", of: "table", required: true },
      { option: "--root", label: "Entité racine (root)", required: false, values: ["true", "false"], default: "true" },
    ],
  },
  { kind: "projection", category: "Core Data Services", label: "Data definition : projection", description: "Projection d'une vue (as projection on), provider contract transactional_query.", files: ".ddls.asddls, .ddls.xml", maxLength: 30, namePattern: "ZC_Order", inputs: [{ option: "--from", label: "Vue projetée", of: "entity", required: true }] },
  {
    kind: "tableentity",
    category: "Core Data Services",
    label: "Data definition : table entity",
    description: "Table et entité en un seul objet, persistance d'un BO (define table entity).",
    files: ".ddls.asddls, .ddls.xml",
    maxLength: 25,
    namePattern: "ZXX_ORDER",
    inputs: [{ option: "--root", label: "Entité racine (root)", required: false, values: ["true", "false"], default: "true" }],
  },
  { kind: "abstract", category: "Core Data Services", label: "Data definition : entité abstraite", description: "Structure de paramètres ou de résultat d'une action.", files: ".ddls.asddls, .ddls.xml", maxLength: 30, namePattern: "ZA_OrderParam", inputs: [] },
  { kind: "custom", category: "Core Data Services", label: "Data definition : entité custom", description: "Entité lue par une classe de requête ABAP (if_rap_query_provider), et cette classe.", files: ".ddls.asddls, .clas.abap", maxLength: 30, namePattern: "ZCE_Order", inputs: [] },
  { kind: "metadata", category: "Core Data Services", label: "Metadata extension", description: "Annotations d'UI (@UI) d'une entité, par couche.", files: ".ddlx.asddlxs, .ddlx.xml", maxLength: 30, namePattern: "ZC_Order", inputs: [{ option: "--from", label: "Entité annotée", of: "entity", required: true }] },
  { kind: "access", category: "Core Data Services", label: "Access control (DCL)", description: "Contrôle d'accès en lecture d'une entité (define role).", files: ".dcls.asdcls, .dcls.xml", maxLength: 30, namePattern: "ZC_Order", inputs: [{ option: "--from", label: "Entité protégée", of: "entity", required: true }] },
  { kind: "type", category: "Core Data Services", label: "Type simple CDS", description: "Type CDS réutilisable (define type x : abap.char(40)).", files: ".drty.acds, .drty.json", maxLength: 30, namePattern: "ZXX_NAME", inputs: [] },
  { kind: "enum", category: "Core Data Services", label: "Type énuméré CDS", description: "Valeurs nommées d'un type de base (define type … enum).", files: ".drty.acds, .drty.json", maxLength: 30, namePattern: "ZXX_STATUS", inputs: [] },
  { kind: "behavior", category: "Behavior", label: "Behavior definition", description: "BDEF managed d'une vue racine (avec ses compositions), ou BDEF de projection.", files: ".bdef.asbdef, .bdef.xml", maxLength: 30, namePattern: "ZR_Order", inputs: [{ option: "--from", label: "Entité racine (vue ou projection)", of: "entity", required: true }] },
  { kind: "pool", category: "Behavior", label: "Behavior pool", description: "Classe d'implémentation d'une BDEF, avec ses handlers (déterminations, validations, actions).", files: ".clas.abap, .clas.locals_imp.abap", maxLength: 30, namePattern: "ZBP_R_ORDER", inputs: [{ option: "--for", label: "Behavior definition", of: "bdef", required: true }] },
  { kind: "service", category: "Business Services", label: "Service definition", description: "Les entités exposées par le service.", files: ".srvd.srvdsrv, .srvd.xml", maxLength: 30, namePattern: "ZUI_ORDER", inputs: [{ option: "--expose", label: "Entités exposées", of: "entity", required: true, multiple: true }] },
  {
    kind: "binding",
    category: "Business Services",
    label: "Service binding",
    description: "Liaison OData V4 d'une définition de service : UI (Fiori) ou Web API.",
    files: ".srvb.xml",
    maxLength: 30,
    namePattern: "ZUI_ORDER_O4",
    inputs: [
      { option: "--for", label: "Service definition", of: "srvd", required: true },
      { option: "--binding-type", label: "Type de binding", values: ["ui", "webapi"], required: false, default: "ui" },
    ],
  },
  { kind: "class", category: "Source Code Library", label: "Classe ABAP", description: "Classe globale ABAP Cloud.", files: ".clas.abap, .clas.xml", maxLength: 30, namePattern: "ZCL_ORDER_UTIL", inputs: [] },
  { kind: "interface", category: "Source Code Library", label: "Interface ABAP", description: "Interface globale ABAP Cloud.", files: ".intf.abap, .intf.xml", maxLength: 30, namePattern: "ZIF_ORDER", inputs: [] },
];

export type FloorplanName = "listReport" | "worklist" | "analyticalListPage" | "formEntry";

export const FLOORPLAN_CATALOG: Array<{ floorplan: FloorplanName; label: string; description: string; needs: string }> = [
  { floorplan: "listReport", label: "List Report / Object Page", description: "Chercher, filtrer, trier des objets, puis les ouvrir et les modifier. Le choix par défaut.", needs: "@UI.lineItem, @UI.selectionField, @UI.facet" },
  { floorplan: "worklist", label: "Worklist", description: "Une liste de travail à traiter, sans barre de filtres, avec des onglets (en attente, acceptés…).", needs: "@UI.lineItem, @UI.selectionVariant qualifiés (un onglet chacun)" },
  { floorplan: "analyticalListPage", label: "Analytical List Page", description: "Un graphique au-dessus de la liste pour analyser, puis filtrer en cliquant dans le graphique.", needs: "@UI.chart (dimension, mesures), @Aggregation.default" },
  { floorplan: "formEntry", label: "Form Entry Object Page", description: "Un formulaire de saisie rapide : créer un objet, puis un autre.", needs: "@UI.facet, @UI.identification" },
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
