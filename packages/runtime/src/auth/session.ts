/**
 * Browser sessions over OIDC (PLAN.md §6.8): authorization code flow with PKCE, the user kept in
 * a signed, HttpOnly cookie (no server-side store). API clients keep using bearer tokens.
 *
 * Routes: GET /auth/login?returnTo=…, GET /auth/callback, GET /auth/logout, GET /auth/me.
 * The discovery document may be fetched from an internal URL (`discoveryUrl`) while the tokens
 * name the public issuer: the usual setup of Keycloak in docker-compose.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { AuthenticationError, type Authenticator, type OidcAuthOptions } from "./auth.js";
import type { User } from "./user.js";

export const SESSION_COOKIE = "rapt_session";
const STATE_COOKIE = "rapt_oidc";

interface ProviderMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

interface SessionPayload {
  user: User;
  sid: string;
  exp: number;
}

const b64 = (data: Buffer): string => data.toString("base64url");

/** Signed values: base64url(JSON) + "." + HMAC-SHA256. */
class Signer {
  public constructor(private readonly secret: string) {
    if (secret.length < 32) {
      throw new Error("the session secret needs at least 32 characters");
    }
  }

  public sign(value: unknown): string {
    const body = b64(Buffer.from(JSON.stringify(value)));
    return `${body}.${b64(createHmac("sha256", this.secret).update(body).digest())}`;
  }

  public verify<T>(signed: string | undefined): T | undefined {
    if (signed === undefined) {
      return undefined;
    }
    const dot = signed.lastIndexOf(".");
    if (dot < 0) {
      return undefined;
    }
    const body = signed.slice(0, dot);
    const expected = Buffer.from(b64(createHmac("sha256", this.secret).update(body).digest()));
    const given = Buffer.from(signed.slice(dot + 1));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return undefined;
    }
    try {
      const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { exp?: number };
      return typeof value.exp === "number" && value.exp * 1000 < Date.now() ? undefined : (value as T);
    } catch {
      return undefined;
    }
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return cookies;
}

export class OidcSessions {
  private readonly signer: Signer;
  private metadataPromise: Promise<ProviderMetadata> | undefined;
  private jwks: JWTVerifyGetKey | undefined;
  private readonly secure: boolean;
  private readonly maxAge: number;

  public constructor(
    private readonly authenticator: Authenticator,
    private readonly options: OidcAuthOptions & { session: NonNullable<OidcAuthOptions["session"]> },
  ) {
    this.signer = new Signer(options.session.secret);
    this.secure = options.session.baseUrl.startsWith("https:");
    this.maxAge = options.session.maxAge ?? 8 * 3600;
    if (options.jwks !== undefined) {
      this.jwks = options.jwks;
    }
  }

  private metadata(): Promise<ProviderMetadata> {
    this.metadataPromise ??= (async () => {
      const base = this.options.discoveryUrl ?? this.options.issuer;
      const url = base.includes(".well-known") ? base : new URL(".well-known/openid-configuration", base.endsWith("/") ? base : `${base}/`).href;
      const response = await fetch(url);
      if (!response.ok) {
        throw new AuthenticationError(`OIDC discovery failed (${response.status})`, 503);
      }
      return (await response.json()) as ProviderMetadata;
    })();
    this.metadataPromise.catch(() => (this.metadataPromise = undefined));
    return this.metadataPromise;
  }

  private cookie(name: string, value: string, maxAge: number): string {
    return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${this.secure ? "; Secure" : ""}`;
  }

  private redirectUri(): string {
    return new URL("auth/callback", this.options.session.baseUrl.endsWith("/") ? this.options.session.baseUrl : `${this.options.session.baseUrl}/`).href;
  }

  /** The user of a session cookie; undefined without a valid session. */
  public user(request: FastifyRequest): User | undefined {
    const session = this.signer.verify<SessionPayload>(parseCookies(request.headers.cookie)[SESSION_COOKIE]);
    return session === undefined ? undefined : { ...session.user, authenticatedBy: "session", session: session.sid };
  }

  /** `/auth/login?returnTo=…` for the current page. */
  public loginUrl(returnTo: string): string {
    return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  }

  public register(app: FastifyInstance): void {
    app.get("/auth/login", async (request, reply) => this.login(request, reply));
    app.get("/auth/callback", async (request, reply) => this.callback(request, reply));
    app.get("/auth/logout", async (_request, reply) => this.logout(reply));
    app.get("/auth/me", async (request, reply) => {
      const user = this.user(request);
      return user === undefined ? reply.status(401).send({ authenticated: false }) : { authenticated: true, id: user.id, name: user.name, roles: user.roles };
    });
  }

  private async login(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const metadata = await this.metadata();
    const query = request.query as { returnTo?: string };
    const returnTo = typeof query.returnTo === "string" && query.returnTo.startsWith("/") && !query.returnTo.startsWith("//") ? query.returnTo : "/";
    const state = b64(randomBytes(24));
    const nonce = b64(randomBytes(24));
    const verifier = b64(randomBytes(32));
    const challenge = b64(createHash("sha256").update(verifier).digest());
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.options.session.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri());
    url.searchParams.set("scope", this.options.session.scopes ?? "openid profile email");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    reply.header("Set-Cookie", this.cookie(STATE_COOKIE, this.signer.sign({ state, nonce, verifier, returnTo, exp: Math.floor(Date.now() / 1000) + 600 }), 600));
    return reply.redirect(url.href);
  }

  private async callback(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const query = request.query as { code?: string; state?: string; error?: string; error_description?: string };
    const pending = this.signer.verify<{ state: string; nonce: string; verifier: string; returnTo: string }>(parseCookies(request.headers.cookie)[STATE_COOKIE]);
    if (query.error !== undefined) {
      return reply.status(401).type("text/plain").send(`Login failed: ${query.error_description ?? query.error}`);
    }
    if (pending === undefined || query.state !== pending.state || typeof query.code !== "string") {
      return reply.status(400).type("text/plain").send("Login failed: invalid or expired state, start again");
    }
    const metadata = await this.metadata();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: query.code,
      redirect_uri: this.redirectUri(),
      client_id: this.options.session.clientId,
      code_verifier: pending.verifier,
    });
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    if (this.options.session.clientSecret !== undefined) {
      headers["authorization"] = `Basic ${Buffer.from(`${encodeURIComponent(this.options.session.clientId)}:${encodeURIComponent(this.options.session.clientSecret)}`).toString("base64")}`;
    }
    const response = await fetch(metadata.token_endpoint, { method: "POST", headers, body });
    if (!response.ok) {
      return reply.status(401).type("text/plain").send(`Login failed: the token endpoint answered ${response.status}`);
    }
    const tokens = (await response.json()) as { id_token?: string; access_token?: string };
    if (tokens.id_token === undefined) {
      return reply.status(401).type("text/plain").send("Login failed: no ID token");
    }
    this.jwks ??= createRemoteJWKSet(new URL(metadata.jwks_uri));
    let user: User;
    try {
      const { payload } = await jwtVerify(tokens.id_token, this.jwks, { issuer: this.options.issuer, audience: this.options.session.clientId });
      if (payload["nonce"] !== pending.nonce) {
        throw new AuthenticationError("the ID token has another nonce");
      }
      user = this.authenticator.userFromClaims(payload, "session");
      // roles and attributes: Keycloak puts the realm roles (and mapped attributes) in the access token
      if (tokens.access_token !== undefined && (user.roles.length === 0 || (this.options.attributeClaims ?? []).some((c) => user.attributes?.[c] === undefined))) {
        try {
          const access = await jwtVerify(tokens.access_token, this.jwks, { issuer: this.options.issuer });
          const fromAccess = this.authenticator.userFromClaims(access.payload, "session");
          const attributes = { ...(fromAccess.attributes ?? {}), ...(user.attributes ?? {}) };
          user = { ...user, roles: user.roles.length === 0 ? fromAccess.roles : user.roles, ...(Object.keys(attributes).length === 0 ? {} : { attributes }) };
        } catch {
          // an opaque access token: the roles and claims of the ID token
        }
      }
    } catch (error) {
      return reply.status(error instanceof AuthenticationError ? error.status : 401).type("text/plain").send(`Login failed: ${(error as Error).message}`);
    }
    const session: SessionPayload = {
      user: {
        id: user.id,
        abapName: user.abapName,
        roles: user.roles,
        authenticatedBy: "session",
        ...(user.name === undefined ? {} : { name: user.name }),
        ...(user.email === undefined ? {} : { email: user.email }),
        ...(user.attributes === undefined ? {} : { attributes: user.attributes }),
      },
      sid: b64(randomBytes(16)),
      exp: Math.floor(Date.now() / 1000) + this.maxAge,
    };
    reply.header("Set-Cookie", [this.cookie(SESSION_COOKIE, this.signer.sign(session), this.maxAge), this.cookie(STATE_COOKIE, "", 0)]);
    return reply.redirect(pending.returnTo);
  }

  private async logout(reply: FastifyReply): Promise<FastifyReply> {
    reply.header("Set-Cookie", this.cookie(SESSION_COOKIE, "", 0));
    let target = "/";
    try {
      const metadata = await this.metadata();
      if (metadata.end_session_endpoint !== undefined) {
        const url = new URL(metadata.end_session_endpoint);
        url.searchParams.set("client_id", this.options.session.clientId);
        url.searchParams.set("post_logout_redirect_uri", this.options.session.baseUrl);
        target = url.href;
      }
    } catch {
      // the provider is not reachable: local logout only
    }
    return reply.redirect(target);
  }
}
