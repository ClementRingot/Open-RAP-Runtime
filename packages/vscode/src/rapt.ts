/**
 * The rapt command line seen from the extension, without the VS Code API (unit-tested): where
 * a project is, where the CLI is, how to run it and how to read its JSON output (`--json`).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type Severity = "error" | "warning" | "info";

export interface RaptDiagnostic {
  severity: Severity;
  code: string;
  message: string;
  /** Relative to the project root, with forward slashes. */
  file?: string;
  /** Absolute path (`--json`). */
  path?: string;
  /** 1-based. */
  line?: number;
  /** 1-based. */
  column?: number;
}

export type Counts = Record<Severity, number>;

/** Result of `rapt check --json` and `rapt build --json`. */
export interface RaptResult {
  command: string;
  ok: boolean;
  root: string;
  out?: string;
  files?: number;
  counts: Counts;
  diagnostics: RaptDiagnostic[];
}

/** An event of `rapt dev --json`. */
export type DevEvent =
  | { type: "building"; root: string }
  | { type: "changed"; file: string }
  | { type: "diagnostics"; diagnostics: RaptDiagnostic[]; counts: Counts }
  | { type: "error"; message: string }
  | { type: "failed"; running: boolean }
  | { type: "database-reset" }
  | { type: "ready"; url: string }
  | { type: "server-failed" }
  | { type: "server-stopped"; code: number }
  | { type: "log"; stream: "stdout" | "stderr"; line: string };

/** How to start the CLI: `node <cli.js>`, or a `rapt` command found on the PATH. */
export interface Cli {
  command: string;
  args: string[];
  /** Added to the environment (ELECTRON_RUN_AS_NODE when the Node.js of VS Code runs rapt). */
  env?: Record<string, string>;
}

export interface CliOptions {
  /** Setting rapt.cliPath: a cli.js, or a folder of rap-transpiler. */
  cliPath?: string;
  /** Setting rapt.nodePath: a Node.js 22+; empty for the Node.js of VS Code. */
  nodePath?: string;
  /** The rapt embedded in the extension (rapt/node_modules/@rap-transpiler/compiler/dist/cli.js). */
  bundledCli?: string;
  workspaceFolders: string[];
  /** The executable of VS Code (process.execPath of the extension host). */
  execPath: string;
}

/**
 * The project (abapGit folder) of a file: the nearest folder with `.abapgit.xml`, up to `stop`.
 * Without one, the parent of a `src` folder.
 */
export function findProjectRoot(file: string, stop?: string, exists: (p: string) => boolean = existsSync): string | undefined {
  const limit = stop === undefined ? undefined : path.resolve(stop);
  let dir = path.dirname(path.resolve(file));
  let srcParent: string | undefined;
  for (;;) {
    if (exists(path.join(dir, ".abapgit.xml"))) {
      return dir;
    }
    if (srcParent === undefined && path.basename(dir) === "src") {
      srcParent = path.dirname(dir);
    }
    const parent = path.dirname(dir);
    if (dir === limit || parent === dir) {
      return srcParent;
    }
    dir = parent;
  }
}

/**
 * The CLI: the configured path (a cli.js, or a folder of rap-transpiler), else the rapt embedded
 * in the extension, else the compiler of a rap-transpiler clone or of node_modules in a
 * workspace folder, else `rapt` on the PATH. It runs on the configured Node.js, else on the
 * Node.js of VS Code (ELECTRON_RUN_AS_NODE, Node.js 22 since VS Code 1.101).
 */
export function resolveCli(options: CliOptions, exists: (p: string) => boolean = existsSync): Cli {
  const candidates: string[] = [];
  const configured = options.cliPath?.trim();
  if (configured !== undefined && configured !== "") {
    candidates.push(configured.endsWith(".js") ? configured : path.join(configured, "packages", "compiler", "dist", "cli.js"));
    if (!configured.endsWith(".js")) {
      candidates.push(path.join(configured, "dist", "cli.js"));
    }
  }
  if (options.bundledCli !== undefined) {
    candidates.push(options.bundledCli);
  }
  for (const folder of options.workspaceFolders) {
    candidates.push(path.join(folder, "packages", "compiler", "dist", "cli.js"));
    candidates.push(path.join(folder, "node_modules", "@rap-transpiler", "compiler", "dist", "cli.js"));
  }
  const found = candidates.find((candidate) => exists(candidate));
  if (found === undefined) {
    return { command: "rapt", args: [] };
  }
  const node = options.nodePath?.trim();
  return node !== undefined && node !== "" ? { command: node, args: [found] } : { command: options.execPath, args: [found], env: { ELECTRON_RUN_AS_NODE: "1" } };
}

/** Splits a stream into lines (the last, unfinished line is kept for the next chunk). */
export class LineSplitter {
  private buffer = "";

  public push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    return lines.filter((line) => line !== "");
  }

  public flush(): string[] {
    const rest = this.buffer;
    this.buffer = "";
    return rest === "" ? [] : [rest];
  }
}

/** A line of `rapt dev --json`; other lines (a crash, a warning of Node.js) become logs. */
export function parseDevEvent(line: string): DevEvent {
  try {
    const value = JSON.parse(line) as unknown;
    if (typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string") {
      return value as DevEvent;
    }
  } catch {
    // not JSON
  }
  return { type: "log", stream: "stdout", line };
}

function spawnCli(cli: Cli, args: string[], cwd: string): ChildProcess {
  // a bare `rapt` is a .cmd shim on Windows
  return spawn(cli.command, [...cli.args, ...args], {
    cwd,
    env: { ...process.env, ...cli.env },
    shell: cli.args.length === 0 && process.platform === "win32",
    windowsHide: true,
  });
}

/** Runs `rapt <command> … --json` and returns its result. */
export function runJson(cli: Cli, args: string[], cwd: string): Promise<RaptResult> {
  return new Promise((resolve, reject) => {
    const child = spawnCli(cli, [...args, "--json"], cwd);
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const line = stdout.trim().split(/\r?\n/).pop() ?? "";
      try {
        resolve(JSON.parse(line) as RaptResult);
      } catch {
        reject(new Error(`rapt ${args[0] ?? ""} failed (exit code ${code ?? "?"}): ${(stderr || stdout).trim() || "no output"}`));
      }
    });
  });
}

/** `rapt dev <root> --json`: events until stop(). */
export class DevProcess {
  private readonly child: ChildProcess;
  public readonly exited: Promise<number | null>;

  public constructor(cli: Cli, root: string, port: number, onEvent: (event: DevEvent) => void, onError: (line: string) => void) {
    this.child = spawnCli(cli, ["dev", root, "--port", String(port), "--json"], root);
    const out = new LineSplitter();
    const err = new LineSplitter();
    this.child.stdout?.setEncoding("utf8").on("data", (chunk: string) => out.push(chunk).forEach((line) => onEvent(parseDevEvent(line))));
    this.child.stderr?.setEncoding("utf8").on("data", (chunk: string) => err.push(chunk).forEach(onError));
    this.exited = new Promise((resolve) => {
      this.child.on("error", (e) => {
        onError(e.message);
        resolve(null);
      });
      this.child.on("close", (code) => {
        out.flush().forEach((line) => onEvent(parseDevEvent(line)));
        err.flush().forEach(onError);
        resolve(code);
      });
    });
  }

  public get running(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  /** SIGINT: rapt dev stops its server and exits (on Windows, the server stops when rapt dev exits). */
  public async stop(): Promise<void> {
    if (this.running) {
      this.child.kill("SIGINT");
      const timeout = setTimeout(() => this.child.kill("SIGKILL"), 10_000);
      await this.exited;
      clearTimeout(timeout);
    }
  }
}

/** 0-based position of a diagnostic (VS Code ranges). */
export function position(d: RaptDiagnostic): { line: number; character: number } {
  return { line: Math.max((d.line ?? 1) - 1, 0), character: Math.max((d.column ?? 1) - 1, 0) };
}

/** Absolute path of a diagnostic of a project. */
export function diagnosticPath(root: string, d: RaptDiagnostic): string | undefined {
  if (d.path !== undefined) {
    return d.path;
  }
  return d.file === undefined ? undefined : path.join(root, ...d.file.split("/"));
}

/** `2 erreurs, 1 avertissement`. */
export function summary(counts: Counts): string {
  const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;
  return `${plural(counts.error, "erreur", "erreurs")}, ${plural(counts.warning, "avertissement", "avertissements")}`;
}
