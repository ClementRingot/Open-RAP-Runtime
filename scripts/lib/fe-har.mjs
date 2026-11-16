// SAP Fiori elements protocol cases from a HAR (decision D79). Pure functions over the content of
// a HAR, used by scripts/fe-har-to-cases.mjs and tested by scripts/lib/fe-har.test.mjs.
//
// The HAR is recorded by the user, on their SAP BTP trial, in the Fiori elements preview of a
// service built from a fixture of the project. It stays with the user: what goes into the
// repository is the shape of the requests (method, path, system query options, OData headers,
// batch structure, request bodies), re-expressed with placeholders for the keys, and the structure
// of the responses (status, property names, control annotations, the severity and target of the
// messages). Nothing else of the responses is kept: no values, no message texts, no host names,
// no cookies, no tokens.

/** Request headers kept: the OData protocol ones. */
const REQUEST_HEADERS = ["accept", "content-type", "if-match", "if-none-match", "prefer", "odata-version", "odata-maxversion", "isolation"];
/** Response headers whose presence is checked. */
const RESPONSE_HEADERS = ["sap-messages", "location", "etag", "odata-entityid", "preference-applied"];
/** Instance annotations whose presence is checked. */
const ANNOTATIONS = ["@odata.count", "@odata.etag", "@odata.nextLink"];

const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const GUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The service root of an SAP OData V4 service in a URL (`/sap/opu/odata4/…/0001/`), else undefined. */
export function serviceRootOf(url) {
  const pathname = safeUrl(url)?.pathname ?? url;
  return /^(\/sap\/opu\/odata4\/.+?\/\d{4}\/)/.exec(pathname)?.[1];
}

function safeUrl(url) {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/** The boundary of a multipart content type. */
export function boundaryOf(contentType) {
  return /boundary=("?)([^";]+)\1/i.exec(contentType ?? "")?.[2];
}

/** Headers lines → lower-case map. */
function headerMap(lines) {
  const headers = {};
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

/**
 * The parts of a multipart $batch body, requests or responses: `{ kind: "part", head, start,
 * headers, body, contentId }` (`start`: the request or status line) or `{ kind: "changeset",
 * parts }`.
 */
export function parseMultipart(body, contentType) {
  const boundary = boundaryOf(contentType);
  if (boundary === undefined) {
    throw new Error(`no multipart boundary in ${contentType}`);
  }
  const text = body.replace(/\r\n/g, "\n");
  const chunks = text.split(`--${boundary}`).slice(1);
  const items = [];
  for (const chunk of chunks) {
    if (chunk.startsWith("--")) break;
    const content = chunk.replace(/^\n/, "");
    const split = content.indexOf("\n\n");
    const mimeHeaders = headerMap((split < 0 ? content : content.slice(0, split)).split("\n"));
    const rest = split < 0 ? "" : content.slice(split + 2);
    const type = mimeHeaders["content-type"] ?? "";
    if (/^multipart\/mixed/i.test(type)) {
      items.push({ kind: "changeset", parts: parseMultipart(rest, type).map((p) => p) });
      continue;
    }
    const lines = rest.split("\n");
    const start = (lines.shift() ?? "").trim();
    const headerLines = [];
    while (lines.length > 0 && lines[0] !== "") headerLines.push(lines.shift());
    lines.shift();
    const partBody = lines.join("\n").replace(/\n+$/, "");
    const part = { kind: "part", start, headers: headerMap(headerLines), body: partBody };
    const contentId = mimeHeaders["content-id"];
    if (contentId !== undefined) part.contentId = contentId;
    items.push(part);
  }
  return items;
}

/** Status of a status line (`HTTP/1.1 200 OK`). */
function statusOf(start) {
  return Number(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(start)?.[1] ?? 0);
}

/** The relative URL of a request, readable (spaces and quotes decoded). */
export function relativeUrl(url, root) {
  let relative = url;
  const parsed = safeUrl(url);
  if (parsed !== undefined) relative = `${parsed.pathname}${parsed.search}`;
  if (root !== undefined && relative.startsWith(root)) relative = relative.slice(root.length);
  return relative.replace(/%20/g, " ").replace(/%27/gi, "'").replace(/%24/g, "$").replace(/%28/g, "(").replace(/%29/g, ")").replace(/%2C/gi, ",").replace(/%3D/gi, "=");
}

function parseJson(text) {
  if (typeof text !== "string" || text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The text of a HAR content (base64 decoded). */
function contentText(content) {
  if (content === undefined || typeof content.text !== "string") return "";
  return content.encoding === "base64" ? Buffer.from(content.text, "base64").toString("utf8") : content.text;
}

/**
 * The structure of a response: status, property names, annotations, headers, messages. With
 * `observe` (names of properties, `Name*` for a prefix, `error`, `sap-messages`), the values of
 * those properties too, in `observed`: what a recording on the trial must settle (D99), read by
 * people, not compared by the runner.
 */
export function responseShape(status, headers, bodyText, observe = []) {
  const expected = { status };
  const body = parseJson(bodyText);
  if (body !== undefined && body !== null && typeof body === "object" && !Array.isArray(body)) {
    const entity = Array.isArray(body.value) ? (body.value[0] ?? undefined) : "error" in body ? undefined : body;
    if (entity !== undefined && entity !== null && typeof entity === "object") {
      // the advertised actions (`#<namespace>.Edit`) name the namespace: the placeholder {{NS}}
      const properties = Object.keys(entity).filter((k) => !k.includes("@")).map((k) => k.replace(NAMESPACE, "{{NS}}"));
      if (properties.length > 0) expected.properties = properties;
    }
    const annotations = ANNOTATIONS.filter((a) => a in body);
    if (annotations.length > 0) expected.annotations = annotations;
    if (observe.length > 0) {
      const observed = {};
      const wanted = (name) => observe.some((o) => (o.endsWith("*") ? name.startsWith(o.slice(0, -1)) : name === o));
      if (entity !== undefined && entity !== null && typeof entity === "object") {
        for (const [name, value] of Object.entries(entity)) {
          const key = name.replace(NAMESPACE, "{{NS}}");
          if (wanted(key)) observed[key] = neutral(value);
        }
      }
      if (observe.includes("error") && body.error !== undefined) observed.error = neutral(body.error);
      if (Object.keys(observed).length > 0) expected.observed = observed;
    }
  }
  const present = RESPONSE_HEADERS.filter((h) => headers[h] !== undefined);
  if (present.length > 0) expected.headers = present;
  const messages = parseJson(headers["sap-messages"]);
  if (observe.includes("sap-messages") && Array.isArray(messages) && messages.length > 0) {
    expected.observed = { ...(expected.observed ?? {}), "sap-messages": neutral(messages) };
  }
  if (Array.isArray(messages) && messages.length > 0) {
    expected.messages = messages.map((m) => {
      const shape = {};
      if (typeof m.numericSeverity === "number") shape.numericSeverity = m.numericSeverity;
      if (typeof m.target === "string") shape.target = m.target;
      return shape;
    });
  }
  return expected;
}

/**
 * An observed value: the namespace of the service as {{NS}}, the UUIDs as {{uuid}}, the users and
 * their names (`…User`, `…UserDescription`) as {{user}}: no personal data in the repository.
 */
function neutral(value) {
  const text = JSON.stringify(value ?? null, (key, v) => (/User(Description)?$/.test(key) && typeof v === "string" && v !== "" ? "{{user}}" : v));
  return JSON.parse(text.replace(NAMESPACE, "{{NS}}").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "{{uuid}}"));
}

/** Keeps the protocol headers of a request; the value of If-Match becomes `*`. */
function requestHeaders(headers, isBatchPart) {
  const kept = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!REQUEST_HEADERS.includes(lower)) continue;
    if (lower === "content-type" && !isBatchPart && /^multipart\//i.test(value)) continue;
    kept[canonical(lower)] = lower === "if-match" || lower === "if-none-match" ? "*" : value;
  }
  return kept;
}

function canonical(name) {
  return name === "odata-version" ? "OData-Version" : name === "odata-maxversion" ? "OData-MaxVersion" : name.replace(/(^|-)([a-z])/g, (_, dash, c) => `${dash}${c.toUpperCase()}`);
}

/**
 * Replaces the keys (GUIDs) of a text by placeholders. A key first seen in a response is captured
 * from it (`{{k1}}`); a key first seen in a request names an instance of the SAP system: it becomes
 * `{{keyN}}`, to map to a seeded key of the fixture (`--map`).
 */
class Keys {
  constructor(map) {
    this.names = new Map(Object.entries(map ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    this.unresolved = [];
    this.captured = 0;
  }
  replace(text) {
    return text.replace(GUID, (guid) => {
      const lower = guid.toLowerCase();
      let name = this.names.get(lower);
      if (name === undefined) {
        name = `key${this.unresolved.length + 1}`;
        this.names.set(lower, name);
        this.unresolved.push(name);
      }
      return `{{${name}}}`;
    });
  }
  /** Captures the keys of a response body not seen yet: name → path. */
  capture(body) {
    const capture = {};
    const visit = (value, path) => {
      if (typeof value === "string" && GUID_EXACT.test(value)) {
        const lower = value.toLowerCase();
        if (!this.names.has(lower)) {
          const name = `k${++this.captured}`;
          this.names.set(lower, name);
          capture[name] = path;
        }
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => visit(v, `${path}/${i}`));
      } else if (value !== null && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
          if (!k.includes("@")) visit(v, path === "" ? k : `${path}/${k}`);
        }
      }
    };
    visit(body, "");
    return capture;
  }
}

function replaceDeep(value, keys) {
  if (typeof value === "string") return keys.replace(value);
  if (Array.isArray(value)) return value.map((v) => replaceDeep(v, keys));
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceDeep(v, keys)]));
  return value;
}

/**
 * The namespace of the service (`com.sap.gateway.srvd.<definition>.v0001`), which changes with the
 * suffix of the objects on a shared system (D83): the placeholder `{{NS}}` of the cases.
 */
const NAMESPACE = /\bcom\.sap\.gateway\.srvd\.[a-z0-9_]+\.v\d{4}\b/gi;

function requestOf(method, url, headers, bodyText, keys, isBatchPart, contentId) {
  const request = { method: method.toUpperCase(), url: keys.replace(url).replace(NAMESPACE, "{{NS}}"), headers: requestHeaders(headers, isBatchPart) };
  if (bodyText !== undefined && bodyText !== "") {
    const json = parseJson(bodyText);
    request.body = json === undefined ? keys.replace(bodyText) : replaceDeep(json, keys);
  }
  if (contentId !== undefined) request.contentId = contentId;
  return request;
}

/**
 * The protocol case file of a HAR. Options: `scenario`, `floorplan`, `release` (SAP BTP release of
 * the trial), `fixture` (default travel-draft), `caseId` (default `recorded`), `title`, `map` (SAP
 * key → placeholder, e.g. `{ "<guid>": "T1" }`). Returns `{ file, warnings }`.
 */
export function harToCases(har, options) {
  const warnings = [];
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) {
    throw new Error("not a HAR: log.entries is missing");
  }
  const root = entries.map((e) => serviceRootOf(e.request?.url ?? "")).find((r) => r !== undefined);
  if (root === undefined) {
    throw new Error("no request to an SAP OData V4 service (/sap/opu/odata4/…) in the HAR");
  }
  const keys = new Keys(options.map);
  const steps = [];
  let skipped = 0;
  for (const entry of entries) {
    const url = entry.request?.url ?? "";
    if (!(safeUrl(url)?.pathname ?? "").startsWith(root)) {
      skipped++;
      continue;
    }
    const relative = relativeUrl(url, root);
    if (relative.startsWith("$metadata")) {
      continue; // compared with the round trip to SAP BTP (D99), not replayed
    }
    const requestHeadersMap = headerMap((entry.request.headers ?? []).map((h) => `${h.name}: ${h.value}`));
    const responseHeadersMap = headerMap((entry.response?.headers ?? []).map((h) => `${h.name}: ${h.value}`));
    const requestText = entry.request.postData?.text ?? "";
    const responseText = contentText(entry.response?.content);
    if (relative.startsWith("$batch")) {
      const requestParts = parseMultipart(requestText, requestHeadersMap["content-type"]);
      const responseParts = entry.response?.status === 200 ? parseMultipart(responseText, responseHeadersMap["content-type"]) : [];
      const flatResponses = responseParts.flatMap((p) => (p.kind === "changeset" ? p.parts : [p]));
      const batch = [];
      for (const part of requestParts) {
        const toRequest = (p) => {
          const [method, partUrl] = p.start.split(/\s+/);
          return requestOf(method ?? "GET", relativeUrl(partUrl ?? "", root), p.headers, p.body, keys, true, p.contentId);
        };
        batch.push(part.kind === "changeset" ? { changeset: part.parts.map(toRequest) } : toRequest(part));
      }
      const expect = flatResponses.map((p) => responseShape(statusOf(p.start), p.headers, p.body, options.observe ?? []));
      const step = { batch };
      if (expect.length > 0) step.expect = expect;
      else warnings.push(`$batch #${steps.length + 1}: status ${entry.response?.status}, no part to compare`);
      const capture = Object.assign({}, ...flatResponses.map((p) => keys.capture(parseJson(p.body))));
      if (Object.keys(capture).length > 0) {
        // the runner captures from the first response of a step: keep the keys of a single-request batch only
        if (flatResponses.length === 1) step.capture = capture;
        else warnings.push(`$batch #${steps.length + 1}: keys created in a batch of several requests (${Object.keys(capture).join(", ")}): split the step to capture them`);
      }
      steps.push(step);
      continue;
    }
    const step = { request: requestOf(entry.request.method ?? "GET", relative, requestHeadersMap, requestText, keys, false) };
    step.expect = responseShape(entry.response?.status ?? 0, responseHeadersMap, responseText, options.observe ?? []);
    const capture = keys.capture(parseJson(responseText));
    if (Object.keys(capture).length > 0) step.capture = capture;
    steps.push(step);
  }
  if (skipped > 0) warnings.push(`${skipped} requests outside the service (UI resources, other services) left out`);
  for (const name of keys.unresolved) {
    warnings.push(`{{${name}}}: a key of an instance of the SAP system: map it to a seeded key of the fixture (--map <guid>=T1)`);
  }
  if (steps.some((s) => s.request?.body !== undefined || s.batch?.some((b) => (b.changeset ?? [b]).some((r) => r.body !== undefined)))) {
    warnings.push("the request bodies are kept as recorded: review them before adding the file to the repository");
  }
  const file = {
    scenario: options.scenario,
    floorplan: options.floorplan,
    fixture: options.fixture ?? "travel-draft",
    source: "har",
    release: options.release,
    note: "Produced by scripts/fe-har-to-cases.mjs from a HAR of the Fiori elements preview on SAP BTP: the shape of the requests and the structure of the responses only.",
    cases: [{ id: options.caseId ?? "recorded", title: options.title ?? `${options.scenario}, as recorded on SAP BTP ${options.release}`, steps }],
  };
  return { file, warnings };
}
