/**
 * Feature control in the generated UI (browser), on the variant with global feature control of
 * delete and copyTravel and instance feature control of Description: the Delete button and the
 * action are disabled, the field is read-only in edit mode once the travel is accepted.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, id, ROWS, type Browser, type Page } from "./browser.js";
import { generatedVariant, writableApp, type TestApp } from "./helpers.js";
import { featuresVariant } from "./variants.js";

const browserType = chromium();
const RUNTIME_DIR = fileURLToPath(new URL("..", import.meta.url));

let t: TestApp;
let browser: Browser;
let base: string;

beforeAll(async () => {
  if (browserType === undefined) return;
  const fixture = generatedVariant(featuresVariant());
  t = await writableApp(fixture, { ui: { dir: path.join((await fixture).dir, "ui"), resourcesFrom: RUNTIME_DIR } });
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;
  browser = await browserType.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await t?.close();
});

/** The Object Page of the travel whose row shows `text` in the List Report. */
async function openTravel(text: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${base}/`);
  await page.locator(ROWS).first().waitFor({ timeout: 60_000 });
  await page.locator(ROWS, { hasText: text }).first().click();
  await page.locator(id("TravelObject", "edit")).waitFor({ timeout: 30_000 });
  return page;
}

const disabled = (selector: string, on: boolean): string => `(document.querySelector('${selector}')?.classList.contains('sapMBtnDisabled') ?? null) === ${on}`;

describe.skipIf(browserType === undefined)("feature control in the generated UI", () => {
  it("disables Delete and an action by global feature control", async () => {
    const page = await openTravel("Jun 1, 2026");
    await page.waitForFunction(disabled(id("TravelObject", "deleteObject"), true), undefined, { timeout: 30_000 });
    await page.waitForFunction(disabled(id("TravelObject", "objectAction_copyTravel"), true), undefined, { timeout: 30_000 });
    await page.waitForFunction(disabled(id("TravelObject", "objectAction_acceptTravel"), false), undefined, { timeout: 30_000 });
    expect(await page.locator(id("TravelObject", "edit")).isEnabled()).toBe(true);
  }, 120_000);

  it("makes a field read-only in edit mode by instance feature control", async () => {
    const description = `${id("TravelObject", "field_Travel_Description")}-inner`;
    const accepted = await openTravel("Jul 1, 2026");
    await accepted.locator(id("TravelObject", "edit")).click();
    await accepted.locator(description).waitFor({ timeout: 30_000 });
    await accepted.waitForFunction(`document.querySelector('${description}')?.readOnly === true`, undefined, { timeout: 30_000 });
    const open = await openTravel("Jun 1, 2026");
    await open.locator(id("TravelObject", "edit")).click();
    await open.locator(description).waitFor({ timeout: 30_000 });
    await open.waitForFunction(`document.querySelector('${description}')?.readOnly === false`, undefined, { timeout: 30_000 });
  }, 120_000);
});
