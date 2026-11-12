/** Writing only ABAP (D42): tables as source, `rapt abapgit`, `rapt new`, seed data. */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateAbapGitFiles, ddlSourceType } from "../src/authoring/abapgit.js";
import { boNames, newBusinessObject } from "../src/authoring/new.js";
import { generateApplication } from "../src/build.js";
import { parseTableSource, tableSourceToXml } from "../src/ddic/table-source.js";
import { readTablXml } from "../src/ddic/xml.js";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";
import { FIXTURE_DIR, fixtureVariant, readFixture } from "./helpers.js";

const BOOKING_SOURCE = `@EndUserText.label : 'Booking (Open RAP Runtime reference BO)'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table zrt_booking {
  key client            : mandt not null;
  key booking_uuid      : sysuuid_x16 not null;
  parent_uuid           : sysuuid_x16;
  booking_id            : abap.numc(4);
  booking_date          : abap.dats;
  carrier_id            : abap.char(3);
  connection_id         : abap.numc(4);
  flight_date           : abap.dats; // a comment
  /* the price, in the currency of the booking */
  @Semantics.amount.currencyCode : 'zrt_booking.currency_code'
  flight_price          : abap.curr(16,2);
  currency_code         : abap.cuky;
  booking_status        : abap.char(1);
  local_last_changed_at : abp_locinst_lastchange_tstmpl;
}
`;

describe("tables written as source (.tabl.astabl)", () => {
  it("give the same dictionary table as their abapGit XML", () => {
    const parsed = parseTableSource(BOOKING_SOURCE);
    expect(parsed.issues).toEqual([]);
    const fromSource = readTablXml(tableSourceToXml(parsed.table!));
    const fromXml = readTablXml(readFixture("zrt_booking.tabl.xml"));
    expect(fromSource).toEqual(fromXml);
  });

  it("replace the XML in the project: same model, diagnostics at the lines of the source", () => {
    const original = buildModel(loadProject(FIXTURE_DIR));
    const variant = fixtureVariant({ "zrt_booking.tabl.xml": null, "zrt_booking.tabl.astabl": BOOKING_SOURCE });
    try {
      const { model, diagnostics } = buildModel(loadProject(variant.dir));
      expect(diagnostics.items.filter((d) => d.severity !== "info")).toEqual([]);
      const strip = (t: unknown): unknown => JSON.parse(JSON.stringify(t, (k, v) => (k === "src" ? undefined : v)));
      expect(strip(model?.tables)).toEqual(strip(original.model?.tables));
      // an unknown data element: reported on the line of the field in the source
      writeFileSync(path.join(variant.dir, "src", "zrt_booking.tabl.astabl"), BOOKING_SOURCE.replace("parent_uuid           : sysuuid_x16;", "parent_uuid : zunknown_type;"));
      const broken = buildModel(loadProject(variant.dir));
      const error = broken.diagnostics.items.find((d) => d.code === "DDIC001");
      expect(error).toMatchObject({ file: "src/zrt_booking.tabl.astabl", line: 9 });
    } finally {
      variant.cleanup();
    }
  });

  it("report syntax errors with their position", () => {
    const { issues } = parseTableSource("define table ztab {\n  key id : abap.char;\n  name : abap.foo(3);\n}\n");
    expect(issues).toEqual([
      expect.objectContaining({ severity: "error", line: 2, message: expect.stringContaining("abap.char needs a length") }),
      expect.objectContaining({ severity: "error", line: 3, message: expect.stringContaining("unknown built-in type abap.foo") }),
    ]);
    const project = parseTableSource("define table ztab {\n  id : abap.int4;\n}");
    expect(project.issues[0]?.message).toContain("no key field");
  });

  it("serialize structures, includes, references and built-in types", () => {
    const { table, issues } = parseTableSource(`@EndUserText.label : 'Amounts'
define structure zs_amount {
  include zs_base;
  amount   : abap.dec(15,2);
  @Semantics.quantity.unitOfMeasure : 'zs_amount.unit'
  quantity : abap.quan(13,3);
  unit     : abap.unit(3);
  count    : abap.int4;
  note     : abap.string(0);
  stamp    : abap.utclong;
  waers    : waers not null
    with foreign key [0..*,1] tcurc where waers = zs_amount.waers;
}`);
    expect(issues.map((i) => i.severity)).toEqual(["warning"]);
    const xml = tableSourceToXml(table!);
    expect(xml).toContain("<TABCLASS>INTTAB</TABCLASS>");
    expect(xml).not.toContain("<DD09L>");
    expect(xml).toContain("<PRECFIELD>ZS_BASE</PRECFIELD>");
    expect(readTablXml(xml)?.fields.map((f) => [f.fieldName, f.dataType ?? f.rollName, f.length, f.decimals, f.refField])).toEqual([
      [".INCLUDE", undefined, undefined, undefined, undefined],
      ["AMOUNT", "DEC", 15, 2, undefined],
      ["QUANTITY", "QUAN", 13, 3, "UNIT"],
      ["UNIT", "UNIT", 3, undefined, undefined],
      ["COUNT", "INT4", 10, undefined, undefined],
      ["NOTE", "STRG", 0, undefined, undefined],
      ["STAMP", "UTCL", 27, undefined, undefined],
      ["WAERS", "WAERS", undefined, undefined, undefined],
    ]);
  });
});

describe("rapt abapgit", () => {
  it("writes the XML the sources lack and leaves the others alone", () => {
    const removed = ["zrt_c_travel.ddls.xml", "zrt_a_discount.ddls.xml", "zrt_r_travel.bdef.xml", "zrt_ui_travel.srvd.xml", "zbp_rt_r_travel.clas.xml", "zrt_c_booking.ddlx.xml", "zrt_c_booking.dcls.xml"];
    const variant = fixtureVariant(Object.fromEntries(removed.map((f) => [f, null])));
    try {
      const check = generateAbapGitFiles(variant.dir, { check: true });
      expect(check.written.sort()).toEqual(removed.map((f) => `src/${f}`).sort());
      expect(existsSync(path.join(variant.dir, "src", removed[0]!))).toBe(false);
      const result = generateAbapGitFiles(variant.dir);
      expect(result.written.length).toBe(removed.length);
      const read = (f: string): string => readFileSync(path.join(variant.dir, "src", f), "utf8");
      expect(read("zrt_c_travel.ddls.xml")).toContain("<SOURCE_TYPE>P</SOURCE_TYPE>");
      expect(read("zrt_a_discount.ddls.xml")).toContain("<SOURCE_TYPE>A</SOURCE_TYPE>");
      expect(read("zrt_ui_travel.srvd.xml")).toBe(readFixture("zrt_ui_travel.srvd.xml"));
      expect(read("zbp_rt_r_travel.clas.xml")).toBe(readFixture("zbp_rt_r_travel.clas.xml"));
      expect(generateAbapGitFiles(variant.dir, { check: true }).written).toEqual([]);
    } finally {
      variant.cleanup();
    }
  });

  it("generates the XML of tables written as source and ignores the sources in .abapgit.xml", () => {
    const variant = fixtureVariant({ "zrt_booking.tabl.xml": null, "zrt_booking.tabl.astabl": BOOKING_SOURCE });
    try {
      expect(generateAbapGitFiles(variant.dir).written.sort()).toEqual([".abapgit.xml", "src/zrt_booking.tabl.xml"]);
      expect(readFileSync(path.join(variant.dir, ".abapgit.xml"), "utf8")).toContain("<item>/src/*.astabl</item>");
      expect(readTablXml(readFileSync(path.join(variant.dir, "src", "zrt_booking.tabl.xml"), "utf8"))).toEqual(readTablXml(readFixture("zrt_booking.tabl.xml")));
      expect(generateAbapGitFiles(variant.dir).written).toEqual([]);
    } finally {
      variant.cleanup();
    }
  });

  it("knows the kinds of CDS definitions", () => {
    expect(ddlSourceType("define root view entity ZI_A as select from ztab { key id }")).toBe("W");
    expect(ddlSourceType("define root view entity ZC_A\n  provider contract transactional_query\n  as projection on ZI_A { key id }")).toBe("P");
    expect(ddlSourceType("define abstract entity ZA_A { x : abap.int4; }")).toBe("A");
    expect(ddlSourceType("@ObjectModel.query.implementedBy: 'ABAP:ZCL_Q'\ndefine custom entity ZCE_A { key id : abap.int4; }")).toBe("Q");
  });
});

describe("rapt new", () => {
  it("names the objects from the entity and the prefix", () => {
    expect(boNames("Travel", { prefix: "ZRT" })).toMatchObject({ table: "zrt_travel", root: "ZRT_R_Travel", projection: "ZRT_C_Travel", pool: "zbp_rt_r_travel", service: "ZRT_UI_TRAVEL", binding: "ZRT_UI_TRAVEL_O4" });
    expect(boNames("SalesOrder")).toMatchObject({ table: "z_sales_order", pool: "zbp_r_sales_order" });
    expect(boNames("VeryLongBusinessObjectName", { prefix: "ZRT" })).toEqual({ error: expect.stringContaining("16 characters") });
    expect(boNames("Travel", { prefix: "ABC" })).toEqual({ error: expect.stringContaining("Z or Y") });
  });

  it("writes a business object that builds, with its abapGit files and seed data", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rapt-new-"));
    try {
      const result = newBusinessObject(dir, "Ticket", { prefix: "ZHD", description: "Help desk ticket" });
      expect(result.error).toBeUndefined();
      expect(result.written).toEqual(expect.arrayContaining(["src/zhd_ticket.tabl.astabl", "src/zhd_ticket.tabl.xml", "src/zhd_r_ticket.ddls.xml", "src/package.devc.xml", ".abapgit.xml", ".gitignore", "rapt/seed.json", "AGENTS.md"]));
      expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toContain(".rapt/");
      expect(generateAbapGitFiles(dir, { check: true }).written).toEqual([]);
      const app = await generateApplication(loadProject(dir), { scaffold: false });
      expect(app.diagnostics.items.filter((d) => d.severity !== "info")).toEqual([]);
      expect(app.files.find((f) => f.path === "db/seed.json")?.content).toContain('"zhd_ticket"');
      // the files are never overwritten
      expect(newBusinessObject(dir, "Ticket", { prefix: "ZHD" }).error).toContain("already present");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("seed data (rapt/seed.json)", () => {
  it("is checked against the tables of the application", async () => {
    const variant = fixtureVariant({});
    try {
      writeFileSync(path.join(variant.dir, "rapt", "seed.json"), JSON.stringify({ zrt_travel: [{ travel_id: "1", client: "100", nope: 1 }], zrt_unknown: [] }));
      const app = await generateApplication(loadProject(variant.dir), { scaffold: false, transpile: false });
      expect(app.diagnostics.items.filter((d) => d.code.startsWith("SEED")).map((d) => d.message)).toEqual([
        expect.stringContaining("zrt_travel[0].nope is not a field of zrt_travel"),
        expect.stringContaining("zrt_unknown is not a table of the application"),
      ]);
    } finally {
      variant.cleanup();
    }
  }, 120_000);
});
