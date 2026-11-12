/**
 * Expressions of the select list of a view entity (D64): the flat node lists of abaplint
 * (CDSArithmetics, CDSCondition) parsed into an untyped tree. The IR resolves its paths and types.
 */

import * as abaplint from "@abaplint/core";

type Node = abaplint.INode;
const E = abaplint.ExpressionsCDS;

export type CdsExprAst =
  | { kind: "path"; path: string[] }
  /** `typed`: the type of a typed literal, `abap.char'X'` → `abap.char`. */
  | { kind: "literal"; value: string | number | null; typed?: string; text: string }
  | { kind: "arithmetic"; operator: "+" | "-" | "*" | "/"; left: CdsExprAst; right: CdsExprAst }
  | { kind: "negate"; operand: CdsExprAst }
  | { kind: "case"; operand?: CdsExprAst; branches: Array<{ when: CdsExprAst | CdsCondAst; then: CdsExprAst }>; else?: CdsExprAst }
  /** `type`: the text of the target type, blanks removed (`abap.dec(10,2)`, a data element…). */
  | { kind: "cast"; operand: CdsExprAst; type: string }
  | { kind: "function"; name: string; args: CdsExprAst[] };

export type CdsCondAst =
  | { kind: "compare"; operator: "=" | "<>" | "<" | ">" | "<=" | ">=" | "like"; left: CdsExprAst; right: CdsExprAst }
  | { kind: "isNull"; operand: CdsExprAst; negated: boolean }
  | { kind: "and" | "or"; left: CdsCondAst; right: CdsCondAst }
  | { kind: "not"; operand: CdsCondAst };

export const isCondition = (x: CdsExprAst | CdsCondAst): x is CdsCondAst =>
  x.kind === "compare" || x.kind === "isNull" || x.kind === "and" || x.kind === "or" || x.kind === "not";

/** An unsupported construct: its message names it. */
export class CdsExpressionError extends Error {}

const isExpression = (n: Node): n is abaplint.Nodes.ExpressionNode => n instanceof abaplint.Nodes.ExpressionNode;
const isToken = (n: Node): n is abaplint.Nodes.TokenNode => n instanceof abaplint.Nodes.TokenNode;
const text = (n: Node): string => n.getFirstToken().getStr();
const compact = (n: abaplint.Nodes.ExpressionNode): string =>
  n
    .concatTokens()
    .replace(/\s+/g, " ")
    .trim();

/** An item of a flat list: an operator/keyword token or an operand node. */
type Item = { token: string } | { node: abaplint.Nodes.ExpressionNode };

/** Parses the value of an element of the select list. Throws a CdsExpressionError. */
export function parseCdsExpression(node: abaplint.Nodes.ExpressionNode): CdsExprAst {
  return operand(node);
}

function operand(node: abaplint.Nodes.ExpressionNode): CdsExprAst {
  const statement = node.get();
  if (statement instanceof E.CDSPrefixedName) {
    const path = node.findAllExpressions(E.CDSName).map((n) => n.concatTokens());
    const single = path.length === 1 ? (path[0] ?? "") : "";
    // integers inside function inputs are parsed as names
    if (/^\d+$/.test(single)) {
      return { kind: "literal", value: Number(single), text: single };
    }
    if (/^null$/i.test(single)) {
      return { kind: "literal", value: null, text: "null" };
    }
    if (node.findFirstExpression(E.CDSParameters) !== undefined || compact(node).includes("[")) {
      throw new CdsExpressionError(`path with parameters or filter (${compact(node)})`);
    }
    return { kind: "path", path };
  }
  if (statement instanceof E.CDSInteger) {
    const raw = node
      .getAllTokens()
      .map((t) => t.getStr())
      .join("");
    return { kind: "literal", value: Number(raw), text: raw };
  }
  if (statement instanceof E.CDSString) {
    return stringLiteral(node);
  }
  if (statement instanceof E.CDSArithmetics || statement instanceof E.CDSArithParen || statement instanceof E.CDSFunctionInput) {
    return new ItemParser(flatten(node), compact(node)).arithmeticOnly();
  }
  if (statement instanceof E.CDSCase) {
    return caseExpression(node);
  }
  if (statement instanceof E.CDSCast) {
    return cast(node);
  }
  if (statement instanceof E.CDSFunction) {
    return functionCall(node);
  }
  if (statement instanceof E.CDSAggregate) {
    throw new CdsExpressionError(`aggregate functions (${compact(node)})`);
  }
  throw new CdsExpressionError(`${statement.constructor.name.replace(/^CDS/, "")} (${compact(node)})`);
}

function stringLiteral(node: abaplint.Nodes.ExpressionNode): CdsExprAst {
  const tokens = node.getAllTokens().map((t) => t.getStr());
  const quoted = tokens[tokens.length - 1] ?? "''";
  const value = quoted.startsWith("'") ? quoted.slice(1, -1).replace(/''/g, "'") : quoted;
  const prefix = tokens.slice(0, -1).join("");
  const raw = tokens.join("");
  return prefix === "" ? { kind: "literal", value, text: raw } : { kind: "literal", value, typed: prefix.toLowerCase(), text: raw };
}

/** Arithmetics and conditions are flat in abaplint: their nested arithmetics/conditions too. */
function flatten(node: abaplint.Nodes.ExpressionNode): Item[] {
  const items: Item[] = [];
  for (const child of node.getChildren()) {
    if (isToken(child)) {
      items.push({ token: text(child).toLowerCase() });
    } else if (isExpression(child)) {
      const statement = child.get();
      if (statement instanceof E.CDSArithmetics || statement instanceof E.CDSArithParen || statement instanceof E.CDSCondition) {
        items.push(...flatten(child));
      } else {
        items.push({ node: child });
      }
    }
  }
  return items;
}

function caseExpression(node: abaplint.Nodes.ExpressionNode): CdsExprAst {
  const children = node.getChildren();
  const result: Extract<CdsExprAst, { kind: "case" }> = { kind: "case", branches: [] };
  let pendingWhen: CdsExprAst | CdsCondAst | undefined;
  let state: "start" | "when" | "then" | "else" = "start";
  for (const child of children) {
    if (isToken(child)) {
      const keyword = text(child).toLowerCase();
      if (keyword === "when" || keyword === "then" || keyword === "else") {
        state = keyword;
      }
      continue;
    }
    if (!isExpression(child)) {
      continue;
    }
    if (state === "start") {
      result.operand = operand(child);
    } else if (state === "when") {
      pendingWhen = child.get() instanceof E.CDSCondition ? new ItemParser(flatten(child), compact(child)).conditionOnly() : operand(child);
    } else if (state === "then") {
      if (pendingWhen === undefined) {
        throw new CdsExpressionError(`CASE without WHEN (${compact(node)})`);
      }
      result.branches.push({ when: pendingWhen, then: operand(child) });
      pendingWhen = undefined;
    } else {
      result.else = operand(child);
    }
  }
  if (result.branches.length === 0) {
    throw new CdsExpressionError(`CASE without WHEN (${compact(node)})`);
  }
  if (result.operand === undefined && result.branches.some((b) => !isCondition(b.when))) {
    throw new CdsExpressionError(`CASE WHEN without condition (${compact(node)})`);
  }
  return result;
}

function cast(node: abaplint.Nodes.ExpressionNode): CdsExprAst {
  const typeNode = node.findDirectExpression(E.CDSType);
  const value = node.getChildren().find((c): c is abaplint.Nodes.ExpressionNode => isExpression(c) && !(c.get() instanceof E.CDSType));
  if (typeNode === undefined || value === undefined) {
    throw new CdsExpressionError(`CAST (${compact(node)})`);
  }
  return { kind: "cast", operand: operand(value), type: typeNode.concatTokens().replace(/\s+/g, "") };
}

function functionCall(node: abaplint.Nodes.ExpressionNode): CdsExprAst {
  const name = text(node).toLowerCase();
  const args = node.findDirectExpressions(E.CDSFunctionInput).map((input) => {
    const items = flatten(input);
    return new ItemParser(items, compact(input)).arithmeticOnly();
  });
  return { kind: "function", name, args };
}

/** Precedence parser over a flat list of items. */
class ItemParser {
  private index = 0;

  public constructor(
    private readonly items: Item[],
    private readonly source: string,
  ) {}

  public arithmeticOnly(): CdsExprAst {
    const result = this.arithmetic();
    this.end();
    return result;
  }

  public conditionOnly(): CdsCondAst {
    const result = this.or();
    this.end();
    return result;
  }

  private end(): void {
    if (this.index < this.items.length) {
      throw this.error();
    }
  }

  private error(): CdsExpressionError {
    return new CdsExpressionError(`expression (${this.source})`);
  }

  private peek(offset = 0): string | undefined {
    const item = this.items[this.index + offset];
    return item !== undefined && "token" in item ? item.token : undefined;
  }

  private accept(token: string): boolean {
    if (this.peek() === token) {
      this.index++;
      return true;
    }
    return false;
  }

  private expect(token: string): void {
    if (!this.accept(token)) {
      throw this.error();
    }
  }

  private arithmetic(): CdsExprAst {
    let left = this.term();
    for (;;) {
      const operator = this.peek();
      if (operator !== "+" && operator !== "-") {
        return left;
      }
      this.index++;
      left = { kind: "arithmetic", operator, left, right: this.term() };
    }
  }

  private term(): CdsExprAst {
    let left = this.unary();
    for (;;) {
      const operator = this.peek();
      if (operator !== "*" && operator !== "/") {
        return left;
      }
      this.index++;
      left = { kind: "arithmetic", operator, left, right: this.unary() };
    }
  }

  private unary(): CdsExprAst {
    if (this.accept("-")) {
      const operand = this.unary();
      return operand.kind === "literal" && typeof operand.value === "number"
        ? { ...operand, value: -operand.value, text: `-${operand.text}` }
        : { kind: "negate", operand };
    }
    if (this.accept("+")) {
      return this.unary();
    }
    if (this.accept("(")) {
      const inner = this.arithmetic();
      this.expect(")");
      return inner;
    }
    const item = this.items[this.index];
    if (item === undefined || !("node" in item)) {
      throw this.error();
    }
    this.index++;
    return operand(item.node);
  }

  private or(): CdsCondAst {
    let left = this.and();
    while (this.accept("or")) {
      left = { kind: "or", left, right: this.and() };
    }
    return left;
  }

  private and(): CdsCondAst {
    let left = this.not();
    while (this.accept("and")) {
      left = { kind: "and", left, right: this.not() };
    }
    return left;
  }

  private not(): CdsCondAst {
    if (this.accept("not")) {
      return { kind: "not", operand: this.not() };
    }
    if (this.peek() === "(" && this.groupsCondition()) {
      this.index++;
      const inner = this.or();
      this.expect(")");
      return inner;
    }
    return this.predicate();
  }

  /** `(` opens a condition when its content holds a comparison or a logical operator. */
  private groupsCondition(): boolean {
    let depth = 0;
    for (let i = this.index; i < this.items.length; i++) {
      const item = this.items[i];
      const token = item !== undefined && "token" in item ? item.token : undefined;
      if (token === "(") {
        depth++;
      } else if (token === ")") {
        depth--;
        if (depth === 0) {
          return false;
        }
      } else if (token !== undefined && ["=", "<", ">", "<>", "<=", ">=", "!=", "is", "like", "and", "or", "not", "between"].includes(token)) {
        return true;
      }
    }
    return false;
  }

  private predicate(): CdsCondAst {
    const left = this.arithmetic();
    if (this.accept("is")) {
      const negated = this.accept("not");
      this.expect("null");
      return { kind: "isNull", operand: left, negated };
    }
    if (this.peek() === "not" && this.peek(1) === "like") {
      this.index += 2;
      return { kind: "not", operand: { kind: "compare", operator: "like", left, right: this.arithmetic() } };
    }
    if (this.accept("like")) {
      return { kind: "compare", operator: "like", left, right: this.arithmetic() };
    }
    if (this.peek() === "between") {
      throw new CdsExpressionError(`BETWEEN (${this.source})`);
    }
    let operator: "=" | "<>" | "<" | ">" | "<=" | ">=";
    if (this.accept("=")) {
      operator = "=";
    } else if (this.accept("<>") || this.accept("!=")) {
      operator = "<>";
    } else if (this.accept("<=")) {
      operator = "<=";
    } else if (this.accept(">=")) {
      operator = ">=";
    } else if (this.accept("<")) {
      operator = this.accept(">") ? "<>" : this.accept("=") ? "<=" : "<";
    } else if (this.accept(">")) {
      operator = this.accept("=") ? ">=" : ">";
    } else if (this.accept("!")) {
      this.expect("=");
      operator = "<>";
    } else {
      throw this.error();
    }
    return { kind: "compare", operator, left, right: this.arithmetic() };
  }
}
