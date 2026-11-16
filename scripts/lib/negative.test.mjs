// Sources SAP BTP must refuse (D91): each case of fixtures/negative/cases.json gives the diagnostic
// it expects in standard mode, and the round trip writes them for the trial.

import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { negativeCases, negativeReadme, writeNegativeCase } from "./negative.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = path.join(ROOT, "packages", "compiler", "dist", "cli.js");
const definitions = negativeCases(ROOT);

/** The errors of `rapt check --json` on a project. */
async function errorsOf(dir) {
  let stdout;
  try {
    ({ stdout } = await promisify(execFile)("node", [CLI, "check", dir, "--json"], { encoding: "utf8" }));
  } catch (error) {
    stdout = error.stdout;
  }
  return JSON.parse(stdout).diagnostics.filter((d) => d.severity === "error");
}

describe("sources SAP BTP must refuse (D91)", () => {
  it("describes each case once, with a prefix of its own", () => {
    const ids = definitions.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(definitions.cases.map((c) => c.prefix)).size).toBe(ids.length);
    expect(definitions.cases.find((c) => c.id === "control")?.expect.code).toBeNull();
    for (const c of definitions.cases) {
      expect(c.prefix).toMatch(/^Z[A-Z0-9]{3}$/);
      expect(c.sap === null || ["refuses", "activates"].includes(c.sap.outcome)).toBe(true);
    }
  });

  it("refuses each case in standard mode with the expected diagnostic", async () => {
    const results = await Promise.all(
      definitions.cases.map(async (c) => {
        const dir = mkdtempSync(path.join(tmpdir(), `negative-${c.id}-`));
        try {
          writeNegativeCase(ROOT, dir, definitions, c);
          return { id: c.id, expected: c.expect.code, codes: [...new Set((await errorsOf(dir)).map((d) => d.code))] };
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
    );
    expect(results.map((r) => ({ id: r.id, codes: r.codes }))).toEqual(results.map((r) => ({ id: r.id, codes: r.expected === null ? [] : [r.expected] })));
  }, 600_000);

  it("writes the cases for the trial, renamed with the suffix (btp-roundtrip --negative)", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "negative-trial-"));
    const out = path.join(parent, "trial");
    try {
      const output = execFileSync("node", ["scripts/btp-roundtrip.mjs", "--negative", "--suffix", "xyz", "--out", out], { cwd: ROOT, encoding: "utf8" });
      expect(output).toContain(`${definitions.cases.length} cases`);
      const files = readdirSync(path.join(out, "src"));
      expect(files).toEqual(expect.arrayContaining(["zrnaxyz_r_item.bdef.asbdef", "zbp_rnexyz_r_item.clas.locals_imp.abap", "package.devc.xml"]));
      expect(readFileSync(path.join(out, "src", "zbp_rnexyz_r_item.clas.locals_imp.abap"), "utf8")).toContain("    sy-subrc = 0.\n");
      expect(readFileSync(path.join(out, "src", "zbp_rnjxyz_r_item.clas.locals_imp.abap"), "utf8")).toContain("DELETE FROM zrnjxyz_item");
      const expected = JSON.parse(readFileSync(path.join(out, "expected.json"), "utf8"));
      expect(expected.cases).toContainEqual(expect.objectContaining({ id: "write-sy-subrc", prefix: "ZRNEXYZ", code: "ABP012" }));
      expect(readFileSync(path.join(out, "README.md"), "utf8")).toContain("| control | `ZRNAXYZ_…` |");
      expect(negativeReadme({ suffix: "A", cases: [{ id: "x", prefix: "ZA", description: "d", code: null }] })).toContain("| x | `ZA_…` | d | accepted |");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
