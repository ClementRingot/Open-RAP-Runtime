/**
 * CDS simple types and CDS enumerated types (D55): the TDL sources `name.drty.asdrty`.
 *
 *   @EndUserText.label: 'Travel name'
 *   define type zrt_name : abap.char(40);
 *
 *   @EndUserText.label: 'Status'
 *   define type zrt_status : abap.char(1) enum {
 *     @EndUserText.label: 'Open'
 *     OPEN = initial;
 *     @EndUserText.label: 'Accepted'
 *     ACCEPTED = 'A';
 *   }
 *
 *   define type zrt_status_stack : zrt_status;     // a stacked type
 *
 * abaplint knows the object type (DRTY) but does not parse it: the statement is read here.
 */

export interface CdsTypeIssue {
  severity: "error" | "warning";
  /** TYPE001… */
  code: string;
  message: string;
  line: number;
  column: number;
}

export interface CdsTypeSource {
  name: string;
  /** Text of the type after the colon, without blanks: `abap.char(1)`, `zrt_status`. */
  base: string;
  label?: string;
  /** Enumerated types: the constants in the order of the source. */
  enum?: Array<{ name: string; value: string | number | "initial"; literal: string; label?: string; line: number; column: number }>;
  line: number;
  column: number;
}

/** Comments become blanks so that the positions stay those of the source. */
function blankComments(source: string): string {
  let result = "";
  let i = 0;
  let quote: string | undefined;
  while (i < source.length) {
    const c = source[i] ?? "";
    const next = source[i + 1] ?? "";
    if (quote !== undefined) {
      result += c;
      if (c === quote) {
        quote = undefined;
      }
      i++;
    } else if (c === "'") {
      quote = c;
      result += c;
      i++;
    } else if ((c === "/" && next === "/") || (c === "-" && next === "-")) {
      while (i < source.length && source[i] !== "\n") {
        result += " ";
        i++;
      }
    } else if (c === "/" && next === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        result += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      result += "  ";
      i += 2;
    } else {
      result += c;
      i++;
    }
  }
  return result;
}

function position(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - before.lastIndexOf("\n") };
}

/** The `@EndUserText.label` among annotations (`@EndUserText.label: 'x'`). */
function labelOf(annotations: string): string | undefined {
  const match = /@EndUserText\s*\.\s*label\s*:\s*'((?:[^']|'')*)'/i.exec(annotations);
  return match === null ? undefined : (match[1] ?? "").replace(/''/g, "'");
}

export function parseCdsTypeSource(source: string): { type?: CdsTypeSource; issues: CdsTypeIssue[] } {
  const issues: CdsTypeIssue[] = [];
  const text = blankComments(source);
  const define = /\bdefine\s+type\s+([A-Za-z0-9_/]+)\s*:\s*([A-Za-z0-9_./]+(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?)\s*(enum\b)?/i.exec(text);
  if (define === null) {
    const at = position(text, Math.max(0, text.search(/\S/)));
    issues.push({ severity: "error", code: "TYPE001", message: "expected define type <name> : <type> [enum { … }]", ...at });
    return { issues };
  }
  const at = position(text, define.index + define[0].indexOf(define[1] ?? ""));
  const type: CdsTypeSource = { name: define[1] ?? "", base: (define[2] ?? "").replace(/\s+/g, ""), ...at };
  const label = labelOf(text.slice(0, define.index));
  if (label !== undefined) {
    type.label = label;
  }
  const rest = text.slice(define.index + define[0].length);
  if (define[3] === undefined) {
    if (!/^\s*;?\s*$/.test(rest)) {
      const offset = define.index + define[0].length + (rest.search(/\S/) >= 0 ? rest.search(/\S/) : 0);
      issues.push({ severity: "error", code: "TYPE001", message: "unexpected text after the type (enum { … } for an enumerated type)", ...position(text, offset) });
    }
    return { type, issues };
  }
  // enum { [annotations] CONST = value | initial; … }
  const bodyStart = define.index + define[0].length + rest.indexOf("{");
  const bodyEnd = text.lastIndexOf("}");
  if (rest.indexOf("{") < 0 || bodyEnd < bodyStart) {
    issues.push({ severity: "error", code: "TYPE001", message: "an enumerated type lists its constants in { }", ...position(text, define.index + define[0].length) });
    return { type, issues };
  }
  type.enum = [];
  const body = text.slice(bodyStart + 1, bodyEnd);
  const constant = /((?:@[^;=]*?:\s*(?:'(?:[^']|'')*'|#?[A-Za-z0-9_.]+)\s*)*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*('(?:[^']|'')*'|-?\d+|initial)\s*;/giy;
  let offset = 0;
  while (offset < body.length) {
    const blank = /\s*/y;
    blank.lastIndex = offset;
    blank.exec(body);
    offset = blank.lastIndex;
    if (offset >= body.length) {
      break;
    }
    constant.lastIndex = offset;
    const match = constant.exec(body);
    if (match === null) {
      issues.push({ severity: "error", code: "TYPE001", message: "expected <CONSTANT> = <value> | initial;", ...position(text, bodyStart + 1 + offset) });
      break;
    }
    const literal = match[3] ?? "";
    const where = position(text, bodyStart + 1 + match.index + (match[1] ?? "").length);
    const value: string | number | "initial" = /^initial$/i.test(literal) ? "initial" : literal.startsWith("'") ? literal.slice(1, -1).replace(/''/g, "'") : Number(literal);
    const entry: NonNullable<CdsTypeSource["enum"]>[number] = { name: match[2] ?? "", value, literal, ...where };
    const constantLabel = labelOf(match[1] ?? "");
    if (constantLabel !== undefined) {
      entry.label = constantLabel;
    }
    type.enum.push(entry);
    offset = constant.lastIndex;
  }
  return { type, issues };
}
