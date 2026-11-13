import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DevSession, linkFolder, realPath, runtimeDependencies, type DevEvent } from "../src/dev.js";
import { fixtureVariant, freePort } from "./helpers.js";

const SERVICE = "sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001";
const TRAVEL = { TravelID: "00000001", AgencyID: "070001", CustomerID: "000001", BeginDate: "2027-05-01", EndDate: "2027-05-08", BookingFee: "40.00", CurrencyCode: "EUR" };

async function createTravel(base: string, travel: Record<string, string>): Promise<Record<string, unknown>> {
  const head = await fetch(`${base}${SERVICE}/`, { headers: { "x-csrf-token": "fetch" } });
  const token = head.headers.get("x-csrf-token") ?? "";
  const cookie = head.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const response = await fetch(`${base}${SERVICE}/Travel`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": token, cookie },
    body: JSON.stringify(travel),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Record<string, unknown>;
}

async function count(base: string): Promise<number> {
  return Number(await (await fetch(`${base}${SERVICE}/Travel/$count`)).text());
}

describe("rapt dev", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  async function session(dir: string, lines: string[]): Promise<{ dev: DevSession; base: string }> {
    const port = await freePort();
    const dev = new DevSession(dir, { port, env: { ...process.env, DATABASE_URL: "", LOG_LEVEL: "error" }, out: (l) => lines.push(l), err: (l) => lines.push(l) });
    cleanups.push(() => dev.close());
    return { dev, base: `http://localhost:${port}/` };
  }

  it("builds, serves with PGlite, keeps the previous build on errors, resets the database on schema changes", async () => {
    const variant = fixtureVariant({});
    cleanups.push(variant.cleanup);
    const lines: string[] = [];
    const { dev, base } = await session(variant.dir, lines);

    expect((await dev.rebuild()).ok).toBe(true);
    expect(lines).toContain(`rapt dev: ready at ${base}`);
    expect(dev.outDir).toBe(path.join(realPath(variant.dir), ".rapt", "dev"));
    expect(lstatSync(path.join(dev.outDir, "node_modules")).isSymbolicLink()).toBe(true);
    expect(existsSync(path.join(dev.outDir, "vendor"))).toBe(false);
    expect((await fetch(`${base}ui/index.html`)).status).toBe(200);
    // the development launchpad (D49): at /, with the documentation app and the shell bar config
    expect((await fetch(base, { redirect: "manual" })).headers.get("location")).toBe("/home/index.html");
    expect((await fetch(`${base}home/index.html`)).status).toBe(200);
    expect((await fetch(`${base}docs/pages.json`)).status).toBe(200);
    expect(((await (await fetch(`${base}launchpad/config`)).json()) as { spaces: unknown[] }).spaces).toHaveLength(1);
    // the behavior pool runs (determination setStatusOpen)
    expect((await createTravel(base, TRAVEL))["OverallStatus"]).toBe("O");

    // a change of the behavior pool: the data is kept
    const pool = path.join(variant.dir, "src", "zbp_rt_r_travel.clas.locals_imp.abap");
    writeFileSync(pool, readFileSync(pool, "utf8").replace("VALUE 'O'", "VALUE 'N'"));
    expect((await dev.rebuild()).ok).toBe(true);
    expect(await count(base)).toBe(1);
    expect((await createTravel(base, { ...TRAVEL, TravelID: "00000002" }))["OverallStatus"]).toBe("N");

    // an error: positioned diagnostics, the previous build keeps running
    const bdef = path.join(variant.dir, "src", "zrt_r_travel.bdef.asbdef");
    const source = readFileSync(bdef, "utf8");
    writeFileSync(bdef, source.replace("lock master", "lock mastr"));
    const failed = await dev.rebuild();
    expect(failed.ok).toBe(false);
    expect(lines.some((l) => /^src\/zrt_r_travel\.bdef\.asbdef:\d+:\d+: error BDEF/.test(l))).toBe(true);
    expect(lines.at(-1)).toBe("rapt dev: build failed, the previous build keeps running");
    expect(await count(base)).toBe(2);
    writeFileSync(bdef, source);

    // a change of the schema: the development database is reset
    const table = path.join(variant.dir, "src", "zrt_travel.tabl.xml");
    writeFileSync(table, readFileSync(table, "utf8").replace("<LENG>000256</LENG>", "<LENG>000300</LENG>"));
    expect((await dev.rebuild()).ok).toBe(true);
    expect(lines).toContain("rapt dev: the database schema changed, the development database is reset");
    expect(await count(base)).toBe(0);
  });

  it("rebuilds on changes, also of a file replaced by a rename", async () => {
    const variant = fixtureVariant({});
    cleanups.push(variant.cleanup);
    const lines: string[] = [];
    const { dev } = await session(variant.dir, lines);
    await dev.watch();
    const ready = (): number => lines.filter((l) => l.startsWith("rapt dev: ready")).length;
    expect(ready()).toBe(1);

    const ddlx = path.join(variant.dir, "src", "zrt_c_travel.ddlx.asddlxs");
    for (let i = 2; i <= 3; i++) {
      // editors save by writing a temporary file and renaming it over the source
      writeFileSync(`${ddlx}.tmp`, `${readFileSync(ddlx, "utf8")}\n`);
      renameSync(`${ddlx}.tmp`, ddlx);
      await expect.poll(ready, { timeout: 60_000, interval: 200 }).toBe(i);
    }
    expect(lines).toContain("rapt dev: src/zrt_c_travel.ddlx.asddlxs changed");
  });

  it("reports events (rapt dev --json)", async () => {
    const variant = fixtureVariant({});
    cleanups.push(variant.cleanup);
    const events: DevEvent[] = [];
    const port = await freePort();
    const dev = new DevSession(variant.dir, { port, env: { ...process.env, DATABASE_URL: "", LOG_LEVEL: "error" }, events: (e) => events.push(e) });
    cleanups.push(() => dev.close());
    expect((await dev.rebuild()).ok).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["building", "diagnostics", "ready"]);
    expect(events[2]).toEqual({ type: "ready", url: `http://localhost:${port}/` });
  });

  it("finds the dependencies of the runtime, in a pnpm workspace or installed flat", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rapt-deps-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    // pnpm: packages/runtime/node_modules
    mkdirSync(path.join(root, "repo", "packages", "runtime", "node_modules", "@abaplint", "runtime"), { recursive: true });
    expect(runtimeDependencies(path.join(root, "repo", "packages", "runtime"))).toBe(path.join(root, "repo", "packages", "runtime", "node_modules"));
    // npm, flat (the VS Code extension): rapt/node_modules
    mkdirSync(path.join(root, "rapt", "node_modules", "@open-rap", "runtime"), { recursive: true });
    mkdirSync(path.join(root, "rapt", "node_modules", "@abaplint", "runtime"), { recursive: true });
    expect(runtimeDependencies(path.join(root, "rapt", "node_modules", "@open-rap", "runtime"))).toBe(path.join(root, "rapt", "node_modules"));
    expect(runtimeDependencies(path.join(root, "nothing"))).toBeUndefined();
  });

  it("links node_modules again, replacing a link to another folder and keeping a real folder", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rapt-link-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    mkdirSync(path.join(first, "a"), { recursive: true });
    mkdirSync(path.join(second, "b"), { recursive: true });
    const link = path.join(root, "out", "node_modules");
    mkdirSync(path.dirname(link));
    linkFolder(link, first);
    expect(existsSync(path.join(link, "a"))).toBe(true);
    // the same folder, written differently (drive letter case on Windows): kept
    linkFolder(link, process.platform === "win32" ? swapDriveCase(first) : first);
    expect(existsSync(path.join(link, "a"))).toBe(true);
    // another folder: the link is replaced (a junction on Windows), its target untouched
    linkFolder(link, second);
    expect(existsSync(path.join(link, "b"))).toBe(true);
    expect(existsSync(path.join(first, "a"))).toBe(true);
    // a real folder: kept
    const real = path.join(root, "real");
    mkdirSync(real);
    linkFolder(real, first);
    expect(lstatSync(real).isSymbolicLink()).toBe(false);
  });
});

function swapDriveCase(file: string): string {
  const drive = file.charAt(0);
  return (drive === drive.toLowerCase() ? drive.toUpperCase() : drive.toLowerCase()) + file.slice(1);
}
