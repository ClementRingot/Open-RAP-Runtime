import { findEntity, findEntityBehavior, getAnnotation, type Model } from "@open-rap-runtime/model";
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
    expect(message("$session.user as CurrentUser")).toEqual([
      "CDS002 ZRT_R_Travel.CurrentUser: session variable $session.user is not supported (the SQL views have no session of the request; only $session.system_date)",
    ]);
    expect(message("concat( _Booking.BookingID, 'x' ) as FirstBooking")).toEqual(["CDS002 ZRT_R_Travel.FirstBooking: path expressions (_Booking.BookingID) are not supported yet"]);
    expect(message("count( * ) as Bookings")).toEqual(["CDS002 ZRT_R_Travel.Bookings: aggregate functions (count ( * )) is not supported yet"]);
    expect(message("instr( description, 'a' ) as Position")).toEqual(["CDS002 ZRT_R_Travel.Position: the SQL function INSTR is not supported yet"]);
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
