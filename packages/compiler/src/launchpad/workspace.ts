/**
 * The launchpad of a workspace (decision D67): one `launchpad.json` titled "Launchpad" next to
 * the projects, to which each application is added when it is created (`rapt new`, `rapt
 * floorplan`, `rapt launchpad add`). An application is referenced by its sources (`source`):
 * `rapt launchpad` builds it with the launchpad.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { buildUiLayout } from "../gen/ui/layout.js";
import { loadProject } from "../input/project.js";
import { buildModel } from "../ir/builder.js";

export const LAUNCHPAD_FILE = "launchpad.json";
export const DEFAULT_LAUNCHPAD_TITLE = "Launchpad";
/** The group (or section of the first page) the tiles of the registered applications go to. */
export const DEFAULT_SECTION = "Applications";
/** How many folders above the project the existing launchpad is looked for. */
const SEARCH_DEPTH = 4;
const LAUNCHPAD_PORT = 8090;

export interface LaunchpadLocation {
  file: string;
  exists: boolean;
}

export interface RegisterOptions {
  /** The launchpad.json to use, instead of the one of the workspace. */
  launchpad?: string;
  /** The service definition of the application (projects with several). */
  service?: string;
}

export interface RegisterResult {
  file: string;
  /** The launchpad.json did not exist and was written. */
  created: boolean;
  /** The application was added; false when it was already there. */
  added: boolean;
  app?: { id: string; source: string; url: string; service?: string };
  tile?: Record<string, unknown>;
  error?: string;
}

const same = (a: string, b: string): boolean => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Folders that are never a workspace: the file system root, the home and the temporary folders. */
function systemFolder(dir: string): boolean {
  return path.dirname(dir) === dir || same(dir, path.resolve(homedir())) || same(dir, path.resolve(tmpdir()));
}

/**
 * The launchpad of a project: the nearest `launchpad.json` in its folder or above (up to a git
 * repository root, never in the home or temporary folders); else where to create it, in the
 * workspace: the parent folder of the project, or the project itself when it is a repository root
 * or when its parent is a system folder.
 */
export function findLaunchpad(projectDir: string): LaunchpadLocation {
  const root = path.resolve(projectDir);
  let dir = root;
  for (let depth = 0; depth <= SEARCH_DEPTH && !systemFolder(dir); depth++) {
    const file = path.join(dir, LAUNCHPAD_FILE);
    if (existsSync(file)) {
      return { file, exists: true };
    }
    if (existsSync(path.join(dir, ".git"))) {
      break;
    }
    dir = path.dirname(dir);
  }
  const parent = path.dirname(root);
  const home = existsSync(path.join(root, ".git")) || systemFolder(parent) ? root : parent;
  return { file: path.join(home, LAUNCHPAD_FILE), exists: false };
}

interface LaunchpadSource {
  title?: unknown;
  apps?: unknown;
  groups?: unknown;
  spaces?: unknown;
  [key: string]: unknown;
}

type Entry = Record<string, unknown>;

const ID = /^[a-z][a-z0-9-]*$/;
const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^[^a-z]+|-+$/g, "");
const posix = (p: string): string => p.split(path.sep).join("/");
const record = (value: unknown): value is Entry => typeof value === "object" && value !== null && !Array.isArray(value);

/** listReport → manage, as the actions of the SAP Fiori apps. */
const ACTIONS: Record<string, { action: string; icon: string }> = {
  listReport: { action: "manage", icon: "sap-icon://list" },
  worklist: { action: "process", icon: "sap-icon://activity-items" },
  analyticalListPage: { action: "analyze", icon: "sap-icon://business-objects-experience" },
  formEntry: { action: "create", icon: "sap-icon://create-form" },
};

/** Every tile of a launchpad.json, in groups or in the sections of its spaces. */
function tilesOf(source: LaunchpadSource): Entry[] {
  const groups: unknown[] = Array.isArray(source.groups) ? source.groups : [];
  const sections = Array.isArray(source.spaces)
    ? source.spaces.flatMap((s) => (record(s) && Array.isArray(s["pages"]) ? s["pages"] : [])).flatMap((p) => (record(p) && Array.isArray(p["sections"]) ? p["sections"] : []))
    : [];
  return [...groups, ...sections].flatMap((g) => (record(g) && Array.isArray(g["tiles"]) ? g["tiles"].filter(record) : []));
}

/** The default group, or the default section of the first page of the first space. */
function defaultTiles(source: LaunchpadSource): unknown[] {
  let groups: unknown[];
  if (Array.isArray(source.spaces) && source.spaces.length > 0 && record(source.spaces[0])) {
    const space = source.spaces[0];
    if (!Array.isArray(space["pages"])) space["pages"] = [];
    const pages = space["pages"] as unknown[];
    if (!record(pages[0])) pages.unshift({ title: typeof space["title"] === "string" ? space["title"] : DEFAULT_LAUNCHPAD_TITLE, sections: [] });
    const page = pages[0] as Entry;
    if (!Array.isArray(page["sections"])) page["sections"] = [];
    groups = page["sections"] as unknown[];
  } else {
    if (!Array.isArray(source.groups)) source.groups = [];
    groups = source.groups as unknown[];
  }
  let group = groups.find((g): g is Entry => record(g) && g["title"] === DEFAULT_SECTION);
  if (group === undefined) {
    group = { title: DEFAULT_SECTION, tiles: [] };
    groups.push(group);
  }
  if (!Array.isArray(group["tiles"])) group["tiles"] = [];
  return group["tiles"] as unknown[];
}

/**
 * Adds an application (its sources) and its tile to the launchpad of the workspace, created with
 * the title "Launchpad" when there is none. Idempotent: an application already there (same
 * sources, or same id without sources) is left as it is, and nothing the user wrote is changed.
 */
export function registerApp(projectDir: string, options: RegisterOptions = {}): RegisterResult {
  const root = path.resolve(projectDir);
  const location = options.launchpad === undefined ? findLaunchpad(root) : { file: path.resolve(options.launchpad), exists: existsSync(path.resolve(options.launchpad)) };
  const { file } = location;
  const base = path.dirname(file);
  let source: LaunchpadSource = { title: DEFAULT_LAUNCHPAD_TITLE, apps: [], groups: [] };
  if (location.exists) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (!record(parsed)) throw new Error("not a JSON object");
      source = parsed;
    } catch (error) {
      return { file, created: false, added: false, error: `${file} cannot be read: ${(error as Error).message}` };
    }
  }
  if (!Array.isArray(source.apps)) source.apps = [];
  const apps = (source.apps as unknown[]).filter(record);

  const relative = posix(path.relative(base, root)) || ".";
  const already = apps.find((a) => typeof a["source"] === "string" && same(path.resolve(base, a["source"]), root));
  const { model } = buildModel(loadProject(root), options.service === undefined ? {} : { service: options.service });
  if (model === undefined) {
    return { file, created: false, added: false, error: `${root}: no application to add to the launchpad (a service definition is needed; rapt check ${root})` };
  }
  let id = slug(path.basename(root));
  if (!ID.test(id)) id = slug(model.service.name);
  if (!ID.test(id)) id = "app";
  const sameId = apps.find((a) => a["id"] === id && a["source"] === undefined);
  const existing = already ?? sameId;
  if (existing !== undefined) {
    const url = typeof existing["url"] === "string" ? existing["url"] : "";
    return { file, created: false, added: false, app: { id: String(existing["id"]), source: typeof existing["source"] === "string" ? existing["source"] : relative, url } };
  }
  const ids = new Set(apps.map((a) => a["id"]));
  const stem = id;
  for (let n = 2; ids.has(id); n++) id = `${stem}-${n}`;

  // a port of its own for each application run locally (npm start), the launchpad has 8090
  const ports = new Set(apps.map((a) => (typeof a["url"] === "string" ? /:(\d+)/.exec(a["url"])?.[1] : undefined)).filter((p) => p !== undefined).map(Number));
  let port = 8081;
  while (ports.has(port) || port === LAUNCHPAD_PORT) port++;
  const app: NonNullable<RegisterResult["app"]> = { id, source: relative, url: `http://localhost:${port}/`, ...(options.service === undefined ? {} : { service: options.service }) };

  const layout = buildUiLayout(model);
  const start = layout.pages.find((p) => p.set === layout.start);
  const floorplan = layout.overview === undefined ? (start?.floorplan ?? "listReport") : "listReport";
  const { action, icon } = ACTIONS[floorplan] ?? (ACTIONS["listReport"] as { action: string; icon: string });
  const semantic = (start?.set ?? model.service.name).replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z]+/, "") || "App";
  const intents = new Set(tilesOf(source).map((t) => t["intent"]));
  let intent = `${semantic}-${action}`;
  for (let n = 2; intents.has(intent); n++) intent = `${semantic}${n}-${action}`;
  const tile: Entry = { title: layout.title, app: id, intent, icon };
  if (start?.list !== undefined && floorplan !== "formEntry") tile["count"] = start.set;

  (source.apps as unknown[]).push(app);
  defaultTiles(source).push(tile);
  mkdirSync(base, { recursive: true });
  writeFileSync(file, `${JSON.stringify(source, null, 2)}\n`);
  return { file, created: !location.exists, added: true, app, tile };
}
