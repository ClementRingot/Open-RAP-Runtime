/**
 * Catalog of standard SAP data elements commonly used by RAP business objects.
 *
 * Only the technical type is recorded (name, type, length, decimals): sources exported with
 * abapGit reference these data elements without containing them. Data elements present in the
 * sources (DTEL objects) take precedence over this catalog.
 */

import type { AbapType } from "@rap-transpiler/model";

const t = (kind: AbapType["kind"], length?: number, decimals?: number): Omit<AbapType, "dataElement"> => {
  const type: Omit<AbapType, "dataElement"> = { kind };
  if (length !== undefined) {
    type.length = length;
  }
  if (decimals !== undefined) {
    type.decimals = decimals;
  }
  return type;
};

const CATALOG: Record<string, Omit<AbapType, "dataElement">> = {
  // client
  MANDT: t("clnt", 3),
  // UUIDs
  SYSUUID_X16: t("raw", 16),
  SYSUUID_X: t("raw", 16),
  SYSUUID_C32: t("char", 32),
  SYSUUID_C36: t("char", 36),
  // users
  ABP_CREATION_USER: t("char", 12),
  ABP_LASTCHANGE_USER: t("char", 12),
  ABP_LOCINST_LASTCHANGE_USER: t("char", 12),
  SYUNAME: t("char", 12),
  UNAME: t("char", 12),
  XUBNAME: t("char", 12),
  // time stamps
  ABP_CREATION_TSTMPL: t("timestampl", 21, 7),
  ABP_LASTCHANGE_TSTMPL: t("timestampl", 21, 7),
  ABP_LOCINST_LASTCHANGE_TSTMPL: t("timestampl", 21, 7),
  ABP_CREATION_UTCL: t("utclong"),
  ABP_LASTCHANGE_UTCL: t("utclong"),
  ABP_LOCINST_LASTCHANGE_UTCL: t("utclong"),
  TIMESTAMPL: t("timestampl", 21, 7),
  TZNTSTMPL: t("timestampl", 21, 7),
  TIMESTAMP: t("timestamp", 15),
  TZNTSTMPS: t("timestamp", 15),
  UTCLONG: t("utclong"),
  // dates and times
  DATUM: t("dats", 8),
  DATS: t("dats", 8),
  SYDATUM: t("dats", 8),
  UZEIT: t("tims", 6),
  TIMS: t("tims", 6),
  SYUZEIT: t("tims", 6),
  // booleans and flags
  ABAP_BOOLEAN: t("bool", 1),
  ABAP_BOOL: t("bool", 1),
  XSDBOOLEAN: t("bool", 1),
  BOOLE_D: t("char", 1),
  FLAG: t("char", 1),
  XFELD: t("char", 1),
  // currencies, units, languages, countries
  WAERS: t("cuky", 5),
  WAERS_CURC: t("cuky", 5),
  WAERK: t("cuky", 5),
  MEINS: t("unit", 3),
  MSEHI: t("unit", 3),
  SPRAS: t("lang", 1),
  LANGU: t("lang", 1),
  LAND1: t("char", 3),
  // texts
  STRING: t("string"),
  // the ABAP flight reference scenario (/DMO/), used by many RAP tutorials
  "/DMO/TRAVEL_ID": t("numc", 8),
  "/DMO/AGENCY_ID": t("numc", 6),
  "/DMO/CUSTOMER_ID": t("numc", 6),
  "/DMO/BEGIN_DATE": t("dats", 8),
  "/DMO/END_DATE": t("dats", 8),
  "/DMO/BOOKING_FEE": t("curr", 16, 2),
  "/DMO/TOTAL_PRICE": t("curr", 16, 2),
  "/DMO/CURRENCY_CODE": t("cuky", 5),
  "/DMO/DESCRIPTION": t("char", 1024),
  "/DMO/OVERALL_STATUS": t("char", 1),
  "/DMO/BOOKING_ID": t("numc", 4),
  "/DMO/BOOKING_DATE": t("dats", 8),
  "/DMO/CARRIER_ID": t("char", 3),
  "/DMO/CONNECTION_ID": t("numc", 4),
  "/DMO/FLIGHT_DATE": t("dats", 8),
  "/DMO/FLIGHT_PRICE": t("curr", 16, 2),
  "/DMO/BOOKING_STATUS": t("char", 1),
  "/DMO/SUPPLEMENT_ID": t("char", 10),
  "/DMO/SUPPL_PRICE": t("curr", 16, 2),
};

export function catalogDataElement(name: string): AbapType | undefined {
  const upper = name.toUpperCase();
  const entry = CATALOG[upper];
  return entry === undefined ? undefined : { ...entry, dataElement: upper };
}

/** DDIC data type (DD03P-DATATYPE, DD04V-DATATYPE, DD01V-DATATYPE) → IR type kind. */
export function ddicTypeKind(datatype: string): AbapType["kind"] | undefined {
  switch (datatype.toUpperCase()) {
    case "CHAR":
      return "char";
    case "NUMC":
    case "ACCP":
      return "numc";
    case "STRG":
    case "STRING":
      return "string";
    case "SSTR":
    case "SSTRING":
      return "sstring";
    case "DEC":
      return "dec";
    case "CURR":
      return "curr";
    case "QUAN":
      return "quan";
    case "INT1":
      return "int1";
    case "INT2":
    case "PREC":
      return "int2";
    case "INT4":
      return "int4";
    case "INT8":
      return "int8";
    case "FLTP":
      return "fltp";
    case "D16N":
    case "D16D":
    case "D16R":
    case "D16S":
      return "decfloat16";
    case "D34N":
    case "D34D":
    case "D34R":
    case "D34S":
      return "decfloat34";
    case "DATS":
    case "DATN":
      return "dats";
    case "TIMS":
    case "TIMN":
      return "tims";
    case "UTCL":
    case "UTCLONG":
      return "utclong";
    case "RAW":
      return "raw";
    case "RSTR":
    case "RAWSTRING":
      return "rawstring";
    case "CUKY":
      return "cuky";
    case "UNIT":
      return "unit";
    case "LANG":
      return "lang";
    case "CLNT":
      return "clnt";
    default:
      return undefined;
  }
}

/** Data elements whose DEC type is a time stamp or whose CHAR(1) type is a boolean. */
export function semanticKindOfDataElement(name: string): AbapType["kind"] | undefined {
  return catalogDataElement(name)?.kind;
}

/** `abap.char( 10 )`, `abap.dec(16,2)`, `abap.string`… (abstract entity elements, CAST). */
export function parseBuiltInType(text: string): AbapType | undefined {
  const match = /^abap\.([a-z0-9_]+)(?:\((\d+)(?:,(\d+))?\))?$/i.exec(text.replace(/\s+/g, ""));
  if (match === null) {
    return undefined;
  }
  const name = (match[1] ?? "").toUpperCase();
  const kind = name === "BOOLEAN" ? "bool" : ddicTypeKind(name);
  if (kind === undefined) {
    return undefined;
  }
  const type: AbapType = { kind };
  if (match[2] !== undefined) {
    type.length = Number.parseInt(match[2], 10);
  } else if (kind === "dats") {
    type.length = 8;
  } else if (kind === "tims") {
    type.length = 6;
  }
  if (match[3] !== undefined) {
    type.decimals = Number.parseInt(match[3], 10);
  }
  return type;
}
