/**
 * OIDC against a real Keycloak (D28): the generated application with AUTH_MODE=oidc and the realm
 * it generates (docker compose --profile oidc). The browser login (authorization code with PKCE,
 * the Keycloak login form), the session cookie on the UI and the OData service with its CSRF
 * token, the logout; and bearer tokens issued by Keycloak, checked with its JWKS.
 *
 * Runs when RAPT_E2E_OIDC_APP (the application) and RAPT_E2E_OIDC_KEYCLOAK (Keycloak) are set,
 * e.g. by the docker job of the CI; RAPT_E2E_OIDC_ADMIN (`user:password`, default admin:admin)
 * is the bootstrap administrator, used to create a client for the password grant.
 */

import { describe, expect, it } from "vitest";

const APP = (process.env["RAPT_E2E_OIDC_APP"] ?? "").replace(/\/$/, "");
const KEYCLOAK = (process.env["RAPT_E2E_OIDC_KEYCLOAK"] ?? "").replace(/\/$/, "");
const [ADMIN_USER = "admin", ADMIN_PASSWORD = "admin"] = (process.env["RAPT_E2E_OIDC_ADMIN"] ?? "admin:admin").split(":");
const SERVICE = "/sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001/";
const REALM = `${KEYCLOAK}/realms/rapt`;

/** A browser's cookies, per origin. */
class Browser {
  private readonly jar = new Map<string, Map<string, string>>();

  public async get(url: string, init: RequestInit = {}): Promise<Response> {
    const origin = new URL(url).origin;
    const cookies = [...(this.jar.get(origin) ?? new Map<string, string>())].map(([n, v]) => `${n}=${v}`).join("; ");
    const headers = new Headers(init.headers);
    if (cookies !== "") {
      headers.set("cookie", cookies);
    }
    const response = await fetch(url, { ...init, headers, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ""] = cookie.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const jar = this.jar.get(origin) ?? new Map<string, string>();
      if (value === "" || /max-age=0\b/i.test(cookie) || /expires=Thu, 01 Jan 1970/i.test(cookie)) {
        jar.delete(name);
      } else {
        jar.set(name, value);
      }
      this.jar.set(origin, jar);
    }
    return response;
  }

  /** Follows the redirects of a GET; returns the last response and its URL. */
  public async follow(url: string, limit = 10): Promise<{ response: Response; url: string }> {
    let current = url;
    for (let i = 0; i < limit; i++) {
      const response = await this.get(current);
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || location === null) {
        return { response, url: current };
      }
      current = new URL(location, current).href;
    }
    throw new Error(`too many redirects from ${url}`);
  }
}

const decode = (html: string): string => html.replace(/&amp;/g, "&").replace(/&#x3d;/gi, "=").replace(/&quot;/g, '"');

/** Logs in through the Keycloak login form; returns the browser with its session cookie. */
async function login(returnTo = "/ui/index.html"): Promise<{ browser: Browser; landed: Response; url: string }> {
  const browser = new Browser();
  const page = await browser.follow(`${APP}${returnTo}`);
  expect(page.url.startsWith(`${REALM}/protocol/openid-connect/auth?`), page.url).toBe(true);
  const html = await page.response.text();
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1];
  expect(action, "the Keycloak login form").toBeDefined();
  const submitted = await browser.get(decode(action as string), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "alice", password: "alice", credentialId: "" }).toString(),
  });
  expect(submitted.status, await submitted.clone().text()).toBe(302);
  const callback = submitted.headers.get("location") ?? "";
  expect(callback.startsWith(`${APP}/auth/callback?`), callback).toBe(true);
  const { response, url } = await browser.follow(callback);
  return { browser, landed: response, url };
}

/** A bearer token of alice: a public client with the password grant, created by the administrator. */
async function bearerToken(): Promise<string> {
  const admin = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: ADMIN_USER, password: ADMIN_PASSWORD }).toString(),
  });
  expect(admin.status).toBe(200);
  const adminToken = ((await admin.json()) as { access_token: string }).access_token;
  const created = await fetch(`${KEYCLOAK}/admin/realms/rapt/clients`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ clientId: `rapt-api-test-${Date.now()}`, publicClient: true, directAccessGrantsEnabled: true, standardFlowEnabled: false }),
  });
  expect([201, 409]).toContain(created.status);
  const clientId = (await (await fetch(created.headers.get("location") ?? "", { headers: { authorization: `Bearer ${adminToken}` } })).json()) as { clientId: string };
  const token = await fetch(`${REALM}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: clientId.clientId, username: "alice", password: "alice", scope: "openid" }).toString(),
  });
  expect(token.status).toBe(200);
  return ((await token.json()) as { access_token: string }).access_token;
}

describe.skipIf(APP === "" || KEYCLOAK === "")("OIDC with a real Keycloak", () => {
  it("refuses the service without a token or a session", async () => {
    const response = await fetch(`${APP}${SERVICE}Travel`);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("logs in through Keycloak (authorization code with PKCE) and opens a session", async () => {
    const { browser, landed, url } = await login();
    expect(url).toBe(`${APP}/ui/index.html`);
    expect(landed.status).toBe(200);
    const me = (await (await browser.get(`${APP}/auth/me`)).json()) as Record<string, unknown>;
    expect(me).toMatchObject({ authenticated: true, name: "Alice Example", roles: expect.arrayContaining(["rapt_user"]) });

    // the OData service with the session: CSRF token, then a creation by alice
    const fetched = await browser.get(`${APP}${SERVICE}`, { method: "HEAD", headers: { "x-csrf-token": "Fetch" } });
    const token = fetched.headers.get("x-csrf-token") ?? "";
    expect(token).not.toBe("");
    const refused = await browser.get(`${APP}${SERVICE}Travel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(refused.status).toBe(403);
    const created = await browser.get(`${APP}${SERVICE}Travel`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": token, accept: "application/json;IEEE754Compatible=true" },
      body: JSON.stringify({ TravelID: "00000501", AgencyID: "070001", CustomerID: "000001", BeginDate: "2027-05-01", EndDate: "2027-05-08", BookingFee: "40.00", CurrencyCode: "EUR", Description: "Created by alice" }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    expect(await created.json()).toMatchObject({ CreatedBy: "ALICE", TotalPrice: "40.00" });
  });

  it("logs out of the application and of Keycloak", async () => {
    const { browser } = await login();
    const logout = await browser.get(`${APP}/auth/logout`);
    expect(logout.status).toBe(302);
    const target = logout.headers.get("location") ?? "";
    expect(target.startsWith(`${REALM}/protocol/openid-connect/logout`), target).toBe(true);
    // the session cookie is gone: the UI asks for a login again
    const again = await browser.get(`${APP}/ui/index.html`);
    expect(again.status).toBe(302);
    expect(again.headers.get("location")).toContain("/auth/login");
  });

  it("accepts the bearer tokens of Keycloak, checked with its JWKS", async () => {
    const token = await bearerToken();
    const read = await fetch(`${APP}${SERVICE}Travel?$select=TravelID,CreatedBy&$filter=TravelID eq '00000501'`, { headers: { authorization: `Bearer ${token}` } });
    expect(read.status).toBe(200);
    expect(((await read.json()) as { value: unknown[] }).value).toEqual([expect.objectContaining({ TravelID: "00000501", CreatedBy: "ALICE" })]);
    const forged = await fetch(`${APP}${SERVICE}Travel`, { headers: { authorization: `Bearer ${token.slice(0, -4)}AAAA` } });
    expect(forged.status).toBe(401);
  });
});
