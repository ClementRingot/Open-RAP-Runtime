/** The access controls (DCL, D35): parser, resolution for the exposed entities, diagnostics. */

import { afterEach, describe, expect, it } from "vitest";
import { parseDcl } from "../src/dcl/parser.js";
import { buildModel } from "../src/ir/builder.js";
import { loadProject } from "../src/input/project.js";
import { fixtureVariant } from "./helpers.js";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

const xml = (name: string): string => `<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="LCL_OBJECT_DCLS" serializer_version="v1.0.0"><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DCLS><DCLNAME>${name}</DCLNAME></DCLS></asx:values></asx:abap></abapGit>\n`;

describe("DCL parser", () => {
  it("parses the conditions of a role", () => {
    const { role, errors } = parseDcl(`@EndUserText.label: 'Travels'
@MappingRole: true
define role ZR_TRAVEL {
  grant select on ZR_Travel
    where ( AgencyID, CountryCode ) = aspect pfcg_auth( ZAO_TRAVL, ZAGENCY, LAND1, ACTVT = '03' )
       or CreatedBy ?= aspect user
       or ( OverallStatus <> 'X' and not Description like '%secret%' and EndDate is not null );
  grant select on ZR_Booking;
}`);
    expect(errors).toEqual([]);
    expect(role?.grants[0]?.condition).toEqual({
      kind: "or",
      operands: [
        { kind: "pfcg", elements: ["AgencyID", "CountryCode"], object: "ZAO_TRAVL", fields: ["ZAGENCY", "LAND1"], filters: { ACTVT: "03" }, orInitial: false },
        { kind: "user", element: "CreatedBy", orInitial: true },
        {
          kind: "and",
          operands: [
            { kind: "compare", element: "OverallStatus", operator: "<>", value: "X" },
            { kind: "not", operand: { kind: "compare", element: "Description", operator: "like", value: "%secret%" } },
            { kind: "null", element: "EndDate", negated: true },
          ],
        },
      ],
    });
    expect(role?.grants[1]).toEqual({ entity: "ZR_Booking", line: 8 });
  });

  it("reports syntax errors with their line", () => {
    expect(parseDcl("define role R {\n  grant select on E\n    where A ;\n}").errors).toEqual([{ message: 'a comparison operator expected after A, found ";"', line: 3 }]);
    expect(parseDcl("define role R { grant select on E where A ; }").errors[0]?.message).toContain("comparison operator expected");
  });
});

describe("access controls of the exposed entities", () => {
  it("resolves the roles of the fixture: inheritance and paths", () => {
    const variant = fixtureVariant({});
    cleanup = variant.cleanup;
    const { model, diagnostics } = buildModel(loadProject(variant.dir));
    expect(diagnostics.items).toEqual([]);
    expect(model?.accessControls?.map((c) => `${c.role} ${c.entity} ${JSON.stringify(c.conditions[0])}`)).toEqual([
      'ZRT_C_TRAVEL ZRT_C_Travel {"kind":"pfcg","elements":["AgencyID"],"object":"ZAO_TRAVL","fields":["ZAGENCY"],"filters":{"ACTVT":"03"},"orInitial":false}',
      'ZRT_C_BOOKING ZRT_C_Booking {"kind":"pfcg","elements":["_Travel.AgencyID"],"object":"ZAO_TRAVL","fields":["ZAGENCY"],"filters":{"ACTVT":"03"},"orInitial":false}',
    ]);
  });

  it("grants nothing for what it cannot evaluate, and says so", () => {
    const variant = fixtureVariant({
      "zrt_c_booking.dcls.asdcls": `define role ZRT_C_BOOKING {
  grant select on ZRT_C_Booking where Unknown = 'X' or BookingStatus = aspect bypass_when or ( FlightPrice ) = aspect pfcg_auth( ZAO_TRAVL, ZCOUNTRY );
}`,
      "zrt_c_booking.dcls.xml": xml("ZRT_C_BOOKING"),
    });
    cleanup = variant.cleanup;
    const { model, diagnostics } = buildModel(loadProject(variant.dir));
    expect(diagnostics.items.map((d) => `${d.severity} ${d.code}`)).toEqual(["warning DCL003", "warning DCL002", "error DCL004"]);
    expect(model?.accessControls?.find((c) => c.entity === "ZRT_C_Booking")?.conditions[0]).toMatchObject({ kind: "or", operands: [{ kind: "false" }, { kind: "false" }, { kind: "pfcg" }] });
  });
});
