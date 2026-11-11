/**
 * The authentication of a generated application or launchpad, from its environment: the
 * development user (`AUTH_MODE=none`) or OIDC (bearer tokens, and browser sessions when
 * `OIDC_CLIENT_ID` is set). See server.ts for the variables.
 */

import type { AuthOptions } from "./auth.js";

export function authFromEnvironment(env: Record<string, string | undefined>, publicUrl: string, attributeClaims: string[]): AuthOptions {
  if ((env["AUTH_MODE"] ?? "none") === "none") {
    const auth: AuthOptions = { mode: "none" };
    if (env["DEV_USER"] !== undefined) {
      auth.user = env["DEV_USER"];
    }
    // the roles of the development user (default: all), its claims as JSON ({"agency":["070001"]})
    if (env["DEV_ROLES"] !== undefined) {
      auth.roles = env["DEV_ROLES"].split(",").map((r) => r.trim()).filter((r) => r !== "");
    }
    if (env["DEV_ATTRIBUTES"] !== undefined && env["DEV_ATTRIBUTES"] !== "") {
      const attributes = JSON.parse(env["DEV_ATTRIBUTES"]) as Record<string, unknown>;
      auth.attributes = Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k, (Array.isArray(v) ? v : [v]).map(String)]));
    }
    return auth;
  }
  const issuer = env["OIDC_ISSUER"];
  if (issuer === undefined) {
    throw new Error("AUTH_MODE=oidc needs OIDC_ISSUER");
  }
  const auth: AuthOptions = { mode: "oidc", issuer };
  if (attributeClaims.length > 0) {
    auth.attributeClaims = attributeClaims;
  }
  const optional: Array<[keyof typeof auth, string]> = [
    ["discoveryUrl", "OIDC_DISCOVERY_URL"],
    ["audience", "OIDC_AUDIENCE"],
    ["requiredRole", "OIDC_REQUIRED_ROLE"],
    ["rolesClaim", "OIDC_ROLES_CLAIM"],
    ["userClaim", "OIDC_USER_CLAIM"],
  ];
  for (const [key, name] of optional) {
    const value = env[name];
    if (value !== undefined && value !== "") {
      (auth as unknown as Record<string, string>)[key] = value;
    }
  }
  const clientId = env["OIDC_CLIENT_ID"];
  if (clientId !== undefined && clientId !== "") {
    const secret = env["SESSION_SECRET"];
    if (secret === undefined || secret.length < 32) {
      throw new Error("browser sessions (OIDC_CLIENT_ID) need SESSION_SECRET, 32 characters or more");
    }
    auth.session = { clientId, baseUrl: publicUrl, secret };
    const clientSecret = env["OIDC_CLIENT_SECRET"];
    if (clientSecret !== undefined && clientSecret !== "") {
      auth.session.clientSecret = clientSecret;
    }
  }
  return auth;
}
