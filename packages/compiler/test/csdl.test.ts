import { buildODataService, type Model } from "@open-rap-runtime/model";
import { XMLParser } from "fast-xml-parser";
import { beforeAll, describe, expect, it } from "vitest";
import { generateCsdl } from "../src/gen/csdl.js";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";
import { FIXTURE_DIR } from "./helpers.js";

type Node = Record<string, unknown>;
let model: Model;
let xml: string;
let schema: Node;

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

beforeAll(() => {
  const built = buildModel(loadProject(FIXTURE_DIR));
  if (built.model === undefined) {
    throw new Error("no model");
  }
  model = built.model;
  xml = generateCsdl(model);
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", isArray: (name) => ["Annotations", "Annotation", "Property", "NavigationProperty", "EntityType", "EntitySet", "Record", "PropertyValue", "Action", "Parameter", "ComplexType"].includes(name) }).parse(xml) as Node;
  schema = ((doc["edmx:Edmx"] as Node)["edmx:DataServices"] as Node)["Schema"] as Node;
});

function annotationsOf(target: string): Node[] {
  return asArray(schema["Annotations"] as Node[]).filter((a) => a["@Target"] === target).flatMap((a) => asArray(a["Annotation"] as Node[]));
}

describe("CSDL ($metadata)", () => {
  it("matches the reviewed snapshot", async () => {
    await expect(xml).toMatchFileSnapshot("./__snapshots__/travel.metadata.xml");
  });

  it("follows the RAP naming conventions", () => {
    expect(schema["@Namespace"]).toBe("com.sap.gateway.srvd.zrt_ui_travel.v0001");
    expect(schema["@Alias"]).toBe("SAP__self");
    const types = asArray(schema["EntityType"] as Node[]).map((t) => t["@Name"]);
    expect(types).toEqual(["TravelType", "BookingType"]);
    const sets = asArray(((schema["EntityContainer"] as Node)["EntitySet"]) as Node[]).map((s) => [s["@Name"], s["@EntityType"]]);
    expect(sets).toEqual([
      ["Travel", "SAP__self.TravelType"],
      ["Booking", "SAP__self.BookingType"],
    ]);
  });

  it("exposes every projection element with its Edm type", () => {
    const travel = asArray(schema["EntityType"] as Node[]).find((t) => t["@Name"] === "TravelType") as Node;
    const properties = asArray(travel["Property"] as Node[]);
    const entity = model.entities.find((e) => e.name === "ZRT_C_Travel");
    expect(properties.filter((p) => !String(p["@Name"]).startsWith("__")).map((p) => p["@Name"])).toEqual(entity?.fields.map((f) => f.name));
    const byName = (n: string) => properties.find((p) => p["@Name"] === n);
    expect(byName("TravelUUID")).toMatchObject({ "@Type": "Edm.Guid", "@Nullable": "false" });
    expect(byName("TravelID")).toMatchObject({ "@Type": "Edm.String", "@MaxLength": "8" });
    expect(byName("BookingFee")).toMatchObject({ "@Type": "Edm.Decimal", "@Precision": "16", "@Scale": "2" });
    expect(byName("BeginDate")).toMatchObject({ "@Type": "Edm.Date" });
    expect(byName("BeginDate")?.["@Nullable"]).toBeUndefined();
    expect(byName("LocalLastChangedAt")).toMatchObject({ "@Type": "Edm.DateTimeOffset", "@Precision": "7" });
    expect(byName("__OperationControl")).toMatchObject({ "@Type": "SAP__self.TravelOperationControl" });
  });

  it("links the composition both ways", () => {
    const types = asArray(schema["EntityType"] as Node[]);
    const travelNav = asArray((types[0] as Node)["NavigationProperty"] as Node[])[0];
    const bookingNav = asArray((types[1] as Node)["NavigationProperty"] as Node[])[0];
    expect(travelNav).toMatchObject({ "@Name": "_Booking", "@Type": "Collection(SAP__self.BookingType)", "@Partner": "_Travel" });
    expect(bookingNav).toMatchObject({ "@Name": "_Travel", "@Type": "SAP__self.TravelType", "@Nullable": "false", "@Partner": "_Booking" });
    expect(bookingNav?.["ReferentialConstraint"]).toMatchObject({ "@Property": "TravelUUID", "@ReferencedProperty": "TravelUUID" });
  });

  it("declares the bound action with dynamic availability", () => {
    const [action] = asArray(schema["Action"] as Node[]);
    expect(action).toMatchObject({ "@Name": "acceptTravel", "@IsBound": "true", "@EntitySetPath": "_it" });
    expect(asArray(action?.["Parameter"] as Node[])[0]).toMatchObject({ "@Name": "_it", "@Type": "SAP__self.TravelType" });
    expect(action?.["ReturnType"]).toMatchObject({ "@Type": "SAP__self.TravelType" });
    expect(annotationsOf("SAP__self.acceptTravel(SAP__self.TravelType)")).toEqual([{ "@Term": "Core.OperationAvailable", "@Path": "_it/__OperationControl/acceptTravel" }]);
    expect(xml).not.toContain("reCalcTotalPrice");
  });

  it("annotates fields from the BDEF field characteristics and the CDS annotations", () => {
    const terms = (property: string) => annotationsOf(`SAP__self.TravelType/${property}`).map((a) => a["@Term"]);
    expect(terms("TravelUUID")).toEqual(["Common.Label", "Core.Computed", "UI.Hidden"]);
    expect(terms("OverallStatus")).toEqual(["Common.Label", "Core.Computed"]);
    expect(annotationsOf("SAP__self.TravelType/TravelID")).toContainEqual({ "@Term": "Common.FieldControl", "@EnumMember": "Common.FieldControlType/Mandatory" });
    expect(annotationsOf("SAP__self.TravelType/BookingFee")).toContainEqual({ "@Term": "Measures.ISOCurrency", "@Path": "CurrencyCode" });
    expect(terms("CurrencyCode")).toContain("Common.IsCurrency");
  });

  it("generates the UI annotations of the List Report and Object Page", () => {
    const terms = annotationsOf("SAP__self.TravelType").map((a) => `${String(a["@Term"])}${a["@Qualifier"] ? `#${String(a["@Qualifier"])}` : ""}`);
    expect(terms).toEqual([
      "UI.HeaderInfo",
      "UI.LineItem",
      "UI.Identification",
      "UI.SelectionFields",
      "UI.FieldGroup#Dates",
      "UI.FieldGroup#Prices",
      "UI.Facets",
      "UI.PresentationVariant",
      "Common.Label",
    ]);
    const selection = annotationsOf("SAP__self.TravelType").find((a) => a["@Term"] === "UI.SelectionFields") as Node;
    expect((selection["Collection"] as Node)["PropertyPath"]).toEqual(["TravelID", "AgencyID", "CustomerID", "OverallStatus"]);
    expect(xml).toContain('<PropertyValue Property="Action" String="com.sap.gateway.srvd.zrt_ui_travel.v0001.acceptTravel"/>');
    expect(xml).toContain('<PropertyValue Property="Target" AnnotationPath="_Booking/@UI.LineItem"/>');
  });

  it("derives the capabilities of the entity sets from the projection BDEF", () => {
    const service = buildODataService(model);
    expect(service.entitySets.map((s) => [s.name, s.insertable, s.updatable, s.deletable, s.searchable])).toEqual([
      ["Travel", true, true, true, true],
      ["Booking", false, true, true, false],
    ]);
    expect(service.entityTypes[0]?.navigations[0]).toMatchObject({ name: "_Booking", insertable: true, collection: true });
    expect(service.entityTypes.map((t) => t.etag)).toEqual(["LocalLastChangedAt", "LocalLastChangedAt"]);
    expect(annotationsOf("SAP__self.Container/Booking").map((a) => a["@Term"])).toContain("Core.OptimisticConcurrency");
  });
});
