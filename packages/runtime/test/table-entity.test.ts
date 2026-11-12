/**
 * CDS table entities, simple types and enumerated types (D55), on the fixture table-entity
 * (enhanced mode): the BO is defined on a table entity (its own persistence), the enumerated
 * elements are OData enumeration types (member names in JSON, $filter literals), the behavior
 * pool uses the enumerated constants, and the UI shows the labels of the members.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { generateApplication, loadProject, writeFiles } from "@open-rap/compiler";
import type { FastifyInstance } from "fastify";
import { PGliteDialect } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { applySchema, createDatabase, PGLITE_PARSERS, type Database } from "../src/db/database.js";
import { applySeed } from "../src/db/seed.js";
import { RapRuntime } from "../src/rap/runtime.js";
import { chromium, id, ROWS, type Browser } from "./browser.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/table-entity", import.meta.url));
const RUNTIME_DIR = fileURLToPath(new URL("..", import.meta.url));
const SERVICE = "/sap/opu/odata4/sap/zrt_ui_order_o4/srvd/sap/zrt_ui_order/0001/";
const NAMESPACE = "com.sap.gateway.srvd.zrt_ui_order.v0001";
const HEADERS = { "content-type": "application/json", accept: "application/json", "if-match": "*" };

const browserType = chromium();
let app: FastifyInstance;
let db: Database;
let metadata: string;
let browser: Browser | undefined;
let base: string;

beforeAll(async () => {
  const result = await generateApplication(loadProject(FIXTURE), { scaffold: false });
  if (result.model === undefined || result.diagnostics.hasErrors()) {
    throw new Error(JSON.stringify(result.diagnostics.items));
  }
  expect(result.diagnostics.items.filter((d) => d.severity !== "info")).toEqual([]);
  const out = fileURLToPath(new URL(`./.generated/table-entity-${process.pid}-${Math.random().toString(36).slice(2, 8)}`, import.meta.url));
  mkdirSync(out, { recursive: true });
  writeFiles(out, result.files);
  const file = (name: string): string => result.files.find((f) => f.path === name)?.content ?? "";
  metadata = file("odata/metadata.xml");
  const pglite = await PGlite.create({ parsers: PGLITE_PARSERS });
  db = createDatabase(new PGliteDialect({ pglite }));
  await applySchema(db, file("db/schema.sql"));
  await applySeed(db, result.model, out);
  const rap = await RapRuntime.load(result.model, path.join(out, "abap"));
  app = await createApp({ model: result.model, metadata, db, rap, ui: { dir: path.join(out, "ui"), resourcesFrom: RUNTIME_DIR } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  if (browserType !== undefined) {
    browser = await browserType.launch();
  }
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
  await db?.destroy();
});

async function get(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.inject({ method: "GET", url: `${SERVICE}${url}`, headers: { accept: "application/json" } });
  return { status: response.statusCode, body: JSON.parse(response.body) as Record<string, unknown> };
}

async function call(method: "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.inject({ method, url: `${SERVICE}${url}`, headers: HEADERS, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

const values = (body: Record<string, unknown>): Array<Record<string, unknown>> => body["value"] as Array<Record<string, unknown>>;

describe("table entities and enumerated types", () => {
  it("expose the enumerated types as OData enumeration types (enhanced mode)", () => {
    expect(metadata).toContain('<Property Name="Status" Type="SAP__self.ZRT_ORDER_STATUS" Nullable="false"/>');
    expect(metadata).toContain('<EnumType Name="ZRT_PRIORITY" UnderlyingType="Edm.Byte">');
    expect(metadata).toMatch(/<Member Name="OPEN" Value="1">\s*<Annotation Term="Core.Description" String="Open"\/>/);
    expect(metadata).toContain('<Member Name="HIGH" Value="9">');
  });

  it("read the table entity, with the member names of the enumerated values", async () => {
    const all = await get("Orders?$select=OrderId,Name,Status,Priority&$orderby=OrderId");
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(values(all.body)).toEqual([
      { OrderId: "00000001", Name: "Laptops for the team", Status: "OPEN", Priority: "HIGH" },
      { OrderId: "00000002", Name: "Office chairs", Status: "DONE", Priority: "MEDIUM" },
      { OrderId: "00000003", Name: "Coffee machine", Status: "NEW", Priority: "LOW" },
    ]);
  });

  it("filter with member names, qualified enumeration literals and integral values", async () => {
    const ids = async (filter: string): Promise<unknown[]> => values((await get(`Orders?$select=OrderId&$filter=${encodeURIComponent(filter)}`)).body).map((r) => r["OrderId"]);
    expect(await ids("Status eq 'OPEN'")).toEqual(["00000001"]);
    expect(await ids(`Priority eq ${NAMESPACE}.ZRT_PRIORITY'MEDIUM'`)).toEqual(["00000002"]);
    expect(await ids("Status ne 'NEW' and Priority eq 9")).toEqual(["00000001"]);
    const bad = await get(`Orders?$filter=${encodeURIComponent("Status eq 'LATE'")}`);
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain("not a member of ZRT_ORDER_STATUS");
  });

  it("write member names: the table entity is the persistence, the behavior pool uses the constants", async () => {
    const created = await call("POST", "Orders", { OrderId: "00000010", Name: "Desk", Priority: "MEDIUM", Amount: 120, Currency: "EUR" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // determination setOpen: Status = zrt_order_status-open
    expect(created.body).toMatchObject({ Status: "OPEN", Priority: "MEDIUM" });
    const rows = await db.selectFrom("zrt_order" as never).selectAll().where("orderid" as never, "=", "00000010" as never).execute();
    expect(rows).toEqual([expect.objectContaining({ orderid: "00000010", name: "Desk", status: "O", priority: 5 })]);
    const completed = await call("POST", `Orders('00000010')/${NAMESPACE}.complete`, {});
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.body["Status"]).toBe("DONE");
    expect((await call("PATCH", "Orders('00000010')", { Priority: "HIGH" })).status).toBe(200);
    expect((await get("Orders('00000010')")).body).toMatchObject({ Status: "DONE", Priority: "HIGH" });
    const wrong = await call("POST", "Orders", { OrderId: "00000011", Name: "Lamp", Priority: "URGENT" });
    expect(wrong.status).toBe(400);
    expect(JSON.stringify(wrong.body)).toContain("not a member of ZRT_PRIORITY (LOW, MEDIUM, HIGH)");
  });
});

describe.skipIf(browserType === undefined)("enumerated types in the UI", () => {
  it("shows the labels, filters by member and edits with a select", async () => {
    const page = await (browser as Browser).newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/`);
    await page.locator(ROWS).first().waitFor({ timeout: 60_000 });
    await page.locator(ROWS, { hasText: "Laptops for the team" }).first().waitFor({ timeout: 30_000 });
    // default filter value (Currency = EUR: the two seeded orders and the one created above), text arrangement, criticality (D57)
    await expect.poll(async () => page.locator(ROWS).count(), { timeout: 15_000 }).toBe(3);
    const first = (await page.locator(ROWS, { hasText: "Laptops for the team" }).first().textContent()) ?? "";
    expect(first).toContain("Laptops for the team (1)");
    expect(first).toContain("Open");
    expect(await page.locator(`${ROWS} .sapMObjStatusWarning`, { hasText: "Open" }).count()).toBe(1);
    await page.locator(id("OrdersList", "clearFilters")).click().catch(() => undefined);
    // filter: Order status = Done
    await page.locator(id("OrdersList", "filter_Status")).click();
    await page.locator("li.sapMSelectListItemBase", { hasText: "Done" }).first().click();
    await page.locator(id("OrdersList", "go")).click();
    await expect.poll(async () => page.locator(ROWS).count(), { timeout: 15_000 }).toBe(2);
    expect(await page.locator(ROWS).first().textContent()).toContain("Office chairs");
    // object page: the priority in a select
    await page.locator(ROWS, { hasText: "Office chairs" }).first().click();
    // header facets: the data point and the field group with the e-mail link
    await page.locator(id("OrdersObject", "header_Progress")).waitFor({ timeout: 30_000 });
    await expect.poll(async () => page.locator(id("OrdersObject", "header_Progress")).textContent(), { timeout: 15_000 }).toContain("100 / 100");
    expect(await page.locator(`${id("OrdersObject", "header_Buyer")} a[href="mailto:ben@example.com"]`).count()).toBe(1);
    await page.locator(id("OrdersObject", "edit")).click();
    const select = page.locator(`[id$='--field_Order_Priority']`).first();
    await select.waitFor({ timeout: 30_000 });
    await select.click();
    await page.locator("li.sapMSelectListItemBase", { hasText: "High" }).last().click();
    // value help with fixed values (drop-down) whose additional binding fills the currency
    await page.locator(`${id("OrdersObject", "field_Order_Category")}-arrow`).click();
    await page.locator("li", { hasText: "US purchases" }).last().click();
    await expect.poll(async () => page.evaluate(`sap.ui.core.Element.getElementById("container-rapt---OrdersObject--field_Order_Currency").getValue()`), { timeout: 10_000 }).toBe("USD");
    // value help used for validation: an unknown currency is an error
    await page.locator(`${id("OrdersObject", "field_Order_Currency")}-inner`).fill("ZZZ");
    await page.locator(`${id("OrdersObject", "field_Order_Currency")}-inner`).press("Tab");
    await expect.poll(async () => page.evaluate(`sap.ui.core.Element.getElementById("container-rapt---OrdersObject--field_Order_Currency").getValueState()`), { timeout: 10_000 }).toBe("Error");
    await page.locator(`${id("OrdersObject", "field_Order_Currency")}-inner`).fill("USD");
    await page.locator(`${id("OrdersObject", "field_Order_Currency")}-inner`).press("Tab");
    await expect.poll(async () => page.evaluate(`sap.ui.core.Element.getElementById("container-rapt---OrdersObject--field_Order_Currency").getValueState()`), { timeout: 10_000 }).toBe("None");
    await page.locator(id("OrdersObject", "save")).click();
    await expect.poll(async () => (await get("Orders('00000002')")).body["Priority"], { timeout: 15_000 }).toBe("HIGH");
    expect((await get("Orders('00000002')")).body).toMatchObject({ Category: "US", Currency: "USD" });
  }, 120_000);

  it("filters with the value help dialog: Search and Select, Define Conditions (D68)", async () => {
    const page = await (browser as Browser).newPage({ viewport: { width: 1400, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}/`);
    await page.locator(ROWS).first().waitFor({ timeout: 60_000 });
    const dialog = id("OrdersList", "conditions");
    const tokens = (control: string): Promise<string[]> => page.locator(`${id("OrdersList", control)} .sapMToken`).allTextContents();
    // the default value (=EUR) with the description of the value help
    await expect.poll(async () => tokens("filter_Currency"), { timeout: 15_000 }).toEqual(["Euro (EUR)"]);
    await page.locator(`${id("OrdersList", "filter_Currency")}-vhi`).click();
    await page.locator(`${id("OrdersList", "conditionsTable")} ${ROWS}`).first().waitFor({ timeout: 30_000 });
    // Search and Select: one more currency
    await page.locator(`${id("OrdersList", "conditionsSearch")} input`).fill("US Dollar");
    await page.locator(`${id("OrdersList", "conditionsSearch")} input`).press("Enter");
    await page.locator(`${id("OrdersList", "conditionsTable")} ${ROWS}`, { hasText: "USD" }).first().click();
    // Define Conditions: an exclusion
    await page.locator(`${id("OrdersList", "conditionsTabs")} .sapMITBFilter`, { hasText: "Define Conditions" }).click();
    const row = page.locator(`${dialog} .raptConditionRow`).first();
    await row.locator(".raptConditionOperator").click();
    await page.locator(".sapMSelectList li", { hasText: "not equal to" }).first().click();
    await row.locator(".raptConditionValue input").first().fill("AUD");
    await row.locator(".raptConditionValue input").first().press("Tab");
    await expect.poll(async () => tokens("conditionsTokens"), { timeout: 10_000 }).toEqual(["Euro (EUR)", "US Dollar (USD)", "!(=AUD)"]);
    await page.locator(id("OrdersList", "conditionsOk")).click();
    await page.locator(dialog).waitFor({ state: "detached", timeout: 10_000 });
    expect(await tokens("filter_Currency")).toEqual(["Euro (EUR)", "US Dollar (USD)", "!(=AUD)"]);
    // a typed range and a typed exclusion on the order ID (the conditions dialog without value help)
    const order = page.locator(`${id("OrdersList", "filter_OrderId")}-inner`);
    await order.fill("1...3");
    await order.press("Enter");
    // the MultiInput of OpenUI5 finishes the token of the first condition before the next input
    await expect.poll(async () => tokens("filter_OrderId"), { timeout: 10_000 }).toEqual(["1...3"]);
    await order.fill("!(=3)");
    await order.press("Enter");
    await expect.poll(async () => tokens("filter_OrderId"), { timeout: 10_000 }).toEqual(["1...3", "!(=3)"]);
    await page.locator(`${id("OrdersList", "filter_OrderId")}-vhi`).click();
    await expect.poll(async () => page.locator(`${dialog} .raptConditionRow`).count(), { timeout: 10_000 }).toBe(2);
    expect(await page.locator(`${id("OrdersList", "conditionsTabs")}`).count()).toBe(0);
    await page.locator(id("OrdersList", "conditionsCancel")).click();
    await page.locator(dialog).waitFor({ state: "detached", timeout: 10_000 });
    await page.locator(id("OrdersList", "go")).click();
    const expected = values((await get(`Orders?$select=OrderId&$filter=${encodeURIComponent("(Currency eq 'EUR' or Currency eq 'USD') and Currency ne 'AUD' and (OrderId ge '00000001' and OrderId le '00000003') and OrderId ne '00000003'")}`)).body);
    expect(expected.length).toBeGreaterThan(0);
    await expect.poll(async () => page.locator(ROWS).count(), { timeout: 15_000 }).toBe(expected.length);
    expect(errors).toEqual([]);
  }, 120_000);
});
