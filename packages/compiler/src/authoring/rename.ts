/**
 * A renamed copy of a project for a shared SAP system (D83): on the shared SAP BTP ABAP trial, the
 * objects of every user live together, so each one gets a suffix of its own
 * (`ZRT_TRAVEL` → `ZRT_TRAVELCR1`). The suffix is appended to the name of every object of the
 * project (Z or Y, not namespaced), in its file names and in every reference of the sources (CDS,
 * BDEF, ABAP, XML). A name longer than its type allows keeps the start of its base before the
 * suffix.
 */

import type { Project, SourceFile } from "../input/project.js";

/** The longest names SAP allows, by object type (others: 30). */
const NAME_LIMITS: Record<string, number> = { TABL: 16, MSAG: 20, SUSO: 10, AUTH: 10, NROB: 10, DEVC: 30 };
const DEFAULT_LIMIT = 30;

export interface RenameResult {
  /** The files of the renamed copy, relative to the root of the copy (`src/…`). */
  files: Array<{ path: string; content: string }>;
  /** Old name → new name, upper case. */
  renamed: Array<{ types: string[]; from: string; to: string }>;
  errors: string[];
}

/** The renamed copy of the abapGit files of a project. */
export function renameProject(project: Project, suffix: string): RenameResult {
  const errors: string[] = [];
  if (!/^[A-Z0-9]{1,6}$/i.test(suffix)) {
    return { files: [], renamed: [], errors: [`the suffix must be 1 to 6 letters or digits: ${suffix}`] };
  }
  const upperSuffix = suffix.toUpperCase();
  // the objects of the project, by name (a table and a message class may share a name)
  const types = new Map<string, Set<string>>();
  for (const file of project.files) {
    if (file.standard !== true && /^[ZY]/i.test(file.name) && !file.name.startsWith("/")) {
      const set = types.get(file.name) ?? new Set<string>();
      set.add(file.type);
      types.set(file.name, set);
    }
  }
  const renamed: RenameResult["renamed"] = [];
  const taken = new Set<string>();
  for (const [name, set] of [...types].sort(([a], [b]) => a.localeCompare(b))) {
    const limit = Math.min(...[...set].map((t) => NAME_LIMITS[t] ?? DEFAULT_LIMIT));
    if (upperSuffix.length >= limit) {
      errors.push(`${name}: a suffix of ${upperSuffix.length} characters leaves no room in a name of at most ${limit}`);
      continue;
    }
    const to = `${name.slice(0, limit - upperSuffix.length)}${upperSuffix}`;
    if (taken.has(to) || (types.has(to) && to !== name)) {
      errors.push(`${name}: the renamed object ${to} collides with another object; use another suffix`);
      continue;
    }
    taken.add(to);
    renamed.push({ types: [...set].sort(), from: name, to });
  }
  if (errors.length > 0) {
    return { files: [], renamed, errors };
  }
  const longestFirst = [...renamed].sort((a, b) => b.from.length - a.from.length);
  const pattern = new RegExp(`(?<![A-Za-z0-9_/])(${longestFirst.map((r) => escape(r.from)).join("|")})(?![A-Za-z0-9_])`, "gi");
  const byName = new Map(renamed.map((r) => [r.from, r.to]));
  const replace = (text: string): string => text.replace(pattern, (match: string) => withCaseOf(match, byName.get(match.toUpperCase()) ?? match));
  const files: RenameResult["files"] = [];
  for (const file of project.files) {
    if (file.standard === true) {
      continue; // a standard object of SAP (D44), not a file of the project
    }
    files.push({ path: `src/${renameFileName(file, byName)}`, content: replace(file.content) });
  }
  return { files, renamed, errors };
}

function renameFileName(file: SourceFile, byName: Map<string, string>): string {
  const to = byName.get(file.name);
  if (to === undefined) {
    return file.fileName;
  }
  return `${to.toLowerCase()}${file.fileName.slice(file.fileName.indexOf("."))}`;
}

/** The new name written in the case of the old one: upper, lower, or mixed (the suffix in the case of the last letter). */
function withCaseOf(match: string, to: string): string {
  if (match === match.toUpperCase()) {
    return to.toUpperCase();
  }
  if (match === match.toLowerCase()) {
    return to.toLowerCase();
  }
  const base = to.slice(0, Math.min(match.length, to.length));
  const kept = [...base].map((c, i) => ((match[i] ?? c) === (match[i] ?? c).toLowerCase() ? c.toLowerCase() : c.toUpperCase())).join("");
  const last = [...match].reverse().find((c) => /[A-Za-z]/.test(c)) ?? "A";
  const rest = to.slice(base.length);
  return `${kept}${last === last.toLowerCase() ? rest.toLowerCase() : rest.toUpperCase()}`;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
