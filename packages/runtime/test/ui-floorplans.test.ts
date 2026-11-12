/**
 * The floorplans of the generated UI (D53) in a browser: Analytical List Page (chart from $apply,
 * selection filtering the table), Worklist (tabs of the selection variants with their counts),
 * Overview Page (KPI, list, chart and table cards, navigation), Form entry (create, again).
 * One ABAP runtime and one database; one application per floorplan, each with its own UI.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { generateUi, writeFiles } from "@open-rap/compiler";
import type { Model, UiConfigModel } from "@open-rap/model";
import type { FastifyInstance } from "fastify";
import { PGliteDialect } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDatabase, PGLITE_PARSERS, type Database } from "../src/db/database.js";
import { RapRuntime } from "../src/rap/runtime.js";
import { chromium, id, ROWS, type Browser, type Page } from "./browser.js";
import { edit, generatedVariant, SEED, type GeneratedFixture } from "./helpers.js";

const browserType = chromium();
const RUNTIME_DIR = fileURLToPath(new URL("..", import.meta.url));

const ANNOTATIONS = `@UI.chart: [ { qualifier: 'ByCurrency', title: 'Total price by currency', chartType: #COLUMN, dimensions: [ 'CurrencyCode' ], measures: [ 'TotalPrice' ] },
            { qualifier: 'ByStatus', title: 'Fees by status', chartType: #DONUT, dimensions: [ 'OverallStatus' ], measures: [ 'BookingFee' ] } ]
@UI.selectionVariant: [ { qualifier: 'open', text: 'Open', filter: 'OverallStatus EQ ''O''' },
                        { qualifier: 'accepted', text: 'Accepted', filter: 'OverallStatus EQ ''A''' } ]
@UI.presentationVariant:`;

const CONFIGS: Record<string, UiConfigModel> = {
  alp: { floorplans: { Travel: "analyticalListPage" } },
  worklist: { floorplans: { Travel: "worklist" } },
  form: { floorplans: { Travel: "formEntry" } },
  overview: {
    overview: {
      title: "Travel Overview",
      cards: [
        { type: "kpi", entitySet: "Travel", title: "Revenue", measure: "TotalPrice", filter: "OverallStatus eq 'O'" },
        { type: "kpi", entitySet: "Travel", title: "Travels", aggregation: "count" },
        { type: "list", entitySet: "Travel", title: "Open travels", filter: "OverallStatus eq 'O'", orderby: "BeginDate", top: 4 },
        { type: "chart", entitySet: "Travel", title: "Revenue by currency", chart: "ByCurrency" },
        { type: "table", entitySet: "Travel", title: "Latest travels", orderby: "TravelID desc" },
      ],
    },
  },
};

let fixture: GeneratedFixture;
let db: Database;
let browser: Browser | undefined;
const apps: Record<string, { app: FastifyInstance; base: string }> = {};

beforeAll(async () => {
  if (browserType === undefined) return;
  fixture = await generatedVariant({ "zrt_c_travel.ddlx.asddlxs": (c) => edit(c, [["@UI.presentationVariant:", ANNOTATIONS]]) });
  const pglite = await PGlite.create({ parsers: PGLITE_PARSERS });
  await pglite.exec("SET TIME ZONE 'UTC'");
  await pglite.exec(fixture.schema);
  await pglite.exec(SEED);
  db = createDatabase(new PGliteDialect({ pglite }));
  const rap = await RapRuntime.load(fixture.model, fixture.abapDir);
  for (const [name, ui] of Object.entries(CONFIGS)) {
    const model: Model = { ...fixture.model, ui };
    const dir = mkdtempSync(path.join(tmpdir(), `rapt-floorplan-${name}-`));
    writeFiles(dir, generateUi(model));
    const app = await createApp({ model, metadata: fixture.metadata, db, rap, ui: { dir, resourcesFrom: RUNTIME_DIR } });
    await app.listen({ port: 0, host: "127.0.0.1" });
    apps[name] = { app, base: `http://127.0.0.1:${(app.server.address() as { port: number }).port}` };
  }
  browser = await browserType.launch();
}, 240_000);

afterAll(async () => {
  await browser?.close();
  for (const { app } of Object.values(apps)) await app.close();
  await db?.destroy();
});

async function open(name: string): Promise<Page> {
  const page = await (browser as Browser).newPage({ viewport: { width: 1400, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${apps[name]?.base ?? ""}/ui/index.html`);
  return page;
}

const rows = `${id("TravelList", "table")} ${ROWS}`;

describe.skipIf(browserType === undefined)("floorplans", () => {
  it("Analytical List Page: the chart of the groups filters the table", async () => {
    const page = await open("alp");
    await page.locator(rows).first().waitFor({ timeout: 60_000 });
    await page.waitForFunction(`document.querySelectorAll('${id("TravelList", "chart")} .raptChartItem').length === 2`, undefined, { timeout: 30_000 });
    expect(await page.locator(id("TravelList", "chartTitle")).textContent()).toBe("Total price by currency");
    // the EUR column (first, ordered by currency)
    await page.locator(`${id("TravelList", "chart")} .raptChartItem`).first().click();
    await page.waitForFunction(`document.querySelectorAll('${rows}').length === 2`, undefined, { timeout: 30_000 });
    expect(await page.locator(id("TravelList", "chartSelection")).textContent()).toBe("Currency: EUR");
    // the filter bar filters the chart too
    await page.locator(`${id("TravelList", "chart")} .raptChartItem`).first().click();
    await page.locator(`${id("TravelList", "filter_AgencyID")}-inner`).fill("70002");
    await page.locator(`${id("TravelList", "filter_AgencyID")}-inner`).press("Enter");
    await page.waitForFunction(`document.querySelectorAll('${id("TravelList", "chart")} .raptChartItem').length === 1`, undefined, { timeout: 30_000 });
    // table only
    await page.locator(`${id("TravelList", "viewSwitch")} li`).nth(2).click();
    await page.waitForFunction(`(document.querySelector('${id("TravelList", "chartArea")}')?.offsetParent ?? null) === null`, undefined, { timeout: 10_000 });
  }, 120_000);

  it("Worklist: the selection variants are tabs with their counts", async () => {
    const page = await open("worklist");
    await page.locator(rows).first().waitFor({ timeout: 60_000 });
    expect(await page.locator(id("TravelList", "filterBar")).count()).toBe(0);
    const tabs = `${id("TravelList", "worklistTabs")} [role=tab]`;
    await page.waitForFunction(`[...document.querySelectorAll('${tabs}')].map((t) => t.textContent).join('|') === 'All (3)|Open (1)|Accepted (1)'`, undefined, { timeout: 30_000 });
    await page.locator(tabs, { hasText: "Accepted" }).click();
    await page.waitForFunction(`document.querySelectorAll('${rows}').length === 1`, undefined, { timeout: 30_000 });
    expect(await page.locator(rows).first().textContent()).toContain("70002");
  }, 120_000);

  it("Overview Page: KPI, list, chart and table cards; the list opens its object", async () => {
    const page = await open("overview");
    await page.locator(id("Overview", "card0")).waitFor({ timeout: 60_000 });
    await page.waitForFunction(`(document.querySelector('${id("Overview", "card1_header")}')?.textContent ?? '').includes('3')`, undefined, { timeout: 30_000 });
    await page.waitForFunction(`(document.querySelector('${id("Overview", "card0_header")}')?.textContent ?? '').includes('1.5K')`, undefined, { timeout: 30_000 });
    await page.waitForFunction(`document.querySelectorAll('${id("Overview", "card3_chart")} .raptChartItem').length === 2`, undefined, { timeout: 30_000 });
    await page.waitForFunction(`document.querySelectorAll('${id("Overview", "card4_table")} ${ROWS}').length === 3`, undefined, { timeout: 30_000 });
    await page.locator(`${id("Overview", "card2_list")} li`).first().click();
    await page.getByText("Paris and Rome").first().waitFor({ timeout: 30_000 });
    // the header of a card opens the list report
    await page.goBack();
    await page.locator(id("Overview", "card2_header")).click();
    await page.locator(rows).first().waitFor({ timeout: 30_000 });
  }, 120_000);

  it("Form entry: the start page creates, and is empty again", async () => {
    const page = await open("form");
    const field = (section: string, property: string): string => `${id("TravelObject", `field_${section}_${property}`)}-inner`;
    await page.locator(field("Travel", "TravelID")).waitFor({ timeout: 60_000 });
    const values: Array<[string, string, string]> = [
      ["Travel", "TravelID", "88"],
      ["Travel", "AgencyID", "070001"],
      ["Travel", "CustomerID", "000088"],
      ["Travel", "Description", "Entered in a form"],
      ["Prices", "CurrencyCode", "EUR"],
      ["Dates", "BeginDate", "Mar 1, 2027"],
      ["Dates", "EndDate", "Mar 9, 2027"],
    ];
    for (const [section, property, value] of values) {
      await page.locator(field(section, property)).fill(value);
      await page.locator(field(section, property)).press("Tab");
    }
    await page.locator(id("TravelObject", "save")).click();
    await page.getByText("Object created").first().waitFor({ timeout: 30_000 });
    await page.waitForFunction(`document.querySelector('${field("Travel", "Description")}').value === ''`, undefined, { timeout: 30_000 });
    const created = await apps["form"]?.app.inject({ method: "GET", url: "/sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001/Travel?$filter=Description%20eq%20'Entered%20in%20a%20form'" });
    expect((JSON.parse(created?.body ?? "{}") as { value: unknown[] }).value).toHaveLength(1);
  }, 120_000);
});
