/**
 * Parser of the CDS access controls (DCL, decision D35): `define role R { grant select on E
 * where … ; }` with the conditions RAP business objects use — `aspect pfcg_auth`, `aspect user`,
 * comparisons with literals, `is [not] null`, `and`/`or`/`not`, parentheses and
 * `inheriting conditions from entity B` (a projection reuses the role of its base view).
 */

export type DclCondition =
  | { kind: "and" | "or"; operands: DclCondition[] }
  | { kind: "not"; operand: DclCondition }
  | { kind: "compare"; element: string; operator: "=" | "<>" | "<" | "<=" | ">" | ">=" | "like"; value: string }
  | { kind: "null"; element: string; negated: boolean }
  | { kind: "pfcg"; elements: string[]; object: string; fields: string[]; filters: Record<string, string>; orInitial: boolean }
  | { kind: "user"; element: string; orInitial: boolean }
  | { kind: "inherit"; entity: string }
  /** A construct the application cannot evaluate: no row is granted by it (fail closed). */
  | { kind: "unsupported"; text: string };

export interface DclGrant {
  entity: string;
  /** Undefined: `grant select on E;` — every row. */
  condition?: DclCondition;
  line: number;
}

export interface DclRole {
  name: string;
  grants: DclGrant[];
}

export interface DclResult {
  role?: DclRole;
  errors: Array<{ message: string; line: number }>;
}

interface Token {
  kind: "word" | "string" | "number" | "symbol";
  text: string;
  line: number;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let i = 0;
  while (i < source.length) {
    const c = source[i] as string;
    if (c === "\n") {
      line++;
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "-" && source[i + 1] === "-") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      line += (source.slice(i, stop).match(/\n/g) ?? []).length;
      i = stop;
    } else if (c === "'") {
      let j = i + 1;
      let text = "";
      while (j < source.length && !(source[j] === "'" && source[j + 1] !== "'")) {
        if (source[j] === "'" && source[j + 1] === "'") {
          text += "'";
          j += 2;
        } else {
          text += source[j];
          j++;
        }
      }
      tokens.push({ kind: "string", text, line });
      i = j + 1;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j] as string)) j++;
      tokens.push({ kind: "number", text: source.slice(i, j), line });
      i = j;
    } else if (/[A-Za-z_/$#]/.test(c)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_/$#.]/.test(source[j] as string)) j++;
      tokens.push({ kind: "word", text: source.slice(i, j), line });
      i = j;
    } else if (c === "@") {
      // an annotation: @Name.path : value (literal, enum, boolean, list or structure)
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_.]/.test(source[j] as string)) j++;
      while (j < source.length && /\s/.test(source[j] as string)) j++;
      if (source[j] === ":") {
        j++;
        while (j < source.length && /[ \t]/.test(source[j] as string)) j++;
        const open = source[j];
        if (open === "'") {
          j = source.indexOf("'", j + 1) + 1;
        } else if (open === "[" || open === "{") {
          const close = open === "[" ? "]" : "}";
          let depth = 0;
          for (; j < source.length; j++) {
            if (source[j] === open) depth++;
            if (source[j] === close && --depth === 0) {
              j++;
              break;
            }
          }
        } else {
          while (j < source.length && /[A-Za-z0-9_#.]/.test(source[j] as string)) j++;
        }
      }
      line += (source.slice(i, j).match(/\n/g) ?? []).length;
      i = j;
    } else {
      const two = source.slice(i, i + 2);
      if (["<>", "<=", ">=", "?=", "!="].includes(two)) {
        tokens.push({ kind: "symbol", text: two, line });
        i += 2;
      } else {
        tokens.push({ kind: "symbol", text: c, line });
        i++;
      }
    }
  }
  return tokens;
}

class DclSyntaxError extends Error {
  public constructor(
    message: string,
    public readonly line: number,
  ) {
    super(message);
  }
}

class Parser {
  private i = 0;

  public constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.i + offset];
  }

  private is(text: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t !== undefined && t.kind !== "string" && t.text.toLowerCase() === text.toLowerCase();
  }

  private line(): number {
    return this.peek()?.line ?? this.tokens[this.tokens.length - 1]?.line ?? 1;
  }

  private expect(text: string): void {
    if (!this.is(text)) {
      throw new DclSyntaxError(`"${text}" expected, found "${this.peek()?.text ?? "end of source"}"`, this.line());
    }
    this.i++;
  }

  private word(what: string): string {
    const t = this.peek();
    if (t === undefined || t.kind !== "word") {
      throw new DclSyntaxError(`${what} expected, found "${t?.text ?? "end of source"}"`, this.line());
    }
    this.i++;
    return t.text;
  }

  public role(): DclRole {
    this.expect("define");
    this.expect("role");
    const name = this.word("role name");
    this.expect("{");
    const grants: DclGrant[] = [];
    while (!this.is("}")) {
      if (this.peek() === undefined) {
        throw new DclSyntaxError('"}" expected at the end of the role', this.line());
      }
      grants.push(this.grant());
    }
    this.expect("}");
    return { name, grants };
  }

  private grant(): DclGrant {
    const line = this.line();
    this.expect("grant");
    this.expect("select");
    this.expect("on");
    const entity = this.word("entity name");
    let condition: DclCondition | undefined;
    if (this.is("where")) {
      this.i++;
      condition = this.or();
    }
    this.expect(";");
    return condition === undefined ? { entity, line } : { entity, condition, line };
  }

  private or(): DclCondition {
    const operands = [this.and()];
    while (this.is("or")) {
      this.i++;
      operands.push(this.and());
    }
    return operands.length === 1 ? (operands[0] as DclCondition) : { kind: "or", operands };
  }

  private and(): DclCondition {
    const operands = [this.unary()];
    while (this.is("and")) {
      this.i++;
      operands.push(this.unary());
    }
    return operands.length === 1 ? (operands[0] as DclCondition) : { kind: "and", operands };
  }

  private unary(): DclCondition {
    if (this.is("not")) {
      this.i++;
      return { kind: "not", operand: this.unary() };
    }
    if (this.is("inheriting")) {
      this.i++;
      this.expect("conditions");
      this.expect("from");
      this.expect("entity");
      return { kind: "inherit", entity: this.word("entity name") };
    }
    if (this.is("(")) {
      // a tuple of elements ( A, B ) = aspect pfcg_auth( … ), or a condition in parentheses
      const start = this.i;
      const tuple = this.tryTuple();
      if (tuple !== undefined) {
        return this.comparison(tuple);
      }
      this.i = start + 1;
      const inner = this.or();
      this.expect(")");
      return inner;
    }
    return this.comparison([this.word("element")]);
  }

  private tryTuple(): string[] | undefined {
    const start = this.i;
    this.i++;
    const elements: string[] = [];
    while (this.peek()?.kind === "word" && !["not", "inheriting"].includes((this.peek()?.text ?? "").toLowerCase())) {
      elements.push((this.peek() as Token).text);
      this.i++;
      if (this.is(",")) {
        this.i++;
        continue;
      }
      if (this.is(")") && (this.is("=", 1) || this.is("?=", 1))) {
        this.i++;
        return elements;
      }
      break;
    }
    this.i = start;
    return undefined;
  }

  private comparison(elements: string[]): DclCondition {
    const element = elements[0] as string;
    const text = (): string => elements.join(", ");
    if (this.is("is")) {
      this.i++;
      const negated = this.is("not");
      if (negated) this.i++;
      this.expect("null");
      return elements.length === 1 ? { kind: "null", element, negated } : { kind: "unsupported", text: `( ${text()} ) is null` };
    }
    const operator = this.peek()?.text.toLowerCase();
    if (operator === undefined || !["=", "<>", "!=", "<", "<=", ">", ">=", "?=", "like"].includes(operator)) {
      throw new DclSyntaxError(`a comparison operator expected after ${text()}, found "${this.peek()?.text ?? "end of source"}"`, this.line());
    }
    this.i++;
    if (this.is("aspect")) {
      this.i++;
      const aspect = this.word("aspect").toLowerCase();
      if (aspect === "pfcg_auth") {
        this.expect("(");
        const object = this.word("authorization object");
        const fields: string[] = [];
        const filters: Record<string, string> = {};
        while (this.is(",")) {
          this.i++;
          const field = this.word("authorization field");
          if (this.is("=")) {
            this.i++;
            const value = this.peek();
            if (value === undefined || (value.kind !== "string" && value.kind !== "number")) {
              throw new DclSyntaxError(`a literal expected for ${field}`, this.line());
            }
            this.i++;
            filters[field.toUpperCase()] = value.text;
          } else {
            fields.push(field.toUpperCase());
          }
        }
        this.expect(")");
        if (operator !== "=" && operator !== "?=") {
          return { kind: "unsupported", text: `${text()} ${operator} aspect pfcg_auth` };
        }
        if (fields.length !== elements.length) {
          throw new DclSyntaxError(`aspect pfcg_auth( ${object} ) maps ${fields.length} field(s) to ${elements.length} element(s)`, this.line());
        }
        return { kind: "pfcg", elements, object: object.toUpperCase(), fields, filters, orInitial: operator === "?=" };
      }
      if (aspect === "user" && elements.length === 1 && (operator === "=" || operator === "?=")) {
        return { kind: "user", element, orInitial: operator === "?=" };
      }
      // other aspects (bypass when, user-defined aspects…): not evaluated
      let depth = 0;
      while (this.peek() !== undefined && !(depth === 0 && (this.is(";") || this.is("and") || this.is("or") || this.is(")")))) {
        if (this.is("(")) depth++;
        if (this.is(")")) depth--;
        this.i++;
      }
      return { kind: "unsupported", text: `${text()} ${operator} aspect ${aspect}` };
    }
    const value = this.peek();
    if (value !== undefined && (value.kind === "string" || value.kind === "number") && elements.length === 1) {
      this.i++;
      if (operator === "?=") {
        return { kind: "unsupported", text: `${element} ?= ${value.text}` };
      }
      return { kind: "compare", element, operator: (operator === "!=" ? "<>" : operator) as "=" | "<>" | "<" | "<=" | ">" | ">=" | "like", value: value.text };
    }
    // an element, a path, a function…: not evaluated
    if (value !== undefined) this.i++;
    return { kind: "unsupported", text: `${text()} ${operator} ${value?.text ?? ""}` };
  }

  public done(): boolean {
    return this.peek() === undefined;
  }
}

export function parseDcl(source: string): DclResult {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  try {
    const role = parser.role();
    if (!parser.done()) {
      return { role, errors: [{ message: "unexpected text after the role", line: tokens[tokens.length - 1]?.line ?? 1 }] };
    }
    return { role, errors: [] };
  } catch (error) {
    if (error instanceof DclSyntaxError) {
      return { errors: [{ message: error.message, line: error.line }] };
    }
    throw error;
  }
}
