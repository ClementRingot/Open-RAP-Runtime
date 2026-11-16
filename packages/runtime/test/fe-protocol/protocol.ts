/**
 * SAP Fiori elements protocol cases (D79): the requests SAP Fiori elements sends to a RAP
 * service, replayed against Open RAP Runtime, and the structure of the responses checked.
 *
 * A case file (`cases/*.json`) is written by hand from the OData V4 specification and the public
 * vocabularies, or by `scripts/fe-har-to-cases.mjs` from a HAR recorded by the user on an SAP BTP
 * trial: the HAR stays with the user, the case file keeps the shape of the requests only,
 * re-expressed on the fixtures of the project. No SAPUI5 is loaded: this tests our server.
 *
 * The responses are compared on their structure (status, properties, control annotations,
 * headers, the severity and target of `sap-messages`); `match` (values) is only used by the cases
 * written by hand, on the data of the fixtures.
 */

import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { PGliteDialect } from "kysely";
import { createApp } from "../../src/app.js";
import { createDatabase, PGLITE_PARSERS, type Database } from "../../src/db/database.js";
import { RapRuntime } from "../../src/rap/runtime.js";
import { B1, B2, B3, B4, batchResponses, DRAFT_CHANGES, generatedFixture, generatedVariant, SEED, SERVICE, T1, T2, T3, type GeneratedFixture } from "../helpers.js";

/** The fixture a case file runs on. */
export type ProtocolFixture = "travel" | "travel-draft";

export interface ProtocolFile {
  /** What the file covers, e.g. `draft-list-report`. */
  scenario: string;
  floorplan: "listReport" | "objectPage" | "worklist" | "analyticalListPage" | "overviewPage" | "formEntry";
  fixture: ProtocolFixture;
  /** `specification`: written by hand; `har`: produced by scripts/fe-har-to-cases.mjs. */
  source: "specification" | "har";
  /** For `har`: the SAP BTP release the HAR was recorded on. */
  release?: string;
  note?: string;
  cases: ProtocolCase[];
}

export interface ProtocolCase {
  id: string;
  title: string;
  /** The decision that will make the case pass: the case is expected to fail until then. */
  fails?: string;
  /** What a HAR of the SAP BTP trial still has to confirm (a case written from the specification). */
  confirm?: string;
  /** The user of the requests (default ALICE). */
  user?: string;
  steps: ProtocolStep[];
  /** Steps run after the case, even when it fails (discard the drafts it created). */
  cleanup?: ProtocolStep[];
}

export interface ProtocolRequest {
  method: "GET" | "HEAD" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Relative to the service root; `{{name}}` placeholders. */
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  contentId?: string;
}

export type ProtocolBatchItem = ProtocolRequest | { changeset: ProtocolRequest[] };

export interface ProtocolStep {
  /** Another user than the one of the case for this step. */
  user?: string;
  request?: ProtocolRequest;
  /** A multipart $batch; its expectations go in order, a change set giving one per request. */
  batch?: ProtocolBatchItem[];
  /** Placeholders taken from the JSON body of the response: name → property path (`a/0/b`). */
  capture?: Record<string, string>;
  expect?: ProtocolExpect | ProtocolExpect[];
}

export interface ProtocolExpect {
  status?: number;
  /** Properties present in the entity, or in each row of a collection. */
  properties?: string[];
  /** Properties that must not be there. */
  absent?: string[];
  /** Properties whose value is a non-empty array or object. */
  nonEmpty?: string[];
  /** Instance annotations of the body (`@odata.count`, `@odata.etag`…). */
  annotations?: string[];
  /** Response headers present (any case). */
  headers?: string[];
  /** Entries of the `sap-messages` header: each one must be matched by a message. */
  messages?: Array<{ numericSeverity?: number; target?: string }>;
  /** Texts in a non-JSON body (`$metadata`). */
  contains?: string[];
  /** Values (cases written by hand, on the data of the fixtures): toMatchObject on the body. */
  match?: Record<string, unknown>;
}

export interface ProtocolResponse {
  status: number;
  headers: Record<string, string>;
  /** Parsed JSON, else the text. */
  body: unknown;
}

const PREDEFINED: Record<string, string> = { T1, T2, T3, B1, B2, B3, B4 };

/** The fixtures, generated once per test file. */
const fixtures = new Map<ProtocolFixture, Promise<GeneratedFixture>>();
function fixtureOf(kind: ProtocolFixture): Promise<GeneratedFixture> {
  let fixture = fixtures.get(kind);
  if (fixture === undefined) {
    fixture = kind === "travel" ? generatedFixture() : generatedVariant(DRAFT_CHANGES);
    fixtures.set(kind, fixture);
  }
  return fixture;
}

/** One database with the seed data, and one application per user on it. */
export class ProtocolServer {
  private readonly apps = new Map<string, Promise<FastifyInstance>>();

  private constructor(
    private readonly fixture: GeneratedFixture,
    private readonly db: Database,
    private readonly rap: RapRuntime,
  ) {}

  public static async start(kind: ProtocolFixture): Promise<ProtocolServer> {
    const fixture = await fixtureOf(kind);
    const pglite = await PGlite.create({ parsers: PGLITE_PARSERS });
    await pglite.exec("SET TIME ZONE 'UTC'");
    await pglite.exec(fixture.schema);
    await pglite.exec(SEED);
    const db = createDatabase(new PGliteDialect({ pglite }));
    const rap = await RapRuntime.load(fixture.model, fixture.abapDir);
    return new ProtocolServer(fixture, db, rap);
  }

  /** The namespace of the actions of the service. */
  public get namespace(): string {
    return this.fixture.model.service.namespace;
  }

  public app(user: string): Promise<FastifyInstance> {
    let app = this.apps.get(user);
    if (app === undefined) {
      app = createApp({ model: this.fixture.model, metadata: this.fixture.metadata, db: this.db, rap: this.rap, auth: { mode: "none", user } }).then(async (a) => {
        await a.ready();
        return a;
      });
      this.apps.set(user, app);
    }
    return app;
  }

  public async close(): Promise<void> {
    for (const app of this.apps.values()) {
      await (await app).close();
    }
    await this.db.destroy();
  }
}

/** The URL as a client sends it: the spaces of the query options percent-encoded. */
export function encodeUrl(url: string): string {
  return url.replace(/ /g, "%20");
}

/** Replaces the `{{name}}` placeholders of a text. */
export function substitute(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (all, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new Error(`unknown placeholder ${all}`);
    }
    return value;
  });
}

function substituteDeep(value: unknown, values: Record<string, string>): unknown {
  if (typeof value === "string") {
    return substitute(value, values);
  }
  if (Array.isArray(value)) {
    return value.map((v) => substituteDeep(v, values));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteDeep(v, values)]));
  }
  return value;
}

/** The value at a path (`value/0/TravelUUID`) of a JSON body. */
export function valueAt(body: unknown, pathText: string): unknown {
  let current: unknown = body;
  for (const segment of pathText.split("/")) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function parseBody(text: string): unknown {
  if (text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** A multipart $batch request body, with the headers of each request exactly as given. */
export function serializeBatchRequest(boundary: string, items: ProtocolBatchItem[]): string {
  const part = (r: ProtocolRequest): string[] => {
    const lines = ["Content-Type:application/http", "Content-Transfer-Encoding:binary"];
    if (r.contentId !== undefined) lines.push(`Content-ID:${r.contentId}`);
    lines.push("", `${r.method} ${encodeUrl(r.url)} HTTP/1.1`);
    for (const [k, v] of Object.entries(r.headers ?? {})) lines.push(`${k}:${v}`);
    lines.push("", r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body));
    return lines;
  };
  const lines: string[] = [];
  items.forEach((item, i) => {
    lines.push(`--${boundary}`);
    if ("changeset" in item) {
      const inner = `changeset_${i}`;
      lines.push(`Content-Type: multipart/mixed;boundary=${inner}`, "");
      for (const r of item.changeset) lines.push(`--${inner}`, ...part(r));
      lines.push(`--${inner}--`);
    } else {
      lines.push(...part(item));
    }
  });
  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}

/** Runs one step; returns the responses (one per request; a batch gives its parts). */
export async function runStep(server: ProtocolServer, user: string, step: ProtocolStep, values: Record<string, string>): Promise<ProtocolResponse[]> {
  const app = await server.app(step.user ?? user);
  if (step.request !== undefined) {
    const r = substituteDeep(step.request, values) as ProtocolRequest;
    const headers: Record<string, string> = { ...(r.headers ?? {}) };
    if (r.body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
      headers["content-type"] = "application/json";
    }
    const response = await app.inject({ method: r.method, url: `${SERVICE}${encodeUrl(r.url)}`, headers, ...(r.body === undefined ? {} : { payload: typeof r.body === "string" ? r.body : JSON.stringify(r.body) }) });
    const responseHeaders = Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    return [{ status: response.statusCode, headers: responseHeaders, body: parseBody(response.body) }];
  }
  if (step.batch !== undefined) {
    const items = substituteDeep(step.batch, values) as ProtocolBatchItem[];
    const boundary = "batch_fe_protocol";
    const response = await app.inject({ method: "POST", url: `${SERVICE}$batch`, headers: { "content-type": `multipart/mixed;boundary=${boundary}`, accept: "multipart/mixed" }, payload: serializeBatchRequest(boundary, items) });
    if (response.statusCode !== 200) {
      return [{ status: response.statusCode, headers: {}, body: parseBody(response.body) }];
    }
    return batchResponses(response.body).map((p) => ({ status: p.status, headers: p.headers, body: p.body }));
  }
  throw new Error("a step needs a request or a batch");
}

/** The problems of a response against an expectation (empty: it matches). */
export function check(response: ProtocolResponse, expected: ProtocolExpect): string[] {
  const problems: string[] = [];
  const show = (): string => (typeof response.body === "string" ? response.body.slice(0, 300) : JSON.stringify(response.body)?.slice(0, 300) ?? "");
  if (expected.status !== undefined && response.status !== expected.status) {
    problems.push(`status ${response.status}, expected ${expected.status}: ${show()}`);
  }
  const body = response.body !== null && typeof response.body === "object" ? (response.body as Record<string, unknown>) : undefined;
  const rows = body !== undefined && Array.isArray(body["value"]) ? (body["value"] as Array<Record<string, unknown>>) : body === undefined ? [] : [body];
  for (const name of expected.properties ?? []) {
    if (rows.length === 0 || rows.some((row) => !(name in row))) {
      problems.push(`property ${name} missing`);
    }
  }
  for (const name of expected.absent ?? []) {
    if (rows.some((row) => name in row)) {
      problems.push(`property ${name} present`);
    }
  }
  for (const name of expected.nonEmpty ?? []) {
    if (rows.length === 0 || rows.some((row) => { const v = row[name]; return v === null || typeof v !== "object" || Object.keys(v).length === 0; })) {
      problems.push(`property ${name} empty or missing`);
    }
  }
  for (const name of expected.annotations ?? []) {
    if (body === undefined || !(name in body)) {
      problems.push(`annotation ${name} missing`);
    }
  }
  for (const name of expected.headers ?? []) {
    if (!(name.toLowerCase() in response.headers)) {
      problems.push(`header ${name} missing`);
    }
  }
  if (expected.messages !== undefined) {
    let messages: Array<Record<string, unknown>> = [];
    try {
      messages = JSON.parse(response.headers["sap-messages"] ?? "[]") as Array<Record<string, unknown>>;
    } catch {
      problems.push("sap-messages is not JSON");
    }
    for (const wanted of expected.messages) {
      const found = messages.some((m) => Object.entries(wanted).every(([k, v]) => m[k] === v));
      if (!found) {
        problems.push(`no sap-messages entry ${JSON.stringify(wanted)} in ${JSON.stringify(messages)}`);
      }
    }
  }
  for (const text of expected.contains ?? []) {
    if (typeof response.body !== "string" || !response.body.includes(text)) {
      problems.push(`body does not contain ${text}`);
    }
  }
  return problems;
}

/** Runs the steps of a case; throws with every problem found. */
export async function runCase(server: ProtocolServer, c: ProtocolCase): Promise<void> {
  const values: Record<string, string> = { ...PREDEFINED, NS: server.namespace };
  const user = c.user ?? "ALICE";
  const run = async (steps: ProtocolStep[], strict: boolean): Promise<string[]> => {
    const problems: string[] = [];
    for (const [i, step] of steps.entries()) {
      let responses: ProtocolResponse[];
      try {
        responses = await runStep(server, user, step, values);
      } catch (error) {
        problems.push(`step ${i + 1}: ${(error as Error).message}`);
        if (strict) return problems;
        continue;
      }
      const expectations = step.expect === undefined ? [] : Array.isArray(step.expect) ? step.expect : [step.expect];
      expectations.forEach((expected, j) => {
        const response = responses[j];
        if (response === undefined) {
          problems.push(`step ${i + 1}: no response ${j + 1} (got ${responses.length})`);
          return;
        }
        // the names of the properties may hold placeholders: the advertised actions `#{{NS}}.Edit` (D89)
        const named = expected.properties === undefined ? expected : { ...expected, properties: expected.properties.map((p) => substitute(p, values)) };
        for (const p of check(response, named)) problems.push(`step ${i + 1}${expectations.length > 1 ? `.${j + 1}` : ""}: ${p}`);
        if (expected.match !== undefined && !matches(response.body, expected.match)) {
          problems.push(`step ${i + 1}: body ${JSON.stringify(response.body)?.slice(0, 400)} does not match ${JSON.stringify(substituteDeep(expected.match, values))}`);
        }
      });
      for (const [name, pathText] of Object.entries(step.capture ?? {})) {
        const value = valueAt(responses[0]?.body, pathText);
        if (value === undefined || value === null) {
          problems.push(`step ${i + 1}: nothing to capture at ${pathText}`);
        } else {
          values[name] = String(value);
        }
      }
      if (strict && problems.length > 0) return problems;
    }
    return problems;
  };
  const matches = (actual: unknown, expected: unknown): boolean => isMatch(actual, substituteDeep(expected, values));
  let problems: string[];
  try {
    problems = await run(c.steps, true);
  } finally {
    await run(c.cleanup ?? [], false);
  }
  if (problems.length > 0) {
    throw new Error(`${c.id}:\n  ${problems.join("\n  ")}`);
  }
}

/** toMatchObject semantics: objects match on the expected keys, arrays element by element with the same length. */
export function isMatch(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => isMatch(actual[i], e));
  }
  if (expected !== null && typeof expected === "object") {
    return actual !== null && typeof actual === "object" && Object.entries(expected).every(([k, v]) => isMatch((actual as Record<string, unknown>)[k], v));
  }
  return Object.is(actual, expected);
}
