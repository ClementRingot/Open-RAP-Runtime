import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DevProcess, diagnosticPath, findProjectRoot, LineSplitter, parseDevEvent, position, resolveCli, runJson, summary, type DevEvent } from "../src/rapt.js";

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
    const exists = (p: string): boolean => p === path.resolve("/repo/packages/compiler/dist/cli.js");
    expect(resolveCli({ workspaceFolders: ["/repo"] }, exists)).toEqual({ command: "node", args: [path.resolve("/repo/packages/compiler/dist/cli.js")] });
    expect(resolveCli({ cliPath: "/repo", nodePath: "/opt/node22/bin/node", workspaceFolders: [] }, exists)).toEqual({ command: "/opt/node22/bin/node", args: [path.resolve("/repo/packages/compiler/dist/cli.js")] });
    expect(resolveCli({ workspaceFolders: ["/elsewhere"] }, exists)).toEqual({ command: "rapt", args: [] });
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
    expect(summary({ error: 1, warning: 2, info: 0 })).toBe("1 erreur, 2 avertissements");
  });

  it("runs rapt check --json", async () => {
    const dir = copy();
    const cli = resolveCli({ workspaceFolders: [REPO] });
    expect(cli.command).toBe("node");
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
    const dev = new DevProcess(resolveCli({ workspaceFolders: [REPO] }), dir, port, (e) => events.push(e), () => undefined);
    cleanups.push(() => dev.stop());
    await expect.poll(() => events.find((e) => e.type === "ready"), { timeout: 60_000, interval: 200 }).toEqual({ type: "ready", url: `http://localhost:${port}/ui/index.html` });
    expect((await fetch(`http://localhost:${port}/ui/index.html`)).status).toBe(200);
    await dev.stop();
    expect(dev.running).toBe(false);
    await expect(fetch(`http://localhost:${port}/ui/index.html`)).rejects.toThrow();
  });
});
