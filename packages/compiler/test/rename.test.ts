/**
 * A renamed copy of a project for a shared SAP system (D83): `rapt abapgit <src> --suffix XYZ
 * --out <dir>`, for the SAP BTP trial where the objects of every user live together.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renameProject } from "../src/authoring/rename.js";
import { main } from "../src/cli.js";
import { loadProject } from "../src/input/project.js";
import { FIXTURE_DIR } from "./helpers.js";

describe("renamed copy for a shared SAP system (D83)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appends the suffix to every object and every reference, within the length of each type", () => {
    const result = renameProject(loadProject(FIXTURE_DIR), "cr1");
    expect(result.errors).toEqual([]);
    expect(result.renamed).toContainEqual({ types: ["MSAG", "TABL"], from: "ZRT_TRAVEL", to: "ZRT_TRAVELCR1" });
    // an authorization object has 10 characters at most: the start of its name is kept
    expect(result.renamed).toContainEqual({ types: ["SUSO"], from: "ZAO_TRAVL", to: "ZAO_TRACR1" });
    const file = (name: string): string => result.files.find((f) => f.path === `src/${name}`)?.content ?? "";
    // the case of the references is kept
    expect(file("zrt_c_travelcr1.bdef.asbdef")).toContain("define behavior for ZRT_C_Travelcr1 alias Travel");
    expect(file("zbp_rt_r_travelcr1.clas.locals_imp.abap")).toMatch(/zrt_r_travelcr1/i);
    expect(file("zrt_ui_travel_o4cr1.srvb.xml")).toContain("<NAME>ZRT_UI_TRAVEL_O4CR1</NAME>");
    // a name in a path is renamed: the service definition of a binding (D85)
    expect(file("zrt_ui_travel_o4cr1.srvb.xml")).toContain("<URI>/sap/bc/adt/ddic/srvd/sources/zrt_ui_travelcr1</URI>");
    // a name that contains another one is renamed as a whole
    expect(result.files.some((f) => /ZRT_TRAVELCR1_LOG|zrt_travelcr1_/i.test(f.content))).toBe(false);
    expect(result.files.every((f) => !/[^/]\b(zrt_[a-z_]+|zbp_rt_r_travel)\b(?!cr1)/i.test(f.content.replace(/zrt_[a-z_]*cr1/gi, "")))).toBe(true);
  });

  it("leaves a name of a namespace alone", () => {
    const project = loadProject(FIXTURE_DIR);
    const pool = (f: { fileName: string }): boolean => f.fileName === "zbp_rt_r_travel.clas.locals_imp.abap";
    const files = project.files.map((f) => (pool(f) ? { ...f, content: `${f.content}\n" see /DMO/ZRT_TRAVEL and zrt_travel\n` } : f));
    const result = renameProject({ ...project, files }, "cr1");
    expect(result.files.find((f) => f.path === "src/zbp_rt_r_travelcr1.clas.locals_imp.abap")?.content).toContain('" see /DMO/ZRT_TRAVEL and zrt_travelcr1\n');
  });

  it("refuses a suffix that is not letters and digits, or that leaves no room", () => {
    expect(renameProject(loadProject(FIXTURE_DIR), "a-b").errors).toEqual(["the suffix must be 1 to 6 letters or digits: a-b"]);
    expect(renameProject(loadProject(FIXTURE_DIR), "ABCDEFG").errors[0]).toMatch(/1 to 6/);
  });

  it("writes a copy that compiles, the project unchanged (rapt abapgit --suffix --out)", async () => {
    const out = mkdtempSync(path.join(tmpdir(), "rapt-renamed-"));
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(await main(["abapgit", FIXTURE_DIR, "--suffix", "XYZ", "--out", out])).toBe(0);
      expect(readdirSync(path.join(out, "src"))).toContain("zrt_c_travelxyz.ddls.asddls");
      expect(readFileSync(path.join(out, ".abapgit.xml"), "utf8")).toContain("<STARTING_FOLDER>");
      expect(await main(["check", out, "--warnings-as-errors"])).toBe(0);
      expect(readdirSync(path.join(FIXTURE_DIR, "src"))).not.toContain("zrt_c_travelxyz.ddls.asddls");
      expect(await main(["abapgit", FIXTURE_DIR, "--suffix", "XYZ"])).toBe(2);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
