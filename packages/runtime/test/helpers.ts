import { PGlite } from "@electric-sql/pglite";
import { buildModel, Diagnostics, generateApplication, generateCsdl, generateLaunchpadUi, generateSql, loadProject, resolveLaunchpad, writeFiles } from "@rap-transpiler/compiler";
import type { LaunchpadModel, Model } from "@rap-transpiler/model";
import type { FastifyInstance } from "fastify";
import { PGliteDialect } from "kysely";
import pg from "pg";
import { execFileSync } from "node:child_process";
import { chownSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, type AppOptions } from "../src/app.js";
import { createDatabase, PGLITE_PARSERS, type Database } from "../src/db/database.js";
import { RapRuntime } from "../src/rap/runtime.js";

export const FIXTURE_DIR = fileURLToPath(new URL("../../../fixtures/travel", import.meta.url));

let compiled: { model: Model; metadata: string; schema: string } | undefined;

export function compiledFixture(): { model: Model; metadata: string; schema: string } {
  if (compiled === undefined) {
    const { model, diagnostics } = buildModel(loadProject(FIXTURE_DIR));
    if (model === undefined || diagnostics.hasErrors()) {
      throw new Error(`fixture does not compile: ${JSON.stringify(diagnostics.items)}`);
    }
    compiled = { model, metadata: generateCsdl(model), schema: generateSql(model).schema };
  }
  return compiled;
}

export interface GeneratedFixture {
  model: Model;
  metadata: string;
  schema: string;
  abapDir: string;
  /** The generated application folder. */
  dir: string;
}

let generated: Promise<GeneratedFixture> | undefined;

/**
 * The fixture built by `rapt build` (ABAP transpiled), written under test/.generated so that the
 * generated modules resolve @abaplint/runtime from this package.
 */
export function generatedFixture(): Promise<GeneratedFixture> {
  generated ??= (async () => {
    const result = await generateApplication(loadProject(FIXTURE_DIR), { scaffold: false });
    if (result.model === undefined || result.diagnostics.hasErrors()) {
      throw new Error(`fixture does not build: ${JSON.stringify(result.diagnostics.items)}`);
    }
    const out = fileURLToPath(new URL(`./.generated/travel-${process.pid}-${Math.random().toString(36).slice(2, 8)}`, import.meta.url));
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    writeFiles(out, result.files);
    const file = (name: string): string => result.files.find((f) => f.path === name)?.content ?? "";
    return { model: result.model, metadata: file("odata/metadata.xml"), schema: file("db/schema.sql"), abapDir: path.join(out, "abap"), dir: out };
  })();
  return generated;
}

/**
 * A variant of the fixture (files of src/ replaced or added, or changed by a function), built and
 * written like generatedFixture. One per test file: the ABAP runtime of a worker is global.
 */
export async function generatedVariant(changes: Record<string, string | ((content: string) => string)>): Promise<GeneratedFixture> {
  const dir = mkdtempSync(path.join(tmpdir(), "rapt-variant-"));
  try {
    mkdirSync(path.join(dir, "src"));
    copyFileSync(path.join(FIXTURE_DIR, ".abapgit.xml"), path.join(dir, ".abapgit.xml"));
    for (const file of readdirSync(path.join(FIXTURE_DIR, "src"))) {
      copyFileSync(path.join(FIXTURE_DIR, "src", file), path.join(dir, "src", file));
    }
    // the roles next to the sources (rapt/authorizations.json)
    if (existsSync(path.join(FIXTURE_DIR, "rapt"))) {
      cpSync(path.join(FIXTURE_DIR, "rapt"), path.join(dir, "rapt"), { recursive: true });
    }
    for (const [file, change] of Object.entries(changes)) {
      // a file of src/, or of the project root with "../" (rapt/authorizations.json)
      const target = path.join(dir, "src", file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, typeof change === "function" ? change(readFileSync(target, "utf8")) : change);
    }
    const result = await generateApplication(loadProject(dir), { scaffold: false });
    if (result.model === undefined || result.diagnostics.hasErrors()) {
      throw new Error(`variant does not build: ${JSON.stringify(result.diagnostics.errors())}`);
    }
    const out = fileURLToPath(new URL(`./.generated/variant-${process.pid}-${Math.random().toString(36).slice(2, 8)}`, import.meta.url));
    mkdirSync(out, { recursive: true });
    writeFiles(out, result.files);
    const file = (name: string): string => result.files.find((f) => f.path === name)?.content ?? "";
    return { model: result.model, metadata: file("odata/metadata.xml"), schema: file("db/schema.sql"), abapDir: path.join(out, "abap"), dir: out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Replaces each `from` by its `to`, and fails when a `from` is not in the content. */
export function edit(content: string, replacements: Array<[string, string]>): string {
  let result = content;
  for (const [from, to] of replacements) {
    if (!result.includes(from)) {
      throw new Error(`edit: text not found: ${from.slice(0, 80)}`);
    }
    result = result.replace(from, to);
  }
  return result;
}

export const SERVICE = "/sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001/";

export const T1 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
export const T2 = "7a1d3c5e-0000-4000-8000-000000000002";
export const T3 = "7a1d3c5e-0000-4000-8000-000000000003";
export const B1 = "b0000000-0000-4000-8000-000000000001";
export const B2 = "b0000000-0000-4000-8000-000000000002";
export const B3 = "b0000000-0000-4000-8000-000000000003";
export const B4 = "b0000000-0000-4000-8000-000000000004";

export const SEED = `
INSERT INTO zrt_travel (travel_uuid, travel_id, agency_id, customer_id, begin_date, end_date, booking_fee, total_price, currency_code, description, overall_status, created_by, created_at, last_changed_by, last_changed_at, local_last_changed_at) VALUES
 ('${T1}', '00000001', '070001', '000010', '2026-06-01', '2026-06-15', 20.00, 1520.50, 'EUR', 'Paris and Rome', 'O', 'ALICE', '2026-01-10 08:00:00+00', 'ALICE', '2026-01-10 08:00:00+00', '2026-01-10 08:00:00.123456+00'),
 ('${T2}', '00000002', '070002', '000011', '2026-07-01', '2026-07-03', 10.00, 310.00, 'USD', 'Business trip to Berlin', 'A', 'BOB', '2026-01-11 09:00:00+00', 'BOB', '2026-01-11 09:00:00+00', '2026-01-11 09:00:00.5+00'),
 ('${T3}', '00000003', '070003', '000012', '2027-01-05', '2027-01-20', 0.00, 0.00, 'EUR', 'Ski holidays', 'X', 'CAROL', '2026-02-01 10:00:00+00', 'CAROL', '2026-02-01 10:00:00+00', '2026-02-01 10:00:00+00');
INSERT INTO zrt_booking (booking_uuid, parent_uuid, booking_id, booking_date, carrier_id, connection_id, flight_date, flight_price, currency_code, booking_status, local_last_changed_at) VALUES
 ('${B1}', '${T1}', '0001', '2026-01-10', 'AF', '0012', '2026-06-01', 750.25, 'EUR', 'B', '2026-01-10 08:00:00+00'),
 ('${B2}', '${T1}', '0002', '2026-01-10', 'AZ', '0034', '2026-06-15', 750.25, 'EUR', 'B', '2026-01-10 08:00:00+00'),
 ('${B3}', '${T1}', '0003', '2026-01-12', 'LH', '0400', '2026-06-08', 0.00, 'EUR', 'N', '2026-01-12 08:00:00+00'),
 ('${B4}', '${T2}', '0001', '2026-01-11', 'LH', '0401', '2026-07-01', 300.00, 'USD', 'B', '2026-01-11 09:00:00+00');
`;

export interface TestApp {
  app: FastifyInstance;
  db: Database;
  pglite: PGlite;
  model: Model;
  close: () => Promise<void>;
}

export async function fixtureApp(options: Partial<AppOptions> = {}, seed = true): Promise<TestApp> {
  const { model, metadata, schema } = compiledFixture();
  const pglite = await PGlite.create({ parsers: PGLITE_PARSERS });
  await pglite.exec("SET TIME ZONE 'UTC'");
  await pglite.exec(schema);
  if (seed) {
    await pglite.exec(SEED);
  }
  const db = createDatabase(new PGliteDialect({ pglite }));
  const app = await createApp({ model, metadata, db, ...options });
  await app.ready();
  return {
    app,
    db,
    pglite,
    model,
    close: async () => {
      await app.close();
      await db.destroy();
    },
  };
}

/** The fixture application with the managed RAP runtime (writes, actions, feature control). */
export async function writableApp(fixture?: Promise<GeneratedFixture>, options: Partial<AppOptions> = {}): Promise<TestApp> {
  const { model, metadata, schema, abapDir } = await (fixture ?? generatedFixture());
  const pglite = await PGlite.create({ parsers: PGLITE_PARSERS });
  await pglite.exec("SET TIME ZONE 'UTC'");
  await pglite.exec(schema);
  await pglite.exec(SEED);
  const db = createDatabase(new PGliteDialect({ pglite }));
  const rap = await RapRuntime.load(model, abapDir);
  const app = await createApp({ model, metadata, db, rap, ...options });
  await app.ready();
  return {
    app,
    db,
    pglite,
    model,
    close: async () => {
      await app.close();
      await db.destroy();
    },
  };
}

/** A $batch body the way the OpenUI5 / SAPUI5 ODataModel V4 writes it. */
export function batchBody(boundary: string, requests: Array<{ method?: string; url: string; headers?: Record<string, string>; body?: unknown; contentId?: string }>, changeset = false): string {
  const part = (r: (typeof requests)[number]): string[] => {
    const lines = ["Content-Type:application/http", "Content-Transfer-Encoding:binary"];
    if (r.contentId !== undefined) lines.push(`Content-ID:${r.contentId}`);
    lines.push("", `${r.method ?? "GET"} ${r.url} HTTP/1.1`, "Accept:application/json;odata.metadata=minimal;IEEE754Compatible=true", "Accept-Language:fr");
    if (r.body !== undefined) lines.push("Content-Type:application/json;charset=UTF-8;IEEE754Compatible=true");
    for (const [k, v] of Object.entries(r.headers ?? {})) lines.push(`${k}:${v}`);
    lines.push("", r.body === undefined ? "" : JSON.stringify(r.body));
    return lines;
  };
  const lines: string[] = [];
  if (changeset) {
    const inner = `changeset_${boundary}`;
    lines.push(`--${boundary}`, `Content-Type: multipart/mixed;boundary=${inner}`, "");
    for (const r of requests) lines.push(`--${inner}`, ...part(r));
    lines.push(`--${inner}--`);
  } else {
    for (const r of requests) lines.push(`--${boundary}`, ...part(r));
  }
  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}

/** Parses a multipart $batch response into its parts (status, headers, JSON body). */
export function batchResponses(body: string): Array<{ status: number; headers: Record<string, string>; body: unknown; contentId?: string }> {
  const results: Array<{ status: number; headers: Record<string, string>; body: unknown; contentId?: string }> = [];
  const re = /Content-Type: application\/http\r\nContent-Transfer-Encoding: binary\r\n(?:Content-ID: (\S+)\r\n)?\r\nHTTP\/1\.1 (\d{3})[^\r]*\r\n([\s\S]*?)\r\n\r\n([\s\S]*?)(?=\r\n--)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const headers: Record<string, string> = {};
    for (const line of (m[3] ?? "").split("\r\n")) {
      const i = line.indexOf(":");
      if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
    }
    const text = m[4] ?? "";
    let parsed: unknown = text;
    try {
      parsed = text === "" ? undefined : JSON.parse(text);
    } catch {
      parsed = text;
    }
    const result: { status: number; headers: Record<string, string>; body: unknown; contentId?: string } = { status: Number(m[2]), headers, body: parsed };
    if (m[1] !== undefined) result.contentId = m[1];
    results.push(result);
  }
  return results;
}

/** The binaries of an installed PostgreSQL server (Debian/Ubuntu layout), when the tests run as root. */
function postgresBinaries(): string | undefined {
  const versions = existsSync("/usr/lib/postgresql") ? readdirSync("/usr/lib/postgresql").sort() : [];
  const version = versions[versions.length - 1];
  return version === undefined || process.getuid?.() !== 0 ? undefined : `/usr/lib/postgresql/${version}/bin`;
}

/** Whether a real PostgreSQL is available: RAPT_E2E_DATABASE_URL, or a server the tests can start. */
export const POSTGRES_AVAILABLE = process.env["RAPT_E2E_DATABASE_URL"] !== undefined || postgresBinaries() !== undefined;

/** A PostgreSQL server for a test: initdb in `work`, started as the postgres user. */
export function startPostgresServer(work: string): { url: string; stop: () => void } | undefined {
  const bin = postgresBinaries();
  if (bin === undefined) {
    return undefined;
  }
  try {
    const data = path.join(work, "pgdata");
    mkdirSync(data, { recursive: true });
    const uid = Number(execFileSync("id", ["-u", "postgres"]).toString().trim());
    const gid = Number(execFileSync("id", ["-g", "postgres"]).toString().trim());
    chownSync(data, uid, gid);
    const port = 54000 + (process.pid % 900);
    const asPostgres = (command: string): void => {
      execFileSync("su", ["postgres", "-s", "/bin/sh", "-c", command], { stdio: "ignore" });
    };
    asPostgres(`${bin}/initdb -D ${data} -U postgres --auth=trust -E UTF8`);
    asPostgres(`${bin}/pg_ctl -D ${data} -o '-p ${port} -k ${data} -c listen_addresses=127.0.0.1' -l ${data}/log.txt -w start`);
    return { url: `postgres://postgres@127.0.0.1:${port}/postgres`, stop: () => asPostgres(`${bin}/pg_ctl -D ${data} -m fast stop`) };
  } catch {
    return undefined;
  }
}

/**
 * A database of its own for a test that needs a real PostgreSQL (concurrent transactions): created
 * on the server of RAPT_E2E_DATABASE_URL, else on a server started for the test.
 */
export async function postgresDatabase(name: string): Promise<{ url: string; close: () => Promise<void> } | undefined> {
  const shared = process.env["RAPT_E2E_DATABASE_URL"];
  if (shared === undefined) {
    const work = fileURLToPath(new URL(`./.generated/${name}-${process.pid}`, import.meta.url));
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    const server = startPostgresServer(work);
    if (server === undefined) {
      return undefined;
    }
    return {
      url: server.url,
      close: async () => {
        server.stop();
        rmSync(work, { recursive: true, force: true });
      },
    };
  }
  const database = `rapt_${name}_${process.pid}`;
  const admin = async (statement: string): Promise<void> => {
    const client = new pg.Client({ connectionString: shared });
    await client.connect();
    try {
      await client.query(statement);
    } finally {
      await client.end();
    }
  };
  await admin(`DROP DATABASE IF EXISTS "${database}"`);
  await admin(`CREATE DATABASE "${database}"`);
  const url = new URL(shared);
  url.pathname = `/${database}`;
  return { url: url.toString(), close: () => admin(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`) };
}

/**
 * The launchpad of the tests (D37), from a launchpad.json: the fixture application (its folder
 * generated by rapt build, reached at `appUrl`) behind it, three tiles; its UI written next to it.
 */
export function testLaunchpad(appDir: string, appUrl: string): { config: LaunchpadModel; uiDir: string } {
  const work = mkdtempSync(path.join(tmpdir(), "rapt-launchpad-"));
  const source = {
    title: "Travel Agency",
    apps: [{ id: "travel", build: appDir, url: appUrl }],
    groups: [
      {
        title: "Travel Management",
        tiles: [
          { title: "Manage Travels", subtitle: "Travels and bookings", icon: "sap-icon://flight", intent: "Travel-manage", app: "travel", count: "Travel", roles: ["travel_manager", "travel_agent", "travel_viewer"] },
          { title: "Open Travels", icon: "sap-icon://pending", intent: "Travel-approve", app: "travel", count: { entitySet: "Travel", filter: "OverallStatus eq 'O'" }, roles: ["travel_manager"] },
        ],
      },
      { title: "Help", tiles: [{ title: "Documentation", url: "https://github.com/clementringot/rap-transpiler", icon: "sap-icon://learning-assistant" }] },
    ],
  };
  writeFileSync(path.join(work, "launchpad.json"), JSON.stringify(source, null, 2));
  const diagnostics = new Diagnostics();
  const resolution = resolveLaunchpad(path.join(work, "launchpad.json"), diagnostics);
  if (resolution === undefined || diagnostics.items.length > 0) {
    throw new Error(`the launchpad of the tests does not resolve: ${JSON.stringify(diagnostics.items)}`);
  }
  writeFiles(path.join(work, "ui"), generateLaunchpadUi(resolution.model));
  return { config: resolution.model, uiDir: path.join(work, "ui") };
}

/** The Travel fixture as a draft BO (D54): `with draft`, draft tables, draft actions. */
export const DRAFT_CHANGES: Record<string, (content: string) => string> = {
  "zrt_r_travel.bdef.asbdef": (c) =>
    edit(c, [
      ["strict ( 2 );", "strict ( 2 );\nwith draft;"],
      ["persistent table zrt_travel", "persistent table zrt_travel\ndraft table zrt_d_travel"],
      ["etag master LocalLastChangedAt\n{\n  create;", "etag master LocalLastChangedAt\ntotal etag LastChangedAt\n{\n  create;"],
      ["  association _Booking { create; }", "  association _Booking { create; with draft; }\n\n  draft action Edit;\n  draft action Activate optimized;\n  draft action Discard;\n  draft action Resume;\n  draft determine action Prepare { validation validateDates; validation validateMandatory; }"],
      ["persistent table zrt_booking", "persistent table zrt_booking\ndraft table zrt_d_booking"],
      ["  association _Travel;\n\n  field ( numbering", "  association _Travel { with draft; }\n\n  field ( numbering"],
    ]),
  "zrt_c_travel.bdef.asbdef": (c) =>
    edit(c, [
      ["strict ( 2 );", "strict ( 2 );\nuse draft;"],
      ["  use action copyTravel;", "  use action copyTravel;\n\n  use action Edit;\n  use action Activate;\n  use action Discard;\n  use action Resume;\n  use action Prepare;"],
      ["  use association _Booking { create; }", "  use association _Booking { create; with draft; }"],
      ["  use association _Travel;", "  use association _Travel { with draft; }"],
    ]),
};
