/**
 * `rapt launchpad dev <launchpad.json>`: the launchpad of the workspace in development (decision
 * D75). Each application with sources (`source`) runs as in `rapt dev` (built, embedded PGlite,
 * rebuilt on change) on the port of its `url`; the launchpad runs in front of them, as the
 * generated one (`rapt launchpad`, `npm start`), and is generated again when launchpad.json or the
 * service of an application changes. Nothing to install, no Docker: one command for every
 * application of the workspace.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { countDiagnostics, Diagnostics, formatDiagnostic, type Diagnostic } from "../diagnostics.js";
import { DevSession, devEventLines, linkFolder, READY, realPath, runtimeDependencies, type DevEvent, type DiagnosticCounts } from "../dev.js";
import { generateLaunchpadUi } from "../gen/launchpad/index.js";
import { packageDir } from "../gen/vendor.js";
import { resolveLaunchpad, type BuiltApp } from "./config.js";
import { LAUNCHPAD_PORT } from "./workspace.js";

/** An application of launchpad.json that rapt launchpad dev runs from its sources. */
export interface DevApp {
  id: string;
  /** The folder of its sources. */
  root: string;
  /** The port of its url, where it runs. */
  port: number;
  url: string;
  service?: string;
}

export interface DevPlan {
  apps: DevApp[];
  diagnostics: Diagnostics;
}

const ID = /^[a-z][a-z0-9-]*$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The applications of a launchpad.json run by rapt launchpad dev: those with sources, each on the
 * local port of its url (LPD010 when it cannot be). Those without sources (`build`, `url` only) are
 * reached at their url, where they must already run.
 */
export function launchpadDevPlan(file: string, launchpadPort: number = LAUNCHPAD_PORT): DevPlan {
  const diagnostics = new Diagnostics();
  const at = { file };
  let entries: unknown[] = [];
  try {
    const source = JSON.parse(readFileSync(file, "utf8")) as { apps?: unknown } | null;
    entries = Array.isArray(source?.apps) ? source.apps : [];
  } catch (error) {
    diagnostics.error("LPD001", `launchpad.json cannot be read: ${(error as Error).message}`, at);
    return { apps: [], diagnostics };
  }
  const base = path.dirname(path.resolve(file));
  const apps: DevApp[] = [];
  for (const entry of entries as Array<Record<string, unknown> | null>) {
    const id = entry?.["id"];
    if (typeof id !== "string" || !ID.test(id)) {
      continue; // reported by resolveLaunchpad (LPD001)
    }
    const url = typeof entry?.["url"] === "string" ? entry["url"] : "";
    const source = entry?.["source"];
    if (typeof source !== "string" || source.trim() === "" || entry?.["build"] !== undefined) {
      diagnostics.warning("LPD010", `the application ${id} has no sources (source): rapt launchpad dev does not start it, it must already run at ${url || "its url"}`, at);
      continue;
    }
    const root = path.resolve(base, source);
    if (!existsSync(root)) {
      diagnostics.error("LPD009", `the application ${id}: no folder ${source} (source, relative to launchpad.json)`, at);
      continue;
    }
    let parsed: URL | undefined;
    try {
      parsed = new URL(url);
    } catch {
      parsed = undefined;
    }
    const port = parsed === undefined ? Number.NaN : Number(parsed.port);
    if (parsed === undefined || parsed.protocol !== "http:" || !LOCAL_HOSTS.has(parsed.hostname) || !Number.isInteger(port) || port <= 0) {
      diagnostics.error("LPD010", `the application ${id}: rapt launchpad dev runs it on the port of its url, a local one (http://localhost:<port>/), not ${JSON.stringify(url)}`, at);
      continue;
    }
    if (port === launchpadPort) {
      diagnostics.error("LPD010", `the application ${id}: port ${port} is the port of the launchpad; give it another one in its url`, at);
      continue;
    }
    const other = apps.find((a) => a.port === port);
    if (other !== undefined) {
      diagnostics.error("LPD010", `the applications ${other.id} and ${id} have the same port ${port}; give each one its own in its url`, at);
      continue;
    }
    const service = entry?.["service"];
    apps.push({ id, root, port, url: `http://localhost:${port}/`, ...(typeof service === "string" ? { service } : {}) });
  }
  if (apps.length === 0 && !diagnostics.hasErrors()) {
    diagnostics.error("LPD010", "no application of launchpad.json has sources (source) to run: add one with rapt launchpad add <project>", at);
  }
  return { apps, diagnostics };
}

export interface LaunchpadDevOptions {
  /** Port of the launchpad (default 8090). */
  port?: number;
  /** Interface of the launchpad and of the applications (default: HOST, else 127.0.0.1). */
  host?: string;
  /** Folder of the development launchpad (default: `.rapt/launchpad` next to launchpad.json). */
  outDir?: string;
  /** @open-rap/runtime package (default: next to the compiler). */
  runtimeDir?: string;
  env?: Record<string, string | undefined>;
  out?: (line: string) => void;
  err?: (line: string) => void;
  /** Events (`rapt launchpad dev --json`); replaces the text output. */
  events?: (event: LaunchpadDevEvent) => void;
}

/** What happens in a session: the events of each application (with its id), and of the launchpad. */
export type LaunchpadDevEvent =
  | { type: "apps"; file: string; apps: Array<{ id: string; root: string; url: string }> }
  | { type: "launchpad-diagnostics"; diagnostics: Array<Diagnostic & { path?: string }>; counts: DiagnosticCounts }
  | { type: "launchpad-waiting"; apps: string[] }
  | { type: "launchpad-ready"; url: string }
  | { type: "launchpad-failed"; message: string }
  | (DevEvent & { app?: string });

export class LaunchpadDevSession {
  public readonly file: string;
  public readonly outDir: string;
  public readonly port: number;
  private readonly env: Record<string, string | undefined>;
  private readonly host: string;
  private readonly out: (line: string) => void;
  private readonly err: (line: string) => void;
  private readonly runtimeDir: string | undefined;
  private readonly sessions = new Map<string, { app: DevApp; session: DevSession }>();
  private server: ChildProcess | undefined;
  private config: string | undefined;
  private watcher: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private refreshing: Promise<void> = Promise.resolve();
  private started = false;
  private closed = false;

  public constructor(
    file: string,
    private readonly options: LaunchpadDevOptions = {},
  ) {
    this.file = realPath(path.resolve(file));
    this.outDir = path.resolve(options.outDir ?? path.join(path.dirname(this.file), ".rapt", "launchpad"));
    this.port = options.port ?? LAUNCHPAD_PORT;
    this.env = options.env ?? process.env;
    this.host = options.host ?? this.env["HOST"] ?? "127.0.0.1";
    this.out = options.out ?? ((line) => process.stdout.write(`${line}\n`));
    this.err = options.err ?? ((line) => process.stderr.write(`${line}\n`));
    this.runtimeDir = packageDir("@open-rap/runtime", "runtime", options.runtimeDir);
  }

  /** The URL of the launchpad. */
  public get url(): string {
    return `http://localhost:${this.port}/`;
  }

  /** The applications running, by id. */
  public get apps(): DevApp[] {
    return [...this.sessions.values()].map((s) => s.app);
  }

  /**
   * Starts the applications (one first build each), then the launchpad, and watches launchpad.json.
   * False when launchpad.json does not allow it (LPD diagnostics), nothing is started then.
   */
  public async start(): Promise<boolean> {
    if (!(await this.reconcile())) {
      return false;
    }
    this.started = true;
    await this.scheduleRefresh();
    if (!this.closed) {
      this.watchFile();
    }
    return true;
  }

  public async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = undefined;
    await this.refreshing;
    await Promise.all([...this.sessions.values()].map((s) => s.session.close()));
    this.sessions.clear();
    await this.stopServer();
  }

  private emit(event: LaunchpadDevEvent): void {
    if (this.options.events !== undefined) {
      this.options.events(event);
      return;
    }
    switch (event.type) {
      case "apps":
        this.out(`rapt launchpad dev: ${event.apps.map((a) => `${a.id} at ${a.url}`).join(", ")}`);
        return;
      case "launchpad-diagnostics":
        for (const d of event.diagnostics) {
          (d.severity === "error" ? this.err : this.out)(formatDiagnostic(d));
        }
        return;
      case "launchpad-waiting":
        this.out(`rapt launchpad dev: the launchpad waits for ${event.apps.join(", ")} to build`);
        return;
      case "launchpad-ready":
        this.out(`rapt launchpad dev: launchpad ready at ${event.url}`);
        return;
      case "launchpad-failed":
        this.err(`rapt launchpad dev: ${event.message}`);
        return;
    }
    const prefix = event.app === undefined ? "" : `[${event.app}] `;
    for (const text of devEventLines(event)) {
      (text.error ? this.err : this.out)(`${prefix}${text.line}`);
    }
  }

  /** The applications of launchpad.json: those added are started, those removed or moved stopped. */
  private async reconcile(): Promise<boolean> {
    const plan = launchpadDevPlan(this.file, this.port);
    if (plan.diagnostics.items.length > 0) {
      this.emitDiagnostics(plan.diagnostics);
    }
    if (plan.diagnostics.hasErrors()) {
      return false;
    }
    const key = (a: DevApp): string => JSON.stringify([a.root, a.port, a.service ?? ""]);
    for (const [id, running] of this.sessions) {
      const next = plan.apps.find((a) => a.id === id);
      if (next === undefined || key(next) !== key(running.app)) {
        this.sessions.delete(id);
        await running.session.close();
      }
    }
    this.emit({ type: "apps", file: this.file, apps: plan.apps.map((a) => ({ id: a.id, root: a.root, url: a.url })) });
    for (const app of plan.apps) {
      if (this.closed || this.sessions.has(app.id)) {
        continue;
      }
      const session = new DevSession(app.root, {
        port: app.port,
        host: this.host,
        env: this.env,
        ...(app.service === undefined ? {} : { service: app.service }),
        ...(this.options.runtimeDir === undefined ? {} : { runtimeDir: this.options.runtimeDir }),
        events: (event) => this.onAppEvent(app, event),
      });
      this.sessions.set(app.id, { app, session });
      // one application at a time: the first builds share the processor
      await session.watch();
    }
    return true;
  }

  private onAppEvent(app: DevApp, event: DevEvent): void {
    this.emit({ ...event, app: app.id });
    // a new service (path, entity sets, title) changes the launchpad
    if (event.type === "ready" && this.started) {
      void this.scheduleRefresh();
    }
  }

  private emitDiagnostics(diagnostics: Diagnostics): void {
    const sorted = diagnostics.sorted().map((d) => (d.file === undefined ? d : { ...d, path: path.resolve(path.dirname(this.file), d.file) }));
    this.emit({ type: "launchpad-diagnostics", diagnostics: sorted, counts: countDiagnostics(sorted) });
  }

  private watchFile(): void {
    const name = path.basename(this.file);
    try {
      // the folder, not the file: editors replace the file when they save it
      this.watcher = watch(path.dirname(this.file), (_event, changed) => {
        if (changed?.toString() !== name || this.closed) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.emit({ type: "changed", file: name });
          void this.scheduleRefresh(true);
        }, 150);
      });
      this.watcher.on("error", () => this.watcher?.close());
    } catch {
      // the folder was removed
    }
  }

  /**
   * One refresh at a time, in order. A refresh that throws (a file that cannot be written) is
   * reported and does not stop the next ones: the chain never rejects.
   */
  private scheduleRefresh(reconcile = false): Promise<void> {
    this.refreshing = this.refreshing
      .then(async () => {
        if (this.closed) return;
        if (reconcile && !(await this.reconcile())) {
          this.emit({ type: "launchpad-failed", message: "launchpad.json has errors, the previous launchpad keeps running" });
          return;
        }
        await this.refresh();
      })
      .catch((error: unknown) => {
        this.config = undefined;
        this.emit({ type: "launchpad-failed", message: `the launchpad could not be generated: ${error instanceof Error ? error.message : String(error)}` });
      });
    return this.refreshing;
  }

  /** Generates the launchpad from launchpad.json and the running applications; restarts it when it changed. */
  private async refresh(): Promise<void> {
    const waiting = [...this.sessions.values()].filter((s) => s.session.model === undefined).map((s) => s.app.id);
    if (waiting.length > 0) {
      this.emit({ type: "launchpad-waiting", apps: waiting });
      return;
    }
    const built = new Map<string, BuiltApp>();
    for (const { app, session } of this.sessions.values()) {
      const title = uiTitle(session.outDir);
      built.set(app.id, { dir: session.outDir, model: session.model!, ...(title === undefined ? {} : { title }) });
    }
    const diagnostics = new Diagnostics();
    const resolution = resolveLaunchpad(this.file, diagnostics, { built });
    this.emitDiagnostics(diagnostics);
    if (resolution === undefined || diagnostics.hasErrors()) {
      this.emit({ type: "launchpad-failed", message: this.server === undefined ? "launchpad.json has errors, the launchpad is not started" : "launchpad.json has errors, the previous launchpad keeps running" });
      return;
    }
    const config = `${JSON.stringify(resolution.model, null, 2)}\n`;
    if (config === this.config && this.server !== undefined) {
      return;
    }
    const runtimeNodeModules = this.runtimeDir === undefined ? undefined : runtimeDependencies(this.runtimeDir);
    if (runtimeNodeModules === undefined) {
      this.emit({ type: "launchpad-failed", message: "the @open-rap/runtime package (built, with its node_modules) is needed: run pnpm install and pnpm build, or give --runtime <dir>" });
      return;
    }
    await this.stopServer();
    mkdirSync(path.join(this.outDir, "launchpad"), { recursive: true });
    writeFileSync(path.join(this.outDir, "launchpad", "config.json"), config);
    for (const f of generateLaunchpadUi(resolution.model)) {
      const target = path.join(this.outDir, "ui", ...f.path.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, f.content);
    }
    linkFolder(path.join(this.outDir, "node_modules"), runtimeNodeModules);
    writeFileSync(path.join(this.outDir, "launchpad-server.mjs"), launchpadServer(pathToFileURL(path.join(this.runtimeDir!, "dist", "index.js")).href));
    if (await this.startServer()) {
      this.config = config;
      this.emit({ type: "launchpad-ready", url: this.url });
    } else {
      this.config = undefined;
      this.emit({ type: "launchpad-failed", message: `the launchpad did not start (port ${this.port} in use?)` });
    }
  }

  private startServer(): Promise<boolean> {
    const env: Record<string, string | undefined> = {
      ...this.env,
      PORT: String(this.port),
      HOST: this.host,
      PUBLIC_URL: this.url,
      LOG_LEVEL: this.env["LOG_LEVEL"] ?? "warn",
      AUTH_MODE: this.env["AUTH_MODE"] ?? "none",
    };
    const child = spawn(process.execPath, [path.join(this.outDir, "launchpad-server.mjs")], { cwd: this.outDir, env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
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
      child.once("exit", () => {
        if (this.server === child) this.server = undefined;
        if (!ready) resolve(false);
      });
    });
  }

  private async stopServer(): Promise<void> {
    const child = this.server;
    this.server = undefined;
    if (child === undefined || child.exitCode !== null) {
      return;
    }
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
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

/** The title of the UI of a build (`sap.app.title`). */
function uiTitle(dir: string): string | undefined {
  try {
    const title = (JSON.parse(readFileSync(path.join(dir, "ui", "manifest.json"), "utf8")) as { "sap.app"?: { title?: string } })["sap.app"]?.title;
    return typeof title === "string" && title !== "" ? title : undefined;
  } catch {
    return undefined;
  }
}

/** The server of the development launchpad: the launchpad of the runtime, closed on a message. */
function launchpadServer(runtimeUrl: string): string {
  return `// Generated by rapt launchpad dev: starts the launchpad with the runtime of Open RAP Runtime.
import { fileURLToPath } from "node:url";
import { startLaunchpad } from ${JSON.stringify(runtimeUrl)};

const launchpad = await startLaunchpad({ dir: fileURLToPath(new URL(".", import.meta.url)) });
const close = () => launchpad.close().then(() => process.exit(0), () => process.exit(1));
process.on("message", (message) => message === "close" && close());
process.on("disconnect", close);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, close);
}
console.log(${JSON.stringify(READY)});
`;
}
