/** Reads a folder in abapGit format and classifies its files by object. */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

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
}

export interface Project {
  root: string;
  sourceRoot: string;
  files: SourceFile[];
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
  return { root, sourceRoot, files };
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
