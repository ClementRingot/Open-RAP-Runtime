import { PGlite } from "@electric-sql/pglite";
import type { Model } from "@rap-transpiler/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSql, sqlType } from "../src/gen/sql.js";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";
import { FIXTURE_DIR } from "./helpers.js";

let model: Model;
let db: PGlite;

beforeAll(async () => {
  const built = buildModel(loadProject(FIXTURE_DIR));
  if (built.model === undefined) {
    throw new Error("no model");
  }
  model = built.model;
  db = await PGlite.create();
});
afterAll(async () => {
  await db.close();
});

describe("PostgreSQL DDL", () => {
  it("matches the reviewed snapshot", async () => {
    await expect(generateSql(model).schema).toMatchFileSnapshot("./__snapshots__/travel.schema.sql");
  });

  it("maps ABAP types to PostgreSQL types (decision D8)", () => {
    expect(sqlType({ kind: "raw", length: 16 })).toBe("uuid");
    expect(sqlType({ kind: "numc", length: 8 })).toBe("varchar(8)");
    expect(sqlType({ kind: "curr", length: 16, decimals: 2 })).toBe("numeric(16,2)");
    expect(sqlType({ kind: "timestampl", length: 21, decimals: 7 })).toBe("timestamptz(6)");
    expect(sqlType({ kind: "timestamp", length: 15 })).toBe("timestamptz(0)");
    expect(sqlType({ kind: "dats", length: 8 })).toBe("date");
    expect(sqlType({ kind: "bool", length: 1 })).toBe("boolean");
  });

  it("applies on PostgreSQL, twice", async () => {
    const { schema } = generateSql(model);
    await db.exec(schema);
    await db.exec(schema);
    const tables = await db.query<{ table_name: string; table_type: string }>(
      "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(tables.rows).toEqual([
      { table_name: "zrt_booking", table_type: "BASE TABLE" },
      { table_name: "zrt_c_booking", table_type: "VIEW" },
      { table_name: "zrt_c_travel", table_type: "VIEW" },
      { table_name: "zrt_r_booking", table_type: "VIEW" },
      { table_name: "zrt_r_travel", table_type: "VIEW" },
      { table_name: "zrt_travel", table_type: "BASE TABLE" },
    ]);
  });

  it("stores initial values like ABAP and reads them through the CDS views", async () => {
    await db.exec(`INSERT INTO zrt_travel (travel_uuid, travel_id, begin_date) VALUES ('3f2504e0-4f89-11d3-9a0c-0305e82c3301', '00000042', '2026-12-01')`);
    const travel = await db.query<Record<string, unknown>>(`SELECT "TravelUUID", "TravelID", "AgencyID", "BookingFee", "Description", "BeginDate", "EndDate" FROM zrt_c_travel`);
    expect(travel.rows[0]).toMatchObject({
      TravelUUID: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      TravelID: "00000042",
      AgencyID: "000000",
      Description: "",
      EndDate: null,
    });
    expect(String(travel.rows[0]?.["BookingFee"])).toMatch(/^0(\.00)?$/);
  });

  it("cascades the deletion of a travel to its bookings", async () => {
    await db.exec(`INSERT INTO zrt_booking (booking_uuid, parent_uuid, booking_id) VALUES ('11111111-2222-3333-4444-555555555555', '3f2504e0-4f89-11d3-9a0c-0305e82c3301', '0001')`);
    const bookings = await db.query(`SELECT * FROM zrt_c_booking WHERE "TravelUUID" = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'`);
    expect(bookings.rows).toHaveLength(1);
    await db.exec(`DELETE FROM zrt_travel`);
    expect((await db.query(`SELECT * FROM zrt_booking`)).rows).toHaveLength(0);
  });

  it("rejects a booking without travel at commit (deferred foreign key)", async () => {
    await expect(
      db.exec(`BEGIN; INSERT INTO zrt_booking (booking_uuid, parent_uuid) VALUES ('99999999-2222-3333-4444-555555555555', 'aaaaaaaa-0000-0000-0000-000000000000'); COMMIT;`),
    ).rejects.toThrow(/foreign key/);
    await db.exec("ROLLBACK").catch(() => undefined);
  });
});
