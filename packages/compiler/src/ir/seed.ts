/**
 * Seed data of the application (decision D42): `rapt/seed.json` and `rapt/seed.sql` next to the
 * abapGit sources. They are copied to `db/` in the application, which loads them at its first
 * start (all its tables empty) when `SEED=auto` — the default of `rapt dev`.
 *
 * ```json
 * { "zrt_travel": [ { "travel_id": "1", "description": "Paris", "begin_date": "2026-06-01" } ] }
 * ```
 *
 * Tables and fields are those of the dictionary (lower case, without the client field); values are
 * written in their database form (dates `YYYY-MM-DD`, UUIDs `xxxxxxxx-xxxx-…`). A UUID key left out
 * is drawn at random.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Model } from "@open-rap/model";
import type { Diagnostics } from "../diagnostics.js";
import type { Project } from "../input/project.js";

export const SEED_JSON = "rapt/seed.json";
export const SEED_SQL = "rapt/seed.sql";

export interface Seed {
  json?: Record<string, Record<string, unknown>[]>;
  sql?: string;
}

export function loadSeed(project: Project, model: Model, diagnostics: Diagnostics): Seed {
  const seed: Seed = {};
  const sqlFile = path.join(project.root, SEED_SQL);
  if (existsSync(sqlFile)) {
    seed.sql = readFileSync(sqlFile, "utf8");
  }
  const jsonFile = path.join(project.root, SEED_JSON);
  if (!existsSync(jsonFile)) {
    return seed;
  }
  const at = { file: SEED_JSON, line: 1 };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(jsonFile, "utf8"));
  } catch (error) {
    diagnostics.error("SEED001", `${SEED_JSON} is not valid JSON: ${(error as Error).message}`, at);
    return seed;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    diagnostics.error("SEED001", `${SEED_JSON} must be an object: table → array of rows`, at);
    return seed;
  }
  const result: Record<string, Record<string, unknown>[]> = {};
  for (const [name, rows] of Object.entries(json as Record<string, unknown>)) {
    const table = model.tables.find((t) => t.name === name.toLowerCase());
    if (table === undefined) {
      diagnostics.error("SEED002", `${SEED_JSON}: table ${name} is not a table of the application`, at);
      continue;
    }
    if (!Array.isArray(rows)) {
      diagnostics.error("SEED001", `${SEED_JSON}: ${name} must be an array of rows`, at);
      continue;
    }
    const columns = new Map(table.columns.filter((c) => !c.client).map((c) => [c.name, c]));
    const clean: Record<string, unknown>[] = [];
    rows.forEach((row: unknown, index) => {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        diagnostics.error("SEED001", `${SEED_JSON}: ${name}[${index}] must be an object`, at);
        return;
      }
      const values: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(row as Record<string, unknown>)) {
        const lower = field.toLowerCase();
        if (!columns.has(lower)) {
          // the client field is not a column of the database (D9): ignored
          if (table.columns.some((c) => c.client && c.name === lower)) continue;
          diagnostics.error("SEED002", `${SEED_JSON}: ${name}[${index}].${field} is not a field of ${name}`, at);
          continue;
        }
        values[lower] = value;
      }
      clean.push(values);
    });
    result[table.name] = clean;
  }
  seed.json = result;
  return seed;
}
