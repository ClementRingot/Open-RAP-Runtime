import * as abaplint from "@abaplint/core";
import { describe, expect, it } from "vitest";
import type { BehaviorAst, BodyItemAst } from "../src/bdef/ast.js";
import { parseBdef } from "../src/bdef/parser.js";
import { readFixture } from "./helpers.js";

function parseOk(source: string) {
  const result = parseBdef(source);
  expect(result.errors).toEqual([]);
  if (result.ast === undefined) {
    throw new Error("no AST");
  }
  return result.ast;
}

function items<K extends BodyItemAst["kind"]>(behavior: BehaviorAst | undefined, kind: K): Array<Extract<BodyItemAst, { kind: K }>> {
  return (behavior?.items ?? []).filter((i): i is Extract<BodyItemAst, { kind: K }> => i.kind === kind);
}

describe("BDEF parser: fixture", () => {
  it("parses the managed BDEF", () => {
    const ast = parseOk(readFixture("zrt_r_travel.bdef.asbdef"));
    expect(ast.headers).toEqual([
      { kind: "implementation", type: "managed", className: { text: "zbp_rt_r_travel", loc: { line: 1, column: 33 } }, unique: true, loc: { line: 1, column: 1 } },
      { kind: "strict", version: 2, loc: { line: 2, column: 1 } },
    ]);
    const [travel, booking] = ast.behaviors;
    expect(travel?.entity.text).toBe("ZRT_R_Travel");
    expect(travel?.alias?.text).toBe("Travel");
    expect(travel?.options.map((o) => o.kind)).toEqual(["persistentTable", "lockMaster", "authorizationMaster", "etagMaster"]);
    expect(travel?.options[2]).toMatchObject({ kind: "authorizationMaster", values: ["global", "instance"] });
    expect(items(travel, "operation").map((o) => o.op)).toEqual(["create", "update", "delete"]);
    expect(items(travel, "association")[0]).toMatchObject({ name: { text: "_Booking" }, create: { internal: false, options: [] } });
    expect(items(travel, "field").map((f) => [f.characteristics.map((c) => c.text), f.fields.length])).toEqual([
      [["numbering:managed", "readonly"], 1],
      [["readonly"], 7],
      [["mandatory"], 6],
    ]);
    const [accept, discount, copy, recalc] = items(travel, "action");
    expect(accept).toMatchObject({
      name: { text: "acceptTravel" },
      internal: false,
      options: [{ name: "features", value: "instance" }],
      result: { selective: false, cardinality: { min: 1, max: 1 }, entity: { text: "$self" }, entityKeyword: false },
    });
    expect(discount).toMatchObject({ name: { text: "deductDiscount" }, parameter: { text: "ZRT_A_Discount" }, result: { entity: { text: "$self" } } });
    expect(copy).toMatchObject({ name: { text: "copyTravel" }, factory: true, factoryCardinality: { min: 1, max: 1 } });
    expect(recalc).toMatchObject({ name: { text: "reCalcTotalPrice" }, internal: true });
    expect(recalc?.result).toBeUndefined();
    expect(items(travel, "determination").map((d) => [d.name.text, d.on, d.triggers.create, d.triggers.fields.map((f) => f.text)])).toEqual([
      ["setStatusOpen", "modify", true, []],
      ["calculateTotalPrice", "modify", true, ["BookingFee", "CurrencyCode"]],
    ]);
    expect(items(travel, "validation")[0]?.triggers).toMatchObject({ create: true, update: false, delete: false });
    const mapping = items(travel, "mapping")[0];
    expect(mapping?.table.text).toBe("zrt_travel");
    expect(mapping?.corresponding).toBe(true);
    expect(mapping?.pairs[0]).toMatchObject({ field: { text: "TravelUUID" }, column: { text: "travel_uuid" } });
    expect(booking?.options.map((o) => o.kind)).toEqual(["persistentTable", "lockDependent", "authorizationDependent", "etagMaster"]);
    expect(booking?.options[1]).toMatchObject({ kind: "lockDependent", by: { text: "_Travel" } });
  });

  it("parses the projection BDEF", () => {
    const ast = parseOk(readFixture("zrt_c_travel.bdef.asbdef"));
    expect(ast.headers[0]).toMatchObject({ kind: "implementation", type: "projection" });
    const [travel, booking] = ast.behaviors;
    expect(travel?.options).toMatchObject([{ kind: "useEtag" }]);
    expect(items(travel, "useOperation").map((o) => o.op)).toEqual(["create", "update", "delete"]);
    expect(items(travel, "useAction")[0]).toMatchObject({ actionKind: "action", name: { text: "acceptTravel" } });
    expect(items(travel, "useAssociation")[0]).toMatchObject({ name: { text: "_Booking" }, create: true });
    expect(items(booking, "useAssociation")[0]).toMatchObject({ name: { text: "_Travel" }, create: false });
  });

  it("finds the same entities and aliases as the abaplint BDEF parser", () => {
    for (const name of ["zrt_r_travel.bdef.asbdef", "zrt_c_travel.bdef.asbdef", ...Object.keys(CORPUS)]) {
      const source = CORPUS[name] ?? readFixture(name);
      const ours = parseOk(source).behaviors.map((b) => ({ name: b.entity.text, alias: b.alias?.text }));
      const reg = new abaplint.Registry().addFile(new abaplint.MemoryFile(name.endsWith(".asbdef") ? name : `${name}.bdef.asbdef`, source));
      reg.parse();
      const object = reg.getFirstObject();
      expect(object).toBeInstanceOf(abaplint.Objects.BehaviorDefinition);
      const theirs = (object as abaplint.Objects.BehaviorDefinition).listEntities();
      expect(ours, name).toEqual(theirs.map((e) => ({ name: e.name, alias: e.alias })));
    }
  });
});

/** Hand-written corpus covering the BDEF syntax around the supported subset. */
const CORPUS: Record<string, string> = {
  "zcorpus_namespaced.bdef.asbdef": `managed implementation in class /dmo/bp_travel_m unique;
strict ( 2 );
with privileged mode disabling NoCheckWhenPrivileged;

define behavior for /DMO/I_Travel_M alias travel
implementation in class /dmo/bp_travel_m_impl unique
persistent table /dmo/travel_m
lock master
authorization master ( global, instance )
etag master last_changed_at
early numbering
{
  // a comment
  create ( precheck );
  update ( features : instance, precheck );
  delete ( features : instance );
  association _Booking { create ( features : instance ); }

  field ( readonly ) travel_id;
  field ( mandatory : create, readonly : update ) agency_id;
  field ( features : instance ) description;

  /* block
     comment */
  action ( features : instance ) acceptTravel result [1] $self;
  action rejectTravel result [1] $self;
  action ( precheck ) deductDiscount parameter /dmo/a_travel_discount result [1] $self;
  static action ( features : global ) createTravelWithDefaults parameter /dmo/a_create_travel result [0..*] $self;
  factory action copyTravel [1];
  static factory action createFromTemplate [1];
  function getTotalPrice result [1] /dmo/a_total_price;
  static function getStatistics result [1] /dmo/a_statistics;
  internal action reCalcTotPrice;

  determination calculateTotalPrice on modify { create; field booking_fee, currency_code; }
  determination setStatus on save { create; update; delete; }
  internal determination internalDet on modify { field description; }
  validation validateCustomer on save { create; field customer_id; }

  side effects
  {
    field booking_fee affects field total_price;
    action acceptTravel affects field overall_status, messages;
    field begin_date affects field end_date, entity _Booking;
  }

  mapping for /dmo/travel_m corresponding;
}

define behavior for /DMO/I_Booking_M alias booking
persistent table /dmo/booking_m
lock dependent by _Travel
authorization dependent by _Travel
etag dependent by _Travel
{
  update;
  delete;
  field ( readonly ) travel_id, booking_id;
  association _Travel { }
  mapping for /dmo/booking_m control /dmo/s_booking_x corresponding
  {
    booking_id = booking_id;
    flight_price = flight_price control flight_price_x;
  }
}
`,
  "zcorpus_out_of_scope.bdef.asbdef": `managed implementation in class zbp_draft unique;
strict ( 2 );
with draft;

define behavior for ZR_Draft alias Root
persistent table zdraft
draft table zdraft_d
lock master total etag LastChangedAt
authorization master ( instance )
etag master LocalLastChangedAt
late numbering in place
with additional save with full data
{
  create;
  update;
  delete;
  draft action Edit;
  draft action Activate optimized;
  draft determine action Prepare { validation validateX; }
  determine action checkAll { validation validateX; }
  event created parameter ZA_Event;
  association _Child { create; with draft; }
  validation validateX on save { create; }
  some unknown statement ( with parentheses );
  another { block; with; } ;
}

define behavior for ZR_DraftChild alias Child
persistent table zdraft_child
draft table zdraft_child_d
lock dependent by _Root
{
  update;
  association _Root { with draft; }
}
`,
};

describe("BDEF parser: syntax around the supported subset", () => {
  it("parses namespaced names, options, actions, functions and side effects", () => {
    const ast = parseOk(CORPUS["zcorpus_namespaced.bdef.asbdef"] as string);
    expect(ast.headers.map((h) => h.kind)).toEqual(["implementation", "strict", "privilegedMode"]);
    expect(ast.headers[2]).toMatchObject({ kind: "privilegedMode", disabling: { text: "NoCheckWhenPrivileged" } });
    const [travel, booking] = ast.behaviors;
    expect(travel?.entity.text).toBe("/DMO/I_Travel_M");
    expect(travel?.options.map((o) => o.kind)).toEqual(["implementationInClass", "persistentTable", "lockMaster", "authorizationMaster", "etagMaster", "earlyNumbering"]);
    expect(travel?.options[3]).toMatchObject({ values: ["global", "instance"] });
    expect(items(travel, "operation").map((o) => [o.op, o.options.map((x) => `${x.name}${x.value ? `:${x.value}` : ""}`)])).toEqual([
      ["create", ["precheck"]],
      ["update", ["features:instance", "precheck"]],
      ["delete", ["features:instance"]],
    ]);
    expect(items(travel, "association")[0]?.create?.options).toMatchObject([{ name: "features", value: "instance" }]);
    expect(items(travel, "field").map((f) => f.characteristics.map((c) => c.text))).toEqual([["readonly"], ["mandatory:create", "readonly:update"], ["features:instance"]]);
    const actions = items(travel, "action");
    expect(actions.map((a) => [a.name.text, a.actionKind, a.static, a.factory, a.internal])).toEqual([
      ["acceptTravel", "action", false, false, false],
      ["rejectTravel", "action", false, false, false],
      ["deductDiscount", "action", false, false, false],
      ["createTravelWithDefaults", "action", true, false, false],
      ["copyTravel", "action", false, true, false],
      ["createFromTemplate", "action", true, true, false],
      ["getTotalPrice", "function", false, false, false],
      ["getStatistics", "function", true, false, false],
      ["reCalcTotPrice", "action", false, false, true],
    ]);
    expect(actions[2]?.parameter?.text).toBe("/dmo/a_travel_discount");
    expect(actions[3]?.result?.cardinality).toEqual({ min: 0, max: "*" });
    expect(actions[4]?.factoryCardinality).toEqual({ min: 1, max: 1 });
    expect(actions[6]?.result?.entity.text).toBe("/dmo/a_total_price");
    expect(items(travel, "determination").map((d) => [d.name.text, d.on, d.internal, d.triggers])).toMatchObject([
      ["calculateTotalPrice", "modify", false, { create: true, update: false, delete: false }],
      ["setStatus", "save", false, { create: true, update: true, delete: true }],
      ["internalDet", "modify", true, { create: false }],
    ]);
    const sideEffects = items(travel, "sideEffects")[0]?.items ?? [];
    expect(sideEffects.map((s) => [s.trigger.kind, s.trigger.name.text, s.targets])).toEqual([
      ["field", "booking_fee", [{ kind: "field", path: "total_price" }]],
      ["action", "acceptTravel", [{ kind: "field", path: "overall_status" }, { kind: "messages", path: "" }]],
      ["field", "begin_date", [{ kind: "field", path: "end_date" }, { kind: "entity", path: "_Booking" }]],
    ]);
    expect(items(travel, "mapping")[0]).toMatchObject({ table: { text: "/dmo/travel_m" }, corresponding: true, pairs: [] });
    expect(booking?.options.map((o) => o.kind)).toEqual(["persistentTable", "lockDependent", "authorizationDependent", "etagDependent"]);
    expect(items(booking, "mapping")[0]?.pairs.map((p) => p.field.text)).toEqual(["booking_id", "flight_price"]);
  });

  it("recognizes out-of-scope constructs instead of failing", () => {
    const ast = parseOk(CORPUS["zcorpus_out_of_scope.bdef.asbdef"] as string);
    expect(ast.headers.map((h) => h.kind)).toEqual(["implementation", "strict", "withDraft"]);
    const root = ast.behaviors[0];
    expect(root?.options.map((o) => o.kind)).toEqual([
      "persistentTable",
      "draftTable",
      "lockMaster",
      "totalEtag",
      "authorizationMaster",
      "etagMaster",
      "lateNumbering",
      "withSave",
    ]);
    expect(root?.options[6]).toMatchObject({ kind: "lateNumbering", inPlace: true });
    expect(items(root, "unsupported").map((u) => u.what)).toEqual(["draft", "draft", "draft", "determine action", "event"]);
    expect(items(root, "association")[0]).toMatchObject({ withDraft: true, create: { internal: false } });
    expect(items(root, "unknown").map((u) => u.text)).toEqual(["some unknown statement ( with parentheses );", "another { block; with; } ;"]);
  });

  it("reports syntax errors with their position", () => {
    const result = parseBdef("managed implementation in class zbp unique;\ndefine behavior for ZR_X alias X\npersistent table zx\n{\n  field ( readonly ) ;\n}\n");
    expect(result.ast).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ line: 5, column: 22 });
    expect(result.errors[0]?.message).toContain('";"');
  });

  it("reports lexer errors with their position", () => {
    const result = parseBdef("managed;\ndefine behavior for ZR_X { create; } §");
    expect(result.errors[0]).toMatchObject({ line: 2, message: expect.stringContaining("unexpected character") });
  });

  it("accepts keywords as names and any keyword case", () => {
    const ast = parseOk("MANAGED IMPLEMENTATION IN CLASS zbp UNIQUE;\nDEFINE BEHAVIOR FOR ZR_Data ALIAS Data\nPERSISTENT TABLE zdata\nLOCK MASTER\n{\n  CREATE;\n  FIELD ( READONLY ) Mode, Control, Table;\n}\n");
    expect(ast.behaviors[0]?.alias?.text).toBe("Data");
    expect(items(ast.behaviors[0], "field")[0]?.fields.map((f) => f.text)).toEqual(["Mode", "Control", "Table"]);
  });
});
