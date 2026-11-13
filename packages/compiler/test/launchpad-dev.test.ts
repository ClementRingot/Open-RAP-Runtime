/**
 * `rapt launchpad dev` (D75): the applications of launchpad.json run from their sources on the
 * ports of their urls, behind the launchpad, regenerated when launchpad.json changes.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { launchpadDevPlan, LaunchpadDevSession, type LaunchpadDevEvent } from "../src/launchpad/dev.js";
import { fixtureVariant } from "./helpers.js";

/**
 * Ports no other process listens on, given by the system: random ports collided with the servers
 * of the other test files running at the same time (EADDRINUSE).
 */
async function freePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(
    Array.from({ length: count }, () => new Promise<ReturnType<typeof createServer>>((resolve) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => resolve(server));
    })),
  );
  const ports = servers.map((s) => (s.address() as { port: number }).port);
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  return ports;
}

const SERVICE = "/sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001/";

describe("rapt launchpad dev", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  function workspace(apps: unknown[], folders: string[] = []): string {
    const ws = mkdtempSync(path.join(tmpdir(), "rapt-launchpad-dev-"));
    cleanups.push(() => rmSync(ws, { recursive: true, force: true }));
    for (const folder of folders) mkdirSync(path.join(ws, folder));
    const file = path.join(ws, "launchpad.json");
    writeFileSync(file, JSON.stringify({ title: "Launchpad", apps, groups: [] }));
    return file;
  }

  it("runs each application with sources on the local port of its url", () => {
    const file = workspace(
      [
        { id: "travel", source: "travel", url: "http://localhost:8081/" },
        { id: "remote", build: "out/remote", url: "http://localhost:8085/" },
      ],
      ["travel"],
    );
    const { apps, diagnostics } = launchpadDevPlan(file);
    expect(apps).toEqual([{ id: "travel", root: path.join(path.dirname(file), "travel"), port: 8081, url: "http://localhost:8081/" }]);
    // without sources: not started, reached at its url
    expect(diagnostics.items.map((d) => `${d.severity} ${d.code}`)).toEqual(["warning LPD010"]);
  });

  it("refuses what cannot run locally (LPD009, LPD010)", () => {
    const codes = (apps: unknown[], folders: string[]): string[] => launchpadDevPlan(workspace(apps, folders)).diagnostics.items.map((d) => `${d.severity} ${d.code}: ${d.message}`);
    expect(codes([{ id: "a", source: "a", url: "https://travel.example.com/" }], ["a"])).toEqual([expect.stringMatching(/^error LPD010: .*a local one/)]);
    expect(codes([{ id: "a", source: "a", url: "http://localhost/" }], ["a"])).toEqual([expect.stringMatching(/^error LPD010/)]);
    expect(codes([{ id: "a", source: "a", url: "http://localhost:8090/" }], ["a"])).toEqual([expect.stringMatching(/^error LPD010: .*port of the launchpad/)]);
    expect(
      codes(
        [
          { id: "a", source: "a", url: "http://localhost:8081/" },
          { id: "b", source: "b", url: "http://127.0.0.1:8081/" },
        ],
        ["a", "b"],
      ),
    ).toEqual([expect.stringMatching(/^error LPD010: the applications a and b have the same port 8081/)]);
    expect(codes([{ id: "a", source: "missing", url: "http://localhost:8081/" }], [])).toEqual([expect.stringMatching(/^error LPD009/)]);
    expect(codes([], [])).toEqual([expect.stringMatching(/^error LPD010: no application/)]);
  });

  it("serves the applications behind the launchpad, regenerated when launchpad.json changes", async () => {
    const variant = fixtureVariant({});
    cleanups.push(variant.cleanup);
    const [port, appPort] = (await freePorts(2)) as [number, number];
    const file = workspace([]);
    const source = { title: "Launchpad", apps: [{ id: "travel", source: variant.dir, url: `http://localhost:${appPort}/` }], groups: [{ title: "Applications", tiles: [{ app: "travel", count: "Travel" }] }] };
    writeFileSync(file, JSON.stringify(source));
    const events: LaunchpadDevEvent[] = [];
    const session = new LaunchpadDevSession(file, { port, env: { ...process.env, DATABASE_URL: "", LOG_LEVEL: "error" }, events: (e) => events.push(e) });
    cleanups.push(() => session.close());
    const base = `http://localhost:${port}`;

    expect(await session.start()).toBe(true);
    expect(events).toContainEqual({ type: "launchpad-ready", url: `${base}/` });
    expect(events).toContainEqual(expect.objectContaining({ type: "ready", app: "travel", url: `http://localhost:${appPort}/` }));
    expect(readFileSync(path.join(path.dirname(file), ".rapt", "launchpad", "launchpad", "config.json"), "utf8")).toContain(SERVICE);
    // the launchpad, the UI of the application and its service, through the launchpad
    const config = (await (await fetch(`${base}/launchpad/config`)).json()) as { groups: Array<{ tiles: Array<{ title: string; count?: string }> }> };
    expect(config.groups[0]?.tiles[0]).toMatchObject({ title: "Travels", count: `${SERVICE}Travel/$count` });
    expect((await fetch(`${base}/apps/travel/ui/index.html`)).status).toBe(200);
    expect(await (await fetch(`${base}${SERVICE}Travel/$count`)).text()).toBe("0");

    // a change of launchpad.json: the launchpad is generated again
    writeFileSync(file, JSON.stringify({ ...source, groups: [{ title: "Voyages", tiles: [{ app: "travel", title: "Mes voyages" }] }] }));
    await expect
      .poll(async () => ((await (await fetch(`${base}/launchpad/config`).catch(() => undefined))?.json().catch(() => undefined)) as { groups?: Array<{ title: string }> } | undefined)?.groups?.[0]?.title, { timeout: 30_000, interval: 200 })
      .toBe("Voyages");

    await session.close();
    await expect(fetch(`${base}/launchpad/config`)).rejects.toThrow();
    await expect(fetch(`http://localhost:${appPort}/ui/index.html`)).rejects.toThrow();
  }, 120_000);

  it("reports a launchpad that cannot be written, and generates it on the next change", async () => {
    const variant = fixtureVariant({});
    cleanups.push(variant.cleanup);
    const [port, appPort] = (await freePorts(2)) as [number, number];
    const file = workspace([]);
    const source = { title: "Launchpad", apps: [{ id: "travel", source: variant.dir, url: `http://localhost:${appPort}/` }], groups: [] };
    writeFileSync(file, JSON.stringify(source));
    // a file where the folder of the launchpad goes: writing it fails
    const outDir = path.join(path.dirname(file), "out");
    writeFileSync(outDir, "");
    const events: LaunchpadDevEvent[] = [];
    const session = new LaunchpadDevSession(file, { port, outDir, env: { ...process.env, DATABASE_URL: "", LOG_LEVEL: "error" }, events: (e) => events.push(e) });
    cleanups.push(() => session.close());

    expect(await session.start()).toBe(true);
    expect(events).toContainEqual({ type: "launchpad-failed", message: expect.stringMatching(/^the launchpad could not be generated: /) });
    expect(events.some((e) => e.type === "launchpad-ready")).toBe(false);

    // the folder can be written now: the next change of launchpad.json generates the launchpad
    rmSync(outDir);
    mkdirSync(outDir);
    writeFileSync(file, JSON.stringify({ ...source, title: "Workspace" }));
    await expect.poll(() => events.some((e) => e.type === "launchpad-ready"), { timeout: 30_000, interval: 200 }).toBe(true);
    await expect(session.close()).resolves.toBeUndefined();
  }, 120_000);
});
