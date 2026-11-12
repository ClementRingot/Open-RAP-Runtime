/**
 * Standard views of SAP (D44): I_Currency named by a value help is added to the project with its
 * reference data, exposed implicitly with its text view, described by Common.ValueList, and picked
 * in the value help dialog of the generated UI.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, id, ROWS, type Browser } from "./browser.js";
import { edit, generatedVariant, SERVICE, T2, writableApp, type GeneratedFixture, type TestApp } from "./helpers.js";

const browserType = chromium();
const RUNTIME_DIR = fileURLToPath(new URL("..", import.meta.url));
const VALUE_HELP = "      @Consumption.valueHelpDefinition: [{ entity: { name: 'I_Currency', element: 'Currency' } }]\n      CurrencyCode,";

let fixture: GeneratedFixture;
let t: TestApp;
let browser: Browser | undefined;
let base: string;

beforeAll(async () => {
  fixture = await generatedVariant({
    "zrt_c_travel.ddls.asddls": (c) => edit(c, [["      CurrencyCode,", VALUE_HELP]]),
    "zrt_c_booking.ddls.asddls": (c) => edit(c, [["      CurrencyCode,", VALUE_HELP]]),
    // the other standard views, exposed as they are
    "zrt_ui_travel.srvd.srvdsrv": (c) =>
      edit(c, [["  expose ZRT_C_Booking as Booking;", "  expose ZRT_C_Booking as Booking;\n  expose I_Region as Region;\n  expose I_RegionText as RegionText;\n  expose I_CalendarDate as CalendarDate;\n  expose I_TimeZone as TimeZone;\n  expose I_BusinessUserBasic as BusinessUser;\n  expose I_ExchangeRate as ExchangeRate;"]]),
  });
  t = await writableApp(Promise.resolve(fixture), { ui: { dir: path.join(fixture.dir, "ui"), resourcesFrom: RUNTIME_DIR } });
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;
  browser = await browserType?.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await t?.close();
});

async function odata(pathAndQuery: string): Promise<Record<string, unknown>> {
  const response = await t.app.inject({ method: "GET", url: `${SERVICE}${pathAndQuery}` });
  expect(response.statusCode, response.body).toBe(200);
  return JSON.parse(response.body) as Record<string, unknown>;
}

describe("standard views (I_Currency)", () => {
  it("adds the standard views and their tables, filled with the reference data", () => {
    expect(fixture.model.service.entitySets).toEqual(
      expect.arrayContaining([
        { name: "I_Currency", entity: "I_Currency", valueHelp: true },
        { name: "I_CurrencyText", entity: "I_CurrencyText", valueHelp: true },
      ]),
    );
    expect(fixture.model.tables.filter((t) => t.standard === true).map((t) => t.name)).toEqual(expect.arrayContaining(["rapt_currency", "rapt_currencyt", "rapt_calendar", "rapt_region", "rapt_bususer"]));
    expect(fixture.schema).toContain('ON CONFLICT ("waers") DO NOTHING;');
    expect(fixture.metadata).toContain('<PropertyValue Property="CollectionPath" String="I_Currency"/>');
  });

  it("reads the currencies and their texts", async () => {
    expect((await odata("I_Currency?$filter=Currency eq 'JPY'"))["value"]).toEqual([expect.objectContaining({ Currency: "JPY", Decimals: 0, CurrencyISOCode: "JPY" })]);
    expect((await odata("I_CurrencyText?$filter=Currency eq 'EUR' and Language eq 'E'"))["value"]).toEqual([expect.objectContaining({ CurrencyName: "Euro" })]);
    expect(((await odata("I_Currency?$count=true&$top=0"))["@odata.count"] as number) > 150).toBe(true);
    // read-only, like a standard view
    const write = await t.app.inject({ method: "POST", url: `${SERVICE}I_Currency`, headers: { "content-type": "application/json" }, payload: JSON.stringify({ Currency: "XXX" }) });
    expect(write.statusCode).toBeGreaterThanOrEqual(400);
  });

  it.skipIf(browserType === undefined)("picks a currency in the value help of the Object Page", async () => {
    const page = await (browser as Browser).newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/`);
    await page.locator(ROWS).first().waitFor({ timeout: 60_000 });
    await page.locator(ROWS, { hasText: "Jul 1, 2026" }).first().click();
    await page.locator(id("TravelObject", "edit")).click();
    await page.locator(`${id("TravelObject", "field_Prices_CurrencyCode")}-vhi`).click();
    // the description comes from the text view
    await page.locator(".sapMDialog", { hasText: "Swiss Franc" }).first().waitFor({ timeout: 30_000 });
    // the search is repeated until the list shows its result: a search typed while the dialog
    // still loads its first page can be overtaken by that page (a slow CI machine)
    const search = page.locator(".sapMDialog input[type=search]").first();
    await expect
      .poll(
        async () => {
          await search.fill("swiss");
          await search.press("Enter");
          await page.waitForTimeout(500);
          return page.locator(".sapMDialog tr.sapMLIB").count();
        },
        { timeout: 45_000, intervals: [1_000] },
      )
      .toBe(1);
    await page.locator(".sapMDialog tr.sapMLIB", { hasText: "Swiss Franc" }).first().click();
    await page.locator(id("TravelObject", "save")).click();
    await page.getByText("Changes saved").first().waitFor({ timeout: 30_000 });
    expect((await odata(`Travel(${T2})`))["CurrencyCode"]).toBe("CHF");
  }, 120_000);

  it("delivers the regions, the calendar, the time zones; records the users; reads the exchange rates of the seed", async () => {
    expect((await odata("Region?$filter=Country eq 'DE'&$count=true&$top=0"))["@odata.count"]).toBe(16);
    expect((await odata("RegionText?$filter=Country eq 'US' and Region eq 'CA'"))["value"]).toEqual([expect.objectContaining({ RegionName: "California" })]);
    expect((await odata("CalendarDate(2026-12-31)"))).toMatchObject({ CalendarYear: "2026", CalendarQuarter: "4", CalendarMonth: "12", CalendarWeek: "53", WeekDay: "4", CalendarDayOfYear: "365", YearWeek: "202653", FirstDayOfWeekDate: "2026-12-28", FirstDayOfMonthDate: "2026-12-01" });
    expect((await odata("CalendarDate?$count=true&$top=0"))["@odata.count"]).toBe(25933);
    expect((await odata("TimeZone('CET')"))).toMatchObject({ TimeZoneUTCDifference: "+0100", TimeZoneIANACode: "Europe/Paris" });
    // the user of the requests above (development user)
    await expect.poll(async () => ((await odata("BusinessUser"))["value"] as Array<Record<string, unknown>>).map((u) => u["UserID"])).toContain("DEVELOPER");
    expect(((await odata("BusinessUser"))["value"] as Array<Record<string, unknown>>)[0]).toMatchObject({ BusinessPartner: "0000000001" });
    expect((await odata("ExchangeRate"))["value"]).toEqual([]);
  });
});
