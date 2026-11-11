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
    expect(fixture.model.tables.filter((t) => t.standard === true).map((t) => t.name)).toEqual(["rapt_currency", "rapt_currencyt"]);
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
    await page.locator(".sapMDialog input[type=search]").first().fill("swiss");
    await page.locator(".sapMDialog input[type=search]").first().press("Enter");
    await page.waitForFunction(`document.querySelectorAll('.sapMDialog tr.sapMLIB').length === 1`, undefined, { timeout: 30_000 });
    await page.locator(".sapMDialog tr.sapMLIB", { hasText: "Swiss Franc" }).first().click();
    await page.locator(id("TravelObject", "save")).click();
    await page.getByText("Changes saved").first().waitFor({ timeout: 30_000 });
    expect((await odata(`Travel(${T2})`))["CurrencyCode"]).toBe("CHF");
  }, 120_000);
});
