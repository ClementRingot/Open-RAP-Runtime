/**
 * The draft in the generated UI (D54): Create opens a new draft, Save activates it; Edit opens the
 * draft of an instance, each change is saved in the draft, the list shows the lock; Discard.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, id, ROWS, type Browser, type Page } from "./browser.js";
import { DRAFT_CHANGES, generatedVariant, SERVICE, T2, writableApp, type TestApp } from "./helpers.js";

const browserType = chromium();
const RUNTIME_DIR = fileURLToPath(new URL("..", import.meta.url));

let t: TestApp;
let browser: Browser;
let base: string;

beforeAll(async () => {
  if (browserType === undefined) return;
  const fixture = generatedVariant(DRAFT_CHANGES);
  t = await writableApp(fixture, { ui: { dir: path.join((await fixture).dir, "ui"), resourcesFrom: RUNTIME_DIR } });
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;
  browser = await browserType.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await t?.close();
});

async function odata(url: string): Promise<Record<string, unknown>> {
  return JSON.parse((await t.app.inject({ method: "GET", url: `${SERVICE}${url}` })).body) as Record<string, unknown>;
}

async function open(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${base}/`);
  await page.locator(ROWS).first().waitFor({ timeout: 60_000 });
  return page;
}

const field = (section: string, property: string): string => `${id("TravelObject", `field_${section}_${property}`)}-inner`;

describe.skipIf(browserType === undefined)("draft in the UI", () => {
  it("creates a draft and activates it", async () => {
    const page = await open();
    await page.locator(id("TravelList", "create")).click();
    await page.locator(field("Travel", "TravelID")).waitFor({ timeout: 30_000 });
    await page.waitForFunction("location.hash.includes('IsActiveEntity=false')", undefined, { timeout: 30_000 });
    for (const [section, property, value] of [
      ["Travel", "TravelID", "55"],
      ["Travel", "AgencyID", "070001"],
      ["Travel", "CustomerID", "000055"],
      ["Travel", "Description", "Drafted in the browser"],
      ["Prices", "CurrencyCode", "EUR"],
      ["Dates", "BeginDate", "Mar 1, 2027"],
      ["Dates", "EndDate", "Mar 9, 2027"],
    ] as const) {
      await page.locator(field(section, property)).fill(value);
      await page.locator(field(section, property)).press("Tab");
    }
    // each change is in the draft already
    await expect.poll(async () => ((await odata("Travel?$filter=IsActiveEntity eq false"))["value"] as unknown[]).length, { timeout: 10_000 }).toBe(1);
    await page.locator(id("TravelObject", "save")).click();
    await page.getByText("Object created").first().waitFor({ timeout: 30_000 });
    await page.waitForFunction("location.hash.includes('IsActiveEntity=true')", undefined, { timeout: 30_000 });
    const created = (await odata("Travel?$filter=TravelID eq '00000055'"))["value"] as Array<Record<string, unknown>>;
    expect(created).toEqual([expect.objectContaining({ IsActiveEntity: true, Description: "Drafted in the browser", OverallStatus: "O" })]);
  }, 120_000);

  it("edits an instance in a draft, shows the lock, and saves", async () => {
    const page = await open();
    await page.locator(ROWS, { hasText: "70002" }).first().click();
    await page.locator(id("TravelObject", "edit")).click();
    await page.waitForFunction("location.hash.includes('IsActiveEntity=false')", undefined, { timeout: 30_000 });
    await page.locator(field("Travel", "Description")).fill("Berlin, in a draft");
    await page.locator(field("Travel", "Description")).press("Tab");
    await expect.poll(async () => (await odata(`Travel(TravelUUID=${T2},IsActiveEntity=true)`))["HasDraftEntity"], { timeout: 10_000 }).toBe(true);
    expect((await odata(`Travel(TravelUUID=${T2},IsActiveEntity=true)`))["Description"]).toBe("Business trip to Berlin");
    await page.locator(id("TravelObject", "save")).click();
    await page.getByText("Changes saved").first().waitFor({ timeout: 30_000 });
    expect(await odata(`Travel(TravelUUID=${T2},IsActiveEntity=true)`)).toMatchObject({ Description: "Berlin, in a draft", HasDraftEntity: false });
  }, 120_000);

  it("works like Fiori Elements: draft indicator, keep the draft when leaving, own draft in the list (D58)", async () => {
    const page = await open();
    await page.locator(ROWS, { hasText: "70002" }).first().click();
    await page.locator(id("TravelObject", "edit")).click();
    await page.waitForFunction("location.hash.includes('IsActiveEntity=false')", undefined, { timeout: 30_000 });
    await page.locator(id("TravelObject", "draftMarker")).waitFor({ timeout: 30_000 });
    await page.locator(field("Travel", "Description")).fill("Kept as a draft");
    await page.locator(field("Travel", "Description")).press("Tab");
    await expect.poll(async () => page.locator(id("TravelObject", "draftStatus")).textContent(), { timeout: 10_000 }).toMatch(/Draft (saved|updated)/);
    // leaving the page: keep the draft
    await page.locator(id("TravelObject", "crumbList")).click();
    await page.locator(".sapMMessageBox button", { hasText: "Keep Draft" }).first().click();
    await page.locator(ROWS).first().waitFor({ timeout: 30_000 });
    // the list shows the own draft instead of the active instance, with its marker
    await expect.poll(async () => page.locator(ROWS, { hasText: "70002" }).count(), { timeout: 15_000 }).toBe(1);
    expect(await page.locator(ROWS, { hasText: "70002" }).first().textContent()).toContain("Draft");
    // Editing Status: own drafts
    await page.locator(id("TravelList", "filter_EditingStatus")).click();
    await page.locator("li.sapMSelectListItemBase", { hasText: "Own Draft" }).first().click();
    await page.locator(id("TravelList", "go")).click();
    await expect.poll(async () => page.locator(`${id("TravelList", "table")} ${ROWS}`).count(), { timeout: 15_000 }).toBe(1);
    // back to the draft, discarded from the object page
    await page.locator(ROWS, { hasText: "70002" }).first().click();
    await page.locator(id("TravelObject", "cancel")).click();
    await page.locator(".sapMMessageBox button", { hasText: "Discard" }).first().click();
    await page.waitForFunction("location.hash.includes('IsActiveEntity=true')", undefined, { timeout: 30_000 });
    expect((await odata(`Travel(TravelUUID=${T2},IsActiveEntity=true)`))["HasDraftEntity"]).toBe(false);
  }, 120_000);

  it("discards a draft", async () => {
    const page = await open();
    await page.locator(ROWS, { hasText: "70002" }).first().click();
    await page.locator(id("TravelObject", "edit")).click();
    await page.waitForFunction("location.hash.includes('IsActiveEntity=false')", undefined, { timeout: 30_000 });
    await page.locator(id("TravelObject", "cancel")).click();
    await page.locator(".sapMMessageBox button", { hasText: "Discard" }).first().click();
    await page.waitForFunction("location.hash.includes('IsActiveEntity=true')", undefined, { timeout: 30_000 });
    expect((await odata(`Travel(TravelUUID=${T2},IsActiveEntity=true)`))["HasDraftEntity"]).toBe(false);
  }, 120_000);
});
