import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { buildUiLayout, generateUi } from "../src/gen/ui/index.js";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";
import { FIXTURE_DIR } from "./helpers.js";

function fixture() {
  const { model } = buildModel(loadProject(FIXTURE_DIR));
  if (model === undefined) {
    throw new Error("the fixture does not build");
  }
  return model;
}

describe("UI layout from the UI annotations", () => {
  const layout = buildUiLayout(fixture());
  const travel = layout.pages.find((p) => p.set === "Travel");
  const booking = layout.pages.find((p) => p.set === "Booking");

  it("starts with the List Report of the root entity set", () => {
    expect(layout).toMatchObject({ title: "Travels", start: "Travel", servicePath: "/sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001/" });
    expect(booking?.list).toBeUndefined();
  });

  it("takes the columns, table actions and sort order of the line items", () => {
    expect(travel?.list?.table.columns.map((c) => c.property)).toEqual(["TravelID", "AgencyID", "CustomerID", "BeginDate", "EndDate", "TotalPrice", "OverallStatus"]);
    expect(travel?.list?.table.actions.map((a) => a.name)).toEqual(["acceptTravel", "copyTravel"]);
    expect(travel?.list?.table.orderby).toBe("TravelID desc");
    expect(travel?.list?.table.columns.find((c) => c.property === "TotalPrice")).toMatchObject({ kind: "amount", unit: "CurrencyCode", computed: true });
    expect(travel?.list?.selectionFields.map((f) => f.property)).toEqual(["TravelID", "AgencyID", "CustomerID", "OverallStatus"]);
  });

  it("builds the Object Page from the header info and the facets", () => {
    expect(travel).toMatchObject({ typeName: "Travel", title: "TravelID", description: "Description", updatable: true, deletable: true, insertable: true });
    expect(travel?.sections.map((s) => [s.id, s.kind])).toEqual([
      ["Travel", "form"],
      ["Dates", "form"],
      ["Prices", "form"],
      ["Booking", "table"],
    ]);
    const bookings = travel?.sections.find((s) => s.kind === "table");
    expect(bookings?.kind === "table" ? bookings.table : undefined).toMatchObject({ set: "Booking", navigation: "_Booking", insertable: true });
    expect(travel?.actions.map((a) => [a.name, a.dynamic, a.factory])).toEqual([
      ["acceptTravel", true, false],
      ["deductDiscount", false, false],
      ["copyTravel", false, true],
    ]);
    expect(travel?.actions[1]?.parameters).toEqual([{ name: "DiscountPercent", label: "Discount (%)", kind: "integer", edm: "Edm.Byte" }]);
  });

  it("knows which fields are editable", () => {
    expect(travel?.fields["TravelUUID"]).toMatchObject({ computed: true, key: true });
    expect(travel?.fields["OverallStatus"]).toMatchObject({ computed: true });
    expect(travel?.fields["TravelID"]).toMatchObject({ computed: false, mandatory: true, kind: "digits" });
    expect(travel?.fields["CreatedBy"]).toMatchObject({ computed: true });
  });
});

describe("UI files", () => {
  const files = generateUi(fixture());
  const file = (path: string): string => files.find((f) => f.path === path)?.content ?? "";

  it("writes well-formed views", () => {
    for (const view of files.filter((f) => f.path.endsWith(".xml"))) {
      expect(XMLValidator.validate(view.content), view.path).toBe(true);
    }
    expect(file("view/TravelList.view.xml")).toContain("items=\"{path: '/Travel', parameters: {$count: true, $orderby: 'TravelID desc'}}\"");
    expect(file("view/TravelObject.view.xml")).toContain("enabled=\"{= ${__OperationControl/acceptTravel} !== false &amp;&amp; !${ui&gt;/editMode} }\"");
  });

  it("routes the List Report and the Object Pages", () => {
    const manifest = JSON.parse(file("manifest.json")) as { "sap.ui5": { routing: { routes: Array<{ pattern: string; name: string }> } } };
    expect(manifest["sap.ui5"].routing.routes.map((r) => [r.pattern, r.name])).toEqual([
      ["", "TravelList"],
      ["Travel/new", "TravelNew"],
      ["Travel({key})", "TravelObject"],
      ["Booking({key})", "BookingObject"],
    ]);
  });
});
