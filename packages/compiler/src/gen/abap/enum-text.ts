/**
 * Enumerated objects converted to text (D102). In ABAP, an enumerated object converted to `c` or
 * `string` gives the name of its enumerated constant in upper case (string templates, `&&`,
 * `CONV string( … )`, an assignment to a character-like variable); @abaplint/runtime gives its
 * base value (`1` instead of `M`). The rewrite pass replaces such an operand by a call of the
 * kernel with the members of its enumerated type, read from the declarations
 * (`TYPES BEGIN OF ENUM … END OF ENUM`).
 *
 * abaplint types an enumerated variable with its enumerated type, but an enumerated constant as its
 * base type: a constant is recognized by its declaration.
 */

import * as abaplint from "@abaplint/core";

export interface EnumDeclaration {
  /** Base type (`i` unless BASE TYPE). */
  base: string;
  /** Members in the order of the declaration: name (upper case) and value as text. */
  members: Array<{ name: string; value: string }>;
}

/** An operand to convert: its position in the original file, and the text that replaces it. */
export interface EnumTextOperand {
  start: { row: number; col: number };
  end: { row: number; col: number };
  replacement: string;
}

const position = (file: string, row: number, col: number): string => `${file.toLowerCase()}:${row}:${col}`;

/** The enumerated types declared in the ABAP objects of a registry. */
export class EnumCatalog {
  /** By the position of the declaration of a member. */
  private readonly members = new Map<string, EnumDeclaration>();
  /** By the position of the declaration of an enumerated structure. */
  private readonly structures = new Map<string, EnumDeclaration>();
  /** By the qualified name of the type, lower case (`zcl_x=>size`, `lcl=>size`). */
  private readonly types = new Map<string, EnumDeclaration>();

  public constructor(registry: abaplint.IRegistry) {
    for (const object of registry.getObjects()) {
      if (object instanceof abaplint.ABAPObject) {
        for (const file of object.getABAPFiles()) {
          this.read(file);
        }
      }
    }
  }

  public get size(): number {
    return this.types.size + this.members.size;
  }

  private read(file: abaplint.ABAPFile): void {
    let owner = "";
    let current: { declaration: EnumDeclaration; index: number } | undefined;
    for (const statement of file.getStatements()) {
      const kind = statement.get().constructor.name;
      const tokens = statement.getTokens();
      if (kind === "ClassDefinition" || kind === "Interface") {
        owner = (tokens[1]?.getStr() ?? "").toLowerCase();
      } else if (kind === "TypeEnumBegin") {
        const upper = tokens.map((t) => t.getStr().toUpperCase());
        const enumAt = upper.indexOf("ENUM");
        const name = (tokens[enumAt + 1]?.getStr() ?? "").toLowerCase();
        const baseAt = upper.findIndex((u, n) => u === "BASE" && upper[n + 1] === "TYPE");
        const declaration: EnumDeclaration = { base: baseAt >= 0 ? (tokens[baseAt + 2]?.getStr() ?? "i") : "i", members: [] };
        this.types.set(owner === "" ? name : `${owner}=>${name}`, declaration);
        const structureAt = upper.indexOf("STRUCTURE");
        const structure = structureAt >= 0 ? tokens[structureAt + 1] : undefined;
        if (structure !== undefined) {
          this.structures.set(position(file.getFilename(), structure.getRow(), structure.getCol()), declaration);
        }
        current = { declaration, index: 0 };
      } else if ((kind === "TypeEnum" || kind === "Type") && current !== undefined) {
        const rest = tokens.filter((t) => t.getStr() !== ":" && t.getStr().toUpperCase() !== "TYPES");
        const name = rest[0];
        if (name === undefined) continue;
        const upper = rest.map((t) => t.getStr().toUpperCase());
        const valueAt = upper.indexOf("VALUE");
        let value: string;
        if (valueAt < 0) {
          value = String(current.index);
        } else if (upper[valueAt + 1] === "IS" && upper[valueAt + 2] === "INITIAL") {
          value = current.declaration.base.toLowerCase() === "i" || /^int/i.test(current.declaration.base) ? "0" : "";
        } else {
          value = (rest[valueAt + 1]?.getStr() ?? "").replace(/^'(.*)'$/s, "$1").replace(/^`(.*)`$/s, "$1");
        }
        current.declaration.members.push({ name: name.getStr().toUpperCase(), value });
        current.index++;
        this.members.set(position(file.getFilename(), name.getRow(), name.getCol()), current.declaration);
      } else if (kind === "TypeEnumEnd") {
        current = undefined;
      }
    }
  }

  public ofMember(file: string, row: number, col: number): EnumDeclaration | undefined {
    return this.members.get(position(file, row, col));
  }

  public ofStructure(file: string, row: number, col: number): EnumDeclaration | undefined {
    return this.structures.get(position(file, row, col));
  }

  public ofType(qualifiedName: string | undefined): EnumDeclaration | undefined {
    return qualifiedName === undefined ? undefined : this.types.get(qualifiedName.toLowerCase());
  }
}

/** Format options of an embedded expression of a string template. */
const TEMPLATE_OPTIONS = new Set(["WIDTH", "ALIGN", "PAD", "CASE", "SIGN", "EXPONENT", "DECIMALS", "ZERO", "STYLE", "CURRENCY", "NUMBER", "ALPHA", "DATE", "TIME", "TIMESTAMP", "TIMEZONE", "COUNTRY", "XSD"]);

type Token = abaplint.Token;

/**
 * The operands of the method implementations of an object that are enumerated objects converted to
 * text, by file name (lower case).
 */
export function enumTextOperands(registry: abaplint.IRegistry, object: abaplint.ABAPObject, catalog: EnumCatalog, kernel: string): Map<string, EnumTextOperand[]> {
  const result = new Map<string, EnumTextOperand[]>();
  if (catalog.size === 0) {
    return result;
  }
  let spaghetti: abaplint.ISpaghettiScope;
  try {
    spaghetti = new abaplint.SyntaxLogic(registry, object).run().spaghetti;
  } catch {
    return result;
  }
  const statements = new Map<string, Array<{ kind: string; tokens: Token[] }>>();
  for (const file of object.getABAPFiles()) {
    statements.set(file.getFilename().toLowerCase(), file.getStatements().map((s) => ({ kind: s.get().constructor.name, tokens: [...s.getTokens()] })));
  }
  const writes = new Map<string, abaplint.AbstractType | undefined>();
  const reads: Array<{ file: string; token: { row: number; col: number }; declaration: EnumDeclaration; structure: boolean }> = [];
  const walk = (node: abaplint.ISpaghettiScopeNode): void => {
    for (const reference of node.getData().references) {
      const file = reference.position.getFilename().toLowerCase();
      const start = reference.position.getStart();
      if (reference.referenceType === abaplint.ReferenceType.DataWriteReference) {
        writes.set(position(file, start.getRow(), start.getCol()), reference.resolved instanceof abaplint.TypedIdentifier ? reference.resolved.getType() : undefined);
        continue;
      }
      if (reference.referenceType !== abaplint.ReferenceType.DataReadReference || reference.resolved === undefined) {
        continue;
      }
      const resolved = reference.resolved;
      const at = resolved.getStart();
      const type = resolved instanceof abaplint.TypedIdentifier ? resolved.getType() : undefined;
      const declaration =
        catalog.ofMember(resolved.getFilename(), at.getRow(), at.getCol()) ??
        (type instanceof abaplint.BasicTypes.EnumType ? catalog.ofType(type.getQualifiedName()) : undefined);
      if (declaration !== undefined) {
        reads.push({ file, token: { row: start.getRow(), col: start.getCol() }, declaration, structure: false });
        continue;
      }
      const structure = catalog.ofStructure(resolved.getFilename(), at.getRow(), at.getCol());
      if (structure !== undefined) {
        reads.push({ file, token: { row: start.getRow(), col: start.getCol() }, declaration: structure, structure: true });
      }
    }
    for (const child of node.getChildren()) {
      walk(child);
    }
  };
  walk(spaghetti.getTop());

  for (const read of reads) {
    const statement = (statements.get(read.file) ?? []).find((s) => s.tokens.some((t) => t.getRow() === read.token.row && t.getCol() === read.token.col));
    if (statement === undefined) continue;
    const tokens = statement.tokens;
    let first = tokens.findIndex((t) => t.getRow() === read.token.row && t.getCol() === read.token.col);
    let last = first;
    if (read.structure) {
      // the enumerated structure and its component: sz-member
      if (tokens[last + 1]?.getStr() !== "-" || tokens[last + 2] === undefined) continue;
      last += 2;
    } else if (tokens[last + 1]?.getStr() === "-" || tokens[last + 1]?.getStr() === "->") {
      continue;
    }
    // the class or interface of a static component: zcl_x=>member, me->member
    while (first >= 2 && (tokens[first - 1]?.getStr() === "=>" || tokens[first - 1]?.getStr() === "->")) {
      first -= 2;
    }
    if (!convertedToText(statement.kind, tokens, first, last, read.file, writes)) continue;
    const operand = tokens.slice(first, last + 1).map((t) => t.getStr()).join("");
    const members = JSON.stringify(read.declaration.members.map((m) => [m.name, m.value])).replace(/`/g, "``");
    const replacement = `${kernel}=>enum_text( value = CONV ${read.declaration.base}( ${operand} ) members = \`${members}\` )`;
    const end = tokens[last] as Token;
    const list = result.get(read.file) ?? [];
    if (!list.some((o) => o.start.row === tokens[first]?.getRow() && o.start.col === tokens[first]?.getCol())) {
      list.push({ start: { row: (tokens[first] as Token).getRow(), col: (tokens[first] as Token).getCol() }, end: { row: end.getEnd().getRow(), col: end.getEnd().getCol() }, replacement });
    }
    result.set(read.file, list);
  }
  return result;
}

/** Whether the operand tokens[first..last] is converted to text where it stands. */
function convertedToText(kind: string, tokens: Token[], first: number, last: number, file: string, writes: Map<string, abaplint.AbstractType | undefined>): boolean {
  const before = tokens[first - 1]?.getStr() ?? "";
  const after = tokens[last + 1]?.getStr() ?? "";
  // an embedded expression of a string template, with or without format options
  if (before.endsWith("{") && (after.startsWith("}") || TEMPLATE_OPTIONS.has(after.toUpperCase()))) return true;
  // a concatenation
  if (before === "&&" || after === "&&") return true;
  // CONV string( x ), CONV c( x )
  if (before === "(" && after === ")" && tokens[first - 3]?.getStr().toUpperCase() === "CONV" && /^(string|c)$/i.test(tokens[first - 2]?.getStr() ?? "")) return true;
  // target = x. with a character-like target
  if (kind === "Move" && before === "=" && first === 2 && after === "." && tokens[0] !== undefined) {
    const target = writes.get(position(file, tokens[0].getRow(), tokens[0].getCol()));
    return target instanceof abaplint.BasicTypes.StringType || target instanceof abaplint.BasicTypes.CharacterType;
  }
  return false;
}
