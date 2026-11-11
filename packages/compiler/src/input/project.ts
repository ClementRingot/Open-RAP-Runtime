/** Reads a folder in abapGit format and classifies its files by object. */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseTableSource, tableSourceToXml } from "../ddic/table-source.js";

export interface SourceFile {
  /** Path relative to the project root, with forward slashes (used in diagnostics). */
  path: string;
  absolute: string;
  /** Object name, upper case, namespaces decoded: `/DMO/I_TRAVEL`. */
  name: string;
  /** Object type, upper case: TABL, DDLS, BDEF… */
  type: string;
  /** Rest of the file name after the type: `asddls`, `xml`, `abap`, `locals_imp.abap`… */
  extension: string;
  /** The abapGit file name, as abaplint expects it. */
  fileName: string;
  content: string;
  /**
   * The file is generated from another one: the abapGit XML of a table written as source
   * (`.tabl.astabl`). `path` and `absolute` then designate the source.
   */
  generatedFrom?: "astabl";
  /** Lines of the fields in the source, for the diagnostics of a generated file. */
  fieldLines?: Record<string, number>;
}

/** Problems found while reading the project (sources of tables). */
export interface ProjectIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  file: string;
  line: number;
  column: number;
}

export interface Project {
  root: string;
  sourceRoot: string;
  files: SourceFile[];
  issues: ProjectIssue[];
}

const ABAPGIT_FILE = /^([^.]+)\.([a-z0-9]{4})(?:\.(.+))?$/i;

/** abapGit encodes `/` as `#` and some other characters as %xx in file names. */
export function decodeObjectName(encoded: string): string {
  return decodeURIComponent(encoded.replace(/#/g, "/").replace(/%(?![0-9a-f]{2})/gi, "%25")).toUpperCase();
}

function startingFolder(root: string): string {
  const descriptor = path.join(root, ".abapgit.xml");
  if (!existsSync(descriptor)) {
    return root;
  }
  const xml = readFileSync(descriptor, "utf8");
  const folder = /<STARTING_FOLDER>([^<]*)<\/STARTING_FOLDER>/.exec(xml)?.[1] ?? "/src/";
  return path.join(root, folder.replace(/^\/+/, ""));
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules") {
      continue;
    }
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
}

export function loadProject(dir: string): Project {
  const root = path.resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`${dir} is not a folder`);
  }
  const sourceRoot = startingFolder(root);
  const all: string[] = [];
  if (existsSync(sourceRoot)) {
    walk(sourceRoot, all);
  }
  const files: SourceFile[] = [];
  for (const absolute of all.sort()) {
    const fileName = path.basename(absolute);
    const match = ABAPGIT_FILE.exec(fileName);
    if (match === null) {
      continue;
    }
    files.push({
      path: path.relative(root, absolute).split(path.sep).join("/"),
      absolute,
      name: decodeObjectName(match[1] ?? ""),
      type: (match[2] ?? "").toUpperCase(),
      extension: (match[3] ?? "").toLowerCase(),
      fileName,
      content: readFileSync(absolute, "utf8"),
    });
  }
  const issues: ProjectIssue[] = [];
  return { root, sourceRoot, files: withTableSources(files, issues), issues };
}

/**
 * Tables written as source (`name.tabl.astabl`) get their abapGit XML (`name.tabl.xml`) here:
 * the rest of the compiler only reads the XML. The source wins over an XML file present beside it.
 */
function withTableSources(files: SourceFile[], issues: ProjectIssue[]): SourceFile[] {
  const sources = files.filter((f) => f.type === "TABL" && f.extension === "astabl");
  if (sources.length === 0) {
    return files;
  }
  const generated = new Map<string, SourceFile>();
  for (const source of sources) {
    const parsed = parseTableSource(source.content);
    for (const issue of parsed.issues) {
      issues.push({ ...issue, code: issue.severity === "error" ? "TABL001" : "TABL002", file: source.path });
    }
    if (parsed.table === undefined) {
      continue;
    }
    if (parsed.table.name !== source.name) {
      issues.push({ severity: "error", code: "TABL001", message: `the file defines ${parsed.table.name}, its name says ${source.name}`, file: source.path, line: 1, column: 1 });
    }
    generated.set(source.name, {
      ...source,
      extension: "xml",
      fileName: source.fileName.replace(/\.astabl$/i, ".xml"),
      content: tableSourceToXml(parsed.table),
      generatedFrom: "astabl",
      fieldLines: Object.fromEntries(parsed.table.fields.map((f) => [f.name, f.line])),
    });
  }
  const result = files.filter((f) => !(f.type === "TABL" && f.extension === "xml" && generated.has(f.name)));
  return [...result, ...generated.values()];
}

export function filesOfType(project: Project, type: string): SourceFile[] {
  return project.files.filter((f) => f.type === type);
}

/** The main source file of an object: `.asddls`, `.asbdef`, `.srvdsrv`, `.asddlxs` or `.xml`. */
export function mainFile(project: Project, type: string, name: string): SourceFile | undefined {
  const candidates = project.files.filter((f) => f.type === type && f.name === name.toUpperCase());
  const preferred = { DDLS: "asddls", DDLX: "asddlxs", BDEF: "asbdef", SRVD: "srvdsrv", CLAS: "abap", INTF: "abap" }[type];
  return candidates.find((f) => f.extension === preferred) ?? candidates.find((f) => f.extension === "xml") ?? candidates[0];
}
