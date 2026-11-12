/**
 * Calculated elements of view entities and projections (D64): the parsed expression of an element
 * resolved against the data source, and typed.
 */

import { isCharacterLike, isNumeric, type AbapType, type CdsCondition, type CdsExpression, type CdsFunctionName } from "@rap-transpiler/model";
import { isCondition, type CdsCondAst, type CdsExprAst } from "../cds/expression-ast.js";
import { parseBuiltInType } from "../ddic/catalog.js";
import type { Dictionary } from "./dictionary.js";

/** A diagnostic of an expression: CDS002 unsupported, CDS004 unknown name, CDS022 invalid. */
export class ExpressionIssue extends Error {
  public constructor(
    public readonly code: "CDS002" | "CDS004" | "CDS022",
    message: string,
  ) {
    super(message);
  }
}

export interface ExpressionScope {
  /** Prefixes of the paths to the data source (its name, its alias). */
  sourcePrefixes: string[];
  /** Names of the associations of the entity. */
  associations: Set<string>;
  /** A plain name of the data source: a table column (lower case) or an element of the source entity. */
  column(name: string): { name: string; type: AbapType } | undefined;
  /** The data source, for messages. */
  sourceName: string;
  /** `$projection.X`: an element of the entity itself, typed; undefined when unknown. */
  element(name: string): { name: string; type: AbapType } | undefined;
  dictionary: Dictionary;
}

const FUNCTIONS: Record<CdsFunctionName, number> = {
  concat: 2,
  concat_with_space: 3,
  substring: 3,
  upper: 1,
  lower: 1,
  length: 1,
  left: 2,
  right: 2,
  ltrim: 2,
  rtrim: 2,
  replace: 3,
  coalesce: 2,
  div: 2,
  division: 3,
  mod: 2,
  abs: 1,
  round: 2,
  ceil: 1,
  floor: 1,
  dats_days_between: 2,
  dats_add_days: 3,
};

const INT_RANK: Partial<Record<AbapType["kind"], number>> = { int1: 1, int2: 2, int4: 3, int8: 4 };
const INT_DIGITS: Partial<Record<AbapType["kind"], number>> = { int1: 3, int2: 5, int4: 10, int8: 19 };
const MAX_DIGITS = 31;

const isNullLiteral = (e: CdsExpression): boolean => e.kind === "literal" && e.value === null;
const isInteger = (t: AbapType): boolean => INT_RANK[t.kind] !== undefined;
const isPacked = (t: AbapType): boolean => t.kind === "dec" || t.kind === "curr" || t.kind === "quan";
const plain = (t: AbapType): AbapType => {
  const { dataElement: _d, enumType: _e, ...rest } = t;
  return rest;
};

/** Resolves and types the expression of a calculated element. Throws an ExpressionIssue. */
export function resolveExpression(ast: CdsExprAst, scope: ExpressionScope): CdsExpression {
  const expression = new Resolver(scope).expression(ast);
  if (isNullLiteral(expression)) {
    throw new ExpressionIssue("CDS022", "the type of NULL cannot be inferred: use CAST( NULL AS type )");
  }
  return expression;
}

class Resolver {
  public constructor(private readonly scope: ExpressionScope) {}

  public expression(ast: CdsExprAst): CdsExpression {
    switch (ast.kind) {
      case "literal":
        return this.literal(ast);
      case "path":
        return this.path(ast.path);
      case "negate": {
        const operand = this.expression(ast.operand);
        this.numeric(operand, "-");
        return { kind: "negate", operand, type: plain(operand.type) };
      }
      case "arithmetic":
        return this.arithmetic(ast.operator, this.expression(ast.left), this.expression(ast.right));
      case "case":
        return this.case(ast);
      case "cast":
        return { kind: "cast", operand: this.expression(ast.operand), type: this.castType(ast.type) };
      case "function":
        return this.function(ast.name, ast.args.map((a) => this.expression(a)));
    }
  }

  private literal(ast: Extract<CdsExprAst, { kind: "literal" }>): CdsExpression {
    if (ast.value === null) {
      return { kind: "literal", value: null, type: { kind: "char", length: 1 } };
    }
    if (ast.typed !== undefined) {
      const type = parseBuiltInType(ast.typed);
      if (type === undefined) {
        throw new ExpressionIssue("CDS022", `unknown type of the typed literal ${ast.text}`);
      }
      const value = String(ast.value);
      if (isCharacterLike(type) && type.length === undefined) {
        type.length = Math.max(1, value.length);
      }
      return { kind: "literal", value: isNumeric(type) ? Number(value) : value, type };
    }
    if (typeof ast.value === "string") {
      return { kind: "literal", value: ast.value, type: { kind: "char", length: Math.max(1, ast.value.length) } };
    }
    if (Number.isInteger(ast.value)) {
      return { kind: "literal", value: ast.value, type: { kind: Math.abs(ast.value) <= 2147483647 ? "int4" : "int8" } };
    }
    const digits = ast.text.replace(/^-/, "").split(".");
    const scale = digits[1]?.length ?? 0;
    return { kind: "literal", value: ast.value, type: { kind: "dec", length: Math.min(MAX_DIGITS, (digits[0]?.length ?? 1) + scale), decimals: scale } };
  }

  private path(path: string[]): CdsExpression {
    let rest = path;
    if (rest.length > 1 && this.scope.sourcePrefixes.some((p) => p.toUpperCase() === (rest[0] ?? "").toUpperCase())) {
      rest = rest.slice(1);
    }
    const head = (rest[0] ?? "").toUpperCase();
    const text = path.join(".");
    if (head === "$PROJECTION" && rest.length === 2) {
      const element = this.scope.element(rest[1] ?? "");
      if (element === undefined) {
        throw new ExpressionIssue("CDS004", `${text}: no element ${rest[1] ?? ""} in the entity`);
      }
      return { kind: "element", name: element.name, type: { ...element.type } };
    }
    if (head === "$SESSION") {
      const variable = (rest[1] ?? "").toLowerCase();
      if (variable === "system_date" && rest.length === 2) {
        return { kind: "session", variable: "system_date", type: { kind: "dats", length: 8 } };
      }
      throw new ExpressionIssue("CDS002", `session variable ${text} is not supported (the SQL views have no session of the request; only $session.system_date)`);
    }
    if (head.startsWith("$")) {
      throw new ExpressionIssue("CDS002", `${text} is not supported in expressions`);
    }
    if (this.scope.associations.has(head) || rest.length > 1) {
      throw new ExpressionIssue("CDS002", `path expressions (${text}) are not supported yet`);
    }
    const column = this.scope.column(rest[0] ?? "");
    if (column === undefined) {
      throw new ExpressionIssue("CDS004", `${this.scope.sourceName} has no element ${rest[0] ?? ""}`);
    }
    return { kind: "column", name: column.name, type: { ...column.type } };
  }

  private numeric(e: CdsExpression, operator: string): void {
    if (!isNullLiteral(e) && !isNumeric(e.type)) {
      throw new ExpressionIssue("CDS022", `operator ${operator} needs numeric operands (${e.type.kind}); use CAST or a function`);
    }
  }

  private arithmetic(operator: "+" | "-" | "*" | "/", left: CdsExpression, right: CdsExpression): CdsExpression {
    this.numeric(left, operator);
    this.numeric(right, operator);
    const a = isNullLiteral(left) ? right.type : left.type;
    const b = isNullLiteral(right) ? left.type : right.type;
    return { kind: "arithmetic", operator, left, right, type: arithmeticType(operator, a, b) };
  }

  private case(ast: Extract<CdsExprAst, { kind: "case" }>): CdsExpression {
    const operand = ast.operand === undefined ? undefined : this.expression(ast.operand);
    const branches = ast.branches.map((b) => ({
      when: isCondition(b.when) ? this.condition(b.when) : this.expression(b.when),
      then: this.expression(b.then),
    }));
    const otherwise = ast.else === undefined ? undefined : this.expression(ast.else);
    const results = [...branches.map((b) => b.then), ...(otherwise === undefined ? [] : [otherwise])].filter((e) => !isNullLiteral(e));
    const first = results[0];
    if (first === undefined) {
      throw new ExpressionIssue("CDS022", "the type of a CASE whose results are all NULL cannot be inferred: use CAST");
    }
    let type: AbapType = { ...first.type };
    if (results.every((r) => isCharacterLike(r.type))) {
      type = results.some((r) => r.type.kind === "string" || r.type.length === undefined)
        ? { kind: "string" }
        : { kind: "char", length: Math.max(...results.map((r) => r.type.length ?? 1)) };
    } else if (results.every((r) => isNumeric(r.type))) {
      type = results.slice(1).reduce((t, r) => numericUnion(t, r.type), plain(first.type));
    }
    const result: CdsExpression = { kind: "case", branches, type };
    if (operand !== undefined) {
      result.operand = operand;
    }
    if (otherwise !== undefined) {
      result.else = otherwise;
    }
    return result;
  }

  private condition(ast: CdsCondAst): CdsCondition {
    switch (ast.kind) {
      case "compare":
        return { kind: "compare", operator: ast.operator, left: this.expression(ast.left), right: this.expression(ast.right) };
      case "isNull":
        return { kind: "isNull", operand: this.expression(ast.operand), negated: ast.negated };
      case "and":
      case "or":
        return { kind: ast.kind, left: this.condition(ast.left), right: this.condition(ast.right) };
      case "not":
        return { kind: "not", operand: this.condition(ast.operand) };
    }
  }

  private castType(text: string): AbapType {
    const type = /^abap\./i.test(text) ? parseBuiltInType(text) : this.scope.dictionary.dataElement(text)?.type;
    if (type === undefined) {
      throw new ExpressionIssue("CDS022", `unknown type ${text} in CAST (a built-in type abap.xxx or a data element of the sources)`);
    }
    return { ...type };
  }

  private function(name: string, args: CdsExpression[]): CdsExpression {
    if (!Object.hasOwn(FUNCTIONS, name)) {
      throw new ExpressionIssue("CDS002", `the SQL function ${name.toUpperCase()} is not supported yet`);
    }
    const fn = name as CdsFunctionName;
    const arity = FUNCTIONS[fn];
    if (args.length !== arity) {
      throw new ExpressionIssue("CDS022", `${fn.toUpperCase()} takes ${arity} argument(s), not ${args.length}`);
    }
    const [a, b, c] = args as [CdsExpression, CdsExpression | undefined, CdsExpression | undefined];
    const intLiteral = (e: CdsExpression | undefined): number | undefined =>
      e?.kind === "literal" && typeof e.value === "number" && Number.isInteger(e.value) ? e.value : undefined;
    const charLength = (e: CdsExpression): number | undefined =>
      e.type.kind === "string" || e.type.length === undefined ? undefined : isCharacterLike(e.type) ? e.type.length : undefined;
    const charOf = (length: number | undefined): AbapType => (length === undefined ? { kind: "string" } : { kind: "char", length: Math.max(1, length) });
    let type: AbapType;
    switch (fn) {
      case "concat":
      case "concat_with_space": {
        const la = charLength(a);
        const lb = b === undefined ? undefined : charLength(b);
        const spaces = fn === "concat" ? 0 : intLiteral(c);
        if (fn === "concat_with_space" && (spaces === undefined || spaces < 1)) {
          throw new ExpressionIssue("CDS022", "CONCAT_WITH_SPACE needs a positive integer literal as number of spaces");
        }
        type = charOf(la === undefined || lb === undefined ? undefined : la + lb + (spaces ?? 0));
        break;
      }
      case "substring":
        type = charOf(intLiteral(c) ?? charLength(a));
        break;
      case "left":
      case "right":
        type = charOf(intLiteral(b) ?? charLength(a));
        break;
      case "upper":
      case "lower":
      case "ltrim":
      case "rtrim":
        type = charOf(charLength(a));
        break;
      case "replace":
        type = { kind: "string" };
        break;
      case "length":
      case "dats_days_between":
        type = { kind: "int4" };
        break;
      case "coalesce": {
        const typed = args.find((e) => !isNullLiteral(e));
        if (typed === undefined) {
          throw new ExpressionIssue("CDS022", "the type of COALESCE( NULL, NULL ) cannot be inferred: use CAST");
        }
        type = plain(typed.type);
        break;
      }
      case "div":
        this.numeric(a, "DIV");
        type = isInteger(a.type) ? plain(a.type) : { kind: "dec", length: a.type.length ?? MAX_DIGITS, decimals: 0 };
        break;
      case "division": {
        const decimals = intLiteral(c);
        if (decimals === undefined || decimals < 0) {
          throw new ExpressionIssue("CDS022", "DIVISION needs an integer literal as number of decimals");
        }
        type = { kind: "dec", length: MAX_DIGITS, decimals };
        break;
      }
      case "mod":
      case "abs":
      case "round":
      case "ceil":
      case "floor":
        this.numeric(a, fn.toUpperCase());
        type = plain(a.type);
        break;
      case "dats_add_days":
        type = { kind: "dats", length: 8 };
        break;
    }
    return { kind: "function", name: fn, args, type };
  }
}

/** The type of `a op b` on numeric types (ABAP CDS rules, simplified). */
function arithmeticType(operator: "+" | "-" | "*" | "/", a: AbapType, b: AbapType): AbapType {
  if (a.kind === "fltp" || b.kind === "fltp") {
    return { kind: "fltp" };
  }
  if (operator === "/") {
    return { kind: "decfloat34" };
  }
  if (a.kind.startsWith("decfloat") || b.kind.startsWith("decfloat")) {
    return { kind: a.kind === "decfloat34" || b.kind === "decfloat34" ? "decfloat34" : "decfloat16" };
  }
  if (isInteger(a) && isInteger(b)) {
    return largerInteger(a, b);
  }
  const x = digits(a);
  const y = digits(b);
  if (operator === "*") {
    const scale = Math.min(MAX_DIGITS, x.scale + y.scale);
    return { kind: "dec", length: Math.min(MAX_DIGITS, x.integer + y.integer + scale), decimals: scale };
  }
  const scale = Math.max(x.scale, y.scale);
  return { kind: "dec", length: Math.min(MAX_DIGITS, Math.max(x.integer, y.integer) + 1 + scale), decimals: scale };
}

/** A numeric type holding the values of both (the results of a CASE). */
function numericUnion(a: AbapType, b: AbapType): AbapType {
  if (a.kind === "fltp" || b.kind === "fltp" || a.kind.startsWith("decfloat") || b.kind.startsWith("decfloat")) {
    return arithmeticType("+", a, b);
  }
  if (isInteger(a) && isInteger(b)) {
    return largerInteger(a, b);
  }
  const x = digits(a);
  const y = digits(b);
  const scale = Math.max(x.scale, y.scale);
  return { kind: "dec", length: Math.min(MAX_DIGITS, Math.max(x.integer, y.integer) + scale), decimals: scale };
}

function largerInteger(a: AbapType, b: AbapType): AbapType {
  const kind = (INT_RANK[a.kind] ?? 0) >= (INT_RANK[b.kind] ?? 0) ? a.kind : b.kind;
  return { kind: (INT_RANK[kind] ?? 0) < 3 ? "int4" : kind };
}

function digits(t: AbapType): { integer: number; scale: number } {
  return isPacked(t) ? { integer: (t.length ?? 16) - (t.decimals ?? 0), scale: t.decimals ?? 0 } : { integer: INT_DIGITS[t.kind] ?? 10, scale: 0 };
}
