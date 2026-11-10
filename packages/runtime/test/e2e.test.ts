/**
 * End to end on the reference fixture: `rapt build` (compiled CLI), `npm install` of the generated
 * application, `node server.mjs` on a real PostgreSQL, then the OData service and the UI as a
 * client sees them.
 *
 * Needs the built packages (`pnpm build`) and npm. The database: RAPT_E2E_DATABASE_URL, else a
 * PostgreSQL server started for the test when its binaries are installed (Debian/Ubuntu layout),
 * else the embedded PGlite of the application. Skipped when the packages are not built.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, chownSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_DIR } from "./helpers.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CLI = path.join(ROOT, "packages/compiler/dist/cli.js");
const BUILT = existsSync(CLI) && existsSync(path.join(ROOT, "packages/runtime/dist/index.js"));
const WORK = fileURLToPath(new URL(`./.generated/e2e-${process.pid}`, import.meta.url));
const APP = path.join(WORK, "app");
const SERVICE_PATH = "/sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001/";

let server: ChildProcess | undefined;
let base = "";
let stopDatabase: (() => void) | undefined;

/** A PostgreSQL server for the test: initdb in the work folder, as the postgres user. */
function startPostgres(): string | undefined {
  const versions = existsSync("/usr/lib/postgresql") ? readdirSync("/usr/lib/postgresql").sort() : [];
  const bin = versions.length === 0 ? undefined : `/usr/lib/postgresql/${versions[versions.length - 1]}/bin`;
  if (bin === undefined || process.getuid?.() !== 0) {
    return undefined;
  }
  try {
    const data = path.join(WORK, "pgdata");
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
    stopDatabase = () => asPostgres(`${bin}/pg_ctl -D ${data} -m fast stop`);
    return `postgres://postgres@127.0.0.1:${port}/postgres`;
  } catch {
    return undefined;
  }
}

async function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; json: Record<string, unknown> }> {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, json: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>) };
}

beforeAll(async () => {
  if (!BUILT) return;
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  execFileSync(process.execPath, [CLI, "build", FIXTURE_DIR, "--out", APP], { stdio: "pipe" });
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], { cwd: APP, stdio: "pipe" });
  const databaseUrl = process.env["RAPT_E2E_DATABASE_URL"] ?? startPostgres();
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PORT: "0", HOST: "127.0.0.1", LOG_LEVEL: "warn" };
  if (databaseUrl !== undefined) {
    env["DATABASE_URL"] = databaseUrl;
  } else {
    env["PGLITE_DIR"] = path.join(WORK, "pglite");
  }
  delete env["NODE_OPTIONS"];
  server = spawn(process.execPath, ["server.mjs"], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"] });
  base = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`the server did not start: ${output}`)), 60_000);
    const read = (chunk: Buffer): void => {
      output += chunk.toString();
      const m = /Service ready at (http:\/\/\S+)/.exec(output);
      if (m !== null) {
        clearTimeout(timer);
        resolve((m[1] as string).replace(/\/$/, ""));
      }
    };
    server?.stdout?.on("data", read);
    server?.stderr?.on("data", read);
    server?.on("exit", (code) => reject(new Error(`the server stopped (${code}): ${output}`)));
  });
}, 300_000);

afterAll(async () => {
  server?.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  stopDatabase?.();
  rmSync(WORK, { recursive: true, force: true });
});

describe.skipIf(!BUILT)("generated application, end to end", () => {
  let travel = "";

  it("is installable and serves its service, health and UI", async () => {
    expect((await request("GET", "/health")).json).toEqual({ status: "ok" });
    const metadata = await fetch(`${base}${SERVICE_PATH}$metadata`);
    expect(await metadata.text()).toContain('EntitySet Name="Travel"');
    const ui = await fetch(`${base}/ui/index.html`);
    expect(ui.status).toBe(200);
    const theme = await fetch(`${base}/resources/sap/m/themes/sap_horizon/library.css`);
    expect(theme.status).toBe(200);
  });

  it("creates a travel: numbering, determinations, admin fields", async () => {
    const created = await request("POST", `${SERVICE_PATH}Travel`, { TravelID: "00000500", AgencyID: "070001", CustomerID: "000001", BeginDate: "2027-05-01", EndDate: "2027-05-08", BookingFee: "40.00", CurrencyCode: "EUR", Description: "End to end" }, { accept: "application/json;IEEE754Compatible=true" });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ OverallStatus: "O", TotalPrice: "40.00", CreatedBy: "DEVELOPER" });
    travel = String(created.json["TravelUUID"]);
  });

  it("adds bookings in a change set and recalculates the total", async () => {
    const boundary = "batch_e2e";
    const changeset = "changeset_e2e";
    const part = (url: string, body: unknown, id: string): string =>
      [`--${changeset}`, "Content-Type:application/http", "Content-Transfer-Encoding:binary", `Content-ID:${id}`, "", `POST ${url} HTTP/1.1`, "Content-Type:application/json", "", JSON.stringify(body)].join("\r\n");
    const booking = (id: string, price: string) => ({ BookingID: id, CarrierID: "LH", ConnectionID: "0400", FlightDate: "2027-05-02", FlightPrice: price, CurrencyCode: "EUR" });
    const body = [`--${boundary}`, `Content-Type: multipart/mixed;boundary=${changeset}`, "", part(`Travel(${travel})/_Booking`, booking("0001", "100.00"), "1"), part(`Travel(${travel})/_Booking`, booking("0002", "60.50"), "2"), `--${changeset}--`, `--${boundary}--`, ""].join("\r\n");
    const response = await fetch(`${base}${SERVICE_PATH}$batch`, { method: "POST", headers: { "content-type": `multipart/mixed;boundary=${boundary}` }, body });
    const text = await response.text();
    expect(text.match(/HTTP\/1\.1 201/g)).toHaveLength(2);
    expect((await request("GET", `${SERVICE_PATH}Travel(${travel})`, undefined, { accept: "application/json;IEEE754Compatible=true" })).json["TotalPrice"]).toBe("200.50");
  });

  it("checks the ETag and runs an action under feature control", async () => {
    const current = await request("GET", `${SERVICE_PATH}Travel(${travel})`);
    expect((await request("PATCH", `${SERVICE_PATH}Travel(${travel})`, { Description: "stale" }, { "if-match": 'W/"1999-01-01T00:00:00.000000Z"' })).status).toBe(412);
    const accepted = await request("POST", `${SERVICE_PATH}Travel(${travel})/com.sap.gateway.srvd.zrt_ui_travel.v0001.acceptTravel`, {}, { "if-match": String(current.json["@odata.etag"]) });
    expect(accepted.status).toBe(200);
    expect(accepted.json["OverallStatus"]).toBe("A");
    expect((await request("POST", `${SERVICE_PATH}Travel(${travel})/com.sap.gateway.srvd.zrt_ui_travel.v0001.acceptTravel`, {}, { "if-match": "*" })).status).toBe(409);
  });

  it("rejects an invalid change with the validation message", async () => {
    const response = await request("PATCH", `${SERVICE_PATH}Travel(${travel})`, { EndDate: "2027-04-01" }, { "if-match": "*" });
    expect(response.status).toBe(400);
    expect(response.json).toMatchObject({ error: { message: "End date must not be before begin date", target: "EndDate" } });
  });

  it("shows the data in the UI", async () => {
    const require = createRequire(import.meta.url);
    let chromium: { launch(): Promise<{ newPage(): Promise<{ goto(u: string): Promise<unknown>; waitForSelector(s: string, o: { timeout: number }): Promise<unknown>; textContent(s: string): Promise<string | null> }>; close(): Promise<void> }> } | undefined;
    for (const id of [process.env["PLAYWRIGHT_MODULE"], "playwright", "/opt/node-tools/node_modules/playwright"]) {
      try {
        if (id !== undefined) {
          chromium = (require(id) as { chromium: typeof chromium }).chromium;
          break;
        }
      } catch {
        // next
      }
    }
    if (chromium === undefined) {
      return;
    }
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${base}/`);
      await page.waitForSelector("tr.sapMLIB.sapMListTblRow", { timeout: 60_000 });
      expect(await page.textContent("tr.sapMLIB.sapMListTblRow")).toContain("May 1, 2027");
    } finally {
      await browser.close();
    }
  }, 120_000);
});
