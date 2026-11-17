/**
 * The variant `cds` of round 2 on the SAP BTP trial (D111): the CDS views of D100 to D108 next to
 * the draft BO (fixtures/cds), as scripts/btp-roundtrip.mjs pushes them. They build here and each
 * entity set answers, so that the trial compares the same sources.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error a script module of the repository, without types
import { CDS_READS, neutralAnswer, readUrl } from "../../../scripts/lib/cds-reads.mjs";
import { DRAFT_CHANGES, generatedVariant, SERVICE, variantChanges, writableApp, type TestApp } from "./helpers.js";

type Read = { id: string; url: string; compare: boolean };
type Answer = { status: number; body: Record<string, unknown> };

/** The answers recorded on the trial (scripts/btp-read-trial.mjs), by read, from conformance/btp/<release>/cds. */
function recorded(): Map<string, Answer> {
  const result = new Map<string, Answer>();
  const base = fileURLToPath(new URL("../../../conformance/btp", import.meta.url));
  for (const release of existsSync(base) ? readdirSync(base).sort() : []) {
    const folder = `${base}/${release}/cds`;
    if (!existsSync(folder)) continue;
    for (const file of readdirSync(folder).filter((f) => f.endsWith(".json"))) {
      const answer = JSON.parse(readFileSync(`${folder}/${file}`, "utf8")) as Answer & { id: string };
      result.set(answer.id, answer);
    }
  }
  return result;
}

let test: TestApp;

beforeAll(async () => {
  const cds = variantChanges("cds");
  test = await writableApp(generatedVariant({ ...DRAFT_CHANGES, ...cds }));
  await test.pglite.exec(`INSERT INTO zrt_cdsnode (nodeid, parentid, name, seq) VALUES
    ('A', '', 'Alpha', 1), ('A1', 'A', 'Alpha one', 2), ('A2', 'A', 'Alpha two', 1), ('A21', 'A2', 'Alpha two one', 1), ('B', '', 'Beta', 2), ('X', 'Z', 'Orphan', 1)`);
}, 180_000);

afterAll(async () => {
  await test?.close();
});

async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await test.app.inject({ method: "GET", url: `${SERVICE}${path}`, headers: { accept: "application/json" } });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

const rows = (r: { body: Record<string, unknown> }): Array<Record<string, unknown>> => r.body["value"] as Array<Record<string, unknown>>;

describe("the CDS of round 2 (D111)", () => {
  it("reads the views with joins, paths, conditions, $session, aggregates and a union", async () => {
    const bookings = await get("CdsBooking?$orderby=BookingID");
    expect(bookings.status, JSON.stringify(bookings.body)).toBe(200);
    // the booking with a price of 0.00 is outside BETWEEN 1 AND 100000
    expect(rows(bookings).every((b) => Number(b["FlightPrice"]) >= 1 && b["TravelID"] !== undefined && b["ReadOn"] === new Date().toISOString().slice(0, 10))).toBe(true);
    expect(rows(bookings)).toHaveLength(3);
    expect(rows(bookings)[0]).toMatchObject({ TravelDescription: "Paris and Rome" });
    const stats = await get("CdsBookingStats?$orderby=Bookings desc");
    expect(stats.status, JSON.stringify(stats.body)).toBe(200);
    expect(rows(stats)[0]).toMatchObject({ Bookings: 3, CurrencyCode: "EUR" });
    const dates = await get("CdsDates?$count=true&$top=0");
    expect(dates.body["@odata.count"]).toBe(7);
  });

  it("reads the view with parameters and the hierarchy of the nodes", async () => {
    const open = await get("CdsTravelByStatus(p_status='O')/Set?$select=TravelID");
    expect(open.status, JSON.stringify(open.body)).toBe(200);
    expect(rows(open).map((t) => t["TravelID"])).toEqual(["00000001"]);
    const top = encodeURIComponent("com.sap.vocabularies.Hierarchy.v1.TopLevels(HierarchyNodes=$root/CdsNode,HierarchyQualifier='ZRT_I_CdsNodeHier',NodeProperty='NodeId',Levels=1)");
    const tree = await get(`CdsNode?$apply=${top}&$select=NodeId,DrillState&$count=true`);
    expect(tree.status, JSON.stringify(tree.body)).toBe(200);
    expect(rows(tree).map((n) => [n["NodeId"], n["DrillState"]])).toEqual([["A", "collapsed"], ["B", "leaf"]]);
  });

  it("replays the reads of the trial on the hierarchy, and answers as SAP did when recorded", async () => {
    const answers = recorded();
    for (const read of (CDS_READS as Read[]).filter((r) => r.compare)) {
      const url = (readUrl(SERVICE, read, "") as string).slice(SERVICE.length);
      const answer = await get(url);
      const ours = neutralAnswer(answer.status, answer.body, { namespace: "com.sap.gateway.srvd.zrt_ui_travel.v0001" }) as Answer;
      expect(ours.status, `${read.id}: ${JSON.stringify(ours.body)}`).toBe(200);
      const sap = answers.get(read.id);
      if (sap !== undefined) {
        expect({ status: ours.status, count: ours.body["@odata.count"], value: ours.body["value"] }, read.id).toEqual({ status: sap.status, count: sap.body["@odata.count"], value: sap.body["value"] });
      }
    }
  });
});
