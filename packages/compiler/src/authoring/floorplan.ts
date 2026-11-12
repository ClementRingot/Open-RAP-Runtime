/**
 * The floorplans of a project (D53, D61): the root entity sets of the service and the floorplan of
 * each, read from and written to rapt/config.json. Shared by `rapt floorplan` and `rapt agent`.
 */

import path from "node:path";
import { loadProject } from "../input/project.js";
import { buildModel } from "../ir/builder.js";
import { FLOORPLAN_CATALOG, readFloorplans, writeFloorplan } from "./catalog.js";

export type FloorplanResult =
  | { ok: true; root: string; sets: Array<{ set: string; floorplan: string; chosen: boolean }>; floorplans: typeof FLOORPLAN_CATALOG }
  | { ok: true; root: string; file: string; set: string; floorplan: string; label: string }
  | { ok: false; root: string; error: string };

/** The root entity sets and their floorplan, or (with `set` and `floorplan`) sets one. */
export function floorplans(source: string, set?: string, floorplan?: string): FloorplanResult {
  const root = path.resolve(source);
  const { model } = buildModel(loadProject(root));
  const sets = (model?.service.entitySets ?? [])
    .filter((s) => s.valueHelp !== true && s.draftAdministrativeData !== true && model?.entities.find((e) => e.name === s.entity)?.root === true)
    .map((s) => s.name);
  if (set !== undefined) {
    if (!sets.includes(set)) {
      return { ok: false, root, error: `${set}: not a root entity set of the service (${sets.join(", ") || "none"})` };
    }
    const known = FLOORPLAN_CATALOG.find((f) => f.floorplan === floorplan);
    if (known === undefined) {
      return { ok: false, root, error: `${floorplan ?? "?"}: one of ${FLOORPLAN_CATALOG.map((f) => f.floorplan).join(", ")}` };
    }
    const file = writeFloorplan(root, set, known.floorplan);
    return { ok: true, root, file, set, floorplan: known.floorplan, label: known.label };
  }
  const current = readFloorplans(root);
  // chosen: written in rapt/config.json, else the default (the extension asks before building, D66)
  return { ok: true, root, sets: sets.map((s) => ({ set: s, floorplan: current[s] ?? "listReport", chosen: current[s] !== undefined })), floorplans: FLOORPLAN_CATALOG };
}
