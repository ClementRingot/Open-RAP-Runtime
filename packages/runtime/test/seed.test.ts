/** Seed data (D42): db/seed.json and db/seed.sql loaded at the first start. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect, sql } from "kysely";
import { describe, expect, it } from "vitest";
import { applySchema, createDatabase, PGLITE_PARSERS } from "../src/db/database.js";
import { applySeed } from "../src/db/seed.js";
import { compiledFixture } from "./helpers.js";

describe("seed data", () => {
  it("is loaded when the tables are empty, once", async () => {
    const { model, schema } = compiledFixture();
    const dir = mkdtempSync(path.join(tmpdir(), "rapt-seed-"));
    mkdirSync(path.join(dir, "db"));
    writeFileSync(
      path.join(dir, "db", "seed.json"),
      JSON.stringify({ zrt_travel: [{ travel_id: "7", agency_id: 70001, description: "Paris", begin_date: "2026-06-01", currency_code: "EUR", booking_fee: "10.50" }] }),
    );
    writeFileSync(path.join(dir, "db", "seed.sql"), "UPDATE zrt_travel SET overall_status = 'O';");
    const pglite = await PGlite.create({ parsers: PGLITE_PARSERS });
    const db = createDatabase(new PGliteDialect({ pglite }));
    try {
      await applySchema(db, schema);
      expect(await applySeed(db, model, dir)).toBe(1);
      const rows = await sql<Record<string, unknown>>`SELECT travel_uuid, travel_id, agency_id, begin_date, overall_status FROM zrt_travel`.execute(db);
      expect(rows.rows).toEqual([{ travel_uuid: expect.stringMatching(/^[0-9a-f-]{36}$/), travel_id: "00000007", agency_id: "070001", begin_date: "2026-06-01", overall_status: "O" }]);
      // not the first start any more
      expect(await applySeed(db, model, dir)).toBeUndefined();
    } finally {
      await db.destroy();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
