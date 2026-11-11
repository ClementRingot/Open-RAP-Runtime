/**
 * Canonical values (decision D16) and their conversions to and from SQL, OData JSON and OData
 * URL literals.
 *
 * Canonical forms: strings for character-like types (trailing blanks removed), decimals and INT8;
 * numbers for INT1/2/4 and FLTP; booleans; `YYYY-MM-DD` dates, `HH:MM:SS` times and ISO 8601 UTC
 * time stamps with microseconds, `null` when initial; lower-case UUIDs; upper-case hex binaries.
 */

import { isUuid, type AbapType, type EdmType } from "@rap-transpiler/model";
import { ODataError } from "./odata/errors.js";

export type CanonicalValue = string | number | boolean | null;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}:\d{2}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The initial value of an ABAP type, in canonical form. */
export function initialValue(t: AbapType): CanonicalValue {
  switch (t.kind) {
    case "numc":
      return "0".repeat(t.length ?? 1);
    case "char":
    case "string":
    case "sstring":
    case "cuky":
    case "unit":
    case "lang":
    case "clnt":
      return "";
    case "bool":
      return false;
    case "int1":
    case "int2":
    case "int4":
    case "fltp":
      return 0;
    case "int8":
      return "0";
    case "dec":
    case "curr":
    case "quan":
    case "decfloat16":
    case "decfloat34":
      return t.decimals ? `0.${"0".repeat(t.decimals)}` : "0";
    default:
      return null;
  }
}

export function isInitial(t: AbapType, value: CanonicalValue | undefined): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string" && (t.kind === "dec" || t.kind === "curr" || t.kind === "quan" || t.kind === "int8" || t.kind === "decfloat16" || t.kind === "decfloat34")) {
    return Number(value) === 0;
  }
  if (t.kind === "numc" && typeof value === "string") {
    return /^0*$/.test(value);
  }
  return value === initialValue(t);
}

/** Time stamp from PostgreSQL (`2026-11-09 12:34:56.123456+00`) or ISO input → canonical ISO UTC. */
export function normalizeTimestamp(value: string | Date, precision = 6): string {
  const text = value instanceof Date ? value.toISOString() : value;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(text.trim());
  if (match === null) {
    throw new Error(`invalid time stamp ${text}`);
  }
  const [, date, time, fraction = "", zone = "Z"] = match;
  let utc = new Date(`${date}T${(time as string).length === 5 ? `${time}:00` : time}${normalizeZone(zone)}`);
  if (Number.isNaN(utc.getTime())) {
    throw new Error(`invalid time stamp ${text}`);
  }
  const micros = fraction.padEnd(6, "0").slice(0, 6);
  utc = new Date(utc.getTime());
  const base = utc.toISOString().slice(0, 19);
  return precision === 0 ? `${base}Z` : `${base}.${micros.slice(0, Math.min(precision, 6)).padEnd(Math.min(precision, 6), "0")}Z`;
}

function normalizeZone(zone: string): string {
  if (zone.toUpperCase() === "Z") {
    return "Z";
  }
  const m = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone);
  return m === null ? "Z" : `${m[1]}${m[2]}:${m[3] ?? "00"}`;
}

/** A value read from PostgreSQL → canonical. */
export function fromSql(t: AbapType, value: unknown): CanonicalValue {
  if (value === null || value === undefined) {
    return t.kind === "dats" || t.kind === "tims" || t.kind === "timestamp" || t.kind === "timestampl" || t.kind === "utclong" || t.kind === "raw" || t.kind === "rawstring"
      ? null
      : initialValue(t);
  }
  switch (t.kind) {
    case "char":
    case "sstring":
    case "cuky":
    case "unit":
    case "lang":
    case "clnt":
      return String(value).replace(/\s+$/, "");
    case "numc":
    case "string":
      return String(value);
    case "bool":
      return value === true || value === "t" || value === "true";
    case "int1":
    case "int2":
    case "int4":
    case "fltp":
      return Number(value);
    case "int8":
    case "dec":
    case "curr":
    case "quan":
    case "decfloat16":
    case "decfloat34":
      return String(value);
    case "dats":
      return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    case "tims":
      return String(value).slice(0, 8);
    case "timestamp":
      return normalizeTimestamp(value as string | Date, 0);
    case "timestampl":
    case "utclong":
      return normalizeTimestamp(value as string | Date, 6);
    case "raw":
      if (isUuid(t)) {
        return String(value).toLowerCase();
      }
      return value instanceof Uint8Array ? Buffer.from(value).toString("hex").toUpperCase() : String(value).toUpperCase();
    case "rawstring":
      return value instanceof Uint8Array ? Buffer.from(value).toString("hex").toUpperCase() : String(value).toUpperCase();
  }
}

/** Canonical → a bind parameter for PostgreSQL. */
export function toSql(t: AbapType, value: CanonicalValue): unknown {
  if (value === null) {
    return null;
  }
  if ((t.kind === "raw" && !isUuid(t)) || t.kind === "rawstring") {
    return Buffer.from(String(value), "hex");
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// OData JSON

/** A number written verbatim in the JSON output (decimals and Int64 without IEEE754Compatible). */
export class RawJsonNumber {
  public constructor(public readonly text: string) {}
}

export type JsonValue = string | number | boolean | null | RawJsonNumber | JsonValue[] | { [key: string]: JsonValue };

/** The member of an enumeration type (D55) from its name or its integral value: undefined if none. */
export function enumMember(edm: EdmType, value: unknown): NonNullable<EdmType["enum"]>["members"][number] | undefined {
  const members = edm.enum?.members ?? [];
  if (typeof value === "string") {
    const byName = members.find((m) => m.name.toUpperCase() === value.toUpperCase());
    if (byName !== undefined || !/^-?\d+$/.test(value)) {
      return byName;
    }
  }
  return typeof value === "number" || typeof value === "string" ? members.find((m) => m.value === Number(value)) : undefined;
}

/** Canonical → OData JSON value. */
export function toJson(edm: EdmType, value: CanonicalValue, ieee754: boolean): JsonValue {
  if (value === null) {
    return null;
  }
  if (edm.enum !== undefined) {
    // the member of the base value (D55); a value outside the enumeration is written as is
    const member = edm.enum.members.find((m) => String(m.base) === String(value));
    return member === undefined ? (typeof value === "boolean" ? value : String(value)) : member.name;
  }
  switch (edm.type) {
    case "Edm.Decimal":
    case "Edm.Int64":
      return ieee754 ? String(value) : new RawJsonNumber(String(value));
    case "Edm.DateTimeOffset": {
      const text = String(value);
      const precision = edm.precision ?? 0;
      const [base, fraction = ""] = text.replace(/Z$/, "").split(".");
      return precision === 0 ? `${base}Z` : `${base}.${fraction.padEnd(precision, "0").slice(0, precision)}Z`;
    }
    case "Edm.Binary":
      return Buffer.from(String(value), "hex").toString("base64url");
    case "Edm.Byte":
    case "Edm.Int16":
    case "Edm.Int32":
    case "Edm.Double":
      return Number(value);
    default:
      return value;
  }
}

/** OData JSON value of a request body → canonical, with type checks. */
export function fromJson(t: AbapType, edm: EdmType, value: unknown, property: string): CanonicalValue {
  const bad = (expected: string): ODataError =>
    new ODataError(400, "INVALID_VALUE", `Property ${property}: ${JSON.stringify(value)} is not a valid ${expected}`, property);
  if (edm.enum !== undefined && value !== null && value !== undefined) {
    const member = enumMember(edm, value);
    if (member === undefined) {
      throw new ODataError(400, "INVALID_VALUE", `Property ${property}: ${JSON.stringify(value)} is not a member of ${edm.enum.name} (${edm.enum.members.map((m) => m.name).join(", ")})`, property);
    }
    return member.base;
  }
  if (edm.enum !== undefined && value !== null && value !== undefined) {
    const member = enumMember(edm, value);
    if (member === undefined) {
      throw new ODataError(400, "INVALID_VALUE", `Property ${property}: ${JSON.stringify(value)} is not a member of ${edm.enum.name} (${edm.enum.members.map((m) => m.name).join(", ")})`, property);
    }
    return member.base;
  }
  if (value === null || value === undefined) {
    return t.kind === "dats" || t.kind === "tims" || t.kind === "timestamp" || t.kind === "timestampl" || t.kind === "utclong" || t.kind === "raw" || t.kind === "rawstring"
      ? null
      : initialValue(t);
  }
  switch (edm.type) {
    case "Edm.String": {
      if (typeof value !== "string") throw bad("string");
      if (edm.maxLength !== undefined && value.length > edm.maxLength) {
        throw new ODataError(400, "VALUE_TOO_LONG", `Property ${property}: the value exceeds ${edm.maxLength} characters`, property);
      }
      if (edm.digitSequence === true) {
        if (!/^\d*$/.test(value)) throw bad("digit sequence");
        return value === "" ? initialValue(t) : value.padStart(edm.maxLength ?? value.length, "0");
      }
      return t.kind === "string" ? value : value.replace(/\s+$/, "");
    }
    case "Edm.Boolean":
      if (typeof value !== "boolean") throw bad("boolean");
      return value;
    case "Edm.Byte":
    case "Edm.Int16":
    case "Edm.Int32": {
      const n = typeof value === "string" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isInteger(n)) throw bad("integer");
      return n;
    }
    case "Edm.Int64":
      if ((typeof value !== "string" && typeof value !== "number") || !/^-?\d+$/.test(String(value))) throw bad("Int64");
      return String(value);
    case "Edm.Decimal": {
      if ((typeof value !== "string" && typeof value !== "number") || !/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(String(value))) throw bad("decimal");
      return normalizeDecimal(String(value), edm.scale, property);
    }
    case "Edm.Double":
      if (typeof value !== "number" && !(typeof value === "string" && !Number.isNaN(Number(value)))) throw bad("number");
      return Number(value);
    case "Edm.Date":
      if (typeof value !== "string" || !DATE.test(value)) throw bad("date (YYYY-MM-DD)");
      return value;
    case "Edm.TimeOfDay":
      if (typeof value !== "string" || !/^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)) throw bad("time of day (HH:MM:SS)");
      return value.length === 5 ? `${value}:00` : value.slice(0, 8);
    case "Edm.DateTimeOffset":
      if (typeof value !== "string") throw bad("date-time offset");
      try {
        return normalizeTimestamp(value, edm.precision === 0 ? 0 : 6);
      } catch {
        throw bad("date-time offset");
      }
    case "Edm.Guid":
      if (typeof value !== "string" || !GUID.test(value)) throw bad("GUID");
      return value.toLowerCase();
    case "Edm.Binary":
      if (typeof value !== "string") throw bad("base64 binary");
      return Buffer.from(value, "base64url").toString("hex").toUpperCase();
  }
}

/** Rounds a decimal to the scale of the field, half away from zero, as ABAP assigns. */
export function normalizeDecimal(text: string, scale: number | undefined, property = ""): string {
  if (scale === undefined) {
    return String(Number(text)) === text ? text : text;
  }
  let value: string = text;
  if (/[eE]/.test(value)) {
    value = Number(value).toFixed(scale);
  }
  const negative = value.startsWith("-");
  const [intPart = "0", fracPart = ""] = (negative ? value.slice(1) : value).split(".");
  if (fracPart.length <= scale) {
    const result = scale === 0 ? intPart : `${intPart}.${fracPart.padEnd(scale, "0")}`;
    return negative && Number(result) !== 0 ? `-${result}` : result;
  }
  const digits = BigInt(`${intPart}${fracPart.slice(0, scale)}`) + (Number(fracPart[scale]) >= 5 ? 1n : 0n);
  const s = digits.toString().padStart(scale + 1, "0");
  const result = scale === 0 ? s : `${s.slice(0, -scale)}.${s.slice(-scale)}`;
  void property;
  return negative && Number(result) !== 0 ? `-${result}` : result;
}

/** A literal of the URL ($filter, key predicates), already typed by the parser, → canonical for a property. */
export interface UrlLiteral {
  /** `enum`: `Namespace.Type'MEMBER'`, the value is the member (D55). */
  type: "string" | "int" | "decimal" | "date" | "datetime" | "time" | "guid" | "bool" | "null" | "enum";
  value: string | boolean | null;
}

export function literalToCanonical(t: AbapType, edm: EdmType, literal: UrlLiteral, property: string): CanonicalValue {
  const bad = (): ODataError =>
    new ODataError(400, "INVALID_LITERAL", `${property}: the literal ${literal.type === "string" ? `'${String(literal.value)}'` : String(literal.value)} does not match the type ${edm.type}`);
  if (literal.type === "null") {
    return null;
  }
  if (edm.enum !== undefined) {
    // Namespace.Type'MEMBER', 'MEMBER' or the integral value (D55)
    const member = literal.type === "string" || literal.type === "enum" || literal.type === "int" ? enumMember(edm, literal.value) : undefined;
    if (member === undefined) {
      throw new ODataError(400, "INVALID_LITERAL", `${property}: ${String(literal.value)} is not a member of ${edm.enum.name}`);
    }
    return member.base;
  }
  if (literal.type === "enum") {
    throw bad();
  }
  switch (edm.type) {
    case "Edm.String":
      if (literal.type !== "string") throw bad();
      return edm.digitSequence === true && /^\d+$/.test(String(literal.value)) ? String(literal.value).padStart(edm.maxLength ?? 0, "0") : String(literal.value);
    case "Edm.Guid":
      if (literal.type !== "guid" && !(literal.type === "string" && GUID.test(String(literal.value)))) throw bad();
      return String(literal.value).toLowerCase();
    case "Edm.Date":
      if (literal.type !== "date") throw bad();
      return String(literal.value);
    case "Edm.TimeOfDay":
      if (literal.type !== "time") throw bad();
      return String(literal.value).slice(0, 8).padEnd(8, ":00");
    case "Edm.DateTimeOffset":
      if (literal.type !== "datetime" && literal.type !== "date") throw bad();
      return normalizeTimestamp(literal.type === "date" ? `${String(literal.value)}T00:00:00Z` : String(literal.value), 6);
    case "Edm.Boolean":
      if (literal.type !== "bool") throw bad();
      return literal.value as boolean;
    case "Edm.Byte":
    case "Edm.Int16":
    case "Edm.Int32":
      if (literal.type !== "int") throw bad();
      return Number(literal.value);
    case "Edm.Int64":
      if (literal.type !== "int") throw bad();
      return String(literal.value);
    case "Edm.Decimal":
    case "Edm.Double":
      if (literal.type !== "int" && literal.type !== "decimal") throw bad();
      return edm.type === "Edm.Double" ? Number(literal.value) : String(literal.value);
    case "Edm.Binary":
      throw bad();
  }
  void t;
  return null;
}

export function isTimeValue(value: string): boolean {
  return TIME.test(value);
}
