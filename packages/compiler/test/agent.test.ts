/** rapt agent (D64): the MCP server of rapt for AI coding agents, over stdio. */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { AgentServer } from "../src/agent/server.js";
import { FIXTURE_DIR } from "./helpers.js";

type Reply = { result?: { tools?: Array<{ name: string }>; structuredContent?: Record<string, unknown>; isError?: boolean; content?: Array<{ text: string }>; instructions?: string }; error?: { message: string } };

const call = async (server: AgentServer, name: string, args: Record<string, unknown> = {}): Promise<Reply["result"]> =>
  ((await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as Reply).result;

describe("rapt agent", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "rapt-agent-"));
  afterAll(() => rmSync(workspace, { recursive: true, force: true }));

  it("speaks MCP: initialize with instructions, the list of the tools", async () => {
    const server = new AgentServer(workspace);
    const init = (await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })) as Reply & { result: { protocolVersion: string } };
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.instructions).toContain("rapt_check");
    expect(await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    const list = (await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })) as Reply;
    expect(list.result?.tools?.map((t) => t.name)).toEqual([
      "rapt_projects",
      "rapt_check",
      "rapt_object_types",
      "rapt_generate",
      "rapt_new_business_object",
      "rapt_floorplan",
      "rapt_abapgit",
      "rapt_docs_search",
      "rapt_docs_read",
    ]);
  });

  it("creates a business object, checks it, adds an object, sets the floorplan", async () => {
    const server = new AgentServer(workspace);
    expect((await call(server, "rapt_check"))?.isError).toBe(true); // no project yet
    const created = await call(server, "rapt_new_business_object", { project: "shop", entity: "Order", prefix: "ZSH" });
    expect(created?.isError).toBe(false);
    expect(existsSync(path.join(workspace, "shop", ".abapgit.xml"))).toBe(true);
    expect(created?.structuredContent).toMatchObject({ launchpad: { file: "launchpad.json", added: true } });
    expect((await call(server, "rapt_projects"))?.structuredContent).toMatchObject({ projects: ["shop"] });

    const check = await call(server, "rapt_check");
    expect(check?.structuredContent).toMatchObject({ project: "shop", ok: true, counts: { error: 0 } });

    const generated = await call(server, "rapt_generate", { kind: "dataelement", name: "ZSH_ORDER_NO", type: "abap.numc(8)" });
    expect(generated?.structuredContent).toMatchObject({ written: ["src/zsh_order_no.dtel.xml"] });
    expect((await call(server, "rapt_generate", { kind: "nope", name: "X" }))?.isError).toBe(true);

    const plans = await call(server, "rapt_floorplan");
    expect(plans?.structuredContent).toMatchObject({ sets: [{ set: "Order", floorplan: "listReport", chosen: false }] });
    expect((await call(server, "rapt_floorplan", { entitySet: "Order", floorplan: "worklist" }))?.structuredContent).toMatchObject({ file: "rapt/config.json", floorplan: "worklist", launchpad: { added: false } });
    expect((await call(server, "rapt_abapgit", { check: true }))?.structuredContent).toMatchObject({ written: [] });
  }, 120_000);

  it("creates a Web API, which has no floorplan and stays out of the launchpad (D76)", async () => {
    const own = mkdtempSync(path.join(tmpdir(), "rapt-agent-webapi-"));
    try {
      await webApi(own);
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  }, 120_000);

  async function webApi(workspace: string): Promise<void> {
    const server = new AgentServer(workspace);
    // a UI business object first: the launchpad of the workspace
    expect((await call(server, "rapt_new_business_object", { project: "shop", entity: "Order", prefix: "ZSH" }))?.isError).toBe(false);
    const created = await call(server, "rapt_new_business_object", { project: "partners", entity: "Partner", prefix: "ZPA", bindingType: "webapi" });
    expect(created?.isError).toBe(false);
    expect(created?.structuredContent).toMatchObject({ project: "partners", written: expect.arrayContaining(["src/zpa_api_partner_o4.srvb.xml"]) });
    expect((created?.structuredContent as { launchpad?: unknown }).launchpad).toBeUndefined();
    // the launchpad of the workspace lists the UI application only
    expect(readFileSync(path.join(workspace, "launchpad.json"), "utf8")).toContain('"shop"');
    expect(readFileSync(path.join(workspace, "launchpad.json"), "utf8")).not.toContain("partners");
    expect((await call(server, "rapt_floorplan", { project: "partners" }))?.structuredContent).toMatchObject({ sets: [], webApi: true });
  }

  it("refuses paths outside the workspace and reports the errors of a project", async () => {
    const server = new AgentServer(workspace);
    expect((await call(server, "rapt_check", { project: "../elsewhere" }))?.content?.[0]?.text).toContain("outside the workspace");
    const fixtures = new AgentServer(path.dirname(FIXTURE_DIR));
    expect((await call(fixtures, "rapt_check"))?.content?.[0]?.text).toContain("several RAP projects");
    expect((await call(fixtures, "rapt_check", { project: "travel" }))?.structuredContent).toMatchObject({ ok: true });
  }, 120_000);

  it("searches and reads the documentation of Open RAP Runtime", async () => {
    const server = new AgentServer(workspace);
    const search = (await call(server, "rapt_docs_search", { query: "collaborative draft" }))?.structuredContent as { results: Array<{ page: string; section: string }> };
    expect(search.results.length).toBeGreaterThan(0);
    expect(search.results.map((r) => r.page)).toContain("decisions");
    const pages = (await call(server, "rapt_docs_read"))?.structuredContent as { pages: Array<{ page: string }> };
    expect(pages.pages.map((p) => p.page)).toEqual(expect.arrayContaining(["guide", "diagnostics", "known_gaps"]));
    const section = (await call(server, "rapt_docs_read", { page: "guide", section: "4. standard and enhanced modes" }))?.structuredContent as { markdown: string };
    expect(section.markdown).toContain("rapt/config.json");
    expect(section.markdown).not.toContain("## 5.");
    expect((await call(server, "rapt_docs_read", { page: "nope" }))?.isError).toBe(true);
  });

  it("serves over stdio (rapt agent of the built CLI)", async () => {
    const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
    const child = spawn(process.execPath, [cli, "agent", workspace], { stdio: ["pipe", "pipe", "pipe"] });
    const lines: string[] = [];
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      lines.push(...parts.filter((l) => l !== ""));
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "rapt_projects", arguments: {} } })}\n`);
    child.stdin.end();
    await new Promise((resolve) => child.on("close", resolve));
    const replies = lines.map((l) => JSON.parse(l) as { id: number; result: { serverInfo?: { name: string }; structuredContent?: unknown } });
    expect(replies.map((r) => r.id)).toEqual([1, 2]);
    expect(replies[0]?.result.serverInfo?.name).toBe("rapt");
    expect(replies[1]?.result.structuredContent).toMatchObject({ projects: ["shop"] });
  }, 60_000);
});
