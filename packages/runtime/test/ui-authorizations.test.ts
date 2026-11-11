/**
 * Authorizations in the generated UI (browser, D36): a viewer (role travel_viewer, development
 * user with DEV_ROLES) sees the travels, but neither Create in the List Report nor an enabled
 * Edit, Delete or action on the Object Page.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, id, ROWS, type Browser } from "./browser.js";
import { generatedFixture, SERVICE, writableApp, type TestApp } from "./helpers.js";

const browserType = chromium();
const RUNTIME_DIR = fileURLToPath(new URL("..", import.meta.url));

let t: TestApp;
let browser: Browser;
let base: string;

beforeAll(async () => {
  if (browserType === undefined) return;
  const fixture = generatedFixture();
  t = await writableApp(fixture, { ui: { dir: path.join((await fixture).dir, "ui"), resourcesFrom: RUNTIME_DIR }, auth: { mode: "none", user: "VICTOR", roles: ["travel_viewer"] } });
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;
  browser = await browserType.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await t?.close();
});

const disabled = (selector: string, on: boolean): string => `(document.querySelector('${selector}')?.classList.contains('sapMBtnDisabled') ?? null) === ${on}`;

describe.skipIf(browserType === undefined)("authorizations in the generated UI", () => {
  it("tells the UI which creations the user may perform", async () => {
    const response = await t.app.inject({ method: "GET", url: `${SERVICE}$permissions` });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ Travel: { create: false } });
  });

  it("hides Create and disables Edit, Delete and the actions for a viewer", async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/`);
    await page.locator(ROWS).first().waitFor({ timeout: 60_000 });
    // the agencies 07…: every travel of the fixture
    // the rows may come in several renderings: wait for all of them
    await page.waitForFunction(`document.querySelectorAll('${ROWS}').length >= 3`, undefined, { timeout: 30_000 });
    expect(await page.locator(ROWS).count()).toBe(3);
    await page.waitForFunction(`!document.querySelector('${id("TravelList", "create")}') || document.querySelector('${id("TravelList", "create")}').offsetParent === null`, undefined, { timeout: 30_000 });

    await page.locator(ROWS, { hasText: "Jun 1, 2026" }).first().click();
    await page.locator(id("TravelObject", "edit")).waitFor({ timeout: 30_000 });
    await page.waitForFunction(disabled(id("TravelObject", "edit"), true), undefined, { timeout: 30_000 });
    await page.waitForFunction(disabled(id("TravelObject", "deleteObject"), true), undefined, { timeout: 30_000 });
    await page.waitForFunction(disabled(id("TravelObject", "objectAction_acceptTravel"), true), undefined, { timeout: 30_000 });
    expect(await page.locator(id("TravelObject", "edit")).isEnabled()).toBe(false);
  }, 120_000);
});
