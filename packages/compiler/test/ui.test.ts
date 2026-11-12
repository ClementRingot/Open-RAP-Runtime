import { XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { buildUiLayout, generateUi, type UiLayout } from "../src/gen/ui/index.js";
import type { Model } from "@open-rap/model";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";
import { FIXTURE_DIR, fixtureVariant } from "./helpers.js";

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
      ["deductDiscount", true, false],
      ["copyTravel", true, true],
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
    expect(file("view/TravelObject.view.xml")).toContain("enabled=\"{= %{__OperationControl/acceptTravel} !== false &amp;&amp; !${ui&gt;/editMode} }\"");
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

describe("filter conditions of the list report (controller/filters.js)", () => {
  // the module runs with stubs of sap.ui.define and of the filters of OpenUI5
  class Filter {
    public constructor(public readonly spec: unknown, operator?: string, value1?: unknown) {
      if (typeof spec === "string") this.spec = { path: spec, operator, value1 };
    }
  }
  const FilterOperator = Object.fromEntries(
    ["EQ", "NE", "GT", "GE", "LT", "LE", "BT", "NB", "Contains", "StartsWith", "EndsWith", "NotContains", "NotStartsWith", "NotEndsWith"].map((o) => [o, o]),
  );
  let filters: {
    parse(field: object, text: string): { op: string; values: string[] } | null;
    text(condition: object): string;
    display(field: object, condition: object, description?: string): string;
    operators(field: object): string[];
    condition(field: object, op: string, values: string[]): { op: string; values: string[] } | null;
    filter(field: object, condition: object): Filter;
    fieldFilter(field: object, conditions: object[]): Filter | null;
    toOData(filter: Filter, fields: object): string;
  } = undefined as never;
  const source = generateUi(fixture()).find((f) => f.path === "controller/filters.js")?.content ?? "";
  new Function("sap", source)({ ui: { define: (_deps: string[], factory: (...args: unknown[]) => typeof filters) => (filters = factory(Filter, FilterOperator)) } });
  const text = { property: "Description", kind: "text" };
  const digits = { property: "TravelID", kind: "digits", maxLength: 8 };
  const amount = { property: "TotalPrice", kind: "amount" };

  it("reads the conditions written as in SAP Fiori", () => {
    expect(filters.parse(text, "Rome")).toEqual({ op: "Contains", values: ["Rome"] });
    expect(filters.parse(text, "=Rome")).toEqual({ op: "EQ", values: ["Rome"] });
    expect(filters.parse(text, "Ro*")).toEqual({ op: "StartsWith", values: ["Ro"] });
    expect(filters.parse(text, "*me")).toEqual({ op: "EndsWith", values: ["me"] });
    expect(filters.parse(digits, "3")).toEqual({ op: "EQ", values: ["3"] });
    expect(filters.parse(digits, "2...5")).toEqual({ op: "BT", values: ["2", "5"] });
    expect(filters.parse(amount, ">=100.5")).toEqual({ op: "GE", values: ["100.5"] });
    expect(filters.parse(amount, "!=0")).toEqual({ op: "NE", values: ["0"] });
    expect(filters.parse(amount, "abc")).toBeNull();
    expect(filters.parse(digits, "123456789")).toBeNull();
    for (const t of ["=Rome", "*Rome*", "Ro*", "2...5", ">=100.5", "!=0"]) {
      const field = /\d/.test(t) ? amount : text;
      expect(filters.text(filters.parse(field, t) as object)).toBe(t);
    }
  });

  it("pads the digit sequences and combines the conditions of a field", () => {
    const single = filters.fieldFilter(digits, [{ op: "EQ", values: ["3"] }]);
    expect(single?.spec).toMatchObject({ path: "TravelID", operator: "EQ", value1: "00000003" });
    const combined = filters.fieldFilter(amount, [
      { op: "GT", values: ["10"] },
      { op: "LT", values: ["1"] },
      { op: "NE", values: ["500"] },
    ]);
    // included values or'ed, exclusions and'ed
    expect(combined?.spec).toMatchObject({ and: true });
    const parts = (combined?.spec as { filters: Filter[] }).filters;
    expect((parts[0]?.spec as { and: boolean }).and).toBe(false);
    expect(parts[1]?.spec).toMatchObject({ operator: "NE", value1: "500" });
  });

  it("reads the exclusions and the empty values, and writes the tokens as SAP Fiori elements (D68)", () => {
    const code = { property: "AgencyID", kind: "digits", maxLength: 6, valueHelp: {} };
    expect(filters.parse(code, "70002")).toEqual({ op: "EQ", values: ["70002"] });
    expect(filters.parse(text, "!(*Rome*)")).toEqual({ op: "NotContains", values: ["Rome"] });
    expect(filters.parse(digits, "!(2...5)")).toEqual({ op: "NB", values: ["2", "5"] });
    expect(filters.parse(amount, "!(<10)")).toEqual({ op: "NOTLT", values: ["10"] });
    expect(filters.parse(text, "<empty>")).toEqual({ op: "Empty", values: [] });
    expect(filters.parse(text, "!(<empty>)")).toEqual({ op: "NotEmpty", values: [] });
    expect(filters.parse(amount, "*5*")).toBeNull();
    for (const t of ["!(*Rome*)", "!(Ro*)", "<empty>", "!(<empty>)"]) expect(filters.text(filters.parse(text, t) as object)).toBe(t);
    expect(filters.display(code, { op: "EQ", values: ["70002"] }, "Sunshine Travel")).toBe("Sunshine Travel (70002)");
    expect(filters.display(text, { op: "NE", values: ["Rome"] })).toBe("!(=Rome)");
    expect(filters.display(text, { op: "Contains", values: ["Rome"] })).toBe("*Rome*");
  });

  it("offers the operators of the type and of @Consumption.filter.selectionType", () => {
    expect(filters.operators(text)).toEqual(expect.arrayContaining(["Contains", "NotContains", "Empty", "NotEmpty", "BT", "NB"]));
    expect(filters.operators(amount)).not.toContain("Contains");
    expect(filters.operators({ kind: "boolean" })).toEqual(["EQ"]);
    expect(filters.operators({ ...text, filter: { expressions: "SingleValue" } })).toEqual(["EQ"]);
    expect(filters.operators({ ...text, filter: { expressions: "SingleRange" } })).toEqual(["EQ", "BT", "LT", "LE", "GT", "GE"]);
    expect(filters.condition(amount, "Contains", ["5"])).toBeNull();
    expect(filters.condition(amount, "BT", ["1", ""])).toBeNull();
    expect(filters.condition({ property: "BeginDate", kind: "date" }, "BT", ["2026-06-01", "2026-02-30"])).toBeNull();
    expect(filters.condition({ property: "BeginDate", kind: "date" }, "BT", ["2026-06-01", "2026-06-30"])).toEqual({ op: "BT", values: ["2026-06-01", "2026-06-30"] });
  });

  it("filters dates by range, date-times by whole days, and empty values", () => {
    const date = { property: "BeginDate", kind: "date", edm: "Edm.Date" };
    expect(filters.filter(date, filters.parse(date, "2026-06-01...2026-06-30") as object).spec).toMatchObject({ operator: "BT", value1: "2026-06-01", value2: "2026-06-30" });
    const day = filters.filter({ property: "CreatedAt", kind: "datetime" }, { op: "EQ", values: ["2026-12-31"] }).spec as { filters: Filter[] };
    expect(day.filters.map((f) => f.spec)).toEqual([
      { path: "CreatedAt", operator: "GE", value1: "2026-12-31T00:00:00Z" },
      { path: "CreatedAt", operator: "LT", value1: "2027-01-01T00:00:00Z" },
    ]);
    // not less than 10: 10 or more
    expect(filters.filter(amount, { op: "NOTLT", values: ["10"] }).spec).toMatchObject({ operator: "GE", value1: "10" });
    const fields = { Description: { edm: "Edm.String" }, TotalPrice: { edm: "Edm.Decimal" } };
    const odata = (field: object, t: string): string => filters.toOData(filters.fieldFilter(field, [filters.parse(field, t) as object]) as Filter, fields);
    expect(odata({ ...text, edm: "Edm.String" }, "<empty>")).toBe("(Description eq '' or Description eq null)");
    expect(odata({ ...text, edm: "Edm.String" }, "!(*Ro*)")).toBe("not contains(tolower(Description),tolower('Ro'))");
    expect(odata(amount, "!(1...5)")).toBe("(TotalPrice lt 1 or TotalPrice gt 5)");
  });
});

describe("floorplans (D53)", () => {
  const variant = (ddlx: (c: string) => string, ui: Model["ui"]): UiLayout => {
    const { dir, cleanup } = fixtureVariant({ "zrt_c_travel.ddlx.asddlxs": ddlx });
    try {
      const { model } = buildModel(loadProject(dir));
      return buildUiLayout({ ...(model as Model), ...(ui === undefined ? {} : { ui }) });
    } finally {
      cleanup();
    }
  };
  const annotations = (c: string): string =>
    c.replace(
      "@UI.presentationVariant:",
      "@UI.chart: [ { qualifier: 'ByCurrency', chartType: #DONUT, dimensions: [ 'CurrencyCode' ], measures: [ 'TotalPrice' ] } ]\n@UI.selectionVariant: [ { qualifier: 'open', text: 'Open', filter: 'OverallStatus EQ ''O'' AND TotalPrice GT 100' } ]\n@UI.presentationVariant:",
    );

  it("reads the charts and the selection variants", () => {
    const travel = variant(annotations, { floorplans: { Travel: "analyticalListPage" } }).pages.find((p) => p.set === "Travel");
    expect(travel?.floorplan).toBe("analyticalListPage");
    expect(travel?.charts).toEqual([{ qualifier: "ByCurrency", title: "Total Price", type: "donut", dimension: { property: "CurrencyCode", label: "Currency", kind: "text" }, measures: [{ property: "TotalPrice", label: "Total Price", aggregation: "sum" }] }]);
    expect(travel?.selectionVariants).toEqual([{ key: "open", text: "Open", filter: "OverallStatus eq 'O' and TotalPrice gt 100" }]);
  });

  it("routes the start page to the overview or to the form", () => {
    const overviewModel = { ...fixture(), ui: { overview: { title: "Home", cards: [{ type: "list" as const, entitySet: "Travel", title: "Travels" }] } } };
    const routes = (model: Model): Array<[string, string]> =>
      (JSON.parse(generateUi(model).find((f) => f.path === "manifest.json")?.content ?? "{}") as { "sap.ui5": { routing: { routes: Array<{ pattern: string; name: string }> } } })["sap.ui5"].routing.routes.map((r) => [r.pattern, r.name]);
    expect(routes(overviewModel).slice(0, 2)).toEqual([["", "Overview"], ["Travel", "TravelList"]]);
    expect(generateUi(overviewModel).map((f) => f.path)).toContain("view/Overview.view.xml");
    expect(routes({ ...fixture(), ui: { floorplans: { Travel: "formEntry" } } }).slice(0, 2)).toEqual([["", "TravelFormEntry"], ["Travel", "TravelList"]]);
    for (const view of generateUi(overviewModel).filter((f) => f.path.endsWith(".xml"))) {
      expect(XMLValidator.validate(view.content), view.path).toBe(true);
    }
  });
});
