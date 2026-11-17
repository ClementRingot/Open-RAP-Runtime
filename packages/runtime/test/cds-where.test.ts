/**
 * The WHERE condition of a view entity (D101): the PostgreSQL view keeps the rows of its source
 * that satisfy it, on columns, $projection elements and association paths.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatedVariant, SERVICE, T1, T3, writableApp, type TestApp } from "./helpers.js";

const lf = (content: string): string => content.replace(/\r\n/g, "\n");

let test: TestApp;

beforeAll(async () => {
  test = await writableApp(
    generatedVariant({
      // the travels other than the ski holidays, and their bookings of a flight price under 1000
      "zrt_r_travel.ddls.asddls": (c) => lf(c).replace(/\n}\s*$/, "\n}\nwhere description <> 'Ski holidays'\n"),
      "zrt_r_booking.ddls.asddls": (c) => lf(c).replace(/\n}\s*$/, "\n}\nwhere $projection.FlightPrice < 1000 and _Travel.OverallStatus <> 'X'\n"),
    }),
  );
}, 180_000);

afterAll(async () => {
  await test?.close();
});

async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await test.app.inject({ method: "GET", url: `${SERVICE}${path}`, headers: { accept: "application/json" } });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

describe("WHERE of a view entity (D101)", () => {
  it("keeps the rows that satisfy the condition", async () => {
    const travels = (await get("Travel?$select=TravelUUID,Description")).body["value"] as Array<Record<string, unknown>>;
    expect(travels.length).toBeGreaterThan(0);
    expect(travels.some((t) => t["TravelUUID"] === T3)).toBe(false);
    expect((await get(`Travel(${T3})`)).status).toBe(404);
    expect((await get(`Travel(${T1})`)).status).toBe(200);
  });

  it("filters on an element and through an association", async () => {
    const bookings = (await get("Booking?$select=BookingID,FlightPrice")).body["value"] as Array<Record<string, unknown>>;
    expect(bookings.length).toBeGreaterThan(0);
    expect(bookings.every((b) => Number(b["FlightPrice"]) < 1000)).toBe(true);
  });
});
