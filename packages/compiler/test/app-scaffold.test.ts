/**
 * The destinations of the remote APIs (D31) in the generated application: found in the ABAP
 * code, listed in .env.example and in the README.
 */

import { describe, expect, it } from "vitest";
import { buildModel } from "../src/ir/builder.js";
import { findDestinations, generateScaffold } from "../src/gen/app/index.js";
import { Diagnostics } from "../src/diagnostics.js";
import { loadProject } from "../src/input/project.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FIXTURE_DIR, fixtureVariant } from "./helpers.js";

const ABAP = `
  METHOD rate.
    DATA(destination) = cl_http_destination_provider=>create_by_cloud_destination( i_name       = 'RATINGS'
                                                                                  i_authn_mode = if_a4c_cp_service=>service_specific ).
    " DATA(old) = cl_http_destination_provider=>create_by_cloud_destination( i_name = 'COMMENTED' ).
* DATA(older) = cl_http_destination_provider=>create_by_cloud_destination( i_name = 'OLDER' ).
    DATA(arrangement) = cl_http_destination_provider=>create_by_comm_arrangement(
                          comm_scenario  = 'ZRT_TRAVEL_REMOTE'
                          comm_system_id = 'TRAVEL_SYSTEM'
                          service_id     = 'OUTBOUND' ).
    DATA(scenario) = cl_http_destination_provider=>create_by_comm_arrangement( comm_scenario = \`ZRT_LEGACY\` ).
    DATA(dynamic) = cl_http_destination_provider=>create_by_cloud_destination( i_name = name ).
  ENDMETHOD.
`;

describe("destinations of the generated application", () => {
  it("finds the destinations named by literals in the ABAP code", () => {
    expect(findDestinations([{ content: ABAP }])).toEqual(["RATINGS", "ZRT_LEGACY", "ZRT_TRAVEL_REMOTE.OUTBOUND"]);
  });

  it("lists them in .env.example and in the README", () => {
    const { model } = buildModel(loadProject(FIXTURE_DIR));
    expect(model).toBeDefined();
    const diagnostics = new Diagnostics();
    const files = generateScaffold(model!, diagnostics, { destinations: findDestinations([{ content: ABAP }]) });
    expect(diagnostics.hasErrors()).toBe(false);
    const env = files.find((f) => f.path === ".env.example")?.content ?? "";
    expect(env).toContain("DESTINATION_RATINGS_URL=\n# DESTINATION_RATINGS_USER=\n# DESTINATION_RATINGS_PASSWORD=\n# DESTINATION_RATINGS_TOKEN=");
    expect(env).toContain("# ZRT_TRAVEL_REMOTE.OUTBOUND (or DESTINATION_ZRT_TRAVEL_REMOTE_URL for the whole scenario)\nDESTINATION_ZRT_TRAVEL_REMOTE_OUTBOUND_URL=");
    const readme = files.find((f) => f.path === "README.md")?.content ?? "";
    expect(readme).toContain("## Remote APIs");
    expect(readme).toContain("| `ZRT_TRAVEL_REMOTE.OUTBOUND` | `DESTINATION_ZRT_TRAVEL_REMOTE_OUTBOUND_URL`, then `DESTINATION_ZRT_TRAVEL_REMOTE_URL` |");
  });

  it("adds nothing without destinations", () => {
    const { model } = buildModel(loadProject(FIXTURE_DIR));
    const files = generateScaffold(model!, new Diagnostics());
    expect(files.find((f) => f.path === ".env.example")?.content).not.toContain("DESTINATION_");
    expect(files.find((f) => f.path === "README.md")?.content).not.toContain("## Remote APIs");
    // deployment (D50): Cloud Foundry manifest with its PostgreSQL service, and the README section
    expect(files.find((f) => f.path === "manifest.yml")?.content).toContain("health-check-http-endpoint: /health");
    expect(files.find((f) => f.path === "README.md")?.content).toContain("## Deploy");
  });
});

describe("service definitions of service consumption models", () => {
  it("builds the service definition with a binding, not the one generated for a client proxy", () => {
    const srvdXml = readFileSync(path.join(FIXTURE_DIR, "src", "zrt_ui_travel.srvd.xml"), "utf8");
    const ddlsXml = readFileSync(path.join(FIXTURE_DIR, "src", "zrt_a_discount.ddls.xml"), "utf8");
    const variant = fixtureVariant({
      "zrt_a_legacy_travel.ddls.asddls": " @OData.entitySet.name: 'LegacyTravelSet'\n define root abstract entity ZRT_A_LEGACY_TRAVEL {\n key TravelID : abap.char( 8 ) ;\n Description : abap.char( 80 ) ;\n }\n",
      "zrt_a_legacy_travel.ddls.xml": ddlsXml.replace(/ZRT_A_DISCOUNT/g, "ZRT_A_LEGACY_TRAVEL"),
      "zsc_rt_legacy.srvd.srvdsrv": "@EndUserText.label: 'Service definition for client proxy - generated'\ndefine service ZSC_RT_LEGACY {\n  expose ZRT_A_LEGACY_TRAVEL as LegacyTravelSet;\n}\n",
      "zsc_rt_legacy.srvd.xml": srvdXml.replace(/ZRT_UI_TRAVEL/g, "ZSC_RT_LEGACY").replace(/zrt_ui_travel/g, "zsc_rt_legacy"),
    });
    try {
      const { model, diagnostics } = buildModel(loadProject(variant.dir));
      expect(diagnostics.errors()).toEqual([]);
      expect(model?.service.name).toBe("ZRT_UI_TRAVEL");
      expect(diagnostics.items).toContainEqual(expect.objectContaining({ code: "SRVD007", severity: "info" }));
      // the abstract entity types the ABAP code all the same
      expect(model?.entities.some((e) => e.name === "ZRT_A_LEGACY_TRAVEL" && e.kind === "abstract")).toBe(true);
    } finally {
      variant.cleanup();
    }
  });
});
