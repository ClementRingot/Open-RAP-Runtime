/**
 * The generated OpenUI5 UI in a browser (Playwright, Chromium): List Report, Object Page, edit
 * and save, action under feature control, creation of a travel, creation and deletion of child
 * entities in edit mode, action parameters in a dialog, factory action.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, id, ROWS, type Browser, type Locator, type Page } from "./browser.js";
import { generatedFixture, SERVICE, T1, T2, T3, writableApp, type TestApp } from "./helpers.js";

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
    // the rows may come in several renderings: wait for all of them
    await page.waitForFunction(`document.querySelectorAll('${ROWS}').length >= 3`, undefined, { timeout: 30_000 });
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
    if (SHOTS !== undefined) {
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(SHOTS, "object-page.png") });
    }
  }, 120_000);

  it("shows the compositions of the object in a table and opens their Object Page", async () => {
    const page = await open();
    await page.locator(ROWS).last().click();
    await page.getByText("Paris and Rome").first().waitFor({ timeout: 30_000 });
    await page.waitForFunction(`document.querySelectorAll('${id("TravelObject", "table_Booking")} tr.sapMLIB').length === 3`, undefined, { timeout: 30_000 });
    if (SHOTS !== undefined) {
      await page.waitForTimeout(1000); // the page transition of sap.m.App
      await page.screenshot({ path: path.join(SHOTS, "object-page-bookings.png") });
    }
    await page.locator(`${id("TravelObject", "table_Booking")} tr.sapMLIB`).first().click();
    await page.locator(id("BookingObject", "edit")).waitFor({ timeout: 30_000 });
    await page.waitForFunction(`(document.querySelector('${id("BookingObject", "text_field_Booking_FlightPrice")}') || {}).textContent?.includes("750.25")`, undefined, { timeout: 30_000 });
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

  it("creates and deletes child entities in edit mode, saved together", async () => {
    const page = await open();
    await page.locator(ROWS, { hasText: "Jun 1, 2026" }).first().click();
    const table = id("TravelObject", "table_Booking");
    await page.waitForFunction(`document.querySelectorAll('${table} tr.sapMLIB').length === 3`, undefined, { timeout: 30_000 });
    // booking 0001 is the flight with AF (the table shows the digit sequences without leading zeros)
    const first = (await page.evaluate(`[...document.querySelectorAll('${table} tr.sapMLIB')].findIndex((row) => row.textContent.includes("AF"))`)) as number;
    expect(first).toBeGreaterThanOrEqual(0);
    await page.locator(id("TravelObject", "edit")).click();
    await page.locator(`${table}_create`).click();
    await page.waitForFunction(`document.querySelectorAll('${table} tr.sapMLIB').length === 4`, undefined, { timeout: 30_000 });
    // the new row comes first; its columns: BookingID, BookingDate, CarrierID, ConnectionID, FlightDate, FlightPrice, BookingStatus
    const cells = page.locator(`${table} tr.sapMLIB`).first().locator("input:not([type=radio])");
    const values: Array<[number, string]> = [[0, "0004"], [2, "LH"], [3, "0400"], [4, "Jun 3, 2026"], [5, "10.00"]];
    for (const [index, value] of values) {
      await cells.nth(index).fill(value);
      await cells.nth(index).press("Tab");
    }
    // booking 0001 is deleted: one place further down, below the new row
    await page.locator(`${table} tr.sapMLIB`).nth(first + 1).locator(".sapMRb").click();
    await page.locator(`${table}_delete`).click();
    await page.waitForFunction(`document.querySelectorAll('${table} tr.sapMLIB').length === 3`, undefined, { timeout: 30_000 });
    await page.locator(id("TravelObject", "save")).click();
    await page.getByText("Changes saved").first().waitFor({ timeout: 30_000 });
    const bookings = (await odata(`Travel(${T1})/_Booking?$orderby=BookingID&$select=BookingID,FlightDate,FlightPrice`))["value"] as Array<Record<string, unknown>>;
    expect(bookings.map((b) => b["BookingID"])).toEqual(["0002", "0003", "0004"]);
    expect(bookings[2]).toMatchObject({ FlightDate: "2026-06-03", FlightPrice: 10 });
  }, 120_000);

  it("asks for the parameters of an action in a dialog and shows its error message", async () => {
    const page = await open();
    await page.locator(ROWS, { hasText: "Jul 1, 2026" }).first().click();
    const action = page.locator(id("TravelObject", "objectAction_deductDiscount"));
    await action.waitFor({ timeout: 30_000 });
    const run = async (percent: string): Promise<void> => {
      await action.click();
      await page.locator(".sapMDialog input").first().fill(percent);
      await page.locator(".sapMDialog footer button, .sapMDialog .sapMDialogFooter button", { hasText: "Deduct Discount" }).first().click();
    };
    await run("150");
    await page.getByText("The discount must be between 1 and 100 %, not 150 %").first().waitFor({ timeout: 30_000 });
    await page.locator(".sapMMessageBox button", { hasText: "Close" }).first().click();
    await run("50");
    await page.getByText("Deduct Discount: done").first().waitFor({ timeout: 30_000 });
    expect((await odata(`Travel(${T2})`))["BookingFee"]).toBe(5);
  }, 120_000);

  it("runs a factory action and opens the new instance", async () => {
    const page = await open();
    await page.locator(ROWS, { hasText: "Jul 1, 2026" }).first().click();
    const copy = page.locator(id("TravelObject", "objectAction_copyTravel"));
    await copy.waitFor({ timeout: 30_000 });
    await copy.click();
    await page.getByText("Copy of Business trip to Berlin").first().waitFor({ timeout: 30_000 });
    const copies = (await odata("Travel?$filter=Description eq 'Copy of Business trip to Berlin'"))["value"] as Array<Record<string, unknown>>;
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ OverallStatus: "O", BookingFee: 5 });
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
