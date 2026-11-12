/**
 * Conversions between canonical values (D16) and the data objects of @abaplint/runtime, used by
 * the EML kernel and the handler calls. The ABAP data objects are those of the transpiled code:
 * they are reached through the global `abap` object set by the generated `init.mjs`.
 */

import { isUuid, type AbapType } from "@open-rap-runtime/model";
import type { CanonicalValue } from "../values.js";

/** A data object of @abaplint/runtime (structure, table, elementary value). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AbapData = any;

/** The global ABAP runtime of the transpiled code. */
export function abapGlobal(): AbapData {
  const abap = (globalThis as { abap?: unknown }).abap;
  if (abap === undefined) {
    throw new Error("the ABAP runtime is not loaded (abap/init.mjs)");
  }
  return abap;
}

const DIGITS = /^\d+$/;

function uuidToHex(value: string): string {
  return value.replace(/-/g, "").toUpperCase();
}

function hexToUuid(hex: string): string {
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** ISO time stamp (canonical) → ABAP `YYYYMMDDhhmmss[.fffffff]`. */
function isoToAbapTimestamp(value: string, decimals: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z?$/.exec(value);
  if (m === null) {
    throw new Error(`invalid canonical time stamp ${value}`);
  }
  const base = `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}`;
  return decimals === 0 ? base : `${base}.${(m[7] ?? "").padEnd(decimals, "0").slice(0, decimals)}`;
}

/** ABAP time stamp digits (`20261109123456.1234567`) → canonical ISO (microseconds), null when initial. */
function abapTimestampToIso(text: string, precision: number): string | null {
  const [whole = "", fraction = ""] = text.replace(/^-/, "").split(".");
  if (/^0*$/.test(whole) && /^0*$/.test(fraction)) {
    return null;
  }
  const digits = whole.padStart(14, "0");
  const base = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}`;
  return precision === 0 ? `${base}Z` : `${base}.${fraction.padEnd(6, "0").slice(0, 6)}Z`;
}

/** Sets an ABAP data object from a canonical value. */
export function setAbapValue(target: AbapData, t: AbapType, value: CanonicalValue | undefined): void {
  if (value === undefined || value === null) {
    target.clear();
    return;
  }
  switch (t.kind) {
    case "char":
    case "sstring":
    case "string":
    case "cuky":
    case "unit":
    case "lang":
    case "clnt":
      target.set(String(value));
      return;
    case "numc":
      target.set(String(value));
      return;
    case "bool":
      target.set(value === true || value === "X" ? "X" : "");
      return;
    case "dec":
    case "curr":
    case "quan":
    case "decfloat16":
    case "decfloat34":
      target.set(String(value));
      return;
    case "int1":
    case "int2":
    case "int4":
    case "fltp":
      target.set(Number(value));
      return;
    case "int8":
      target.set(BigInt(String(value)));
      return;
    case "dats":
      target.set(String(value).replace(/-/g, ""));
      return;
    case "tims":
      target.set(String(value).replace(/:/g, ""));
      return;
    case "timestamp":
      target.set(isoToAbapTimestamp(String(value), 0));
      return;
    case "timestampl":
      target.set(isoToAbapTimestamp(String(value), 7));
      return;
    case "utclong":
      target.set(String(value).replace(/Z$/, ""));
      return;
    case "raw":
      target.set(isUuid(t) ? uuidToHex(String(value)) : String(value).toUpperCase());
      return;
    case "rawstring":
      target.set(String(value).toUpperCase());
      return;
  }
}

/** Reads an ABAP data object as a canonical value. */
export function getAbapValue(source: AbapData, t: AbapType): CanonicalValue {
  switch (t.kind) {
    case "char":
    case "sstring":
    case "cuky":
    case "unit":
    case "lang":
    case "clnt":
      return String(source.get()).replace(/\s+$/, "");
    case "string":
      return String(source.get());
    case "numc":
      return String(source.get());
    case "bool":
      return String(source.get()).trim() !== "";
    case "dec":
    case "curr":
    case "quan":
      return typeof source.toFixed === "function" ? source.toFixed(t.decimals ?? 0) : String(source.get());
    case "decfloat16":
    case "decfloat34":
      return typeof source.toText === "function" ? source.toText() : String(source.get());
    case "int1":
    case "int2":
    case "int4":
    case "fltp":
      return Number(source.get());
    case "int8":
      return String(source.get());
    case "dats": {
      const d = String(source.get());
      return DIGITS.test(d) && !/^0+$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
    }
    case "tims": {
      const d = String(source.get()).padEnd(6, "0");
      return `${d.slice(0, 2)}:${d.slice(2, 4)}:${d.slice(4, 6)}`;
    }
    case "timestamp":
      return abapTimestampToIso(typeof source.toFixed === "function" ? source.toFixed(0) : String(source.get()), 0);
    case "timestampl":
      return abapTimestampToIso(typeof source.toFixed === "function" ? source.toFixed(7) : String(source.get()), 6);
    case "utclong": {
      const text = String(source.get());
      return text === "" ? null : `${text.slice(0, 26)}Z`;
    }
    case "raw": {
      const hex = String(source.get()).toUpperCase();
      if (/^0*$/.test(hex)) {
        return null;
      }
      return isUuid(t) ? hexToUuid(hex) : hex;
    }
    case "rawstring": {
      const hex = String(source.get()).toUpperCase();
      return hex === "" ? null : hex;
    }
  }
}

/** A component of an ABAP structure (component names are lower case). */
export function component(structure: AbapData, name: string): AbapData | undefined {
  return structure.get()[name.toLowerCase()];
}

/** The rows of an ABAP internal table. */
export function rowsOf(table: AbapData): AbapData[] {
  return table === undefined ? [] : (table.array() as AbapData[]);
}

/** Appends a new row (a copy of the row type) filled by `fill`. */
export function appendRow(table: AbapData, fill: (row: AbapData) => void): void {
  const row = table.getRowType().clone();
  fill(row);
  table.append(row);
}

/** `'01'` (if_abap_behv=>mk-on) and other flags of the derived types. */
export function isFlagOn(value: AbapData | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const v = String(value.get()).trim();
  return v !== "" && !/^0+$/.test(v);
}

export function setFlag(target: AbapData | undefined, on: boolean): void {
  target?.set(on ? "01" : "00");
}

/** A string, ABAP string or character data object as a JavaScript string. */
export function abapString(value: AbapData | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return String(value.get()).replace(/\s+$/, "");
}
