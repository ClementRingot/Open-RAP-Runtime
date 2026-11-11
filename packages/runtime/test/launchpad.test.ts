/**
 * The launchpad of applications (D37): the tiles of the roles of the user, the navigation by
 * intent, and the fixture application behind it — its UI at /apps/travel/, its service at its
 * path — reading the session the launchpad opened (single sign-on, against an OIDC provider
 * written for the test), with its own authorizations and access controls.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import type { LaunchpadModel } from "@rap-transpiler/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OidcAuthOptions } from "../src/auth/auth.js";
import { signSession } from "../src/auth/session.js";
import { createLaunchpad } from "../src/launchpad/server.js";
import { rewriteLocation, targetUrl } from "../src/launchpad/proxy.js";
import { fixtureApp, generatedFixture, SERVICE, T1, testLaunchpad, writableApp, type TestApp } from "./helpers.js";

const RUNTIME_DIR = fileURLToPath(new URL("..", import.meta.url));
const SECRET = "a-secret-shared-by-the-launchpad-and-its-apps";
const LAUNCHPAD_URL = "http://launchpad.test/";

let provider: FastifyInstance;
let issuer: string;
let privateKey: CryptoKey;
/** The user the provider logs in next. */
let next: { name: string; username: string; roles: string[]; agency?: string } = { name: "Alice Example", username: "alice", roles: ["travel_agent"], agency: "070001" };
const codes = new Map<string, { nonce: string; challenge: string; redirect: string }>();

let app: TestApp;
let appUrl: string;
let config: LaunchpadModel;
let uiDir: string;
let launchpad: FastifyInstance;
let oidc: OidcAuthOptions;

const sign = (claims: Record<string, unknown>, audience: string): Promise<string> =>
  new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(issuer).setAudience(audience).setSubject(`u-${String(claims["preferred_username"])}`).setIssuedAt().setExpirationTime("1h").sign(privateKey);

beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  provider = Fastify();
  provider.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_r, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));
  provider.get("/.well-known/openid-configuration", async () => ({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, end_session_endpoint: `${issuer}/logout` }));
  provider.get("/jwks", async () => ({ keys: [jwk] }));
  provider.get("/authorize", async (request, reply) => {
    const q = request.query as Record<string, string>;
    const code = randomBytes(12).toString("hex");
    codes.set(code, { nonce: q["nonce"] ?? "", challenge: q["code_challenge"] ?? "", redirect: q["redirect_uri"] ?? "" });
    return reply.redirect(`${q["redirect_uri"]}?code=${code}&state=${encodeURIComponent(q["state"] ?? "")}`);
  });
  provider.post("/token", async (request, reply) => {
    const body = request.body as Record<string, string>;
    const pending = codes.get(body["code"] ?? "");
    if (pending === undefined || createHash("sha256").update(body["code_verifier"] ?? "").digest("base64url") !== pending.challenge || body["redirect_uri"] !== pending.redirect) {
      return reply.status(400).send({ error: "invalid_grant" });
    }
    const user = { preferred_username: next.username, name: next.name, ...(next.agency === undefined ? {} : { agency: next.agency }) };
    return {
      token_type: "Bearer",
      id_token: await sign({ ...user, nonce: pending.nonce }, "rapt-launchpad"),
      access_token: await sign({ ...user, realm_access: { roles: next.roles } }, "account"),
    };
  });
  await provider.listen({ port: 0, host: "127.0.0.1" });
  issuer = `http://127.0.0.1:${(provider.server.address() as { port: number }).port}`;

  // the application and the launchpad: the same issuer, client and session secret
  oidc = { mode: "oidc", issuer, attributeClaims: ["agency"], session: { clientId: "rapt-launchpad", clientSecret: "s3cret", baseUrl: LAUNCHPAD_URL, secret: SECRET } };
  const fixture = generatedFixture();
  const dir = (await fixture).dir;
  app = await writableApp(fixture, { auth: oidc, csrfSecret: SECRET, ui: { dir: path.join(dir, "ui"), resourcesFrom: RUNTIME_DIR } });
  await app.app.listen({ port: 0, host: "127.0.0.1" });
  appUrl = `http://127.0.0.1:${(app.app.server.address() as { port: number }).port}/`;
  ({ config, uiDir } = testLaunchpad(dir, appUrl));
  launchpad = await createLaunchpad({ config, auth: oidc, ui: { dir: uiDir, resourcesFrom: RUNTIME_DIR } });
  await launchpad.ready();
}, 180_000);

afterAll(async () => {
  await launchpad?.close();
  await app?.close();
  await provider?.close();
});

const cookieOf = (setCookie: string | string[] | undefined, name: string): string | undefined => {
  const all = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
  const found = all.find((c) => c.startsWith(`${name}=`));
  return found?.split(";")[0];
};

/** The login at the launchpad: /auth/login, the provider, /auth/callback; the session cookie. */
async function login(returnTo: string): Promise<{ cookie: string; location: string }> {
  const start = await launchpad.inject({ method: "GET", url: `/auth/login?returnTo=${encodeURIComponent(returnTo)}` });
  expect(start.statusCode).toBe(302);
  const state = cookieOf(start.headers["set-cookie"], "rapt_oidc") as string;
  const authorize = await fetch(start.headers.location as string, { redirect: "manual" });
  const callback = new URL(authorize.headers.get("location") as string);
  expect(callback.origin + callback.pathname).toBe(`${LAUNCHPAD_URL}auth/callback`);
  const done = await launchpad.inject({ method: "GET", url: `${callback.pathname}${callback.search}`, headers: { cookie: state } });
  expect(done.statusCode, done.body).toBe(302);
  return { cookie: cookieOf(done.headers["set-cookie"], "rapt_session") as string, location: done.headers.location as string };
}

const titles = (body: string): string[] => (JSON.parse(body) as { groups: Array<{ tiles: Array<{ title: string }> }> }).groups.flatMap((g) => g.tiles.map((t) => t.title));

describe("tiles of the roles of the user", () => {
  it("shows the tiles assigned to a role of the user, and those without role to everyone", async () => {
    for (const [roles, expected] of [
      [["travel_viewer"], ["Manage Travels", "Documentation"]],
      [["travel_manager"], ["Manage Travels", "Open Travels", "Documentation"]],
      [[], ["Documentation"]],
      [undefined, ["Manage Travels", "Open Travels", "Documentation"]],
    ] as Array<[string[] | undefined, string[]]>) {
      const dev = await createLaunchpad({ config, auth: { mode: "none", user: "VICTOR", ...(roles === undefined ? {} : { roles }) } });
      const response = await dev.inject({ method: "GET", url: "/launchpad/config" });
      expect(response.statusCode).toBe(200);
      expect(titles(response.body), JSON.stringify(roles)).toEqual(expected);
      await dev.close();
    }
  });

  it("describes the tiles for the UI: target, intent, count; no role, no application", async () => {
    const dev = await createLaunchpad({ config, auth: { mode: "none" } });
    const view = JSON.parse((await dev.inject({ method: "GET", url: "/launchpad/config" })).body) as { title: string; user: unknown; logout?: string; groups: Array<{ title: string; tiles: Array<Record<string, unknown>> }> };
    await dev.close();
    expect(view.title).toBe("Travel Agency");
    expect(view.user).toEqual({ id: "DEVELOPER", name: "DEVELOPER", initials: "DE" });
    expect(view.logout).toBeUndefined();
    expect(view.groups.map((g) => g.title)).toEqual(["Travel Management", "Help"]);
    expect(view.groups[0]?.tiles[0]).toEqual({ id: "travel-manage", title: "Manage Travels", subtitle: "Travels and bookings", icon: "sap-icon://flight", intent: "Travel-manage", target: "/apps/travel/ui/index.html", external: false, count: `${SERVICE}Travel/$count` });
    expect(view.groups[0]?.tiles[1]?.["count"]).toBe(`${SERVICE}Travel/$count?$filter=OverallStatus%20eq%20'O'`);
    expect(view.groups[1]?.tiles[0]).toMatchObject({ target: "https://github.com/clementringot/rap-transpiler", external: true });
  });
});

describe("single sign-on: the applications read the session of the launchpad", () => {
  it("sends the pages to the login of the launchpad, and the API calls an error", async () => {
    const home = await launchpad.inject({ method: "GET", url: "/" });
    expect(home.statusCode).toBe(302);
    expect(home.headers.location).toBe("/auth/login?returnTo=%2Fui%2Findex.html");
    const page = await launchpad.inject({ method: "GET", url: "/apps/travel/ui/index.html" });
    expect(page.headers.location).toBe("/auth/login?returnTo=%2Fapps%2Ftravel%2Fui%2Findex.html");
    const api = await launchpad.inject({ method: "GET", url: `${SERVICE}Travel` });
    expect(api.statusCode).toBe(401);
    expect(JSON.parse(api.body)).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    expect((await launchpad.inject({ method: "GET", url: "/launchpad/config" })).statusCode).toBe(401);
  });

  it("logs in at the launchpad; the application reads the session, its claims and its roles", async () => {
    next = { name: "Alice Example", username: "alice", roles: ["travel_agent"], agency: "070001" };
    const { cookie, location } = await login("/apps/travel/ui/index.html");
    expect(location).toBe("/apps/travel/ui/index.html");
    const headers = { cookie };
    const view = JSON.parse((await launchpad.inject({ method: "GET", url: "/launchpad/config", headers })).body) as { user: unknown; logout: string };
    expect(view.user).toEqual({ id: "alice", name: "Alice Example", initials: "AE" });
    expect(view.logout).toBe("/auth/logout");
    expect(titles((await launchpad.inject({ method: "GET", url: "/launchpad/config", headers })).body)).toEqual(["Manage Travels", "Documentation"]);

    // the UI of the application, forwarded to it with the session
    const ui = await launchpad.inject({ method: "GET", url: "/apps/travel/ui/index.html", headers });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers["content-type"]).toContain("text/html");
    expect(ui.body).toContain('data-name="rapt.app"');
    // its service at its own path: the access controls of the application for the agency of the claim
    const travels = await launchpad.inject({ method: "GET", url: `${SERVICE}Travel?$select=TravelID,AgencyID`, headers });
    expect(travels.statusCode, travels.body).toBe(200);
    expect((JSON.parse(travels.body) as { value: Array<{ AgencyID: string }> }).value.map((t) => t.AgencyID)).toEqual(["070001"]);
    const count = await launchpad.inject({ method: "GET", url: `${SERVICE}Travel/$count`, headers });
    expect(count.body).toBe("1");
  });

  it("forwards the writes with the CSRF token of the session, under the authorizations of the application", async () => {
    next = { name: "Alice Example", username: "alice", roles: ["travel_agent"], agency: "070001" };
    const { cookie } = await login("/");
    const fetchToken = await launchpad.inject({ method: "HEAD", url: SERVICE, headers: { cookie, "x-csrf-token": "Fetch" } });
    const token = fetchToken.headers["x-csrf-token"] as string;
    expect(token).toBeTruthy();
    const json = { cookie, "x-csrf-token": token, "content-type": "application/json", accept: "application/json", "if-match": "*" };
    const changed = await launchpad.inject({ method: "PATCH", url: `${SERVICE}Travel(${T1})`, headers: json, payload: JSON.stringify({ Description: "Changed through the launchpad" }) });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(JSON.parse(changed.body)).toMatchObject({ Description: "Changed through the launchpad", LastChangedBy: "ALICE" });
    // an agent may not create (no activity 01): the answer of the application comes back as is
    const created = await launchpad.inject({ method: "POST", url: `${SERVICE}Travel`, headers: json, payload: JSON.stringify({ TravelID: "00000090", AgencyID: "070001", CustomerID: "000001", BeginDate: "2027-05-01", EndDate: "2027-05-08", BookingFee: "10.00", CurrencyCode: "EUR" }) });
    expect(created.statusCode).toBe(403);
    // without the token: refused by the application
    const forged = await launchpad.inject({ method: "PATCH", url: `${SERVICE}Travel(${T1})`, headers: { ...json, "x-csrf-token": "forged" }, payload: JSON.stringify({ Description: "forged" }) });
    expect(forged.statusCode).toBe(403);
  });

  it("forwards the bearer tokens of API clients", async () => {
    const token = await sign({ preferred_username: "victor", realm_access: { roles: ["travel_viewer"] } }, "account");
    const count = await launchpad.inject({ method: "GET", url: `${SERVICE}Travel/$count`, headers: { authorization: `Bearer ${token}` } });
    expect(count.statusCode, count.body).toBe(200);
    // the agencies 07…: every travel of the fixture
    expect(count.body).toBe("3");
  });

  it("rewrites the redirections of the applications below their mount path", async () => {
    const cookie = `rapt_session=${encodeURIComponent(signSession({ id: "victor", abapName: "VICTOR", roles: ["travel_viewer"], authenticatedBy: "session" }, SECRET))}`;
    const root = await launchpad.inject({ method: "GET", url: "/apps/travel/", headers: { cookie } });
    expect(root.statusCode).toBe(302);
    expect(root.headers.location).toBe("/apps/travel/ui/index.html");
    expect((await launchpad.inject({ method: "GET", url: "/apps/travel", headers: { cookie } })).headers.location).toBe("/apps/travel/");
    expect(rewriteLocation("/ui/index.html", "/apps/travel")).toBe("/apps/travel/ui/index.html");
    expect(rewriteLocation("/auth/login?returnTo=%2Fui%2Findex.html", "/apps/travel")).toBe("/auth/login?returnTo=%2Fapps%2Ftravel%2Fui%2Findex.html");
    expect(rewriteLocation("https://idp.example/logout", "/apps/travel")).toBe("https://idp.example/logout");
    expect(rewriteLocation("//other.example/x", "/apps/travel")).toBe("//other.example/x");
  });

  it("never sends a request to another host than the application's", async () => {
    const base = new URL("http://app.internal:8080/");
    expect(targetUrl(base, "/ui/index.html?x=1").href).toBe("http://app.internal:8080/ui/index.html?x=1");
    expect(targetUrl(base, "/http://other.example/x").host).toBe("app.internal:8080");
    expect(targetUrl(base, "//other.example/x").host).toBe("app.internal:8080");
    expect(targetUrl(new URL("http://app.internal:8080/base/"), "/ui/").href).toBe("http://app.internal:8080/base/ui/");
    // through the launchpad: the path goes to the application, not to the provider
    const cookie = `rapt_session=${encodeURIComponent(signSession({ id: "victor", abapName: "VICTOR", roles: ["travel_viewer"], authenticatedBy: "session" }, SECRET))}`;
    const response = await launchpad.inject({ method: "GET", url: `/apps/travel/${issuer}/jwks`, headers: { cookie } });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("keys");
  });
});

describe("navigation by intent", () => {
  it("opens the application of the first tile of the user with the intent, with its parameters", async () => {
    const cookie = `rapt_session=${encodeURIComponent(signSession({ id: "victor", abapName: "VICTOR", roles: ["travel_viewer"], authenticatedBy: "session" }, SECRET))}`;
    const go = await launchpad.inject({ method: "GET", url: `/go/Travel-manage?TravelID=00000001`, headers: { cookie } });
    expect(go.statusCode).toBe(302);
    expect(go.headers.location).toBe("/apps/travel/ui/index.html?TravelID=00000001");
    // a tile the viewer does not see, an unknown intent
    expect((await launchpad.inject({ method: "GET", url: "/go/Travel-approve", headers: { cookie } })).statusCode).toBe(404);
    expect((await launchpad.inject({ method: "GET", url: "/go/Flight-book", headers: { cookie } })).statusCode).toBe(404);
    // without a session: the login first, back to the intent
    expect((await launchpad.inject({ method: "GET", url: "/go/Travel-manage" })).headers.location).toBe("/auth/login?returnTo=%2Fgo%2FTravel-manage");
  });
});

describe("applications that are not reachable, roles the applications require", () => {
  it("answers 502 for an application that does not answer", async () => {
    const port = await new Promise<number>((resolve) => {
      const server = createServer().listen(0, "127.0.0.1", () => {
        const { port } = server.address() as { port: number };
        server.close(() => resolve(port));
      });
    });
    const down = await createLaunchpad({ config, auth: { mode: "none" }, appUrls: { travel: `http://127.0.0.1:${port}/` } });
    const api = await down.inject({ method: "GET", url: `${SERVICE}Travel` });
    expect(api.statusCode).toBe(502);
    expect(JSON.parse(api.body)).toEqual({ error: { code: "BAD_GATEWAY", message: "The application travel is not reachable" } });
    const page = await down.inject({ method: "GET", url: "/apps/travel/ui/index.html" });
    expect(page.statusCode).toBe(502);
    await down.close();
  });

  it("checks the role an application requires on the sessions of the launchpad", async () => {
    const strict = await fixtureApp({ auth: { ...oidc, requiredRole: "travel_manager" }, csrfSecret: SECRET });
    try {
      const session = (roles: string[]): string => `rapt_session=${encodeURIComponent(signSession({ id: "victor", abapName: "VICTOR", roles, authenticatedBy: "session" }, SECRET))}`;
      const refused = await strict.app.inject({ method: "GET", url: `${SERVICE}Travel/$count`, headers: { cookie: session(["travel_viewer"]) } });
      expect(refused.statusCode).toBe(403);
      expect(refused.body).toContain("the role travel_manager is required");
      expect((await strict.app.inject({ method: "GET", url: `${SERVICE}Travel/$count`, headers: { cookie: session(["travel_manager"]) } })).statusCode).toBe(200);
      // the UI: no login loop, a 403
      const ui = await strict.app.inject({ method: "GET", url: "/ui/index.html", headers: { cookie: session(["travel_viewer"]) } });
      expect(ui.statusCode).toBe(403);
    } finally {
      await strict.close();
    }
  });
});
