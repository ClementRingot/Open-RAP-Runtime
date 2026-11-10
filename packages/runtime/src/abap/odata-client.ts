/**
 * The OData client proxy of the behavior pools (decision D31): the kernel side of the clean-room
 * /iwbep/cl_cp_factory_remote and cl_web_odata_client_factory (service consumption model, SCM
 * and SCM2), for OData V2 and V4.
 *
 * The proxy reads the $metadata of the remote service once: entity sets, entity types, keys and
 * property types. The names of the ABAP code (internal names of a consumption model class such
 * as `TRAVEL_ID`, `gcs_entity_set-travel`, or the element names of an abstract entity) are matched
 * with the EDM names case-insensitively, underscores ignored (`TRAVEL_ID` ↔ `TravelID`). The
 * values are converted by EDM type and ABAP type, decimals as exact strings
 * (IEEE754Compatible for V4). Modifying requests fetch a CSRF token first, as SAP Gateway needs.
 */

import { randomUUID } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { abapGlobal, abapString, appendRow, component, rowsOf, type AbapData } from "./convert.js";
import { exchange, raise, resolveDestination, type Exchange } from "./http.js";

type Input = Record<string, AbapData> | undefined;

interface EdmProperty {
  name: string;
  type: string;
  nullable: boolean;
  scale?: number;
  /** Digits of the fractional seconds of a time stamp (0 when not given, OData V4). */
  precision?: number;
}

interface EdmEntityType {
  name: string;
  keys: string[];
  properties: EdmProperty[];
}

interface Metadata {
  sets: Map<string, EdmEntityType>;
}

interface Proxy {
  version: 2 | 4;
  service: string;
  headers: Record<string, string>;
  metadata?: Promise<Metadata>;
  /** Whether modifying requests fetch a CSRF token first (iv_do_fetch_csrf_token). */
  fetchCsrf: boolean;
  csrf?: string;
  cookies: Map<string, string>;
}

const proxies = new Map<string, Proxy>();

const normalize = (name: string): string => name.toLowerCase().replace(/[_\s]/g, "");

const list = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/** Entity sets and entity types of an EDMX document (V2 or V4). */
export function parseMetadata(xml: string): Metadata {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", removeNSPrefix: true });
  const document = parser.parse(xml) as { Edmx?: { DataServices?: { Schema?: unknown } } };
  const schemas = list(document.Edmx?.DataServices?.Schema as Record<string, unknown> | Array<Record<string, unknown>> | undefined);
  const types = new Map<string, EdmEntityType>();
  for (const schema of schemas) {
    const namespace = String(schema["Namespace"] ?? "");
    const alias = schema["Alias"] === undefined ? undefined : String(schema["Alias"]);
    for (const type of list(schema["EntityType"] as Record<string, unknown> | Array<Record<string, unknown>> | undefined)) {
      const key = type["Key"] as { PropertyRef?: unknown } | undefined;
      const entity: EdmEntityType = {
        name: String(type["Name"]),
        keys: list(key?.PropertyRef as Record<string, unknown> | Array<Record<string, unknown>> | undefined).map((r) => String(r["Name"])),
        properties: list(type["Property"] as Record<string, unknown> | Array<Record<string, unknown>> | undefined).map((p) => {
          const property: EdmProperty = { name: String(p["Name"]), type: String(p["Type"]), nullable: String(p["Nullable"] ?? "true") !== "false" };
          if (p["Scale"] !== undefined && /^\d+$/.test(String(p["Scale"]))) {
            property.scale = Number(p["Scale"]);
          }
          if (p["Precision"] !== undefined && /^\d+$/.test(String(p["Precision"]))) {
            property.precision = Number(p["Precision"]);
          }
          return property;
        }),
      };
      types.set(`${namespace}.${entity.name}`, entity);
      if (alias !== undefined) {
        types.set(`${alias}.${entity.name}`, entity);
      }
    }
  }
  const sets = new Map<string, EdmEntityType>();
  for (const schema of schemas) {
    for (const container of list(schema["EntityContainer"] as Record<string, unknown> | Array<Record<string, unknown>> | undefined)) {
      for (const set of list(container["EntitySet"] as Record<string, unknown> | Array<Record<string, unknown>> | undefined)) {
        const type = types.get(String(set["EntityType"]));
        if (type !== undefined) {
          sets.set(String(set["Name"]), type);
        }
      }
    }
  }
  return { sets };
}

// ---------------------------------------------------------------------------------------------
// values

const DIGITS = /^\d+$/;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/**
 * ABAP time stamp digits (`YYYYMMDDhhmmss[.fffffff]`) → ISO UTC with at most `digits` digits of
 * fractional seconds, null when initial.
 */
function timestampToIso(text: string, digits = 7): string | null {
  const [whole = "", fraction = ""] = text.replace(/^-/, "").split(".");
  if (/^0*$/.test(whole)) {
    return null;
  }
  const d = whole.padStart(14, "0");
  const base = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:${d.slice(10, 12)}:${d.slice(12, 14)}`;
  const kept = fraction.slice(0, Math.min(digits, 7)).replace(/0+$/, "");
  return kept === "" ? `${base}Z` : `${base}.${kept}Z`;
}

/** A date or time stamp of the service as a JavaScript date (V2 `/Date(ms)/` or ISO). */
function parseInstant(value: string): Date | undefined {
  const v2 = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  if (v2 !== null) {
    return new Date(Number(v2[1]));
  }
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** The fraction of the seconds of an ISO value, as digits (`2027-05-01T10:00:00.1234567Z` → 1234567). */
function fractionOf(value: string): string {
  return /\.(\d+)/.exec(value)?.[1] ?? "";
}

/** A value of the service into an ABAP data object, by the type of the data object. */
function toAbap(target: AbapData, value: unknown, property: EdmProperty | undefined): void {
  const t = abapGlobal().types;
  if (value === null || value === undefined) {
    target.clear();
    return;
  }
  const text = String(value);
  if (target instanceof t.Date) {
    const date = parseInstant(text);
    target.set(date === undefined ? text.replace(/-/g, "").slice(0, 8) : `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`);
  } else if (target instanceof t.Time) {
    const v2 = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.\d+)?S)?$/.exec(text);
    target.set(v2 === null ? text.replace(/:/g, "").slice(0, 6) : `${pad(Number(v2[1] ?? 0))}${pad(Number(v2[2] ?? 0))}${pad(Number(v2[3] ?? 0))}`);
  } else if (target instanceof t.Hex || target instanceof t.XString) {
    target.set(property?.type === "Edm.Binary" ? Buffer.from(text, "base64").toString("hex").toUpperCase() : text.replace(/-/g, "").toUpperCase());
  } else if (target instanceof t.Packed) {
    if (property !== undefined && /^Edm\.DateTime(Offset)?$/.test(property.type)) {
      const date = parseInstant(text);
      if (date === undefined) {
        target.clear();
        return;
      }
      const digits = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
      const fraction = fractionOf(text) || String(date.getUTCMilliseconds()).padStart(3, "0");
      target.set(`${digits}.${fraction}`);
    } else {
      target.set(text);
    }
  } else if (target instanceof t.Integer8) {
    target.set(BigInt(text.split(".")[0] ?? "0"));
  } else if (target instanceof t.Integer || target instanceof t.Float) {
    target.set(Number(value));
  } else if (target instanceof t.UTCLong) {
    const date = parseInstant(text);
    target.set(date === undefined ? "" : `${date.toISOString().slice(0, 19)}.${(fractionOf(text) || String(date.getUTCMilliseconds()).padStart(3, "0")).padEnd(7, "0").slice(0, 7)}`);
  } else if (typeof value === "boolean") {
    target.set(value ? "X" : "");
  } else {
    target.set(text);
  }
}

/** An ABAP data object as the JSON value of a property; undefined for an initial value. */
function toJson(source: AbapData, property: EdmProperty, version: 2 | 4): unknown {
  const raw = source.get();
  // the trailing blanks of a field of type c are not part of its value
  const text = source instanceof abapGlobal().types.Character ? String(raw ?? "").replace(/ +$/, "") : String(raw ?? "");
  const initial = text === "" || /^0*$/.test(text.replace(/[.-]/g, ""));
  switch (property.type) {
    case "Edm.Guid": {
      const h = text.toLowerCase().replace(/-/g, "");
      return initial ? null : `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
    }
    case "Edm.Date":
      return initial || !DIGITS.test(text) ? null : `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    case "Edm.DateTime":
    case "Edm.DateTimeOffset": {
      let iso: string | null;
      if (DIGITS.test(text) && text.length === 8) {
        iso = initial ? null : `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00Z`;
      } else if (/^\d+(\.\d+)?$/.test(text)) {
        // V4: the Precision of the property (0 when not given); V2: milliseconds
        iso = timestampToIso(typeof source.toFixed === "function" ? source.toFixed(7) : text, version === 2 ? 3 : (property.precision ?? 0));
      } else {
        iso = text === "" ? null : `${text.replace(/Z$/, "")}Z`;
      }
      if (iso === null) {
        return null;
      }
      return version === 2 ? `/Date(${new Date(iso).getTime()})/` : iso;
    }
    case "Edm.TimeOfDay":
    case "Edm.Time": {
      const d = text.padEnd(6, "0");
      return version === 2 ? `PT${d.slice(0, 2)}H${d.slice(2, 4)}M${d.slice(4, 6)}S` : `${d.slice(0, 2)}:${d.slice(2, 4)}:${d.slice(4, 6)}`;
    }
    case "Edm.Decimal":
      return typeof source.toFixed === "function" ? source.toFixed(property.scale ?? source.getDecimals?.() ?? 0) : text;
    case "Edm.Int64":
      return text;
    case "Edm.Int32":
    case "Edm.Int16":
    case "Edm.Byte":
    case "Edm.SByte":
    case "Edm.Double":
    case "Edm.Single":
      return Number(raw);
    case "Edm.Boolean":
      return typeof raw === "number" ? raw !== 0 : text.trim() !== "";
    case "Edm.Binary":
      return text === "" ? null : Buffer.from(text, "hex").toString("base64");
    default:
      return text;
  }
}

/** The literal of a value in a URL (key predicate, $filter), V2 or V4 syntax. */
function literal(source: AbapData, property: EdmProperty, version: 2 | 4): string {
  const value = toJson(source, property, version);
  if (value === null || value === undefined) {
    return "null";
  }
  const quoted = (s: string): string => `'${s.replace(/'/g, "''")}'`;
  switch (property.type) {
    case "Edm.String":
      return quoted(String(value));
    case "Edm.Guid":
      return version === 2 ? `guid${quoted(String(value))}` : String(value);
    case "Edm.DateTime": {
      const iso = new Date(Number(/\d+/.exec(String(value))?.[0] ?? 0)).toISOString().slice(0, 19);
      return `datetime${quoted(iso)}`;
    }
    case "Edm.DateTimeOffset":
      return version === 2 ? `datetimeoffset${quoted(new Date(Number(/\d+/.exec(String(value))?.[0] ?? 0)).toISOString())}` : String(value);
    case "Edm.Time":
      return `time${quoted(String(value))}`;
    case "Edm.Decimal":
      return version === 2 ? `${String(value)}M` : String(value);
    case "Edm.Int64":
      return version === 2 ? `${String(value)}L` : String(value);
    case "Edm.Binary":
      return version === 2 ? `binary${quoted(Buffer.from(String(value), "base64").toString("hex"))}` : `binary${quoted(String(value))}`;
    default:
      return String(value);
  }
}

// ---------------------------------------------------------------------------------------------
// requests

function proxyOf(input: Input): Proxy {
  const handle = abapString(input?.["handle"]);
  const proxy = proxies.get(handle);
  if (proxy === undefined) {
    throw new Error(`OData client proxy ${handle} is not open`);
  }
  return proxy;
}

function acceptOf(proxy: Proxy): string {
  return proxy.version === 4 ? "application/json;odata.metadata=minimal;IEEE754Compatible=true" : "application/json";
}

async function send(proxy: Proxy, method: string, path: string, body?: string, extra: Record<string, string> = {}): Promise<Exchange> {
  const headers: Record<string, string> = { ...proxy.headers, accept: path.endsWith("$metadata") ? "application/xml" : acceptOf(proxy), ...extra };
  if (proxy.cookies.size > 0) {
    headers["cookie"] = [...proxy.cookies].map(([n, v]) => `${n}=${v}`).join("; ");
  }
  if (body !== undefined) {
    headers["content-type"] = proxy.version === 4 ? "application/json;IEEE754Compatible=true" : "application/json";
  }
  let response: Exchange;
  try {
    response = await exchange(method, `${proxy.service}${path}`, headers, body);
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message;
    return raise("/IWBEP/CX_CP_REMOTE", `${method} ${proxy.service}${path}: ${cause ?? (error as Error).message}`);
  }
  for (const cookie of response.headers.getSetCookie()) {
    const [pair = ""] = cookie.split(";");
    const at = pair.indexOf("=");
    if (at > 0) {
      proxy.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }
  return response;
}

async function metadataOf(proxy: Proxy): Promise<Metadata> {
  proxy.metadata ??= (async () => {
    const response = await send(proxy, "GET", "$metadata");
    if (response.status !== 200) {
      return raise("/IWBEP/CX_CP_REMOTE", `the $metadata of ${proxy.service} could not be read (HTTP ${response.status})`, {
        http_status_code: new (abapGlobal().types.Integer)().set(response.status),
        http_error_body: new (abapGlobal().types.String)().set(response.body.toString("utf8")),
      });
    }
    return parseMetadata(response.body.toString("utf8"));
  })();
  try {
    return await proxy.metadata;
  } catch (error) {
    delete proxy.metadata;
    throw error;
  }
}

async function entitySet(proxy: Proxy, name: string): Promise<{ name: string; type: EdmEntityType }> {
  const { sets } = await metadataOf(proxy);
  const exact = sets.get(name);
  if (exact !== undefined) {
    return { name, type: exact };
  }
  for (const [setName, type] of sets) {
    if (normalize(setName) === normalize(name)) {
      return { name: setName, type };
    }
  }
  return raise("/IWBEP/CX_GATEWAY", `the service ${proxy.service} has no entity set ${name}`);
}

function propertyOf(type: EdmEntityType, name: string): EdmProperty | undefined {
  return type.properties.find((p) => p.name === name) ?? type.properties.find((p) => normalize(p.name) === normalize(name));
}

/** The components of an ABAP structure (lower case names, the runtime's). */
function components(structure: AbapData): Array<[string, AbapData]> {
  return Object.entries((structure?.get?.() ?? {}) as Record<string, AbapData>);
}

/** The CSRF token of the service: a HEAD request on the service root (GET when HEAD is refused). */
async function csrfToken(proxy: Proxy, refresh = false): Promise<string | undefined> {
  if (!proxy.fetchCsrf) {
    return undefined;
  }
  if (proxy.csrf === undefined || refresh) {
    let response = await send(proxy, "HEAD", "", undefined, { "x-csrf-token": "fetch" });
    if (response.headers.get("x-csrf-token") === null && response.status >= 400) {
      response = await send(proxy, "GET", "", undefined, { "x-csrf-token": "fetch" });
    }
    proxy.csrf = response.headers.get("x-csrf-token") ?? "";
  }
  return proxy.csrf === "" ? undefined : proxy.csrf;
}

function errorText(response: Exchange): string {
  const text = response.body.toString("utf8");
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string | { value?: string } } };
    const message = parsed.error?.message;
    if (typeof message === "string") {
      return message;
    }
    if (message?.value !== undefined) {
      return message.value;
    }
  } catch {
    // not JSON
  }
  return text.slice(0, 500) || response.reason;
}

export function installODataClient(kernel: AbapData): void {
  const abap = abapGlobal();

  kernel.odata_open = async (input: Input): Promise<AbapData> => {
    const base = abapString(input?.["base"]).replace(/\/+$/, "");
    let root = abapString(input?.["root"]);
    root = `${root.startsWith("/") || root === "" ? "" : "/"}${root}${root.endsWith("/") ? "" : "/"}`;
    const name = abapString(input?.["destination"]);
    const handle = randomUUID();
    proxies.set(handle, {
      version: abapString(input?.["version"]) === "2" ? 2 : 4,
      service: `${base}${root}`,
      headers: name === "" ? {} : (resolveDestination(name)?.headers ?? {}),
      fetchCsrf: input?.["csrf"] === undefined || abapString(input["csrf"]) !== "",
      cookies: new Map(),
    });
    return new abap.types.String().set(handle);
  };

  kernel.odata_key = async (input: Input): Promise<AbapData> => {
    const proxy = proxyOf(input);
    const { type } = await entitySet(proxy, abapString(input?.["set"]));
    const values = components(input?.["source"]);
    const parts: Array<{ key: string; value: string }> = [];
    for (const key of type.keys) {
      const property = propertyOf(type, key);
      const data = values.find(([n]) => normalize(n) === normalize(key))?.[1];
      if (data === undefined || property === undefined) {
        return raise("/IWBEP/CX_GATEWAY", `navigate_with_key: the key property ${key} is not a component of the key values`);
      }
      parts.push({ key, value: encodeURIComponent(literal(data, property, proxy.version)).replace(/%27/g, "'") });
    }
    const predicate = parts.length === 1 ? `(${parts[0]?.value})` : `(${parts.map((p) => `${p.key}=${p.value}`).join(",")})`;
    return new abap.types.String().set(predicate);
  };

  kernel.odata_filter = async (input: Input): Promise<AbapData> => {
    const proxy = proxyOf(input);
    const { type } = await entitySet(proxy, abapString(input?.["set"]));
    const path = abapString(input?.["property"]);
    const property = propertyOf(type, path);
    if (property === undefined) {
      return raise("/IWBEP/CX_GATEWAY", `create_by_range: the entity set ${abapString(input?.["set"])} has no property ${path}`);
    }
    const name = property.name;
    const include: string[] = [];
    const exclude: string[] = [];
    for (const row of rowsOf(input?.["range"])) {
      const sign = abapString(component(row, "sign")).toUpperCase();
      const option = abapString(component(row, "option")).toUpperCase();
      const low = component(row, "low");
      const high = component(row, "high");
      const value = (data: AbapData): string => literal(data, property, proxy.version);
      let condition: string;
      if (option === "BT" || option === "NB") {
        condition = `(${name} ge ${value(low)} and ${name} le ${value(high)})`;
        condition = option === "NB" ? `not ${condition}` : condition;
      } else if (option === "CP" || option === "NP") {
        const pattern = abapString(low);
        const fixed = pattern.replace(/^\*+|\*+$/g, "");
        const q = `'${fixed.replace(/'/g, "''")}'`;
        if (!/[*+]/.test(pattern)) {
          condition = `${name} eq ${q}`;
        } else if (pattern.startsWith("*") && pattern.endsWith("*")) {
          condition = proxy.version === 4 ? `contains(${name},${q})` : `substringof(${q},${name})`;
        } else if (pattern.endsWith("*")) {
          condition = proxy.version === 4 ? `startswith(${name},${q})` : `startswith(${name},${q}) eq true`;
        } else {
          condition = proxy.version === 4 ? `endswith(${name},${q})` : `endswith(${name},${q}) eq true`;
        }
        condition = option === "NP" ? `not ${condition}` : condition;
      } else {
        const operator = { EQ: "eq", NE: "ne", GT: "gt", GE: "ge", LT: "lt", LE: "le" }[option];
        if (operator === undefined) {
          return raise("/IWBEP/CX_GATEWAY", `create_by_range: option ${option} is not supported`);
        }
        condition = `${name} ${operator} ${value(low)}`;
      }
      (sign === "E" ? exclude : include).push(condition);
    }
    const parts = [include.length === 0 ? "" : include.length === 1 ? (include[0] as string) : `(${include.join(" or ")})`, ...exclude.map((c) => `not (${c})`)].filter((p) => p !== "");
    return new abap.types.String().set(parts.length === 0 ? "true" : parts.join(" and "));
  };

  kernel.odata_payload = async (input: Input): Promise<AbapData> => {
    const proxy = proxyOf(input);
    const { type } = await entitySet(proxy, abapString(input?.["set"]));
    const provided = rowsOf(input?.["properties"]).map((row) => normalize(abapString(row)));
    const body: Record<string, unknown> = {};
    for (const [name, data] of components(input?.["source"])) {
      const property = propertyOf(type, name);
      if (property === undefined) {
        continue;
      }
      const given = provided.includes(normalize(name)) || provided.includes(normalize(property.name));
      if (provided.length > 0 && !given) {
        continue;
      }
      const value = toJson(data, property, proxy.version);
      if (value === null && !given) {
        continue;
      }
      body[property.name] = value;
    }
    return new abap.types.String().set(JSON.stringify(body));
  };

  kernel.odata_request = async (input: Input): Promise<void> => {
    const proxy = proxyOf(input);
    const set = await entitySet(proxy, abapString(input?.["set"]));
    const method = abapString(input?.["method"]).toUpperCase();
    const key = abapString(input?.["key"]);
    const query: string[] = [];
    const mapped = (spec: string): string =>
      spec
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "")
        .map((item) => {
          const [path = "", direction] = item.split(/\s+/);
          const name = propertyOf(set.type, path)?.name ?? path;
          return direction === undefined ? name : `${name} ${direction}`;
        })
        .join(",");
    if (method === "READ_LIST") {
      const top = Number(input?.["top"]?.get?.() ?? -1);
      const noData = abapString(input?.["no_data"]) !== "";
      if (noData) {
        query.push("$top=0");
      } else if (top >= 0) {
        query.push(`$top=${top}`);
      }
      const skip = Number(input?.["skip"]?.get?.() ?? 0);
      if (skip > 0) {
        query.push(`$skip=${skip}`);
      }
      if (abapString(input?.["count"]) !== "") {
        query.push(proxy.version === 4 ? "$count=true" : "$inlinecount=allpages");
      }
    }
    const filter = abapString(input?.["filter"]);
    if (filter !== "" && method === "READ_LIST") {
      query.push(`$filter=${encodeURIComponent(filter)}`);
    }
    const select = abapString(input?.["select"]);
    if (select !== "" && (method === "READ_LIST" || method === "GET")) {
      query.push(`$select=${encodeURIComponent(mapped(select))}`);
    }
    const orderby = abapString(input?.["orderby"]);
    if (orderby !== "" && method === "READ_LIST") {
      query.push(`$orderby=${encodeURIComponent(mapped(orderby))}`);
    }
    const path = `${set.name}${key}${query.length === 0 ? "" : `?${query.join("&")}`}`;
    const httpMethod = method === "READ_LIST" ? "GET" : method;
    const modifying = httpMethod !== "GET";
    const payload = abapString(input?.["payload"]);
    const extra: Record<string, string> = {};
    const ifMatch = abapString(input?.["if_match"]);
    if (ifMatch !== "") {
      extra["if-match"] = ifMatch;
    }
    const run = async (): Promise<Exchange> => {
      if (modifying) {
        const token = await csrfToken(proxy);
        if (token !== undefined) {
          extra["x-csrf-token"] = token;
        }
      }
      return send(proxy, httpMethod, path, httpMethod === "POST" || httpMethod === "PATCH" || httpMethod === "PUT" ? payload || "{}" : undefined, extra);
    };
    let response = await run();
    if (modifying && response.status === 403 && (response.headers.get("x-csrf-token") ?? "").toLowerCase() === "required") {
      await csrfToken(proxy, true);
      response = await run();
    }
    if (response.status >= 300) {
      return raise("/IWBEP/CX_CP_REMOTE", `${httpMethod} ${set.name}${key}: HTTP ${response.status} ${errorText(response)}`, {
        http_status_code: new abap.types.Integer().set(response.status),
        http_error_body: new abap.types.String().set(response.body.toString("utf8")),
      });
    }
    const text = response.body.toString("utf8");
    let json = "";
    let total = 0;
    if (text.trim() !== "") {
      const body = JSON.parse(text) as Record<string, unknown>;
      if (method === "READ_LIST") {
        const d = body["d"] as Record<string, unknown> | unknown[] | undefined;
        const rows = proxy.version === 4 ? body["value"] : Array.isArray(d) ? d : (d as Record<string, unknown> | undefined)?.["results"];
        json = JSON.stringify(rows ?? []);
        const count = proxy.version === 4 ? body["@odata.count"] : (d as Record<string, unknown> | undefined)?.["__count"];
        total = count === undefined ? 0 : Number(count);
      } else {
        json = JSON.stringify(proxy.version === 4 ? body : (body["d"] ?? body));
      }
    }
    input?.["json"]?.set(json);
    input?.["total"]?.set(BigInt(total));
  };

  kernel.odata_fill = async (input: Input): Promise<void> => {
    const proxy = proxyOf(input);
    const { type } = await entitySet(proxy, abapString(input?.["set"]));
    const target = input?.["target"];
    const text = abapString(input?.["json"]);
    const parsed = text === "" ? undefined : (JSON.parse(text) as unknown);
    const fill = (structure: AbapData, entity: Record<string, unknown>): void => {
      for (const [name, data] of components(structure)) {
        const property = propertyOf(type, name);
        if (property === undefined && name === "etag" && data?.set !== undefined) {
          // the ETag of the instance (`odata.etag` of a consumption model class)
          const etag = proxy.version === 4 ? entity["@odata.etag"] : (entity["__metadata"] as { etag?: unknown } | undefined)?.etag;
          if (etag !== undefined) {
            data.set(String(etag));
          }
          continue;
        }
        const key = property?.name ?? Object.keys(entity).find((k) => normalize(k) === normalize(name));
        if (key !== undefined && key in entity && data?.set !== undefined) {
          toAbap(data, entity[key], property);
        }
      }
    };
    if (target instanceof abap.types.Table || target instanceof abap.types.HashedTable) {
      target.clear();
      for (const entity of Array.isArray(parsed) ? parsed : []) {
        appendRow(target, (row) => fill(row, entity as Record<string, unknown>));
      }
    } else if (parsed !== undefined && !Array.isArray(parsed)) {
      target?.clear();
      fill(target, parsed as Record<string, unknown>);
    }
  };
}
