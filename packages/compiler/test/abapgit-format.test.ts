/**
 * The abapGit XML of metadata extensions and service bindings as the abapGit of SAP BTP writes and
 * reads it (D85): a flat `<DDLX>` or `<SRVB>` is refused at import on the SAP BTP ABAP trial
 * ("The description is missing", "Object description is missing").
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ddlxXml, srvbXml } from "../src/authoring/abapgit.js";
import { readSrvbXml } from "../src/ddic/xml.js";

const fixtures = fileURLToPath(new URL("../../../fixtures", import.meta.url));

describe("abapGit XML of DDLX and SRVB in the format of SAP BTP (D85)", () => {
  it("writes a metadata extension with its fields in METADATA", () => {
    const xml = ddlxXml("zrt_c_travel", "Travel: UI & annotations");
    expect(xml).toContain('serializer="LCL_OBJECT_DDLX"');
    expect(xml).toMatch(/<DDLX>\s*<METADATA>\s*<NAME>ZRT_C_TRAVEL<\/NAME>\s*<DESCRIPTION>Travel: UI &amp; annotations<\/DESCRIPTION>\s*<MASTER_LANGUAGE>EN<\/MASTER_LANGUAGE>\s*<\/METADATA>\s*<\/DDLX>/);
  });

  it("writes a UI binding with METADATA and CONTENT, the service definition in SRVD_REF, no category", () => {
    const xml = srvbXml({ name: "zrt_ui_travel_o4", service: "zrt_ui_travel", description: "Travel service binding (OData V4, UI)" });
    expect(xml).toMatch(/<SRVB>\s*<METADATA>\s*<NAME>ZRT_UI_TRAVEL_O4<\/NAME>\s*<TYPE>SRVB\/SVB<\/TYPE>\s*<DESCRIPTION>Travel service binding \(OData V4, UI\)<\/DESCRIPTION>/);
    expect(xml).toMatch(/<CONTENT>\s*<BIND_TYPE_IMPL>\s*<NAME>ZRT_UI_TRAVEL_O4<\/NAME>\s*<\/BIND_TYPE_IMPL>\s*<BIND_TYPE>ODATA<\/BIND_TYPE>\s*<BIND_TYPE_VERSION>V4<\/BIND_TYPE_VERSION>/);
    expect(xml).toMatch(/<SERVICE_NAME>ZRT_UI_TRAVEL<\/SERVICE_NAME>/);
    expect(xml).toMatch(/<SRVD_REF>\s*<URI>\/sap\/bc\/adt\/ddic\/srvd\/sources\/zrt_ui_travel<\/URI>\s*<TYPE>SRVD\/SRV<\/TYPE>\s*<NAME>ZRT_UI_TRAVEL<\/NAME>\s*<\/SRVD_REF>/);
    expect(xml).not.toContain("CATEGORY");
    expect(xml).not.toContain("PUBLISHED");
    expect(readSrvbXml(xml)).toEqual({ name: "ZRT_UI_TRAVEL_O4", serviceDefinition: "ZRT_UI_TRAVEL", version: "0001", bindingType: "ODATA", bindingVersion: "V4" });
  });

  it("writes and reads the category of a Web API binding", () => {
    const xml = srvbXml({ name: "ZPA_API_PARTNER_O4", service: "ZPA_API_PARTNER", description: "Partners (OData V4, Web API)", webApi: true });
    expect(xml).toMatch(/<BIND_TYPE>ODATA<\/BIND_TYPE>\s*<BIND_TYPE_CATEGORY>1<\/BIND_TYPE_CATEGORY>\s*<BIND_TYPE_VERSION>V4<\/BIND_TYPE_VERSION>/);
    expect(readSrvbXml(xml)).toMatchObject({ name: "ZPA_API_PARTNER_O4", serviceDefinition: "ZPA_API_PARTNER", bindingCategory: "1" });
  });

  it("still reads the flat binding of earlier versions", () => {
    const flat = `<abapGit><asx:abap><asx:values><SRVB><NAME>ZUI_X_O4</NAME><BINDING_TYPE>ODATA</BINDING_TYPE><BINDING_TYPE_VERSION>V4</BINDING_TYPE_VERSION><BINDING_TYPE_CATEGORY>1</BINDING_TYPE_CATEGORY><SERVICES><item><NAME>ZUI_X_O4</NAME><VERSIONS><item><SERVICE_VERSION>0001</SERVICE_VERSION><SERVICE_DEFINITION>ZUI_X</SERVICE_DEFINITION></item></VERSIONS></item></SERVICES></SRVB></asx:values></asx:abap></abapGit>`;
    expect(readSrvbXml(flat)).toEqual({ name: "ZUI_X_O4", serviceDefinition: "ZUI_X", version: "0001", bindingType: "ODATA", bindingVersion: "V4", bindingCategory: "1" });
  });

  it("no fixture keeps a flat DDLX or SRVB", () => {
    const flat: string[] = [];
    for (const fixture of readdirSync(fixtures, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const src = path.join(fixtures, fixture.name, "src");
      let files: string[];
      try {
        files = readdirSync(src, { recursive: true }).map(String);
      } catch {
        continue;
      }
      for (const file of files.filter((f) => /\.(ddlx|srvb)\.xml$/.test(f))) {
        if (!readFileSync(path.join(src, file), "utf8").includes("<METADATA>")) flat.push(`${fixture.name}/${file}`);
      }
    }
    expect(flat).toEqual([]);
  });
});
