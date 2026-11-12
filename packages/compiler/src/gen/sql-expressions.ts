/** PostgreSQL of the calculated elements (D67). */

import { isCharacterLike, isNumeric, type AbapType, type CdsCondition, type CdsExpression } from "@open-rap/model";

export interface SqlRefs {
  /** A column of the data source (`column` of the expression). */
  column(name: string, type: AbapType): string;
  /** Another element of the entity (`$projection.X`). */
  element(name: string, type: AbapType): string;
}

const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const text = (sql: string): string => `(${sql})::text`;

/** The SQL of a calculated element, cast to the PostgreSQL type of the element. */
export function calculatedColumn(expression: CdsExpression, type: AbapType, sqlType: (t: AbapType) => string, refs: SqlRefs): string {
  return `CAST(${renderExpression(expression, sqlType, refs)} AS ${sqlType(type)})`;
}

export function renderExpression(e: CdsExpression, sqlType: (t: AbapType) => string, refs: SqlRefs): string {
  const render = (x: CdsExpression): string => renderExpression(x, sqlType, refs);
  switch (e.kind) {
    case "literal":
      if (e.value === null) {
        return "NULL";
      }
      if (typeof e.value === "number") {
        return e.value < 0 ? `(${e.value})` : String(e.value);
      }
      return e.type.kind === "char" ? literal(e.value) : `${literal(e.value)}::${sqlType(e.type)}`;
    case "column":
      return refs.column(e.name, e.type);
    case "element":
      return refs.element(e.name, e.type);
    case "session":
      return "current_date";
    case "negate":
      return `(-${render(e.operand)})`;
    case "arithmetic":
      if (e.operator === "/") {
        return `((${render(e.left)})::${e.type.kind === "fltp" ? "double precision" : "numeric"} / ${render(e.right)})`;
      }
      return `(${render(e.left)} ${e.operator} ${render(e.right)})`;
    case "case": {
      const subject = e.operand;
      const branches = e.branches.map((b) => {
        const when = isCondition(b.when) ? renderCondition(b.when, sqlType, refs) : subject === undefined ? render(b.when) : operand(b.when, subject, render);
        return `WHEN ${when} THEN ${render(b.then)}`;
      });
      const otherwise = e.else === undefined ? "" : ` ELSE ${render(e.else)}`;
      return `(CASE${subject === undefined ? "" : ` ${render(subject)}`} ${branches.join(" ")}${otherwise} END)`;
    }
    case "cast":
      return cast(render(e.operand), e.operand.type, e.type, sqlType);
    case "function":
      return functionCall(e, render);
  }
}

const isCondition = (x: CdsExpression | CdsCondition): x is CdsCondition =>
  x.kind === "compare" || x.kind === "isNull" || x.kind === "and" || x.kind === "or" || x.kind === "not";

function cast(sql: string, from: AbapType, to: AbapType, sqlType: (t: AbapType) => string): string {
  if (to.kind === "bool") {
    return from.kind === "bool" ? sql : `(coalesce(btrim(${text(sql)}), '') <> '')`;
  }
  if (from.kind === "bool" && isCharacterLike(to)) {
    return `(CASE WHEN ${sql} THEN 'X' ELSE '' END)::${sqlType(to)}`;
  }
  if (from.kind === "dats" && isCharacterLike(to)) {
    return `coalesce(to_char(${sql}, 'YYYYMMDD'), '00000000')::${sqlType(to)}`;
  }
  if (isCharacterLike(from) && to.kind === "dats") {
    return `(CASE WHEN coalesce(btrim(${text(sql)}), '') IN ('', '00000000') THEN NULL ELSE to_date(${text(sql)}, 'YYYYMMDD') END)`;
  }
  if (isCharacterLike(from) && isNumeric(to)) {
    // ABAP: an initial character value converts to 0
    return `coalesce(nullif(btrim(${text(sql)}), ''), '0')::${sqlType(to)}`;
  }
  return `(${sql})::${sqlType(to)}`;
}

function functionCall(e: Extract<CdsExpression, { kind: "function" }>, render: (x: CdsExpression) => string): string {
  const [a, b, c] = e.args.map(render) as [string, string | undefined, string | undefined];
  switch (e.name) {
    case "concat":
      return `concat(rtrim(${text(a)}), rtrim(${text(b ?? "''")}))`;
    case "concat_with_space":
      return `concat(rtrim(${text(a)}), repeat(' ', ${c ?? "1"}), rtrim(${text(b ?? "''")}))`;
    case "substring":
      return `substr(${text(a)}, ${b ?? "1"}, ${c ?? "0"})`;
    case "upper":
    case "lower":
      return `${e.name}(${text(a)})`;
    case "length":
      return `length(rtrim(${text(a)}))`;
    case "left":
      return `left(${text(a)}, ${b ?? "0"})`;
    case "right":
      return `right(rtrim(${text(a)}), ${b ?? "0"})`;
    case "ltrim":
    case "rtrim":
      return `${e.name}(${text(a)}, ${text(b ?? "' '")})`;
    case "replace":
      return `replace(${text(a)}, ${text(b ?? "''")}, ${text(c ?? "''")})`;
    case "coalesce":
      return `coalesce(${a}, ${b ?? "NULL"})`;
    case "div":
      return `div((${a})::numeric, ${b ?? "1"})`;
    case "division":
      return `round((${a})::numeric / ${b ?? "1"}, ${c ?? "0"})`;
    case "mod":
      return `mod(${a}, ${b ?? "1"})`;
    case "abs":
    case "ceil":
    case "floor":
      return `${e.name}(${a})`;
    case "round":
      return `round((${a})::numeric, ${b ?? "0"})`;
    case "dats_days_between":
      return `(${b ?? "NULL"} - ${a})`;
    case "dats_add_days":
      return `(${a} + (${b ?? "0"})::integer)`;
  }
}

export function renderCondition(c: CdsCondition, sqlType: (t: AbapType) => string, refs: SqlRefs): string {
  const render = (x: CdsExpression): string => renderExpression(x, sqlType, refs);
  switch (c.kind) {
    case "compare": {
      if (c.operator === "like") {
        return `(${text(render(c.left))} LIKE ${render(c.right)})`;
      }
      return `(${operand(c.left, c.right, render)} ${c.operator} ${operand(c.right, c.left, render)})`;
    }
    case "isNull":
      return `(${render(c.operand)} IS ${c.negated ? "NOT " : ""}NULL)`;
    case "and":
    case "or":
      return `(${renderCondition(c.left, sqlType, refs)} ${c.kind.toUpperCase()} ${renderCondition(c.right, sqlType, refs)})`;
    case "not":
      return `(NOT ${renderCondition(c.operand, sqlType, refs)})`;
  }
}

/** A boolean column (ABAP_BOOLEAN) compared with 'X' or '': the literal becomes TRUE or FALSE. */
function operand(e: CdsExpression, other: CdsExpression, render: (x: CdsExpression) => string): string {
  if (other.type.kind === "bool" && e.kind === "literal" && typeof e.value === "string") {
    return e.value.trim() === "" ? "FALSE" : "TRUE";
  }
  return render(e);
}
