/**
 * Seed data (decision D42): `db/seed.json` (table → rows) and `db/seed.sql`, written by the
 * compiler from `rapt/seed.json` and `rapt/seed.sql`. They are loaded when every table of the
 * application is empty — its first start — if `SEED=auto` (`rapt dev` sets it).
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "kysely";
import { isUuid, type Model } from "@open-rap/model";
import { splitStatements, type Database } from "./database.js";

/** Loads the seed of the application folder `dir`; returns the number of rows inserted, or undefined when not loaded. */
export async function applySeed(db: Database, model: Model, dir: string): Promise<number | undefined> {
  const jsonFile = path.join(dir, "db", "seed.json");
  const sqlFile = path.join(dir, "db", "seed.sql");
  if (!existsSync(jsonFile) && !existsSync(sqlFile)) {
    return undefined;
  }
  for (const table of model.tables.filter((t) => t.standard !== true)) {
    const row = await db.selectFrom(table.name).select(sql<number>`1`.as("one")).limit(1).executeTakeFirst();
    if (row !== undefined) {
      return undefined; // not the first start
    }
  }
  const json = existsSync(jsonFile) ? (JSON.parse(readFileSync(jsonFile, "utf8")) as Record<string, Record<string, unknown>[]>) : {};
  let count = 0;
  await db.transaction().execute(async (trx) => {
    await sql.raw("SET LOCAL TIME ZONE 'UTC'").execute(trx);
    for (const [name, rows] of Object.entries(json)) {
      const table = model.tables.find((t) => t.name === name);
      if (table === undefined || rows.length === 0) {
        continue;
      }
      // a UUID key left out is drawn at random
      const uuidKeys = table.columns.filter((c) => c.key && !c.client && isUuid(c.type)).map((c) => c.name);
      const numc = table.columns.filter((c) => c.type.kind === "numc" && c.type.length !== undefined);
      const values = rows.map((row) => {
        const filled = { ...row };
        // NUMC fields are stored with their leading zeros, as ABAP writes them
        for (const column of numc) {
          const value = filled[column.name];
          if ((typeof value === "string" || typeof value === "number") && /^\d+$/.test(String(value))) {
            filled[column.name] = String(value).padStart(column.type.length ?? 0, "0");
          }
        }
        for (const key of uuidKeys) {
          if (filled[key] === undefined || filled[key] === null || filled[key] === "") filled[key] = randomUUID();
        }
        return filled;
      });
      await trx.insertInto(name).values(values).execute();
      count += values.length;
    }
    if (existsSync(sqlFile)) {
      for (const statement of splitStatements(readFileSync(sqlFile, "utf8"))) {
        await sql.raw(statement).execute(trx);
      }
    }
  });
  return count;
}
