// SAP Fiori elements protocol cases from a HAR (D79), on a synthetic HAR written for the test.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { harToCases, parseMultipart, relativeUrl, responseShape, serviceRootOf } from "./fe-har.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HOST = "https://trial-example.abap.example.test";
const SRV = "/sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001/";
const ACTIVE = "11111111-2222-4333-8444-555555555555";
const NEW = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const headers = (map) => Object.entries(map).map(([name, value]) => ({ name, value }));
const entry = (method, url, { requestHeaders = {}, body, status = 200, responseHeaders = {}, response = "" } = {}) => ({
  request: { method, url: `${HOST}${url}`, headers: headers({ Cookie: "SAP_SESSIONID=secret", Authorization: "Basic c2VjcmV0", "sap-client": "100", ...requestHeaders }), ...(body === undefined ? {} : { postData: { mimeType: requestHeaders["Content-Type"] ?? "application/json", text: body } }) },
  response: { status, headers: headers({ "set-cookie": "SAP_SESSIONID=secret", ...responseHeaders }), content: { mimeType: responseHeaders["Content-Type"] ?? "application/json", text: response } },
});

const batchRequest = [
  "--batch_1",
  "Content-Type:application/http",
  "Content-Transfer-Encoding:binary",
  "",
  "GET Travel?$count=true&$filter=(IsActiveEntity%20eq%20false%20or%20SiblingEntity/IsActiveEntity%20eq%20null)&$top=30 HTTP/1.1",
  "Accept:application/json;odata.metadata=minimal;IEEE754Compatible=true",
  "Accept-Language:en",
  "X-CSRF-Token:abc123",
  "",
  "",
  "--batch_1--",
  "",
].join("\r\n");
const batchResponse = [
  "--batch_r",
  "Content-Type: application/http",
  "Content-Transfer-Encoding: binary",
  "",
  "HTTP/1.1 200 OK",
  "Content-Type: application/json;odata.metadata=minimal",
  "",
  JSON.stringify({ "@odata.count": 1, value: [{ TravelUUID: ACTIVE, Description: "Some private text", IsActiveEntity: true, "Description@Core.Computed": true }] }),
  "--batch_r--",
  "",
].join("\r\n");

const HAR = {
  log: {
    entries: [
      entry("GET", "/resources/sap-ui-core.js", { response: "/* not ours */" }),
      entry("GET", `${SRV}$metadata`, { response: "<edmx:Edmx/>" }),
      entry("HEAD", SRV, { requestHeaders: { "X-CSRF-Token": "Fetch" }, responseHeaders: { "x-csrf-token": "abc123" } }),
      entry("POST", `${SRV}$batch`, {
        requestHeaders: { "Content-Type": "multipart/mixed; boundary=batch_1", "OData-Version": "4.0" },
        body: batchRequest,
        responseHeaders: { "Content-Type": "multipart/mixed; boundary=batch_r" },
        response: batchResponse,
      }),
      entry("POST", `${SRV}Travel`, {
        requestHeaders: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ TravelID: "00000300" }),
        status: 201,
        responseHeaders: { location: `${HOST}${SRV}Travel(TravelUUID=${NEW},IsActiveEntity=false)` },
        response: JSON.stringify({ "@odata.etag": 'W/"x"', TravelUUID: NEW, IsActiveEntity: false, HasActiveEntity: false }),
      }),
      entry("PATCH", `${SRV}Travel(TravelUUID=${NEW},IsActiveEntity=false)`, { requestHeaders: { "Content-Type": "application/json", "If-Match": 'W/"2026-11-14T10:00:00Z"' }, body: JSON.stringify({ Description: "Typed by the user" }), response: JSON.stringify({ TravelUUID: NEW }) }),
      entry("POST", `${SRV}Travel(TravelUUID=${NEW},IsActiveEntity=false)/com.sap.gateway.srvd.zrt_ui_travel.v0001.Prepare`, {
        requestHeaders: { "Content-Type": "application/json" },
        body: "{}",
        responseHeaders: { "sap-messages": JSON.stringify([{ code: "ZRT/001", message: "A text of the system", numericSeverity: 4, target: "BeginDate", longtextUrl: "/x" }]) },
        response: JSON.stringify({ TravelUUID: NEW, SAP__Messages: [] }),
      }),
      entry("POST", `${SRV}Travel(TravelUUID=${ACTIVE},IsActiveEntity=true)/com.sap.gateway.srvd.zrt_ui_travel.v0001.Edit`, { requestHeaders: { "Content-Type": "application/json" }, body: JSON.stringify({ PreserveChanges: true }), response: JSON.stringify({ TravelUUID: ACTIVE, IsActiveEntity: false }) }),
    ],
  },
};

describe("SAP Fiori elements protocol cases from a HAR (D79)", () => {
  it("finds the service root and reads relative URLs", () => {
    expect(serviceRootOf(`${HOST}${SRV}Travel?$top=1`)).toBe(SRV);
    expect(serviceRootOf(`${HOST}/resources/sap-ui-core.js`)).toBeUndefined();
    expect(relativeUrl(`${HOST}${SRV}Travel?$filter=Description%20eq%20%27a%27`, SRV)).toBe("Travel?$filter=Description eq 'a'");
  });

  it("parses multipart requests and responses, change sets included", () => {
    const body = "--b\r\nContent-Type: multipart/mixed; boundary=c\r\n\r\n--c\r\nContent-Type: application/http\r\nContent-ID: 1\r\n\r\nPATCH Travel(1) HTTP/1.1\r\nIf-Match: *\r\n\r\n{\"a\":1}\r\n--c--\r\n--b\r\nContent-Type: application/http\r\n\r\nGET Travel HTTP/1.1\r\n\r\n\r\n--b--\r\n";
    expect(parseMultipart(body, "multipart/mixed;boundary=b")).toEqual([
      { kind: "changeset", parts: [{ kind: "part", start: "PATCH Travel(1) HTTP/1.1", headers: { "if-match": "*" }, body: '{"a":1}', contentId: "1" }] },
      { kind: "part", start: "GET Travel HTTP/1.1", headers: {}, body: "" },
    ]);
  });

  it("keeps the structure of a response, not its values nor its texts", () => {
    const shape = responseShape(200, { "sap-messages": JSON.stringify([{ message: "text", numericSeverity: 3, target: "EndDate" }]) }, JSON.stringify({ "@odata.count": 2, value: [{ A: "secret", "A@Core.x": 1, B: 1 }] }));
    expect(shape).toEqual({ status: 200, properties: ["A", "B"], annotations: ["@odata.count"], headers: ["sap-messages"], messages: [{ numericSeverity: 3, target: "EndDate" }] });
    expect(JSON.stringify(shape)).not.toContain("secret");
    expect(JSON.stringify(shape)).not.toContain("text");
  });

  it("names the namespace of an advertised action by the placeholder {{NS}} (D89)", () => {
    const shape = responseShape(201, {}, JSON.stringify({ "#com.sap.gateway.srvd.zrt_ui_travelxyz.v0001.Edit": {}, TravelID: "1" }));
    expect(shape.properties).toEqual(["#{{NS}}.Edit", "TravelID"]);
  });

  it("keeps the values observed for the trial, without the users nor the keys (D99, round 2)", () => {
    const body = { "#com.sap.gateway.srvd.zrt_ui_travelxyz.v0001.Edit": {}, TravelID: "1", OverallStatus: "O", DraftAdministrativeData: { DraftEntityType: "ZRT_C_TRAVELXYZ", InProcessByUser: "CB0000001", DraftUUID: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" } };
    const shape = responseShape(201, {}, JSON.stringify(body), ["#*", "DraftAdministrativeData"]);
    expect(shape.observed).toEqual({ "#{{NS}}.Edit": {}, DraftAdministrativeData: { DraftEntityType: "ZRT_C_TRAVELXYZ", InProcessByUser: "{{user}}", DraftUUID: "{{uuid}}" } });
    expect(JSON.stringify(shape)).not.toContain("CB0000001");
    const failed = responseShape(412, { "sap-messages": JSON.stringify([{ message: "Travel 1 accepted", numericSeverity: 3 }]) }, JSON.stringify({ error: { code: "ZRT/002", message: "Travel 1 accepted" } }), ["error", "sap-messages"]);
    expect(failed.observed).toEqual({ error: { code: "ZRT/002", message: "Travel 1 accepted" }, "sap-messages": [{ message: "Travel 1 accepted", numericSeverity: 3 }] });
    expect(responseShape(200, {}, JSON.stringify(body)).observed).toBeUndefined();
  });

  it("turns a HAR into a case file: the requests of the service, keys as placeholders, no secret", () => {
    const { file, warnings } = harToCases(HAR, { scenario: "draft-object-page", floorplan: "objectPage", release: "2611", map: { [ACTIVE]: "T1" } });
    expect(file).toMatchObject({ scenario: "draft-object-page", floorplan: "objectPage", fixture: "travel-draft", source: "har", release: "2611" });
    const [c] = file.cases;
    expect(c.steps.map((s) => s.request?.method ?? "BATCH")).toEqual(["HEAD", "BATCH", "POST", "PATCH", "POST", "POST"]);
    const [head, batch, create, change, prepare, edit] = c.steps;
    expect(head.request).toEqual({ method: "HEAD", url: "", headers: {} });
    expect(batch.batch).toEqual([{ method: "GET", url: "Travel?$count=true&$filter=(IsActiveEntity eq false or SiblingEntity/IsActiveEntity eq null)&$top=30", headers: { Accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true" } }]);
    expect(batch.expect).toEqual([{ status: 200, properties: ["TravelUUID", "Description", "IsActiveEntity"], annotations: ["@odata.count"] }]);
    expect(create.capture).toEqual({ k1: "TravelUUID" });
    expect(create.expect).toEqual({ status: 201, properties: ["TravelUUID", "IsActiveEntity", "HasActiveEntity"], annotations: ["@odata.etag"], headers: ["location"] });
    expect(change.request).toEqual({ method: "PATCH", url: "Travel(TravelUUID={{k1}},IsActiveEntity=false)", headers: { "Content-Type": "application/json", "If-Match": "*" }, body: { Description: "Typed by the user" } });
    expect(prepare.expect).toMatchObject({ status: 200, headers: ["sap-messages"], messages: [{ numericSeverity: 4, target: "BeginDate" }] });
    // the namespace of the service changes with the suffix of the objects (D83)
    expect(edit.request.url).toBe("Travel(TravelUUID={{T1}},IsActiveEntity=true)/{{NS}}.Edit");
    expect(prepare.request.url).toBe("Travel(TravelUUID={{k1}},IsActiveEntity=false)/{{NS}}.Prepare");
    const text = JSON.stringify(file);
    for (const secret of ["SAP_SESSIONID", "c2VjcmV0", "sap-client", "abc123", "trial-example", "A text of the system", "Some private text", "sap-ui-core", "edmx"]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining("1 requests outside the service"), expect.stringContaining("request bodies are kept")]));
  });

  it("captures a key read in a list, and asks to map the keys only seen in requests", () => {
    // read in the list first: captured from the response
    const listed = harToCases(HAR, { scenario: "x", floorplan: "objectPage", release: "2611" }).file.cases[0].steps;
    expect(listed[1].capture).toEqual({ k1: "value/0/TravelUUID" });
    expect(listed[5].request.url).toContain("TravelUUID={{k1}}");
    // never read before: an instance of the SAP system
    const withoutList = { log: { entries: HAR.log.entries.filter((e) => !e.request.url.endsWith("$batch")) } };
    const { file, warnings } = harToCases(withoutList, { scenario: "x", floorplan: "objectPage", release: "2611" });
    expect(JSON.stringify(file)).toContain("{{key1}}");
    expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining("{{key1}}: a key of an instance of the SAP system")]));
  });

  it("refuses a file that is not a HAR of an SAP OData V4 service", () => {
    expect(() => harToCases({}, { scenario: "x" })).toThrow(/not a HAR/);
    expect(() => harToCases({ log: { entries: [entry("GET", "/other")] } }, { scenario: "x" })).toThrow(/no request to an SAP OData V4 service/);
  });

  it("writes the case file from the command line", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fe-har-"));
    try {
      writeFileSync(path.join(dir, "trial.har"), JSON.stringify(HAR));
      const out = path.join(dir, "case.json");
      const output = execFileSync("node", ["scripts/fe-har-to-cases.mjs", path.join(dir, "trial.har"), "--scenario", "draft-object-page", "--floorplan", "objectPage", "--release", "2611", "--map", `${ACTIVE}=T1`, "--out", out], { cwd: ROOT, encoding: "utf8" });
      expect(output).toContain("6 steps");
      expect(JSON.parse(readFileSync(out, "utf8")).cases[0].steps).toHaveLength(6);
      expect(() => execFileSync("node", ["scripts/fe-har-to-cases.mjs", path.join(dir, "trial.har")], { cwd: ROOT, stdio: "pipe" })).toThrow(/--scenario/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
