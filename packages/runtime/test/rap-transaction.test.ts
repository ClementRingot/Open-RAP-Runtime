import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect, sql, type Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { developmentUser } from "../src/auth/user.js";
import { createDatabase, PGLITE_PARSERS } from "../src/db/database.js";
import { RapRuntime } from "../src/rap/runtime.js";
import { ODATA_MODE, type Row } from "../src/rap/types.js";
import { generatedFixture, SEED, T1, T2 } from "./helpers.js";

let runtime: RapRuntime;
let db: Kysely<unknown>;
const user = developmentUser();

beforeAll(async () => {
  const fixture = await generatedFixture();
  const pglite = await PGlite.create({ parsers: PGLITE_PARSERS });
  await pglite.exec("SET TIME ZONE 'UTC'");
  await pglite.exec(fixture.schema);
  await pglite.exec(SEED);
  db = createDatabase(new PGliteDialect({ pglite })) as unknown as Kysely<unknown>;
  runtime = await RapRuntime.load(fixture.model, fixture.abapDir);
}, 120_000);

afterAll(async () => {
  await db?.destroy();
});

const travel = () => runtime.bo.get("ZRT_R_Travel");
const booking = () => runtime.bo.get("ZRT_R_Booking");

async function row(table: string, column: string, value: string): Promise<Record<string, unknown> | undefined> {
  const result = await sql<Record<string, unknown>>`SELECT * FROM ${sql.id(table)} WHERE ${sql.id(column)} = ${value}`.execute(db);
  return result.rows[0];
}

const newTravel: Row = {
  TravelID: "00000100",
  AgencyID: "070001",
  CustomerID: "000042",
  BeginDate: "2027-03-01",
  EndDate: "2027-03-10",
  BookingFee: "25.00",
  CurrencyCode: "EUR",
  Description: "Created by the runtime test",
};

describe("managed RAP transaction", () => {
  it("creates an instance: numbering, admin fields, determinations, save", async () => {
    const { key, responses } = await runtime.transaction(db, user, "en", async (tx) => {
      const created = await tx.create(travel(), [{ cid: "c1", values: newTravel, fields: new Set(Object.keys(newTravel)) }], ODATA_MODE);
      expect(created.failed).toEqual([]);
      const determined = await tx.determineOnModify();
      const saved = await tx.save();
      return { key: created.mapped[0]?.key, responses: [determined, saved] };
    });
    expect(responses.flatMap((r) => r.failed)).toEqual([]);
    const uuid = String(key?.["TravelUUID"]);
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const stored = await row("zrt_travel", "travel_uuid", uuid);
    expect(stored).toMatchObject({ travel_id: "00000100", overall_status: "O", created_by: user.abapName, last_changed_by: user.abapName, description: "Created by the runtime test" });
    // calculateTotalPrice → internal action reCalcTotalPrice: no booking yet
    expect(String(stored?.["total_price"])).toBe("25.00");
    expect(stored?.["local_last_changed_at"]).not.toBeNull();
  });

  it("creates by association and recalculates the total of the parent", async () => {
    await runtime.transaction(db, user, "en", async (tx) => {
      const responses = await tx.createByAssociation(travel(), runtime.bo.association(travel(), "_Booking")!, [
        {
          key: { TravelUUID: T1 },
          targets: [{ cid: "b1", values: { BookingID: "0004", CarrierID: "LH", ConnectionID: "0401", FlightDate: "2026-06-10", FlightPrice: "99.75", CurrencyCode: "EUR" }, fields: new Set(["BookingID", "CarrierID", "ConnectionID", "FlightDate", "FlightPrice", "CurrencyCode"]) }],
        },
      ], ODATA_MODE);
      expect(responses.failed).toEqual([]);
      expect(responses.mapped).toHaveLength(1);
      expect((await tx.determineOnModify()).failed).toEqual([]);
      expect((await tx.save()).failed).toEqual([]);
    });
    // 20.00 fee + 750.25 + 750.25 + 0.00 + 99.75
    expect(String((await row("zrt_travel", "travel_uuid", T1))?.["total_price"])).toBe("1620.25");
  });

  it("rejects the save when a validation fails, with its message and element", async () => {
    await expect(
      runtime.transaction(db, user, "en", async (tx) => {
        await tx.update(travel(), [{ key: { TravelUUID: T2 }, values: { EndDate: "2026-06-01" }, fields: new Set(["EndDate"]) }], ODATA_MODE);
        await tx.determineOnModify();
        const saved = await tx.save();
        expect(saved.failed).toMatchObject([{ entity: "ZRT_R_Travel", key: { TravelUUID: T2 } }]);
        expect(saved.reported).toMatchObject([{ entity: "ZRT_R_Travel", key: { TravelUUID: T2 }, message: { severity: "E", text: "End date must not be before begin date" }, elements: ["EndDate"] }]);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect((await row("zrt_travel", "travel_uuid", T2))?.["end_date"]).toBeDefined();
  });

  it("executes an action with its result and honours instance feature control", async () => {
    const accept = travel().behavior.actions.find((a) => a.name === "acceptTravel")!;
    await runtime.transaction(db, user, "en", async (tx) => {
      const { results, responses } = await tx.execute(travel(), accept, [{ key: { TravelUUID: T1 }, param: {} }], ODATA_MODE);
      expect(responses.failed).toEqual([]);
      expect(results).toMatchObject([{ key: { TravelUUID: T1 }, value: { TravelUUID: T1, OverallStatus: "A", TravelID: "00000001" } }]);
      expect((await tx.save()).failed).toEqual([]);
    });
    expect((await row("zrt_travel", "travel_uuid", T1))?.["overall_status"]).toBe("A");
    await runtime.transaction(db, user, "en", async (tx) => {
      const { responses } = await tx.execute(travel(), accept, [{ key: { TravelUUID: T1 }, param: {} }], ODATA_MODE);
      expect(responses.failed).toMatchObject([{ entity: "ZRT_R_Travel", cause: "disabled", operation: { kind: "action", name: "acceptTravel" } }]);
    });
  });

  it("deletes an instance with its composition children", async () => {
    await runtime.transaction(db, user, "en", async (tx) => {
      expect((await tx.delete(travel(), [{ key: { TravelUUID: T2 } }], ODATA_MODE)).failed).toEqual([]);
      expect((await tx.save()).failed).toEqual([]);
    });
    expect(await row("zrt_travel", "travel_uuid", T2)).toBeUndefined();
    const children = await sql`SELECT * FROM zrt_booking WHERE parent_uuid = ${T2}`.execute(db);
    expect(children.rows).toEqual([]);
  });

  it("reports unknown instances", async () => {
    await runtime.transaction(db, user, "en", async (tx) => {
      const responses = await tx.update(booking(), [{ key: { BookingUUID: "00000000-0000-4000-8000-0000000000ff" }, values: {}, fields: new Set() }], ODATA_MODE);
      expect(responses.failed).toMatchObject([{ cause: "not_found" }]);
    });
  });
});
