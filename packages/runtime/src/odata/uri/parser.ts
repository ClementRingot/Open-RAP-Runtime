/**
 * Chevrotain grammar of OData URL expressions: $filter, $orderby, $select, $expand (with nested
 * options), key predicates and function parameters. Resource paths are split by hand.
 */

import { createToken, EmbeddedActionsParser, Lexer, type IToken, type TokenType } from "chevrotain";
import type { UrlLiteral } from "../../values.js";
import { badRequest, ODataError } from "../errors.js";
import type { ExpandItem, Expr, KeyPredicate, OrderItem, QueryOptions, Segment } from "./ast.js";

const WhiteSpace = createToken({ name: "WhiteSpace", pattern: /\s+/, group: Lexer.SKIPPED });
const StringLiteral = createToken({ name: "StringLiteral", pattern: /'(?:[^']|'')*'/ });
const DateTimeOffset = createToken({ name: "DateTimeOffset", pattern: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/i });
const GuidLiteral = createToken({ name: "GuidLiteral", pattern: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/ });
const DateLiteral = createToken({ name: "DateLiteral", pattern: /\d{4}-\d{2}-\d{2}/ });
const TimeLiteral = createToken({ name: "TimeLiteral", pattern: /\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?/ });
const DecimalLiteral = createToken({ name: "DecimalLiteral", pattern: /-?\d+\.\d+(?:[eE][+-]?\d+)?|-?\d+[eE][+-]?\d+/ });
const IntegerLiteral = createToken({ name: "IntegerLiteral", pattern: /-?\d+/ });
const Identifier = createToken({ name: "Identifier", pattern: /[A-Za-z_][A-Za-z0-9_]*/ });
const DollarName = createToken({ name: "DollarName", pattern: /\$[A-Za-z]+/ });
const LParen = createToken({ name: "LParen", pattern: /\(/ });
const RParen = createToken({ name: "RParen", pattern: /\)/ });
const Comma = createToken({ name: "Comma", pattern: /,/ });
const Slash = createToken({ name: "Slash", pattern: /\// });
const Semicolon = createToken({ name: "Semicolon", pattern: /;/ });
const Equals = createToken({ name: "Equals", pattern: /=/ });
const Star = createToken({ name: "Star", pattern: /\*/ });
const Dot = createToken({ name: "Dot", pattern: /\./ });
const Colon = createToken({ name: "Colon", pattern: /:/ });

const keywords = new Map<string, TokenType>();
function keyword(word: string): TokenType {
  const token = createToken({ name: `K_${word}`, pattern: new RegExp(`${word}(?![A-Za-z0-9_])`), longer_alt: Identifier, categories: [Identifier] });
  keywords.set(word, token);
  return token;
}
const K = {
  eq: keyword("eq"),
  ne: keyword("ne"),
  gt: keyword("gt"),
  ge: keyword("ge"),
  lt: keyword("lt"),
  le: keyword("le"),
  and: keyword("and"),
  or: keyword("or"),
  not: keyword("not"),
  in: keyword("in"),
  true: keyword("true"),
  false: keyword("false"),
  null: keyword("null"),
  asc: keyword("asc"),
  desc: keyword("desc"),
};

const tokens: TokenType[] = [
  WhiteSpace,
  StringLiteral,
  DateTimeOffset,
  GuidLiteral,
  DateLiteral,
  TimeLiteral,
  DecimalLiteral,
  IntegerLiteral,
  ...[...keywords.values()].sort((a, b) => String(b.name).length - String(a.name).length),
  Identifier,
  DollarName,
  LParen,
  RParen,
  Comma,
  Slash,
  Semicolon,
  Equals,
  Star,
  Dot,
  Colon,
];

const lexer = new Lexer(tokens, { ensureOptimizations: false, positionTracking: "onlyOffset" });

const img = (t: IToken | undefined): string => (typeof t?.image === "string" ? t.image : "");

const COMPARISON: Record<string, "eq" | "ne" | "gt" | "ge" | "lt" | "le"> = { eq: "eq", ne: "ne", gt: "gt", ge: "ge", lt: "lt", le: "le" };

class ExpressionParser extends EmbeddedActionsParser {
  public constructor() {
    super(tokens, { recoveryEnabled: false, maxLookahead: 3 });
    this.performSelfAnalysis();
  }

  public filter = this.RULE("filter", (): Expr => this.SUBRULE(this.orExpr));

  private orExpr = this.RULE("orExpr", (): Expr => {
    let left = this.SUBRULE(this.andExpr);
    this.MANY(() => {
      this.CONSUME(K.or);
      const right = this.SUBRULE1(this.andExpr);
      left = this.ACTION(() => ({ kind: "binary", op: "or", left, right }) as Expr);
    });
    return left;
  });

  private andExpr = this.RULE("andExpr", (): Expr => {
    let left = this.SUBRULE(this.notExpr);
    this.MANY(() => {
      this.CONSUME(K.and);
      const right = this.SUBRULE1(this.notExpr);
      left = this.ACTION(() => ({ kind: "binary", op: "and", left, right }) as Expr);
    });
    return left;
  });

  // keywords are also identifiers: `not (…)` is the operator, not a function call
  private notExpr = this.RULE("notExpr", (): Expr =>
    this.OR({
      IGNORE_AMBIGUITIES: true,
      DEF: [
      {
        ALT: () => {
          this.CONSUME(K.not);
          const operand = this.SUBRULE(this.notExpr);
          return this.ACTION(() => ({ kind: "not", operand }) as Expr);
        },
      },
      { ALT: () => this.SUBRULE(this.comparison) },
    ]}),
  );

  private comparison = this.RULE("comparison", (): Expr => {
    const left = this.SUBRULE(this.operand);
    let result: Expr = left;
    this.OPTION(() => {
      this.OR([
        {
          ALT: () => {
            const op = this.OR1([
              { ALT: () => this.CONSUME(K.eq) },
              { ALT: () => this.CONSUME(K.ne) },
              { ALT: () => this.CONSUME(K.gt) },
              { ALT: () => this.CONSUME(K.ge) },
              { ALT: () => this.CONSUME(K.lt) },
              { ALT: () => this.CONSUME(K.le) },
            ]);
            const right = this.SUBRULE1(this.operand);
            result = this.ACTION(() => ({ kind: "binary", op: COMPARISON[img(op)] ?? "eq", left, right }) as Expr);
          },
        },
        {
          ALT: () => {
            this.CONSUME(K.in);
            this.CONSUME(LParen);
            const list: Expr[] = [];
            this.AT_LEAST_ONE_SEP({
              SEP: Comma,
              DEF: () => {
                const value = this.SUBRULE2(this.operand);
                this.ACTION(() => list.push(value));
              },
            });
            this.CONSUME(RParen);
            result = this.ACTION(() => ({ kind: "in", operand: left, list }) as Expr);
          },
        },
      ]);
    });
    return result;
  });

  // literals first: true, false and null are also identifiers
  private operand = this.RULE("operand", (): Expr =>
    this.OR({
      IGNORE_AMBIGUITIES: true,
      DEF: [
      {
        ALT: () => {
          this.CONSUME(LParen);
          const inner = this.SUBRULE(this.orExpr);
          this.CONSUME(RParen);
          return inner;
        },
      },
      { ALT: () => this.SUBRULE(this.literal) },
      {
        // function call: an identifier directly followed by "("
        GATE: () => this.LA(2).tokenType === LParen,
        ALT: () => {
          const name = this.CONSUME(Identifier);
          this.CONSUME1(LParen);
          const args: Expr[] = [];
          this.MANY_SEP({
            SEP: Comma,
            DEF: () => {
              const arg = this.SUBRULE1(this.orExpr);
              this.ACTION(() => args.push(arg));
            },
          });
          this.CONSUME1(RParen);
          return this.ACTION(() => ({ kind: "call", name: img(name).toLowerCase(), args }) as Expr);
        },
      },
      {
        ALT: () => {
          const path = this.SUBRULE(this.memberPath);
          return this.ACTION(() => ({ kind: "member", path }) as Expr);
        },
      },
    ]}),
  );

  public memberPath = this.RULE("memberPath", (): string[] => {
    const path: string[] = [];
    this.OR([{ ALT: () => path.push(img(this.CONSUME(Identifier))) }, { ALT: () => path.push(img(this.CONSUME(DollarName))) }]);
    this.MANY(() => {
      this.CONSUME(Slash);
      this.OR1([{ ALT: () => path.push(img(this.CONSUME1(Identifier))) }, { ALT: () => path.push(img(this.CONSUME1(DollarName))) }]);
    });
    return path;
  });

  public literal = this.RULE("literal", (): Expr => {
    const literal = this.OR([
      { ALT: (): UrlLiteral => ({ type: "string", value: img(this.CONSUME(StringLiteral)).slice(1, -1).replace(/''/g, "'") }) },
      { ALT: (): UrlLiteral => ({ type: "datetime", value: img(this.CONSUME(DateTimeOffset)) }) },
      { ALT: (): UrlLiteral => ({ type: "guid", value: img(this.CONSUME(GuidLiteral)).toLowerCase() }) },
      { ALT: (): UrlLiteral => ({ type: "date", value: img(this.CONSUME(DateLiteral)) }) },
      { ALT: (): UrlLiteral => ({ type: "time", value: img(this.CONSUME(TimeLiteral)) }) },
      { ALT: (): UrlLiteral => ({ type: "decimal", value: img(this.CONSUME(DecimalLiteral)) }) },
      { ALT: (): UrlLiteral => ({ type: "int", value: img(this.CONSUME(IntegerLiteral)) }) },
      { ALT: (): UrlLiteral => (this.CONSUME(K.true), { type: "bool", value: true }) },
      { ALT: (): UrlLiteral => (this.CONSUME(K.false), { type: "bool", value: false }) },
      { ALT: (): UrlLiteral => (this.CONSUME(K.null), { type: "null", value: null }) },
    ]);
    return { kind: "literal", literal };
  });

  public orderby = this.RULE("orderby", (): OrderItem[] => {
    const items: OrderItem[] = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const path = this.SUBRULE(this.memberPath);
        let descending = false;
        this.OPTION(() => {
          this.OR([{ ALT: () => this.CONSUME(K.asc) }, { ALT: () => { this.CONSUME(K.desc); descending = true; } }]);
        });
        this.ACTION(() => items.push({ path, descending }));
      },
    });
    return items;
  });

  public select = this.RULE("select", (): string[][] => {
    const items: string[][] = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        this.OR([
          { ALT: () => { this.CONSUME(Star); items.push(["*"]); } },
          {
            ALT: () => {
              const path = this.SUBRULE(this.qualifiedPath);
              this.ACTION(() => items.push(path));
            },
          },
        ]);
      },
    });
    return items;
  });

  /** A member path whose segments may be namespace-qualified (actions in $select). */
  private qualifiedPath = this.RULE("qualifiedPath", (): string[] => {
    const path: string[] = [];
    const segment = (): void => {
      let text = img(this.CONSUME(Identifier));
      this.MANY(() => {
        this.CONSUME(Dot);
        this.OR([{ ALT: () => (text += `.${img(this.CONSUME1(Identifier))}`) }, { ALT: () => { this.CONSUME(Star); text += ".*"; } }]);
      });
      path.push(text);
    };
    segment();
    this.MANY1(() => {
      this.CONSUME(Slash);
      let text = img(this.CONSUME2(Identifier));
      this.MANY2(() => {
        this.CONSUME1(Dot);
        text += `.${img(this.CONSUME3(Identifier))}`;
      });
      path.push(text);
    });
    return path;
  });

  public expand = this.RULE("expand", (): ExpandItem[] => {
    const items: ExpandItem[] = [];
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => {
        const path = this.OR([{ ALT: () => this.SUBRULE(this.memberPath) }, { ALT: () => { this.CONSUME(Star); return ["*"]; } }]);
        const options: QueryOptions = {};
        this.OPTION(() => {
          this.CONSUME(LParen);
          this.MANY_SEP({
            SEP: Semicolon,
            DEF: () => this.SUBRULE(this.expandOption, { ARGS: [options] }),
          });
          this.CONSUME(RParen);
        });
        this.ACTION(() => items.push({ path, options }));
      },
    });
    return items;
  });

  private expandOption = this.RULE("expandOption", (options: QueryOptions): void => {
    const name = this.CONSUME(DollarName);
    this.CONSUME(Equals);
    const option = img(name).toLowerCase();
    this.OR([
      {
        GATE: () => option === "$filter",
        ALT: () => {
          const filter = this.SUBRULE(this.orExpr);
          this.ACTION(() => (options.filter = filter));
        },
      },
      {
        GATE: () => option === "$orderby",
        ALT: () => {
          const orderby = this.SUBRULE(this.orderby);
          this.ACTION(() => (options.orderby = orderby));
        },
      },
      {
        GATE: () => option === "$select",
        ALT: () => {
          const select = this.SUBRULE(this.select);
          this.ACTION(() => (options.select = select));
        },
      },
      {
        GATE: () => option === "$expand",
        ALT: () => {
          const expand = this.SUBRULE(this.expand);
          this.ACTION(() => (options.expand = expand));
        },
      },
      {
        GATE: () => option === "$top" || option === "$skip",
        ALT: () => {
          const value = Number.parseInt(img(this.CONSUME(IntegerLiteral)), 10);
          this.ACTION(() => {
            if (option === "$top") options.top = value;
            else options.skip = value;
          });
        },
      },
      {
        GATE: () => option === "$count",
        ALT: () => {
          const value = this.OR1([{ ALT: () => (this.CONSUME(K.true), true) }, { ALT: () => (this.CONSUME(K.false), false) }]);
          this.ACTION(() => (options.count = value));
        },
      },
      {
        GATE: () => option === "$search",
        ALT: () => {
          const value = this.OR2([{ ALT: () => img(this.CONSUME1(Identifier)) }, { ALT: () => img(this.CONSUME(StringLiteral)).slice(1, -1) }]);
          this.ACTION(() => (options.search = value));
        },
      },
    ]);
  });

  /** `(value)` or `(Name=value,…)`. */
  public keyPredicate = this.RULE("keyPredicate", (): KeyPredicate => {
    this.CONSUME(LParen);
    const result = this.OR([
      {
        GATE: () => this.LA(2).tokenType === Equals,
        ALT: (): KeyPredicate => {
          const values: Array<{ name: string; value: Expr }> = [];
          this.AT_LEAST_ONE_SEP({
            SEP: Comma,
            DEF: () => {
              const name = img(this.CONSUME(Identifier));
              this.CONSUME(Equals);
              const value = this.SUBRULE(this.literal);
              this.ACTION(() => values.push({ name, value }));
            },
          });
          return { kind: "named", values };
        },
      },
      {
        ALT: (): KeyPredicate => {
          const value = this.SUBRULE1(this.literal);
          return { kind: "single", value };
        },
      },
    ]);
    this.CONSUME(RParen);
    return result;
  });

  /** Function parameters: `(Name=value,…)`, possibly empty. */
  public parameters = this.RULE("parameters", (): Array<{ name: string; value: Expr }> => {
    const values: Array<{ name: string; value: Expr }> = [];
    this.CONSUME(LParen);
    this.MANY_SEP({
      SEP: Comma,
      DEF: () => {
        const name = img(this.CONSUME(Identifier));
        this.CONSUME(Equals);
        const value = this.SUBRULE(this.literal);
        this.ACTION(() => values.push({ name, value }));
      },
    });
    this.CONSUME(RParen);
    return values;
  });
}

let parser: ExpressionParser | undefined;

function run<T>(text: string, what: string, rule: (p: ExpressionParser) => T): T {
  const lexed = lexer.tokenize(text);
  if (lexed.errors.length > 0) {
    const e = lexed.errors[0];
    throw badRequest(`Invalid ${what}: unexpected character at position ${(e?.offset ?? 0) + 1} in "${text}"`);
  }
  parser ??= new ExpressionParser();
  parser.input = lexed.tokens;
  const result = rule(parser);
  if (parser.errors.length > 0) {
    const e = parser.errors[0];
    const at = e?.token.tokenType.name === "EOF" ? "end" : `"${e?.token.image ?? ""}" (position ${(e?.token.startOffset ?? 0) + 1})`;
    throw badRequest(`Invalid ${what} "${text}": syntax error at ${at}`);
  }
  return result;
}

export const parseFilter = (text: string): Expr => run(text, "$filter", (p) => p.filter());
export const parseOrderby = (text: string): OrderItem[] => run(text, "$orderby", (p) => p.orderby());
export const parseSelect = (text: string): string[][] => run(text, "$select", (p) => p.select());
export const parseExpand = (text: string): ExpandItem[] => run(text, "$expand", (p) => p.expand());
export const parseKeyPredicate = (text: string): KeyPredicate => run(text, "key predicate", (p) => p.keyPredicate());
export const parseParameters = (text: string): Array<{ name: string; value: Expr }> => run(text, "function parameters", (p) => p.parameters());

// ---------------------------------------------------------------------------------------------
// query string and resource path

/** Splits a query string without turning `+` into a space (OData URLs percent-encode it). */
export function parseQueryString(query: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of query.split("&")) {
    if (part === "") {
      continue;
    }
    const index = part.indexOf("=");
    const rawName = index < 0 ? part : part.slice(0, index);
    const rawValue = index < 0 ? "" : part.slice(index + 1);
    let name: string;
    let value: string;
    try {
      name = decodeURIComponent(rawName);
      value = decodeURIComponent(rawValue);
    } catch {
      throw badRequest(`Invalid percent-encoding in the query option ${rawName}`);
    }
    if (result.has(name)) {
      throw badRequest(`Query option ${name} is given twice`);
    }
    result.set(name, value);
  }
  return result;
}

const SYSTEM_OPTIONS = new Set(["$filter", "$orderby", "$select", "$expand", "$top", "$skip", "$count", "$search", "$format", "$skiptoken", "$apply", "$levels", "$schemaversion", "$deltatoken", "$id"]);

/** System query options of the request; custom options (sap-client, …) are ignored. */
export function parseQueryOptions(query: Map<string, string>): QueryOptions {
  const options: QueryOptions = {};
  for (const [name, value] of query) {
    const lower = name.toLowerCase();
    if (!lower.startsWith("$")) {
      continue;
    }
    if (!SYSTEM_OPTIONS.has(lower)) {
      throw badRequest(`Unknown system query option ${name}`);
    }
    switch (lower) {
      case "$filter":
        options.filter = parseFilter(value);
        break;
      case "$orderby":
        options.orderby = parseOrderby(value);
        break;
      case "$select":
        options.select = parseSelect(value);
        break;
      case "$expand":
        options.expand = parseExpand(value);
        break;
      case "$top":
      case "$skip": {
        if (!/^\d+$/.test(value)) {
          throw badRequest(`${name} must be a non-negative integer`);
        }
        const n = Number.parseInt(value, 10);
        if (lower === "$top") options.top = n;
        else options.skip = n;
        break;
      }
      case "$count":
        if (value !== "true" && value !== "false") {
          throw badRequest("$count must be true or false");
        }
        options.count = value === "true";
        break;
      case "$search":
        options.search = value;
        break;
      case "$format":
        if (!/^json$|^application\/json/i.test(value)) {
          throw new ODataError(406, "NOT_ACCEPTABLE", `$format=${value} is not supported (JSON only)`);
        }
        break;
      case "$apply":
        throw badRequest("$apply is not supported");
      default:
        throw badRequest(`${name} is not supported`);
    }
  }
  return options;
}

/** Splits the resource path into segments (outside parentheses and string literals). */
export function splitPath(path: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (let i = 0; i < path.length; i++) {
    const c = path[i] as string;
    if (c === "'" && depth > 0) {
      inString = !inString;
    } else if (!inString && c === "(") {
      depth++;
    } else if (!inString && c === ")") {
      depth--;
    }
    if (c === "/" && depth === 0 && !inString) {
      segments.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  if (current !== "") {
    segments.push(current);
  }
  return segments;
}

/**
 * Parses the resource path (already relative to the service root, percent-decoded per segment):
 * `Travel(…)/_Booking`, `Travel/$count`, `Travel(…)/ns.action`, `$1/_Booking`.
 */
export function parseResourcePath(path: string, isEntitySet: (name: string) => boolean, namespace: string): Segment[] {
  const segments: Segment[] = [];
  const raw = splitPath(path.replace(/^\/+/, ""));
  raw.forEach((text, index) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      throw badRequest(`Invalid percent-encoding in the resource path segment ${text}`);
    }
    if (decoded === "$count") {
      segments.push({ kind: "count" });
      return;
    }
    if (decoded === "$value") {
      segments.push({ kind: "value" });
      return;
    }
    if (index === 0 && /^\$\d+$/.test(decoded)) {
      segments.push({ kind: "contentId", id: decoded.slice(1) });
      return;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_.]*)(\(.*\))?$/.exec(decoded);
    if (match === null) {
      throw badRequest(`Invalid resource path segment ${decoded}`);
    }
    const name = match[1] as string;
    const parens = match[2];
    if (name.includes(".")) {
      const dot = name.lastIndexOf(".");
      const operation: Segment = { kind: "operation", namespace: name.slice(0, dot), name: name.slice(dot + 1) };
      if (operation.namespace !== namespace && operation.namespace !== "SAP__self") {
        throw badRequest(`Unknown namespace ${operation.namespace}`);
      }
      if (parens !== undefined) {
        operation.parameters = parseParameters(parens);
      }
      segments.push(operation);
      return;
    }
    const key = parens === undefined ? undefined : parseKeyPredicate(parens);
    if (index === 0) {
      if (!isEntitySet(name)) {
        throw badRequest(`Unknown entity set ${name}`);
      }
      segments.push(key === undefined ? { kind: "entitySet", name } : { kind: "entitySet", name, key });
    } else {
      segments.push(key === undefined ? { kind: "navigation", name } : { kind: "navigation", name, key });
    }
  });
  return segments;
}
