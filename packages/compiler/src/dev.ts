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
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generateApplication, writeFiles, type GenerateOptions } from "./build.js";
import { formatDiagnostic, type Diagnostics } from "./diagnostics.js";
import { packageDir } from "./gen/vendor.js";
import { loadProject } from "./input/project.js";

export interface DevOptions extends Omit<GenerateOptions, "scaffold" | "transpile"> {
  /** Folder of the development build (default: `<src>/.rapt/dev`). */
  outDir?: string;
  /** Port of the application (default: PORT of the environment, else 8080). */
  port?: number;
  /** Environment of the application (default: process.env). */
  env?: Record<string, string | undefined>;
  /** Output of the session (default: stdout and stderr). */
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export interface RebuildResult {
  ok: boolean;
  diagnostics?: Diagnostics;
}

/** Folders written by a build; the others (data/, node_modules) are kept between builds. */
const GENERATED = ["model", "db", "odata", "abap", "ui"];
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

  /** The URL of the generated UI. */
  public get uiUrl(): string {
    return `http://localhost:${this.port}/ui/index.html`;
  }

  /** Builds the application; on success, (re)starts the server. A failed build keeps the running server. */
  public async rebuild(): Promise<RebuildResult> {
    this.out(`rapt dev: building ${this.root}`);
    const runtimeNodeModules = this.runtimeDir === undefined ? undefined : path.join(this.runtimeDir, "node_modules");
    if (runtimeNodeModules === undefined || !existsSync(runtimeNodeModules)) {
      this.err("rapt dev: the @rap-transpiler/runtime package (built, with its node_modules) is needed: run pnpm install and pnpm build, or give --runtime <dir>");
      return this.failed();
    }
    let result: Awaited<ReturnType<typeof generateApplication>>;
    try {
      const { outDir: _out, port: _port, env: _env, out: _o, err: _e, ...generate } = this.options;
      result = await generateApplication(loadProject(this.root), { ...generate, scaffold: false });
    } catch (e) {
      this.err(`rapt dev: ${(e as Error).message}`);
      return this.failed();
    }
    const { diagnostics, files } = result;
    const counts = { error: 0, warning: 0, info: 0 };
    for (const d of diagnostics.sorted()) {
      counts[d.severity]++;
      (d.severity === "error" ? this.err : this.out)(formatDiagnostic(d));
    }
    this.out(`rapt dev: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info`);
    if (files.length === 0) {
      return this.failed(diagnostics);
    }
    await this.stopServer();
    for (const folder of GENERATED) {
      rmSync(path.join(this.outDir, folder), { recursive: true, force: true });
    }
    writeFiles(this.outDir, files);
    this.linkNodeModules(runtimeNodeModules);
    writeFileSync(path.join(this.outDir, "dev-server.mjs"), devServer(pathToFileURL(path.join(this.runtimeDir!, "dist", "index.js")).href));
    this.resetDatabaseOnSchemaChange();
    if (!(await this.startServer())) {
      this.out("rapt dev: server failed, waiting for changes");
      return { ok: false, diagnostics };
    }
    this.out(`rapt dev: ready at ${this.uiUrl}`);
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
      this.out(`rapt dev: ${relative.split(path.sep).join("/")} changed`);
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
    this.out(this.server === undefined ? "rapt dev: build failed, waiting for changes" : "rapt dev: build failed, the previous build keeps running");
    return diagnostics === undefined ? { ok: false } : { ok: false, diagnostics };
  }

  /** node_modules of the build: a link (a junction on Windows) to the runtime's. */
  private linkNodeModules(target: string): void {
    const link = path.join(this.outDir, "node_modules");
    if (existsSync(link) || isLink(link)) {
      if (!isLink(link)) {
        return; // a real folder, installed by the user: kept
      }
      if (path.resolve(this.outDir, readlinkSync(link)) === path.resolve(target)) {
        return;
      }
      rmSync(link, { force: true });
    }
    symlinkSync(target, link, "junction");
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
      this.out("rapt dev: the database schema changed, the development database is reset");
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
      HOST: this.env["HOST"] ?? "127.0.0.1",
      LOG_LEVEL: this.env["LOG_LEVEL"] ?? "warn",
      AUTH_MODE: this.env["AUTH_MODE"] ?? "none",
      ...(dir === undefined ? {} : { PGLITE_DIR: dir }),
    };
    const child = spawn(process.execPath, [path.join(this.outDir, "dev-server.mjs")], { cwd: this.outDir, env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    this.server = child;
    return new Promise((resolve) => {
      let ready = false;
      const forward = (stream: NodeJS.ReadableStream | null, write: (line: string) => void): void => {
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
              write(line);
            }
          }
        });
      };
      forward(child.stdout, this.out);
      forward(child.stderr, this.err);
      child.once("exit", (code) => {
        if (this.server === child) {
          this.server = undefined;
        }
        if (!ready) {
          resolve(false);
        } else if (code !== 0 && code !== null) {
          this.err(`rapt dev: the server stopped (exit code ${code})`);
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
