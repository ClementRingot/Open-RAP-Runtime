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

/** Result of `rapt new --json`. */
export interface NewResult {
  command: "new";
  ok: boolean;
  root: string;
  written: string[];
  error?: string;
  /** The application added to the launchpad of the workspace (D67). */
  launchpad?: LaunchpadAddResult;
}

/** Result of `rapt launchpad add --json`, and the `launchpad` of `rapt new` and `rapt floorplan` (D67). */
export interface LaunchpadAddResult {
  file: string;
  created: boolean;
  added: boolean;
  app?: { id: string; source: string; url: string };
  error?: string;
}

/** Result of `rapt launchpad --json`: the launchpad and the applications built with it. */
export interface LaunchpadResult extends RaptResult {
  file: string;
  apps: Array<{ id: string; source: string; out: string }>;
}

export const LAUNCHPAD_FILE = "launchpad.json";

/**
 * The launchpad of the VS Code workspace, a single one for all its applications (D67): next to
 * the saved .code-workspace file, else in the first workspace folder.
 */
export function workspaceLaunchpad(folders: string[], workspaceFile?: string): string | undefined {
  if (workspaceFile !== undefined) return path.join(path.dirname(workspaceFile), LAUNCHPAD_FILE);
  return folders[0] === undefined ? undefined : path.join(folders[0], LAUNCHPAD_FILE);
}

/** The project folders of the applications of a launchpad.json built from their sources (`source`). */
export function launchpadSources(file: string, text: string): string[] {
  try {
    const parsed = JSON.parse(text) as { apps?: unknown };
    if (!Array.isArray(parsed.apps)) return [];
    return parsed.apps.flatMap((a: unknown) =>
      typeof a === "object" && a !== null && typeof (a as { source?: unknown }).source === "string" && (a as { build?: unknown }).build === undefined
        ? [path.resolve(path.dirname(file), (a as { source: string }).source)]
        : [],
    );
  } catch {
    return [];
  }
}

/** The message of an application added to the launchpad; undefined when nothing changed. */
export function launchpadNotice(result: LaunchpadAddResult | undefined): string | undefined {
  if (result === undefined || (result.error === undefined && !result.added)) return undefined;
  if (result.error !== undefined) return `pas ajoutée au launchpad (${result.error})`;
  return `${result.app?.id ?? "application"} ajoutée au launchpad${result.created ? " (créé)" : ""} : ${result.file}`;
}

/** Result of `rapt abapgit --json`. */
export interface AbapGitResult {
  command: "abapgit";
  ok: boolean;
  root: string;
  written: string[];
  skipped: { file: string; reason: string }[];
  issues: { severity: Severity; code: string; message: string; file: string; line: number; column: number }[];
}

/** Result of `rapt generate --json`. */
export interface GenerateResult {
  command: "generate";
  ok: boolean;
  root: string;
  written: string[];
  error?: string;
}

/** What each kind of `rapt generate` starts from, and how the new object is named by default. */
export interface GenerateKind {
  kind: string;
  label: string;
  /** The object the new one derives from (asked in a list), and the option that passes it. */
  source?: { of: "table" | "entity" | "bdef" | "srvd"; option: "--from" | "--for"; prompt: string };
  /** Default name from the source object. */
  name?: (source: string) => string;
}

const swapLayer = (entity: string, layer: string): string => (/^[ZY][A-Z0-9]*_[A-Z]_/i.test(entity) ? entity.replace(/^([ZY][A-Z0-9]*_)[A-Z]_/i, `$1${layer}_`) : entity);

export const GENERATE_KINDS: GenerateKind[] = [
  { kind: "table", label: "Table de base de données" },
  { kind: "tableentity", label: "Table entity CDS (table et entité, persistance d'un BO)" },
  { kind: "type", label: "Type simple CDS" },
  { kind: "enum", label: "Type énuméré CDS (enum)" },
  {
    kind: "view",
    label: "Vue CDS (view entity) depuis une table",
    source: { of: "table", option: "--from", prompt: "Table source" },
    name: (table) => `ZR_${table.replace(/^[zy][a-z0-9]*?_/i, "").replace(/(^|_)([a-z])/g, (_m, _s: string, c: string) => c.toUpperCase())}`,
  },
  { kind: "projection", label: "Projection CDS depuis une vue", source: { of: "entity", option: "--from", prompt: "Vue projetée" }, name: (entity) => swapLayer(entity, "C") },
  { kind: "metadata", label: "Metadata extension (annotations UI)", source: { of: "entity", option: "--from", prompt: "Entité annotée" }, name: (entity) => entity },
  { kind: "behavior", label: "Behavior definition (BDEF)", source: { of: "entity", option: "--from", prompt: "Entité racine (vue ou projection)" }, name: (entity) => entity },
  {
    kind: "pool",
    label: "Behavior pool (classe d'implémentation)",
    source: { of: "bdef", option: "--for", prompt: "Behavior definition" },
    name: (bdef) => `ZBP_${bdef.toUpperCase().replace(/^[ZY]_?/, "")}`.slice(0, 30),
  },
  { kind: "access", label: "Access control (DCL)", source: { of: "entity", option: "--from", prompt: "Entité protégée" }, name: (entity) => entity },
  { kind: "abstract", label: "Entité abstraite (paramètre d'action)" },
  { kind: "custom", label: "Entité custom et sa classe de requête" },
  { kind: "service", label: "Définition de service", source: { of: "entity", option: "--from", prompt: "Entité exposée" }, name: (entity) => `ZUI_${entity.toUpperCase().replace(/^[ZY][A-Z0-9]*?_[A-Z]_/, "")}` },
  { kind: "binding", label: "Service binding OData V4", source: { of: "srvd", option: "--for", prompt: "Définition de service" }, name: (srvd) => `${srvd.toUpperCase()}_O4` },
  { kind: "class", label: "Classe ABAP" },
  { kind: "interface", label: "Interface ABAP" },
];

/** The objects of a project by kind, from the file names of its sources. */
export function projectObjects(fileNames: string[]): Record<"table" | "entity" | "bdef" | "srvd" | "domain", string[]> {
  const result = { table: new Set<string>(), entity: new Set<string>(), bdef: new Set<string>(), srvd: new Set<string>(), domain: new Set<string>() };
  for (const file of fileNames) {
    const base = file.split(/[\\/]/).pop() ?? file;
    const match = /^([^.]+)\.(tabl|ddls|bdef|srvd|doma)\.(astabl|xml|asddls|asbdef|srvdsrv)$/i.exec(base);
    if (match === null) continue;
    const name = (match[1] ?? "").replace(/#/g, "/");
    const type = (match[2] ?? "").toLowerCase();
    if (type === "tabl") result.table.add(name.toLowerCase());
    else if (type === "ddls" && match[3]?.toLowerCase() === "asddls") result.entity.add(name.toUpperCase());
    else if (type === "bdef" && match[3]?.toLowerCase() === "asbdef") result.bdef.add(name.toUpperCase());
    else if (type === "srvd" && match[3]?.toLowerCase() === "srvdsrv") result.srvd.add(name.toUpperCase());
    else if (type === "doma") result.domain.add(name.toUpperCase());
  }
  const sorted = (set: Set<string>): string[] => [...set].sort();
  return { table: sorted(result.table), entity: sorted(result.entity), bdef: sorted(result.bdef), srvd: sorted(result.srvd), domain: sorted(result.domain) };
}

// ---------------------------------------------------------------------------------------------
// the creation wizard (D61): the catalog of rapt generate, and the command line of a choice

export interface ObjectInput {
  option: "--from" | "--for" | "--expose" | "--root" | "--binding-type" | "--type";
  label: string;
  of?: "table" | "entity" | "bdef" | "srvd" | "domain";
  values?: string[];
  required: boolean;
  multiple?: boolean;
  default?: string;
}

export interface CatalogEntry {
  kind: string;
  category: string;
  label: string;
  description: string;
  files: string;
  maxLength: number;
  namePattern: string;
  inputs: ObjectInput[];
}

/** The answers of the wizard → the arguments of `rapt generate` (or of `rapt new` for a BO); an error message otherwise. */
export function wizardArgs(root: string, entry: CatalogEntry, name: string, description: string, values: Record<string, string | string[]>): string[] | string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    return "Le nom est fait de lettres, de chiffres et de _, en commençant par une lettre";
  }
  if (name.length > entry.maxLength) {
    return `Le nom a au plus ${entry.maxLength} caractères`;
  }
  if (entry.kind === "bo") {
    const prefix = typeof values["--prefix"] === "string" && values["--prefix"] !== "" ? ["--prefix", values["--prefix"]] : [];
    return ["new", root, name, ...prefix, ...(description === "" ? [] : ["--description", description])];
  }
  const args = ["generate", root, entry.kind, name];
  for (const input of entry.inputs) {
    const value = values[input.option];
    const list = Array.isArray(value) ? value.filter((v) => v !== "") : value === undefined || value === "" ? [] : [value];
    if (list.length === 0) {
      if (input.required) return `${input.label} : obligatoire`;
      continue;
    }
    if (input.option === "--root") {
      if (list[0] === "true") args.push("--root");
    } else {
      args.push(input.option, input.multiple === true ? list.join(",") : (list[0] as string));
    }
  }
  if (description !== "") args.push("--description", description);
  return args;
}

/** The object groups of the "Objets RAP" view, as in the project explorer of ADT. */
export const OBJECT_GROUPS: Array<{ id: string; label: string; pattern: RegExp }> = [
  { id: "ddic", label: "Dictionnaire (tables, éléments de données, domaines)", pattern: /\.(tabl\.astabl|tabl\.xml|dtel\.xml|doma\.xml)$/i },
  { id: "cds", label: "Core Data Services (data definitions, types)", pattern: /\.(ddls\.asddls|drty\.acds|drty\.asdrty)$/i },
  { id: "ddlx", label: "Metadata extensions", pattern: /\.ddlx\.asddlxs$/i },
  { id: "dcl", label: "Access controls", pattern: /\.dcls\.asdcls$/i },
  { id: "bdef", label: "Behavior definitions", pattern: /\.bdef\.asbdef$/i },
  { id: "srvd", label: "Service definitions", pattern: /\.srvd\.srvdsrv$/i },
  { id: "srvb", label: "Service bindings", pattern: /\.srvb\.xml$/i },
  { id: "abap", label: "Classes et interfaces", pattern: /\.(clas|intf)\.abap$/i },
];

/** The main file of each object of a project, by group; a table written as source hides its XML. */
export function groupObjects(fileNames: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const sources = new Set(fileNames.filter((f) => /\.tabl\.astabl$/i.test(f)).map((f) => f.replace(/\.astabl$/i, ".xml").toLowerCase()));
  for (const file of [...fileNames].sort()) {
    if (sources.has(file.toLowerCase())) continue;
    const group = OBJECT_GROUPS.find((g) => g.pattern.test(file));
    if (group !== undefined) (result[group.id] ??= []).push(file);
  }
  return result;
}

/** The entity name of `rapt new`: letters and digits, starting with a letter. */
export function validEntityName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]*$/.test(name);
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

export interface MenuContext {
  /** The roots of the RAP projects, their folders and their .abapgit.xml: the project commands apply. */
  projects: Record<string, true>;
  /** The same for the projects with a service definition: the application commands apply. */
  apps: Record<string, true>;
}

/**
 * The context keys that enable the commands of the explorer menu (`resourcePath in rapt.projects`),
 * from the .abapgit.xml and ABAP source files of the workspace: a folder gets the project commands
 * once it is in a project, the application ones (floorplan, build, dev) once a service is defined.
 */
export function menuContext(files: string[]): MenuContext {
  const descriptors = new Set(files.filter((f) => path.basename(f) === ".abapgit.xml").map((f) => path.resolve(f)));
  const projects: Record<string, true> = {};
  const apps: Record<string, true> = {};
  const folders = new Map<string, Set<string>>();
  for (const file of files) {
    const resolved = path.resolve(file);
    const root = descriptors.has(resolved) ? path.dirname(resolved) : findProjectRoot(resolved, undefined, (p) => descriptors.has(p));
    if (root === undefined) continue;
    const own = folders.get(root) ?? new Set([root, path.join(root, ".abapgit.xml")]);
    folders.set(root, own);
    for (let dir = path.dirname(resolved); dir.startsWith(root) && dir !== root; dir = path.dirname(dir)) own.add(dir);
    if (resolved.endsWith(".srvd.srvdsrv")) apps[root] = true;
  }
  for (const [root, own] of folders) {
    for (const folder of own) {
      projects[folder] = true;
      if (apps[root] === true) apps[folder] = true;
    }
  }
  return { projects, apps };
}

/** The root entity sets whose floorplan was never chosen (`rapt floorplan --json`). */
export function unchosenFloorplans(sets: Array<{ set: string; chosen?: boolean }>): string[] {
  return sets.filter((s) => s.chosen !== true).map((s) => s.set);
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
export function runJson<T = RaptResult>(cli: Cli, args: string[], cwd: string): Promise<T> {
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
        resolve(JSON.parse(line) as T);
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
