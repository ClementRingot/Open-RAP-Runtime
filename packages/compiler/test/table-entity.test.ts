/** CDS table entities, simple types and enumerated types (D55). */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ddlSourceType, generateAbapGitFiles } from "../src/authoring/abapgit.js";
import { generateObject } from "../src/authoring/generate.js";
import { parseCdsTypeSource } from "../src/ddic/cds-types.js";
import { replaceEnumConstants } from "../src/gen/abap/enums.js";
import { generateCsdl } from "../src/gen/csdl.js";
import { generateSql } from "../src/gen/sql.js";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/table-entity", import.meta.url));

function variant(changes: Record<string, string | ((content: string) => string)>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "rapt-table-entity-"));
  cpSync(FIXTURE, dir, { recursive: true, filter: (source) => !source.includes(`${path.sep}.rapt`) });
  for (const [file, change] of Object.entries(changes)) {
    const target = path.join(dir, "src", file);
    writeFileSync(target, typeof change === "function" ? change(readFileSync(target, "utf8")) : change);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function codes(changes: Record<string, string | ((content: string) => string)>, mode?: string): string[] {
  const v = variant(changes);
  try {
    return buildModel(loadProject(v.dir), mode === undefined ? {} : { mode }).diagnostics.items.filter((d) => d.severity === "error").map((d) => d.code);
  } finally {
    v.cleanup();
  }
}

describe("CDS type sources", () => {
  it("read simple types and enumerated types with their labels", () => {
    expect(parseCdsTypeSource("@EndUserText.label: 'Name'\ndefine type zname : abap.char( 40 );\n")).toEqual({
      type: { name: "zname", base: "abap.char(40)", label: "Name", line: 2, column: 13 },
      issues: [],
    });
    const parsed = parseCdsTypeSource(`define type ZS : abap.char(1) enum {
  // the initial value
  @EndUserText.label: 'It''s new'
  NEW = initial;
  OPEN = 'O'; /* open */
}`);
    expect(parsed.issues).toEqual([]);
    expect(parsed.type?.enum).toEqual([
      { name: "NEW", value: "initial", literal: "initial", label: "It's new", line: 4, column: 3 },
      { name: "OPEN", value: "O", literal: "'O'", line: 5, column: 3 },
    ]);
  });

  it("report what they cannot read", () => {
    expect(parseCdsTypeSource("define type x abap.char(1);").issues.map((i) => i.code)).toEqual(["TYPE001"]);
    expect(parseCdsTypeSource("define type x : abap.int1 enum { A = 1 B = 2; }").issues).toEqual([
      expect.objectContaining({ code: "TYPE001", message: "expected <CONSTANT> = <value> | initial;" }),
    ]);
  });
});

describe("table entities and CDS types", () => {
  it("build a BO on a table entity: its table, its view, its implicit persistence", () => {
    const { model, diagnostics } = buildModel(loadProject(FIXTURE));
    expect(diagnostics.items.filter((d) => d.severity !== "info")).toEqual([]);
    const order = model?.entities.find((e) => e.name === "ZRT_ORDER");
    expect(order).toMatchObject({ kind: "view", tableEntity: true, root: true, source: "zrt_order", sqlView: "zrt_order_entity" });
    expect(order?.fields.map((f) => [f.name, f.column])).toEqual([
      ["OrderId", "orderid"],
      ["Name", "name"],
      ["Status", "status"],
      ["Priority", "priority"],
      ["Amount", "amount"],
      ["Currency", "currency"],
      ["Note", "note"],
    ]);
    // simple type: its base type and its label
    expect(order?.fields.find((f) => f.name === "Name")).toMatchObject({ type: { kind: "char", length: 40, dataElement: "ZRT_ORDER_NAME" }, annotations: { endusertext: { label: "Order name" } } });
    expect(order?.fields.find((f) => f.name === "Status")?.type).toEqual({ kind: "char", length: 1, dataElement: "ZRT_ORDER_STATUS", enumType: "ZRT_ORDER_STATUS" });
    expect(model?.tables.find((t) => t.name === "zrt_order")?.columns.map((c) => [c.name, c.key, c.notNull])).toEqual([
      ["orderid", true, true],
      ["name", false, true],
      ["status", false, true],
      ["priority", false, true],
      ["amount", false, true],
      ["currency", false, true],
      ["note", false, false],
    ]);
    expect(model?.behaviors.find((b) => b.name === "ZRT_ORDER")?.entities[0]?.persistentTable).toBe("zrt_order");
    expect(model?.enumTypes).toEqual([
      expect.objectContaining({
        name: "ZRT_ORDER_STATUS",
        base: { kind: "char", length: 1 },
        values: [
          { name: "NEW", value: "", label: "New", initial: true },
          { name: "OPEN", value: "O", label: "Open" },
          { name: "DONE", value: "D", label: "Done" },
          { name: "CANCELLED", value: "X", label: "Cancelled" },
        ],
      }),
      expect.objectContaining({ name: "ZRT_PRIORITY", base: { kind: "int1" }, values: [{ name: "LOW", value: 0, label: "Low", initial: true }, expect.anything(), expect.anything()] }),
    ]);
    // the view of the table entity reads its table
    const sql = generateSql(model as NonNullable<typeof model>).schema;
    expect(sql).toMatch(/CREATE VIEW "zrt_order_entity" AS SELECT\n {2}"orderid" AS "OrderId",[\s\S]*?\nFROM "zrt_order";/);
  });

  it("expose the enumerated types as OData enumeration types in enhanced mode only", () => {
    const { model } = buildModel(loadProject(FIXTURE));
    const csdl = generateCsdl(model as NonNullable<typeof model>);
    expect(csdl).toContain('<EnumType Name="ZRT_ORDER_STATUS">');
    expect(csdl).toContain('<Property Name="Priority" Type="SAP__self.ZRT_PRIORITY" Nullable="false"/>');
    // standard: SAP does not expose them in RAP OData services
    const standard = buildModel(loadProject(FIXTURE), { mode: "standard" });
    expect(standard.diagnostics.items.filter((d) => d.code === "CDS021").map((d) => d.message)).toEqual([
      expect.stringContaining("ZRT_C_ORDER.Status: SAP does not expose CDS enumerated types (ZRT_ORDER_STATUS) in RAP OData services"),
      expect.stringContaining("ZRT_C_ORDER.Priority"),
    ]);
    expect(generateCsdl(standard.model as NonNullable<typeof standard.model>)).not.toContain("EnumType");
  });

  it("check the enumerated types", () => {
    expect(codes({ "zrt_priority.drty.acds": (c) => c.replace("MEDIUM = 5;", "MEDIUM = initial;") })).toContain("TYPE003");
    expect(codes({ "zrt_priority.drty.acds": (c) => c.replace("MEDIUM = 5;", "MEDIUM = 300;") })).toContain("TYPE003");
    expect(codes({ "zrt_priority.drty.acds": (c) => c.replace("MEDIUM = 5;", "MEDIUM = 9;") })).toContain("TYPE003");
    expect(codes({ "zrt_order_status.drty.acds": (c) => c.replace("abap.char(1)", "abap.string") })).toContain("TYPE003");
    expect(codes({ "zrt_order_status.drty.acds": (c) => c.replace("OPEN = 'O'", "OPEN = 'OK'") })).toContain("TYPE003");
    expect(codes({ "zrt_order_name.drty.acds": (c) => c.replace("abap.char(40)", "zrt_unknown") })).toContain("TYPE002");
    expect(codes({ "zrt_order_name.drty.acds": (c) => c.replace("ZRT_ORDER_NAME", "ZRT_OTHER") })).toContain("TYPE001");
  });

  it("check the table entities", () => {
    expect(codes({ "zrt_order.ddls.asddls": (c) => c.replace("Note     : abap.string null;", "Note     : abap.string;") })).toContain("CDS020");
    expect(codes({ "zrt_order.ddls.asddls": (c) => c.replace("key OrderId  : abap.numc(8);", "key OrderId  : abap.numc(8) null;") })).toContain("CDS020");
    expect(codes({ "zrt_order.ddls.asddls": (c) => c.replace("      Name     : zrt_order_name;", "  key Name     : zrt_order_name;").replace("  key OrderId  : abap.numc(8);", "      Status2  : abap.char(1);\n  key OrderId  : abap.numc(8);") })).toContain("CDS020");
    expect(codes({ "zrt_order.ddls.asddls": (c) => c.replace("Currency : abap.cuky;", "Currency : zrt_no_type;") })).toContain("CDS014");
  });

  it("get the AFF metadata of abapGit (.drty.json) from rapt abapgit and rapt generate", () => {
    const v = variant({});
    try {
      rmSync(path.join(v.dir, "src", "zrt_priority.drty.json"));
      expect(generateAbapGitFiles(v.dir).written).toEqual(["src/zrt_priority.drty.json"]);
      expect(JSON.parse(readFileSync(path.join(v.dir, "src", "zrt_priority.drty.json"), "utf8"))).toEqual({ formatVersion: "1", header: { description: "Priority", originalLanguage: "en" } });
      expect(generateObject(v.dir, "enum", "ZRT_COLOR").written).toEqual(["src/zrt_color.drty.acds", "src/zrt_color.drty.json"]);
      expect(buildModel(loadProject(v.dir)).diagnostics.items.filter((d) => d.severity === "error")).toEqual([]);
    } finally {
      v.cleanup();
    }
  });

  it("are written as DDLS of source type T by rapt abapgit", () => {
    expect(ddlSourceType(readFileSync(path.join(FIXTURE, "src", "zrt_order.ddls.asddls"), "utf8"))).toBe("T");
  });
});

describe("enumerated constants in the ABAP code", () => {
  const enumTypes = [
    { name: "ZRT_ORDER_STATUS", base: { kind: "char" as const, length: 1 }, values: [{ name: "NEW", value: "", initial: true as const }, { name: "OPEN", value: "O" }] },
    { name: "ZRT_PRIORITY", base: { kind: "int1" as const }, values: [{ name: "LOW", value: 0, initial: true as const }, { name: "HIGH", value: 9 }] },
  ];

  it("become the literals of their values, outside literals and comments", () => {
    const source = [
      "    IF order-Status = zrt_order_status-open AND order-Priority = ZRT_PRIORITY-high. \" zrt_order_status-open",
      "* zrt_order_status-new",
      "      out = |zrt_order_status-new { zrt_order_status-new }| && 'zrt_priority-low'.",
      "      x = ls_s-zrt_order_status-open + zrt_priority-unknown.",
    ].join("\n");
    expect(replaceEnumConstants(source, enumTypes).split("\n")).toEqual([
      "    IF order-Status = 'O' AND order-Priority = 9. \" zrt_order_status-open",
      "* zrt_order_status-new",
      "      out = |zrt_order_status-new { zrt_order_status-new }| && 'zrt_priority-low'.",
      "      x = ls_s-zrt_order_status-open + zrt_priority-unknown.",
    ]);
  });
});
