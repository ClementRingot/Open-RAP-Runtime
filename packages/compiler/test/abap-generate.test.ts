import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Diagnostics, formatDiagnostic } from "../src/diagnostics.js";
import { abapSources, generateAbap } from "../src/gen/abap/generate.js";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";
import { FIXTURE_DIR } from "./helpers.js";

describe("ABAP generation of the fixture", () => {
  it("rewrites and transpiles the behavior pool", async () => {
    const project = loadProject(FIXTURE_DIR);
    const { model, diagnostics } = buildModel(project);
    expect(model).toBeDefined();
    const d = new Diagnostics();
    const out = await generateAbap(project, model!, d);
    const dump = process.env["RAPT_DUMP"];
    if (dump !== undefined) {
      for (const s of out?.sources ?? abapSources(project, model!, new Diagnostics())) {
        mkdirSync(path.join(dump, "src"), { recursive: true });
        writeFileSync(path.join(dump, "src", s.fileName), s.content);
      }
      for (const m of out?.modules ?? []) {
        mkdirSync(path.dirname(path.join(dump, "js", m.path)), { recursive: true });
        writeFileSync(path.join(dump, "js", m.path), m.content);
      }
    }
    expect(d.items.map(formatDiagnostic)).toEqual([]);
    expect(diagnostics.errors()).toEqual([]);
  }, 60000);
});
