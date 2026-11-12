/**
 * A development OAuth 2.0 authorization server (D60), served under /oauth by `rapt dev` (and by
 * an application started with DEV_OAUTH=on in the development mode), to call the service as a
 * Web API with the flows of a real identity provider, without one:
 *
 * - client credentials: POST /oauth/token grant_type=client_credentials with the client id and
 *   secret (form or Basic): a token of the technical user of the client;
 * - authorization code with PKCE (S256): GET /oauth/authorize (a page to choose the user), then
 *   POST /oauth/token grant_type=authorization_code with the code_verifier;
 * - /oauth/.well-known/openid-configuration and /oauth/jwks for the clients that discover them.
 *
 * Tokens are RS256 JWTs signed with a key generated at start-up: they end with the process. In
 * production, the tokens come from the identity provider (AUTH_MODE=oidc).
 */

import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT, type JWK, type JWTPayload } from "jose";

export interface DevOAuthClient {
  clientId: string;
  /** Confidential clients (client credentials); a public client (PKCE) has none. */
  clientSecret?: string;
  /** Roles of the technical user of a confidential client (default: every role, `*`). */
  roles?: string[];
}

/** The clients when none are configured (DEV_OAUTH_CLIENTS). */
export const DEFAULT_DEV_CLIENTS: DevOAuthClient[] = [
  { clientId: "rapt-client", clientSecret: "rapt-secret", roles: ["*"] },
  { clientId: "rapt-pkce" },
];

const TOKEN_LIFETIME = 3600;

interface PendingCode {
  clientId: string;
  redirectUri: string;
  challenge: string;
  user: string;
  roles: string[];
  expires: number;
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export class DevOAuthServer {
  private readonly codes = new Map<string, PendingCode>();

  private constructor(
    private readonly clients: DevOAuthClient[],
    private readonly privateKey: Parameters<SignJWT["sign"]>[0],
    private readonly jwk: JWK,
  ) {}

  public static async create(clients: DevOAuthClient[] = DEFAULT_DEV_CLIENTS): Promise<DevOAuthServer> {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: "rapt-dev", alg: "RS256", use: "sig" };
    return new DevOAuthServer(clients, privateKey, jwk);
  }

  /** Verifies a token of this server; its claims. */
  public async verify(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, createLocalJWKSet({ keys: [this.jwk] }));
    return payload;
  }

  private issuer(request: FastifyRequest): string {
    const proto = String(request.headers["x-forwarded-proto"] ?? request.protocol ?? "http").split(",")[0];
    return `${proto}://${request.headers.host ?? "localhost"}/oauth`;
  }

  private async token(issuer: string, claims: Record<string, unknown>): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "rapt-dev" })
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_LIFETIME}s`)
      .sign(this.privateKey);
  }

  public register(app: FastifyInstance): void {
    const form = (body: unknown): URLSearchParams => new URLSearchParams(typeof body === "string" ? body : Buffer.isBuffer(body) ? body.toString("utf8") : "");
    const error = (code: string, description: string): string => JSON.stringify({ error: code, error_description: description });

    app.get("/oauth/.well-known/openid-configuration", async (request, reply) => {
      const issuer = this.issuer(request);
      return reply.header("Content-Type", "application/json").send(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "client_credentials"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      );
    });

    app.get("/oauth/jwks", async (_request, reply) => reply.header("Content-Type", "application/json").send(JSON.stringify({ keys: [this.jwk] })));

    // authorization code with PKCE: a page to choose the user of the development token
    app.get("/oauth/authorize", async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const client = this.clients.find((c) => c.clientId === query["client_id"]);
      if (query["response_type"] !== "code" || client === undefined || query["redirect_uri"] === undefined) {
        return reply.code(400).header("Content-Type", "text/plain").send("response_type=code, a known client_id and a redirect_uri are required");
      }
      if (query["code_challenge"] === undefined || (query["code_challenge_method"] ?? "plain") !== "S256") {
        return reply.code(400).header("Content-Type", "text/plain").send("PKCE is required: code_challenge with code_challenge_method=S256");
      }
      const hidden = ["client_id", "redirect_uri", "state", "code_challenge"].map((k) => `<input type="hidden" name="${k}" value="${escapeHtml(query[k] ?? "")}">`).join("");
      return reply.header("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><html><head><meta charset="utf-8"><title>rapt dev sign-in</title>
<style>body{font-family:system-ui,sans-serif;max-width:26rem;margin:4rem auto;padding:0 1rem}label{display:block;margin:.8rem 0 .2rem}input{width:100%;padding:.4rem;box-sizing:border-box}button{margin-top:1.2rem;padding:.5rem 1rem}</style></head>
<body><h1>rapt dev sign-in</h1><p>Development authorization server: the token is issued for the user you enter. Client <b>${escapeHtml(client.clientId)}</b>.</p>
<form method="post" action="/oauth/authorize">${hidden}<label for="user">User</label><input id="user" name="user" value="DEVELOPER" required><label for="roles">Roles (comma separated, * for all)</label><input id="roles" name="roles" value="*"><button id="signin" type="submit">Sign in</button></form></body></html>`);
    });

    app.post("/oauth/authorize", async (request, reply) => {
      const params = form(request.body);
      const client = this.clients.find((c) => c.clientId === params.get("client_id"));
      const redirectUri = params.get("redirect_uri");
      const challenge = params.get("code_challenge");
      if (client === undefined || redirectUri === null || challenge === null) {
        return reply.code(400).header("Content-Type", "text/plain").send("invalid authorization request");
      }
      const code = randomBytes(24).toString("base64url");
      const user = (params.get("user") ?? "DEVELOPER").trim() || "DEVELOPER";
      const roles = (params.get("roles") ?? "*").split(",").map((r) => r.trim()).filter((r) => r !== "");
      this.codes.set(code, { clientId: client.clientId, redirectUri, challenge, user, roles, expires: Date.now() + 120_000 });
      const target = new URL(redirectUri);
      target.searchParams.set("code", code);
      const state = params.get("state");
      if (state !== null && state !== "") target.searchParams.set("state", state);
      return reply.redirect(target.toString());
    });

    app.post("/oauth/token", async (request, reply) => {
      const params = form(request.body);
      const json = (status: number, body: string): unknown => reply.code(status).header("Content-Type", "application/json").header("Cache-Control", "no-store").send(body);
      // client authentication: client_secret_basic or client_secret_post
      let clientId = params.get("client_id");
      let clientSecret = params.get("client_secret");
      const basic = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "");
      if (basic !== null) {
        const [id = "", secret = ""] = Buffer.from(basic[1] as string, "base64").toString("utf8").split(":");
        clientId = decodeURIComponent(id);
        clientSecret = decodeURIComponent(secret);
      }
      const client = this.clients.find((c) => c.clientId === clientId);
      if (client === undefined) {
        return json(401, error("invalid_client", "unknown client"));
      }
      const issuer = this.issuer(request);
      const grant = params.get("grant_type");
      if (grant === "client_credentials") {
        if (client.clientSecret === undefined || client.clientSecret !== clientSecret) {
          return json(401, error("invalid_client", "client credentials need the secret of a confidential client"));
        }
        const accessToken = await this.token(issuer, { sub: client.clientId, client_id: client.clientId, azp: client.clientId, roles: client.roles ?? ["*"], scope: params.get("scope") ?? "" });
        return json(200, JSON.stringify({ access_token: accessToken, token_type: "Bearer", expires_in: TOKEN_LIFETIME }));
      }
      if (grant === "authorization_code") {
        const code = this.codes.get(params.get("code") ?? "");
        this.codes.delete(params.get("code") ?? "");
        if (code === undefined || code.expires < Date.now() || code.clientId !== client.clientId || code.redirectUri !== params.get("redirect_uri")) {
          return json(400, error("invalid_grant", "unknown, expired or mismatched authorization code"));
        }
        if (client.clientSecret !== undefined && clientSecret !== null && clientSecret !== client.clientSecret) {
          return json(401, error("invalid_client", "wrong client secret"));
        }
        const verifier = params.get("code_verifier") ?? "";
        if (createHash("sha256").update(verifier).digest("base64url") !== code.challenge) {
          return json(400, error("invalid_grant", "the code_verifier does not match the code_challenge (PKCE)"));
        }
        const claims = { sub: code.user, preferred_username: code.user, azp: client.clientId, roles: code.roles };
        const accessToken = await this.token(issuer, claims);
        const idToken = await this.token(issuer, { ...claims, aud: client.clientId });
        return json(200, JSON.stringify({ access_token: accessToken, id_token: idToken, token_type: "Bearer", expires_in: TOKEN_LIFETIME }));
      }
      return json(400, error("unsupported_grant_type", "client_credentials or authorization_code"));
    });
  }
}
