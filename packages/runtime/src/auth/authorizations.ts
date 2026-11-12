/**
 * The authorizations of the users (decision D34): the roles of the identity provider (claims of
 * the token) give authorizations, instances of authorization objects with field values, defined
 * in rapt/authorizations.json — the counterpart of the business roles of the ABAP environment.
 * AUTHORITY-CHECK and the access controls (pfcg_auth) read them.
 */

import { authorizationClaims, type AuthorizationsModel, type AuthorizationValue, type RoleModel } from "@open-rap/model";
import type { User } from "./user.js";

/** One authorization of a user: field → accepted values (the claims of the token expanded). */
export type UserAuthorization = Record<string, AuthorizationValue[]>;

const CLAIM = /^\{claim:([^}]+)\}$/;

/** A value of an authorization field against an accepted value of a role (PFCG semantics). */
export function valueMatches(value: string, accepted: AuthorizationValue): boolean {
  if (typeof accepted !== "string") {
    return value >= accepted.from && value <= accepted.to;
  }
  if (accepted === "*") {
    return true;
  }
  if (accepted.endsWith("*")) {
    return value.startsWith(accepted.slice(0, -1));
  }
  return value === accepted;
}

/** The roles of rapt/authorizations.json (`roles`: role name → authorizations) as a model. */
export function rolesFromJson(json: unknown): RoleModel[] {
  const roles = (json as { roles?: unknown })?.roles;
  if (typeof roles !== "object" || roles === null || Array.isArray(roles)) {
    throw new Error('the authorizations file needs "roles": role name → { "authorizations": [...] }');
  }
  return Object.entries(roles as Record<string, { description?: string; authorizations?: unknown }>).map(([name, role]) => {
    if (!Array.isArray(role?.authorizations)) {
      throw new Error(`roles.${name}: "authorizations" must be a list`);
    }
    return {
      name,
      ...(typeof role.description === "string" ? { description: role.description } : {}),
      authorizations: (role.authorizations as Array<{ object: string; fields: Record<string, unknown> }>).map((a) => ({
        object: String(a.object).toUpperCase(),
        fields: Object.fromEntries(Object.entries(a.fields ?? {}).map(([field, values]) => [field.toUpperCase(), (Array.isArray(values) ? values : [values]) as AuthorizationValue[]])),
      })),
    };
  });
}

export class Authorizations {
  private readonly roles: RoleModel[];

  public constructor(model: AuthorizationsModel | undefined) {
    this.roles = model?.roles ?? [];
  }

  /** Whether roles are defined (else AUTHORITY-CHECK fails for every user: no authorization). */
  public get defined(): boolean {
    return this.roles.length > 0;
  }

  /** The claims of the token that values of the roles read (`{claim:agency}`). */
  public claims(): string[] {
    return authorizationClaims({ roles: this.roles });
  }

  /**
   * The development user without DEV_ROLES (`*`) has every authorization, like SAP_ALL in a
   * development system: every role, and AUTHORITY-CHECK passes for every object.
   */
  public isUnrestricted(user: User): boolean {
    return user.authenticatedBy === "development" && user.roles.includes("*");
  }

  /** The roles of a user: those of its token; all of them for the unrestricted development user. */
  public rolesOf(user: User): RoleModel[] {
    if (this.isUnrestricted(user)) {
      return this.roles;
    }
    return this.roles.filter((r) => user.roles.includes(r.name) || user.roles.some((u) => u.toLowerCase() === r.name.toLowerCase()));
  }

  /** The authorizations of a user for an authorization object, the claims of its token expanded. */
  public of(user: User, object: string): UserAuthorization[] {
    const name = object.toUpperCase();
    const result: UserAuthorization[] = [];
    for (const role of this.rolesOf(user)) {
      for (const authorization of role.authorizations.filter((a) => a.object === name)) {
        const fields: UserAuthorization = {};
        for (const [field, values] of Object.entries(authorization.fields)) {
          fields[field] = values.flatMap((v) => {
            const claim = typeof v === "string" ? CLAIM.exec(v)?.[1] : undefined;
            return claim === undefined ? [v] : (user.attributes?.[claim] ?? []);
          });
        }
        result.push(fields);
      }
    }
    return result;
  }

  /**
   * AUTHORITY-CHECK: 0 when one authorization of the object accepts every checked field (a field
   * given with DUMMY is not checked), 4 when none does, 12 without authorization for the object.
   */
  public check(user: User, object: string, fields: Array<{ id: string; value?: string }>): 0 | 4 | 12 {
    if (this.isUnrestricted(user)) {
      return 0;
    }
    const authorizations = this.of(user, object);
    if (authorizations.length === 0) {
      return 12;
    }
    const granted = authorizations.some((authorization) =>
      fields.every((field) => field.value === undefined || (authorization[field.id.toUpperCase()] ?? []).some((accepted) => valueMatches(field.value as string, accepted))),
    );
    return granted ? 0 : 4;
  }
}
