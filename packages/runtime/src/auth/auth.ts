/**
 * Authentication (PLAN.md §6.8): development mode (fixed user) or generic OIDC. In OIDC mode an
 * API client sends a bearer JWT, verified against the JWKS of the issuer; browser sessions
 * (authorization code + PKCE) are added on top of the same verification (milestone J6).
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { abapUserName, developmentUser, type User } from "./user.js";

export interface DevelopmentAuthOptions {
  mode: "none";
  user?: string;
}

export interface OidcAuthOptions {
  mode: "oidc";
  /** Issuer URL; its discovery document gives the JWKS URI. */
  issuer: string;
  /** Expected `aud` of access tokens (optional). */
  audience?: string;
  /** Claim giving the user identifier (default preferred_username, then sub). */
  userClaim?: string;
  /** Claim holding the roles: a list, or Keycloak's realm_access.roles (default). */
  rolesClaim?: string;
  /** Role every user must have (optional). */
  requiredRole?: string;
  /** Key set, for tests or a fixed configuration (default: from the discovery document). */
  jwks?: JWTVerifyGetKey;
  /**
   * Where the discovery document is fetched, when it differs from the issuer (an internal URL of
   * the provider, the tokens naming its public URL).
   */
  discoveryUrl?: string;
  /** Browser sessions: authorization code flow with PKCE (auth/session.ts). */
  session?: {
    clientId: string;
    clientSecret?: string;
    /** Public URL of the application, for the redirect URI. */
    baseUrl: string;
    /** Secret of the session cookie (32 characters or more). */
    secret: string;
    scopes?: string;
    /** Lifetime of a session in seconds (default 8 hours). */
    maxAge?: number;
  };
}

export type AuthOptions = DevelopmentAuthOptions | OidcAuthOptions;

export class AuthenticationError extends Error {
  public constructor(
    message: string,
    public readonly status = 401,
  ) {
    super(message);
  }
}

export class Authenticator {
  private jwks: JWTVerifyGetKey | undefined;

  public constructor(public readonly options: AuthOptions) {
    if (options.mode === "oidc" && options.jwks !== undefined) {
      this.jwks = options.jwks;
    }
  }

  private async keySet(options: OidcAuthOptions): Promise<JWTVerifyGetKey> {
    if (this.jwks === undefined) {
      const base = options.discoveryUrl ?? options.issuer;
      const discovery = await fetch(base.includes(".well-known") ? base : new URL(".well-known/openid-configuration", base.endsWith("/") ? base : `${base}/`));
      if (!discovery.ok) {
        throw new AuthenticationError(`OIDC discovery failed (${discovery.status})`, 503);
      }
      const document = (await discovery.json()) as { jwks_uri?: string };
      if (document.jwks_uri === undefined) {
        throw new AuthenticationError("OIDC discovery document without jwks_uri", 503);
      }
      this.jwks = createRemoteJWKSet(new URL(document.jwks_uri));
    }
    return this.jwks;
  }

  public userFromClaims(payload: JWTPayload, authenticatedBy: User["authenticatedBy"]): User {
    const options = this.options as OidcAuthOptions;
    const claim = options.userClaim ?? "preferred_username";
    const id = String(payload[claim] ?? payload.sub ?? "");
    if (id === "") {
      throw new AuthenticationError(`the token has no ${claim} or sub claim`);
    }
    const roles = rolesOf(payload, options.rolesClaim);
    if (options.requiredRole !== undefined && !roles.includes(options.requiredRole)) {
      throw new AuthenticationError(`the role ${options.requiredRole} is required`, 403);
    }
    const user: User = { id, abapName: abapUserName(id), roles, authenticatedBy };
    if (typeof payload["name"] === "string") user.name = payload["name"];
    if (typeof payload["email"] === "string") user.email = payload["email"];
    return user;
  }

  /** Verifies an access token and returns its user. */
  public async verifyToken(token: string): Promise<User> {
    const options = this.options;
    if (options.mode !== "oidc") {
      throw new AuthenticationError("bearer tokens need the OIDC mode");
    }
    const verifyOptions: Parameters<typeof jwtVerify>[2] = { issuer: options.issuer };
    if (options.audience !== undefined) {
      verifyOptions.audience = options.audience;
    }
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, await this.keySet(options), verifyOptions));
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError(`invalid token: ${(error as Error).message}`);
    }
    return this.userFromClaims(payload, "bearer");
  }

  /** The user of a request from its Authorization header; undefined when there is none. */
  public async fromAuthorization(header: string | undefined): Promise<User | undefined> {
    if (this.options.mode === "none") {
      return developmentUser(this.options.user);
    }
    if (header === undefined) {
      return undefined;
    }
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (match === null) {
      throw new AuthenticationError("unsupported authorization scheme (Bearer expected)");
    }
    return this.verifyToken((match[1] as string).trim());
  }
}

function rolesOf(payload: JWTPayload, claim: string | undefined): string[] {
  if (claim !== undefined) {
    const value = claim.split(".").reduce<unknown>((o, k) => (o !== null && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), payload);
    return Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/[\s,]+/) : [];
  }
  const realm = (payload["realm_access"] as { roles?: unknown } | undefined)?.roles;
  if (Array.isArray(realm)) {
    return realm.map(String);
  }
  const roles = payload["roles"];
  return Array.isArray(roles) ? roles.map(String) : [];
}
