/**
 * Locks on a real PostgreSQL (`SELECT … FOR UPDATE NOWAIT`): another transaction holds the lock of
 * a travel. An OData change of that travel fails with 409; an action that changes it with EML gets
 * the failure (cause locked) and goes on with its LUW, which reads further instances: the failed
 * lock is rolled back to a savepoint, the transaction stays usable. Once the lock is released,
 * the same requests succeed.
 *
 * Needs RAPT_E2E_DATABASE_URL (a database is created for the test) or a PostgreSQL installation
 * the test can start; skipped otherwise.
 */

import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { applySchema, createPostgresDatabase, type Database } from "../src/db/database.js";
import { RapRuntime } from "../src/rap/runtime.js";
import { edit, generatedVariant, POSTGRES_AVAILABLE, postgresDatabase, SEED, SERVICE, T1, T2 } from "./helpers.js";

const ABP = "zbp_rt_r_travel.clas.locals_imp.abap";
const NS = "com.sap.gateway.srvd.zrt_ui_travel.v0001";

const DEFINITION = `
    METHODS touchOther FOR MODIFY
      IMPORTING keys FOR ACTION Travel~touchOther RESULT result.
ENDCLASS.`;

const IMPLEMENTATION = `
  METHOD touchOther.
    " changes travel 00000001, then reads travel 00000003 (not read by this LUW yet)
    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( Description )
        WITH VALUE #( ( TravelUUID = '3F2504E04F8911D39A0C0305E82C3301' Description = 'touched' ) )
      FAILED DATA(update_failed).

    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( Description ) WITH VALUE #( ( TravelUUID = '7A1D3C5E000040008000000000000003' ) )
      RESULT DATA(others).

    DATA(outcome) = COND string( WHEN update_failed-travel IS INITIAL THEN \`changed\`
                                 WHEN update_failed-travel[ 1 ]-%fail-cause = if_abap_behv=>cause-locked THEN \`locked\`
                                 ELSE \`failed\` ).

    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( Description )
        WITH VALUE #( FOR key IN keys ( %tky = key-%tky Description = |{ outcome } / { others[ 1 ]-Description }| ) ).

    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(travels).
    result = VALUE #( FOR travel IN travels ( %tky = travel-%tky %param = travel ) ).
  ENDMETHOD.

ENDCLASS.

CLASS lhc_booking DEFINITION`;

let close: (() => Promise<void>) | undefined;
let db: Database | undefined;
let holder: pg.Client | undefined;
let app: Awaited<ReturnType<typeof createApp>> | undefined;
let url = "";

beforeAll(async () => {
  if (!POSTGRES_AVAILABLE) {
    return;
  }
  const database = await postgresDatabase("locks");
  if (database === undefined) {
    return;
  }
  close = database.close;
  url = database.url;
  const fixture = await generatedVariant({
    "zrt_r_travel.bdef.asbdef": (c) => edit(c, [["  internal action reCalcTotalPrice;", "  internal action reCalcTotalPrice;\n  action touchOther result [1] $self;"]]),
    "zrt_c_travel.bdef.asbdef": (c) => edit(c, [["  use action copyTravel;", "  use action copyTravel;\n  use action touchOther;"]]),
    [ABP]: (c) => {
      const first = c.indexOf("ENDCLASS.");
      const withDefinition = `${c.slice(0, first)}${DEFINITION.trimStart()}${c.slice(first + "ENDCLASS.".length)}`;
      return edit(withDefinition, [["ENDCLASS.\n\nCLASS lhc_booking DEFINITION", IMPLEMENTATION.trimStart()]]);
    },
  });
  db = createPostgresDatabase(url, { max: 4 });
  await applySchema(db, fixture.schema);
  await sql.raw(SEED).execute(db);
  const rap = await RapRuntime.load(fixture.model, fixture.abapDir);
  app = await createApp({ model: fixture.model, metadata: fixture.metadata, db, rap });
  await app.ready();
}, 180_000);

afterAll(async () => {
  await holder?.end().catch(() => undefined);
  await app?.close();
  await db?.destroy();
  await close?.();
});

const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8;IEEE754Compatible=true", accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true", "if-match": "*" };

async function call(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await (app as NonNullable<typeof app>).inject({ method, url: `${SERVICE}${path}`, headers: JSON_HEADERS, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

describe.skipIf(!POSTGRES_AVAILABLE)("locks on PostgreSQL", () => {
  it("refuses a change of an instance locked by another transaction", async () => {
    holder = new pg.Client({ connectionString: url });
    await holder.connect();
    await holder.query("BEGIN");
    await holder.query("SELECT 1 FROM zrt_travel WHERE travel_uuid = $1 FOR UPDATE", [T1]);
    const response = await call("PATCH", `Travel(${T1})`, { Description: "changed" });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: { message: expect.stringContaining("is locked by another user") } });
  });

  it("goes on with the LUW after a failed lock in EML", async () => {
    const response = await call("POST", `Travel(${T2})/${NS}.touchOther`, {});
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body["Description"]).toBe("locked / Ski holidays");
  });

  it("succeeds once the lock is released", async () => {
    await holder?.query("ROLLBACK");
    expect((await call("PATCH", `Travel(${T1})`, { Description: "changed" })).status).toBe(200);
    const response = await call("POST", `Travel(${T2})/${NS}.touchOther`, {});
    expect(response.body["Description"]).toBe("changed / Ski holidays");
    expect((await call("GET", `Travel(${T1})`)).body["Description"]).toBe("touched");
  });
});
