import { findEntity, findEntityBehavior, getAnnotation, type Model } from "@rap-transpiler/model";
import { afterEach, describe, expect, it } from "vitest";
import { formatDiagnostic, type Diagnostic } from "../src/diagnostics.js";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";
import { FIXTURE_DIR, fixtureVariant } from "./helpers.js";

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

  it("rejects draft", () => {
    const items = diagnosticsOf({ [bdef]: (c) => c.replace("strict ( 2 );", "strict ( 2 );\nwith draft;") });
    expect(items).toContainEqual(expect.objectContaining({ code: "BDEF002", message: "draft (with draft) is out of scope", line: 3 }));
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
