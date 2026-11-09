/**
 * Token-level parser of the EML statements (READ / MODIFY / COMMIT / ROLLBACK ENTITIES).
 *
 * It works on the tokens of the statement rather than on the abaplint statement tree: abaplint
 * does not parse every EML form (`CREATE AUTO FILL CID SET FIELDS WITH` is an unknown
 * statement for it), and the rewrite pass needs only the structure of the statement and the
 * tokens of its operands.
 */

import { adjacent, depthDelta, joinTokens, type Tok } from "./tokens.js";

export type FieldSpec =
  /** `FROM`: the `%control` of the rows says which fields are used. */
  | { kind: "from" }
  /** `ALL FIELDS WITH` */
  | { kind: "all" }
  /** `FIELDS ( a b ) WITH` */
  | { kind: "list"; fields: Tok[] }
  /** `SET FIELDS WITH`: the fields that are not initial. */
  | { kind: "set" };

export interface Operand {
  tokens: Tok[];
}

export type ReadOperation =
  | { kind: "read"; fields: FieldSpec; source: Operand; result?: Operand }
  | { kind: "readBy"; association: Tok; fields: FieldSpec; source: Operand; result?: Operand; link?: Operand }
  | { kind: "function"; name: Tok; source: Operand; result?: Operand };

export type ModifyOperation =
  | { kind: "create"; autoFillCid: boolean; fields: FieldSpec; source: Operand }
  | { kind: "createBy"; association: Tok; autoFillCid: boolean; fields: FieldSpec; source: Operand }
  | { kind: "update"; fields: FieldSpec; source: Operand }
  | { kind: "delete"; source: Operand }
  | { kind: "execute"; name: Tok; autoFillCid: boolean; source: Operand; result?: Operand };

export interface EntityGroup<Op> {
  /** The entity as written: alias, entity name or `bdef\\alias`. */
  entity: Tok;
  operations: Op[];
}

export type Mode = "default" | "local" | "privileged";

export type EmlStatement =
  | {
      kind: "read";
      /** The BDEF of the long form (`READ ENTITIES OF b`); the short form names the entity only. */
      bdef?: Tok;
      mode: Mode;
      groups: Array<EntityGroup<ReadOperation>>;
      failed?: Operand;
      reported?: Operand;
    }
  | {
      kind: "modify";
      bdef?: Tok;
      mode: Mode;
      groups: Array<EntityGroup<ModifyOperation>>;
      mapped?: Operand;
      failed?: Operand;
      reported?: Operand;
    }
  | {
      kind: "commit";
      simulation: boolean;
      responses: Array<{ bdef: Tok; failed?: Operand; reported?: Operand }>;
    }
  | { kind: "rollback" };

export class EmlSyntaxError extends Error {
  public constructor(
    message: string,
    public readonly token: Tok | undefined,
  ) {
    super(message);
  }
}

/** Is the statement (its first tokens) an EML statement this parser handles? */
export function isEmlStatement(tokens: readonly Tok[]): boolean {
  const [a, b] = tokens;
  if (a === undefined || b === undefined) {
    return false;
  }
  return (
    ((a.upper === "READ" || a.upper === "MODIFY") && (b.upper === "ENTITIES" || b.upper === "ENTITY")) ||
    ((a.upper === "COMMIT" || a.upper === "ROLLBACK") && b.upper === "ENTITIES")
  );
}

const RESPONSES = new Set(["MAPPED", "FAILED", "REPORTED"]);
const READ_STOP = new Set(["ENTITY", "BY", "ALL", "FIELDS", "FROM", "WITH", "EXECUTE", "RESULT", "LINK", "FAILED", "REPORTED", "OPERATIONS"]);
const MODIFY_STOP = new Set([
  "ENTITY",
  "CREATE",
  "UPDATE",
  "DELETE",
  "EXECUTE",
  "FIELDS",
  "SET",
  "FROM",
  "WITH",
  "AUTO",
  "RESULT",
  "MAPPED",
  "FAILED",
  "REPORTED",
  "RELATING",
  "AUGMENTING",
  "OPERATIONS",
  "REQUEST",
]);
const COMMIT_STOP = new Set(["RESPONSE", "RESPONSES", "FAILED", "REPORTED"]);

class Cursor {
  public pos = 0;

  public constructor(public readonly tokens: Tok[]) {}

  public peek(offset = 0): Tok | undefined {
    return this.tokens[this.pos + offset];
  }

  public is(...words: string[]): boolean {
    return words.every((w, i) => this.peek(i)?.upper === w);
  }

  public accept(...words: string[]): boolean {
    if (this.is(...words)) {
      this.pos += words.length;
      return true;
    }
    return false;
  }

  public expect(...words: string[]): void {
    if (!this.accept(...words)) {
      throw new EmlSyntaxError(`expected ${words.join(" ")}`, this.peek());
    }
  }

  public done(): boolean {
    return this.pos >= this.tokens.length;
  }

  /** A name, with the tokens glued to it (`zr_travel\\travel\_booking`, `travel~accept`). */
  public name(what: string): Tok {
    const first = this.peek();
    if (first === undefined) {
      throw new EmlSyntaxError(`expected ${what}`, undefined);
    }
    this.pos++;
    let last = first;
    let text = first.str;
    for (let next = this.peek(); next !== undefined && adjacent(last, next) && depthDelta(next) === 0; next = this.peek()) {
      text += next.str;
      last = next;
      this.pos++;
    }
    return { ...first, str: text, upper: text.toUpperCase(), endRow: last.endRow, endCol: last.endCol };
  }

  /** An operand: the tokens up to the next keyword of the statement at nesting depth 0. */
  public operand(stop: Set<string>, what: string): Operand {
    const start = this.pos;
    let depth = 0;
    while (!this.done()) {
      const t = this.peek() as Tok;
      const previous = this.tokens[this.pos - 1];
      const next = this.peek(1);
      const standalone = (previous === undefined || !adjacent(previous, t)) && (next === undefined || !adjacent(t, next));
      if (depth === 0 && this.pos > start && standalone && stop.has(t.upper)) {
        break;
      }
      depth += depthDelta(t);
      this.pos++;
    }
    if (this.pos === start) {
      throw new EmlSyntaxError(`expected ${what}`, this.peek());
    }
    return { tokens: this.tokens.slice(start, this.pos) };
  }
}

function fieldSpec(c: Cursor): FieldSpec {
  if (c.accept("ALL", "FIELDS", "WITH")) {
    return { kind: "all" };
  }
  if (c.accept("SET", "FIELDS", "WITH")) {
    return { kind: "set" };
  }
  if (c.accept("FIELDS")) {
    if (c.peek()?.str !== "(") {
      throw new EmlSyntaxError("expected ( after FIELDS", c.peek());
    }
    c.pos++;
    const fields: Tok[] = [];
    while (!c.done() && c.peek()?.str !== ")") {
      fields.push(c.peek() as Tok);
      c.pos++;
    }
    c.expect(")");
    c.expect("WITH");
    if (fields.length === 0) {
      throw new EmlSyntaxError("empty field list", c.peek());
    }
    return { kind: "list", fields };
  }
  if (c.accept("FROM") || c.accept("WITH")) {
    return { kind: "from" };
  }
  throw new EmlSyntaxError("expected FROM, WITH, ALL FIELDS WITH, FIELDS ( … ) WITH or SET FIELDS WITH", c.peek());
}

function mode(c: Cursor): Mode {
  if (c.accept("IN", "LOCAL", "MODE")) {
    return "local";
  }
  if (c.accept("PRIVILEGED")) {
    return "privileged";
  }
  return "default";
}

function readOperations(c: Cursor): ReadOperation[] {
  const operations: ReadOperation[] = [];
  for (;;) {
    if (c.accept("BY")) {
      const association = c.name("an association");
      const fields = fieldSpec(c);
      const operation: ReadOperation = { kind: "readBy", association, fields, source: c.operand(READ_STOP, "the import table") };
      if (c.accept("RESULT")) {
        operation.result = c.operand(READ_STOP, "the result table");
      }
      if (c.accept("LINK")) {
        operation.link = c.operand(READ_STOP, "the link table");
      }
      operations.push(operation);
    } else if (c.accept("EXECUTE")) {
      const name = c.name("a function");
      c.expect("FROM");
      const operation: ReadOperation = { kind: "function", name, source: c.operand(READ_STOP, "the import table") };
      if (c.accept("RESULT")) {
        operation.result = c.operand(READ_STOP, "the result table");
      }
      operations.push(operation);
    } else if (c.is("ALL") || c.is("FIELDS") || c.is("FROM")) {
      const fields = fieldSpec(c);
      const operation: ReadOperation = { kind: "read", fields, source: c.operand(READ_STOP, "the import table") };
      if (c.accept("RESULT")) {
        operation.result = c.operand(READ_STOP, "the result table");
      }
      operations.push(operation);
    } else {
      break;
    }
  }
  if (operations.length === 0) {
    throw new EmlSyntaxError("expected a read operation", c.peek());
  }
  return operations;
}

function modifyOperations(c: Cursor): ModifyOperation[] {
  const operations: ModifyOperation[] = [];
  for (;;) {
    if (c.accept("CREATE")) {
      if (c.accept("BY")) {
        const association = c.name("an association");
        const autoFillCid = c.accept("AUTO", "FILL", "CID");
        const fields = fieldSpec(c);
        operations.push({ kind: "createBy", association, autoFillCid, fields, source: c.operand(MODIFY_STOP, "the instances") });
      } else {
        const autoFillCid = c.accept("AUTO", "FILL", "CID");
        const fields = fieldSpec(c);
        operations.push({ kind: "create", autoFillCid, fields, source: c.operand(MODIFY_STOP, "the instances") });
      }
    } else if (c.accept("UPDATE")) {
      const fields = fieldSpec(c);
      operations.push({ kind: "update", fields, source: c.operand(MODIFY_STOP, "the instances") });
    } else if (c.accept("DELETE")) {
      c.expect("FROM");
      operations.push({ kind: "delete", source: c.operand(MODIFY_STOP, "the instances") });
    } else if (c.accept("EXECUTE")) {
      const name = c.name("an action");
      const autoFillCid = c.accept("AUTO", "FILL", "CID");
      if (!c.accept("FROM") && !c.accept("WITH")) {
        throw new EmlSyntaxError("expected FROM", c.peek());
      }
      const operation: ModifyOperation = { kind: "execute", name, autoFillCid, source: c.operand(MODIFY_STOP, "the instances") };
      if (c.accept("RESULT")) {
        operation.result = c.operand(MODIFY_STOP, "the result table");
      }
      operations.push(operation);
    } else {
      break;
    }
    if (c.is("RELATING") || c.is("AUGMENTING") || c.is("REQUEST")) {
      throw new EmlSyntaxError(`${c.peek()?.upper} is not supported`, c.peek());
    }
  }
  if (operations.length === 0) {
    throw new EmlSyntaxError("expected an operation (CREATE, UPDATE, DELETE, EXECUTE)", c.peek());
  }
  return operations;
}

function responses(c: Cursor, stop: Set<string>, allowed: Set<string>): Partial<Record<"mapped" | "failed" | "reported", Operand>> {
  const result: Partial<Record<"mapped" | "failed" | "reported", Operand>> = {};
  while (!c.done()) {
    const t = c.peek() as Tok;
    if (!RESPONSES.has(t.upper) || !allowed.has(t.upper)) {
      throw new EmlSyntaxError(`unexpected ${t.str}`, t);
    }
    c.pos++;
    const key = t.upper.toLowerCase() as "mapped" | "failed" | "reported";
    if (result[key] !== undefined) {
      throw new EmlSyntaxError(`${t.upper} given twice`, t);
    }
    result[key] = c.operand(stop, `the ${key} response`);
  }
  return result;
}

/** Parses the tokens of an EML statement, without its final period. */
export function parseEml(tokens: Tok[]): EmlStatement {
  const c = new Cursor(tokens);
  if (c.accept("ROLLBACK", "ENTITIES")) {
    if (!c.done()) {
      throw new EmlSyntaxError(`unexpected ${c.peek()?.str}`, c.peek());
    }
    return { kind: "rollback" };
  }
  if (c.accept("COMMIT", "ENTITIES")) {
    const simulation = c.accept("IN", "SIMULATION", "MODE");
    const result: EmlStatement = { kind: "commit", simulation, responses: [] };
    while (!c.done()) {
      if (c.accept("RESPONSE", "OF")) {
        const response: { bdef: Tok; failed?: Operand; reported?: Operand } = { bdef: c.name("a behavior definition") };
        for (;;) {
          if (c.accept("FAILED")) {
            response.failed = c.operand(COMMIT_STOP, "the failed response");
          } else if (c.accept("REPORTED")) {
            response.reported = c.operand(COMMIT_STOP, "the reported response");
          } else {
            break;
          }
        }
        result.responses.push(response);
      } else if (c.is("RESPONSES")) {
        throw new EmlSyntaxError("COMMIT ENTITIES RESPONSES is not supported, use RESPONSE OF", c.peek());
      } else {
        throw new EmlSyntaxError(`unexpected ${c.peek()?.str}`, c.peek());
      }
    }
    return result;
  }
  const kind = c.accept("READ") ? "read" : c.accept("MODIFY") ? "modify" : undefined;
  if (kind === undefined) {
    throw new EmlSyntaxError("not an EML statement", c.peek());
  }
  const stop = kind === "read" ? READ_STOP : MODIFY_STOP;
  let bdef: Tok | undefined;
  let statementMode: Mode;
  const groups: Array<EntityGroup<ReadOperation | ModifyOperation>> = [];
  if (c.accept("ENTITIES")) {
    if (c.is("OPERATIONS")) {
      throw new EmlSyntaxError(`${kind.toUpperCase()} ENTITIES OPERATIONS (dynamic EML) is not supported`, c.peek());
    }
    c.expect("OF");
    bdef = c.name("a behavior definition");
    statementMode = mode(c);
    while (c.accept("ENTITY")) {
      const entity = c.name("an entity");
      groups.push({ entity, operations: kind === "read" ? readOperations(c) : modifyOperations(c) });
    }
    if (groups.length === 0) {
      throw new EmlSyntaxError("expected ENTITY", c.peek());
    }
  } else {
    c.expect("ENTITY");
    statementMode = mode(c);
    const entity = c.name("an entity");
    if (statementMode === "default") {
      statementMode = mode(c);
    }
    groups.push({ entity, operations: kind === "read" ? readOperations(c) : modifyOperations(c) });
  }
  const allowed = kind === "read" ? new Set(["FAILED", "REPORTED"]) : RESPONSES;
  const { mapped, failed, reported } = responses(c, stop, allowed);
  if (kind === "read") {
    const statement: EmlStatement = { kind, mode: statementMode, groups: groups as Array<EntityGroup<ReadOperation>> };
    if (bdef !== undefined) statement.bdef = bdef;
    if (failed !== undefined) statement.failed = failed;
    if (reported !== undefined) statement.reported = reported;
    return statement;
  }
  const statement: EmlStatement = { kind, mode: statementMode, groups: groups as Array<EntityGroup<ModifyOperation>> };
  if (bdef !== undefined) statement.bdef = bdef;
  if (mapped !== undefined) statement.mapped = mapped;
  if (failed !== undefined) statement.failed = failed;
  if (reported !== undefined) statement.reported = reported;
  return statement;
}

/** `DATA(x)` or `FINAL(x)`: the name of an inline declaration, else undefined. */
export function inlineDeclaration(operand: Operand): string | undefined {
  const m = /^(?:DATA|FINAL)\(\s*([^\s()]+)\s*\)$/i.exec(joinTokens(operand.tokens));
  return m?.[1];
}

const CONSTRUCTORS = new Set(["VALUE", "CORRESPONDING", "CONV", "COND", "SWITCH", "REDUCE", "FILTER", "EXACT"]);

/** The `#` of a constructor expression operand (`VALUE #( … )`), to be given an explicit type. */
export function inferredTypeToken(operand: Operand): Tok | undefined {
  const [first, second] = operand.tokens;
  if (first !== undefined && second !== undefined && CONSTRUCTORS.has(first.upper) && second.str === "#") {
    return second;
  }
  return undefined;
}
