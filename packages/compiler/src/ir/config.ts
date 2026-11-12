/**
 * The configuration of a project (decision D45): `rapt/config.json` next to the abapGit sources.
 *
 * ```json
 * { "mode": "enhanced" }
 * ```
 *
 * - `standard` (default): the sources behave as on SAP; what SAP refuses, Open RAP Runtime refuses.
 *   A project that builds in this mode can be imported and activated on SAP.
 * - `enhanced`: Open RAP Runtime extensions that SAP does not have: a managed BO with unmanaged save
 *   on a custom entity (D43), `field ( mandatory )` checked when saving without a validation.
 *
 * `rapt … --mode standard|enhanced` overrides the file.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Floorplan, OverviewCardModel, ProjectMode, UiConfigModel } from "@open-rap-runtime/model";
import type { Diagnostics } from "../diagnostics.js";
import type { Project } from "../input/project.js";

export const CONFIG_FILE = "rapt/config.json";

export const MODES: readonly ProjectMode[] = ["standard", "enhanced"];

export interface ProjectConfig {
  mode: ProjectMode;
  /** `ui` of rapt/config.json (D53), checked against the service by the IR builder. */
  ui?: UiConfigModel;
}

const FLOORPLANS: readonly Floorplan[] = ["listReport", "worklist", "analyticalListPage", "formEntry"];
const CARD_TYPES = ["list", "table", "chart", "kpi"];
const AGGREGATIONS = ["sum", "min", "max", "average", "count"];

/** `ui`: { floorplans: { Set: floorplan }, overview: { title, cards: [...] } }. */
function readUi(value: unknown, diagnostics: Diagnostics, at: { file: string; line: number }): UiConfigModel | undefined {
  const error = (message: string): undefined => {
    diagnostics.error("CFG003", `${CONFIG_FILE}: ui${message}`, at);
    return undefined;
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return error(" must be an object { floorplans, overview }");
  }
  const ui: UiConfigModel = {};
  for (const [name, item] of Object.entries(value)) {
    if (name === "floorplans") {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return error(".floorplans must be an object: entity set → floorplan");
      }
      const floorplans: Record<string, Floorplan> = {};
      for (const [set, floorplan] of Object.entries(item)) {
        if (typeof floorplan !== "string" || !(FLOORPLANS as readonly string[]).includes(floorplan)) {
          return error(`.floorplans.${set} must be ${FLOORPLANS.join(", ")}`);
        }
        floorplans[set] = floorplan as Floorplan;
      }
      ui.floorplans = floorplans;
    } else if (name === "overview") {
      const overview = item as { title?: unknown; cards?: unknown } | null;
      if (typeof overview !== "object" || overview === null || !Array.isArray(overview.cards)) {
        return error(".overview must be { title, cards: [...] }");
      }
      const cards: OverviewCardModel[] = [];
      for (const [i, raw] of (overview.cards as unknown[]).entries()) {
        const card = raw as Record<string, unknown>;
        if (typeof card !== "object" || card === null || typeof card["type"] !== "string" || !CARD_TYPES.includes(card["type"]) || typeof card["entitySet"] !== "string") {
          return error(`.overview.cards[${i}] needs type (${CARD_TYPES.join(", ")}) and entitySet`);
        }
        const result: OverviewCardModel = { type: card["type"] as OverviewCardModel["type"], entitySet: card["entitySet"], title: typeof card["title"] === "string" ? card["title"] : card["entitySet"] };
        for (const key of ["subtitle", "filter", "orderby", "chart", "measure"] as const) {
          if (typeof card[key] === "string") result[key] = card[key];
        }
        if (typeof card["top"] === "number") result.top = card["top"];
        if (card["aggregation"] !== undefined) {
          if (typeof card["aggregation"] !== "string" || !AGGREGATIONS.includes(card["aggregation"])) {
            return error(`.overview.cards[${i}].aggregation must be ${AGGREGATIONS.join(", ")}`);
          }
          result.aggregation = card["aggregation"] as NonNullable<OverviewCardModel["aggregation"]>;
        }
        if (result.type === "kpi" && result.measure === undefined && result.aggregation !== "count") {
          return error(`.overview.cards[${i}]: a kpi card needs a measure (or aggregation "count")`);
        }
        cards.push(result);
      }
      ui.overview = { title: typeof overview.title === "string" ? overview.title : "Overview", cards };
    } else {
      diagnostics.warning("CFG002", `${CONFIG_FILE}: unknown setting ui.${name} ignored`, at);
    }
  }
  return ui;
}

export function loadConfig(project: Project, diagnostics: Diagnostics, override?: string): ProjectConfig {
  const config: ProjectConfig = { mode: "standard" };
  const file = path.join(project.root, CONFIG_FILE);
  const at = { file: CONFIG_FILE, line: 1 };
  if (existsSync(file)) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      diagnostics.error("CFG001", `${CONFIG_FILE} is not valid JSON: ${(error as Error).message}`, at);
      json = {};
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      diagnostics.error("CFG001", `${CONFIG_FILE} must be an object, for example { "mode": "enhanced" }`, at);
    } else {
      for (const [name, value] of Object.entries(json)) {
        if (name === "mode") {
          if (typeof value === "string" && (MODES as readonly string[]).includes(value)) {
            config.mode = value as ProjectMode;
          } else {
            diagnostics.error("CFG001", `${CONFIG_FILE}: mode must be ${MODES.map((m) => `"${m}"`).join(" or ")}`, at);
          }
        } else if (name === "ui") {
          const ui = readUi(value, diagnostics, at);
          if (ui !== undefined) config.ui = ui;
        } else if (name !== "$schema") {
          diagnostics.warning("CFG002", `${CONFIG_FILE}: unknown setting ${name} ignored`, at);
        }
      }
    }
  }
  if (override !== undefined) {
    if ((MODES as readonly string[]).includes(override)) {
      config.mode = override as ProjectMode;
    } else {
      diagnostics.error("CFG001", `--mode must be ${MODES.join(" or ")}, not ${override}`);
    }
  }
  return config;
}
