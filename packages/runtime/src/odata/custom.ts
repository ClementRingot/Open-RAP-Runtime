/**
 * Reads of custom entities (decision D43): the query class of the entity
 * (`@ObjectModel.query.implementedBy`) is called with the request of the OData read — filter as
 * ABAP SQL condition and as ranges, sort elements, paging, requested elements, count — and
 * returns the rows through `io_response->set_data`, as in ABAP Cloud.
 */

import { isUuid, type AbapType, type EntityModel } from "@open-rap-runtime/model";
import { developmentUser, type User } from "../auth/user.js";
import { abapGlobal, appendRow, component, getAbapValue, rowsOf, type AbapData } from "../abap/convert.js";
import type { Database } from "../db/database.js";
import type { RapRuntime } from "../rap/runtime.js";
import { literalToCanonical, type CanonicalValue } from "../values.js";
import { currentReader } from "./access.js";
import { badRequest, notImplemented, ODataError } from "./errors.js";
import type { Row } from "./read.js";
import type { ServiceRuntime, TypeInfo } from "./service.js";
import type { Expr, OrderItem } from "./uri/ast.js";

/** A condition on the elements of a custom entity, values in canonical form. */
export type Cond =
  | { kind: "cmp"; name: string; op: "eq" | "ne" | "gt" | "ge" | "lt" | "le"; value: CanonicalValue }
  | { kind: "like"; name: string; pattern: string; negated?: boolean }
  | { kind: "and" | "or"; items: Cond[] }
  | { kind: "not"; item: Cond };

export interface QueryCall {
  filter?: Cond;
  /** Conditions the rows must meet even if the query class ignores them (keys, navigations). */
  scope?: Cond[];
  orderby?: OrderItem[];
  top?: number;
  skip?: number;
  count: boolean;
  data: boolean;
  /** OData properties to read. */
  properties: string[];
  search?: string;
}

export interface QueryResult {
  rows: Row[];
  total?: number;
}

const SQL_OPERATORS = { eq: "=", ne: "<>", gt: ">", ge: ">=", lt: "<", le: "<=" } as const;
const RANGE_OPTIONS = { eq: "EQ", ne: "NE", gt: "GT", ge: "GE", lt: "LT", le: "LE" } as const;

/** A canonical value in the internal format of ABAP (dates YYYYMMDD, booleans X…). */
export function abapText(t: AbapType, value: CanonicalValue): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "X" : "";
  const text = String(value);
  switch (t.kind) {
    case "dats":
      return text.replace(/-/g, "");
    case "tims":
      return text.replace(/:/g, "");
    case "raw":
      return isUuid(t) ? text.replace(/-/g, "").toUpperCase() : text.toUpperCase();
    case "timestamp":
      return text.replace(/[-:T]/g, "").replace(/\..*$/, "").replace(/Z$/, "");
    case "timestampl": {
      const [main = "", fraction = ""] = text.replace(/Z$/, "").split(".");
      return `${main.replace(/[-:T]/g, "")}.${fraction.padEnd(7, "0").slice(0, 7)}`;
    }
    case "utclong":
      return text.replace(/Z$/, "");
    case "bool":
      return text === "true" || text === "X" ? "X" : "";
    default:
      return text;
  }
}

const quote = (text: string): string => `'${text.replace(/'/g, "''")}'`;

export class CustomQueries {
  /** The rows handed over by io_response of the running queries (innermost last). */
  private readonly running: Array<{ entity: EntityModel; rows: AbapData[]; total?: number }> = [];

  public constructor(
    private readonly service: ServiceRuntime,
    private readonly db: () => Database,
    private readonly rap: RapRuntime,
  ) {
    const kernel = abapGlobal().Classes["ZRAP_EML"];
    kernel.query_data = async (input: { data: AbapData }): Promise<void> => {
      const current = this.running[this.running.length - 1];
      if (current !== undefined) {
        // a copy: the query class may reuse its table
        current.rows = rowsOf(input.data).map((row) => row.clone());
      }
    };
    rap.customRead = async (entity: EntityModel, equalities: Array<{ name: string; value: CanonicalValue }>): Promise<Array<Record<string, CanonicalValue>>> => {
      const scope: Cond = { kind: "and", items: equalities.map((e): Cond => ({ kind: "cmp", name: e.name, op: "eq", value: e.value })) };
      const result = await this.run(entity, { scope: [scope], count: false, data: true, properties: entity.fields.map((f) => f.name) });
      return result.rows as Array<Record<string, CanonicalValue>>;
    };
    kernel.query_total = async (input: { total: AbapData }): Promise<void> => {
      const current = this.running[this.running.length - 1];
      if (current !== undefined) {
        current.total = Number(input.total.get());
      }
    };
  }

  // -------------------------------------------------------------------------------------------
  // conditions

  private type(entity: EntityModel, name: string): AbapType {
    const field = entity.fields.find((f) => f.name === name);
    if (field === undefined) {
      throw new Error(`${entity.name} has no element ${name}`);
    }
    return field.type;
  }

  /** The element behind an OData property. */
  public fieldName(info: TypeInfo, property: string): string {
    return this.service.property(info, property).field.name;
  }

  /** The condition of an OData $filter. */
  public condition(info: TypeInfo, expr: Expr): Cond {
    switch (expr.kind) {
      case "binary": {
        if (expr.op === "and" || expr.op === "or") {
          return { kind: expr.op, items: [this.condition(info, expr.left), this.condition(info, expr.right)] };
        }
        const [member, literal, op] =
          expr.left.kind === "member" && expr.right.kind === "literal"
            ? [expr.left, expr.right, expr.op]
            : expr.right.kind === "member" && expr.left.kind === "literal"
              ? [expr.right, expr.left, ({ eq: "eq", ne: "ne", gt: "lt", ge: "le", lt: "gt", le: "ge" } as const)[expr.op]]
              : [undefined, undefined, expr.op];
        if (member === undefined || literal === undefined) {
          throw notImplemented("$filter of a custom entity: comparisons of an element with a literal");
        }
        return { kind: "cmp", name: this.element(info, member.path), op, value: this.literal(info, member.path, literal.literal) };
      }
      case "not":
        return { kind: "not", item: this.condition(info, expr.operand) };
      case "in": {
        if (expr.operand.kind !== "member") {
          throw notImplemented("$filter of a custom entity: in on an element");
        }
        const path = expr.operand.path;
        return {
          kind: "or",
          items: expr.list.map((item) => {
            if (item.kind !== "literal") throw notImplemented("$filter of a custom entity: in with literals");
            return { kind: "cmp", name: this.element(info, path), op: "eq", value: this.literal(info, path, item.literal) } as Cond;
          }),
        };
      }
      case "call": {
        const [subject, argument] = expr.args;
        if (["contains", "startswith", "endswith"].includes(expr.name) && subject?.kind === "member" && argument?.kind === "literal") {
          const text = String(argument.literal.value ?? "").replace(/[%_]/g, (c) => `\\${c}`);
          const pattern = expr.name === "contains" ? `%${text}%` : expr.name === "startswith" ? `${text}%` : `%${text}`;
          return { kind: "like", name: this.element(info, subject.path), pattern };
        }
        throw notImplemented(`$filter of a custom entity: the function ${expr.name}`);
      }
      case "member":
        if (this.type(info.entity, this.element(info, expr.path)).kind === "bool") {
          return { kind: "cmp", name: this.element(info, expr.path), op: "eq", value: true };
        }
        throw badRequest(`$filter: ${expr.path.join("/")} is not a boolean`);
      default:
        throw notImplemented("$filter of a custom entity: this expression");
    }
  }

  /** The element of a property path of $filter. */
  private element(info: TypeInfo, path: string[]): string {
    const name = path[0] ?? "";
    if (path.length !== 1 || !info.properties.has(name)) {
      throw badRequest(`$filter: ${info.type.name} has no property ${path.join("/")}`);
    }
    return this.fieldName(info, name);
  }

  private literal(info: TypeInfo, path: string[], literal: Parameters<typeof literalToCanonical>[2]): CanonicalValue {
    const { property, field } = this.service.property(info, path[0] ?? "");
    return literalToCanonical(field.type, property.edm, literal, property.name);
  }

  /** The condition as get_as_sql_string gives it: `( PRODUCTID = 'P1' AND … )`. */
  public sql(entity: EntityModel, cond: Cond): string {
    switch (cond.kind) {
      case "cmp": {
        const name = cond.name.toUpperCase();
        if (cond.value === null) {
          return cond.op === "ne" ? `${name} IS NOT NULL` : `${name} IS NULL`;
        }
        const text = abapText(this.type(entity, cond.name), cond.value);
        const numeric = typeof cond.value === "number";
        return `${name} ${SQL_OPERATORS[cond.op]} ${numeric ? text : quote(text)}`;
      }
      case "like":
        return `${cond.name.toUpperCase()} ${cond.negated === true ? "NOT LIKE" : "LIKE"} ${quote(cond.pattern)}`;
      case "not":
        return `NOT ( ${this.sql(entity, cond.item)} )`;
      default:
        return `( ${cond.items.map((c) => this.sql(entity, c)).join(cond.kind === "and" ? " AND " : " OR ")} )`;
    }
  }

  /**
   * The condition as get_as_ranges gives it: one range table per element, the elements combined
   * with AND, the lines of a range with OR. Undefined when it cannot be expressed so.
   */
  public ranges(entity: EntityModel, cond: Cond): Map<string, Array<{ sign: string; option: string; low: string; high: string }>> | undefined {
    const result = new Map<string, Array<{ sign: string; option: string; low: string; high: string }>>();
    const conjuncts = cond.kind === "and" ? flattenAnd(cond) : [cond];
    for (const conjunct of conjuncts) {
      const lines = this.rangeLines(entity, conjunct);
      if (lines === undefined) return undefined;
      const existing = result.get(lines.name);
      if (existing === undefined) {
        result.set(lines.name, lines.lines);
        continue;
      }
      // the same element twice in an AND: an interval, else not expressible
      const merged = interval(existing, lines.lines);
      if (merged === undefined) return undefined;
      result.set(lines.name, merged);
    }
    return result;
  }

  private rangeLines(entity: EntityModel, cond: Cond): { name: string; lines: Array<{ sign: string; option: string; low: string; high: string }> } | undefined {
    switch (cond.kind) {
      case "cmp":
        if (cond.value === null) return undefined;
        return { name: cond.name.toUpperCase(), lines: [{ sign: "I", option: RANGE_OPTIONS[cond.op], low: abapText(this.type(entity, cond.name), cond.value), high: "" }] };
      case "like": {
        if (/\\[%_]/.test(cond.pattern)) return undefined;
        return { name: cond.name.toUpperCase(), lines: [{ sign: cond.negated === true ? "E" : "I", option: "CP", low: cond.pattern.replace(/%/g, "*").replace(/_/g, "+"), high: "" }] };
      }
      case "not": {
        const inner = this.rangeLines(entity, cond.item);
        if (inner === undefined || inner.lines.length !== 1) return undefined;
        return { name: inner.name, lines: inner.lines.map((l) => ({ ...l, sign: l.sign === "I" ? "E" : "I" })) };
      }
      case "or": {
        const parts = cond.items.flatMap((c) => (c.kind === "or" ? c.items : [c])).map((c) => this.rangeLines(entity, c));
        if (parts.some((p) => p === undefined)) return undefined;
        const names = new Set(parts.map((p) => p?.name));
        if (names.size !== 1 || parts.some((p) => p?.lines.some((l) => l.sign === "E"))) return undefined;
        return { name: parts[0]?.name ?? "", lines: parts.flatMap((p) => p?.lines ?? []) };
      }
      default:
        return undefined;
    }
  }

  // -------------------------------------------------------------------------------------------
  // the call of the query class

  /** Reads a custom entity of the service: rows keyed by OData property. */
  public async select(info: TypeInfo, call: QueryCall): Promise<QueryResult> {
    const orderby = (call.orderby ?? []).map((item) => {
      const name = item.path[0] ?? "";
      if (item.path.length !== 1 || !info.properties.has(name)) {
        throw badRequest(`$orderby: ${info.type.name} has no property ${item.path.join("/")}`);
      }
      return { path: [this.fieldName(info, name)], descending: item.descending };
    });
    const result = await this.run(info.entity, { ...call, orderby, properties: call.properties.map((p) => this.fieldName(info, p)) });
    const rows = result.rows.map((byField) => {
      const row: Row = {};
      for (const [property, { field }] of info.properties) {
        row[property] = byField[field.name] ?? null;
      }
      return row;
    });
    return result.total === undefined ? { rows } : { rows, total: result.total };
  }

  /**
   * Calls the query class of a custom entity: rows keyed by element. Inside a LUW (the RAP
   * runtime reading the instances of a BO), in that LUW; otherwise in a LUW of its own,
   * serialized with the other ABAP work.
   */
  public async run(entity: EntityModel, call: QueryCall): Promise<QueryResult> {
    const user: User = currentReader() ?? developmentUser();
    return this.rap.inLuw() ? this.call(entity, call) : this.rap.transaction(this.db() as never, user, "en", () => this.call(entity, call));
  }

  private async call(entity: EntityModel, call: QueryCall): Promise<QueryResult> {
    const queryClass = entity.queryClass;
    const abap = abapGlobal();
    const Query = queryClass === undefined ? undefined : abap.Classes[queryClass];
    if (Query === undefined) {
      throw new ODataError(500, "QUERY_CLASS", `${entity.name}: query class ${queryClass ?? "?"} not loaded`);
    }
    const request = await new abap.Classes["ZRAP_CL_QUERY_REQUEST"]().constructor_();
    request.entity_id.set(entity.name.toUpperCase());
    request.data_requested.set(call.data ? "X" : "");
    request.count_requested.set(call.count ? "X" : "");
    request.search_expression.set(call.search ?? "");
    const paging = request.paging.get();
    paging.offset.set(call.skip ?? 0);
    paging.page_size.set(call.top ?? -1);
    for (const name of call.properties) {
      appendRow(request.requested_elements, (row) => row.set(name.toUpperCase()));
    }
    for (const item of call.orderby ?? []) {
      appendRow(request.sort_elements, (row) => {
        component(row, "element_name").set((item.path[0] ?? "").toUpperCase());
        component(row, "descending").set(item.descending ? "X" : "");
      });
    }
    const conditions = [...(call.scope ?? []), ...(call.filter === undefined ? [] : [call.filter])];
    const filterCond: Cond | undefined = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : { kind: "and", items: conditions };
    if (filterCond !== undefined) {
      const filter = request.filter.get();
      filter.sql.set(this.sql(entity, filterCond));
      const ranges = this.ranges(entity, filterCond);
      if (ranges === undefined) {
        filter.no_range.set("X");
      } else {
        for (const [name, lines] of ranges) {
          appendRow(filter.ranges, (pair) => {
            component(pair, "name").set(name);
            for (const line of lines) {
              appendRow(component(pair, "range"), (r) => {
                for (const [k, v] of Object.entries(line)) component(r, k).set(v);
              });
            }
          });
        }
      }
    }
    const response = await new abap.Classes["ZRAP_CL_QUERY_RESPONSE"]().constructor_();
    const instance = await new Query().constructor_();
    const ref = (object: AbapData): AbapData => new abap.types.ABAPObject().set(object);
    const current: { entity: EntityModel; rows: AbapData[]; total?: number } = { entity, rows: [] };
    this.running.push(current);
    try {
      await instance.if_rap_query_provider$select({ io_request: ref(request), io_response: ref(response) });
    } catch (error) {
      if (error instanceof ODataError) throw error;
      throw new ODataError(500, "QUERY_FAILED", `${entity.name}: ${exceptionText(this.rap, error)}`);
    } finally {
      this.running.pop();
    }
    const rows = current.rows
      .map((abapRow) => {
        const row: Row = {};
        for (const field of entity.fields) {
          const value = component(abapRow, field.name);
          row[field.name] = value === undefined ? null : getAbapValue(value, field.type);
        }
        return row;
      })
      // keys and navigations hold even if the query class ignores them
      .filter((row) => (call.scope ?? []).every((c) => holds(row, c)));
    const result: QueryResult = { rows: call.top === undefined || call.top < 0 ? rows : rows.slice(0, call.top) };
    if (call.count) {
      result.total = current.total ?? rows.length;
    }
    return result;
  }
}

/** Whether a row meets a condition of a scope (equalities, and, or). */
export function holds(row: Row, cond: Cond): boolean {
  switch (cond.kind) {
    case "cmp":
      return cond.op === "eq" ? row[cond.name] === cond.value : true;
    case "and":
      return cond.items.every((c) => holds(row, c));
    case "or":
      return cond.items.some((c) => holds(row, c));
    default:
      return true;
  }
}

function flattenAnd(cond: Cond): Cond[] {
  return cond.kind === "and" ? cond.items.flatMap(flattenAnd) : [cond];
}

/** `x ge a and x le b` → `BT a b`. */
function interval(
  a: Array<{ sign: string; option: string; low: string; high: string }>,
  b: Array<{ sign: string; option: string; low: string; high: string }>,
): Array<{ sign: string; option: string; low: string; high: string }> | undefined {
  const [x, y] = [a[0], b[0]];
  if (a.length !== 1 || b.length !== 1 || x === undefined || y === undefined || x.sign !== "I" || y.sign !== "I") return undefined;
  const lower = x.option === "GE" ? x : y.option === "GE" ? y : undefined;
  const upper = x.option === "LE" ? x : y.option === "LE" ? y : undefined;
  return lower !== undefined && upper !== undefined && lower !== upper ? [{ sign: "I", option: "BT", low: lower.low, high: upper.low }] : undefined;
}

/** The text of an exception raised by a query class (its own, its T100 text or that of its previous). */
function exceptionText(rap: RapRuntime, error: unknown): string {
  if (error instanceof Error && !("zrap_text" in error)) {
    return error.message;
  }
  const object = error as AbapData;
  let text = rap.bridge.exceptionText(object);
  const previous = object?.previous?.get?.();
  if (text === "An exception was raised" && previous !== undefined && previous !== null) {
    text = rap.bridge.exceptionText(previous);
  }
  return text;
}
