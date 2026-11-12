import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { agentServers, feedbackUrl, terminalShims, DevProcess, GENERATE_KINDS, groupObjects, launchpadNotice, launchpadSources, menuContext, projectObjects, unchosenFloorplans, wizardArgs, workspaceLaunchpad, type CatalogEntry, type LaunchpadAddResult, diagnosticPath, findProjectRoot, LineSplitter, parseDevEvent, position, resolveCli, runJson, summary, type DevEvent } from "../src/rapt.js";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE = path.join(REPO, "fixtures", "travel");

describe("rapt from the extension", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
  });

  function copy(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "rapt-vscode-"));
    cpSync(FIXTURE, dir, { recursive: true });
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  }

  it("finds the project of a file", () => {
    const files = new Set(["/w/bo/.abapgit.xml"].map((f) => path.resolve(f)));
    const exists = (p: string): boolean => files.has(p);
    expect(findProjectRoot("/w/bo/src/zr.bdef.asbdef", "/w", exists)).toBe(path.resolve("/w/bo"));
    expect(findProjectRoot("/w/bo/src/sub/zr.ddls.asddls", "/w", exists)).toBe(path.resolve("/w/bo"));
    // without .abapgit.xml: the parent of src
    expect(findProjectRoot("/w/other/src/zr.bdef.asbdef", "/w", exists)).toBe(path.resolve("/w/other"));
    expect(findProjectRoot("/w/notes.md", "/w", exists)).toBeUndefined();
  });

  it("resolves the CLI", () => {
    const repo = path.resolve("/repo/packages/compiler/dist/cli.js");
    const bundled = path.resolve("/ext/rapt/node_modules/@open-rap/compiler/dist/cli.js");
    const vscodeNode = { command: "/vscode/code", env: { ELECTRON_RUN_AS_NODE: "1" } };
    const base = { workspaceFolders: ["/repo"], execPath: "/vscode/code" };
    // the rapt of the extension, on the Node.js of VS Code
    expect(resolveCli({ ...base, bundledCli: bundled }, (p) => p === bundled || p === repo)).toEqual({ ...vscodeNode, args: [bundled] });
    // without it: a clone of the workspace
    expect(resolveCli(base, (p) => p === repo)).toEqual({ ...vscodeNode, args: [repo] });
    // the setting first, on the configured Node.js
    expect(resolveCli({ ...base, bundledCli: bundled, cliPath: "/repo", nodePath: "/opt/node22/bin/node" }, (p) => p === bundled || p === repo)).toEqual({ command: "/opt/node22/bin/node", args: [repo] });
    expect(resolveCli({ ...base, workspaceFolders: ["/elsewhere"] }, () => false)).toEqual({ command: "rapt", args: [] });
  });

  it("reads JSON lines", () => {
    const lines = new LineSplitter();
    expect(lines.push('{"type":"build')).toEqual([]);
    expect(lines.push('ing","root":"/x"}\r\nnot json\n')).toEqual(['{"type":"building","root":"/x"}', "not json"]);
    expect(parseDevEvent('{"type":"building","root":"/x"}')).toEqual({ type: "building", root: "/x" });
    expect(parseDevEvent("not json")).toEqual({ type: "log", stream: "stdout", line: "not json" });
    expect(position({ severity: "error", code: "X", message: "", line: 3, column: 5 })).toEqual({ line: 2, character: 4 });
    expect(position({ severity: "error", code: "X", message: "" })).toEqual({ line: 0, character: 0 });
    expect(diagnosticPath("/w/bo", { severity: "error", code: "X", message: "", file: "src/a.abap" })).toBe(path.join("/w/bo", "src", "a.abap"));
    expect(summary({ error: 1, warning: 2, info: 0 })).toBe("1 error, 2 warnings");
  });

  it("runs rapt check --json", async () => {
    const dir = copy();
    const cli = resolveCli({ workspaceFolders: [REPO], execPath: process.execPath, nodePath: process.execPath });
    expect(cli.args[0]).toBe(path.join(REPO, "packages", "compiler", "dist", "cli.js"));
    const ok = await runJson(cli, ["check", dir], dir);
    expect(ok).toMatchObject({ command: "check", ok: true, counts: { error: 0 } });
    rmSync(path.join(dir, "src", "zrt_ui_travel.srvd.srvdsrv"));
    const failed = await runJson(cli, ["check", dir], dir);
    expect(failed.ok).toBe(false);
    await expect(runJson(cli, ["check", path.join(dir, "missing")], dir)).rejects.toThrow(/rapt check failed/);
  });

  it("runs rapt dev --json until stopped", async () => {
    const dir = copy();
    const events: DevEvent[] = [];
    const port = 20000 + Math.floor(Math.random() * 20000);
    const dev = new DevProcess(resolveCli({ workspaceFolders: [REPO], execPath: process.execPath, nodePath: process.execPath }), dir, port, (e) => events.push(e), () => undefined);
    cleanups.push(() => dev.stop());
    await expect.poll(() => events.find((e) => e.type === "ready"), { timeout: 60_000, interval: 200 }).toEqual({ type: "ready", url: `http://localhost:${port}/` });
    expect((await fetch(`http://localhost:${port}/ui/index.html`)).status).toBe(200);
    await dev.stop();
    expect(dev.running).toBe(false);
    await expect(fetch(`http://localhost:${port}/ui/index.html`)).rejects.toThrow();
  });
});

describe("rapt generate in VS Code", () => {
  it("lists the objects of the project by kind", () => {
    const objects = projectObjects(["/p/src/zrt_travel.tabl.astabl", "/p/src/zrt_travel.tabl.xml", "/p/src/zrt_r_travel.ddls.asddls", "/p/src/zrt_r_travel.ddls.xml", "/p/src/zrt_r_travel.bdef.asbdef", "/p/src/zrt_ui_travel.srvd.srvdsrv", "/p/src/readme.md"]);
    expect(objects).toEqual({ table: ["zrt_travel"], entity: ["ZRT_R_TRAVEL"], bdef: ["ZRT_R_TRAVEL"], srvd: ["ZRT_UI_TRAVEL"], domain: [] });
  });

  it("proposes the names RAP uses", () => {
    const name = (kind: string, source: string): string | undefined => GENERATE_KINDS.find((k) => k.kind === kind)?.name?.(source);
    expect(name("view", "zrt_travel")).toBe("ZR_Travel");
    expect(name("projection", "ZRT_R_TRAVEL")).toBe("ZRT_C_TRAVEL");
    expect(name("pool", "ZRT_R_TRAVEL")).toBe("ZBP_RT_R_TRAVEL");
    expect(name("binding", "ZRT_UI_TRAVEL")).toBe("ZRT_UI_TRAVEL_O4");
    expect(name("service", "ZRT_C_TRAVEL")).toBe("ZUI_TRAVEL");
  });
});

describe("the creation wizard and the objects view (D61)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function copy(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "rapt-wizard-"));
    cpSync(fileURLToPath(new URL("../../../fixtures/travel", import.meta.url)), dir, { recursive: true, filter: (f) => !f.includes(`${path.sep}.rapt`) });
    dirs.push(dir);
    return dir;
  }
  const cli = resolveCli({ workspaceFolders: [REPO], execPath: process.execPath, nodePath: process.execPath });

  it("reads the catalog of rapt generate and turns the answers into a command line", async () => {
    const dir = copy();
    const { kinds } = await runJson<{ kinds: CatalogEntry[] }>(cli, ["generate", dir], dir);
    expect(kinds.map((k) => k.category)).toContain("Core Data Services");
    const binding = kinds.find((k) => k.kind === "binding") as CatalogEntry;
    expect(wizardArgs(dir, binding, "ZAPI_TRAVEL_O4", "Travel API", { "--for": "ZRT_UI_TRAVEL", "--binding-type": "webapi" })).toEqual(["generate", dir, "binding", "ZAPI_TRAVEL_O4", "--for", "ZRT_UI_TRAVEL", "--binding-type", "webapi", "--description", "Travel API"]);
    expect(wizardArgs(dir, binding, "ZAPI", "", {})).toBe("Service definition: required");
    expect(wizardArgs(dir, binding, "9bad", "", {})).toMatch(/letters/);
    const service = kinds.find((k) => k.kind === "service") as CatalogEntry;
    expect(wizardArgs(dir, service, "ZUI_X", "", { "--expose": ["ZRT_C_TRAVEL", "ZRT_C_BOOKING"] })).toEqual(["generate", dir, "service", "ZUI_X", "--expose", "ZRT_C_TRAVEL,ZRT_C_BOOKING"]);
    const view = kinds.find((k) => k.kind === "view") as CatalogEntry;
    const args = wizardArgs(dir, view, "ZR_Order", "", { "--from": "zrt_travel", "--root": "true" }) as string[];
    expect(args).toEqual(["generate", dir, "view", "ZR_Order", "--from", "zrt_travel", "--root"]);
    expect(await runJson(cli, args.slice(0, 1).concat(args.slice(1)), dir)).toMatchObject({ ok: true, written: expect.arrayContaining(["src/zr_order.ddls.asddls"]) });
    const element = kinds.find((k) => k.kind === "dataelement") as CatalogEntry;
    expect(await runJson(cli, wizardArgs(dir, element, "ZRT_ORDER_NO", "Order number", { "--type": "abap.numc(8)" }) as string[], dir)).toMatchObject({ ok: true, written: ["src/zrt_order_no.dtel.xml"] });
    const bo = kinds.find((k) => k.kind === "bo") as CatalogEntry;
    expect(wizardArgs(dir, bo, "Order", "Orders", { "--prefix": "ZOR" })).toEqual(["new", dir, "Order", "--prefix", "ZOR", "--description", "Orders"]);
  });

  it("sets the floorplan of an entity set with rapt floorplan", async () => {
    const dir = copy();
    expect(await runJson(cli, ["floorplan", dir], dir)).toMatchObject({ sets: [{ set: "Travel", floorplan: "listReport", chosen: false }], floorplans: expect.arrayContaining([expect.objectContaining({ floorplan: "worklist" })]) });
    expect(await runJson(cli, ["floorplan", dir, "Travel", "worklist"], dir)).toMatchObject({ ok: true, file: "rapt/config.json" });
    expect(await runJson(cli, ["floorplan", dir], dir)).toMatchObject({ sets: [{ set: "Travel", floorplan: "worklist", chosen: true }] });
    // the default, once chosen, is kept: the application can be generated without asking again (D63)
    await runJson(cli, ["floorplan", dir, "Travel", "listReport"], dir);
    const answer = await runJson<{ sets: Array<{ set: string; chosen: boolean }> }>(cli, ["floorplan", dir], dir);
    expect(answer.sets).toEqual([{ set: "Travel", floorplan: "listReport", chosen: true }]);
    expect(unchosenFloorplans(answer.sets)).toEqual([]);
    expect(unchosenFloorplans([{ set: "Travel", chosen: true }, { set: "Agency", chosen: false }])).toEqual(["Agency"]);
    expect(await runJson(cli, ["floorplan", dir, "Nope", "worklist"], dir)).toMatchObject({ ok: false });
  });

  it("adds the applications to the single launchpad of the workspace (D69)", async () => {
    // a saved .code-workspace keeps it next to itself, else the first folder has it
    expect(workspaceLaunchpad([path.resolve("/w/a"), path.resolve("/w/b")], path.resolve("/w/apps.code-workspace"))).toBe(path.resolve("/w/launchpad.json"));
    expect(workspaceLaunchpad([path.resolve("/w/a"), path.resolve("/w/b")])).toBe(path.resolve("/w/a/launchpad.json"));
    expect(workspaceLaunchpad([])).toBeUndefined();

    const dir = copy();
    const file = path.join(dir, "launchpad.json");
    const result = await runJson<{ ok: boolean; launchpad: LaunchpadAddResult }>(cli, ["floorplan", dir, "Travel", "worklist", "--launchpad", file], dir);
    expect(result.launchpad).toMatchObject({ file, created: true, added: true, app: { id: path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, "-"), source: "." } });
    expect(launchpadNotice(result.launchpad)).toContain("added to the launchpad (created)");
    const again = await runJson<LaunchpadAddResult>(cli, ["launchpad", "add", dir, "--launchpad", file], dir);
    expect(again).toMatchObject({ added: false });
    expect(launchpadNotice(again)).toBeUndefined();
    expect(launchpadSources(file, readFileSync(file, "utf8"))).toEqual([path.resolve(dir)]);
    expect(launchpadSources(file, "{")).toEqual([]);
  });

  it("enables the commands of the folders of a project, and of an application once a service is defined (D63)", () => {
    const p = (f: string): string => path.resolve(f);
    const { projects, apps } = menuContext([p("/w/bo/.abapgit.xml"), p("/w/bo/src/sub/zr.ddls.asddls"), p("/w/bo/src/zui.srvd.srvdsrv"), p("/w/lib/src/zcl.clas.abap"), p("/w/notes/a.abap")]);
    expect(Object.keys(projects).sort()).toEqual([p("/w/bo"), p("/w/bo/.abapgit.xml"), p("/w/bo/src"), p("/w/bo/src/sub"), p("/w/lib"), p("/w/lib/.abapgit.xml"), p("/w/lib/src")].sort());
    expect(Object.keys(apps).sort()).toEqual([p("/w/bo"), p("/w/bo/.abapgit.xml"), p("/w/bo/src"), p("/w/bo/src/sub")].sort());
    expect(menuContext([])).toEqual({ projects: {}, apps: {} });
  });

  it("groups the objects as the project explorer of ADT", () => {
    expect(groupObjects(["/p/src/zt.tabl.astabl", "/p/src/zt.tabl.xml", "/p/src/zr.ddls.asddls", "/p/src/zr.ddls.xml", "/p/src/zs.drty.acds", "/p/src/zbp.clas.abap", "/p/src/zbp.clas.locals_imp.abap", "/p/src/zui.srvb.xml"])).toEqual({
      ddic: ["/p/src/zt.tabl.astabl"],
      cds: ["/p/src/zr.ddls.asddls", "/p/src/zs.drty.acds"],
      abap: ["/p/src/zbp.clas.abap"],
      srvb: ["/p/src/zui.srvb.xml"],
    });
  });

  it("puts rapt on the PATH of the terminals with a shim that runs the CLI of the extension (D64)", () => {
    expect(terminalShims({ command: "rapt", args: [] })).toEqual([]);
    const cliJs = path.join(REPO, "packages", "compiler", "dist", "cli.js");
    const shims = terminalShims({ command: process.execPath, args: [cliJs], env: { ELECTRON_RUN_AS_NODE: "1" } });
    expect(shims.map((s) => s.name)).toEqual(["rapt", "rapt.cmd"]);
    expect(shims[1]?.content).toContain('set "ELECTRON_RUN_AS_NODE=1"');
    expect(shims[1]?.content).toContain(`"${cliJs}" %*`);
    if (process.platform !== "win32") {
      const bin = mkdtempSync(path.join(tmpdir(), "rapt-bin-"));
      try {
        writeFileSync(path.join(bin, "rapt"), shims[0]?.content ?? "");
        chmodSync(path.join(bin, "rapt"), 0o755);
        const out = execFileSync("sh", ["-c", "rapt check \"$0\" --json", FIXTURE], { env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}` }, encoding: "utf8" });
        expect(JSON.parse(out)).toMatchObject({ command: "check", ok: true });
      } finally {
        rmSync(bin, { recursive: true, force: true });
      }
    }
  }, 60_000);

  it("offers rapt agent to the agent mode of VS Code, one server per workspace folder (D64)", () => {
    const cli = { command: "/vscode/code", args: ["/ext/cli.js"], env: { ELECTRON_RUN_AS_NODE: "1" } };
    expect(agentServers(cli, [{ name: "shop", path: "/w/shop" }])).toEqual([
      { label: "rapt (Open RAP Runtime)", command: "/vscode/code", args: ["/ext/cli.js", "agent", "/w/shop"], env: { ELECTRON_RUN_AS_NODE: "1" }, cwd: "/w/shop" },
    ]);
    expect(agentServers(cli, [{ name: "a", path: "/a" }, { name: "b", path: "/b" }]).map((s) => s.label)).toEqual(["rapt (Open RAP Runtime): a", "rapt (Open RAP Runtime): b"]);
  });

  it("opens the feedback form of the website with the version and the environment (D71)", () => {
    const url = new URL(feedbackUrl("bug", "0.1.0", "VS Code 1.105.0 on linux (x64)"));
    expect(url.origin + url.pathname).toBe("https://clementringot.github.io/RAP-Transpiler/feedback.html");
    expect(Object.fromEntries(url.searchParams)).toEqual({ kind: "bug", version: "0.1.0", environment: "VS Code 1.105.0 on linux (x64)" });
  });
});
