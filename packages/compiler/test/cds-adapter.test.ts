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
    expect(travel.annotations).toEqual({ accesscontrol: { authorizationcheck: "#CHECK" }, endusertext: { label: "Travel" } });
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

  it("parses the expressions of the select list into a tree (D64)", () => {
    const source = [
      "define view entity ZX_Expr as select from zrt_travel as t {",
      "  key t.travel_uuid as TravelUUID,",
      "  t.booking_fee + t.total_price * 2 as Total,",
      "  ( t.booking_fee - t.total_price ) / 3 as Ratio,",
      "  - t.booking_fee as Negative,",
      "  'abc' as Text,",
      "  abap.char'X' as Flag,",
      "  1.5 as Decimal,",
      "  concat_with_space( t.description, t.agency_id, 1 ) as Label,",
      "  cast( t.total_price as abap.dec( 10, 2 ) ) as Price,",
      "  case t.overall_status when 'A' then 'Accepted' else 'Other' end as StatusText,",
      "  case when t.total_price >= 100 and not ( t.description is null or t.booking_fee <> 0 ) then 1 else 0 end as Big,",
      "  $session.system_date as Today,",
      "  count( * ) as Bad",
      "}",
    ].join("\n");
    const result = parseCds("zx_expr.ddls.asddls", source);
    if (!result.ok || !("entity" in result)) {
      throw new Error("not an entity");
    }
    const byName = new Map(result.entity.elements.map((e) => [e.name, e]));
    const path = (...p: string[]): unknown => ({ kind: "path", path: ["t", ...p] });
    expect(byName.get("Total")?.expr).toEqual({
      kind: "arithmetic",
      operator: "+",
      left: path("booking_fee"),
      right: { kind: "arithmetic", operator: "*", left: path("total_price"), right: { kind: "literal", value: 2, text: "2" } },
    });
    expect(byName.get("Ratio")?.expr).toMatchObject({
      operator: "/",
      left: { kind: "arithmetic", operator: "-", left: path("booking_fee"), right: path("total_price") },
      right: { kind: "literal", value: 3 },
    });
    expect(byName.get("Negative")?.expr).toEqual({ kind: "negate", operand: path("booking_fee") });
    expect(byName.get("Text")?.expr).toEqual({ kind: "literal", value: "abc", text: "'abc'" });
    expect(byName.get("Flag")?.expr).toMatchObject({ kind: "literal", value: "X", typed: "abap.char" });
    expect(byName.get("Decimal")?.expr).toMatchObject({ kind: "literal", value: 1.5 });
    expect(byName.get("Label")?.expr).toEqual({
      kind: "function",
      name: "concat_with_space",
      args: [path("description"), path("agency_id"), { kind: "literal", value: 1, text: "1" }],
    });
    expect(byName.get("Price")?.expr).toEqual({ kind: "cast", operand: path("total_price"), type: "abap.dec(10,2)" });
    expect(byName.get("StatusText")?.expr).toMatchObject({
      kind: "case",
      operand: path("overall_status"),
      branches: [{ when: { kind: "literal", value: "A" }, then: { kind: "literal", value: "Accepted" } }],
      else: { kind: "literal", value: "Other" },
    });
    expect(byName.get("Big")?.expr).toMatchObject({
      kind: "case",
      branches: [
        {
          when: {
            kind: "and",
            left: { kind: "compare", operator: ">=", left: path("total_price"), right: { kind: "literal", value: 100 } },
            right: {
              kind: "not",
              operand: {
                kind: "or",
                left: { kind: "isNull", operand: path("description"), negated: false },
                right: { kind: "compare", operator: "<>", left: path("booking_fee"), right: { kind: "literal", value: 0 } },
              },
            },
          },
          then: { kind: "literal", value: 1 },
        },
      ],
      else: { kind: "literal", value: 0 },
    });
    expect(byName.get("Today")?.expr).toEqual({ kind: "path", path: ["$session", "system_date"] });
    expect(byName.get("Bad")?.expr).toBeUndefined();
    expect(byName.get("Bad")?.expressionError).toContain("aggregate");
  });
});
