/**
 * The kernel side of the clean-room utilities of ABAP Cloud (decision D40): JSON (/ui2/cl_json,
 * xco_cp_json), code pages and encodings, gzip, hashes, random seeds, regular expressions, date
 * and time stamp arithmetic, number ranges and the application log (in the database of the
 * application, in the LUW of the request), and the description of data objects for the RTTS.
 */

import { createHash, createHmac, getHashes, randomInt } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { sql, type Kysely } from "kysely";
import { abapGlobal, abapString, appendRow, rowsOf, type AbapData } from "./convert.js";
import { raise } from "./http.js";

type Input = Record<string, AbapData> | undefined;

export interface UtilityServices {
  /** The database of the LUW of the running ABAP code. */
  db(): Kysely<unknown>;
  /** The ABAP name of the user of the LUW. */
  user(): string;
}

// ------------------------------------------------------------------------------ data objects

/** The data object behind field symbols. */
function deref(value: AbapData): AbapData {
  const { types } = abapGlobal();
  let current = value;
  while (current instanceof types.FieldSymbol) {
    current = current.getPointer();
  }
  return current;
}

const BOOLEAN_TYPES = new Set(["ABAP_BOOL", "ABAP_BOOLEAN", "BOOLEAN", "BOOLE_D", "XFELD", "XSDBOOLEAN", "FLAG", "OS_BOOLEAN", "SAP_BOOL"]);
const TIMESTAMP_TYPES = new Set(["TIMESTAMP", "TIMESTAMPL", "TZNTSTMPS", "TZNTSTMPL", "ABP_CREATION_TSTMPL", "ABP_LASTCHANGE_TSTMPL", "ABP_LOCINST_LASTCHANGE_TSTMPL"]);

function qualified(value: AbapData): string {
  const name = typeof value?.getQualifiedName === "function" ? value.getQualifiedName() : undefined;
  return typeof name === "string" ? name.toUpperCase() : "";
}

function isTable(value: AbapData): boolean {
  const { types } = abapGlobal();
  return value instanceof types.Table || (types.HashedTable !== undefined && value instanceof types.HashedTable) || typeof value?.array === "function";
}

function packedText(value: AbapData): string {
  return typeof value.toFixed === "function" ? value.toFixed(value.getDecimals()) : String(value.get());
}

function charText(value: AbapData): string {
  return String(value.get()).replace(/\s+$/, "");
}

// ------------------------------------------------------------------------------ JSON

type JsonNode =
  | { t: "o"; m: Array<[string, JsonNode]> }
  | { t: "a"; v: JsonNode[] }
  | { t: "s"; v: string }
  | { t: "n"; v: string }
  | { t: "b"; v: boolean }
  | { t: "z" };

/** A JSON parser that keeps the numbers as written (no rounding through doubles). */
export function parseJson(text: string): JsonNode {
  let i = 0;
  const fail = (what: string): never => {
    throw new Error(`invalid JSON at ${i}: ${what}`);
  };
  const space = (): void => {
    while (i < text.length && /\s/.test(text[i] ?? "")) i++;
  };
  const value = (): JsonNode => {
    space();
    const c = text[i];
    if (c === "{") {
      i++;
      const m: Array<[string, JsonNode]> = [];
      space();
      if (text[i] === "}") {
        i++;
        return { t: "o", m };
      }
      for (;;) {
        space();
        if (text[i] !== '"') fail("member name expected");
        const key = string();
        space();
        if (text[i] !== ":") fail("':' expected");
        i++;
        m.push([key, value()]);
        space();
        if (text[i] === ",") {
          i++;
        } else if (text[i] === "}") {
          i++;
          return { t: "o", m };
        } else {
          fail("',' or '}' expected");
        }
      }
    }
    if (c === "[") {
      i++;
      const v: JsonNode[] = [];
      space();
      if (text[i] === "]") {
        i++;
        return { t: "a", v };
      }
      for (;;) {
        v.push(value());
        space();
        if (text[i] === ",") {
          i++;
        } else if (text[i] === "]") {
          i++;
          return { t: "a", v };
        } else {
          fail("',' or ']' expected");
        }
      }
    }
    if (c === '"') {
      return { t: "s", v: string() };
    }
    const literal = /^(true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (literal === null) {
      return fail("value expected");
    }
    i += literal[0].length;
    const word = literal[0];
    return word === "true" ? { t: "b", v: true } : word === "false" ? { t: "b", v: false } : word === "null" ? { t: "z" } : { t: "n", v: word };
  };
  const string = (): string => {
    const start = i;
    i++;
    let escaped = false;
    for (; i < text.length; i++) {
      if (escaped) {
        escaped = false;
      } else if (text[i] === "\\") {
        escaped = true;
      } else if (text[i] === '"') {
        i++;
        return JSON.parse(text.slice(start, i)) as string;
      }
    }
    return fail("unterminated string");
  };
  const result = value();
  space();
  if (i < text.length) fail("end expected");
  return result;
}

export function writeJson(node: JsonNode, indent = false, level = 0): string {
  const pad = (n: number): string => (indent ? `\n${"  ".repeat(n)}` : "");
  switch (node.t) {
    case "o":
      return node.m.length === 0 ? "{}" : `{${node.m.map(([k, v]) => `${pad(level + 1)}${JSON.stringify(k)}:${indent ? " " : ""}${writeJson(v, indent, level + 1)}`).join(",")}${pad(level)}}`;
    case "a":
      return node.v.length === 0 ? "[]" : `[${node.v.map((v) => `${pad(level + 1)}${writeJson(v, indent, level + 1)}`).join(",")}${pad(level)}]`;
    case "s":
      return JSON.stringify(node.v);
    case "n":
      return node.v;
    case "b":
      return node.v ? "true" : "false";
    case "z":
      return "null";
  }
}

/** ABAP component name → JSON member name, for a pretty mode of /ui2/cl_json (or xco). */
export function jsonName(abap: string, mode: string, mappings: Map<string, string>): string {
  const mapped = mappings.get(abap.toUpperCase());
  if (mapped !== undefined && (mode === "U" || mode === "C" || mode === "")) {
    return mapped;
  }
  const camel = (name: string): string => name.toLowerCase().replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
  switch (mode) {
    case "L":
    case "C":
      return abap.toLowerCase();
    case "X":
    case "U":
      return camel(abap);
    case "Y":
      // extended: like camel case, "__" keeps one underscore, "___" gives a dot
      return abap
        .toLowerCase()
        .split("___")
        .map((part) => part.split("__").map(camel).join("_"))
        .join(".");
    default:
      return abap.toUpperCase();
  }
}

function parseMappings(text: string): Map<string, string> {
  const mappings = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [abap, json] = line.split("\t");
    if (abap !== undefined && abap.trim() !== "" && json !== undefined) {
      mappings.set(abap.trim().toUpperCase(), json);
    }
  }
  return mappings;
}

interface SerializeOptions {
  mode: string;
  compress: boolean;
  numcAsString: boolean;
  tsAsIso: boolean;
  hexAsBase64: boolean;
  booleans: boolean;
  mappings: Map<string, string>;
}

function isoOfDigits(digits: string, fraction: string): string {
  const d = digits.padStart(14, "0");
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:${d.slice(10, 12)}:${d.slice(12, 14)}${fraction === "" ? "" : `.${fraction}`}Z`;
}

/** An ABAP data object as a JSON node; undefined to leave out (compress). */
function toJson(input: AbapData, options: SerializeOptions): JsonNode | undefined {
  const { types } = abapGlobal();
  const value = deref(input);
  if (value === undefined || value === null) {
    return { t: "z" };
  }
  if (value instanceof types.Structure) {
    const m: Array<[string, JsonNode]> = [];
    for (const [name, component] of Object.entries(value.get() as Record<string, AbapData>)) {
      const node = toJson(component, options);
      if (node !== undefined) {
        m.push([jsonName(name, options.mode, options.mappings), node]);
      }
    }
    return options.compress && m.length === 0 ? undefined : { t: "o", m };
  }
  if (isTable(value)) {
    const v = rowsOf(value).map((row): JsonNode => toJson(row, options) ?? { t: "o", m: [] });
    return options.compress && v.length === 0 ? undefined : { t: "a", v };
  }
  if (value instanceof types.DataReference) {
    const target = value.getPointer();
    return target === undefined ? (options.compress ? undefined : { t: "z" }) : toJson(target, options);
  }
  if (value instanceof types.ABAPObject) {
    return options.compress ? undefined : { t: "z" };
  }
  const omit = (initial: boolean): boolean => options.compress && initial;
  if (value instanceof types.Character) {
    const text = charText(value);
    if (options.booleans && value.getLength() === 1 && BOOLEAN_TYPES.has(qualified(value))) {
      return omit(text === "") ? undefined : { t: "b", v: text !== "" };
    }
    return omit(text === "") ? undefined : { t: "s", v: text };
  }
  if (value instanceof types.String) {
    const text = String(value.get());
    return omit(text === "") ? undefined : { t: "s", v: text };
  }
  if (value instanceof types.Numc) {
    const text = String(value.get());
    if (omit(/^0*$/.test(text))) return undefined;
    return options.numcAsString ? { t: "s", v: text } : { t: "n", v: String(BigInt(text === "" ? "0" : text)) };
  }
  if (value instanceof types.Date) {
    const d = String(value.get());
    const initial = /^0*$/.test(d) || d.trim() === "";
    return omit(initial) ? undefined : { t: "s", v: initial ? "" : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` };
  }
  if (value instanceof types.Time) {
    const t = String(value.get()).padEnd(6, "0");
    return omit(/^0*$/.test(t)) ? undefined : { t: "s", v: `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}` };
  }
  if (value instanceof types.Packed) {
    const text = packedText(value);
    if (omit(/^-?[0.]*$/.test(text))) return undefined;
    if (options.tsAsIso && TIMESTAMP_TYPES.has(qualified(value))) {
      const [whole = "", fraction = ""] = text.split(".");
      return /^0*$/.test(whole) ? { t: "s", v: "" } : { t: "s", v: isoOfDigits(whole, fraction) };
    }
    return { t: "n", v: text };
  }
  if (value instanceof types.Integer || value instanceof types.Integer8 || value instanceof types.Float) {
    const text = String(value.get());
    return omit(text === "0") ? undefined : { t: "n", v: text };
  }
  if (types.DecFloat34 !== undefined && value instanceof types.DecFloat34) {
    const text = typeof value.toText === "function" ? value.toText() : String(value.get());
    return omit(Number(text) === 0) ? undefined : { t: "n", v: text };
  }
  if (value instanceof types.Hex || value instanceof types.XString) {
    const hex = String(value.get());
    if (omit(hex === "" || /^0*$/.test(hex))) return undefined;
    return { t: "s", v: options.hexAsBase64 ? Buffer.from(hex, "hex").toString("base64") : hex };
  }
  if (value instanceof types.UTCLong) {
    const text = String(value.get()).trim();
    return omit(text === "") ? undefined : { t: "s", v: text === "" ? "" : `${text.replace(" ", "T")}Z` };
  }
  const text = String(value.get?.() ?? "");
  return omit(text === "") ? undefined : { t: "s", v: text };
}

function normalizedName(name: string): string {
  return name.toLowerCase().replace(/[_\-.]/g, "");
}

/** Fills an ABAP data object from a JSON node. */
function fromJson(target: AbapData, node: JsonNode, options: { mode: string; hexAsBase64: boolean; mappings: Map<string, string> }): void {
  const { types } = abapGlobal();
  const value = deref(target);
  if (value === undefined || node.t === "z") {
    value?.clear?.();
    return;
  }
  if (value instanceof types.Structure) {
    if (node.t !== "o") return;
    const byName = new Map(node.m);
    const byNormalized = new Map(node.m.map(([k, v]) => [normalizedName(k), v]));
    for (const [name, component] of Object.entries(value.get() as Record<string, AbapData>)) {
      const found = byName.get(jsonName(name, options.mode, options.mappings)) ?? byName.get(name) ?? byNormalized.get(normalizedName(name));
      if (found !== undefined) {
        fromJson(component, found, options);
      }
    }
    return;
  }
  if (isTable(value)) {
    value.clear();
    const elements = node.t === "a" ? node.v : node.t === "o" ? node.m.map(([, v]) => v) : [node];
    for (const element of elements) {
      appendRow(value, (row) => fromJson(row, element, options));
    }
    return;
  }
  if (value instanceof types.DataReference || value instanceof types.ABAPObject) {
    return;
  }
  const text = node.t === "s" || node.t === "n" ? node.v : node.t === "b" ? (node.v ? "X" : "") : writeJson(node);
  if (value instanceof types.Date) {
    value.set(text === "" ? "00000000" : text.replace(/-/g, "").slice(0, 8));
  } else if (value instanceof types.Time) {
    value.set(text === "" ? "000000" : text.replace(/:/g, "").slice(0, 6));
  } else if (value instanceof types.Packed) {
    if (node.t === "s" && /^\d{4}-\d{2}-\d{2}T/.test(text)) {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(text);
      value.set(m === null ? "0" : `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}${m[7] === undefined ? "" : `.${m[7]}`}`);
    } else {
      value.set(text === "" ? "0" : text);
    }
  } else if (value instanceof types.Integer || value instanceof types.Float) {
    value.set(text === "" ? 0 : Number(text));
  } else if (value instanceof types.Integer8) {
    value.set(BigInt(text === "" ? "0" : text.split(".")[0] ?? "0"));
  } else if (value instanceof types.Hex || value instanceof types.XString) {
    value.set(options.hexAsBase64 && node.t === "s" ? Buffer.from(text, "base64").toString("hex").toUpperCase() : text.toUpperCase());
  } else if (value instanceof types.UTCLong) {
    value.set(text.replace("T", " ").replace(/Z$/, ""));
  } else if (value instanceof types.Numc) {
    value.set(text.split(".")[0] ?? "");
  } else {
    value.set(text);
  }
}

/** The member names of a JSON node, transformed (xco_cp_json transformations). */
function transform(node: JsonNode, kinds: string[]): JsonNode {
  const name = (key: string): string => {
    let result = key;
    for (const kind of kinds) {
      switch (kind) {
        case "camel_case_to_underscore":
        case "pascal_case_to_underscore":
          result = result
            .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
            .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
            .toUpperCase();
          break;
        case "underscore_to_camel_case":
          result = result.toLowerCase().replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
          break;
        case "underscore_to_pascal_case":
          result = result.toLowerCase().replace(/(^|_+)([a-z0-9])/g, (_m, _u, c: string) => c.toUpperCase());
          break;
      }
    }
    return result;
  };
  const booleans = kinds.includes("boolean_to_abap_bool");
  const abapBools = kinds.includes("abap_bool_to_boolean");
  const walk = (n: JsonNode): JsonNode => {
    switch (n.t) {
      case "o":
        return { t: "o", m: n.m.map(([k, v]) => [name(k), walk(v)]) };
      case "a":
        return { t: "a", v: n.v.map(walk) };
      case "b":
        return booleans ? { t: "s", v: n.v ? "X" : "" } : n;
      case "s":
        return abapBools && (n.v === "X" || n.v === "") ? { t: "b", v: n.v === "X" } : n;
      default:
        return n;
    }
  };
  return walk(node);
}

// ------------------------------------------------------------------------------ code pages

type CodePage = "utf8" | "utf16le" | "utf16be" | "latin1" | "ascii" | "windows-1252";

export function codePage(name: string): CodePage | undefined {
  const key = name.trim().toUpperCase().replace(/[-_\s]/g, "");
  const pages: Record<string, CodePage> = {
    UTF8: "utf8",
    "4110": "utf8",
    UTF16: "utf16le",
    UTF16LE: "utf16le",
    "4103": "utf16le",
    UTF16BE: "utf16be",
    "4102": "utf16be",
    ISO88591: "latin1",
    LATIN1: "latin1",
    "1100": "latin1",
    ISO885915: "latin1",
    "1160": "windows-1252",
    WINDOWS1252: "windows-1252",
    CP1252: "windows-1252",
    USASCII: "ascii",
    ASCII: "ascii",
  };
  return pages[key];
}

async function encode(text: string, page: CodePage): Promise<Buffer> {
  switch (page) {
    case "utf8":
      return Buffer.from(text, "utf8");
    case "utf16le":
      return Buffer.from(text, "utf16le");
    case "utf16be":
      return Buffer.from(text, "utf16le").swap16();
    case "ascii":
    case "latin1":
    case "windows-1252": {
      const limit = page === "ascii" ? 0x7f : 0xff;
      const bad = [...text].find((c) => (c.codePointAt(0) ?? 0) > limit);
      if (bad !== undefined) {
        return raise("cx_sy_conversion_codepage", `the character ${JSON.stringify(bad)} has no representation in the code page ${page}`);
      }
      return Buffer.from(text, "latin1");
    }
  }
}

async function decode(bytes: Buffer, page: CodePage): Promise<string> {
  try {
    switch (page) {
      case "utf8":
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      case "utf16le":
        return bytes.toString("utf16le");
      case "utf16be":
        return Buffer.from(bytes).swap16().toString("utf16le");
      case "ascii":
      case "latin1":
        return bytes.toString("latin1");
      case "windows-1252":
        return new TextDecoder("windows-1252").decode(bytes);
    }
  } catch (e) {
    return raise("cx_sy_conversion_codepage", `the bytes are not valid ${page}: ${(e as Error).message}`);
  }
}

// ------------------------------------------------------------------------------ regular expressions

/** An ABAP pattern as a JavaScript one: extended mode (x) strips spaces and comments. */
function regExp(pattern: string, flags: string, global = true): RegExp {
  let source = pattern;
  if (flags.includes("x")) {
    let out = "";
    let inClass = false;
    for (let i = 0; i < source.length; i++) {
      const c = source[i] ?? "";
      if (c === "\\") {
        out += c + (source[i + 1] ?? "");
        i++;
      } else if (inClass) {
        if (c === "]") inClass = false;
        out += c;
      } else if (c === "[") {
        inClass = true;
        out += c;
      } else if (c === "#") {
        while (i < source.length && source[i] !== "\n") i++;
      } else if (!/\s/.test(c)) {
        out += c;
      }
    }
    source = out;
  }
  if (!flags.includes("p")) {
    // POSIX classes and word boundaries of the ABAP (POSIX) syntax
    source = source
      .replace(/\[:alpha:\]/g, "A-Za-z")
      .replace(/\[:digit:\]/g, "0-9")
      .replace(/\[:alnum:\]/g, "A-Za-z0-9")
      .replace(/\[:upper:\]/g, "A-Z")
      .replace(/\[:lower:\]/g, "a-z")
      .replace(/\[:space:\]/g, "\\s")
      .replace(/\[:punct:\]/g, "!-\\/:-@\\[-`{-~")
      .replace(/\\</g, "\\b(?=\\w)")
      .replace(/\\>/g, "\\b(?<=\\w)");
  }
  return new RegExp(source, `${global ? "g" : ""}d${flags.includes("i") ? "i" : ""}${flags.includes("m") ? "m" : ""}${flags.includes("s") ? "s" : ""}`);
}

async function compile(pattern: string, flags: string): Promise<RegExp> {
  try {
    return regExp(pattern, flags);
  } catch (e) {
    return raise("cx_sy_regex", `invalid regular expression ${pattern}: ${(e as Error).message}`);
  }
}

// ------------------------------------------------------------------------------ dates and time stamps

const TICKS_PER_SECOND = 10_000_000n;

/** `YYYYMMDDhhmmss[.fffffff]` → ticks (100 ns) since 1970-01-01, through the proleptic calendar of Date. */
function tstmpTicks(text: string): bigint {
  const [whole = "0", fraction = ""] = text.trim().replace(/^-/, "").split(".");
  const d = whole.padStart(14, "0");
  const date = new Date(0);
  date.setUTCFullYear(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
  date.setUTCHours(Number(d.slice(8, 10)), Number(d.slice(10, 12)), Number(d.slice(12, 14)), 0);
  const seconds = BigInt(Math.floor(date.getTime() / 1000));
  return seconds * TICKS_PER_SECOND + BigInt(fraction.padEnd(7, "0").slice(0, 7) || "0");
}

function ticksTstmp(ticks: bigint, decimals = 7): string {
  let seconds = ticks / TICKS_PER_SECOND;
  let fraction = ticks % TICKS_PER_SECOND;
  if (fraction < 0n) {
    fraction += TICKS_PER_SECOND;
    seconds -= 1n;
  }
  const date = new Date(Number(seconds) * 1000);
  const pad = (n: number, l = 2): string => String(n).padStart(l, "0");
  const digits = `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return decimals === 0 ? digits : `${digits}.${fraction.toString().padStart(7, "0").slice(0, decimals)}`;
}

/** Seconds as a decimal text → ticks. */
function secondsTicks(text: string): bigint {
  const t = text.trim().replace(/E\+?0*$/i, "");
  const negative = t.startsWith("-");
  const [whole = "0", fraction = ""] = t.replace(/^[-+]/, "").split(".");
  const ticks = BigInt(whole === "" ? "0" : whole) * TICKS_PER_SECOND + BigInt(fraction.padEnd(7, "0").slice(0, 7) || "0");
  return negative ? -ticks : ticks;
}

function ticksSeconds(ticks: bigint): string {
  const negative = ticks < 0n;
  const abs = negative ? -ticks : ticks;
  return `${negative ? "-" : ""}${abs / TICKS_PER_SECOND}.${(abs % TICKS_PER_SECOND).toString().padStart(7, "0")}`;
}

/** Adds years and months (the day clamped to the end of the month), then days. */
function addCalendar(year: number, month: number, day: number, years: number, months: number, days: number): Date {
  const total = year * 12 + (month - 1) + years * 12 + months;
  const y = Math.floor(total / 12);
  const m = total - y * 12;
  const last = new Date(Date.UTC(2000, m + 1, 0));
  last.setUTCFullYear(y, m + 1, 0);
  const date = new Date(0);
  date.setUTCFullYear(y, m, Math.min(day, last.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
const dateDigits = (d: Date): string => `${String(d.getUTCFullYear()).padStart(4, "0")}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;

function utclongText(ticks: bigint): string {
  const t = ticksTstmp(ticks);
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}.${t.slice(15, 22)}`;
}

function utclongTicks(text: string): bigint | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,7}))?Z?$/.exec(text.trim());
  if (m === null) {
    return undefined;
  }
  return tstmpTicks(`${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}.${m[7] ?? ""}`);
}

// ------------------------------------------------------------------------------ installation

const intOf = (value: AbapData | undefined): number => (value === undefined ? 0 : Number(deref(value).get()));
const hexOf = (value: AbapData | undefined): string => (value === undefined ? "" : String(deref(value).get()));
const flag = (value: AbapData | undefined): boolean => value !== undefined && abapString(value) !== "";

export function installUtilities(kernel: AbapData, services: UtilityServices): void {
  const abap = abapGlobal();
  const string = (text: string): AbapData => new abap.types.String().set(text);
  const xstring = (bytes: Buffer): AbapData => new abap.types.XString().set(bytes.toString("hex").toUpperCase());
  const timestampl = (text: string): AbapData => new abap.types.Packed({ length: 11, decimals: 7 }).set(text);

  // ---------------------------------------------------------------- JSON
  kernel.json_serialize = async (input: Input): Promise<AbapData> => {
    const mode = abapString(input?.["mode"]);
    const xco = mode === "xco";
    const node = toJson(input?.["data"], {
      mode: xco ? "" : mode,
      compress: flag(input?.["compress"]),
      numcAsString: flag(input?.["numc_as_string"]),
      tsAsIso: flag(input?.["ts_as_iso8601"]),
      hexAsBase64: input?.["hex_as_base64"] === undefined ? true : flag(input["hex_as_base64"]),
      booleans: flag(input?.["booleans"]),
      mappings: parseMappings(String(input?.["mappings"]?.get?.() ?? "")),
    });
    return string(node === undefined ? "{}" : writeJson(node, flag(input?.["format_output"])));
  };

  kernel.json_deserialize = async (input: Input): Promise<void> => {
    const text = String(input?.["json"]?.get?.() ?? "");
    let node: JsonNode;
    try {
      node = parseJson(text);
    } catch (e) {
      // /ui2/cl_json leaves the data unchanged when the JSON is invalid
      if (abapString(input?.["mode"]) === "xco") {
        await raise("cx_sy_conversion_error", (e as Error).message);
      }
      return;
    }
    const mode = abapString(input?.["mode"]);
    fromJson(input?.["data"], node, {
      mode: mode === "xco" ? "" : mode,
      hexAsBase64: input?.["hex_as_base64"] === undefined ? true : flag(input["hex_as_base64"]),
      mappings: parseMappings(String(input?.["mappings"]?.get?.() ?? "")),
    });
  };

  kernel.json_transform = async (input: Input): Promise<AbapData> => {
    const kinds = abapString(input?.["kinds"]).split(/\s+/).filter((k) => k !== "");
    return string(writeJson(transform(parseJson(String(input?.["json"]?.get?.() ?? "")), kinds)));
  };

  kernel.json_quote = async (input: Input): Promise<AbapData> => string(JSON.stringify(String(input?.["text"]?.get?.() ?? "")));

  // ---------------------------------------------------------------- encodings
  kernel.codepage_check = async (input: Input): Promise<void> => {
    const name = abapString(input?.["codepage"]);
    if (codePage(name) === undefined) {
      await raise("cx_parameter_invalid_range", `the code page ${name} is not supported (UTF-8, UTF-16LE, UTF-16BE, ISO-8859-1, windows-1252, US-ASCII)`);
    }
  };

  kernel.codepage_out = async (input: Input): Promise<AbapData> => {
    const name = abapString(input?.["codepage"]);
    const page = codePage(name);
    if (page === undefined) {
      return raise("cx_sy_conversion_codepage", `the code page ${name} is not supported`);
    }
    return xstring(await encode(String(input?.["source"]?.get?.() ?? ""), page));
  };

  kernel.codepage_in = async (input: Input): Promise<AbapData> => {
    const name = abapString(input?.["codepage"]);
    const page = codePage(name);
    if (page === undefined) {
      return raise("cx_sy_conversion_codepage", `the code page ${name} is not supported`);
    }
    return string(await decode(Buffer.from(hexOf(input?.["source"]), "hex"), page));
  };

  kernel.base64_encode_x = async (input: Input): Promise<AbapData> => string(Buffer.from(hexOf(input?.["data"]), "hex").toString("base64"));
  kernel.base64_decode = async (input: Input): Promise<AbapData> => xstring(Buffer.from(String(input?.["text"]?.get?.() ?? "").trim(), "base64"));

  kernel.text_escape = async (input: Input): Promise<AbapData> => {
    const text = String(input?.["text"]?.get?.() ?? "");
    switch (abapString(input?.["format"])) {
      case "url":
        return string(encodeURIComponent(text));
      case "url_unescape":
        try {
          return string(decodeURIComponent(text.replace(/\+/g, " ")));
        } catch {
          return string(text);
        }
      case "html":
        return string(text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));
      case "rtrim":
        return string(text.replace(/ +$/, ""));
      default:
        return string(text);
    }
  };

  kernel.chars_raw = async (input: Input): Promise<AbapData> => {
    const value = deref(input?.["value"]);
    const text = String(value?.get?.() ?? "");
    return string(typeof value?.getLength === "function" ? text.padEnd(value.getLength(), " ") : text);
  };

  kernel.char_code = async (input: Input): Promise<AbapData> => string(String.fromCharCode(intOf(input?.["code"])));

  kernel.gzip = async (input: Input): Promise<AbapData> => {
    const source = Buffer.from(hexOf(input?.["source"]), "hex");
    try {
      return xstring(abapString(input?.["operation"]) === "compress" ? gzipSync(source) : gunzipSync(source));
    } catch (e) {
      return raise("cx_sy_compression_error", `gzip: ${(e as Error).message}`);
    }
  };

  kernel.digest = async (input: Input): Promise<AbapData> => {
    const name = abapString(input?.["algorithm"]).toLowerCase().replace(/-/g, "");
    if (!getHashes().includes(name)) {
      return raise("cx_abap_message_digest", `the hash algorithm ${abapString(input?.["algorithm"])} is not supported (MD5, SHA1, SHA224, SHA256, SHA384, SHA512)`);
    }
    const data = Buffer.from(hexOf(input?.["data"]), "hex");
    const key = hexOf(input?.["key"]);
    const hash = input?.["key"] !== undefined && key !== "" ? createHmac(name, Buffer.from(key, "hex")) : createHash(name);
    return xstring(hash.update(data).digest());
  };

  kernel.random_seed = async (): Promise<AbapData> => new abap.types.Integer().set(randomInt(1, 2147483646));

  // ---------------------------------------------------------------- regular expressions
  kernel.regex_check = async (input: Input): Promise<void> => {
    await compile(abapString(input?.["pattern"]), abapString(input?.["flags"]));
  };

  kernel.regex_find = async (input: Input): Promise<void> => {
    const re = await compile(String(input?.["pattern"]?.get?.() ?? ""), abapString(input?.["flags"]));
    const text = String(input?.["text"]?.get?.() ?? "");
    re.lastIndex = intOf(input?.["start"]);
    const match = re.lastIndex > text.length ? null : re.exec(text);
    if (match === null) {
      input?.["offset"]?.set(-1);
      input?.["length"]?.set(0);
      input?.["submatches"]?.set("");
      return;
    }
    input?.["offset"]?.set(match.index);
    input?.["length"]?.set(match[0].length);
    const indices = (match as RegExpExecArray & { indices?: Array<[number, number] | undefined> }).indices ?? [];
    input?.["submatches"]?.set(
      indices
        .slice(1)
        .map((pair) => (pair === undefined ? "-1,0" : `${pair[0]},${pair[1] - pair[0]}`))
        .join(" "),
    );
  };

  kernel.regex_replace = async (input: Input): Promise<AbapData> => {
    const all = flag(input?.["all"]);
    const re = await compile(String(input?.["pattern"]?.get?.() ?? ""), abapString(input?.["flags"]));
    const pattern = all ? re : new RegExp(re.source, re.flags.replace("g", ""));
    const text = String(input?.["text"]?.get?.() ?? "");
    const replacement = String(input?.["newtext"]?.get?.() ?? "").replace(/\$0/g, "$$&").replace(/\\([1-9])/g, "$$$1");
    const matches = [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))];
    const count = all ? matches.length : Math.min(matches.length, 1);
    const result = text.replace(pattern, replacement);
    input?.["count"]?.set(count);
    return string(result);
  };

  // ---------------------------------------------------------------- dates and time stamps
  kernel.date_add = async (input: Input): Promise<AbapData> => {
    const d = String(deref(input?.["date"]).get());
    if (/^0*$/.test(d) || d.trim() === "") {
      return new abap.types.Date().set(d);
    }
    const result = addCalendar(Number(d.slice(0, 4)), Number(d.slice(4, 6)), Number(d.slice(6, 8)), intOf(input?.["years"]), intOf(input?.["months"]), intOf(input?.["days"]));
    return new abap.types.Date().set(dateDigits(result));
  };

  kernel.moment_add = async (input: Input): Promise<AbapData> => {
    const digits = packedText(deref(input?.["moment"])).split(".")[0]?.padStart(14, "0") ?? "";
    const date = addCalendar(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8)), intOf(input?.["years"]), intOf(input?.["months"]), intOf(input?.["days"]));
    const ticks = tstmpTicks(`${dateDigits(date)}${digits.slice(8, 14)}`) + BigInt(intOf(input?.["seconds"])) * TICKS_PER_SECOND;
    return new abap.types.Packed({ length: 8, decimals: 0 }).set(ticksTstmp(ticks, 0));
  };

  kernel.unix_time = async (input: Input): Promise<AbapData> => {
    const digits = packedText(deref(input?.["moment"])).split(".")[0] ?? "0";
    return new abap.types.Integer8().set(tstmpTicks(digits) / TICKS_PER_SECOND);
  };

  kernel.tstmp_add = async (input: Input): Promise<AbapData> =>
    timestampl(ticksTstmp(tstmpTicks(abapString(input?.["tstmp"])) + secondsTicks(abapString(input?.["seconds"]))));

  kernel.tstmp_diff = async (input: Input): Promise<AbapData> =>
    timestampl(ticksSeconds(tstmpTicks(abapString(input?.["tstmp1"])) - tstmpTicks(abapString(input?.["tstmp2"]))));

  kernel.tstmp_to_utclong = async (input: Input): Promise<AbapData> => {
    const text = abapString(input?.["tstmp"]);
    return new abap.types.UTCLong().set(/^[0.]*$/.test(text) ? "" : utclongText(tstmpTicks(text)));
  };

  kernel.utclong_to_tstmp = async (input: Input): Promise<AbapData> => {
    const ticks = utclongTicks(String(deref(input?.["value"]).get() ?? ""));
    return timestampl(ticks === undefined ? "0" : ticksTstmp(ticks));
  };

  kernel.utclong_read = async (input: Input): Promise<AbapData> => {
    const text = abapString(input?.["text"]);
    const ticks = utclongTicks(text);
    if (ticks === undefined) {
      return raise("cx_abap_utclong_invalid", `${text} is not a time stamp (YYYY-MM-DD hh:mm:ss[.fffffff])`);
    }
    return new abap.types.UTCLong().set(utclongText(ticks));
  };

  // ---------------------------------------------------------------- number ranges
  const interval = (input: Input): { object: string; subobject: string; nr: string; toyear: string } => ({
    object: abapString(input?.["object"]).toUpperCase(),
    subobject: abapString(input?.["subobject"]).toUpperCase(),
    nr: abapString(input?.["interval"]).toUpperCase(),
    toyear: abapString(input?.["toyear"]).replace(/^0+$/, ""),
  });

  kernel.number_get = async (input: Input): Promise<void> => {
    const key = interval(input);
    const quantity = Math.max(intOf(input?.["quantity"]), 1);
    const db = services.db();
    // an interval that is not configured (rapt/number-ranges.json) starts at 1
    await sql`INSERT INTO rapt_number_range (nr_object, nr_subobject, nr_interval, nr_toyear, from_number, to_number)
      VALUES (${key.object}, ${key.subobject}, ${key.nr}, ${key.toyear}, 1, 99999999999999999999)
      ON CONFLICT DO NOTHING`.execute(db);
    const { rows } = await sql<{ current_number: string | null; from_number: string; to_number: string }>`SELECT current_number::text, from_number::text, to_number::text
      FROM rapt_number_range WHERE nr_object = ${key.object} AND nr_subobject = ${key.subobject} AND nr_interval = ${key.nr} AND nr_toyear = ${key.toyear}`.execute(db);
    const row = rows[0];
    if (row === undefined) {
      return raise("cx_nr_object_not_found", `number range object ${key.object}: interval ${key.nr} not found`);
    }
    const from = BigInt(row.from_number);
    const to = BigInt(row.to_number);
    const current = row.current_number === null ? from - 1n : BigInt(row.current_number);
    if (current >= to) {
      return raise("cx_number_ranges", `number range object ${key.object}, interval ${key.nr}: no number left (last number ${to})`);
    }
    const last = current + BigInt(quantity) > to ? to : current + BigInt(quantity);
    await sql`UPDATE rapt_number_range SET current_number = ${last.toString()}::numeric
      WHERE nr_object = ${key.object} AND nr_subobject = ${key.subobject} AND nr_interval = ${key.nr} AND nr_toyear = ${key.toyear}`.execute(db);
    const returned = Number(last - current);
    input?.["number"]?.set(last.toString().padStart(20, "0"));
    input?.["returned"]?.set(returned);
    input?.["returncode"]?.set(returned < quantity ? "3" : last === to ? "2" : " ");
  };

  kernel.number_check = async (input: Input): Promise<void> => {
    const key = interval(input);
    const { rows } = await sql<{ from_number: string; to_number: string }>`SELECT from_number::text, to_number::text FROM rapt_number_range
      WHERE nr_object = ${key.object} AND nr_subobject = ${key.subobject} AND nr_interval = ${key.nr} AND nr_toyear = ${key.toyear}`.execute(services.db());
    const row = rows[0];
    const number = BigInt(abapString(input?.["number"]).replace(/\D/g, "") || "0");
    input?.["returncode"]?.set(row !== undefined && number >= BigInt(row.from_number) && number <= BigInt(row.to_number) ? " " : "1");
  };

  // ---------------------------------------------------------------- application log
  kernel.bali_save = async (input: Input): Promise<void> => {
    const db = services.db();
    const handle = abapString(input?.["handle"]);
    const expiry = String(deref(input?.["expiry_date"])?.get?.() ?? "");
    await sql`DELETE FROM rapt_application_log_item WHERE log_handle = ${handle}`.execute(db);
    await sql`INSERT INTO rapt_application_log (log_handle, log_object, log_subobject, external_id, log_user, log_timestamp, expiry_date)
      VALUES (${handle}, ${abapString(input?.["object"])}, ${abapString(input?.["subobject"])}, ${abapString(input?.["external_id"])}, ${services.user()}, now(),
              ${/^\d{8}$/.test(expiry) && !/^0+$/.test(expiry) ? `${expiry.slice(0, 4)}-${expiry.slice(4, 6)}-${expiry.slice(6, 8)}` : null}::date)
      ON CONFLICT (log_handle) DO UPDATE SET log_object = excluded.log_object, log_subobject = excluded.log_subobject,
        external_id = excluded.external_id, expiry_date = excluded.expiry_date`.execute(db);
    let number = 0;
    for (const item of rowsOf(input?.["items"])) {
      const field = (name: string): string => String(item.get()[name]?.get?.() ?? "").replace(/\s+$/, "");
      number++;
      const ts = packedText(item.get()["timestamp"]);
      await sql`INSERT INTO rapt_application_log_item (log_handle, item_number, severity, category, message_text, msgid, msgno, msgv1, msgv2, msgv3, msgv4, item_timestamp)
        VALUES (${handle}, ${number}, ${field("severity")}, ${field("category")}, ${field("text")}, ${field("id")}, ${field("number")},
                ${field("v1")}, ${field("v2")}, ${field("v3")}, ${field("v4")}, ${/^[0.]*$/.test(ts) ? null : ticksTstmp(tstmpTicks(ts))})`.execute(db);
    }
  };

  kernel.bali_query = async (input: Input): Promise<void> => {
    const handle = abapString(input?.["handle"]);
    const conditions = [sql`true`];
    if (handle !== "") conditions.push(sql`log_handle = ${handle}`);
    for (const [column, name] of [
      ["log_object", "object"],
      ["log_subobject", "subobject"],
      ["external_id", "external_id"],
      ["log_user", "user"],
    ] as const) {
      const value = abapString(input?.[name]);
      if (value !== "") conditions.push(sql`${sql.ref(column)} = ${value}`);
    }
    const start = utclongTicks(String(deref(input?.["start_time"])?.get?.() ?? ""));
    const end = utclongTicks(String(deref(input?.["end_time"])?.get?.() ?? ""));
    const iso = (ticks: bigint): string => `${utclongText(ticks).replace(" ", "T")}Z`;
    if (start !== undefined) conditions.push(sql`log_timestamp >= ${iso(start)}::timestamptz`);
    if (end !== undefined) conditions.push(sql`log_timestamp <= ${iso(end)}::timestamptz`);
    const max = intOf(input?.["max_count"]);
    const { rows } = await sql<{ log_handle: string; log_object: string; log_subobject: string; external_id: string; expiry_date: string | null; log_user: string; ts: string }>`
      SELECT log_handle, log_object, log_subobject, external_id, to_char(expiry_date, 'YYYYMMDD') AS expiry_date, log_user,
             to_char(log_timestamp AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS.US') AS ts
      FROM rapt_application_log WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY log_timestamp, log_handle ${max > 0 ? sql`LIMIT ${max}` : sql``}`.execute(services.db());
    const logs = input?.["logs"];
    logs?.clear();
    for (const row of rows) {
      appendRow(logs, (target) => {
        const c = target.get();
        c["handle"]?.set(row.log_handle);
        c["object"]?.set(row.log_object);
        c["subobject"]?.set(row.log_subobject);
        c["external_id"]?.set(row.external_id);
        c["expiry_date"]?.set(row.expiry_date ?? "00000000");
        c["log_user"]?.set(row.log_user);
        c["log_timestamp"]?.set(row.ts);
      });
    }
  };

  kernel.bali_items = async (input: Input): Promise<void> => {
    const { rows } = await sql<{ severity: string; category: string; message_text: string; msgid: string; msgno: string; msgv1: string; msgv2: string; msgv3: string; msgv4: string; item_timestamp: string | null }>`
      SELECT severity, category, message_text, msgid, msgno, msgv1, msgv2, msgv3, msgv4, item_timestamp::text AS item_timestamp
      FROM rapt_application_log_item WHERE log_handle = ${abapString(input?.["handle"])} ORDER BY item_number`.execute(services.db());
    const items = input?.["items"];
    items?.clear();
    for (const row of rows) {
      appendRow(items, (target) => {
        const c = target.get();
        c["severity"]?.set(row.severity);
        c["category"]?.set(row.category);
        c["text"]?.set(row.message_text);
        c["id"]?.set(row.msgid);
        c["number"]?.set(row.msgno);
        c["v1"]?.set(row.msgv1);
        c["v2"]?.set(row.msgv2);
        c["v3"]?.set(row.msgv3);
        c["v4"]?.set(row.msgv4);
        if (row.item_timestamp !== null) c["timestamp"]?.set(row.item_timestamp);
      });
    }
  };

  kernel.bali_delete = async (input: Input): Promise<void> => {
    const handle = abapString(input?.["handle"]);
    await sql`DELETE FROM rapt_application_log_item WHERE log_handle = ${handle}`.execute(services.db());
    await sql`DELETE FROM rapt_application_log WHERE log_handle = ${handle}`.execute(services.db());
  };

  // ---------------------------------------------------------------- RTTS
  kernel.rtti_describe = async (input: Input): Promise<void> => {
    const { types } = abap;
    const value = deref(input?.["data"]);
    const set = (kind: string, typeKind: string, length = 0, decimals = 0, components = ""): void => {
      input?.["kind"]?.set(kind);
      input?.["type_kind"]?.set(typeKind);
      input?.["length"]?.set(length);
      input?.["decimals"]?.set(decimals);
      input?.["components"]?.set(components);
      const name = qualified(value);
      input?.["name"]?.set(name === "" ? "" : `\\TYPE=${name}`);
    };
    if (value instanceof types.Structure) {
      const components = Object.entries(value.get() as Record<string, AbapData>);
      const deep = components.some(([, c]) => isTable(deref(c)) || deref(c) instanceof types.String || deref(c) instanceof types.XString || deref(c) instanceof types.Structure);
      set("S", deep ? "v" : "u", 0, 0, components.map(([n]) => n.toUpperCase()).join(" "));
    } else if (isTable(value)) {
      set("T", "h", 8);
    } else if (value instanceof types.DataReference) {
      set("R", "l", 8);
    } else if (value instanceof types.ABAPObject) {
      set("R", "r", 8);
    } else if (value instanceof types.Character) {
      set("E", "C", value.getLength() * 2);
    } else if (value instanceof types.String) {
      set("E", "g", 8);
    } else if (value instanceof types.Numc) {
      set("E", "N", value.getLength() * 2);
    } else if (value instanceof types.Date) {
      set("E", "D", 16);
    } else if (value instanceof types.Time) {
      set("E", "T", 12);
    } else if (value instanceof types.Packed) {
      set("E", "P", value.getLength(), value.getDecimals());
    } else if (value instanceof types.Integer8) {
      set("E", "8", 8);
    } else if (value instanceof types.Integer) {
      const name = qualified(value);
      set("E", name === "INT1" ? "b" : name === "INT2" ? "s" : "I", name === "INT1" ? 1 : name === "INT2" ? 2 : 4);
    } else if (value instanceof types.Float) {
      set("E", "F", 8);
    } else if (types.DecFloat34 !== undefined && value instanceof types.DecFloat34) {
      set("E", "e", 16);
    } else if (value instanceof types.XString) {
      set("E", "y", 8);
    } else if (value instanceof types.Hex) {
      set("E", "X", value.getLength());
    } else if (value instanceof types.UTCLong) {
      set("E", "p", 8);
    } else {
      set("E", "~");
    }
  };

  kernel.class_name = async (input: Input): Promise<AbapData> => {
    const object = deref(input?.["object"])?.get?.();
    const name = object?.constructor?.INTERNAL_NAME ?? object?.constructor?.name ?? "";
    return string(String(name).toUpperCase());
  };
}
