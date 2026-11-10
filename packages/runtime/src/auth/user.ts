/** The authenticated user of a request. */

export interface User {
  /** Identifier from the identity provider (or the development user). */
  id: string;
  /** User name in ABAP form: upper case, at most 12 characters (sy-uname, CreatedBy…). */
  abapName: string;
  name?: string;
  email?: string;
  roles: string[];
  /** Claims of the token the authorizations read (`{claim:agency}` in a role): claim → values. */
  attributes?: Record<string, string[]>;
  authenticatedBy: "development" | "bearer" | "session";
  /** Browser sessions: the session identifier (the CSRF token is bound to it). */
  session?: string;
}

export function abapUserName(id: string): string {
  return id.toUpperCase().slice(0, 12);
}

/**
 * The user of the development mode (AUTH_MODE=none). Without given roles (`*`) it has every
 * authorization, as a developer has SAP_ALL in a development system.
 */
export function developmentUser(id = "DEVELOPER", roles?: string[], attributes?: Record<string, string[]>): User {
  return { id, abapName: abapUserName(id), roles: roles ?? ["*"], authenticatedBy: "development", ...(attributes === undefined ? {} : { attributes }) };
}
