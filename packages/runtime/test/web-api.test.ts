/**
 * OData V4 - Web API (D60): the Travel fixture with draft, bound as a Web API (no UI information,
 * the active instances only), called with the tokens of the development OAuth 2.0 server:
 * client credentials (a technical user) and authorization code with PKCE (a user).
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DRAFT_CHANGES, edit, generatedVariant, SERVICE, T1, writableApp, type GeneratedFixture, type TestApp } from "./helpers.js";

let fixture: GeneratedFixture;
let t: TestApp;

beforeAll(async () => {
  fixture = await generatedVariant({
    ...DRAFT_CHANGES,
    "zrt_ui_travel_o4.srvb.xml": (c) => edit(c, [["<BINDING_TYPE_CATEGORY>0</BINDING_TYPE_CATEGORY>", "<BINDING_TYPE_CATEGORY>1</BINDING_TYPE_CATEGORY>"]]),
  });
  t = await writableApp(Promise.resolve(fixture), { devOAuth: true });
}, 180_000);

afterAll(async () => {
  await t?.close();
});

const form = (values: Record<string, string>): string => new URLSearchParams(values).toString();
const FORM = { "content-type": "application/x-www-form-urlencoded" };

async function token(values: Record<string, string>, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await t.app.inject({ method: "POST", url: "/oauth/token", headers: { ...FORM, ...headers }, payload: form(values) });
  return { status: response.statusCode, body: JSON.parse(response.body) as Record<string, unknown> };
}

describe("Web API", () => {
  it("has no UI information, no draft and no UI", () => {
    expect(fixture.model.service.webApi).toBe(true);
    expect(fixture.metadata).not.toMatch(/Term="UI\./);
    expect(fixture.metadata).not.toContain("Common.ValueList");
    expect(fixture.metadata).not.toContain("IsActiveEntity");
    expect(fixture.metadata).not.toContain("__OperationControl");
    expect(fixture.metadata).toContain('<EntitySet Name="Travel"');
    expect(existsSync(path.join(fixture.dir, "ui"))).toBe(false);
  });

  it("is called with a client credentials token: the technical user of the client", async () => {
    const wrong = await token({ grant_type: "client_credentials", client_id: "rapt-client", client_secret: "nope" });
    expect(wrong.status).toBe(401);
    const basic = Buffer.from("rapt-client:rapt-secret").toString("base64");
    const issued = await token({ grant_type: "client_credentials" }, { authorization: `Basic ${basic}` });
    expect(issued.status).toBe(200);
    expect(issued.body).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    const bearer = { authorization: `Bearer ${String(issued.body["access_token"])}`, "content-type": "application/json", "if-match": "*" };
    const changed = await t.app.inject({ method: "PATCH", url: `${SERVICE}Travel(${T1})`, headers: bearer, payload: JSON.stringify({ Description: "Changed by an API client" }) });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(JSON.parse(changed.body)).toMatchObject({ Description: "Changed by an API client", LastChangedBy: "RAPT-CLIENT" });
    const invalid = await t.app.inject({ method: "GET", url: `${SERVICE}Travel`, headers: { authorization: "Bearer not-a-token" } });
    expect(invalid.statusCode).toBe(401);
  });

  it("is called with an authorization code and PKCE: the user who signed in", async () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const redirect = "http://localhost:3000/callback";
    const page = await t.app.inject({ method: "GET", url: `/oauth/authorize?response_type=code&client_id=rapt-pkce&redirect_uri=${encodeURIComponent(redirect)}&state=xyz&code_challenge=${challenge}&code_challenge_method=S256` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("rapt dev sign-in");
    // without PKCE: refused
    expect((await t.app.inject({ method: "GET", url: `/oauth/authorize?response_type=code&client_id=rapt-pkce&redirect_uri=${encodeURIComponent(redirect)}` })).statusCode).toBe(400);
    const signIn = await t.app.inject({ method: "POST", url: "/oauth/authorize", headers: FORM, payload: form({ client_id: "rapt-pkce", redirect_uri: redirect, state: "xyz", code_challenge: challenge, user: "MARIE", roles: "*" }) });
    expect(signIn.statusCode).toBe(302);
    const location = new URL(String(signIn.headers["location"]));
    expect(location.searchParams.get("state")).toBe("xyz");
    const code = location.searchParams.get("code") ?? "";
    expect((await token({ grant_type: "authorization_code", client_id: "rapt-pkce", code, redirect_uri: redirect, code_verifier: "wrong" })).status).toBe(400);
    // the code was used: a new one
    const again = await t.app.inject({ method: "POST", url: "/oauth/authorize", headers: FORM, payload: form({ client_id: "rapt-pkce", redirect_uri: redirect, code_challenge: challenge, user: "MARIE" }) });
    const code2 = new URL(String(again.headers["location"])).searchParams.get("code") ?? "";
    const issued = await token({ grant_type: "authorization_code", client_id: "rapt-pkce", code: code2, redirect_uri: redirect, code_verifier: verifier });
    expect(issued.status).toBe(200);
    const read = await t.app.inject({ method: "PATCH", url: `${SERVICE}Travel(${T1})`, headers: { authorization: `Bearer ${String(issued.body["access_token"])}`, "content-type": "application/json", "if-match": "*" }, payload: JSON.stringify({ Description: "Changed by Marie" }) });
    expect(read.statusCode, read.body).toBe(200);
    expect(JSON.parse(read.body)).toMatchObject({ LastChangedBy: "MARIE" });
    const discovery = await t.app.inject({ method: "GET", url: "/oauth/.well-known/openid-configuration", headers: { host: "api.example.com" } });
    expect(JSON.parse(discovery.body)).toMatchObject({ issuer: "http://api.example.com/oauth", token_endpoint: "http://api.example.com/oauth/token", code_challenge_methods_supported: ["S256"] });
  });
});
