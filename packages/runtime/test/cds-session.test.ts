/**
 * The session variables of CDS (D103): $session.user, $session.system_language and
 * $session.client in the select list and in a WHERE, per request.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatedVariant, SERVICE, T1, writableApp, type TestApp } from "./helpers.js";

const lf = (content: string): string => content.replace(/\r\n/g, "\n");

let test: TestApp;

beforeAll(async () => {
  test = await writableApp(
    generatedVariant({
      "zrt_r_travel.ddls.asddls": (c) =>
        lf(c).replace(
          "      _Booking\n",
          [
            "      $session.user as CurrentUser,",
            "      case when created_by = $session.user then 'X' else '' end as CreatedByMe,",
            "      $session.system_language as Language,",
            "      $session.client as Client,",
            "      $session.user_timezone as TimeZone,",
            "      _Booking",
            "",
          ].join("\n"),
        ),
      "zrt_c_travel.ddls.asddls": (c) => lf(c).replace("      _Booking : redirected", "      CurrentUser,\n      CreatedByMe,\n      Language,\n      Client,\n      TimeZone,\n      _Booking : redirected"),
    }),
    { auth: { mode: "none", user: "ALICE" } },
  );
}, 180_000);

afterAll(async () => {
  await test?.close();
});

async function get(path: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const response = await test.app.inject({ method: "GET", url: `${SERVICE}${path}`, headers: { accept: "application/json", ...headers } });
  expect(response.statusCode, response.body).toBe(200);
  return JSON.parse(response.body) as Record<string, unknown>;
}

describe("session variables of CDS (D103)", () => {
  it("gives the user, the language and the client of the request", async () => {
    const select = `Travel(${T1})?$select=CreatedBy,CurrentUser,CreatedByMe,Language,Client,TimeZone`;
    const read = await get(select, { "accept-language": "de-DE,de;q=0.9" });
    expect(read).toMatchObject({ CurrentUser: "ALICE", Language: "D", Client: "100", TimeZone: "UTC" });
    expect(read).toMatchObject({ CreatedBy: "ALICE", CreatedByMe: "X" });
    expect(await get(select)).toMatchObject({ Language: "E" });
  });

  it("filters on the user of the request", async () => {
    const mine = (await get(`Travel?$filter=CreatedByMe eq 'X'&$select=CreatedBy`))["value"] as Array<Record<string, unknown>>;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((t) => t["CreatedBy"] === "ALICE")).toBe(true);
  });
});
