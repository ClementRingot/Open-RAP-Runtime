import { findEntity, findEntityBehavior, getAnnotation, type Model } from "@open-rap/model";
import { afterEach, describe, expect, it } from "vitest";
import { formatDiagnostic, type Diagnostic } from "../src/diagnostics.js";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";
import { CALCULATED_CHANGES, FIXTURE_DIR, fixtureVariant, lf } from "./helpers.js";

function fixtureModel(): Model {
  const { model, diagnostics } = buildModel(loadProject(FIXTURE_DIR));
  expect(diagnostics.items.map(formatDiagnostic)).toEqual([]);
  if (model === undefined) {
    throw new Error("no model");
  }
  return model;
}

describe("IR of the Travel fixture", () => {
  it("matches the reviewed snapshot", async () => {
    await expect(`${JSON.stringify(fixtureModel(), null, 2)}\n`).toMatchFileSnapshot("./__snapshots__/travel.model.json");
  });

  it("describes the service", () => {
    const { service } = fixtureModel();
    expect(service).toMatchObject({
      name: "ZRT_UI_TRAVEL",
      binding: "ZRT_UI_TRAVEL_O4",
      version: "0001",
      namespace: "com.sap.gateway.srvd.zrt_ui_travel.v0001",
      path: "/sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001/",
      entitySets: [
        { name: "Travel", entity: "ZRT_C_Travel" },
        { name: "Booking", entity: "ZRT_C_Booking" },
      ],
    });
  });

  it("resolves types through projection, view and table, dropping the client column", () => {
    const model = fixtureModel();
    const table = model.tables.find((t) => t.name === "zrt_travel");
    expect(table?.columns[0]).toMatchObject({ name: "client", client: true, key: true });
    const travel = findEntity(model, "ZRT_C_Travel");
    expect(travel?.fields.map((f) => f.name)).not.toContain("Client");
    const field = (name: string) => travel?.fields.find((f) => f.name === name);
    expect(field("TravelUUID")).toMatchObject({ key: true, baseField: "TravelUUID", type: { kind: "raw", length: 16, dataElement: "SYSUUID_X16" } });
    expect(field("BookingFee")).toMatchObject({ type: { kind: "curr", length: 16, decimals: 2 }, currencyCode: "CurrencyCode" });
    expect(field("LocalLastChangedAt")).toMatchObject({ type: { kind: "timestampl" }, semantics: "localInstanceLastChangedAt" });
    expect(field("CreatedBy")).toMatchObject({ type: { kind: "char", length: 12 }, semantics: "createdBy" });
    const base = findEntity(model, "ZRT_R_Travel");
    expect(base?.fields.find((f) => f.name === "TravelID")).toMatchObject({ column: "travel_id", type: { kind: "numc", length: 8 } });
  });

  it("merges annotations: propagated labels, projection annotations and metadata extension", () => {
    const travel = findEntity(fixtureModel(), "ZRT_C_Travel");
    const travelId = travel?.fields.find((f) => f.name === "TravelID");
    expect(getAnnotation(travelId?.annotations, "EndUserText.label")).toBe("Travel ID");
    expect(getAnnotation(travelId?.annotations, "Search.defaultSearchElement")).toBe(true);
    expect(getAnnotation(travelId?.annotations, "UI.lineItem")).toEqual([{ position: 10, importance: "#HIGH" }]);
    expect(getAnnotation(travel?.annotations, "UI.headerInfo.typeNamePlural")).toBe("Travels");
    expect(getAnnotation(travel?.annotations, "Metadata.layer")).toBeUndefined();
  });

  it("derives the ON condition of compositions from the to-parent association", () => {
    const model = fixtureModel();
    expect(findEntity(model, "ZRT_R_Travel")?.associations[0]).toMatchObject({ name: "_Booking", kind: "composition", on: [{ source: "TravelUUID", target: "TravelUUID" }] });
    expect(findEntity(model, "ZRT_C_Travel")?.associations[0]).toMatchObject({ target: "ZRT_C_Booking", baseAssociation: "_Booking", on: [{ source: "TravelUUID", target: "TravelUUID" }] });
  });

  it("links the BDEF elements to the handler methods of the behavior pool", () => {
    const model = fixtureModel();
    const travel = findEntityBehavior(model, "ZRT_R_Travel")?.entity;
    expect(travel?.validations[0]?.handler).toEqual({
      classKey: "CLAS-ZBP_RT_R_TRAVEL-LHC_TRAVEL",
      className: "LHC_TRAVEL",
      method: "validatedates",
      params: { keys: "keys", failed: "failed", reported: "reported" },
    });
    expect(travel?.actions.map((a) => [a.name, a.handler?.method, a.handler?.params.result])).toEqual([
      ["acceptTravel", "accepttravel", "result"],
      ["deductDiscount", "deductdiscount", "result"],
      ["copyTravel", "copytravel", undefined],
      ["reCalcTotalPrice", "recalctotalprice", undefined],
    ]);
    expect(travel?.globalAuthorizationHandler?.params).toMatchObject({ requested: "requested_authorizations", result: "result" });
    expect(travel?.instanceFeaturesHandler?.method).toBe("get_instance_features");
    const booking = findEntityBehavior(model, "ZRT_R_Booking")?.entity;
    expect(booking?.determinations[0]?.handler?.classKey).toBe("CLAS-ZBP_RT_R_TRAVEL-LHC_BOOKING");
    const projection = findEntityBehavior(model, "ZRT_C_Travel");
    expect(projection?.behavior.implementationType).toBe("projection");
    expect(projection?.entity.actions[0]).toMatchObject({ name: "acceptTravel", use: true });
  });
});

describe("IR diagnostics", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  function diagnosticsOf(changes: Parameters<typeof fixtureVariant>[0]): Diagnostic[] {
    const variant = fixtureVariant(changes);
    cleanup = variant.cleanup;
    return buildModel(loadProject(variant.dir)).diagnostics.items;
  }

  const bdef = "zrt_r_travel.bdef.asbdef";
  const abp = "zbp_rt_r_travel.clas.locals_imp.abap";

  it("reports unknown fields of the BDEF on their line", () => {
    const items = diagnosticsOf({ [bdef]: (c) => c.replace("field ( readonly ) OverallStatus,", "field ( readonly ) Unknown, OverallStatus,") });
    expect(items).toContainEqual({ severity: "error", code: "BDEF005", message: "field: ZRT_R_Travel has no element Unknown", file: "src/zrt_r_travel.bdef.asbdef", line: 16, column: 22 });
  });

  it("reports BDEF elements without handler, and handlers without BDEF element", () => {
    const items = diagnosticsOf({ [bdef]: (c) => c.replace("validation validateDates on save", "validation checkDates on save") });
    expect(items.map((d) => `${d.severity} ${d.code} ${d.message}`)).toEqual([
      "error ABP002 no handler method FOR VALIDATE ON SAVE for Travel~checkDates",
      "warning ABP003 handler method LHC_TRAVEL->validatedates (validation) does not match the BDEF and is not called",
    ]);
  });

  it("needs the numbering handler of a creation by association for an early numbered child", () => {
    const items = diagnosticsOf({
      [bdef]: (c) =>
        c
          .replace("persistent table zrt_booking\nlock dependent by _Travel", "persistent table zrt_booking\nearly numbering\nlock dependent by _Travel")
          .replace("field ( numbering : managed, readonly ) BookingUUID;", "field ( readonly ) BookingUUID;"),
    });
    expect(items.map((d) => `${d.severity} ${d.code} ${d.message}`)).toEqual(["error ABP002 no handler method FOR NUMBERING for Travel\\_Booking"]);
  });

  it("needs a draft table for each entity of a draft BO (D54)", () => {
    const items = diagnosticsOf({ [bdef]: (c) => c.replace("strict ( 2 );", "strict ( 2 );\nwith draft;") });
    expect(items.map((d) => d.code)).toEqual(["BDEF028", "BDEF028"]);
  });

  it("needs total etag right after lock master (D85)", () => {
    const draft = (c: string): string =>
      c
        .replace("strict ( 2 );", "strict ( 2 );\nwith draft;")
        .replace("persistent table zrt_travel", "persistent table zrt_travel\ndraft table zrt_d_travel")
        .replace("persistent table zrt_booking", "persistent table zrt_booking\ndraft table zrt_d_booking");
    const apart = diagnosticsOf({ [bdef]: (c) => draft(c).replace("etag master LocalLastChangedAt\n{", "etag master LocalLastChangedAt\ntotal etag LastChangedAt\n{") });
    expect(apart.map((d) => `${d.code} ${d.message}`)).toContain("BDEF031 ZRT_R_Travel: total etag is an addition of lock master: write lock master total etag LastChangedAt");
    const after = diagnosticsOf({ [bdef]: (c) => draft(c).replace("lock master\n", "lock master total etag LastChangedAt\n") });
    expect(after.map((d) => d.code)).not.toContain("BDEF031");
  });

  it("checks the mapping against the CDS view and the table", () => {
    const items = diagnosticsOf({ [bdef]: (c) => c.replace("TravelID           = travel_id;", "TravelID           = agency_id;") });
    expect(items).toContainEqual(expect.objectContaining({ code: "BDEF008", message: "ZRT_R_Travel.TravelID: the BDEF maps it to agency_id, the CDS view selects travel_id" }));
  });

  it("reports unknown tables and data elements", () => {
    expect(diagnosticsOf({ [bdef]: (c) => c.replace("persistent table zrt_travel", "persistent table zrt_unknown") })).toContainEqual(
      expect.objectContaining({ code: "BDEF007", message: "unknown persistent table zrt_unknown", line: 5 }),
    );
    expect(diagnosticsOf({ "zrt_travel.tabl.xml": (c) => c.replace("<ROLLNAME>ABP_CREATION_USER</ROLLNAME>", "<ROLLNAME>ZUNKNOWN_DTEL</ROLLNAME>") })).toContainEqual(
      expect.objectContaining({ code: "DDIC001", message: "ZRT_TRAVEL-CREATED_BY: unknown data element ZUNKNOWN_DTEL (add its DTEL to the sources)", file: "src/zrt_travel.tabl.xml" }),
    );
  });

  it("reports exposed entities that do not exist", () => {
    const items = diagnosticsOf({ "zrt_ui_travel.srvd.srvdsrv": (c) => c.replace("expose ZRT_C_Booking as Booking;", "expose ZRT_C_Booking as Booking;\n  expose ZRT_C_Nothing as Nothing;") });
    expect(items).toContainEqual(expect.objectContaining({ code: "SRVD005", message: "exposed entity ZRT_C_Nothing not found in the sources", line: 5, column: 3 }));
  });

  it("ignores metadata extensions the entity does not allow", () => {
    const items = diagnosticsOf({ "zrt_c_booking.ddls.asddls": (c) => c.replace("@Metadata.allowExtensions: true\n", "") });
    expect(items).toContainEqual(expect.objectContaining({ severity: "warning", code: "CDS007", file: "src/zrt_c_booking.ddlx.asddlxs" }));
  });

  it("reports ABAP syntax errors of the behavior pool on the original line", () => {
    const items = diagnosticsOf({ [abp]: (c) => c.replace("CHECK travels IS NOT INITIAL.", "CHECK travels IS NOT INITIAL") });
    expect(items).toContainEqual(expect.objectContaining({ code: "ABP004", file: "src/zbp_rt_r_travel.clas.locals_imp.abap" }));
  });

  it("checks the projection against its base behavior", () => {
    const items = diagnosticsOf({ "zrt_c_travel.bdef.asbdef": (c) => c.replace("use action acceptTravel;", "use action acceptTravel;\n  use action reCalcTotalPrice;") });
    expect(items).toContainEqual(expect.objectContaining({ code: "BDEF023", message: "ZRT_C_Travel: use action reCalcTotalPrice, but ZRT_R_Travel has no public action reCalcTotalPrice" }));
  });
});

describe("calculated elements (D67)", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  function build(changes: Parameters<typeof fixtureVariant>[0]): { model: Model; diagnostics: Diagnostic[] } {
    const variant = fixtureVariant(changes);
    cleanup = variant.cleanup;
    const { model, diagnostics } = buildModel(loadProject(variant.dir));
    if (model === undefined) throw new Error(diagnostics.items.map(formatDiagnostic).join("\n"));
    return { model, diagnostics: diagnostics.items };
  }

  const view = "zrt_r_travel.ddls.asddls";
  const withElement = (line: string) => ({ [view]: (c: string) => lf(c).replace("      _Booking\n", `      ${line},\n      _Booking\n`) });

  it("resolves and types the expressions of a view and passes them through its projection", () => {
    const { model, diagnostics } = build(CALCULATED_CHANGES);
    expect(diagnostics.filter((d) => d.severity === "error").map(formatDiagnostic)).toEqual([]);
    const travel = findEntity(model, "ZRT_R_Travel");
    const field = (name: string) => travel?.fields.find((f) => f.name === name);
    expect(field("TotalWithFee")).toMatchObject({ type: { kind: "dec", length: 17, decimals: 2 }, currencyCode: "CurrencyCode", expression: { kind: "arithmetic", operator: "+" } });
    expect(field("TotalWithFee")?.column).toBeUndefined();
    expect(field("StatusText")?.type).toEqual({ kind: "char", length: 9 });
    expect(field("Label")?.type).toEqual({ kind: "char", length: 263 });
    expect(field("Duration")?.type).toEqual({ kind: "int4" });
    expect(field("Third")?.type).toEqual({ kind: "dec", length: 31, decimals: 2 });
    expect(field("IsExpensive")?.type).toMatchObject({ kind: "bool", dataElement: "ABAP_BOOLEAN" });
    expect(field("IsExpensive")?.expression).toMatchObject({
      kind: "cast",
      operand: { kind: "case", branches: [{ when: { kind: "and", right: { left: { kind: "element", name: "Duration" } } } }] },
    });
    const projection = findEntity(model, "ZRT_C_Travel");
    expect(projection?.fields.find((f) => f.name === "TotalWithFee")).toMatchObject({ baseField: "TotalWithFee", currencyCode: "CurrencyCode" });
    expect(projection?.fields.find((f) => f.name === "DoubleDuration")).toMatchObject({ type: { kind: "int4" }, expression: { kind: "arithmetic", left: { kind: "column", name: "Duration" } } });
    expect(projection?.fields.find((f) => f.name === "DescriptionUpper")?.type).toEqual({ kind: "char", length: 256 });
  });

  it("keeps CDS002 for what is not supported, naming the construct", () => {
    const message = (line: string): string[] =>
      build(withElement(line))
        .diagnostics.filter((d) => d.severity === "error")
        .map((d) => `${d.code} ${d.message}`);
    // D103: user, client, system_language and system_date are supported
    expect(message("$session.user as CurrentUser")).toEqual([]);
    expect(message("$session.user_date as UserDate")).toEqual([]);
    expect(message("$session.bs_instance_id as Instance")).toEqual([
      "CDS002 ZRT_R_Travel.Instance: session variable $session.bs_instance_id is not supported (the built-in ones of CDS view entities only: user, client, system_language, system_date, user_timezone, user_date)",
    ]);
    // D100: a path through a to-many association has no single value
    expect(message("concat( _Booking.BookingID, 'x' ) as FirstBooking")).toEqual(["CDS002 ZRT_R_Travel.FirstBooking: _Booking.BookingID: _Booking is a to-many association: a path in the select list needs one value per instance"]);
    expect(message("_Booking.BookingID as FirstBooking")).toEqual(["CDS002 ZRT_R_Travel.FirstBooking: _Booking.BookingID: _Booking is a to-many association: a path in the select list needs one value per instance"]);
    // D105: an aggregate needs a GROUP BY listing the other elements
    expect(message("count( * ) as Bookings")).toEqual(["CDS022 ZRT_R_Travel: aggregate expressions need a GROUP BY clause listing the other elements"]);
    expect(message("instr( description, 'a' ) as Position")).toEqual(["CDS002 ZRT_R_Travel.Position: the SQL function INSTR is not supported yet"]);
  });

  it("types an element reached through to-one associations (D100)", () => {
    const booking = (line: string) =>
      build({ "zrt_r_booking.ddls.asddls": (c: string) => lf(c).replace("      _Travel\n", `      ${line},\n      _Travel\n`) });
    const ok = booking("_Travel.TravelID as TravelNumber");
    expect(ok.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(findEntity(ok.model, "ZRT_R_Booking")?.fields.find((f) => f.name === "TravelNumber")).toMatchObject({
      type: { kind: "numc", length: 8 },
      expression: { kind: "path", from: "self", associations: ["_Travel"], element: "TravelID" },
    });
    expect(booking("_Travel.Nothing as X").diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toEqual(["CDS004"]);
  });

  it("resolves the WHERE condition of a view entity (D101)", () => {
    const where = (condition: string) => build({ [view]: (c: string) => lf(c).replace(/\n}\s*$/, `\n}\nwhere ${condition}\n`) });
    const ok = where("overall_status <> 'X' and $projection.BookingFee >= 0");
    expect(ok.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
    expect(findEntity(ok.model, "ZRT_R_Travel")?.where).toMatchObject({ kind: "and", left: { kind: "compare", operator: "<>", left: { kind: "column", name: "overall_status" } }, right: { left: { kind: "element", name: "BookingFee" } } });
    // D102: BETWEEN and IS INITIAL; no IN list in CDS view entities (as SAP)
    expect(findEntity(where("booking_fee between 1 and 2 or description is initial").model, "ZRT_R_Travel")?.where).toMatchObject({ kind: "or", left: { kind: "and" }, right: { kind: "isInitial", negated: false } });
    expect(where("overall_status in ( 'A' )").diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toContain("CDS001");
    expect(where("nothing = 'X'").diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code} ${d.message}`)).toEqual(["CDS004 ZRT_R_Travel: WHERE: zrt_travel has no element nothing"]);
  });

  it("models the joins of a view entity (D104)", () => {
    const joinView = (join: string) =>
      build({
        "zrt_i_join.ddls.asddls": `define view entity ZRT_I_Join as select from zrt_travel as t ${join} {\n  key b.booking_uuid as BookingUUID,\n  t.travel_id as TravelID,\n  booking_id as BookingID\n}\n`,
        "zrt_ui_travel.srvd.srvdsrv": (c: string) => lf(c).replace("  expose ZRT_C_Booking as Booking;", "  expose ZRT_C_Booking as Booking;\n  expose ZRT_I_Join as Joined;"),
      });
    const ok = joinView("inner join zrt_booking as b on b.parent_uuid = t.travel_uuid");
    expect(ok.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const entity = findEntity(ok.model, "ZRT_I_Join");
    expect(entity?.joins).toMatchObject({ alias: "t", sources: [{ kind: "inner", alias: "b", table: "zrt_booking", on: { kind: "compare", left: { kind: "column", name: "parent_uuid", source: "b" }, right: { kind: "column", name: "travel_uuid" } } }] });
    // a column of the joined source, without its alias when no other source has it
    expect(entity?.fields.find((f) => f.name === "BookingID")?.expression).toMatchObject({ kind: "column", name: "booking_id", source: "b" });
    expect(entity?.fields.find((f) => f.name === "BookingUUID")).toMatchObject({ key: true });
    expect(joinView("right outer join zrt_booking as b on b.parent_uuid = t.travel_uuid").diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toContain("CDS002");
    expect(joinView("inner join zrt_nothing as b on b.x = t.travel_uuid").diagnostics.filter((d) => d.severity === "error").map((d) => d.code)).toContain("CDS003");
  });

  it("checks the aggregate expressions and their GROUP BY as SAP (D105)", () => {
    const stats = (elements: string, groupBy = "group by b.parent_uuid") =>
      build({
        "zrt_i_stats.ddls.asddls": `define view entity ZRT_I_Stats as select from zrt_booking as b {\n  key b.parent_uuid as TravelUUID,\n${elements}\n}\n${groupBy}\n`,
        "zrt_ui_travel.srvd.srvdsrv": (c: string) => lf(c).replace("  expose ZRT_C_Booking as Booking;", "  expose ZRT_C_Booking as Booking;\n  expose ZRT_I_Stats as Stats;"),
      })
        .diagnostics.filter((d) => d.severity === "error")
        .map((d) => `${d.code} ${d.message}`);
    expect(stats("  count(*) as Bookings, max( flight_date ) as LastFlight")).toEqual([]);
    expect(stats("  count(*) as Bookings", "")).toEqual(["CDS022 ZRT_I_Stats: aggregate expressions need a GROUP BY clause listing the other elements"]);
    expect(stats("  booking_id as BookingID,\n  count(*) as Bookings")).toEqual(["CDS022 ZRT_I_Stats.BookingID: not aggregated, so listed in GROUP BY (booking_id)"]);
    expect(stats("  avg( flight_price ) as Average")).toEqual(["CDS022 ZRT_I_Stats.Average: AVG needs the type of its result: AVG( … AS abap.dec(…) )"]);
    expect(stats("  count( carrier_id ) as Carriers")).toEqual(["CDS022 ZRT_I_Stats.Carriers: COUNT counts COUNT(*) rows or COUNT( DISTINCT … ) values"]);
  });

  it("checks the branches of a UNION as SAP (D106)", () => {
    const union = (second: string, annotation = "@Metadata.ignorePropagatedAnnotations: true\n", kind = "union all") =>
      build({
        "zrt_i_union.ddls.asddls": `${annotation}define view entity ZRT_I_Union as select from zrt_travel {\n  key travel_uuid as Id,\n  travel_id as Number\n}\n${kind} select from zrt_booking {\n${second}\n}\n`,
        "zrt_ui_travel.srvd.srvdsrv": (c: string) => lf(c).replace("  expose ZRT_C_Booking as Booking;", "  expose ZRT_C_Booking as Booking;\n  expose ZRT_I_Union as Unioned;"),
      });
    const errors = (r: ReturnType<typeof union>) => r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code} ${d.message}`);
    const ok = union("  key booking_uuid as Id,\n  booking_id as Number");
    expect(errors(ok)).toEqual([]);
    expect(findEntity(ok.model, "ZRT_I_Union")?.union).toMatchObject([{ all: true, branch: { fields: [{ name: "Id", key: true }, { name: "Number" }] } }]);
    expect(errors(union("  key booking_uuid as Id,\n  booking_id as Number", ""))).toEqual(["CDS022 ZRT_I_Union: UNION: a union view needs the annotation @Metadata.ignorePropagatedAnnotations: true"]);
    expect(errors(union("  key booking_uuid as Id,\n  booking_id as Other"))).toEqual(["CDS022 ZRT_I_Union: UNION: branch 2: element 2 is Other, Number in the first SELECT"]);
    expect(errors(union("  booking_uuid as Id,\n  key booking_id as Number"))).toContain("CDS022 ZRT_I_Union: UNION: branch 2: the key elements differ from the first SELECT (Id)");
    expect(errors(union("  key booking_uuid as Id"))).toEqual(["CDS022 ZRT_I_Union: UNION: branch 2 has 1 elements, the first SELECT 2"]);
    expect(errors(union("  key booking_uuid as Id,\n  @EndUserText.label: 'X'\n  booking_id as Number"))).toEqual(["CDS022 ZRT_I_Union: UNION: branch 2: element annotations are allowed in the first SELECT only (Number)"]);
    expect(errors(union("  key booking_uuid as Id,\n  flight_price as Number"))).toEqual(["CDS022 ZRT_I_Union: UNION: branch 2: Number (curr) cannot be merged with numc"]);
  });

  it("checks the CDS hierarchies as SAP (D108)", () => {
    const SOURCE = `define view entity ZRT_I_Bk as select from zrt_booking
  association of many to one ZRT_I_Bk as _Parent on $projection.ParentId = _Parent.Id
{
  key booking_uuid as Id,
  parent_uuid as ParentId,
  booking_id as Number,
  _Parent
}
`;
    const hierarchy = (additions: string, source = "ZRT_I_Bk", association = "_Parent") =>
      build({
        "zrt_i_bk.ddls.asddls": SOURCE,
        "zrt_i_bkhier.ddls.asddls": `define hierarchy ZRT_I_BkHier as parent child hierarchy(\n  source ${source}\n  child to parent association ${association}\n${additions}\n)\n{\n  Id,\n  ParentId,\n  $node.hierarchy_level as HierLevel\n}\n`,
      });
    const errors = (r: ReturnType<typeof hierarchy>) => r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code} ${d.message}`);
    const ok = hierarchy("  start where ParentId is initial\n  siblings order by Number descending");
    expect(errors(ok)).toEqual([]);
    expect(findEntity(ok.model, "ZRT_I_BkHier")).toMatchObject({
      source: "ZRT_I_Bk",
      hierarchy: { association: "_Parent", parent: [{ child: "ParentId", node: "Id" }], siblings: [{ element: "Number", descending: true }], multipleParents: "notAllowed", orphans: "ignore", cycles: "error" },
      fields: [{ name: "Id" }, { name: "ParentId" }, { name: "HierLevel", type: { kind: "int4" }, expression: { kind: "node", attribute: "hierarchy_level" } }],
    });
    // the parent is a UUID: no implicit START WHERE
    expect(errors(hierarchy("  siblings order by Number"))).toEqual(["CDS022 ZRT_I_BkHier: START WHERE is needed: it is implicit only when the parent node is numeric"]);
    expect(errors(hierarchy("  start where ParentId is initial"))).toEqual(["CDS022 ZRT_I_BkHier: SIBLINGS ORDER BY is mandatory in a CDS hierarchy"]);
    expect(errors(hierarchy("  start where ParentId is initial\n  siblings order by Number", "zrt_booking"))).toEqual(["CDS022 ZRT_I_BkHier: the source of a hierarchy must be a CDS view entity, not zrt_booking"]);
    expect(errors(hierarchy("  start where ParentId is initial\n  siblings order by Number", "ZRT_I_Bk", "_Other"))).toEqual(["CDS004 ZRT_I_BkHier: ZRT_I_Bk exposes no association _Other: the hierarchy association must be in its select list"]);
    expect(errors(hierarchy("  start where ParentId is initial\n  siblings order by Number\n  cycles breakup"))).toEqual(["CDS022 ZRT_I_BkHier: CYCLES BREAKUP needs MULTIPLE PARENTS ALLOWED"]);
    expect(errors(hierarchy("  start where ParentId is initial\n  siblings order by Number\n  generate spantree"))).toEqual(["CDS002 ZRT_I_BkHier: GENERATE SPANTREE is not supported yet"]);
  });

  it("checks the parameters of view entities and their actual parameters (D107)", () => {
    const views = (byStatus: string, open: string) =>
      build({
        "zrt_i_bystatus.ddls.asddls": `define view entity ZRT_I_ByStatus\n  with parameters ${byStatus}\n  as select from zrt_travel { key travel_uuid as Id, overall_status as Status }\n  where overall_status = $parameters.p_status\n`,
        "zrt_i_open.ddls.asddls": `define view entity ZRT_I_Open as select from ${open} { key Id }\n`,
        "zrt_ui_travel.srvd.srvdsrv": (c: string) => lf(c).replace("  expose ZRT_C_Booking as Booking;", "  expose ZRT_C_Booking as Booking;\n  expose ZRT_I_ByStatus as ByStatus;\n  expose ZRT_I_Open as Open;"),
      })
        .diagnostics.filter((d) => d.severity === "error")
        .map((d) => `${d.code} ${d.message}`);
    const ok = build({
      "zrt_i_bystatus.ddls.asddls": "define view entity ZRT_I_ByStatus\n  with parameters p_status : abap.char(1)\n  as select from zrt_travel { key travel_uuid as Id }\n  where overall_status = $parameters.p_status\n",
      "zrt_ui_travel.srvd.srvdsrv": (c: string) => lf(c).replace("  expose ZRT_C_Booking as Booking;", "  expose ZRT_C_Booking as Booking;\n  expose ZRT_I_ByStatus as ByStatus;"),
    });
    expect(findEntity(ok.model, "ZRT_I_ByStatus")).toMatchObject({ parameters: [{ name: "p_status", type: { kind: "char", length: 1 } }], where: { right: { kind: "parameter", name: "p_status", setting: "rapt.p_zrt_i_bystatus__p_status" } } });
    expect(views("p_status : abap.char(1)", "ZRT_I_ByStatus( p_status: 'O' )")).toEqual([]);
    expect(views("p_status : abap.char(1)", "ZRT_I_ByStatus")).toEqual(["CDS022 ZRT_I_Open: the parameter p_status of ZRT_I_ByStatus is not given"]);
    expect(views("p_status : abap.char(1)", "ZRT_I_ByStatus( p_other: 'O' )")).toEqual(["CDS004 ZRT_I_Open: ZRT_I_ByStatus has no parameter p_other", "CDS022 ZRT_I_Open: the parameter p_status of ZRT_I_ByStatus is not given"]);
    expect(views("p_status : zunknown", "ZRT_I_ByStatus( p_status: 'O' )")[0]).toMatch(/^CDS014 ZRT_I_ByStatus: parameter p_status: unknown type zunknown/);
  });

  it("reports invalid expressions with CDS022", () => {
    const message = (line: string): string[] =>
      build(withElement(line))
        .diagnostics.filter((d) => d.severity === "error")
        .map((d) => `${d.code} ${d.message}`);
    expect(message("null as Nothing")).toEqual(["CDS022 ZRT_R_Travel.Nothing: the type of NULL cannot be inferred: use CAST( NULL AS type )"]);
    expect(message("description + 1 as Bad")).toEqual(["CDS022 ZRT_R_Travel.Bad: operator + needs numeric operands (char); use CAST or a function"]);
    expect(message("cast( description as zunknown_type ) as Bad")).toEqual([
      "CDS022 ZRT_R_Travel.Bad: unknown type zunknown_type in CAST (a built-in type abap.xxx or a data element of the sources)",
    ]);
    expect(message("$projection.B + 1 as A,\n      $projection.A + 1 as B")).toEqual([
      "CDS022 ZRT_R_Travel.B: circular reference through $projection.A",
      "CDS022 ZRT_R_Travel.A: $projection.B is not a valid element",
    ]);
    const key = build({ [view]: (c) => lf(c).replace("key travel_uuid           as TravelUUID,", "key travel_uuid           as TravelUUID,\n  key concat( travel_id, 'x' ) as CalcKey,") });
    expect(key.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code} ${d.message}`)).toEqual(["CDS022 ZRT_R_Travel.CalcKey: a calculated element cannot be a key element"]);
  });
});
