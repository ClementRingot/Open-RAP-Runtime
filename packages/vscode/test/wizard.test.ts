/**
 * The page of the creation wizard (D61) in a browser: the type of a service binding, UI or Web
 * API, with readable labels, and the name it proposes for each one (D76). Skipped without
 * Playwright.
 */

import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OBJECT_CATALOG } from "../../compiler/src/authoring/catalog.js";
import { bindingNames } from "../src/rapt.js";
import { wizardHtml } from "../src/wizard-html.js";

interface Page {
  setContent(html: string): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<unknown>;
  inputValue(selector: string): Promise<string>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
}
interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

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

describe.skipIf(browserType === undefined)("the creation wizard in a browser (D76)", () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await browserType!.launch();
    page = await browser.newPage();
    // the API of the webview, before the script of the page: its messages are kept for the test
    const stub = '<script nonce="test">window.posted = []; window.acquireVsCodeApi = () => ({ postMessage: (m) => window.posted.push(m) });</script>';
    await page.setContent(wizardHtml("test", "'self'").replace('<script nonce="test">', `${stub}<script nonce="test">`));
    const objects = { srvd: ["ZRT_UI_TRAVEL", "ZUI_ORDER"], entity: [], table: [], bdef: [], domain: [] };
    await page.evaluate(`window.postMessage(${JSON.stringify({ type: "init", catalog: OBJECT_CATALOG, objects, bindingNames: bindingNames(objects.srvd) })}, "*")`);
    await page.waitForSelector(".item", { timeout: 10_000 });
  }, 60_000);
  afterAll(async () => browser?.close());

  it("names a binding after its service definition and its type, until the name is typed", async () => {
    await page.click('.item[data-kind="binding"]');
    expect(await page.evaluate(`Array.from(document.querySelectorAll("#in_binding-type option")).map((o) => o.textContent)`)).toEqual([
      "UI: a Fiori application, in the launchpad",
      "Web API: for other systems, without UI, not in the launchpad",
    ]);
    expect(await page.inputValue("#name")).toBe("ZRT_UI_TRAVEL_O4");
    await page.selectOption("#in_binding-type", "webapi");
    expect(await page.inputValue("#name")).toBe("ZRT_API_TRAVEL_O4");
    await page.selectOption("#in_for", "ZUI_ORDER");
    expect(await page.inputValue("#name")).toBe("ZAPI_ORDER_O4");

    // a name typed by the user is kept
    await page.fill("#name", "ZMY_ORDER_API_O4");
    await page.selectOption("#in_binding-type", "ui");
    expect(await page.inputValue("#name")).toBe("ZMY_ORDER_API_O4");
    await page.selectOption("#in_binding-type", "webapi");
    await page.click("#finish");
    expect(await page.evaluate("window.posted.at(-1)")).toMatchObject({ type: "finish", answer: { kind: "binding", name: "ZMY_ORDER_API_O4", values: { "--for": "ZUI_ORDER", "--binding-type": "webapi" } } });
  });

  it("asks whether a complete business object is a Fiori application or a Web API", async () => {
    await page.click('.item[data-kind="bo"]');
    expect(await page.evaluate(`document.querySelector('label[for="in_binding-type"]').textContent`)).toBe("Service");
    expect(await page.inputValue("#in_binding-type")).toBe("ui");
    await page.fill("#name", "Partner");
    await page.selectOption("#in_binding-type", "webapi");
    await page.click("#finish");
    expect(await page.evaluate("window.posted.at(-1)")).toMatchObject({ type: "finish", answer: { kind: "bo", name: "Partner", values: { "--binding-type": "webapi" } } });
  });
});
