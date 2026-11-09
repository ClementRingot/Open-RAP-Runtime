/** The authenticated user of a request. */

export interface User {
  /** Identifier from the identity provider (or the development user). */
  id: string;
  /** User name in ABAP form: upper case, at most 12 characters (sy-uname, CreatedBy…). */
  abapName: string;
  name?: string;
  email?: string;
  roles: string[];
  authenticatedBy: "development" | "bearer" | "session";
}

export function abapUserName(id: string): string {
  return id.toUpperCase().slice(0, 12);
}

export function developmentUser(id = "DEVELOPER"): User {
  return { id, abapName: abapUserName(id), roles: [], authenticatedBy: "development" };
}
