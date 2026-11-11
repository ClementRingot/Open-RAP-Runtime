/** Standard views of SAP (D44): added when named, never written by rapt abapgit, overridable. */

import { describe, expect, it } from "vitest";
import { generateAbapGitFiles } from "../src/authoring/abapgit.js";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";
import { standardObjectsFor, standardRows, STANDARD_VIEW_NAMES } from "../src/standard/index.js";
import { fixtureVariant } from "./helpers.js";

describe("standard views", () => {
  it("adds only the views the sources name, with what they need", () => {
    const names = standardObjectsFor([{ type: "DDLS", name: "ZX", content: "association to i_unitofmeasure as _Unit on ..." }]).map((o) => o.name);
    expect(names).toEqual(["RAPT_UOM", "RAPT_UOMT", "I_UNITOFMEASURE", "I_UNITOFMEASURETEXT"]);
    expect(standardObjectsFor([{ type: "DDLS", name: "ZX", content: "define view entity ZX as select from zt { key a }" }])).toEqual([]);
    // a view defined by the project wins
    const own = standardObjectsFor([
      { type: "DDLS", name: "ZX", content: "association to I_Language as _L" },
      { type: "DDLS", name: "I_LANGUAGE", content: "define view entity I_Language ..." },
    ]);
    expect(own).toEqual([]);
    expect(STANDARD_VIEW_NAMES).toContain("I_CURRENCY");
  });

  it("delivers the reference data", () => {
    expect(standardRows("rapt_currency")).toContainEqual({ waers: "JPY", isocd: "JPY", altwr: "000", currdec: 0 });
    expect(standardRows("rapt_countryt")).toContainEqual({ spras: "E", land1: "FR", landx50: "France", landx: "France" });
    expect(standardRows("rapt_uom").map((r) => r["msehi"])).toContain("KG");
    expect(standardRows("rapt_language").map((r) => r["spras"])).toEqual(expect.arrayContaining(["E", "D", "F"]));
  });

  it("builds a value help on a standard view without diagnostics; rapt abapgit leaves it out", () => {
    const variant = fixtureVariant({
      "zrt_c_travel.ddls.asddls": (c) => c.replace("      AgencyID,", "      @Consumption.valueHelpDefinition: [{ entity: { name: 'I_Country', element: 'Country' } }]\n      AgencyID,"),
    });
    try {
      const project = loadProject(variant.dir);
      expect([...new Set(project.files.filter((f) => f.standard === true).map((f) => f.path))].sort()).toEqual([
        "<standard>/i_country.ddls.asddls",
        "<standard>/i_countrytext.ddls.asddls",
        "<standard>/rapt_country.tabl.astabl",
        "<standard>/rapt_countryt.tabl.astabl",
      ]);
      const { model, diagnostics } = buildModel(project);
      expect(diagnostics.errors()).toEqual([]);
      expect(model?.service.entitySets.map((s) => s.name)).toEqual(["Travel", "Booking", "I_Country", "I_CountryText"]);
      expect(model?.tables.filter((t) => t.standard === true).map((t) => t.name)).toEqual(["rapt_country", "rapt_countryt"]);
      expect(generateAbapGitFiles(variant.dir, { check: true }).written).toEqual([]);
    } finally {
      variant.cleanup();
    }
  });

  it("reports a value help on an unknown entity", () => {
    const variant = fixtureVariant({
      "zrt_c_travel.ddls.asddls": (c) => c.replace("      AgencyID,", "      @Consumption.valueHelpDefinition: [{ entity: { name: 'ZI_Nowhere', element: 'X' } }]\n      AgencyID,"),
    });
    try {
      const { diagnostics } = buildModel(loadProject(variant.dir));
      expect(diagnostics.sorted().map((d) => d.code)).toContain("CDS018");
    } finally {
      variant.cleanup();
    }
  });
});
