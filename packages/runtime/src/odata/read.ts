/**
 * Reads: OData query options → parameterized SQL on the views of the CDS entities (decision D4).
 * Identifiers come from the model (white list), values are bound parameters.
 */

import { sql, type RawBuilder } from "kysely";
import type { AbapType, EdmType, FieldModel } from "@open-rap/model";
import type { Database } from "../db/database.js";
import { fromSql, literalToCanonical, toSql, type CanonicalValue, type UrlLiteral } from "../values.js";
import { badRequest, notImplemented, ODataError } from "./errors.js";
import type { Cond, CustomQueries } from "./custom.js";
import { currentReader, type AccessControls } from "./access.js";
import { DEPENDENT_ETAG } from "./json.js";
import type { Key, ServiceRuntime, TypeInfo } from "./service.js";
import type { AggregateItem, ApplyStep, ExpandItem, Expr, OrderItem, QueryOptions } from "./uri/ast.js";

export type Row = { [property: string]: CanonicalValue | Row | Row[] | number | undefined };

/** Rows read for one level, with the counts of expanded collections. */
export interface ReadResult {
  rows: Row[];
  count?: number;
}

type Typed = { sql: RawBuilder<unknown>; abap?: AbapType; edm?: EdmType; literal?: UrlLiteral };

const MAX_PAGE_SIZE = 5000;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class ReadEngine {
  /** The query classes of the custom entities (D43), when the application has a RAP runtime. */
  public queries?: CustomQueries;
  /** Scopes on custom entities: the SQL placeholder stands for a condition given to the query class. */
  private readonly customScopes = new WeakMap<RawBuilder<unknown>, Cond>();

  public constructor(
    private readonly service: ServiceRuntime,
    private readonly db: () => Database,
    /** The access controls (DCL) of the entities, for the user of the request (D35). */
    private readonly access?: AccessControls,
  ) {}

  // -------------------------------------------------------------------------------------------
  // custom entities (D43)

  private customScope(cond: Cond): RawBuilder<unknown> {
    const placeholder = sql`TRUE`;
    this.customScopes.set(placeholder, cond);
    return placeholder;
  }

  private customQueries(): CustomQueries {
    if (this.queries === undefined) {
      throw new ODataError(500, "NO_QUERY_RUNTIME", "custom entities are read by their query class: the application has no ABAP runtime");
    }
    return this.queries;
  }

  /** Equalities on properties, as a condition on the elements of the custom entity. */
  private equalities(info: TypeInfo, properties: string[], values: CanonicalValue[]): Cond {
    const items: Cond[] = properties.map((p, i) => ({ kind: "cmp", name: this.service.property(info, p).field.name, op: "eq", value: values[i] ?? null }));
    return items.length === 1 ? (items[0] as Cond) : { kind: "and", items };
  }


  private scopeConditions(scope: RawBuilder<unknown>[]): Cond[] {
    return scope.map((s) => {
      const cond = this.customScopes.get(s);
      if (cond === undefined) {
        throw notImplemented("A condition in SQL on a custom entity");
      }
      return cond;
    });
  }

  private async customCollection(info: TypeInfo, options: QueryOptions, scope: RawBuilder<unknown>[], withCount: boolean): Promise<ReadResult> {
    const needed = this.neededForExpand(info, options.expand);
    const properties = this.selectedProperties(info, options, needed);
    const scoped = this.scopeConditions(scope);
    const filter = options.filter === undefined ? undefined : this.customQueries().condition(info, options.filter);
    const top = Math.min(options.top ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
    const result = await this.customQueries().select(info, {
      ...(filter === undefined ? {} : { filter }),
      scope: scoped,
      ...(options.orderby === undefined ? {} : { orderby: options.orderby }),
      ...(options.search === undefined ? {} : { search: options.search }),
      top,
      skip: options.skip ?? 0,
      count: withCount,
      data: true,
      properties,
    });
    const rows = result.rows;
    const read: ReadResult = { rows };
    if (withCount && result.total !== undefined) {
      read.count = result.total;
    }
    await this.expand(info, rows, options.expand);
    return read;
  }

  private async customExpand(rows: Row[], target: TypeInfo, navigation: { name: string; collection: boolean; on: Array<{ source: string; target: string }> }, item: ExpandItem, properties: string[], needed: string[]): Promise<void> {
    const targetFields = navigation.on.map((p) => p.target);
    const tuples = rows.map((r) => navigation.on.map((p) => r[p.source] as CanonicalValue));
    const distinct = [...new Map(tuples.map((t) => [JSON.stringify(t), t])).values()].filter((t) => t.every((v) => v !== null));
    let matches: Row[] = [];
    if (distinct.length > 0) {
      const scope: Cond = distinct.length === 1 ? this.equalities(target, targetFields, distinct[0] ?? []) : { kind: "or", items: distinct.map((t) => this.equalities(target, targetFields, t)) };
      const filter = item.options.filter === undefined ? undefined : this.customQueries().condition(target, item.options.filter);
      const result = await this.customQueries().select(target, {
        ...(filter === undefined ? {} : { filter }),
        scope: [scope],
        ...(item.options.orderby === undefined ? {} : { orderby: item.options.orderby }),
        count: false,
        data: true,
        properties,
      });
      matches = result.rows;
    }
    for (const row of rows) {
      const all = matches.filter((m) => navigation.on.every((p) => m[p.target] === row[p.source]));
      const skip = item.options.skip ?? 0;
      const mine = all.slice(skip, item.options.top === undefined ? undefined : skip + item.options.top);
      row[navigation.name] = navigation.collection ? mine.map((m) => strip(m, properties, needed)) : mine[0] === undefined ? null : strip(mine[0], properties, needed);
      if (navigation.collection && item.options.count === true) {
        row[`${navigation.name}@odata.count`] = all.length;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // expressions

  private column(info: TypeInfo, alias: string, path: string[]): Typed {
    if (path.length === 1) {
      const name = path[0] as string;
      const { property, field } = this.service.property(info, name);
      return { sql: sql.ref(`${alias}.${property.name}`), abap: field.type, edm: property.edm };
    }
    if (path.length === 2) {
      // a to-one navigation: scalar sub-query on the target view
      const { navigation, target } = this.service.navigationTarget(info, path[0] as string);
      if (navigation.collection) {
        throw notImplemented(`The collection navigation ${navigation.name} in an expression (use any/all)`);
      }
      const { property, field } = this.service.property(target, path[1] as string);
      const inner = `${alias}_${navigation.name.replace(/\W/g, "")}`;
      const conditions = navigation.on.map((p) => sql`${sql.ref(`${inner}.${p.target}`)} = ${sql.ref(`${alias}.${p.source}`)}`);
      return {
        sql: sql`(SELECT ${sql.ref(`${inner}.${property.name}`)} FROM ${sql.table(target.view)} AS ${sql.id(inner)} WHERE ${sql.join(conditions, sql` AND `)} LIMIT 1)`,
        abap: field.type,
        edm: property.edm,
      };
    }
    throw notImplemented(`The path ${path.join("/")}`);
  }

  private operand(info: TypeInfo, alias: string, expr: Expr): Typed {
    switch (expr.kind) {
      case "member":
        return this.column(info, alias, expr.path);
      case "literal":
        return { sql: sql`${expr.literal.value}`, literal: expr.literal };
      case "call":
        return this.call(info, alias, expr.name, expr.args);
      default:
        return { sql: this.condition(info, alias, expr), edm: { type: "Edm.Boolean" } };
    }
  }

  /** A literal bound to the type of the other side of a comparison. */
  private bind(side: Typed, other: Typed, name: string): RawBuilder<unknown> {
    if (side.literal === undefined) {
      return side.sql;
    }
    if (other.abap !== undefined && other.edm !== undefined) {
      const canonical = literalToCanonical(other.abap, other.edm, side.literal, name);
      return sql`${toSql(other.abap, canonical)}`;
    }
    if (other.edm?.type === "Edm.Int32") {
      return sql`${Number(side.literal.value)}`;
    }
    return sql`${side.literal.value}`;
  }

  private stringArgument(info: TypeInfo, alias: string, expr: Expr | undefined, fn: string): RawBuilder<unknown> {
    if (expr === undefined) {
      throw badRequest(`${fn}: missing argument`);
    }
    const typed = this.operand(info, alias, expr);
    if (typed.literal !== undefined) {
      if (typed.literal.type !== "string") {
        throw badRequest(`${fn}: the argument must be a string`);
      }
      return sql`${typed.literal.value}`;
    }
    return typed.edm?.type === "Edm.String" ? typed.sql : sql`CAST(${typed.sql} AS text)`;
  }

  private likePattern(info: TypeInfo, alias: string, expr: Expr | undefined, fn: string, prefix: string, suffix: string): RawBuilder<unknown> {
    if (expr?.kind !== "literal" || expr.literal.type !== "string") {
      const value = this.stringArgument(info, alias, expr, fn);
      return sql`${prefix} || replace(replace(replace(${value}, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || ${suffix}`;
    }
    return sql`${`${prefix}${escapeLike(String(expr.literal.value))}${suffix}`}`;
  }

  private call(info: TypeInfo, alias: string, name: string, args: Expr[]): Typed {
    const string = (i: number): RawBuilder<unknown> => this.stringArgument(info, alias, args[i], name);
    const any = (i: number): Typed => {
      const arg = args[i];
      if (arg === undefined) {
        throw badRequest(`${name}: missing argument ${i + 1}`);
      }
      return this.operand(info, alias, arg);
    };
    const int: EdmType = { type: "Edm.Int32" };
    switch (name) {
      case "contains":
        return { sql: sql`(${string(0)} LIKE ${this.likePattern(info, alias, args[1], name, "%", "%")} ESCAPE '\\')`, edm: { type: "Edm.Boolean" } };
      case "startswith":
        return { sql: sql`(${string(0)} LIKE ${this.likePattern(info, alias, args[1], name, "", "%")} ESCAPE '\\')`, edm: { type: "Edm.Boolean" } };
      case "endswith":
        return { sql: sql`(${string(0)} LIKE ${this.likePattern(info, alias, args[1], name, "%", "")} ESCAPE '\\')`, edm: { type: "Edm.Boolean" } };
      case "tolower":
        return { sql: sql`lower(${string(0)})`, edm: { type: "Edm.String" } };
      case "toupper":
        return { sql: sql`upper(${string(0)})`, edm: { type: "Edm.String" } };
      case "trim":
        return { sql: sql`btrim(${string(0)})`, edm: { type: "Edm.String" } };
      case "length":
        return { sql: sql`char_length(${string(0)})`, edm: int };
      case "indexof":
        return { sql: sql`(strpos(${string(0)}, ${string(1)}) - 1)`, edm: int };
      case "concat":
        return { sql: sql`(${string(0)} || ${string(1)})`, edm: { type: "Edm.String" } };
      case "substring": {
        const start = any(1);
        const length = args[2] === undefined ? undefined : any(2);
        return {
          sql: length === undefined ? sql`substr(${string(0)}, ${this.bind(start, { sql: sql``, edm: int }, name)} + 1)` : sql`substr(${string(0)}, ${this.bind(start, { sql: sql``, edm: int }, name)} + 1, ${this.bind(length, { sql: sql``, edm: int }, name)})`,
          edm: { type: "Edm.String" },
        };
      }
      case "year":
      case "month":
      case "day":
      case "hour":
      case "minute":
      case "second": {
        const value = any(0);
        return { sql: sql`CAST(EXTRACT(${sql.raw(name.toUpperCase())} FROM ${value.sql}) AS integer)`, edm: int };
      }
      case "now":
        return { sql: sql`now()`, edm: { type: "Edm.DateTimeOffset", precision: 7 }, abap: { kind: "timestampl" } };
      default:
        throw notImplemented(`The function ${name}`);
    }
  }

  public condition(info: TypeInfo, alias: string, expr: Expr): RawBuilder<unknown> {
    switch (expr.kind) {
      case "binary": {
        if (expr.op === "and" || expr.op === "or") {
          const left = this.condition(info, alias, expr.left);
          const right = this.condition(info, alias, expr.right);
          return expr.op === "and" ? sql`(${left} AND ${right})` : sql`(${left} OR ${right})`;
        }
        const left = this.operand(info, alias, expr.left);
        const right = this.operand(info, alias, expr.right);
        const name = expr.left.kind === "member" ? expr.left.path.join("/") : expr.right.kind === "member" ? expr.right.path.join("/") : "";
        if (right.literal?.type === "null" || left.literal?.type === "null") {
          const other = right.literal?.type === "null" ? left : right;
          if (expr.op === "eq") return sql`(${other.sql} IS NULL)`;
          if (expr.op === "ne") return sql`(${other.sql} IS NOT NULL)`;
          throw badRequest(`null can only be compared with eq or ne`);
        }
        const l = this.bind(left, right, name);
        const r = this.bind(right, left, name);
        const op = { eq: "=", ne: "<>", gt: ">", ge: ">=", lt: "<", le: "<=" }[expr.op];
        if (expr.op === "ne") {
          // OData: ne is true when the property is null and the literal is not
          return sql`(${l} IS DISTINCT FROM ${r})`;
        }
        return sql`(${l} ${sql.raw(op)} ${r})`;
      }
      case "not":
        return sql`(NOT ${this.condition(info, alias, expr.operand)})`;
      case "in": {
        const operand = this.operand(info, alias, expr.operand);
        const values = expr.list.map((item) => this.bind(this.operand(info, alias, item), operand, ""));
        return values.length === 0 ? sql`FALSE` : sql`(${operand.sql} IN (${sql.join(values)}))`;
      }
      case "call": {
        const typed = this.call(info, alias, expr.name, expr.args);
        if (typed.edm?.type !== "Edm.Boolean") {
          throw badRequest(`${expr.name} does not return a boolean`);
        }
        return typed.sql;
      }
      case "member": {
        const typed = this.column(info, alias, expr.path);
        if (typed.edm?.type !== "Edm.Boolean") {
          throw badRequest(`${expr.path.join("/")} is not a boolean`);
        }
        return sql`(${typed.sql} = TRUE)`;
      }
      case "literal":
        if (expr.literal.type === "bool") {
          return expr.literal.value === true ? sql`TRUE` : sql`FALSE`;
        }
        throw badRequest("A literal is not a condition");
    }
  }

  /** `$search`: every term must be found in one of the search fields (case-insensitive). */
  private search(info: TypeInfo, alias: string, text: string): RawBuilder<unknown> {
    const fields = info.set.searchFields.length > 0 ? info.set.searchFields : [];
    if (!info.set.searchable || fields.length === 0) {
      throw badRequest(`${info.set.name} does not support $search`);
    }
    const terms = (text.match(/"[^"]*"|\S+/g) ?? []).map((t) => t.replace(/^"|"$/g, "")).filter((t) => t !== "" && t !== "AND" && t !== "OR");
    if (terms.length === 0) {
      return sql`TRUE`;
    }
    const perTerm = terms.map((term) => {
      const pattern = `%${escapeLike(term)}%`;
      return sql`(${sql.join(
        fields.map((f) => sql`CAST(${sql.ref(`${alias}.${f}`)} AS text) ILIKE ${pattern} ESCAPE '\\'`),
        sql` OR `,
      )})`;
    });
    return sql.join(perTerm, sql` AND `);
  }

  // -------------------------------------------------------------------------------------------
  // queries

  /** The condition of the access controls of the entity for the user of the request, if any. */
  private accessCondition(info: TypeInfo, alias: string): RawBuilder<unknown> | undefined {
    const fieldOf = (entity: TypeInfo["entity"], name: string): FieldModel => {
      const field = entity.fields.find((f) => f.name === name) ?? entity.fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
      if (field === undefined) {
        throw new Error(`access control: ${entity.name} has no element ${name}`);
      }
      return field;
    };
    return this.access?.condition(info.entity.name, (element) => {
      const [association, name] = element.split(".");
      if (name === undefined) {
        const field = fieldOf(info.entity, element);
        return { sql: sql.ref(`${alias}.${field.name}`), type: field.type };
      }
      // a path through a to-one association (_Travel.AgencyID): scalar sub-query on the target view
      const { navigation, target } = this.service.navigationTarget(info, association as string);
      const field = fieldOf(target.entity, name);
      const inner = `${alias}_dcl_${(association as string).replace(/\W/g, "")}`;
      const conditions = navigation.on.map((p) => sql`${sql.ref(`${inner}.${p.target}`)} = ${sql.ref(`${alias}.${p.source}`)}`);
      return {
        sql: sql`(SELECT ${sql.ref(`${inner}.${field.name}`)} FROM ${sql.table(target.view)} AS ${sql.id(inner)} WHERE ${sql.join(conditions, sql` AND `)} LIMIT 1)`,
        type: field.type,
      };
    });
  }

  private where(info: TypeInfo, alias: string, options: QueryOptions, extra: RawBuilder<unknown>[]): RawBuilder<unknown> {
    const conditions = [...extra];
    // drafts (D54): the active instances, and the drafts in process by the user
    if (info.entity.draft !== undefined && !("admin" in info.entity.draft)) {
      const user = currentReader()?.abapName ?? "";
      conditions.push(sql`(${sql.ref(`${alias}.IsActiveEntity`)} OR EXISTS (SELECT 1 FROM "rapt_draft_admin" "dra" WHERE "dra"."DraftUUID" = ${sql.ref(`${alias}.DraftUUID`)} AND ("dra"."InProcessByUser" = ${user} OR EXISTS (SELECT 1 FROM "rapt_draft_user" "dru" WHERE "dru"."DraftUUID" = "dra"."DraftUUID" AND "dru"."UserID" = ${user}))))`);
    }
    const access = this.accessCondition(info, alias);
    if (access !== undefined) {
      conditions.push(access);
    }
    if (options.filter !== undefined) {
      conditions.push(this.condition(info, alias, options.filter));
    }
    if (options.search !== undefined && options.search.trim() !== "") {
      conditions.push(this.search(info, alias, options.search));
    }
    return conditions.length === 0 ? sql`` : sql`WHERE ${sql.join(conditions, sql` AND `)}`;
  }

  private orderBy(info: TypeInfo, alias: string, orderby: OrderItem[] | undefined): RawBuilder<unknown> {
    const items = (orderby ?? []).map((o) => {
      const column = this.column(info, alias, o.path);
      return o.descending ? sql`${column.sql} DESC NULLS LAST` : sql`${column.sql} ASC NULLS FIRST`;
    });
    // the keys make the order total, so that paging is stable
    for (const key of info.type.keys) {
      items.push(sql`${sql.ref(`${alias}.${key}`)} ASC`);
    }
    return sql`ORDER BY ${sql.join(items)}`;
  }

  /** Properties to read: the selected ones, the keys, the ETag and the fields joins need. */
  public selectedProperties(info: TypeInfo, options: QueryOptions, needed: string[] = []): string[] {
    const all = [...info.properties.keys()];
    let selected: string[];
    if (options.select === undefined || options.select.some((p) => p[0] === "*")) {
      selected = all;
    } else {
      selected = [];
      for (const path of options.select) {
        const name = path[0] as string;
        if (name.startsWith("__")) {
          continue; // instance feature control (also its members: __OperationControl/accept), computed by the RAP runtime
        }
        if (path.length > 1 || name.includes(".")) {
          if (name.includes(".")) {
            continue; // operations in $select (advertised actions) carry no data
          }
          throw notImplemented(`$select of the path ${path.join("/")}`);
        }
        if (!info.properties.has(name)) {
          if (info.navigations.has(name)) {
            continue;
          }
          throw badRequest(`$select: ${info.type.name} has no property ${name}`, name);
        }
        selected.push(name);
      }
    }
    const result = new Set([...info.type.keys, ...selected, ...needed]);
    if (info.type.etag !== undefined) {
      result.add(info.type.etag);
    }
    return all.filter((p) => result.has(p));
  }

  private rowFrom(info: TypeInfo, raw: Record<string, unknown>, properties: string[]): Row {
    const row: Row = {};
    for (const name of properties) {
      const { field } = this.service.property(info, name);
      row[name] = fromSql(field.type, raw[name]);
    }
    const etag = this.dependentEtag(info, "t0");
    if (etag !== undefined) {
      row[DEPENDENT_ETAG] = fromSql(etag.type, raw[DEPENDENT_ETAG]);
    }
    return row;
  }

  /**
   * The ETag of an `etag dependent` entity (D32): the ETag field of the master instance, read by
   * scalar sub-queries along the to-one navigations of the path.
   */
  private dependentEtag(info: TypeInfo, alias: string): { sql: RawBuilder<unknown>; type: AbapType } | undefined {
    const path = info.type.etagPath;
    if (path === undefined) {
      return undefined;
    }
    const hops: Array<{ on: Array<{ source: string; target: string }>; view: string; inner: string; outer: string }> = [];
    let current = info;
    let outer = alias;
    path.navigations.forEach((name, i) => {
      const { navigation, target } = this.service.navigationTarget(current, name);
      const inner = `${alias}_etag${i}`;
      hops.push({ on: navigation.on, view: target.view, inner, outer });
      current = target;
      outer = inner;
    });
    const { property, field } = this.service.property(current, path.property);
    let expression: RawBuilder<unknown> = sql.ref(`${outer}.${property.name}`);
    for (const hop of [...hops].reverse()) {
      const conditions = hop.on.map((p) => sql`${sql.ref(`${hop.inner}.${p.target}`)} = ${sql.ref(`${hop.outer}.${p.source}`)}`);
      expression = sql`(SELECT ${expression} FROM ${sql.table(hop.view)} AS ${sql.id(hop.inner)} WHERE ${sql.join(conditions, sql` AND `)} LIMIT 1)`;
    }
    return { sql: expression, type: field.type };
  }

  /** The columns of a query: the properties, and the ETag of an `etag dependent` entity. */
  private columns(info: TypeInfo, alias: string, properties: string[]): RawBuilder<unknown> {
    const columns = properties.map((p) => sql.ref(`${alias}.${p}`) as RawBuilder<unknown>);
    const etag = this.dependentEtag(info, alias);
    if (etag !== undefined) {
      columns.push(sql`${etag.sql} AS ${sql.id(DEPENDENT_ETAG)}`);
    }
    return sql.join(columns);
  }

  /** Conditions selecting one instance on the alias t0. */
  public keyConditions(info: TypeInfo, key: Key): RawBuilder<unknown>[] {
    return this.keyCondition(info, "t0", key);
  }

  private keyCondition(info: TypeInfo, alias: string, key: Key): RawBuilder<unknown>[] {
    if (info.entity.kind === "custom") {
      return [this.customScope(this.equalities(info, info.type.keys, info.type.keys.map((k) => key[k] ?? null)))];
    }
    return info.type.keys.map((k) => {
      const { field } = this.service.property(info, k);
      return sql`${sql.ref(`${alias}.${k}`)} = ${toSql(field.type, key[k] ?? null)}`;
    });
  }

  /** Reads a collection of an entity set, optionally restricted to the targets of a navigation. */
  public async readCollection(info: TypeInfo, options: QueryOptions, scope: RawBuilder<unknown>[] = [], withCount = options.count === true): Promise<ReadResult> {
    if (info.entity.kind === "custom") {
      return this.customCollection(info, options, scope, withCount);
    }
    const alias = "t0";
    const needed = this.neededForExpand(info, options.expand);
    const properties = this.selectedProperties(info, options, needed);
    const columns = this.columns(info, alias, properties);
    const where = this.where(info, alias, options, scope);
    const limit = Math.min(options.top ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
    const query = sql<Record<string, unknown>>`SELECT ${columns} FROM ${sql.table(info.view)} AS ${sql.id(alias)} ${where} ${this.orderBy(info, alias, options.orderby)} LIMIT ${limit} OFFSET ${options.skip ?? 0}`;
    const { rows } = await query.execute(this.db());
    const result: ReadResult = { rows: rows.map((r) => this.rowFrom(info, r, properties)) };
    if (withCount) {
      result.count = await this.count(info, options, scope);
    }
    await this.expand(info, result.rows, options.expand);
    return result;
  }

  /**
   * `$apply` (D52): the groups of the dimensions with their aggregates, after the filters of
   * `$apply` and `$filter` (on the instances), with the access controls; `$orderby` on the
   * dimensions and the aliases, `$top`, `$skip`, `$count` (number of groups).
   */
  public async readAggregated(info: TypeInfo, options: QueryOptions, scope: RawBuilder<unknown>[] = []): Promise<{ rows: Array<Record<string, CanonicalValue | number>>; count?: number; properties: string[]; aliases: string[] }> {
    if (info.entity.kind === "custom") {
      throw notImplemented("$apply on a custom entity");
    }
    const steps = options.apply ?? [];
    const alias = "t0";
    const filters = steps.filter((s): s is Extract<ApplyStep, { kind: "filter" }> => s.kind === "filter").map((s) => this.condition(info, alias, s.filter));
    const grouping = steps.find((s) => s.kind !== "filter") as Exclude<ApplyStep, { kind: "filter" }> | undefined;
    const dimensions = grouping?.kind === "groupby" ? grouping.properties : [];
    const items = grouping === undefined ? [] : grouping.aggregate;
    for (const d of dimensions) {
      if (!info.properties.has(d)) {
        throw badRequest(`$apply: ${info.type.name} has no property ${d}`, d);
      }
    }
    const aliases = items.map((i) => i.alias);
    if (new Set([...dimensions, ...aliases]).size !== dimensions.length + aliases.length) {
      throw badRequest("$apply: an alias repeats a property or another alias");
    }
    const aggregate = (item: AggregateItem): RawBuilder<unknown> => {
      if (item.method === "count") {
        return sql`count(*)`;
      }
      const name = item.property ?? "";
      if (!info.properties.has(name)) {
        throw badRequest(`$apply: ${info.type.name} has no property ${name}`, name);
      }
      const column = sql.ref(`${alias}.${name}`);
      switch (item.method) {
        case "sum":
          return sql`coalesce(sum(${column}), 0)`;
        case "average":
          return sql`avg(${column})`;
        case "countdistinct":
          return sql`count(DISTINCT ${column})`;
        default:
          return sql`${sql.raw(item.method)}(${column})`;
      }
    };
    const columns = [...dimensions.map((d) => sql.ref(`${alias}.${d}`) as RawBuilder<unknown>), ...items.map((i) => sql`${aggregate(i)} AS ${sql.id(i.alias)}`)];
    if (columns.length === 0) {
      throw badRequest("$apply: groupby or aggregate is needed");
    }
    const where = this.where(info, alias, options, [...scope, ...filters]);
    const groupBy = dimensions.length === 0 ? sql`` : sql`GROUP BY ${sql.join(dimensions.map((d) => sql.ref(`${alias}.${d}`)))}`;
    const order = (options.orderby ?? []).map((o) => {
      const name = o.path.join("/");
      if (!dimensions.includes(name) && !aliases.includes(name)) {
        throw badRequest(`$orderby: ${name} is not a property or an alias of $apply`);
      }
      return sql`${sql.id(name)} ${sql.raw(o.descending ? "DESC NULLS LAST" : "ASC NULLS FIRST")}`;
    });
    for (const d of dimensions) {
      order.push(sql`${sql.id(d)} ASC`);
    }
    const orderBy = order.length === 0 ? sql`` : sql`ORDER BY ${sql.join(order)}`;
    const inner = sql`SELECT ${sql.join(columns)} FROM ${sql.table(info.view)} AS ${sql.id(alias)} ${where} ${groupBy}`;
    const limit = Math.min(options.top ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
    const { rows } = await sql<Record<string, unknown>>`SELECT * FROM (${inner}) AS "g" ${orderBy} LIMIT ${limit} OFFSET ${options.skip ?? 0}`.execute(this.db());
    const result: { rows: Array<Record<string, CanonicalValue | number>>; count?: number; properties: string[]; aliases: string[] } = {
      rows: rows.map((raw) => {
        const row: Record<string, CanonicalValue | number> = {};
        for (const d of dimensions) {
          row[d] = fromSql(this.service.property(info, d).field.type, raw[d]);
        }
        for (const a of aliases) {
          const value = raw[a];
          row[a] = value === null || value === undefined ? 0 : Number(value);
        }
        return row;
      }),
      properties: dimensions,
      aliases,
    };
    if (options.count === true) {
      const counted = await sql<{ n: string | number }>`SELECT count(*) AS n FROM (${inner}) AS "g"`.execute(this.db());
      result.count = Number(counted.rows[0]?.n ?? 0);
    }
    return result;
  }

  public async count(info: TypeInfo, options: QueryOptions, scope: RawBuilder<unknown>[] = []): Promise<number> {
    if (info.entity.kind === "custom") {
      const scoped = this.scopeConditions(scope);
      const filter = options.filter === undefined ? undefined : this.customQueries().condition(info, options.filter);
      const result = await this.customQueries().select(info, { ...(filter === undefined ? {} : { filter }), scope: scoped, ...(options.search === undefined ? {} : { search: options.search }), count: true, data: false, properties: [] });
      return result.total ?? 0;
    }
    const alias = "t0";
    const where = this.where(info, alias, { ...(options.filter === undefined ? {} : { filter: options.filter }), ...(options.search === undefined ? {} : { search: options.search }) }, scope);
    const { rows } = await sql<{ n: string | number }>`SELECT count(*) AS n FROM ${sql.table(info.view)} AS ${sql.id(alias)} ${where}`.execute(this.db());
    return Number(rows[0]?.n ?? 0);
  }

  public async readOne(info: TypeInfo, key: Key, options: QueryOptions): Promise<Row | undefined> {
    const result = await this.readCollection(info, { ...options, top: 1, skip: 0, count: false, orderby: [] }, this.keyCondition(info, "t0", key), false);
    return result.rows[0];
  }

  /** Scope of a navigation from a source instance: conditions on the target alias t0. */
  public async navigationScope(source: TypeInfo, key: Key, navigation: string): Promise<{ target: TypeInfo; scope: RawBuilder<unknown>[]; collection: boolean } | undefined> {
    const { navigation: nav, target } = this.service.navigationTarget(source, navigation);
    const parent = await this.readOne(source, key, { select: nav.on.map((p) => [p.source]) });
    if (parent === undefined) {
      return undefined;
    }
    if (target.entity.kind === "custom") {
      return { target, scope: [this.customScope(this.equalities(target, nav.on.map((p) => p.target), nav.on.map((p) => parent[p.source] as CanonicalValue)))], collection: nav.collection };
    }
    const scope = nav.on.map((p) => {
      const { field } = this.service.property(target, p.target);
      const value = parent[p.source] as CanonicalValue;
      return value === null ? sql`${sql.ref(`t0.${p.target}`)} IS NULL` : sql`${sql.ref(`t0.${p.target}`)} = ${toSql(field.type, value)}`;
    });
    return { target, scope, collection: nav.collection };
  }

  private neededForExpand(info: TypeInfo, expand: ExpandItem[] | undefined): string[] {
    const needed: string[] = [];
    for (const item of expand ?? []) {
      if (item.path[0] === "*") {
        for (const nav of info.navigations.values()) {
          needed.push(...nav.on.map((p) => p.source));
        }
        continue;
      }
      const nav = info.navigations.get(item.path[0] ?? "");
      if (nav !== undefined) {
        needed.push(...nav.on.map((p) => p.source));
      }
    }
    return needed;
  }

  /** $expand, one level: one query per navigation for all the rows of the page. */
  private async expand(info: TypeInfo, rows: Row[], expand: ExpandItem[] | undefined): Promise<void> {
    if (expand === undefined || rows.length === 0) {
      return;
    }
    const items: ExpandItem[] = expand.flatMap((item): ExpandItem[] => (item.path[0] === "*" ? [...info.navigations.keys()].map((n) => ({ path: [n], options: {} })) : [item]));
    for (const item of items) {
      if (item.path.length !== 1) {
        throw notImplemented(`$expand of the path ${item.path.join("/")}`);
      }
      if (item.options.expand !== undefined) {
        throw notImplemented("Nested $expand (one level is supported)");
      }
      const { navigation, target } = this.service.navigationTarget(info, item.path[0] as string);
      const alias = "t0";
      const targetFields = navigation.on.map((p) => p.target);
      const needed = [...targetFields];
      const properties = this.selectedProperties(target, item.options, needed);
      if (target.entity.kind === "custom") {
        await this.customExpand(rows, target, navigation, item, properties, needed);
        continue;
      }
      const tuples = rows.map((r) => navigation.on.map((p) => r[p.source] as CanonicalValue));
      const distinct = [...new Map(tuples.map((t) => [JSON.stringify(t), t])).values()].filter((t) => t.every((v) => v !== null));
      const attach = (matches: Row[]): void => {
        for (const row of rows) {
          const mine = matches.filter((m) => navigation.on.every((p) => m[p.target] === row[p.source]));
          row[navigation.name] = navigation.collection ? mine.map((m) => strip(m, properties, needed)) : mine[0] === undefined ? null : strip(mine[0], properties, needed);
        }
      };
      if (distinct.length === 0) {
        attach([]);
        continue;
      }
      const inCondition = sql`(${sql.join(targetFields.map((f) => sql.ref(`${alias}.${f}`)))}) IN (${sql.join(
        distinct.map((t) => sql`(${sql.join(t.map((v, i) => sql`${toSql(this.service.property(target, targetFields[i] as string).field.type, v)}`))})`),
      )})`;
      const where = this.where(target, alias, item.options, [inCondition]);
      const columns = this.columns(target, alias, properties);
      let query: RawBuilder<Record<string, unknown>>;
      if (navigation.collection && (item.options.top !== undefined || item.options.skip !== undefined)) {
        const partition = sql.join(targetFields.map((f) => sql.ref(`${alias}.${f}`)));
        const from = item.options.skip ?? 0;
        const to = item.options.top === undefined ? null : from + item.options.top;
        query = sql`SELECT * FROM (SELECT ${columns}, row_number() OVER (PARTITION BY ${partition} ${this.orderBy(target, alias, item.options.orderby)}) AS "__rn" FROM ${sql.table(target.view)} AS ${sql.id(alias)} ${where}) AS "x" WHERE "__rn" > ${from} ${to === null ? sql`` : sql`AND "__rn" <= ${to}`} ORDER BY "__rn"`;
      } else {
        query = sql`SELECT ${columns} FROM ${sql.table(target.view)} AS ${sql.id(alias)} ${where} ${this.orderBy(target, alias, item.options.orderby)}`;
      }
      const { rows: raw } = await query.execute(this.db());
      const matches = raw.map((r) => this.rowFrom(target, r, properties));
      attach(matches);
      if (navigation.collection && item.options.count === true) {
        const countWhere = this.where(target, alias, { ...(item.options.filter === undefined ? {} : { filter: item.options.filter }) }, [inCondition]);
        const grouped = await sql<Record<string, unknown>>`SELECT ${sql.join(targetFields.map((f) => sql.ref(`${alias}.${f}`)))}, count(*) AS "__n" FROM ${sql.table(target.view)} AS ${sql.id(alias)} ${countWhere} GROUP BY ${sql.join(targetFields.map((f) => sql.ref(`${alias}.${f}`)))}`.execute(this.db());
        const counts = grouped.rows.map((g) => ({ key: targetFields.map((f) => fromSql(this.service.property(target, f).field.type, g[f])), n: Number(g["__n"]) }));
        for (const row of rows) {
          const found = counts.find((c) => navigation.on.every((p, i) => c.key[i] === row[p.source]));
          row[`${navigation.name}@odata.count`] = found?.n ?? 0;
        }
      }
    }
  }
}

/** Removes the fields read only to join, unless selected. */
function strip(row: Row, properties: string[], needed: string[]): Row {
  void needed;
  const copy: Row = {};
  for (const p of properties) {
    copy[p] = row[p];
  }
  if (row[DEPENDENT_ETAG] !== undefined) {
    copy[DEPENDENT_ETAG] = row[DEPENDENT_ETAG];
  }
  return copy;
}
