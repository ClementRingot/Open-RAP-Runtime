/**
 * The MCP server of the application (D47): the tools of the service over the Model Context
 * Protocol, run by the OData service as the user of the request.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMcpTools, Diagnostics } from "@open-rap/compiler";
import { generatedFixture, T1, T2, writableApp, type TestApp } from "./helpers.js";

let t: TestApp;

beforeAll(async () => {
  const fixture = await generatedFixture();
  const mcp = buildMcpTools(fixture.model, { server: { instructions: "Travel agency" }, tools: { Travel_acceptTravel: "Accepts a travel: its status becomes A.", Booking_delete: false } }, new Diagnostics());
  t = await writableApp(Promise.resolve(fixture), { mcp });
}, 180_000);

afterAll(async () => {
  await t?.close();
});

let id = 0;
async function rpc(method: string, params?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await t.app.inject({ method: "POST", url: "/mcp", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, payload: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, ...(params === undefined ? {} : { params }) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

async function tool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean; structured?: Record<string, unknown> }> {
  const { body } = await rpc("tools/call", { name, arguments: args });
  const result = body["result"] as { content: Array<{ text: string }>; isError: boolean; structuredContent?: Record<string, unknown> };
  return { text: result.content[0]?.text ?? "", isError: result.isError, ...(result.structuredContent === undefined ? {} : { structured: result.structuredContent }) };
}

describe("MCP server", () => {
  it("initializes and lists the tools with their descriptions", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.body["result"]).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "zrt_ui_travel" }, instructions: "Travel agency" });
    const notification = await t.app.inject({ method: "POST", url: "/mcp", headers: { "content-type": "application/json" }, payload: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    expect(notification.statusCode).toBe(202);
    const list = (await rpc("tools/list")).body["result"] as { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> }> };
    const names = list.tools.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["Travel_list", "Travel_get", "Travel_create", "Travel_update", "Travel_delete", "Travel_create_Booking", "Travel_acceptTravel", "Travel_deductDiscount", "Travel_copyTravel", "Booking_list"]));
    expect(names).not.toContain("Booking_delete");
    expect(list.tools.find((x) => x.name === "Travel_acceptTravel")?.description).toBe("Accepts a travel: its status becomes A.");
    expect(list.tools.find((x) => x.name === "Travel_get")?.inputSchema).toMatchObject({ required: ["TravelUUID"], properties: { TravelUUID: { type: "string", format: "uuid" } } });
    expect(list.tools.find((x) => x.name === "Travel_delete")?.annotations).toMatchObject({ destructiveHint: true });
  });

  it("reads through the service", async () => {
    const page = await tool("Travel_list", { filter: "AgencyID eq '070001'", select: ["TravelID", "Description"] });
    expect(page.isError).toBe(false);
    expect(page.structured).toMatchObject({ "@odata.count": 1, value: [{ TravelID: "00000001", Description: "Paris and Rome" }] });
    expect(page.text).not.toContain("@odata.context");
    const one = await tool("Travel_get", { TravelUUID: T2 });
    expect(one.structured).toMatchObject({ TravelID: "00000002" });
    expect((await tool("Travel_get", {})).isError).toBe(true);
  });

  it("writes through the business object, with its messages", async () => {
    const refused = await tool("Travel_create", { TravelID: "00000060", AgencyID: "070001", CustomerID: "000001", Description: "MCP" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("Begin date and end date are required");
    const created = await tool("Travel_create", { TravelID: "00000061", AgencyID: "070001", CustomerID: "000001", Description: "MCP", BeginDate: "2027-02-01", EndDate: "2027-02-03", BookingFee: 5, CurrencyCode: "EUR" });
    expect(created.isError, created.text).toBe(false);
    const uuid = String(created.structured?.["TravelUUID"]);
    expect((await tool("Travel_update", { TravelUUID: uuid, Description: "Changed by an agent" })).isError).toBe(false);
    const child = await tool("Travel_create_Booking", { TravelUUID: uuid, BookingID: "0001", CarrierID: "AF", ConnectionID: "0012", FlightDate: "2027-02-01", FlightPrice: 100, CurrencyCode: "EUR" });
    expect(child.isError, child.text).toBe(false);
    const accepted = await tool("Travel_acceptTravel", { TravelUUID: uuid });
    expect(accepted.isError, accepted.text).toBe(false);
    expect((await tool("Travel_get", { TravelUUID: uuid })).structured).toMatchObject({ OverallStatus: "A", Description: "Changed by an agent", TotalPrice: 105 });
    expect((await tool("Travel_delete", { TravelUUID: uuid })).isError).toBe(false);
    expect((await tool("Travel_get", { TravelUUID: uuid })).isError).toBe(true);
    expect((await tool("Travel_get", { TravelUUID: T1 })).isError).toBe(false);
  });

  it("answers protocol errors", async () => {
    expect((await rpc("tools/call", { name: "Nothing", arguments: {} })).body["error"]).toMatchObject({ code: -32602 });
    expect((await rpc("resources/list")).body["error"]).toMatchObject({ code: -32601 });
    expect((await t.app.inject({ method: "GET", url: "/mcp" })).statusCode).toBe(405);
    expect((await t.app.inject({ method: "POST", url: "/mcp", headers: { "content-type": "application/json" }, payload: "{" })).statusCode).toBe(400);
  });
});
