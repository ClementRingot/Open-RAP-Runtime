/**
 * Browser sessions: the authorization code flow with PKCE against a small OIDC provider written
 * for the test (discovery, authorize, token, JWKS), then the session cookie on the service, the
 * CSRF token bound to the session, and the logout.
 */

import { createHash, randomBytes } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtureApp, SERVICE, type TestApp } from "./helpers.js";

let provider: FastifyInstance;
let issuer: string;
let t: TestApp;
let privateKey: CryptoKey;
const codes = new Map<string, { nonce: string; challenge: string; redirect: string }>();

beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  provider = Fastify();
  provider.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_r, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));
  provider.get("/.well-known/openid-configuration", async () => ({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    end_session_endpoint: `${issuer}/logout`,
  }));
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
    const verifier = body["code_verifier"] ?? "";
    if (pending === undefined || createHash("sha256").update(verifier).digest("base64url") !== pending.challenge || body["redirect_uri"] !== pending.redirect) {
      return reply.status(400).send({ error: "invalid_grant" });
    }
    if (request.headers.authorization !== `Basic ${Buffer.from("rapt-app:s3cret").toString("base64")}`) {
      return reply.status(401).send({ error: "invalid_client" });
    }
    const sign = (claims: Record<string, unknown>, audience: string) =>
      new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(issuer).setAudience(audience).setSubject("u-1").setIssuedAt().setExpirationTime("1h").sign(privateKey);
    return {
      token_type: "Bearer",
      id_token: await sign({ nonce: pending.nonce, preferred_username: "alice", name: "Alice Example", email: "alice@example.org" }, "rapt-app"),
      access_token: await sign({ preferred_username: "alice", realm_access: { roles: ["travel_user"] } }, "account"),
    };
  });
  await provider.listen({ port: 0, host: "127.0.0.1" });
  issuer = `http://127.0.0.1:${(provider.server.address() as { port: number }).port}`;
  t = await fixtureApp({
    auth: { mode: "oidc", issuer, session: { clientId: "rapt-app", clientSecret: "s3cret", baseUrl: "http://app.example/", secret: "a-session-secret-of-at-least-32-chars" } },
  });
}, 60_000);

afterAll(async () => {
  await t?.close();
  await provider?.close();
});

const cookieOf = (setCookie: string | string[] | undefined, name: string): string | undefined => {
  for (const line of Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie]) {
    const m = new RegExp(`^${name}=([^;]*)`).exec(line);
    if (m !== null) return `${name}=${m[1]}`;
  }
  return undefined;
};

async function login(): Promise<string> {
  const start = await t.app.inject({ method: "GET", url: "/auth/login?returnTo=%2Fui%2Findex.html" });
  expect(start.statusCode).toBe(302);
  const authorize = new URL(String(start.headers.location));
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("redirect_uri")).toBe("http://app.example/auth/callback");
  const state = cookieOf(start.headers["set-cookie"], "rapt_oidc") as string;
  const redirected = await fetch(authorize, { redirect: "manual" });
  const callback = new URL(String(redirected.headers.get("location")));
  const done = await t.app.inject({ method: "GET", url: `${callback.pathname}${callback.search}`, headers: { cookie: state } });
  expect(done.statusCode).toBe(302);
  expect(done.headers.location).toBe("/ui/index.html");
  return cookieOf(done.headers["set-cookie"], "rapt_session") as string;
}

describe("OIDC browser sessions", () => {
  it("sends the UI to the login of the provider", async () => {
    const response = await t.app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/auth/login?returnTo=%2Fui%2Findex.html");
  });

  it("logs in with the authorization code flow and serves the service to the session", async () => {
    const session = await login();
    const me = await t.app.inject({ method: "GET", url: "/auth/me", headers: { cookie: session } });
    expect(JSON.parse(me.body)).toEqual({ authenticated: true, id: "alice", name: "Alice Example", roles: ["travel_user"] });
    const read = await t.app.inject({ method: "GET", url: `${SERVICE}Travel?$top=1`, headers: { cookie: session } });
    expect(read.statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: `${SERVICE}Travel` })).statusCode).toBe(401);
  });

  it("requires the CSRF token of the session for changes", async () => {
    const session = await login();
    const refused = await t.app.inject({ method: "PATCH", url: `${SERVICE}Travel(1)`, headers: { cookie: session, "content-type": "application/json" }, payload: "{}" });
    expect(refused.statusCode).toBe(403);
    const fetched = await t.app.inject({ method: "HEAD", url: SERVICE, headers: { cookie: session, "x-csrf-token": "Fetch" } });
    const token = String(fetched.headers["x-csrf-token"]);
    const other = await login();
    const wrongSession = await t.app.inject({ method: "PATCH", url: `${SERVICE}Travel(1)`, headers: { cookie: other, "x-csrf-token": token, "content-type": "application/json" }, payload: "{}" });
    expect(wrongSession.statusCode).toBe(403);
    const accepted = await t.app.inject({ method: "PATCH", url: `${SERVICE}Travel(1)`, headers: { cookie: session, "x-csrf-token": token, "content-type": "application/json" }, payload: "{}" });
    expect(accepted.statusCode).not.toBe(403);
  });

  it("rejects a tampered session and a replayed state", async () => {
    const session = await login();
    const tampered = `${session.slice(0, -4)}AAAA`;
    expect((await t.app.inject({ method: "GET", url: `${SERVICE}Travel`, headers: { cookie: tampered } })).statusCode).toBe(401);
    const callback = await t.app.inject({ method: "GET", url: "/auth/callback?code=x&state=y" });
    expect(callback.statusCode).toBe(400);
  });

  it("keeps bearer tokens for API clients", async () => {
    const token = await new SignJWT({ preferred_username: "api-client" }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(issuer).setExpirationTime("5m").sign(privateKey);
    const response = await t.app.inject({ method: "GET", url: `${SERVICE}Travel?$top=1`, headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
  });

  it("logs out at the provider", async () => {
    const response = await t.app.inject({ method: "GET", url: "/auth/logout" });
    expect(response.statusCode).toBe(302);
    expect(String(response.headers.location)).toBe(`${issuer}/logout?client_id=rapt-app&post_logout_redirect_uri=http%3A%2F%2Fapp.example%2F`);
    expect(cookieOf(response.headers["set-cookie"], "rapt_session")).toBe("rapt_session=");
  });
});
