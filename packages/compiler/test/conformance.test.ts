/**
 * The $metadata of Open RAP Runtime compared with the one SAP BTP generated for the same sources
 * (D90): `rapt conformance compare`, and the reference of the round trip to the trial 2611.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateApplication } from "../src/build.js";
import { main } from "../src/cli.js";
import { compareMetadata, comparisonReport, metadataFacts } from "../src/conformance/metadata.js";
import { loadProject } from "../src/input/project.js";
import { fixtureVariant } from "./helpers.js";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const TRIAL = path.join(ROOT, "conformance", "btp", "2611");

/** The changes of variants of fixtures/variants.json, for fixtureVariant. */
function variants(names: string[]): Record<string, (content: string) => string> {
  const definitions = JSON.parse(readFileSync(path.join(ROOT, "fixtures", "variants.json"), "utf8")) as Record<string, { files: Record<string, Array<[string, string]> | null> }>;
  const changes: Record<string, Array<[string, string]>> = {};
  for (const name of names) {
    for (const [file, replacements] of Object.entries(definitions[name]?.files ?? {})) {
      if (replacements !== null) changes[file] = [...(changes[file] ?? []), ...replacements];
    }
  }
  return Object.fromEntries(
    Object.entries(changes).map(([file, replacements]) => [
      file,
      (content: string) =>
        replacements.reduce((text, [from, to]) => {
          if (!text.includes(from)) throw new Error(`text not found in ${file}: ${from}`);
          return text.replace(from, () => to);
        }, content.replace(/\r\n/g, "\n")),
    ]),
  );
}

const edmx = (references: string, schema: string): string =>
  `<?xml version="1.0" encoding="utf-8"?><edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">${references}<edmx:DataServices>${schema}</edmx:DataServices></edmx:Edmx>`;

describe("$metadata compared with SAP BTP (D90)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compares on normalized names: the aliases, the namespace of the service, the suffix, the type of a record", () => {
    const sap = edmx(
      '<edmx:Reference Uri="x"><edmx:Include Namespace="com.sap.vocabularies.Common.v1" Alias="SAP__common"/></edmx:Reference><edmx:Reference Uri="y"><edmx:Include Namespace="Org.OData.Capabilities.V1" Alias="SAP__capabilities"/></edmx:Reference>',
      '<Schema Namespace="com.sap.gateway.srvd.zrt_ui_travelxyz.v0001" Alias="SAP__self" xmlns="http://docs.oasis-open.org/odata/ns/edm"><EntityType Name="TravelType"><Key><PropertyRef Name="ID"/></Key><Property Name="ID" Type="Edm.String" Nullable="false" MaxLength="8"/></EntityType><EntityContainer Name="Container"><EntitySet Name="Travel" EntityType="com.sap.gateway.srvd.zrt_ui_travelxyz.v0001.TravelType"/></EntityContainer><Annotations Target="SAP__self.TravelType/ID"><Annotation Term="SAP__common.Label" String="Travel"/></Annotations><Annotations Target="SAP__self.Container/Travel"><Annotation Term="SAP__capabilities.InsertRestrictions"><Record><PropertyValue Property="Insertable" Bool="true"/></Record></Annotation><Annotation Term="SAP__common.Text" Path="ZRT_C_TRAVELXYZ"/></Annotations></Schema>',
    );
    const ours = edmx(
      '<edmx:Reference Uri="x"><edmx:Include Namespace="com.sap.vocabularies.Common.v1" Alias="Common"/></edmx:Reference><edmx:Reference Uri="y"><edmx:Include Namespace="Org.OData.Capabilities.V1" Alias="Capabilities"/></edmx:Reference>',
      '<Schema Namespace="com.sap.gateway.srvd.zrt_ui_travel.v0001" Alias="SAP__self" xmlns="http://docs.oasis-open.org/odata/ns/edm"><EntityType Name="TravelType"><Key><PropertyRef Name="ID"/></Key><Property Name="ID" Type="Edm.String" Nullable="false" MaxLength="10"><Annotation Term="Common.Label" String="Travel"/></Property></EntityType><EntityContainer Name="EntityContainer"><EntitySet Name="Travel" EntityType="SAP__self.TravelType"><Annotation Term="Capabilities.InsertRestrictions"><Record Type="Capabilities.InsertRestrictionsType"><PropertyValue Property="Insertable" Bool="true"/></Record></Annotation><Annotation Term="Common.Text" Path="ZRT_C_TRAVEL"/></EntitySet></EntityContainer></Schema>',
    );
    expect(metadataFacts(ours)).toContainEqual({ kind: "annotation", target: "self.TravelType/ID", name: "@Common.Label", value: 'String=Travel' });
    const comparison = compareMetadata(sap, ours, { suffix: "XYZ" });
    expect(comparison.differences).toEqual([{ kind: "structure", target: "self.TravelType/ID", name: "Property", sap: "Type=Edm.String Nullable=false MaxLength=8", ours: "Type=Edm.String Nullable=false MaxLength=10" }]);
    expect(comparison.same).toBe(5);
    const report = comparisonReport(comparison, "x");
    expect(report).toContain("| Different | 1 | 0 |");
    expect(report).toContain("| Property | `Type=Edm.String Nullable=false MaxLength=8` | `Type=Edm.String Nullable=false MaxLength=10` |");
  });

  it("keeps the report of the round trip to the trial 2611 up to date", async () => {
    const { dir, cleanup } = fixtureVariant(variants(["draft", "trial"]));
    try {
      const result = await generateApplication(loadProject(dir), { scaffold: false });
      const metadata = result.files.find((f) => f.path === "odata/metadata.xml")?.content ?? "";
      const comparison = compareMetadata(readFileSync(path.join(TRIAL, "metadata.xml"), "utf8"), metadata, { suffix: "CRG" });
      // a fix of a difference shows here: update the report with vitest -u
      await expect(comparisonReport(comparison, "`$metadata` of the Travel fixture (draft, trial) and SAP BTP 2611")).toMatchFileSnapshot(path.join(TRIAL, "metadata-diff.md"));
    } finally {
      cleanup();
    }
  });

  it("writes the report (rapt conformance compare)", async () => {
    const { dir, cleanup } = fixtureVariant(variants(["draft", "trial"]));
    const written: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      expect(await main(["conformance", "compare", dir, "--sap", path.join(TRIAL, "metadata.xml"), "--suffix", "CRG", "--json"])).toBe(0);
      const output = JSON.parse(written.join("")) as { same: number; differences: unknown[] };
      expect(output.same).toBeGreaterThan(200);
      expect(output.differences.length).toBeGreaterThan(0);
      expect(await main(["conformance", "compare", dir])).toBe(2);
      expect(await main(["conformance", "other", dir])).toBe(2);
    } finally {
      cleanup();
    }
  });
});
