import { describe, expect, it } from "vitest";
import {
  defaultServicePath,
  derivedType,
  derivedTypesInterfaceName,
  edmTypeOf,
  getAnnotation,
  mergeAnnotations,
  serviceNamespace,
  setAnnotation,
  type Annotations,
} from "../src/index.js";

describe("annotations", () => {
  it("are read case-insensitively by dotted path", () => {
    const a: Annotations = {};
    setAnnotation(a, "UI.headerInfo.typeName", "Travel");
    expect(a).toEqual({ ui: { headerinfo: { typename: "Travel" } } });
    expect(getAnnotation(a, "ui.HEADERINFO.TypeName")).toBe("Travel");
    expect(getAnnotation(a, "UI.lineItem")).toBeUndefined();
  });

  it("merge leaf by leaf, arrays being leaves, later layers winning", () => {
    const view = { endusertext: { label: "From view" }, ui: { lineitem: [{ position: 10 }], hidden: false } };
    const extension = { ui: { lineitem: [{ position: 20 }, { position: 30 }], identification: [{ position: 1 }] } };
    expect(mergeAnnotations(view, extension)).toEqual({
      endusertext: { label: "From view" },
      ui: { lineitem: [{ position: 20 }, { position: 30 }], hidden: false, identification: [{ position: 1 }] },
    });
    expect(mergeAnnotations({ ui: { headerinfo: { typename: "A", title: { value: "X" } } } }, { ui: { headerinfo: { title: { value: "Y" } } } })).toEqual({
      ui: { headerinfo: { typename: "A", title: { value: "Y" } } },
    });
  });
});

describe("Edm types follow the RAP conventions", () => {
  it.each([
    [{ kind: "char", length: 10 }, { type: "Edm.String", maxLength: 10 }],
    [{ kind: "numc", length: 8 }, { type: "Edm.String", maxLength: 8, digitSequence: true }],
    [{ kind: "raw", length: 16 }, { type: "Edm.Guid" }],
    [{ kind: "curr", length: 16, decimals: 2 }, { type: "Edm.Decimal", precision: 16, scale: 2 }],
    [{ kind: "dats", length: 8 }, { type: "Edm.Date" }],
    [{ kind: "timestampl", length: 21, decimals: 7 }, { type: "Edm.DateTimeOffset", precision: 7 }],
    [{ kind: "bool", length: 1 }, { type: "Edm.Boolean" }],
    [{ kind: "int8" }, { type: "Edm.Int64" }],
  ] as const)("%j", (abap, edm) => {
    expect(edmTypeOf(abap)).toEqual(edm);
  });
});

describe("naming", () => {
  it("keeps generated ABAP names within 30 characters", () => {
    expect(derivedTypesInterfaceName("ZRT_R_TRAVEL")).toBe("ZRAP_DT_ZRT_R_TRAVEL");
    expect(derivedTypesInterfaceName("/DMO/I_TRAVEL_M")).toMatch(/^ZRAP_DT_[0-9A-F]{8}$/);
    expect(derivedTypesInterfaceName("ZR_A_VERY_LONG_BEHAVIOR_NAME_X")).toHaveLength(16);
    expect(derivedType.assocReadResult(99, 99).length).toBeLessThanOrEqual(30);
    expect(derivedType.instanceFeaturesResult(99).length).toBeLessThanOrEqual(30);
  });

  it("builds the RAP service path and namespace", () => {
    expect(defaultServicePath("ZUI_TRAVEL_O4", "ZUI_TRAVEL", "0001")).toBe("/sap/opu/odata4/sap/zui_travel_o4/srvd/sap/zui_travel/0001/");
    expect(serviceNamespace("ZUI_TRAVEL", "0001")).toBe("com.sap.gateway.srvd.zui_travel.v0001");
  });
});
