/**
 * Custom entities (D43): OData reads through the query class (filter as ranges and SQL string,
 * sort, paging, count, navigation, $expand) and a managed BO with unmanaged save whose instances
 * the RAP runtime reads through the query class and save_modified writes ("an API").
 */

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGliteDialect } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateApplication, loadProject, writeFiles } from "@rap-transpiler/compiler";
import { createApp } from "../src/app.js";
import { applySchema, createDatabase, PGLITE_PARSERS, type Database } from "../src/db/database.js";
import { applySeed } from "../src/db/seed.js";
import { RapRuntime } from "../src/rap/runtime.js";
import type { FastifyInstance } from "fastify";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/custom-entity", import.meta.url));
const SERVICE = "/sap/opu/odata4/sap/zui_product_o4/srvd/sap/zui_product/0001/";
const HEADERS = { "content-type": "application/json", accept: "application/json", "if-match": "*" };

let app: FastifyInstance;
let db: Database;
let warnings: string[];

beforeAll(async () => {
  const result = await generateApplication(loadProject(FIXTURE), { scaffold: false });
  if (result.model === undefined || result.diagnostics.hasErrors()) {
    throw new Error(JSON.stringify(result.diagnostics.items));
  }
  warnings = result.diagnostics.items.filter((d) => d.severity === "warning").map((d) => d.code);
  const out = fileURLToPath(new URL(`./.generated/custom-${process.pid}-${Math.random().toString(36).slice(2, 8)}`, import.meta.url));
  mkdirSync(out, { recursive: true });
  writeFiles(out, result.files);
  const file = (name: string): string => result.files.find((f) => f.path === name)?.content ?? "";
  const pglite = await PGlite.create({ parsers: PGLITE_PARSERS });
  db = createDatabase(new PGliteDialect({ pglite }));
  await applySchema(db, file("db/schema.sql"));
  await applySeed(db, result.model, out);
  const rap = await RapRuntime.load(result.model, path.join(out, "abap"));
  app = await createApp({ model: result.model, metadata: file("odata/metadata.xml"), db, rap });
  await app.ready();
}, 180_000);

afterAll(async () => {
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

const ids = (body: Record<string, unknown>): unknown[] => (body["value"] as Array<Record<string, unknown>>).map((r) => r["ProductID"]);

describe("custom entities", () => {
  it("are flagged when a managed BO is defined on them (rap-transpiler only)", () => {
    expect(warnings).toEqual(["BDEF027"]);
  });

  it("are read through their query class: ranges, sort, paging and count", async () => {
    const page = await get("Product?$count=true&$top=2&$skip=1&$orderby=Name desc");
    expect(page.status, JSON.stringify(page.body)).toBe(200);
    expect(page.body["@odata.count"]).toBe(4);
    expect(ids(page.body)).toEqual(["P2", "P4"]);
    const filtered = await get("Product?$filter=Currency eq 'EUR' and (ProductID eq 'P1' or ProductID eq 'P4')");
    expect(ids(filtered.body)).toEqual(["P1", "P4"]);
    expect((await get("Product/$count")).status).toBe(200);
  });

  it("read single instances, navigations and expands with a filter on the keys", async () => {
    expect((await get("Product('P2')")).body).toMatchObject({ ProductID: "P2", Name: "Phone", Price: 599, Currency: "EUR" });
    expect((await get("Product('P7')")).status).toBe(404);
    const reviews = await get("Product('P1')/_Reviews?$count=true");
    expect(reviews.body["@odata.count"]).toBe(2);
    const expanded = await get("Product?$filter=ProductID eq 'P1' or ProductID eq 'P2'&$expand=_Reviews($count=true;$top=1)&$select=ProductID");
    const value = expanded.body["value"] as Array<Record<string, unknown>>;
    expect(value.map((p) => [p["ProductID"], (p["_Reviews"] as unknown[]).length, p["_Reviews@odata.count"]])).toEqual([
      ["P1", 1, 2],
      ["P2", 1, 1],
    ]);
  });

  it("report the filters that are not ranges to the query class, which may refuse them", async () => {
    const refused = await get("Review?$filter=Rating gt 3 or ReviewID eq '0002'");
    expect(refused.status).toBe(500);
    expect(JSON.stringify(refused.body)).toContain("( RATING > 3 OR REVIEWID = '0002' )");
  });

  it("are written by save_modified, read back by the query class", async () => {
    const created = await call("POST", "Product", { ProductID: "P9", Name: "Keyboard", Price: 49, Currency: "EUR" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await call("POST", "Product", { ProductID: "P1", Name: "Duplicate", Price: 1, Currency: "EUR" })).status).toBe(409);
    expect((await call("PATCH", "Product('P2')", { Price: 549 })).status).toBe(200);
    expect((await call("POST", "Product", { ProductID: "P8", Name: "Negative", Price: -1, Currency: "EUR" })).status).toBe(400);
    expect((await call("DELETE", "Product('P3')")).status).toBe(204);
    const all = await get("Product?$select=ProductID,Price&$orderby=Price");
    expect((all.body["value"] as Array<Record<string, unknown>>).map((p) => [p["ProductID"], p["Price"]])).toEqual([
      ["P9", 49],
      ["P4", 249],
      ["P2", 549],
      ["P1", 999],
    ]);
  });
});
