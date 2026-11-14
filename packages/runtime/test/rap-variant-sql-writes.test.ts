/**
 * Classic ABAP SQL writes in a saver (D102): `INSERT|MODIFY|DELETE dbtab FROM @wa`, `FROM TABLE`
 * and `INSERT INTO dbtab VALUES` are written by the kernel, with the exact values of packed
 * numbers (31 digits, 7 decimals) and the work area of DELETE (the transpiler would delete every
 * row). The variant of the additional save logs an amount and a precise stamp, and removes one
 * log row of a travel on request.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { edit, generatedVariant, SERVICE, T1, T2, writableApp, type TestApp } from "./helpers.js";
import { additionalSaveVariant } from "./variants.js";

const ABP = "zbp_rt_r_travel.clas.locals_imp.abap";

const COLUMNS = `    <DD03P>
     <FIELDNAME>AMOUNT</FIELDNAME>
     <INTTYPE>P</INTTYPE>
     <INTLEN>000016</INTLEN>
     <DATATYPE>DEC</DATATYPE>
     <LENG>000031</LENG>
     <DECIMALS>000002</DECIMALS>
     <MASK>  DEC</MASK>
    </DD03P>
    <DD03P>
     <FIELDNAME>STAMP</FIELDNAME>
     <INTTYPE>P</INTTYPE>
     <INTLEN>000011</INTLEN>
     <DATATYPE>DEC</DATATYPE>
     <LENG>000021</LENG>
     <DECIMALS>000007</DECIMALS>
     <MASK>  DEC</MASK>
    </DD03P>
   </DD03P_TABLE>`;

const FORGET = `          IF updated-Description = 'Forget the log'.
            SELECT * FROM zrt_travel_log WHERE travel_uuid = @updated-TravelUUID ORDER BY log_uuid INTO TABLE @DATA(old).
            READ TABLE old INTO DATA(first) INDEX 1.
            READ TABLE old INTO DATA(second) INDEX 2.
            DELETE zrt_travel_log FROM @first.
            DATA(removed) = sy-dbcnt.
            INSERT zrt_travel_log FROM @second.
            DATA(duplicate) = sy-subrc.
            entry-log_uuid = cl_system_uuid=>create_uuid_x16_static( ).
            entry-travel_uuid = updated-TravelUUID.
            entry-operation = 'U'.
            entry-description = |deleted { removed } duplicate { duplicate }|.
            INSERT INTO zrt_travel_log VALUES @entry.
            CONTINUE.
          ENDIF.
          IF updated-Description = 'Refused by the saver'.`;

let t: TestApp;

beforeAll(async () => {
  const base = additionalSaveVariant();
  const saver = base[ABP] as (c: string) => string;
  t = await writableApp(
    generatedVariant({
      ...base,
      "zrt_travel_log.tabl.xml": edit(base["zrt_travel_log.tabl.xml"] as string, [["   </DD03P_TABLE>", COLUMNS]]),
      [ABP]: (c) =>
        edit(saver(c), [
          ["          entry-description = created-Description.", "          entry-description = created-Description.\n          entry-amount = '123456789012345678901234567.89'.\n          entry-stamp = '20261114123456.1234567'."],
          ["          IF updated-Description = 'Refused by the saver'.", FORGET],
        ]),
    }),
  );
}, 180_000);

afterAll(async () => {
  await t?.close();
});

const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8;IEEE754Compatible=true", accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true", "if-match": "*" };

async function call(method: "POST" | "PATCH", path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await t.app.inject({ method, url: `${SERVICE}${path}`, headers: JSON_HEADERS, payload: JSON.stringify(body) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

async function rows(travel: string): Promise<Array<Record<string, unknown>>> {
  return (await t.pglite.query<Record<string, unknown>>(`SELECT operation, description, amount::text AS amount, stamp::text AS stamp FROM zrt_travel_log WHERE travel_uuid = '${travel}' ORDER BY log_uuid`)).rows;
}

describe("classic ABAP SQL writes in a saver (D102)", () => {
  it("writes packed numbers with their exact value (31 digits, 7 decimals)", async () => {
    const created = await call("POST", "Travel", { TravelID: "00000042", AgencyID: "070001", CustomerID: "000001", BeginDate: "2027-05-01", EndDate: "2027-05-08", BookingFee: "40.00", CurrencyCode: "EUR", Description: "Exact" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(await rows(String(created.body["TravelUUID"]))).toEqual([{ operation: "C", description: "Exact", amount: "123456789012345678901234567.89", stamp: "20261114123456.1234567" }]);
  });

  it("deletes the row of the work area only, and refuses a duplicate with sy-subrc 4", async () => {
    expect((await call("PATCH", `Travel(${T1})`, { Description: "first" })).status).toBe(200);
    expect((await call("PATCH", `Travel(${T1})`, { Description: "second" })).status).toBe(200);
    expect((await call("PATCH", `Travel(${T2})`, { Description: "other travel" })).status).toBe(200);
    expect(await rows(T1)).toHaveLength(2);
    const forget = await call("PATCH", `Travel(${T1})`, { Description: "Forget the log" });
    expect(forget.status, JSON.stringify(forget.body)).toBe(200);
    const left = await rows(T1);
    expect(left).toHaveLength(2);
    // one of the two rows deleted (the first by key), the other one kept, the duplicate refused
    const descriptions = left.map((r) => r["description"]);
    expect(descriptions).toContain("deleted 1 duplicate 4");
    expect(descriptions.filter((d) => d === "first" || d === "second")).toHaveLength(1);
    // the other rows of the table are still there
    expect(await rows(T2)).toEqual([expect.objectContaining({ description: "other travel" })]);
  });
});
