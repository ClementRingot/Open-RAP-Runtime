/**
 * The utilities of ABAP Cloud in a behavior pool (D40): /ui2/cl_json and xco_cp_json, encodings,
 * gzip, text, time stamps and XCO time, hashes, random numbers, regular expressions and the RTTS
 * (one self-test in ABAP: action selfTest), number ranges (drawNumber) and the application log
 * (writeLog), in the database of the application.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatedVariant, SERVICE, T1, T2, writableApp, type TestApp } from "./helpers.js";
import { utilitiesVariant } from "./utilities/variant.js";

const NS = "com.sap.gateway.srvd.zrt_ui_travel.v0001";
const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8;IEEE754Compatible=true", accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true", "if-match": "*" };

let app: TestApp;

beforeAll(async () => {
  app = await writableApp(generatedVariant(utilitiesVariant({ ZRT_TRAVEL: { "01": { from: "1000", to: "1002" } } })));
});
afterAll(async () => app.close());

async function action(travel: string, name: string): Promise<{ status: number; description: string; body: unknown }> {
  const response = await app.app.inject({ method: "POST", url: `${SERVICE}Travel(${travel})/${NS}.${name}`, headers: JSON_HEADERS, payload: "{}" });
  const body = response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>);
  return { status: response.statusCode, description: String(body["Description"] ?? ""), body };
}

describe("utilities of ABAP Cloud", () => {
  it("JSON, encodings, text, time, hashes, random numbers, regular expressions and RTTS (ABAP self-test)", async () => {
    const result = await action(T1, "selfTest");
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.description).toBe("OK");
  });

  it("draws numbers from the configured interval until it is exhausted", async () => {
    expect((await action(T1, "drawNumber")).description).toBe("00000000000000001000");
    expect((await action(T2, "drawNumber")).description).toBe("00000000000000001001");
    expect((await action(T1, "drawNumber")).description).toBe("00000000000000001002 2");
    expect((await action(T1, "drawNumber")).description).toBe("number range object ZRT_TRAVEL, interval 01: no number left (last number 1002)");
  });

  it("saves and reads the application log", async () => {
    const result = await action(T1, "writeLog");
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.description).toMatch(/^1 3 Log of travel \d+ \/ W .+/);
    const rows = await app.pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM rapt_application_log_item");
    expect(rows.rows[0]?.n).toBe(3);
  });
});
