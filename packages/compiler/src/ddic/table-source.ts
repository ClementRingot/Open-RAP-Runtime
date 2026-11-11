/**
 * Tables and structures written as source code (`name.tabl.astabl`), with the syntax of the
 * ABAP Development Tools editor:
 *
 *   @EndUserText.label : 'Travel'
 *   @AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
 *   @AbapCatalog.tableCategory : #TRANSPARENT
 *   @AbapCatalog.deliveryClass : #A
 *   @AbapCatalog.dataMaintenance : #RESTRICTED
 *   define table zrt_travel {
 *     key client      : abap.clnt not null;
 *     key travel_uuid : sysuuid_x16 not null;
 *     description     : abap.char(256);
 *     @Semantics.amount.currencyCode : 'zrt_travel.currency_code'
 *     total_price     : abap.curr(16,2);
 *     currency_code   : abap.cuky;
 *   }
 *
 * abapGit only knows the XML serialization of tables (DD02V, DD09L, DD03P): the source is turned
 * into that XML, both when the project is read and by `rapt abapgit`, which writes it next to
 * the source so the repository can be pulled into an SAP system.
 */

export interface TableSourceIssue {
  severity: "error" | "warning";
  message: string;
  line: number;
  column: number;
}

export interface TableSourceField {
  name: string;
  key: boolean;
  notNull: boolean;
  /** Data element, upper case. */
  dataElement?: string;
  /** Built-in dictionary type: CHAR, NUMC, CURR… */
  builtin?: { datatype: string; length: number; decimals?: number };
  /** `include zstruct [with suffix _x]`. */
  include?: { name: string; suffix?: string };
  /** Currency or unit reference (`@Semantics.amount.currencyCode : 'table.field'`). */
  reference?: { table: string; field: string };
  line: number;
}

export interface TableSource {
  kind: "table" | "structure";
  name: string;
  description?: string;
  /** Annotations of the table, keys in lower case: `abapcatalog.deliveryclass` → `#A`. */
  annotations: Map<string, string>;
  fields: TableSourceField[];
}

/** Built-in types `abap.xxx`: dictionary type, internal type, and whether a length is given. */
interface Builtin {
  datatype: string;
  inttype: string;
  /** Length when none is given, or the fixed length. */
  length?: number;
  /** `true`: `(length)`; `"decimals"`: `(length, decimals)`. */
  args: false | true | "decimals" | "optional";
  intlen: (length: number, decimals: number) => number;
  fixedDecimals?: number;
}

const same = (n: number): number => n;
const fixed = (n: number) => (): number => n;
const packed = (n: number): number => Math.floor(n / 2) + 1;

const BUILTINS: Record<string, Builtin> = {
  char: { datatype: "CHAR", inttype: "C", args: true, intlen: (n) => 2 * n },
  numc: { datatype: "NUMC", inttype: "N", args: true, intlen: (n) => 2 * n },
  clnt: { datatype: "CLNT", inttype: "C", length: 3, args: false, intlen: fixed(6) },
  lang: { datatype: "LANG", inttype: "C", length: 1, args: false, intlen: fixed(2) },
  cuky: { datatype: "CUKY", inttype: "C", length: 5, args: "optional", intlen: (n) => 2 * n },
  unit: { datatype: "UNIT", inttype: "C", length: 3, args: "optional", intlen: (n) => 2 * n },
  dats: { datatype: "DATS", inttype: "D", length: 8, args: false, intlen: fixed(16) },
  tims: { datatype: "TIMS", inttype: "T", length: 6, args: false, intlen: fixed(12) },
  datn: { datatype: "DATN", inttype: "D", length: 8, args: false, intlen: fixed(16) },
  timn: { datatype: "TIMN", inttype: "T", length: 6, args: false, intlen: fixed(12) },
  dec: { datatype: "DEC", inttype: "P", args: "decimals", intlen: packed },
  curr: { datatype: "CURR", inttype: "P", args: "decimals", intlen: packed },
  quan: { datatype: "QUAN", inttype: "P", args: "decimals", intlen: packed },
  int1: { datatype: "INT1", inttype: "b", length: 3, args: false, intlen: fixed(1) },
  int2: { datatype: "INT2", inttype: "s", length: 5, args: false, intlen: fixed(2) },
  int4: { datatype: "INT4", inttype: "I", length: 10, args: false, intlen: fixed(4) },
  int8: { datatype: "INT8", inttype: "8", length: 19, args: false, intlen: fixed(8) },
  fltp: { datatype: "FLTP", inttype: "F", length: 16, args: false, intlen: fixed(8), fixedDecimals: 16 },
  d16n: { datatype: "D16N", inttype: "a", length: 16, args: false, intlen: fixed(8) },
  d34n: { datatype: "D34N", inttype: "e", length: 34, args: false, intlen: fixed(16) },
  string: { datatype: "STRG", inttype: "g", length: 0, args: "optional", intlen: fixed(8) },
  sstring: { datatype: "SSTR", inttype: "g", args: true, intlen: fixed(8) },
  raw: { datatype: "RAW", inttype: "X", args: true, intlen: same },
  rawstring: { datatype: "RSTR", inttype: "y", length: 0, args: "optional", intlen: fixed(8) },
  utclong: { datatype: "UTCL", inttype: "p", length: 27, args: false, intlen: fixed(8) },
  accp: { datatype: "ACCP", inttype: "N", length: 6, args: false, intlen: fixed(12) },
  prec: { datatype: "PREC", inttype: "s", length: 2, args: false, intlen: fixed(2) },
};

// ---------------------------------------------------------------------------------------------
// Tokens

interface Token {
  text: string;
  kind: "word" | "string" | "number" | "punct";
  line: number;
  column: number;
}

function tokenize(source: string, issues: TableSourceIssue[]): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let lineStart = 0;
  let i = 0;
  const at = (start: number): { line: number; column: number } => ({ line, column: start - lineStart + 1 });
  while (i < source.length) {
    const c = source[i] ?? "";
    if (c === "\n") {
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      for (let j = i; j < stop; j++) {
        if (source[j] === "\n") {
          line++;
          lineStart = j + 1;
        }
      }
      i = stop;
      continue;
    }
    if (c === "'") {
      const start = i;
      let text = "";
      i++;
      while (i < source.length && source[i] !== "\n") {
        if (source[i] === "'" && source[i + 1] === "'") {
          text += "'";
          i += 2;
          continue;
        }
        if (source[i] === "'") break;
        text += source[i];
        i++;
      }
      if (source[i] !== "'") {
        issues.push({ severity: "error", message: "unterminated string", ...at(start) });
      } else {
        i++;
      }
      tokens.push({ text, kind: "string", ...at(start) });
      continue;
    }
    const word = /^[A-Za-z_/$][A-Za-z0-9_/$.]*/.exec(source.slice(i, i + 200));
    if (word !== null) {
      tokens.push({ text: word[0], kind: "word", ...at(i) });
      i += word[0].length;
      continue;
    }
    const number = /^[0-9]+/.exec(source.slice(i, i + 40));
    if (number !== null) {
      tokens.push({ text: number[0], kind: "number", ...at(i) });
      i += number[0].length;
      continue;
    }
    tokens.push({ text: c, kind: "punct", ...at(i) });
    i++;
  }
  return tokens;
}

// ---------------------------------------------------------------------------------------------
// Parser

class Parser {
  private index = 0;

  public constructor(
    private readonly tokens: Token[],
    private readonly issues: TableSourceIssue[],
  ) {}

  public peek(offset = 0): Token | undefined {
    return this.tokens[this.index + offset];
  }

  public next(): Token | undefined {
    return this.tokens[this.index++];
  }

  public is(text: string, offset = 0): boolean {
    return this.peek(offset)?.text.toLowerCase() === text;
  }

  public accept(text: string): boolean {
    if (this.is(text)) {
      this.index++;
      return true;
    }
    return false;
  }

  public expect(text: string, what = `"${text}"`): boolean {
    if (this.accept(text)) {
      return true;
    }
    this.error(`${what} expected`);
    return false;
  }

  public error(message: string, token = this.peek() ?? this.tokens[this.tokens.length - 1]): void {
    this.issues.push({ severity: "error", message: token === undefined || message.includes(token.text) ? message : `${message}, found "${token.text}"`, line: token?.line ?? 1, column: token?.column ?? 1 });
  }

  public warning(message: string, token: Token | undefined): void {
    this.issues.push({ severity: "warning", message, line: token?.line ?? 1, column: token?.column ?? 1 });
  }

  public get done(): boolean {
    return this.index >= this.tokens.length;
  }

  /** Skips to the token after the next `;` (or before the closing `}`). */
  public skipStatement(): void {
    let depth = 0;
    while (!this.done) {
      const t = this.peek()?.text;
      if (t === "[" || t === "(" || t === "{") depth++;
      if (t === "]" || t === ")") depth--;
      if (t === "}" && depth <= 0) return;
      if (t === "}") depth--;
      this.index++;
      if (t === ";" && depth <= 0) return;
    }
  }

  /** `@a.b.c : value` → [key, value]. */
  public annotation(): [string, string] | undefined {
    this.expect("@");
    const name = this.next();
    if (name?.kind !== "word") {
      this.error("annotation name expected", name);
      return undefined;
    }
    if (!this.accept(":")) {
      return [name.text.toLowerCase(), "true"];
    }
    const value = this.peek();
    if (value === undefined) {
      this.error("annotation value expected");
      return undefined;
    }
    if (value.text === "#") {
      this.next();
      const symbol = this.next();
      return [name.text.toLowerCase(), `#${symbol?.text.toUpperCase() ?? ""}`];
    }
    if (value.text === "[" || value.text === "{") {
      const close = value.text === "[" ? "]" : "}";
      let depth = 0;
      while (!this.done) {
        const t = this.next()?.text;
        if (t === value.text) depth++;
        if (t === close && --depth === 0) break;
      }
      return [name.text.toLowerCase(), ""];
    }
    this.next();
    return [name.text.toLowerCase(), value.text];
  }
}

/** Reads the type of a field; false after an error (reported). */
function fieldType(parser: Parser, field: TableSourceField): boolean {
  const type = parser.next();
  if (type?.kind !== "word") {
    parser.error("type expected", type);
    return false;
  }
  const lower = type.text.toLowerCase();
  if (!lower.startsWith("abap.")) {
    field.dataElement = type.text.toUpperCase();
    return true;
  }
  const builtin = BUILTINS[lower.slice(5)];
  if (builtin === undefined) {
    parser.error(`unknown built-in type ${type.text}`, type);
    return false;
  }
  let length = builtin.length;
  let decimals = builtin.fixedDecimals;
  if (parser.accept("(")) {
    if (builtin.args === false) {
      parser.error(`${type.text} takes no length`, type);
      return false;
    }
    length = Number.parseInt(parser.next()?.text ?? "", 10);
    if (parser.accept(",")) {
      decimals = Number.parseInt(parser.next()?.text ?? "", 10);
    }
    if (!parser.expect(")")) {
      return false;
    }
  } else if (builtin.args === true || builtin.args === "decimals") {
    parser.error(`${type.text} needs a length`, parser.peek());
    return false;
  }
  if (length === undefined || Number.isNaN(length) || (decimals !== undefined && Number.isNaN(decimals))) {
    parser.error(`invalid length for ${type.text}`, type);
    return false;
  }
  if (builtin.args === "decimals" && decimals === undefined) {
    decimals = 0;
  }
  field.builtin = { datatype: builtin.datatype, length };
  if (decimals !== undefined && (decimals > 0 || builtin.args === "decimals")) {
    field.builtin.decimals = decimals;
  }
  return true;
}

function referenceOf(annotations: Map<string, string>): { table: string; field: string } | undefined {
  const value = annotations.get("semantics.amount.currencycode") ?? annotations.get("semantics.quantity.unitofmeasure");
  if (value === undefined) {
    return undefined;
  }
  const dot = value.lastIndexOf(".");
  return dot < 0 ? undefined : { table: value.slice(0, dot).toUpperCase(), field: value.slice(dot + 1).toUpperCase() };
}

export function parseTableSource(source: string): { table?: TableSource; issues: TableSourceIssue[] } {
  const issues: TableSourceIssue[] = [];
  const parser = new Parser(tokenize(source, issues), issues);
  const annotations = new Map<string, string>();
  while (parser.is("@")) {
    const annotation = parser.annotation();
    if (annotation !== undefined) {
      annotations.set(annotation[0], annotation[1]);
    }
  }
  if (!parser.expect("define")) {
    return { issues };
  }
  const kindToken = parser.next();
  const kind = kindToken?.text.toLowerCase();
  if (kind !== "table" && kind !== "structure") {
    parser.error('"table" or "structure" expected', kindToken);
    return { issues };
  }
  const nameToken = parser.next();
  if (nameToken?.kind !== "word") {
    parser.error("table name expected", nameToken);
    return { issues };
  }
  const table: TableSource = { kind, name: nameToken.text.toUpperCase(), annotations, fields: [] };
  const label = annotations.get("endusertext.label");
  if (label !== undefined) {
    table.description = label;
  }
  if (!parser.expect("{")) {
    return { table, issues };
  }
  while (!parser.done && !parser.is("}")) {
    const fieldAnnotations = new Map<string, string>();
    while (parser.is("@")) {
      const annotation = parser.annotation();
      if (annotation !== undefined) {
        fieldAnnotations.set(annotation[0], annotation[1]);
      }
    }
    const start = parser.peek();
    const key = parser.accept("key");
    if (parser.is("include") && !parser.is(":", 1)) {
      parser.next();
      const include = parser.next();
      if (include?.kind !== "word") {
        parser.error("structure name expected", include);
        parser.skipStatement();
        continue;
      }
      const field: TableSourceField = { name: ".INCLUDE", key, notNull: false, include: { name: include.text.toUpperCase() }, line: start?.line ?? 1 };
      if (parser.accept("with")) {
        parser.expect("suffix");
        const suffix = parser.next()?.text.toUpperCase() ?? "";
        field.include = { name: include.text.toUpperCase(), suffix };
        field.name = `.INCLU-${suffix}`;
      }
      if (parser.accept("not")) {
        parser.expect("null");
        field.notNull = true;
      }
      table.fields.push(field);
      parser.expect(";");
      continue;
    }
    const name = parser.next();
    if (name?.kind !== "word") {
      parser.error("field name expected", name);
      parser.skipStatement();
      continue;
    }
    if (!parser.expect(":")) {
      parser.skipStatement();
      continue;
    }
    const field: TableSourceField = { name: name.text.toUpperCase(), key, notNull: false, line: name.line };
    if (parser.is("include")) {
      parser.error("named includes are not supported, use \"include <structure>;\"");
      parser.skipStatement();
      continue;
    }
    if (!fieldType(parser, field)) {
      parser.skipStatement();
      continue;
    }
    if (parser.accept("not")) {
      parser.expect("null");
      field.notNull = true;
    }
    const reference = referenceOf(fieldAnnotations);
    if (reference !== undefined) {
      field.reference = reference;
    }
    if (parser.is("with")) {
      parser.warning(`${field.name}: foreign keys are not transferred to the abapGit XML, define them in the ABAP Development Tools`, parser.peek());
      parser.skipStatement();
    } else {
      parser.expect(";");
    }
    if (table.fields.some((f) => f.name === field.name)) {
      parser.error(`field ${field.name} defined twice`, name);
    }
    table.fields.push(field);
  }
  parser.expect("}");
  if (!parser.done) {
    parser.error("unexpected text after the definition");
  }
  if (kind === "table" && !table.fields.some((f) => f.key) && !issues.some((i) => i.severity === "error")) {
    issues.push({ severity: "error", message: `table ${table.name} has no key field`, line: nameToken.line, column: nameToken.column });
  }
  return { table, issues };
}

// ---------------------------------------------------------------------------------------------
// abapGit XML

const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pad6 = (n: number): string => String(n).padStart(6, "0");

/** Wraps `asx:values` content in the abapGit envelope. */
export function abapGitXml(serializer: string, values: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<abapGit version="v1.0.0" serializer="LCL_OBJECT_${serializer}" serializer_version="v1.0.0">`,
    ' <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">',
    "  <asx:values>",
    values.replace(/\n$/, ""),
    "  </asx:values>",
    " </asx:abap>",
    "</abapGit>",
    "",
  ].join("\n");
}

/** `<TAG>` blocks with their children, skipping undefined values. */
export function xmlElement(tag: string, children: [string, string | undefined][], indent: number): string {
  const pad = " ".repeat(indent);
  const lines = children.filter((c): c is [string, string] => c[1] !== undefined).map(([k, v]) => `${pad} <${k}>${escape(v)}</${k}>`);
  return `${pad}<${tag}>\n${lines.join("\n")}\n${pad}</${tag}>`;
}

const ENHANCEMENT: Record<string, string> = {
  "#NOT_CLASSIFIED": "0",
  "#NOT_EXTENSIBLE": "1",
  "#EXTENSIBLE_CHARACTER": "2",
  "#EXTENSIBLE_CHARACTER_NUMERIC": "3",
  "#EXTENSIBLE_ANY": "4",
};
const MAINTENANCE: Record<string, string | undefined> = { "#RESTRICTED": undefined, "#ALLOWED": "X", "#NOT_ALLOWED": "N" };

function dd03p(field: TableSourceField): string {
  const notNull = field.notNull ? "X" : undefined;
  if (field.include !== undefined) {
    return xmlElement(
      "DD03P",
      [
        ["FIELDNAME", field.name],
        ["KEYFLAG", field.key ? "X" : undefined],
        ["ADMINFIELD", "0"],
        ["PRECFIELD", field.include.name],
        ["NOTNULL", notNull],
        ["MASK", "      S"],
        ["COMPTYPE", "S"],
      ],
      4,
    );
  }
  const reference: [string, string | undefined][] = [
    ["REFTABLE", field.reference?.table],
    ["REFFIELD", field.reference?.field],
  ];
  if (field.dataElement !== undefined) {
    return xmlElement(
      "DD03P",
      [["FIELDNAME", field.name], ["KEYFLAG", field.key ? "X" : undefined], ["ROLLNAME", field.dataElement], ["ADMINFIELD", "0"], ...reference, ["NOTNULL", notNull], ["COMPTYPE", "E"]],
      4,
    );
  }
  const type = field.builtin ?? { datatype: "CHAR", length: 1 };
  const builtin = Object.values(BUILTINS).find((b) => b.datatype === type.datatype);
  const intlen = builtin?.intlen(type.length, type.decimals ?? 0) ?? type.length;
  return xmlElement(
    "DD03P",
    [
      ["FIELDNAME", field.name],
      ["KEYFLAG", field.key ? "X" : undefined],
      ["ADMINFIELD", "0"],
      ["INTTYPE", builtin?.inttype],
      ["INTLEN", pad6(intlen)],
      ...reference,
      ["NOTNULL", notNull],
      ["DATATYPE", type.datatype],
      ["LENG", pad6(type.length)],
      ["DECIMALS", type.decimals === undefined ? undefined : pad6(type.decimals)],
      ["MASK", `  ${type.datatype}`],
    ],
    4,
  );
}

/** The abapGit serialization of a table or structure source. */
export function tableSourceToXml(table: TableSource, language = "E"): string {
  const a = table.annotations;
  const first = table.fields[0];
  const clientDependent = table.kind === "table" && first !== undefined && first.key && (first.builtin?.datatype === "CLNT" || first.dataElement === "MANDT");
  const parts: string[] = [];
  const header: [string, string | undefined][] = [
    ["TABNAME", table.name],
    ["DDLANGUAGE", language],
    ["TABCLASS", table.kind === "table" ? "TRANSP" : "INTTAB"],
    ["CLIDEP", clientDependent ? "X" : undefined],
    ["DDTEXT", table.description],
    ["MASTERLANG", language],
  ];
  if (table.kind === "table") {
    header.push(["MAINFLAG", MAINTENANCE[a.get("abapcatalog.datamaintenance") ?? "#RESTRICTED"]]);
    header.push(["CONTFLAG", (a.get("abapcatalog.deliveryclass") ?? "#A").replace("#", "")]);
  }
  header.push(["EXCLASS", ENHANCEMENT[a.get("abapcatalog.enhancement.category") ?? "#NOT_EXTENSIBLE"] ?? "1"]);
  parts.push(xmlElement("DD02V", header, 3));
  if (table.kind === "table") {
    parts.push(
      xmlElement(
        "DD09L",
        [
          ["TABNAME", table.name],
          ["AS4LOCAL", "A"],
          ["TABKAT", "0"],
          ["TABART", "APPL0"],
          ["BUFALLOW", "N"],
        ],
        3,
      ),
    );
  }
  parts.push(`   <DD03P_TABLE>\n${table.fields.map((f) => dd03p(f)).join("\n")}\n   </DD03P_TABLE>`);
  return abapGitXml("TABL", parts.join("\n"));
}
