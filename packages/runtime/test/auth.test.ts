import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtureApp, SERVICE, type TestApp } from "./helpers.js";
import { Authenticator } from "../src/auth/auth.js";

const ISSUER = "https://idp.example.test/realms/rap";
let t: TestApp;
let sign: (claims: Record<string, unknown>, options?: { expiresIn?: string; issuer?: string; audience?: string }) => Promise<string>;
let foreign: (claims: Record<string, unknown>) => Promise<string>;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  sign = (claims, options = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(options.issuer ?? ISSUER)
      .setAudience(options.audience ?? "travel-app")
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "5m")
      .sign(privateKey);
  foreign = (claims) => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISSUER).setAudience("travel-app").setExpirationTime("5m").sign(other.privateKey);
  t = await fixtureApp({ auth: { mode: "oidc", issuer: ISSUER, audience: "travel-app", requiredRole: "travel_user", jwks: createLocalJWKSet({ keys: [jwk] }) } });
});
afterAll(async () => {
  await t.close();
});

const request = (authorization?: string) =>
  t.app.inject({ method: "GET", url: `${SERVICE}Travel?$select=TravelID&$top=1`, headers: authorization === undefined ? {} : { authorization } });

describe("OIDC bearer tokens", () => {
  it("requires a token", async () => {
    const response = await request();
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("Bearer");
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: "UNAUTHORIZED", message: "authentication required" } });
  });

  it("accepts a valid token with the required role", async () => {
    const token = await sign({ sub: "u-1", preferred_username: "alice", realm_access: { roles: ["travel_user"] } });
    const response = await request(`Bearer ${token}`);
    expect(response.statusCode).toBe(200);
  });

  it("rejects a token without the required role", async () => {
    const token = await sign({ sub: "u-2", preferred_username: "bob", realm_access: { roles: ["other"] } });
    const response = await request(`Bearer ${token}`);
    expect(response.statusCode).toBe(403);
  });

  it.each([
    ["an expired token", async () => sign({ preferred_username: "x", realm_access: { roles: ["travel_user"] } }, { expiresIn: "-1m" })],
    ["another issuer", async () => sign({ preferred_username: "x", realm_access: { roles: ["travel_user"] } }, { issuer: "https://evil.test" })],
    ["another audience", async () => sign({ preferred_username: "x", realm_access: { roles: ["travel_user"] } }, { audience: "other-app" })],
    ["a token signed by another key", async () => foreign({ preferred_username: "x", realm_access: { roles: ["travel_user"] } })],
  ])("rejects %s", async (_label, token) => {
    const response = await request(`Bearer ${await token()}`);
    expect(response.statusCode).toBe(401);
  });

  it("rejects other authorization schemes", async () => {
    expect((await request("Basic dXNlcjpwYXNz")).statusCode).toBe(401);
  });

  it("does not protect the health check", async () => {
    expect((await t.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});

describe("client credentials tokens (D60)", () => {
  it("name the client as the technical user, with the roles of a scope claim", () => {
    const authenticator = new Authenticator({ mode: "oidc", issuer: "https://idp.example.com", rolesClaim: "scope" });
    const user = authenticator.userFromClaims({ sub: "6f1c0a52", client_id: "billing-batch", scope: "travel_manager reporting" }, "bearer");
    expect(user).toMatchObject({ id: "billing-batch", abapName: "BILLING-BATC", roles: ["travel_manager", "reporting"] });
  });
});
