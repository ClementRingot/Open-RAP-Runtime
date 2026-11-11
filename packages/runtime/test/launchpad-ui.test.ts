/**
 * The launchpad in a browser (D37): the tiles of a viewer (development user with DEV_ROLES), the
 * number of the dynamic tile, the search, then the application opened from its tile through the
 * launchpad, with the shell bar of the launchpad above its pages, and back home.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLaunchpad } from "../src/launchpad/server.js";
import { chromium, ROWS, type Browser } from "./browser.js";
import { generatedFixture, testLaunchpad, writableApp, type TestApp } from "./helpers.js";

const browserType = chromium();
const RUNTIME_DIR = fileURLToPath(new URL("..", import.meta.url));

let t: TestApp;
let launchpad: FastifyInstance;
let browser: Browser;
let base: string;

const tile = (id: string): string => `#container-launchpad---home--tile-${id}`;

beforeAll(async () => {
  if (browserType === undefined) return;
  const fixture = generatedFixture();
  const dir = (await fixture).dir;
  t = await writableApp(fixture, { ui: { dir: path.join(dir, "ui"), resourcesFrom: RUNTIME_DIR }, auth: { mode: "none", user: "VICTOR", roles: ["travel_viewer"] } });
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  const { config, uiDir } = testLaunchpad(dir, `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}/`);
  launchpad = await createLaunchpad({ config, auth: { mode: "none", user: "VICTOR", roles: ["travel_viewer"] }, ui: { dir: uiDir, resourcesFrom: RUNTIME_DIR } });
  await launchpad.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(launchpad.server.address() as { port: number }).port}`;
  browser = await browserType.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await launchpad?.close();
  await t?.close();
});

describe.skipIf(browserType === undefined)("the launchpad in a browser", () => {
  it("shows the tiles of the viewer with the number of travels, and filters them", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/`);
    await page.locator(tile("travel-manage")).waitFor({ timeout: 60_000 });
    // the manager's tile is not assigned to the viewer
    expect(await page.locator(".sapMGT").count()).toBe(2);
    expect(await page.locator(tile("travel-approve")).count()).toBe(0);
    // the $count of the application, with the access controls of the viewer (agencies 07…)
    await page.waitForFunction(`/\\b3\\b/.test(document.querySelector('${tile("travel-manage")} .sapMNCValue')?.textContent ?? '')`, undefined, { timeout: 30_000 });
    expect(await page.locator(tile("travel-manage")).textContent()).toContain("Travels and bookings");
    // the search of the shell bar
    await page.evaluate(`(function () {
      var oSearch = sap.ui.require("sap/ui/core/Element").getElementById("container-launchpad---home--search");
      oSearch.fireLiveChange({ newValue: "docu" });
    })()`);
    await page.waitForFunction(`document.querySelectorAll('.sapMGT').length === 1`, undefined, { timeout: 10_000 });
    expect(await page.locator(".sapMGT").first().textContent()).toContain("Documentation");
  }, 120_000);

  it("opens the application of a tile behind the launchpad, with the shell bar, and goes back home", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/`);
    await page.locator(tile("travel-manage")).click();
    await page.locator(ROWS).first().waitFor({ timeout: 60_000 });
    expect(await page.evaluate("location.pathname")).toBe("/apps/travel/ui/index.html");
    // the rows may come in several renderings: wait for all of them
    await page.waitForFunction(`document.querySelectorAll('${ROWS}').length >= 3`, undefined, { timeout: 30_000 });
    expect(await page.locator(ROWS).count()).toBe(3);
    // the shell bar of the launchpad above the pages of the application
    await page.waitForFunction(`(document.querySelector('#container-rapt---appView--shellBar')?.offsetParent ?? null) !== null`, undefined, { timeout: 30_000 });
    expect(await page.locator("#container-rapt---appView--shellBar").textContent()).toContain("Travel Agency");
    await page.locator("#container-rapt---appView--shellBar img").first().click();
    await page.locator(tile("travel-manage")).waitFor({ timeout: 60_000 });
    expect(await page.evaluate("location.pathname")).toBe("/ui/index.html");
  }, 120_000);

  it("navigates by intent from the hash of the launchpad", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#Travel-manage`);
    await page.locator(ROWS).first().waitFor({ timeout: 60_000 });
    expect(await page.evaluate("location.pathname")).toBe("/apps/travel/ui/index.html");
  }, 120_000);
});
