/**
 * `rapt dev`: development loop (decision D38). Builds the application from the sources, starts it
 * with an embedded PGlite database, then rebuilds and restarts it on every change of the sources.
 *
 * The application is written without its scaffold (no vendor/, no npm install): its node_modules
 * is a link to the node_modules of the @rap-transpiler/runtime package, which holds the transpiler
 * runtime, PGlite and OpenUI5. The server runs in a child process, because the transpiled ABAP
 * sets global state (the `abap` object) and ES modules cannot be unloaded.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generateApplication, writeFiles, type GenerateOptions } from "./build.js";
import { countDiagnostics, formatDiagnostic, type Diagnostic, type Diagnostics } from "./diagnostics.js";
import { packageDir } from "./gen/vendor.js";
import { loadProject } from "./input/project.js";
import { generateDocsApp } from "./gen/docs/index.js";
import { generateLaunchpadUi } from "./gen/launchpad/index.js";
import { buildUiLayout } from "./gen/ui/index.js";
import type { LaunchpadModel, LaunchpadTile, Model } from "@rap-transpiler/model";

export interface DevOptions extends Omit<GenerateOptions, "scaffold" | "transpile"> {
  /** Folder of the development build (default: `<src>/.rapt/dev`). */
  outDir?: string;
  /** Port of the application (default: PORT of the environment, else 8080). */
  port?: number;
  /** Interface the server listens on (default: HOST of the environment, else 127.0.0.1; 0.0.0.0: the network). */
  host?: string;
  /** Environment of the application (default: process.env). */
  env?: Record<string, string | undefined>;
  /** Output of the session (default: stdout and stderr). */
  out?: (line: string) => void;
  err?: (line: string) => void;
  /** Events of the session (`rapt dev --json`); replaces the text output. */
  events?: (event: DevEvent) => void;
}

export type DiagnosticCounts = Record<Diagnostic["severity"], number>;

/** What happens in a session, for tools (`rapt dev --json`, the VS Code extension). */
export type DevEvent =
  | { type: "building"; root: string }
  | { type: "changed"; file: string }
  | { type: "diagnostics"; diagnostics: Diagnostic[]; counts: DiagnosticCounts }
  | { type: "error"; message: string }
  | { type: "failed"; running: boolean }
  | { type: "database-reset" }
  | { type: "ready"; url: string }
  | { type: "server-failed" }
  | { type: "server-stopped"; code: number }
  | { type: "log"; stream: "stdout" | "stderr"; line: string };

/** The text of an event (`rapt dev` without --json); undefined for no output. */
export function formatDevEvent(event: DevEvent): { line: string; error: boolean } | undefined {
  switch (event.type) {
    case "building":
      return { line: `rapt dev: building ${event.root}`, error: false };
    case "changed":
      return { line: `rapt dev: ${event.file} changed`, error: false };
    case "diagnostics":
      return undefined; // one line per diagnostic, see DevSession.emit
    case "error":
      return { line: `rapt dev: ${event.message}`, error: true };
    case "failed":
      return { line: event.running ? "rapt dev: build failed, the previous build keeps running" : "rapt dev: build failed, waiting for changes", error: false };
    case "database-reset":
      return { line: "rapt dev: the database schema changed, the development database is reset", error: false };
    case "ready":
      return { line: `rapt dev: ready at ${event.url}`, error: false };
    case "server-failed":
      return { line: "rapt dev: server failed, waiting for changes", error: false };
    case "server-stopped":
      return { line: `rapt dev: the server stopped (exit code ${event.code})`, error: true };
    case "log":
      return { line: event.line, error: event.stream === "stderr" };
  }
}

export interface RebuildResult {
  ok: boolean;
  diagnostics?: Diagnostics;
}

/** Folders written by a build; the others (data/, node_modules) are kept between builds. */
const GENERATED = ["model", "db", "odata", "abap", "ui", "mcp", "home", "docs"];
const READY = "rapt-dev-ready";
const SCHEMA_STAMP = ".schema.sql";

export class DevSession {
  public readonly root: string;
  public readonly outDir: string;
  public readonly port: number;
  private readonly env: Record<string, string | undefined>;
  private readonly out: (line: string) => void;
  private readonly err: (line: string) => void;
  private readonly runtimeDir: string | undefined;
  private server: ChildProcess | undefined;
  /** One watcher per folder: the recursive fs.watch of Linux loses files replaced by a rename. */
  private readonly watchers = new Map<string, FSWatcher>();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private pending = false;
  private closed = false;

  public constructor(
    source: string,
    private readonly options: DevOptions = {},
  ) {
    this.root = path.resolve(source);
    this.outDir = path.resolve(options.outDir ?? path.join(this.root, ".rapt", "dev"));
    this.env = options.env ?? process.env;
    this.port = options.port ?? Number(this.env["PORT"] ?? 8080);
    this.out = options.out ?? ((line) => process.stdout.write(`${line}\n`));
    this.err = options.err ?? ((line) => process.stderr.write(`${line}\n`));
    this.runtimeDir = packageDir("@rap-transpiler/runtime", "runtime", options.runtimeDir);
  }

  /** The URL of the development launchpad (the application, the documentation). */
  public get uiUrl(): string {
    return `http://localhost:${this.port}/`;
  }

  /** Builds the application; on success, (re)starts the server. A failed build keeps the running server. */
  public async rebuild(): Promise<RebuildResult> {
    this.emit({ type: "building", root: this.root });
    const runtimeNodeModules = this.runtimeDir === undefined ? undefined : runtimeDependencies(this.runtimeDir);
    if (runtimeNodeModules === undefined) {
      this.emit({ type: "error", message: "the @rap-transpiler/runtime package (built, with its node_modules) is needed: run pnpm install and pnpm build, or give --runtime <dir>" });
      return this.failed();
    }
    let result: Awaited<ReturnType<typeof generateApplication>>;
    try {
      const { outDir: _out, port: _port, host: _host, env: _env, out: _o, err: _e, events: _ev, ...generate } = this.options;
      result = await generateApplication(loadProject(this.root), { ...generate, scaffold: false });
    } catch (e) {
      this.emit({ type: "error", message: (e as Error).message });
      return this.failed();
    }
    const { diagnostics, files } = result;
    const sorted = diagnostics.sorted();
    this.emit({ type: "diagnostics", diagnostics: sorted, counts: countDiagnostics(sorted) });
    if (files.length === 0) {
      return this.failed(diagnostics);
    }
    await this.stopServer();
    for (const folder of GENERATED) {
      rmSync(path.join(this.outDir, folder), { recursive: true, force: true });
    }
    writeFiles(this.outDir, files);
    if (result.model !== undefined) {
      // the development launchpad and the documentation app (D49)
      const launchpad = devLaunchpadModel(result.model, files.some((f) => f.path === "mcp/tools.json"));
      writeFiles(path.join(this.outDir, "home"), [...generateLaunchpadUi(launchpad), { path: "launchpad.json", content: `${JSON.stringify(launchpad, null, 2)}\n` }]);
      writeFiles(path.join(this.outDir, "docs"), generateDocsApp());
    }
    this.linkNodeModules(runtimeNodeModules);
    writeFileSync(path.join(this.outDir, "dev-server.mjs"), devServer(pathToFileURL(path.join(this.runtimeDir!, "dist", "index.js")).href));
    this.resetDatabaseOnSchemaChange();
    if (!(await this.startServer())) {
      this.emit({ type: "server-failed" });
      return { ok: false, diagnostics };
    }
    this.emit({ type: "ready", url: this.uiUrl });
    return { ok: true, diagnostics };
  }

  /** Rebuilds once, then on every change of the sources until close(). */
  public async watch(): Promise<void> {
    await this.schedule();
    if (this.closed) {
      return;
    }
    this.watchFolders();
  }

  /** Stops watching and the server. */
  public async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    await this.running;
    await this.stopServer();
  }

  private emit(event: DevEvent): void {
    if (this.options.events !== undefined) {
      this.options.events(event);
      return;
    }
    if (event.type === "diagnostics") {
      for (const d of event.diagnostics) {
        (d.severity === "error" ? this.err : this.out)(formatDiagnostic(d));
      }
      this.out(`rapt dev: ${event.counts.error} error(s), ${event.counts.warning} warning(s), ${event.counts.info} info`);
      return;
    }
    const text = formatDevEvent(event);
    if (text !== undefined) {
      (text.error ? this.err : this.out)(text.line);
    }
  }

  /** Watches the folders of the project; called again on each change for new or removed folders. */
  private watchFolders(): void {
    const folders = new Set<string>();
    const walk = (dir: string): void => {
      folders.add(dir);
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && this.isSource(path.relative(this.root, full))) {
          walk(full);
        }
      }
    };
    walk(this.root);
    for (const [dir, watcher] of this.watchers) {
      if (!folders.has(dir)) {
        watcher.close();
        this.watchers.delete(dir);
      }
    }
    for (const dir of folders) {
      if (this.watchers.has(dir)) {
        continue;
      }
      try {
        const watcher = watch(dir, (_event, file) => this.changed(path.relative(this.root, path.join(dir, file?.toString() ?? ""))));
        watcher.on("error", () => {
          watcher.close();
          this.watchers.delete(dir);
        });
        this.watchers.set(dir, watcher);
      } catch {
        // removed in the meantime
      }
    }
  }

  private changed(relative: string): void {
    if (this.closed || relative === "" || !this.isSource(relative)) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.watchFolders();
      this.emit({ type: "changed", file: relative.split(path.sep).join("/") });
      void this.schedule();
    }, 150);
  }

  /** Runs one rebuild at a time; changes during a rebuild give one more rebuild after it. */
  private async schedule(): Promise<void> {
    if (this.running !== undefined) {
      this.pending = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.pending = false;
        await this.rebuild();
      } while (this.pending && !this.closed);
    })().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /** A file of the project (not the build folder, dot folders or node_modules). */
  private isSource(relative: string): boolean {
    const absolute = path.resolve(this.root, relative);
    if (absolute === this.outDir || absolute.startsWith(this.outDir + path.sep)) {
      return false;
    }
    const segments = relative.split(/[\\/]/);
    return !segments.some((s, i) => s === "node_modules" || (s.startsWith(".") && !(i === 0 && s === ".abapgit.xml")));
  }

  private failed(diagnostics?: Diagnostics): RebuildResult {
    this.emit({ type: "failed", running: this.server !== undefined });
    return diagnostics === undefined ? { ok: false } : { ok: false, diagnostics };
  }

  /** node_modules of the build: a link (a junction on Windows) to the runtime's. */
  private linkNodeModules(target: string): void {
    linkFolder(path.join(this.outDir, "node_modules"), target);
  }

  private get pgliteDir(): string | undefined {
    const url = this.env["DATABASE_URL"];
    return url !== undefined && url !== "" ? undefined : path.join(this.outDir, "data");
  }

  /** The PGlite database is dropped when the schema changed (development data). */
  private resetDatabaseOnSchemaChange(): void {
    const dir = this.pgliteDir;
    if (dir === undefined) {
      return;
    }
    const schema = readFileSync(path.join(this.outDir, "db", "schema.sql"), "utf8");
    const stamp = path.join(this.outDir, SCHEMA_STAMP);
    const previous = existsSync(stamp) ? readFileSync(stamp, "utf8") : undefined;
    if (existsSync(dir) && previous !== schema) {
      this.emit({ type: "database-reset" });
      rmSync(dir, { recursive: true, force: true });
    }
    writeFileSync(stamp, schema);
  }

  private startServer(): Promise<boolean> {
    mkdirSync(this.outDir, { recursive: true });
    const dir = this.pgliteDir;
    const env: Record<string, string | undefined> = {
      ...this.env,
      PORT: String(this.port),
      HOST: this.options.host ?? this.env["HOST"] ?? "127.0.0.1",
      LOG_LEVEL: this.env["LOG_LEVEL"] ?? "warn",
      AUTH_MODE: this.env["AUTH_MODE"] ?? "none",
      // the development OAuth 2.0 server: Web API calls with client credentials or PKCE (D60)
      DEV_OAUTH: this.env["DEV_OAUTH"] ?? "on",
      // seed data of rapt/seed.json, rapt/seed.sql at the first start (D42)
      SEED: this.env["SEED"] ?? "auto",
      ...(dir === undefined ? {} : { PGLITE_DIR: dir }),
    };
    const child = spawn(process.execPath, [path.join(this.outDir, "dev-server.mjs")], { cwd: this.outDir, env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    this.server = child;
    return new Promise((resolve) => {
      let ready = false;
      const forward = (stream: NodeJS.ReadableStream | null, name: "stdout" | "stderr"): void => {
        let buffer = "";
        stream?.setEncoding("utf8");
        stream?.on("data", (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!ready && line.startsWith(READY)) {
              ready = true;
              resolve(true);
            } else if (line !== "") {
              this.emit({ type: "log", stream: name, line });
            }
          }
        });
      };
      forward(child.stdout, "stdout");
      forward(child.stderr, "stderr");
      child.once("exit", (code) => {
        if (this.server === child) {
          this.server = undefined;
        }
        if (!ready) {
          resolve(false);
        } else if (code !== 0 && code !== null) {
          this.emit({ type: "server-stopped", code });
        }
      });
    });
  }

  private async stopServer(): Promise<void> {
    const child = this.server;
    if (child === undefined || child.exitCode !== null) {
      this.server = undefined;
      return;
    }
    this.server = undefined;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    // a graceful close (PGlite flushes its files), then a kill
    try {
      child.send("close", () => undefined);
    } catch {
      child.kill();
    }
    const timeout = setTimeout(() => child.kill(), 5000);
    await exited;
    clearTimeout(timeout);
  }
}

/**
 * The development launchpad (D49): the application (with the number of instances of its list),
 * the documentation of rap-transpiler, the $metadata of the service and, with rapt/mcp.json, the
 * MCP server.
 */
export function devLaunchpadModel(model: Model, mcp: boolean): LaunchpadModel {
  const layout = buildUiLayout(model);
  const tile = (t: Omit<LaunchpadTile, "external" | "roles"> & { external?: boolean }): LaunchpadTile => ({ external: false, roles: [], ...t });
  // a Web API (D60) has no UI: its service document
  const webApi = model.service.webApi === true;
  const application = tile({
    id: "app",
    title: webApi ? model.service.name : layout.title,
    subtitle: webApi ? "OData V4 - Web API" : model.service.name,
    icon: webApi ? "sap-icon://chain-link" : "sap-icon://product",
    target: webApi ? model.service.path : "/ui/index.html",
    ...(webApi ? { external: true } : {}),
    ...(layout.start === "" ? {} : { count: `${model.service.path}${layout.start}/$count` }),
  });
  const tools = [
    tile({ id: "docs", title: "Documentation", subtitle: "rap-transpiler", icon: "sap-icon://learning-assistant", target: "/docs/index.html" }),
    tile({ id: "metadata", title: "Service metadata", subtitle: "OData V4 $metadata", icon: "sap-icon://source-code", target: `${model.service.path}$metadata`, external: true }),
    tile({ id: "oauth", title: "OAuth 2.0 (development)", subtitle: "Client credentials, PKCE", info: "/oauth", icon: "sap-icon://locked", target: "/oauth/.well-known/openid-configuration", external: true }),
    ...(mcp ? [tile({ id: "mcp", title: "MCP server", subtitle: "Tools for AI agents", info: "/mcp", icon: "sap-icon://da", target: "/docs/index.html#/page/mcp" })] : []),
  ];
  const sections = [
    { title: "Application", tiles: [application] },
    { title: "Development tools", tiles: tools },
  ];
  return {
    title: `${layout.title} – rapt dev`,
    apps: [],
    groups: sections,
    spaces: [{ id: "dev", title: "Development", roles: [], pages: [{ id: "dev", title: "Development", sections }] }],
    claims: [],
    roles: [],
  };
}

/**
 * The node_modules folder that holds the dependencies of the runtime (@abaplint/runtime, OpenUI5,
 * PGlite), searched like Node.js does: its own (pnpm workspace), then those of the parent folders
 * (npm installation, flat, as in the VS Code extension).
 */
export function runtimeDependencies(runtimeDir: string): string | undefined {
  let dir = path.resolve(runtimeDir);
  for (;;) {
    const candidate = path.basename(dir) === "node_modules" ? dir : path.join(dir, "node_modules");
    if (existsSync(path.join(candidate, "@abaplint", "runtime"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Links `link` to the folder `target` (a junction on Windows), replacing a link to another folder.
 * A real folder at `link` (installed by the user) is kept.
 */
export function linkFolder(link: string, target: string): void {
  if (existsSync(link) || isLink(link)) {
    if (!isLink(link)) {
      return;
    }
    if (samePath(path.resolve(path.dirname(link), readlinkSync(link)), target)) {
      return;
    }
    // unlinkSync removes the link itself; rmSync fails on a junction (ERR_FS_EISDIR, Node.js 24)
    unlinkSync(link);
  }
  symlinkSync(target, link, "junction");
}

/** Paths are case-insensitive on Windows: `c:\` from VS Code, `C:\` read back from a junction. */
function samePath(a: string, b: string): boolean {
  const [x, y] = [path.resolve(a), path.resolve(b)];
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

function isLink(file: string): boolean {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The server of the development build: the runtime of the repository, closed on a message. */
function devServer(runtimeUrl: string): string {
  return `// Generated by rapt dev: starts the development build with the runtime of rap-transpiler.
import { fileURLToPath } from "node:url";
import { start } from ${JSON.stringify(runtimeUrl)};

const server = await start({ dir: fileURLToPath(new URL(".", import.meta.url)) });
const close = () => server.close().then(() => process.exit(0), () => process.exit(1));
process.on("message", (message) => message === "close" && close());
process.on("disconnect", close);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, close);
}
console.log(${JSON.stringify(READY)});
`;
}
