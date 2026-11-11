/** Mode of the project (D45): rapt/config.json and --mode. */

import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";

const CUSTOM = fileURLToPath(new URL("../../../fixtures/custom-entity", import.meta.url));

function withConfig(config: string | undefined, run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), "rapt-config-"));
  try {
    cpSync(CUSTOM, dir, { recursive: true });
    const file = path.join(dir, "rapt", "config.json");
    if (config === undefined) {
      rmSync(file);
    } else {
      writeFileSync(file, config);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const codes = (dir: string, mode?: string): Array<[string, string]> =>
  buildModel(loadProject(dir), mode === undefined ? {} : { mode }).diagnostics.sorted().map((d) => [d.code, d.severity]);

describe("mode of the project", () => {
  it("is standard by default: a managed BO on a custom entity is refused, as on SAP", () => {
    withConfig(undefined, (dir) => {
      expect(codes(dir)).toContainEqual(["BDEF027", "error"]);
      expect(buildModel(loadProject(dir)).diagnostics.hasErrors()).toBe(true);
    });
  });

  it("is enhanced with rapt/config.json, or with --mode", () => {
    withConfig('{ "mode": "enhanced" }', (dir) => {
      expect(codes(dir)).toEqual([["BDEF027", "info"]]);
      expect(buildModel(loadProject(dir)).model?.mode).toBe("enhanced");
      expect(codes(dir, "standard")).toContainEqual(["BDEF027", "error"]);
    });
    withConfig(undefined, (dir) => {
      expect(codes(dir, "enhanced")).toEqual([["BDEF027", "info"]]);
    });
  });

  it("reports a wrong configuration", () => {
    withConfig('{ "mode": "turbo", "colour": 1 }', (dir) => {
      expect(codes(dir)).toEqual(expect.arrayContaining([["CFG001", "error"], ["CFG002", "warning"]]));
    });
    withConfig("{", (dir) => {
      expect(codes(dir)).toContainEqual(["CFG001", "error"]);
    });
  });
});

describe("ui settings (D53)", () => {
  it("reads the floorplans and the overview, and reports what the service lacks", () => {
    withConfig('{ "mode": "enhanced", "ui": { "floorplans": { "Product": "worklist" }, "overview": { "title": "Shop", "cards": [{ "type": "kpi", "entitySet": "Product", "title": "Products", "aggregation": "count" }] } } }', (dir) => {
      const { model, diagnostics } = buildModel(loadProject(dir));
      expect(diagnostics.errors()).toEqual([]);
      expect(model?.ui).toEqual({ floorplans: { Product: "worklist" }, overview: { title: "Shop", cards: [{ type: "kpi", entitySet: "Product", title: "Products", aggregation: "count" }] } });
    });
    withConfig('{ "mode": "enhanced", "ui": { "floorplans": { "Nothing": "worklist", "Product": "galaxy" } } }', (dir) => {
      expect(codes(dir)).toContainEqual(["CFG003", "error"]);
    });
    withConfig('{ "mode": "enhanced", "ui": { "floorplans": { "Nothing": "worklist" }, "overview": { "cards": [{ "type": "kpi", "entitySet": "Product" }] } } }', (dir) => {
      expect(codes(dir).filter(([c]) => c === "CFG003")).toHaveLength(1);
    });
  });
});
