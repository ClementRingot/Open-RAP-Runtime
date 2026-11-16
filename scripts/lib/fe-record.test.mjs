// Guided recording on the SAP BTP trial (D83), against a local page that plays the role of the
// preview: a headless browser, no keyboard (--auto), a fake OData service.

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { SCENARIOS, scenariosOf } from "./fe-scenarios.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRV = "/sap/opu/odata4/sap/zrt_ui_travel_o4xyz/srvd/sap/zrt_ui_travelxyz/0001/";

function playwrightAvailable() {
  const require = createRequire(import.meta.url);
  for (const id of [process.env.PLAYWRIGHT_MODULE, "playwright", "/opt/node-tools/node_modules/playwright"]) {
    if (id === undefined) continue;
    try {
      require(id);
      return true;
    } catch {
      // next
    }
  }
  return false;
}

describe("the scenarios of the trial recording (D83)", () => {
  it("are named and described", () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) expect(s.steps.length).toBeGreaterThan(0);
    expect(scenariosOf("create,edit").map((s) => s.id)).toEqual(["create", "edit"]);
    expect(() => scenariosOf("nope")).toThrow(/unknown scenario nope/);
    // the variants a scenario needs exist (round 2: strict handling)
    const variants = JSON.parse(readFileSync(new URL("../../fixtures/variants.json", import.meta.url), "utf8"));
    for (const s of SCENARIOS) for (const v of s.variants ?? []) expect(variants[v]).toBeDefined();
    expect(scenariosOf("strict-handling")[0]?.observe).toContain("error");
  });
});

describe.skipIf(!playwrightAvailable())("guided recording on the SAP BTP trial (D83)", () => {
  it("records each scenario, keeps the service only, writes the cases and deletes the HAR", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/preview.html") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`<!doctype html><title>preview</title><script src="/resources/sap-ui-core.js"></script><script>fetch("${SRV}Travel?$top=1&$select=TravelID", { headers: { accept: "application/json" } })</script>`);
      } else if (request.url?.startsWith(SRV)) {
        response.writeHead(200, { "content-type": "application/json", "set-cookie": "SAP_SESSIONID=secret" });
        response.end(JSON.stringify({ value: [{ TravelID: "00000001", TravelUUID: "11111111-2222-4333-8444-555555555555" }] }));
      } else {
        response.writeHead(200, { "content-type": "application/javascript" });
        response.end("/* a resource of the UI */");
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const dir = mkdtempSync(path.join(tmpdir(), "fe-record-"));
    try {
      const out = path.join(dir, "cases");
      const { stdout } = await promisify(execFile)(
        "node",
        ["scripts/fe-record-trial.mjs", "--url", `http://127.0.0.1:${port}/preview.html`, "--release", "2611", "--scenarios", "list-report", "--out", out, "--state", path.join(dir, "state.json"), "--headless", "--auto", "1500"],
        { cwd: ROOT, encoding: "utf8" },
      );
      expect(stdout).toContain("[1/1] List Report");
      expect(existsSync(path.join(dir, "state.json"))).toBe(true);
      expect(readdirSync(out)).toEqual(["trial-list-report-har.json"]);
      const file = JSON.parse(readFileSync(path.join(out, "trial-list-report-har.json"), "utf8"));
      expect(file).toMatchObject({ scenario: "trial-list-report", source: "har", release: "2611", fixture: "travel-draft" });
      const steps = file.cases[0].steps;
      expect(steps.map((s) => s.request?.url)).toEqual(["Travel?$top=1&$select=TravelID"]);
      expect(steps[0].capture).toEqual({ k1: "value/0/TravelUUID" });
      const text = JSON.stringify(file);
      for (const secret of ["SAP_SESSIONID", "sap-ui-core", "preview.html", "127.0.0.1"]) expect(text, secret).not.toContain(secret);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
