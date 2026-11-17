// The reads of round 2 on the CDS views (D111): their URLs and the neutral answers kept.

import { describe, expect, it } from "vitest";
import { CDS_READS, neutralAnswer, readUrl } from "./cds-reads.mjs";

describe("reads of the CDS views on the trial (D111)", () => {
  it("builds the URLs with the hierarchy of the suffix, encoded", () => {
    const read = CDS_READS.find((r) => r.id === "cds-node-descendants");
    const url = readUrl("https://trial.example/sap/opu/odata4/sap/x/srvd/sap/y/0001/", read, "XYZ");
    expect(url.startsWith("https://trial.example/sap/opu/odata4/sap/x/srvd/sap/y/0001/CdsNode?$apply=")).toBe(true);
    expect(decodeURIComponent(url)).toContain("descendants($root/CdsNode,ZRT_I_CdsNodeHierXYZ,NodeId,filter(NodeId eq 'A'),1)");
    expect(new Set(CDS_READS.map((r) => r.id)).size).toBe(CDS_READS.length);
  });

  it("keeps no user, key, namespace or suffix", () => {
    const answer = neutralAnswer(
      200,
      { "@odata.context": "$metadata#CdsBooking", value: [{ BookingUUID: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", ReadBy: "CB0000000123", Q: "ZRT_I_CdsNodeHierXYZ", T: "com.sap.gateway.srvd.zrt_ui_travelxyz.v0001.X" }] },
      { namespace: "com.sap.gateway.srvd.zrt_ui_travelxyz.v0001", suffix: "XYZ" },
    );
    expect(answer).toEqual({ status: 200, body: { "@odata.context": "$metadata#CdsBooking", value: [{ BookingUUID: "{{uuid}}", ReadBy: "{{user}}", Q: "ZRT_I_CdsNodeHier", T: "{{NS}}.X" }] } });
  });
});
