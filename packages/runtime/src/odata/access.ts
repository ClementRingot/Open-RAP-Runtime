/**
 * The access controls (DCL) on the reads of the service (decision D35): the conditions of the
 * roles of an entity, evaluated for the user of the request into an SQL condition on the view
 * of the entity. `aspect pfcg_auth` reads the authorizations of the user (D34) for the
 * authorization object, `aspect user` its ABAP user name. As in ABAP CDS, a row is granted when
 * one of the conditions of the roles of the entity is true; without role, every row is.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { sql, type RawBuilder } from "kysely";
import type { AbapType, AccessCondition, AccessControlModel, AuthorizationValue } from "@open-rap-runtime/model";
import { valueMatches, type Authorizations } from "../auth/authorizations.js";
import type { User } from "../auth/user.js";
import { toSql, type CanonicalValue } from "../values.js";

const reader = new AsyncLocalStorage<User>();

/** The user of the running read, if any. */
export function currentReader(): User | undefined {
  return reader.getStore();
}

/** Runs `fn` with the user whose access controls apply to the reads. */
export function withReader<T>(user: User, fn: () => Promise<T>): Promise<T> {
  return reader.run(user, fn);
}

/** A literal of a DCL condition (ABAP format: dates YYYYMMDD, booleans X) as a canonical value. */
function literalValue(type: AbapType, text: string): CanonicalValue {
  switch (type.kind) {
    case "dats":
      return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text;
    case "tims":
      return /^\d{6}$/.test(text) ? `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}` : text;
    case "bool":
      return text.trim() !== "";
    case "int1":
    case "int2":
    case "int4":
    case "fltp":
      return Number(text);
    default:
      return text;
  }
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export class AccessControls {
  private readonly byEntity = new Map<string, AccessControlModel[]>();

  public constructor(
    controls: AccessControlModel[] | undefined,
    private readonly authorizations: Authorizations,
  ) {
    for (const control of controls ?? []) {
      const key = control.entity.toUpperCase();
      this.byEntity.set(key, [...(this.byEntity.get(key) ?? []), control]);
    }
  }

  /**
   * The SQL condition of the access controls of an entity for the user of the request, the
   * elements read on `column`; undefined when the entity has no role (every row).
   */
  public condition(entity: string, column: (element: string) => { sql: RawBuilder<unknown>; type: AbapType }): RawBuilder<unknown> | undefined {
    const controls = this.byEntity.get(entity.toUpperCase());
    if (controls === undefined || controls.length === 0) {
      return undefined;
    }
    const user = reader.getStore();
    if (user === undefined) {
      // a read outside of a request: nothing is granted
      return sql`FALSE`;
    }
    if (this.authorizations.isUnrestricted(user)) {
      return undefined;
    }
    const conditions = controls.flatMap((c) => c.conditions).map((c) => this.toSql(c, user, column));
    return sql`(${sql.join(conditions, sql` OR `)})`;
  }

  private toSql(condition: AccessCondition, user: User, column: (element: string) => { sql: RawBuilder<unknown>; type: AbapType }): RawBuilder<unknown> {
    switch (condition.kind) {
      case "true":
        return sql`TRUE`;
      case "false":
        return sql`FALSE`;
      case "and":
      case "or":
        return condition.operands.length === 0 ? (condition.kind === "and" ? sql`TRUE` : sql`FALSE`) : sql`(${sql.join(condition.operands.map((o) => this.toSql(o, user, column)), condition.kind === "and" ? sql` AND ` : sql` OR `)})`;
      case "not":
        return sql`(NOT COALESCE(${this.toSql(condition.operand, user, column)}, FALSE))`;
      case "null": {
        const { sql: ref } = column(condition.element);
        return condition.negated ? sql`(${ref} IS NOT NULL)` : sql`(${ref} IS NULL)`;
      }
      case "compare": {
        const { sql: ref, type } = column(condition.element);
        if (condition.operator === "like") {
          return sql`(CAST(${ref} AS text) LIKE ${condition.value})`;
        }
        return sql`(${ref} ${sql.raw(condition.operator)} ${toSql(type, literalValue(type, condition.value))})`;
      }
      case "user": {
        const { sql: ref } = column(condition.element);
        const own = sql`CAST(${ref} AS text) = ${user.abapName}`;
        return condition.orInitial ? sql`(${own} OR ${ref} IS NULL OR CAST(${ref} AS text) = '')` : sql`(${own})`;
      }
      case "pfcg":
        return this.pfcg(condition, user, column);
    }
  }

  /** `( E1, … ) = aspect pfcg_auth( OBJECT, F1, …, FILTER = 'v' )`: one authorization of the user grants the row. */
  private pfcg(condition: Extract<AccessCondition, { kind: "pfcg" }>, user: User, column: (element: string) => { sql: RawBuilder<unknown>; type: AbapType }): RawBuilder<unknown> {
    const authorizations = this.authorizations.of(user, condition.object).filter((a) => Object.entries(condition.filters).every(([field, value]) => (a[field] ?? []).some((accepted) => valueMatches(value, accepted))));
    const values = (ref: RawBuilder<unknown>, accepted: AuthorizationValue[]): RawBuilder<unknown> => {
      const text = sql`CAST(${ref} AS text)`;
      const parts = accepted.map((v) => {
        if (typeof v !== "string") {
          return sql`(${text} BETWEEN ${v.from} AND ${v.to})`;
        }
        if (v === "*") {
          return sql`TRUE`;
        }
        if (v.endsWith("*")) {
          return sql`(${text} LIKE ${`${escapeLike(v.slice(0, -1))}%`})`;
        }
        return sql`(${text} = ${v})`;
      });
      return parts.length === 0 ? sql`FALSE` : sql`(${sql.join(parts, sql` OR `)})`;
    };
    const granted = authorizations.map((authorization) => {
      const checks = condition.elements.map((element, i) => {
        const { sql: ref } = column(element);
        const check = values(ref, authorization[condition.fields[i] as string] ?? []);
        return condition.orInitial ? sql`(${check} OR ${ref} IS NULL OR CAST(${ref} AS text) = '')` : check;
      });
      return sql`(${sql.join(checks, sql` AND `)})`;
    });
    if (granted.length === 0) {
      if (!condition.orInitial) {
        return sql`FALSE`;
      }
      // ?= : the rows whose elements are initial are granted without authorization
      const initial = condition.elements.map((element) => {
        const { sql: ref } = column(element);
        return sql`(${ref} IS NULL OR CAST(${ref} AS text) = '')`;
      });
      return sql`(${sql.join(initial, sql` AND `)})`;
    }
    return sql`(${sql.join(granted, sql` OR `)})`;
  }
}
