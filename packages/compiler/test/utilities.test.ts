import { describe, expect, it } from "vitest";
import { generateApplication } from "../src/build.js";
import { frameworkClosure, frameworkObjectName, UTILS_FRAMEWORK_SOURCES } from "../src/gen/abap/framework-utils.js";
import { loadProject } from "../src/input/project.js";
import { fixtureVariant } from "./helpers.js";

const names = (code: string): string[] => frameworkClosure([{ content: code }]).map((s) => frameworkObjectName(s.fileName));

describe("utilities of ABAP Cloud (D40)", () => {
  it("gives the transpiler only the utilities a project uses, with what they use", () => {
    expect(names("DATA x TYPE i.")).toEqual([]);
    const json = names("DATA(j) = /UI2/CL_JSON=>serialize( data = x ).");
    expect(json).toContain("/ui2/cl_json");
    expect(json).toContain("abap");
    expect(json).not.toContain("xco_cp_json");
    const xco = names("xco_cp_json=>data->from_string( j )->write_to( REF #( x ) ).");
    expect(xco).toEqual(expect.arrayContaining(["xco_cp_json", "if_xco_cp_json_data_factory", "zrap_cl_xco_json_data", "zrap_cl_xco_json_trafos"]));
    const regex = names("DATA m TYPE match_result_tab.");
    expect(regex).toEqual(["submatch_result", "submatch_result_tab", "match_result", "match_result_tab"]);
    // every object of the utilities has a distinct name
    expect(new Set(UTILS_FRAMEWORK_SOURCES.map((s) => frameworkObjectName(s.fileName))).size).toBe(UTILS_FRAMEWORK_SOURCES.length);
  });

  it("checks the ABAP of every utility (all used at once)", async () => {
    const all = UTILS_FRAMEWORK_SOURCES.filter((s) => s.fileName.endsWith(".abap") && !s.fileName.startsWith("abap.type"))
      .map((s) => frameworkObjectName(s.fileName))
      .filter((n) => !n.startsWith("cx_") && !n.startsWith("if_") && !n.startsWith("zrap_"));
    const variant = fixtureVariant({
      "zbp_rt_r_travel.clas.locals_imp.abap": (c) => `CLASS lcl_uses DEFINITION.\n  PUBLIC SECTION.\n    METHODS m.\nENDCLASS.\nCLASS lcl_uses IMPLEMENTATION.\n  METHOD m.\n    " ${all.join(" ")}\n  ENDMETHOD.\nENDCLASS.\n${c}`,
    });
    try {
      const result = await generateApplication(loadProject(variant.dir), { scaffold: false });
      expect(result.diagnostics.errors()).toEqual([]);
      const sources = result.files.filter((f) => f.path.startsWith("abap/src/")).map((f) => f.path);
      expect(sources).toContain("abap/src/#ui2#cl_json.clas.abap");
      expect(sources).toContain("abap/src/cl_bali_log_db.clas.abap");
      expect(sources).toContain("abap/src/cl_abap_structdescr.clas.abap");
    } finally {
      variant.cleanup();
    }
  });

  it("reads rapt/number-ranges.json and creates the tables of the services the code uses", async () => {
    const variant = fixtureVariant({
      "../rapt/number-ranges.json": JSON.stringify({ ZRT_TRAVEL: { "01": { from: "1000", to: "1999" } } }),
      "zbp_rt_r_travel.clas.locals_imp.abap": (c) => c.replace("METHOD validateDates.", "METHOD validateDates.\n    DATA(log) = cl_bali_log=>create( )."),
    });
    try {
      const result = await generateApplication(loadProject(variant.dir), { scaffold: false, transpile: false });
      expect(result.diagnostics.errors()).toEqual([]);
      const schema = result.files.find((f) => f.path === "db/schema.sql")?.content ?? "";
      expect(schema).toContain('CREATE TABLE IF NOT EXISTS "rapt_number_range"');
      expect(schema).toContain("VALUES ('ZRT_TRAVEL', '', '01', '', 1000, 1999)");
      expect(schema).toContain('CREATE TABLE IF NOT EXISTS "rapt_application_log"');
      expect(result.model?.numberRanges).toEqual([{ object: "ZRT_TRAVEL", interval: "01", from: "1000", to: "1999" }]);
    } finally {
      variant.cleanup();
    }
  });

  it("reports an invalid rapt/number-ranges.json", async () => {
    const variant = fixtureVariant({ "../rapt/number-ranges.json": JSON.stringify({ ZBAD: { "001": { from: 5, to: 1 } } }) });
    try {
      const result = await generateApplication(loadProject(variant.dir), { scaffold: false, transpile: false });
      expect(result.diagnostics.errors().map((d) => `${d.file}: ${d.code} ${d.message}`)).toEqual([
        'rapt/number-ranges.json: NR001 ZBAD.001: an interval has a name of 2 characters and "from" ≤ "to", decimal numbers of up to 20 digits',
      ]);
    } finally {
      variant.cleanup();
    }
  });

  it("creates the tables of bgPF and mails and lists the mail settings when the code uses them (D41)", async () => {
    const variant = fixtureVariant({
      "zbp_rt_r_travel.clas.locals_imp.abap": (c) =>
        c.replace("METHOD validateDates.", "METHOD validateDates.\n    DATA(factory) = cl_bgmc_process_factory=>get_default( ).\n    DATA(mail) = cl_bcs_mail_message=>create_instance( )."),
    });
    try {
      const result = await generateApplication(loadProject(variant.dir));
      expect(result.diagnostics.errors()).toEqual([]);
      expect(result.model?.services).toEqual({ background: true, mail: true });
      const schema = result.files.find((f) => f.path === "db/schema.sql")?.content ?? "";
      expect(schema).toContain('CREATE TABLE IF NOT EXISTS "rapt_background_process"');
      expect(schema).toContain('CREATE TABLE IF NOT EXISTS "rapt_mail"');
      expect(schema).not.toContain("rapt_number_range");
      expect(result.files.find((f) => f.path === ".env.example")?.content).toContain("MAIL_SMTP_URL=");
    } finally {
      variant.cleanup();
    }
  });
});
