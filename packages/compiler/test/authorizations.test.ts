/** Authorization objects and roles of the sources (D34), AUTHORITY-CHECK in the ABAP code. */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSusoXml } from "../src/ir/authorizations.js";
import { buildModel } from "../src/ir/builder.js";
import { loadProject } from "../src/input/project.js";
import { fixtureVariant } from "./helpers.js";

const SUSO = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_SUSO" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <TOBJ>
    <OBJCT>ZAO_TRAVL</OBJCT>
    <FIEL1>ACTVT</FIEL1>
    <FIEL2>ZAGENCY</FIEL2>
   </TOBJ>
   <TOBJT>
    <LANGU>E</LANGU>
    <OBJECT>ZAO_TRAVL</OBJECT>
    <TTEXT>Travels by agency</TTEXT>
   </TOBJT>
   <TACTZ>
    <TACTZ>
     <BROBJ>ZAO_TRAVL</BROBJ>
     <ACTVT>02</ACTVT>
    </TACTZ>
    <TACTZ>
     <BROBJ>ZAO_TRAVL</BROBJ>
     <ACTVT>03</ACTVT>
    </TACTZ>
   </TACTZ>
  </asx:values>
 </asx:abap>
</abapGit>
`;

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

function build(roles: unknown, abap?: (c: string) => string): ReturnType<typeof buildModel> {
  const variant = fixtureVariant({ "zao_travl.suso.xml": SUSO, ...(abap === undefined ? {} : { "zbp_rt_r_travel.clas.locals_imp.abap": abap }) });
  cleanup = variant.cleanup;
  mkdirSync(path.join(variant.dir, "rapt"), { recursive: true });
  writeFileSync(path.join(variant.dir, "rapt", "authorizations.json"), JSON.stringify(roles));
  return buildModel(loadProject(variant.dir));
}

describe("authorization objects and roles", () => {
  it("reads an authorization object of abapGit (SUSO)", () => {
    expect(readSusoXml(SUSO)).toEqual({ name: "ZAO_TRAVL", fields: ["ACTVT", "ZAGENCY"], activities: ["02", "03"], description: "Travels by agency" });
  });

  it("puts the objects and the roles in the model", () => {
    const { model, diagnostics } = build({ roles: { agent: { description: "Agent", authorizations: [{ object: "ZAO_TRAVL", fields: { ACTVT: ["02"], ZAGENCY: "{claim:agency}" } }] } } });
    expect(diagnostics.errors()).toEqual([]);
    expect(model?.authorizations).toEqual({
      objects: [{ name: "ZAO_TRAVL", fields: ["ACTVT", "ZAGENCY"], activities: ["02", "03"], description: "Travels by agency" }],
      roles: [{ name: "agent", description: "Agent", authorizations: [{ object: "ZAO_TRAVL", fields: { ACTVT: ["02"], ZAGENCY: ["{claim:agency}"] } }] }],
    });
  });

  it("checks the roles against the authorization objects", () => {
    const { diagnostics } = build({
      roles: {
        wrong: {
          authorizations: [
            { object: "ZAO_TRAVL", fields: { ACTVT: ["02", "06"], ZCOUNTRY: ["FR"] } },
            { object: "ZAO_UNKNOWN", fields: { ACTVT: ["03"] } },
            { object: "ZAO_TRAVL", fields: { ACTVT: [3] } },
          ],
        },
      },
    });
    expect(diagnostics.items.map((d) => `${d.severity} ${d.code}`)).toEqual(["warning AUTH004", "error AUTH003", "warning AUTH002", "error AUTH001"]);
    expect(diagnostics.items.find((d) => d.code === "AUTH003")?.message).toBe("roles.wrong.authorizations[0]: ZAO_TRAVL has no field ZCOUNTRY (fields: ACTVT, ZAGENCY)");
  });

  it("checks the fields of AUTHORITY-CHECK against the authorization object", () => {
    const { diagnostics } = build({ roles: {} }, (c) =>
      c.replace(
        "    IF requested_authorizations-%create = if_abap_behv=>mk-on.\n",
        "    AUTHORITY-CHECK OBJECT 'ZAO_TRAVL' ID 'ACTVT' FIELD '02' ID 'ZCOUNTRY' DUMMY.\n    AUTHORITY-CHECK OBJECT 'ZAO_MISSING' ID 'ACTVT' FIELD '02'.\n    IF requested_authorizations-%create = if_abap_behv=>mk-on.\n",
      ),
    );
    expect(diagnostics.items.map((d) => `${d.severity} ${d.code} ${d.message}`)).toEqual([
      "error ABP010 AUTHORITY-CHECK OBJECT 'ZAO_TRAVL': the object has no field ZCOUNTRY (fields: ACTVT, ZAGENCY)",
      "warning ABP011 AUTHORITY-CHECK OBJECT 'ZAO_MISSING': the authorization object is neither in the sources (SUSO) nor in rapt/authorizations.json; no role grants it, the check fails",
    ]);
  });
});
