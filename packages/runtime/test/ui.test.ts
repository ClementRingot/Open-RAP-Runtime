/**
 * The generated OpenUI5 UI in a browser (Playwright, Chromium): List Report, Object Page, edit
 * and save, action under feature control, creation of a travel.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatedFixture, SERVICE, T3, writableApp, type TestApp } from "./helpers.js";

interface Locator {
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
  count(): Promise<number>;
  first(): Locator;
  waitFor(options?: { state?: string; timeout?: number }): Promise<void>;
  textContent(): Promise<string | null>;
  isEnabled(): Promise<boolean>;
}
interface Page {
  goto(url: string): Promise<unknown>;
  locator(selector: string): Locator;
  getByText(text: string, options?: { exact?: boolean }): Locator;
  waitForFunction(fn: string, arg?: unknown, options?: { timeout?: number }): Promise<unknown>;
  on(event: string, listener: (value: unknown) => void): void;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
}
interface Browser {
  newPage(options?: { viewport?: { width: number; height: number } }): Promise<Page>;
  close(): Promise<void>;
}

/** Playwright from the project, or the copy pre-installed in the development container. */
function chromium(): { launch(): Promise<Browser> } | undefined {
  const require = createRequire(import.meta.url);
  for (const id of [process.env["PLAYWRIGHT_MODULE"], "playwright", "/opt/node-tools/node_modules/playwright"]) {
    if (id === undefined) continue;
    try {
      return (require(id) as { chromium: { launch(): Promise<Browser> } }).chromium;
    } catch {
      // next
    }
  }
  return undefined;
}

const browserType = chromium();
const RUNTIME_DIR = fileURLToPath(new URL("..", import.meta.url));
const SHOTS = process.env["RAPT_SCREENSHOTS"];

let t: TestApp;
let browser: Browser;
let base: string;

beforeAll(async () => {
  if (browserType === undefined) return;
  const fixture = generatedFixture();
  t = await writableApp(fixture, { ui: { dir: path.join((await fixture).dir, "ui"), resourcesFrom: RUNTIME_DIR } });
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;
  browser = await browserType.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await t?.close();
});

async function odata(pathAndQuery: string): Promise<Record<string, unknown>> {
  const response = await t.app.inject({ method: "GET", url: `${SERVICE}${pathAndQuery}` });
  return JSON.parse(response.body) as Record<string, unknown>;
}

const id = (view: string, control: string): string => `#container-rapt---${view}--${control}`;
/** The data rows of the tables (not the column headers). */
const ROWS = "tr.sapMLIB.sapMListTblRow";

async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/`);
  await page.locator(ROWS).first().waitFor({ timeout: 60_000 });
  expect(errors).toEqual([]);
  return page;
}

describe.skipIf(browserType === undefined)("generated UI (OpenUI5)", () => {
  it("shows the List Report with the line items, sorted by the presentation variant", async () => {
    const page = await open();
    expect(await page.locator(ROWS).count()).toBe(3);
    // TravelID desc: the first row is the third travel
    expect(await page.locator(ROWS).first().textContent()).toContain("Jan 5, 2027");
    if (SHOTS !== undefined) await page.screenshot({ path: path.join(SHOTS, "list-report.png") });
  }, 120_000);

  it("filters the list with a selection field", async () => {
    const page = await open();
    await page.locator(`${id("TravelList", "filter_AgencyID")}-inner`).fill("070002");
    await page.locator(id("TravelList", "go")).click();
    await page.waitForFunction("document.querySelectorAll('tr.sapMLIB.sapMListTblRow').length === 1", undefined, { timeout: 30_000 });
  }, 120_000);

  it("opens the Object Page, edits and saves", async () => {
    const page = await open();
    await page.locator(ROWS).first().click();
    await page.getByText("Ski holidays").first().waitFor({ timeout: 30_000 });
    await page.locator(id("TravelObject", "edit")).click();
    const description = page.locator(`${id("TravelObject", "field_Travel_Description")}-inner`);
    await description.fill("Ski holidays in the Alps");
    await description.press("Tab");
    await page.locator(id("TravelObject", "save")).click();
    await page.getByText("Changes saved").first().waitFor({ timeout: 30_000 });
    expect((await odata(`Travel(${T3})`))["Description"]).toBe("Ski holidays in the Alps");
    if (SHOTS !== undefined) await page.screenshot({ path: path.join(SHOTS, "object-page.png"), fullPage: true });
  }, 120_000);

  it("runs an action and disables it by instance feature control", async () => {
    const page = await open();
    await page.locator(ROWS).first().click();
    const accept = page.locator(id("TravelObject", "objectAction_acceptTravel"));
    await accept.waitFor({ timeout: 30_000 });
    await page.waitForFunction(`!document.querySelector('${id("TravelObject", "objectAction_acceptTravel")}').classList.contains('sapMBtnDisabled')`, undefined, { timeout: 30_000 });
    await accept.click();
    await page.getByText("Accept Travel: done").first().waitFor({ timeout: 30_000 });
    expect((await odata(`Travel(${T3})`))["OverallStatus"]).toBe("A");
    await page.waitForFunction(`document.querySelector('${id("TravelObject", "objectAction_acceptTravel")}').classList.contains('sapMBtnDisabled')`, undefined, { timeout: 30_000 });
  }, 120_000);

  it("creates a travel from the List Report", async () => {
    const page = await open();
    await page.locator(id("TravelList", "create")).click();
    const field = (section: string, property: string): Locator => page.locator(`${id("TravelObject", `field_${section}_${property}`)}-inner`);
    await field("Travel", "TravelID").waitFor({ timeout: 30_000 });
    const values: Array<[string, string, string]> = [
      ["Travel", "TravelID", "42"],
      ["Travel", "AgencyID", "070001"],
      ["Travel", "CustomerID", "000042"],
      ["Travel", "Description", "Created in the browser"],
      ["Prices", "BookingFee", "12.50"],
      ["Prices", "CurrencyCode", "EUR"],
      ["Dates", "BeginDate", "Mar 1, 2027"],
      ["Dates", "EndDate", "Mar 9, 2027"],
    ];
    for (const [section, property, value] of values) {
      await field(section, property).fill(value);
      await field(section, property).press("Tab");
    }
    await page.locator(id("TravelObject", "save")).click();
    await page.getByText("Object created").first().waitFor({ timeout: 30_000 });
    const created = (await odata("Travel?$filter=TravelID eq '00000042'"))["value"] as Array<Record<string, unknown>>;
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ Description: "Created in the browser", BeginDate: "2027-03-01", EndDate: "2027-03-09", OverallStatus: "O", TotalPrice: 12.5 });
  }, 120_000);
});
