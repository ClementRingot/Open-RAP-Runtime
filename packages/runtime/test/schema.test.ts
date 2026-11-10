/**
 * The schema of the generated application applied at start-up (server.mjs): idempotent, on
 * PGlite too, whose extended protocol takes one command per query.
 */

import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect, sql } from "kysely";
import { describe, expect, it } from "vitest";
import { applySchema, createDatabase, PGLITE_PARSERS, splitStatements } from "../src/db/database.js";
import { generatedFixture } from "./helpers.js";

describe("schema of the generated application", () => {
  it("splits a script at the semicolons outside literals, identifiers, bodies and comments", () => {
    const script = `-- a comment; with a semicolon
CREATE TABLE "a;b" (c text DEFAULT 'x;''y');
/* block; comment */ CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$;
DO $$ BEGIN PERFORM 1; END $$;
SELECT $1::int;`;
    expect(splitStatements(script)).toEqual([
      `-- a comment; with a semicolon\nCREATE TABLE "a;b" (c text DEFAULT 'x;''y')`,
      "/* block; comment */ CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NULL; END $f$",
      "DO $$ BEGIN PERFORM 1; END $$",
      "SELECT $1::int",
    ]);
  });

  it("applies the schema of the fixture on PGlite, twice", async () => {
    const { schema } = await generatedFixture();
    const pglite = await PGlite.create({ parsers: PGLITE_PARSERS });
    const db = createDatabase(new PGliteDialect({ pglite }));
    try {
      await applySchema(db, schema);
      await applySchema(db, schema);
      const tables = await sql<{ name: string }>`SELECT table_schema || '.' || table_name AS name FROM information_schema.tables WHERE table_name IN ('zrt_travel', 'zrt_booking') ORDER BY 1`.execute(db);
      expect(tables.rows.map((r) => r.name)).toEqual(["public.zrt_booking", "public.zrt_travel", "rapt_abap.zrt_booking", "rapt_abap.zrt_travel"]);
    } finally {
      await db.destroy();
    }
  }, 120_000);
});
