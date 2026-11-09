import { describe, expect, it } from "vitest";
import { parseCds, type CdsEntityAst, type CdsMetadataExtensionAst } from "../src/cds/adapter.js";
import { readFixture } from "./helpers.js";

function entity(file: string): CdsEntityAst {
  const result = parseCds(file, readFixture(file));
  if (!result.ok || !("entity" in result)) {
    throw new Error(`${file} is not an entity`);
  }
  return result.entity;
}

describe("CDS adapter over abaplint", () => {
  it("reads a root view entity with a composition", () => {
    const travel = entity("zrt_r_travel.ddls.asddls");
    expect(travel).toMatchObject({ kind: "view", name: "ZRT_R_Travel", root: true, source: "zrt_travel", hasJoin: false, hasWhere: false });
    expect(travel.annotations).toEqual({ accesscontrol: { authorizationcheck: "#NOT_REQUIRED" }, endusertext: { label: "Travel" } });
    expect(travel.associations).toEqual([
      { kind: "composition", target: "ZRT_R_Booking", alias: "_Booking", cardinality: { min: 0, max: "*" }, on: [], loc: expect.anything() },
    ]);
    expect(travel.elements.map((e) => [e.name, e.key, e.path])).toEqual([
      ["TravelUUID", true, ["travel_uuid"]],
      ["TravelID", false, ["travel_id"]],
      ["AgencyID", false, ["agency_id"]],
      ["CustomerID", false, ["customer_id"]],
      ["BeginDate", false, ["begin_date"]],
      ["EndDate", false, ["end_date"]],
      ["BookingFee", false, ["booking_fee"]],
      ["TotalPrice", false, ["total_price"]],
      ["CurrencyCode", false, ["currency_code"]],
      ["Description", false, ["description"]],
      ["OverallStatus", false, ["overall_status"]],
      ["CreatedBy", false, ["created_by"]],
      ["CreatedAt", false, ["created_at"]],
      ["LastChangedBy", false, ["last_changed_by"]],
      ["LastChangedAt", false, ["last_changed_at"]],
      ["LocalLastChangedAt", false, ["local_last_changed_at"]],
      ["_Booking", false, ["_Booking"]],
    ]);
    expect(travel.elements[6]?.annotations).toEqual({ endusertext: { label: "Booking Fee" }, semantics: { amount: { currencycode: "CurrencyCode" } } });
    expect(travel.elements[1]?.loc).toEqual({ line: 10, column: 7 });
  });

  it("reads an association to parent and its ON condition", () => {
    const booking = entity("zrt_r_booking.ddls.asddls");
    expect(booking.associations).toEqual([
      {
        kind: "toParent",
        target: "ZRT_R_Travel",
        alias: "_Travel",
        cardinality: { min: 1, max: 1 },
        on: [{ left: ["$projection", "TravelUUID"], right: ["_Travel", "TravelUUID"] }],
        loc: expect.anything(),
      },
    ]);
  });

  it("reads projections with provider contract and redirections", () => {
    const travel = entity("zrt_c_travel.ddls.asddls");
    expect(travel).toMatchObject({ kind: "projection", root: true, source: "ZRT_R_Travel", providerContract: "transactional_query" });
    expect(travel.elements.at(-1)).toMatchObject({ name: "_Booking", redirect: { kind: "compositionChild", target: "ZRT_C_Booking" } });
    expect(travel.elements[1]?.annotations).toEqual({ search: { defaultsearchelement: true } });
    const booking = entity("zrt_c_booking.ddls.asddls");
    expect(booking.elements.at(-1)).toMatchObject({ name: "_Travel", redirect: { kind: "parent", target: "ZRT_C_Travel" } });
  });

  it("reads metadata extensions, with nested annotation objects and arrays", () => {
    const result = parseCds("zrt_c_travel.ddlx.asddlxs", readFixture("zrt_c_travel.ddlx.asddlxs"));
    if (!result.ok || !("extension" in result)) {
      throw new Error("not a metadata extension");
    }
    const extension: CdsMetadataExtensionAst = result.extension;
    expect(extension.entity).toBe("ZRT_C_Travel");
    expect(extension.layer).toBe("#CORE");
    expect(extension.annotations["ui"]).toMatchObject({
      headerinfo: { typename: "Travel", typenameplural: "Travels", title: { type: "#STANDARD", value: "TravelID" } },
      presentationvariant: [{ sortorder: [{ by: "TravelID", direction: "#DESC" }] }],
    });
    const status = extension.elements.find((e) => e.name === "OverallStatus");
    expect(status?.annotations).toEqual({
      ui: {
        lineitem: [
          { position: 70, importance: "#HIGH" },
          { type: "#FOR_ACTION", dataaction: "acceptTravel", label: "Accept Travel" },
          { type: "#FOR_ACTION", dataaction: "copyTravel", label: "Copy Travel" },
        ],
        identification: [
          { position: 50 },
          { type: "#FOR_ACTION", dataaction: "acceptTravel", label: "Accept Travel" },
          { type: "#FOR_ACTION", dataaction: "deductDiscount", label: "Deduct Discount" },
          { type: "#FOR_ACTION", dataaction: "copyTravel", label: "Copy Travel" },
        ],
        selectionfield: [{ position: 40 }],
      },
    });
    expect(extension.elements.find((e) => e.name === "TravelUUID")?.annotations["ui"]).toMatchObject({ hidden: true, facet: expect.any(Array) });
  });

  it("reads abstract entities and reports unparsable sources", () => {
    const result = parseCds("za_param.ddls.asddls", "@EndUserText.label: 'Param'\ndefine abstract entity ZA_Param\n{\n  discount_percent : abap.int1;\n  key reason : abap.char( 30 );\n}");
    expect(result.ok && "entity" in result && result.entity.elements.map((e) => [e.name, e.key, e.declaredType])).toEqual([
      ["discount_percent", false, "abap.int1"],
      ["reason", true, "abap.char(30)"],
    ]);
    expect(parseCds("zbroken.ddls.asddls", "define view entity { }").ok).toBe(false);
  });
});
