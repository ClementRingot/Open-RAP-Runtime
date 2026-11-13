/**
 * A Web API instead of a Fiori application (D76): `rapt new --binding-type webapi`, never in the
 * launchpad (rapt launchpad add, LPD011), no floorplan, and the UI binding preferred when a service
 * has both (SRVD002).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { floorplans } from "../src/authoring/floorplan.js";
import { generateObject } from "../src/authoring/generate.js";
import { boNames, newBusinessObject } from "../src/authoring/new.js";
import { main } from "../src/cli.js";
import { Diagnostics } from "../src/diagnostics.js";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";
import { resolveLaunchpad } from "../src/launchpad/config.js";
import type { RegisterResult } from "../src/launchpad/workspace.js";

let ws: string;
let api: string;

beforeAll(() => {
  ws = mkdtempSync(path.join(tmpdir(), "rapt-web-api-test-"));
  api = path.join(ws, "api");
  expect(newBusinessObject(api, "Partner", { prefix: "ZPA", bindingType: "webapi" }).error).toBeUndefined();
});

afterAll(() => rmSync(ws, { recursive: true, force: true }));

describe("rapt new --binding-type webapi (D76)", () => {
  it("names the service and the binding of a Web API as SAP does", () => {
    expect(boNames("Travel", { prefix: "ZRT", bindingType: "webapi" })).toMatchObject({ service: "ZRT_API_TRAVEL", binding: "ZRT_API_TRAVEL_O4", webApi: true });
    expect(boNames("Travel", { prefix: "ZRT", bindingType: "UI" })).toMatchObject({ service: "ZRT_UI_TRAVEL", webApi: false });
    expect(boNames("Travel", { bindingType: "v2" })).toEqual({ error: expect.stringContaining("ui (a Fiori application) or webapi") });
  });

  it("writes a Web API binding, without metadata extension, that builds without UI", () => {
    const binding = readFileSync(path.join(api, "src", "zpa_api_partner_o4.srvb.xml"), "utf8");
    expect(binding).toContain("<BINDING_TYPE_CATEGORY>1</BINDING_TYPE_CATEGORY>");
    expect(binding).toContain("(OData V4, Web API)");
    expect(existsSync(path.join(api, "src", "zpa_c_partner.ddlx.asddlxs"))).toBe(false);
    expect(readFileSync(path.join(api, "src", "zpa_c_partner.ddls.asddls"), "utf8")).not.toContain("@Metadata.allowExtensions");
    expect(readFileSync(path.join(api, "AGENTS.md"), "utf8")).toContain("OData V4 - Web API");
    const { model, diagnostics } = buildModel(loadProject(api));
    expect(diagnostics.items.filter((d) => d.severity === "error")).toEqual([]);
    expect(model?.service).toMatchObject({ binding: "ZPA_API_PARTNER_O4", webApi: true });
  }, 120_000);

  it("has no floorplan", () => {
    expect(floorplans(api)).toMatchObject({ ok: true, sets: [], webApi: true });
    expect(floorplans(api, "Partner", "worklist")).toEqual({ ok: false, root: api, error: expect.stringContaining("no floorplan") });
  }, 120_000);
});

describe("a Web API and the launchpad of the workspace (D76)", () => {
  let out: string[];
  const last = <T>(): T => JSON.parse(out.join("").trim().split("\n").pop() ?? "") as T;
  beforeEach(() => {
    out = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("is not added by rapt new, rapt launchpad add or rapt floorplan", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rapt-web-api-ws-"));
    try {
      expect(await main(["new", path.join(dir, "partners"), "Partner", "--prefix", "ZPA", "--binding-type", "webapi", "--json"])).toBe(0);
      expect(last<{ ok: boolean; launchpad?: unknown }>()).toMatchObject({ ok: true });
      expect(last<{ launchpad?: unknown }>().launchpad).toBeUndefined();
      expect(existsSync(path.join(dir, "launchpad.json"))).toBe(false);

      expect(await main(["launchpad", "add", path.join(dir, "partners"), "--json"])).toBe(0);
      expect(last<RegisterResult>()).toMatchObject({ ok: true, added: false, created: false, webApi: true });
      expect(existsSync(path.join(dir, "launchpad.json"))).toBe(false);

      expect(await main(["launchpad", "add", path.join(dir, "partners")])).toBe(0);
      expect(out.join("")).toContain("not added, the project is an OData V4 - Web API");

      expect(await main(["floorplan", path.join(dir, "partners"), "--json"])).toBe(0);
      expect(last<{ sets: unknown[]; webApi: boolean }>()).toMatchObject({ sets: [], webApi: true });
      expect(await main(["floorplan", path.join(dir, "partners"), "Partner", "worklist", "--json"])).toBe(1);
      expect(existsSync(path.join(dir, "launchpad.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("leaves out a tile of a Web API (LPD011), and keeps the application", () => {
    const file = path.join(ws, "launchpad.json");
    writeFileSync(
      file,
      JSON.stringify({ title: "Launchpad", apps: [{ id: "api", source: "api", url: "http://localhost:8081/" }], groups: [{ title: "Applications", tiles: [{ title: "Partners", app: "api", count: "Partner" }, { title: "Help", url: "https://example.com/" }] }] }),
    );
    const { model } = buildModel(loadProject(api));
    const diagnostics = new Diagnostics();
    const resolution = resolveLaunchpad(file, diagnostics, { built: new Map([["api", { dir: path.join(ws, "out", "api"), model: model! }]]) });
    expect(diagnostics.items.map((d) => `${d.severity} ${d.code}: ${d.message}`)).toEqual([expect.stringMatching(/^warning LPD011: tile Partners: the application api is an OData V4 - Web API \(ZPA_API_PARTNER_O4\)/)]);
    expect(resolution?.model.groups[0]?.tiles.map((t) => t.title)).toEqual(["Help"]);
    expect(resolution?.model.apps.map((a) => a.id)).toEqual(["api"]);
  }, 120_000);
});

describe("a service with a UI and a Web API binding (D76)", () => {
  it("serves the UI binding, or the one given with --binding", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rapt-two-bindings-"));
    try {
      expect(newBusinessObject(dir, "Order", { prefix: "ZOR" }).error).toBeUndefined();
      // the Web API binding sorts before the UI one: the choice does not depend on the order
      expect(generateObject(dir, "binding", "ZOR_API_ORDER_O4", { for: "ZOR_UI_ORDER", bindingType: "webapi" }).error).toBeUndefined();
      const ui = buildModel(loadProject(dir));
      expect(ui.model?.service.binding).toBe("ZOR_UI_ORDER_O4");
      expect(ui.model?.service.webApi).toBeUndefined();
      expect(ui.diagnostics.items.filter((d) => d.code === "SRVD002").map((d) => `${d.severity}: ${d.message}`)).toEqual([
        "info: several service bindings for ZOR_UI_ORDER: the UI binding ZOR_UI_ORDER_O4 is served (the Web API ZOR_API_ORDER_O4: rapt dev --binding ZOR_API_ORDER_O4)",
      ]);
      const webApi = buildModel(loadProject(dir), { binding: "zor_api_order_o4" });
      expect(webApi.model?.service).toMatchObject({ binding: "ZOR_API_ORDER_O4", webApi: true });
      expect(webApi.diagnostics.items.filter((d) => d.code === "SRVD002")).toEqual([]);

      // two UI bindings: no way to choose, a warning
      expect(generateObject(dir, "binding", "ZOR_UI_ORDER2_O4", { for: "ZOR_UI_ORDER" }).error).toBeUndefined();
      expect(buildModel(loadProject(dir)).diagnostics.items.filter((d) => d.code === "SRVD002").map((d) => d.severity)).toEqual(["warning"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
