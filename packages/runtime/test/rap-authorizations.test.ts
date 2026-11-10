/**
 * Authorizations (D34): the handlers of the reference BO use AUTHORITY-CHECK on the
 * authorization object ZAO_TRAVL (activity, agency) as on SAP; the roles of the token give the
 * authorizations of fixtures/travel/rapt/authorizations.json, an agent's agency comes from a claim
 * of the token.
 */

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVICE, T1, T2, writableApp, type TestApp } from "./helpers.js";

const ISSUER = "https://idp.example.test/realms/rapt";
const NS = "com.sap.gateway.srvd.zrt_ui_travel.v0001";
const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8;IEEE754Compatible=true", accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true", "if-match": "*" };

let t: TestApp;
let tokenOf: (user: string, roles: string[], claims?: Record<string, unknown>) => Promise<string>;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  tokenOf = (user, roles, claims = {}) =>
    new SignJWT({ preferred_username: user, realm_access: { roles }, ...claims }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISSUER).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  t = await writableApp(undefined, { auth: { mode: "oidc", issuer: ISSUER, jwks: createLocalJWKSet({ keys: [jwk] }), attributeClaims: ["agency"] } });
}, 180_000);

afterAll(async () => {
  await t?.close();
});

async function as(token: string, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await t.app.inject({ method, url: `${SERVICE}${path}`, headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

const travel = { TravelID: "00000070", AgencyID: "070001", CustomerID: "000001", BeginDate: "2027-05-01", EndDate: "2027-05-08", BookingFee: "10.00", CurrencyCode: "EUR" };

describe("AUTHORITY-CHECK with the roles of the token", () => {
  it("lets a manager create and change the travels of every agency", async () => {
    const manager = await tokenOf("mona", ["travel_manager"]);
    expect((await as(manager, "PATCH", `Travel(${T2})`, { Description: "by the manager" })).status).toBe(200);
    const created = await as(manager, "POST", "Travel", travel);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body["CreatedBy"]).toBe("MONA");
  });

  it("lets an agent change the travels of the agency of the token only (instance authorization)", async () => {
    const agent = await tokenOf("alice", ["travel_agent"], { agency: "070001" });
    // T1 belongs to the agency 070001, T2 to 070002
    expect((await as(agent, "PATCH", `Travel(${T1})`, { Description: "by the agent" })).status).toBe(200);
    expect((await as(agent, "PATCH", `Travel(${T2})`, { Description: "by the agent" })).status).toBe(403);
    expect((await as(agent, "POST", `Travel(${T2})/${NS}.deductDiscount`, { DiscountPercent: 10 })).status).toBe(403);
    // no activity 01: no creation, no copy
    expect((await as(agent, "POST", "Travel", { ...travel, TravelID: "00000071" })).status).toBe(403);
    expect((await as(agent, "POST", `Travel(${T1})/${NS}.copyTravel`, {})).status).toBe(403);
  });

  it("refuses the changes to a viewer, and everything to a user without role", async () => {
    const viewer = await tokenOf("victor", ["travel_viewer"]);
    expect((await as(viewer, "GET", `Travel(${T1})?$select=TravelID`)).status).toBe(200);
    expect((await as(viewer, "PATCH", `Travel(${T1})`, { Description: "by the viewer" })).status).toBe(403);
    expect((await as(viewer, "DELETE", `Travel(${T1})`)).status).toBe(403);
    const nobody = await tokenOf("nina", []);
    expect((await as(nobody, "PATCH", `Travel(${T1})`, { Description: "by nobody" })).status).toBe(403);
    // the description is the one of the agent
    const read = await as(viewer, "GET", `Travel(${T1})?$select=Description`);
    expect(read.body["Description"]).toBe("by the agent");
  });

  it("evaluates the claim of each token: another agency, another agent", async () => {
    const other = await tokenOf("bruno", ["travel_agent"], { agency: ["070002", "070003"] });
    expect((await as(other, "PATCH", `Travel(${T2})`, { Description: "by the other agent" })).status).toBe(200);
    expect((await as(other, "PATCH", `Travel(${T1})`, { Description: "by the other agent" })).status).toBe(403);
    // an agent without the claim has no agency
    const lost = await tokenOf("lucas", ["travel_agent"]);
    expect((await as(lost, "PATCH", `Travel(${T2})`, { Description: "by nobody" })).status).toBe(403);
  });
});
