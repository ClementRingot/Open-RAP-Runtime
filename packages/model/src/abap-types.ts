/**
 * ABAP dictionary types as the IR sees them, and their mapping to OData (Edm) types.
 *
 * `length` is the DDIC length: characters for character-like types, bytes for RAW,
 * digits for packed numbers (DEC, CURR, QUAN).
 */

export type AbapTypeKind =
  | "char"
  | "numc"
  | "string"
  | "sstring"
  | "dec"
  | "curr"
  | "quan"
  | "int1"
  | "int2"
  | "int4"
  | "int8"
  | "fltp"
  | "decfloat16"
  | "decfloat34"
  | "dats"
  | "tims"
  | "timestamp"
  | "timestampl"
  | "utclong"
  | "raw"
  | "rawstring"
  | "cuky"
  | "unit"
  | "lang"
  | "clnt"
  | "bool";

export interface AbapType {
  kind: AbapTypeKind;
  length?: number;
  decimals?: number;
  /**
   * Data element the type comes from, upper case, when there is one (e.g. SYSUUID_X16); also the
   * CDS simple or enumerated type (D55).
   */
  dataElement?: string;
  /** A CDS enumerated type (D55): its name, upper case (`Model.enumTypes`); the type is its base type. */
  enumType?: string;
}

export type EdmTypeName =
  | "Edm.String"
  | "Edm.Boolean"
  | "Edm.Byte"
  | "Edm.Int16"
  | "Edm.Int32"
  | "Edm.Int64"
  | "Edm.Decimal"
  | "Edm.Double"
  | "Edm.Date"
  | "Edm.TimeOfDay"
  | "Edm.DateTimeOffset"
  | "Edm.Guid"
  | "Edm.Binary";

export interface EdmType {
  type: EdmTypeName;
  maxLength?: number;
  precision?: number;
  scale?: number;
  /** NUMC: the value is a string of digits (Common.IsDigitSequence). */
  digitSequence?: boolean;
  /**
   * Enhanced mode (D55): the property has the OData enumeration type of a CDS enumerated type.
   * `type` stays the Edm type of the base type, the type of the values inside the runtime.
   */
  enum?: EdmEnum;
}

/** An OData enumeration type (D55): members with integral values, each with its CDS base value. */
export interface EdmEnum {
  name: string;
  underlyingType: "Edm.Byte" | "Edm.Int16" | "Edm.Int32";
  members: Array<{ name: string; value: number; base: string | number; label?: string }>;
}

/** RAW(16) is the RAP UUID type (SYSUUID_X16). */
export function isUuid(t: AbapType): boolean {
  return t.kind === "raw" && t.length === 16;
}

export function isTimestamp(t: AbapType): boolean {
  return t.kind === "timestamp" || t.kind === "timestampl" || t.kind === "utclong";
}

export function isCharacterLike(t: AbapType): boolean {
  return ["char", "numc", "string", "sstring", "cuky", "unit", "lang", "clnt"].includes(t.kind);
}

export function isNumeric(t: AbapType): boolean {
  return ["dec", "curr", "quan", "int1", "int2", "int4", "int8", "fltp", "decfloat16", "decfloat34"].includes(t.kind);
}

/** The Edm type a field of this ABAP type is exposed with, following the RAP conventions. */
export function edmTypeOf(t: AbapType): EdmType {
  switch (t.kind) {
    case "char":
    case "sstring":
    case "cuky":
    case "unit":
    case "lang":
    case "clnt":
      return t.length !== undefined ? { type: "Edm.String", maxLength: t.length } : { type: "Edm.String" };
    case "numc":
      return { type: "Edm.String", maxLength: t.length ?? 1, digitSequence: true };
    case "string":
      return { type: "Edm.String" };
    case "bool":
      return { type: "Edm.Boolean" };
    case "int1":
      return { type: "Edm.Byte" };
    case "int2":
      return { type: "Edm.Int16" };
    case "int4":
      return { type: "Edm.Int32" };
    case "int8":
      return { type: "Edm.Int64" };
    case "dec":
    case "curr":
    case "quan":
      return { type: "Edm.Decimal", precision: t.length ?? 16, scale: t.decimals ?? 0 };
    case "decfloat16":
      return { type: "Edm.Decimal", precision: 16 };
    case "decfloat34":
      return { type: "Edm.Decimal", precision: 34 };
    case "fltp":
      return { type: "Edm.Double" };
    case "dats":
      return { type: "Edm.Date" };
    case "tims":
      return { type: "Edm.TimeOfDay" };
    case "timestamp":
      return { type: "Edm.DateTimeOffset", precision: 0 };
    case "timestampl":
    case "utclong":
      return { type: "Edm.DateTimeOffset", precision: 7 };
    case "raw":
      return isUuid(t) ? { type: "Edm.Guid" } : { type: "Edm.Binary", ...(t.length !== undefined ? { maxLength: t.length } : {}) };
    case "rawstring":
      return { type: "Edm.Binary" };
  }
}

/** A short human readable form, used in diagnostics and snapshots: `CHAR(10)`, `DEC(16,2)`. */
export function formatAbapType(t: AbapType): string {
  const base = t.kind.toUpperCase();
  if (t.length === undefined) {
    return base;
  }
  return t.decimals ? `${base}(${t.length},${t.decimals})` : `${base}(${t.length})`;
}
