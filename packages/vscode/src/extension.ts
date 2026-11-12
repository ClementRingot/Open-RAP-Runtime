/**
 * Open RAP Runtime for VS Code: a thin layer over the rapt command line (`--json`). The commands,
 * the Problems panel, the status bar and the UI preview all come from `rapt check`, `rapt build`
 * and `rapt dev`; the extension compiles nothing itself.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import {
  diagnosticPath,
  DevProcess,
  findProjectRoot,
  position,
  resolveCli,
  runJson,
  summary,
  validEntityName,
  GENERATE_KINDS,
  LAUNCHPAD_FILE,
  launchpadNotice,
  launchpadSources,
  menuContext,
  projectObjects,
  unchosenFloorplans,
  wizardArgs,
  agentServers,
  feedbackUrl,
  terminalShims,
  workspaceLaunchpad,
  type CatalogEntry,
  type AbapGitResult,
  type GenerateResult,
  type Cli,
  type DevEvent,
  type LaunchpadAddResult,
  type LaunchpadResult,
  type NewResult,
  type RaptDiagnostic,
} from "./rapt.js";
import { RapObjectsProvider } from "./tree.js";
import { openWizard } from "./wizard.js";

const SEVERITY: Record<RaptDiagnostic["severity"], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

let extensionPath = "";
let output: vscode.OutputChannel;
let diagnostics: vscode.DiagnosticCollection;
let status: vscode.StatusBarItem;
let dev: { process: DevProcess; root: string; url?: string; opened?: boolean } | undefined;
/** Files with diagnostics, by project root (to clear them on the next run). */
const reported = new Map<string, vscode.Uri[]>();
const checkTimers = new Map<string, NodeJS.Timeout>();

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("rapt");
}

/** Not searched for projects: dependencies, the work folder of rapt dev, the generated applications. */
const EXCLUDE = "{**/node_modules/**,**/.rapt/**,**/out/**}";

/** The launchpad.json of the workspace, one for all its applications (D69). */
function launchpadFile(): string | undefined {
  const workspaceFile = vscode.workspace.workspaceFile;
  return workspaceLaunchpad(
    (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    workspaceFile?.scheme === "file" ? workspaceFile.fsPath : undefined,
  );
}

/** `--launchpad <file>`: rapt new and rapt floorplan add the application to the launchpad of the workspace. */
function launchpadArgs(): string[] {
  const file = launchpadFile();
  return file === undefined ? [] : ["--launchpad", file];
}

function notifyLaunchpad(result: LaunchpadAddResult | undefined): void {
  const notice = launchpadNotice(result);
  if (notice === undefined) return;
  output.appendLine(`launchpad : ${notice}`);
  if (result?.error !== undefined) {
    void vscode.window.showWarningMessage(`RAP: application ${notice}`);
  }
  scheduleMenuContext();
}

function cli(): Cli {
  const cliPath = config().get<string>("cliPath");
  const nodePath = config().get<string>("nodePath");
  return resolveCli({
    ...(cliPath === undefined ? {} : { cliPath }),
    ...(nodePath === undefined ? {} : { nodePath }),
    bundledCli: path.join(extensionPath, "rapt", "node_modules", "@open-rap", "compiler", "dist", "cli.js"),
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
    execPath: process.execPath,
  });
}

/** The project of the active editor, else one of the workspace (asked when there are several). */
async function project(uri?: vscode.Uri): Promise<string | undefined> {
  const file = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (file?.scheme === "file") {
    const stop = vscode.workspace.getWorkspaceFolder(file)?.uri.fsPath;
    // a folder of the explorer, or a file: findProjectRoot starts from the folder of its argument
    const isFolder = uri !== undefined && (await vscode.workspace.fs.stat(file).then((s) => s.type === vscode.FileType.Directory, () => false));
    const root = findProjectRoot(isFolder ? path.join(file.fsPath, ".abapgit.xml") : file.fsPath, stop);
    if (root !== undefined) {
      return root;
    }
  }
  const found = await vscode.workspace.findFiles("**/.abapgit.xml", EXCLUDE, 50);
  const roots = [...new Set(found.map((f) => path.dirname(f.fsPath)))].sort();
  if (roots.length <= 1) {
    if (roots.length === 0) {
      void vscode.window.showWarningMessage("RAP: no abapGit project (.abapgit.xml) in the workspace.");
    }
    return roots[0];
  }
  const picked = await vscode.window.showQuickPick(
    roots.map((root) => ({ label: path.basename(root), description: vscode.workspace.asRelativePath(root), root })),
    { placeHolder: "RAP project" },
  );
  return picked?.root;
}

function rangeOf(uri: vscode.Uri, d: RaptDiagnostic): vscode.Range {
  const { line, character } = position(d);
  const document = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
  if (document === undefined || line >= document.lineCount) {
    return new vscode.Range(line, character, line, character + 1);
  }
  const text = document.lineAt(line);
  if (d.column === undefined) {
    return new vscode.Range(line, text.firstNonWhitespaceCharacterIndex, line, text.range.end.character);
  }
  return document.getWordRangeAtPosition(new vscode.Position(line, character), /[\w\\/~%-]+/) ?? new vscode.Range(line, character, line, text.range.end.character);
}

/** Shows the diagnostics of a project; those without a file go to the project's descriptor. */
function publish(root: string, list: RaptDiagnostic[]): void {
  for (const uri of reported.get(root) ?? []) {
    diagnostics.delete(uri);
  }
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const d of list) {
    const file = diagnosticPath(root, d) ?? path.join(root, ".abapgit.xml");
    const uri = vscode.Uri.file(file);
    const diagnostic = new vscode.Diagnostic(rangeOf(uri, d), d.message, SEVERITY[d.severity]);
    diagnostic.source = "rapt";
    diagnostic.code = d.code;
    byFile.set(file, [...(byFile.get(file) ?? []), diagnostic]);
  }
  const uris: vscode.Uri[] = [];
  for (const [file, items] of byFile) {
    const uri = vscode.Uri.file(file);
    diagnostics.set(uri, items);
    uris.push(uri);
  }
  reported.set(root, uris);
}

async function check(root: string, quiet = false): Promise<void> {
  try {
    const result = await runJson(cli(), ["check", root], root);
    publish(root, result.diagnostics);
    if (!dev) {
      showStatus(result.ok ? "$(pass)" : "$(error)", `RAP: ${summary(result.counts)}`, result.ok ? undefined : "workbench.actions.view.problems");
    }
    if (!quiet) {
      const message = `RAP ${path.basename(root)}: ${summary(result.counts)}`;
      void (result.ok ? vscode.window.showInformationMessage(message) : vscode.window.showErrorMessage(message, "Problems").then((a) => a && vscode.commands.executeCommand("workbench.actions.view.problems")));
    }
  } catch (e) {
    cliFailed(e as Error);
  }
}

function cliFailed(error: Error): void {
  output.appendLine(error.message);
  void vscode.window.showErrorMessage(`RAP: ${error.message.split("\n")[0]}`, "Settings", "Log").then((action) => {
    if (action === "Settings") {
      void vscode.commands.executeCommand("workbench.action.openSettings", "rapt.cliPath");
    } else if (action === "Log") {
      output.show();
    }
  });
}

/** "Build the application…": the launchpad with every application, or this application alone (D69). */
async function build(root: string): Promise<void> {
  const file = launchpadFile();
  if (file !== undefined) {
    const mode = await vscode.window.showQuickPick(
      [
        { label: "Launchpad (all the applications)", description: path.basename(path.dirname(file)), detail: `rapt launchpad ${file}: the launchpad and each application of the workspace, a single origin (SSO)`, launchpad: true },
        { label: "Application alone (standalone)", description: path.basename(root), detail: `rapt build: ${path.basename(root)} without a launchpad`, launchpad: false },
      ],
      { title: "RAP: build for deployment", placeHolder: "What to deploy?", ignoreFocusOut: true },
    );
    if (mode === undefined) {
      return;
    }
    if (mode.launchpad) {
      if (!(await ensureFloorplans(root))) {
        return;
      }
      try {
        notifyLaunchpad(await runJson<LaunchpadAddResult>(cli(), ["launchpad", "add", root, "--launchpad", file], root));
      } catch (e) {
        cliFailed(e as Error);
        return;
      }
      await buildLaunchpad(file);
      return;
    }
  }
  if (!(await ensureFloorplans(root))) {
    return;
  }
  const defaultOut = path.join(root, "out", path.basename(root));
  const chosen = await vscode.window.showInputBox({ prompt: "Folder of the generated application", value: defaultOut, ignoreFocusOut: true });
  if (chosen === undefined) {
    return;
  }
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "RAP: generating the application" }, async () => {
    try {
      const result = await runJson(cli(), ["build", root, "--out", chosen], root);
      publish(root, result.diagnostics);
      if (result.ok) {
        const action = await vscode.window.showInformationMessage(`RAP: ${result.files ?? 0} files written to ${result.out ?? chosen}`, "Open folder");
        if (action !== undefined) {
          void vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(path.join(result.out ?? chosen, "package.json")));
        }
      } else {
        void vscode.window.showErrorMessage(`RAP: generation failed, ${summary(result.counts)}`);
      }
    } catch (e) {
      cliFailed(e as Error);
    }
  });
}

/** The folder of a new business object: the folder clicked, else the project, else the workspace. */
async function newBoFolder(uri?: vscode.Uri): Promise<string | undefined> {
  if (uri?.scheme === "file") {
    const isFolder = await vscode.workspace.fs.stat(uri).then((s) => s.type === vscode.FileType.Directory, () => false);
    const start = isFolder ? path.join(uri.fsPath, ".abapgit.xml") : uri.fsPath;
    return findProjectRoot(start, vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath) ?? (isFolder ? uri.fsPath : path.dirname(uri.fsPath));
  }
  const found = await vscode.workspace.findFiles("**/.abapgit.xml", EXCLUDE, 2);
  if (found.length > 0) {
    return project();
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) {
    return folders[0]?.uri.fsPath;
  }
  const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: "Create the BO here" });
  return picked?.[0]?.fsPath;
}

async function newBo(uri?: vscode.Uri): Promise<void> {
  const root = await newBoFolder(uri);
  if (root === undefined) {
    return;
  }
  const entity = await vscode.window.showInputBox({
    title: "RAP: new business object",
    prompt: "Entity name (e.g. Travel, SalesOrder)",
    ignoreFocusOut: true,
    validateInput: (value) => (validEntityName(value) ? undefined : "Letters and digits, starting with a letter"),
  });
  if (entity === undefined) {
    return;
  }
  const prefix = await vscode.window.showInputBox({
    title: "RAP: new business object",
    prompt: "Prefix of the objects (Z or Y…): ZRT gives zrt_travel, ZRT_R_Travel, ZBP_RT_R_TRAVEL…",
    value: config().get<string>("new.prefix") || "Z",
    ignoreFocusOut: true,
    validateInput: (value) => (/^[ZYzy][A-Za-z0-9_]*$/.test(value) ? undefined : "Starts with Z or Y"),
  });
  if (prefix === undefined) {
    return;
  }
  const description = await vscode.window.showInputBox({ title: "RAP: new business object", prompt: "Description", value: entity, ignoreFocusOut: true });
  if (description === undefined) {
    return;
  }
  try {
    const result = await runJson<NewResult>(cli(), ["new", root, entity, "--prefix", prefix, "--description", description, ...launchpadArgs()], root);
    if (!result.ok) {
      void vscode.window.showErrorMessage(`RAP: ${result.error ?? "creation failed"}`);
      return;
    }
    output.appendLine(`rapt new ${entity}: ${result.written.join(", ")}`);
    notifyLaunchpad(result.launchpad);
    const behavior = result.written.find((f) => f.endsWith(".bdef.asbdef") && f.includes("_r_"));
    if (behavior !== undefined) {
      await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, behavior)));
    }
    const action = await vscode.window.showInformationMessage(`RAP: ${entity} created (${result.written.length} files).`, "Start rapt dev");
    if (action !== undefined) {
      await devStart(root);
    }
  } catch (e) {
    cliFailed(e as Error);
  }
}

/** "New RAP object…": rapt generate, with the object to derive from picked in a list (D46). */
async function generate(root: string): Promise<void> {
  const title = "RAP: new object";
  const picked = await vscode.window.showQuickPick(
    GENERATE_KINDS.map((k) => ({ label: k.label, description: k.kind, option: k })),
    { title, placeHolder: "Object type", ignoreFocusOut: true },
  );
  if (picked === undefined) {
    return;
  }
  const kind = picked.option;
  const args = ["generate", root, kind.kind];
  let source: string | undefined;
  if (kind.source !== undefined) {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root, "**/*.{astabl,xml,asddls,asbdef,srvdsrv}"), EXCLUDE);
    const candidates = projectObjects(files.map((f) => f.fsPath))[kind.source.of];
    source = await vscode.window.showQuickPick(candidates, { title, placeHolder: kind.source.prompt, ignoreFocusOut: true });
    if (source === undefined) {
      return;
    }
  }
  const name = await vscode.window.showInputBox({
    title,
    prompt: `Object name (${kind.label})`,
    value: source !== undefined && kind.name !== undefined ? kind.name(source) : "",
    ignoreFocusOut: true,
    validateInput: (value) => (/^[A-Za-z][A-Za-z0-9_]*$/.test(value) ? undefined : "Letters, digits and _, starting with a letter"),
  });
  if (name === undefined) {
    return;
  }
  args.push(name);
  if (source !== undefined && kind.source !== undefined) {
    args.push(kind.source.option, source);
  }
  if (kind.kind === "view") {
    const root = await vscode.window.showQuickPick(["Root view entity", "Child view entity"], { title, ignoreFocusOut: true });
    if (root === undefined) {
      return;
    }
    if (root.startsWith("Root")) {
      args.push("--root");
    }
  }
  try {
    const result = await runJson<GenerateResult>(cli(), args, root);
    if (!result.ok) {
      void vscode.window.showErrorMessage(`RAP: ${result.error ?? "creation failed"}`);
      return;
    }
    output.appendLine(`rapt generate ${kind.kind} ${name}: ${result.written.join(", ")}`);
    const main = result.written.find((f) => !f.endsWith(".xml") && f !== ".abapgit.xml") ?? result.written[0];
    if (main !== undefined) {
      await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, main)));
    }
  } catch (e) {
    cliFailed(e as Error);
  }
}

/** The objects of a project, by kind, to derive the new objects from. */
async function objectsOf(root: string): Promise<Record<string, string[]>> {
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root, "**/*.{astabl,xml,asddls,asbdef,srvdsrv}"), EXCLUDE);
  return projectObjects(files.map((f) => f.fsPath));
}

let objectsView: RapObjectsProvider | undefined;
let contextTimer: NodeJS.Timeout | undefined;

/** The context keys that grey out the commands not yet possible: no project, no service (D66). */
async function updateMenuContext(): Promise<void> {
  const files = await vscode.workspace.findFiles(SOURCE_FILES, EXCLUDE);
  const { projects, apps } = menuContext(files.map((f) => f.fsPath));
  await vscode.commands.executeCommand("setContext", "rapt.projects", projects);
  await vscode.commands.executeCommand("setContext", "rapt.apps", apps);
  await vscode.commands.executeCommand("setContext", "rapt.hasProject", Object.keys(projects).length > 0);
  await vscode.commands.executeCommand("setContext", "rapt.hasApp", Object.keys(apps).length > 0);
  const own = launchpadFile();
  const hasLaunchpad = (own !== undefined && existsSync(own)) || (await vscode.workspace.findFiles(`**/${LAUNCHPAD_FILE}`, EXCLUDE, 1)).length > 0;
  await vscode.commands.executeCommand("setContext", "rapt.hasLaunchpad", hasLaunchpad);
}

function scheduleMenuContext(): void {
  clearTimeout(contextTimer);
  contextTimer = setTimeout(() => void updateMenuContext(), 300);
}

const SOURCE_FILES = "**/{.abapgit.xml,*.astabl,*.asddls,*.asddlxs,*.asdcls,*.asbdef,*.srvdsrv,*.acds,*.abap}";

/** "New RAP object (wizard)": the wizard of the catalog of rapt generate, like ADT (D61). */
async function newObject(root: string, kind?: string): Promise<void> {
  let catalog: CatalogEntry[];
  try {
    catalog = (await runJson<{ kinds: CatalogEntry[] }>(cli(), ["generate", root], root)).kinds;
  } catch (e) {
    cliFailed(e as Error);
    return;
  }
  openWizard({
    title: `New RAP object — ${path.basename(root)}`,
    catalog,
    objects: await objectsOf(root),
    ...(kind === undefined ? {} : { kind }),
    finish: async (answer) => {
      const entry = catalog.find((e) => e.kind === answer.kind);
      if (entry === undefined) return "Unknown object type";
      const args = wizardArgs(root, entry, answer.name, answer.description, answer.values);
      if (typeof args === "string") return args;
      if (args[0] === "new") args.push(...launchpadArgs());
      try {
        const result = await runJson<GenerateResult & { launchpad?: LaunchpadAddResult }>(cli(), args, root);
        if (!result.ok) return result.error ?? "creation failed";
        output.appendLine(`rapt ${args[0]} ${answer.kind} ${answer.name}: ${result.written.join(", ")}`);
        notifyLaunchpad(result.launchpad);
        objectsView?.refresh();
        const main = result.written.find((f) => !f.endsWith(".xml") && !f.endsWith(".json") && f !== ".abapgit.xml") ?? result.written[0];
        if (main !== undefined) {
          await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, main)));
        }
        void vscode.window.showInformationMessage(`RAP: ${answer.name} created (${result.written.length} files).`);
        return undefined;
      } catch (e) {
        return (e as Error).message.split("\n")[0];
      }
    },
  });
}

/** "Choose the floorplan of the application": per root entity set, with what each floorplan is for (D61). */
async function floorplan(root: string): Promise<void> {
  const answer = await floorplans(root);
  if (answer === undefined) return;
  if (answer.sets.length === 0) {
    void vscode.window.showWarningMessage("RAP: the service exposes no root entity.");
    return;
  }
  const set = answer.sets.length === 1 ? answer.sets[0] : (await vscode.window.showQuickPick(answer.sets.map((s) => ({ label: s.set, description: s.chosen ? s.floorplan : "to choose", s })), { title: "RAP: floorplan of the application", placeHolder: "Root entity set" }))?.s;
  if (set === undefined) return;
  if (await pickFloorplan(root, answer, set, false)) {
    void vscode.window.showInformationMessage(`RAP: floorplan of ${set.set} saved (rapt/config.json).${dev?.root === root ? "" : " Start rapt dev to see it."}`);
  }
}

type FloorplanAnswer = { sets: Array<{ set: string; floorplan: string; chosen?: boolean }>; floorplans: Array<{ floorplan: string; label: string; description: string; needs: string }> };

async function floorplans(root: string): Promise<FloorplanAnswer | undefined> {
  try {
    return await runJson<FloorplanAnswer>(cli(), ["floorplan", root], root);
  } catch (e) {
    cliFailed(e as Error);
    return undefined;
  }
}

/** Asks the floorplan of an entity set and writes it; false when cancelled or refused. */
async function pickFloorplan(root: string, answer: FloorplanAnswer, set: FloorplanAnswer["sets"][number], required: boolean): Promise<boolean> {
  const picked = await vscode.window.showQuickPick(
    answer.floorplans.map((f) => ({ label: `${set.chosen === true && f.floorplan === set.floorplan ? "$(check) " : ""}${f.label}`, description: f.floorplan, detail: `${f.description} Annotations: ${f.needs}`, f })),
    {
      title: `RAP: floorplan of the application — ${set.set}${required ? " (required before generating the application)" : ""}`,
      placeHolder: "How do users work on these objects?",
      matchOnDetail: true,
      ignoreFocusOut: required,
    },
  );
  if (picked === undefined) return false;
  try {
    const result = await runJson<{ ok: boolean; error?: string; file: string; launchpad?: LaunchpadAddResult }>(cli(), ["floorplan", root, set.set, picked.f.floorplan, ...launchpadArgs()], root);
    if (!result.ok) {
      void vscode.window.showErrorMessage(`RAP: ${result.error ?? "failed"}`);
      return false;
    }
    output.appendLine(`rapt floorplan ${set.set}: ${picked.f.floorplan} (${result.file})`);
    notifyLaunchpad(result.launchpad);
    return true;
  } catch (e) {
    cliFailed(e as Error);
    return false;
  }
}

/** The floorplan of each root entity set is chosen before the application is generated (D66). */
async function ensureFloorplans(root: string): Promise<boolean> {
  const answer = await floorplans(root);
  if (answer === undefined) return false;
  for (const name of unchosenFloorplans(answer.sets)) {
    const set = answer.sets.find((s) => s.set === name);
    if (set !== undefined && !(await pickFloorplan(root, answer, set, true))) {
      void vscode.window.showWarningMessage(`RAP: choose the floorplan of ${name} to generate the application.`);
      return false;
    }
  }
  return true;
}

/** "Show the intermediate representation": rapt ir, in an editor (model.json). */
async function showIr(root: string): Promise<void> {
  const target = path.join(root, ".rapt", "model.json");
  try {
    await runJson(cli(), ["ir", root, "--out", target], root).catch(() => undefined);
    if (!existsSync(target)) {
      void vscode.window.showErrorMessage("RAP: the intermediate representation could not be built (see \"Check the BO\").");
      return;
    }
    await vscode.window.showTextDocument(vscode.Uri.file(target), { preview: true });
  } catch (e) {
    cliFailed(e as Error);
  }
}

/** "Build the launchpad": the launchpad of the workspace (D69), else a launchpad.json of the workspace. */
async function launchpad(): Promise<void> {
  const own = launchpadFile();
  let file = own !== undefined && existsSync(own) ? own : undefined;
  if (file === undefined) {
    const files = await vscode.workspace.findFiles(`**/${LAUNCHPAD_FILE}`, EXCLUDE, 20);
    file = files.length <= 1 ? files[0]?.fsPath : (await vscode.window.showQuickPick(files.map((f) => ({ label: vscode.workspace.asRelativePath(f), f })), { placeHolder: LAUNCHPAD_FILE }))?.f.fsPath;
  }
  if (file === undefined) {
    void vscode.window.showWarningMessage("RAP: no launchpad yet. It is created with the first application (\"New complete business object\", \"Choose the floorplan of the application\").");
    return;
  }
  await buildLaunchpad(file);
}

/** rapt launchpad <launchpad.json> --out <folder>: the launchpad and the applications of its sources. */
async function buildLaunchpad(file: string): Promise<void> {
  for (const source of launchpadSources(file, readFileSync(file, "utf8"))) {
    if (existsSync(source) && !(await ensureFloorplans(source))) {
      return;
    }
  }
  const base = path.dirname(file);
  const target = await vscode.window.showInputBox({ prompt: "Folder of the generated launchpad (with its applications)", value: path.join(base, "out", "launchpad"), ignoreFocusOut: true });
  if (target === undefined) return;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "RAP: building the launchpad and its applications" }, async () => {
    try {
      const result = await runJson<LaunchpadResult>(cli(), ["launchpad", file, "--out", target], base);
      publish(base, result.diagnostics.map((d) => (d.path === undefined && d.file === undefined ? { ...d, path: file } : d)));
      if (result.ok) {
        const action = await vscode.window.showInformationMessage(
          `RAP: launchpad and ${result.apps.length} application(s) built in ${result.out ?? target} (docker compose up).`,
          "Open folder",
        );
        if (action !== undefined) {
          void vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(path.join(result.out ?? target, "docker-compose.yml")));
        }
      } else {
        void vscode.window.showErrorMessage(`RAP: launchpad not built, ${summary(result.counts)} (Problems panel).`);
      }
    } catch (e) {
      cliFailed(e as Error);
    }
  });
}

/** "Generate the MCP server of the service": rapt/mcp.json, opened to describe each tool (D47). */
async function mcp(root: string): Promise<void> {
  try {
    const result = await runJson<GenerateResult & { tools: number; added: string[]; removed: string[]; file: string }>(cli(), ["mcp", root], root);
    if (!result.ok) {
      void vscode.window.showErrorMessage(`RAP: ${result.error ?? "generation failed"}`);
      return;
    }
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, result.file)));
    const port = config().get<number>("dev.port") ?? 8080;
    output.appendLine(`rapt mcp: ${result.tools} tools (${result.added.length} new). Connect: claude mcp add --transport http rap http://localhost:${port}/mcp`);
    void vscode.window.showInformationMessage(
      `RAP: ${result.tools} MCP tools. Describe each tool in rapt/mcp.json; the application serves them at /mcp (rapt dev: http://localhost:${port}/mcp).`,
    );
  } catch (e) {
    cliFailed(e as Error);
  }
}

/** "Choose the mode of the project": standard (as on SAP) or enhanced, in rapt/config.json (D45). */
async function setMode(root: string): Promise<void> {
  const file = path.join(root, "rapt", "config.json");
  let current: Record<string, unknown> = {};
  try {
    current = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  } catch {
    current = {};
  }
  const picked = await vscode.window.showQuickPick(
    [
      { label: "standard", description: "As on SAP: what would not activate on SAP is refused", picked: current["mode"] !== "enhanced" },
      { label: "enhanced", description: "Open RAP Runtime extensions: managed + unmanaged save on a custom entity, mandatory fields checked, enumerations in OData", picked: current["mode"] === "enhanced" },
    ],
    { title: "RAP: mode of the project", placeHolder: `Current mode: ${current["mode"] === "enhanced" ? "enhanced" : "standard"}`, ignoreFocusOut: true },
  );
  if (picked === undefined) {
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...current, mode: picked.label }, null, 2)}\n`);
  void vscode.window.showInformationMessage(`RAP: mode ${picked.label} (rapt/config.json)`);
  await check(root, true);
}

async function abapGit(root: string): Promise<void> {
  try {
    const result = await runJson<AbapGitResult>(cli(), ["abapgit", root], root);
    for (const skipped of result.skipped) {
      output.appendLine(`${skipped.file}: ${skipped.reason}`);
    }
    for (const file of result.written) {
      output.appendLine(`written: ${file}`);
    }
    if (result.issues.length > 0) {
      publish(
        root,
        result.issues.map((i) => ({ severity: i.severity, code: i.code, message: i.message, file: i.file, line: i.line, column: i.column, path: path.join(root, i.file) })),
      );
    }
    const message =
      result.written.length === 0 ? "RAP: the abapGit files are up to date." : `RAP: ${result.written.length} abapGit file(s) written.`;
    const extra = result.skipped.length > 0 ? ` ${result.skipped.length} object(s) to complete (see the log).` : "";
    void (result.ok ? vscode.window.showInformationMessage(message + extra) : vscode.window.showErrorMessage(`${message}${extra} Errors in the table sources.`, "Problems").then((a) => a && vscode.commands.executeCommand("workbench.actions.view.problems")));
  } catch (e) {
    cliFailed(e as Error);
  }
}

function showStatus(icon: string, text: string, command?: string, tooltip?: string): void {
  status.text = `${icon} ${text}`;
  status.command = command;
  status.tooltip = tooltip;
  status.show();
}

function onDevEvent(root: string, event: DevEvent): void {
  switch (event.type) {
    case "building":
      showStatus("$(sync~spin)", "RAP: building…", "rapt.devStop", "Stop rapt dev");
      output.appendLine(`[dev] building ${event.root}`);
      break;
    case "changed":
      output.appendLine(`[dev] ${event.file} changed`);
      break;
    case "diagnostics":
      publish(root, event.diagnostics);
      output.appendLine(`[dev] ${summary(event.counts)}`);
      break;
    case "ready":
      if (dev !== undefined) {
        dev.url = event.url;
      }
      showStatus("$(radio-tower)", `RAP: ${new URL(event.url).host}`, "rapt.openUi", `${event.url}\nClick to open the application`);
      output.appendLine(`[dev] ready: ${event.url}`);
      // the browser opens on the first start of a session, not on each rebuild
      if (config().get<boolean>("dev.openUi") === true && dev !== undefined && dev.opened !== true) {
        dev.opened = true;
        void vscode.env.openExternal(vscode.Uri.parse(event.url));
      }
      break;
    case "failed":
      showStatus("$(error)", event.running ? "RAP: errors (previous version running)" : "RAP: errors", "workbench.actions.view.problems");
      break;
    case "server-failed":
      showStatus("$(error)", "RAP: the server did not start", "rapt.showLog");
      break;
    case "database-reset":
      output.appendLine("[dev] the schema changed: development database reset");
      void vscode.window.showInformationMessage("RAP: the schema changed, the development database was reset.");
      break;
    case "error":
      output.appendLine(`[dev] ${event.message}`);
      void vscode.window.showErrorMessage(`RAP: ${event.message}`);
      break;
    case "server-stopped":
      output.appendLine(`[dev] the server stopped (code ${event.code})`);
      break;
    case "log":
      output.appendLine(event.line);
      break;
  }
}

async function devStart(root: string): Promise<void> {
  if (!(await ensureFloorplans(root))) {
    return;
  }
  await devStop();
  const port = config().get<number>("dev.port") ?? 8080;
  const child = new DevProcess(cli(), root, port, (event) => onDevEvent(root, event), (line) => output.appendLine(line));
  const session: NonNullable<typeof dev> = { process: child, root };
  dev = session;
  void vscode.commands.executeCommand("setContext", "rapt.devRunning", true);
  void child.exited.then((code) => {
    if (dev === session) {
      dev = undefined;
      void vscode.commands.executeCommand("setContext", "rapt.devRunning", false);
      showStatus("$(debug-start)", "RAP: dev stopped", "rapt.devStart");
      if (code !== 0 && code !== null) {
        cliFailed(new Error(`rapt dev stopped (code ${code}), see the Open RAP Runtime log`));
      }
    }
  });
}

async function devStop(): Promise<void> {
  const current = dev;
  dev = undefined;
  if (current !== undefined) {
    await current.process.stop();
    void vscode.commands.executeCommand("setContext", "rapt.devRunning", false);
    showStatus("$(debug-start)", "RAP: dev stopped", "rapt.devStart");
  }
}

export function activate(context: vscode.ExtensionContext): void {
  extensionPath = context.extensionPath;
  output = vscode.window.createOutputChannel("Open RAP Runtime");
  diagnostics = vscode.languages.createDiagnosticCollection("rapt");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  showStatus("$(debug-start)", "RAP", "rapt.devStart", "Start rapt dev");

  const withProject = (run: (root: string) => Promise<void>) => async (uri?: vscode.Uri | { root?: string }) => {
    // a project of the "Objets RAP" view, or a file / folder of the explorer
    const root = uri !== undefined && !(uri instanceof vscode.Uri) && typeof uri.root === "string" ? uri.root : await project(uri instanceof vscode.Uri ? uri : undefined);
    if (root !== undefined) {
      await run(root);
    }
  };
  const watcher = vscode.workspace.createFileSystemWatcher(SOURCE_FILES, false, true, false);
  const launchpadWatcher = vscode.workspace.createFileSystemWatcher(`**/${LAUNCHPAD_FILE}`, false, true, false);
  context.subscriptions.push(
    output,
    diagnostics,
    status,
    watcher,
    watcher.onDidCreate(scheduleMenuContext),
    watcher.onDidDelete(scheduleMenuContext),
    launchpadWatcher,
    launchpadWatcher.onDidCreate(scheduleMenuContext),
    launchpadWatcher.onDidDelete(scheduleMenuContext),
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleMenuContext),
    vscode.workspace.onDidRenameFiles(scheduleMenuContext),
    vscode.commands.registerCommand("rapt.check", withProject((root) => check(root))),
    vscode.commands.registerCommand("rapt.build", withProject(build)),
    vscode.commands.registerCommand("rapt.devStart", withProject(devStart)),
    vscode.commands.registerCommand("rapt.devStop", devStop),
    vscode.commands.registerCommand("rapt.openUi", async () => {
      if (dev?.url === undefined) {
        void vscode.window.showWarningMessage("RAP: rapt dev is not running.", "Start").then((a) => a && vscode.commands.executeCommand("rapt.devStart"));
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(dev.url));
    }),
    vscode.commands.registerCommand("rapt.showLog", () => output.show()),
    vscode.commands.registerCommand("rapt.feedback", async () => {
      // the feedback form of the website, which opens a pre-filled issue of the public feedback repository (D71)
      const kind = await vscode.window.showQuickPick(
        [
          { label: "$(bug) Report a bug", feedback: "bug" as const },
          { label: "$(lightbulb) Request a feature", feedback: "feature" as const },
        ],
        { title: "Open RAP Runtime: feedback" },
      );
      if (kind === undefined) return;
      const version = String((context.extension.packageJSON as { version?: string }).version ?? "");
      const environment = `VS Code ${vscode.version} on ${process.platform} (${process.arch})`;
      await vscode.env.openExternal(vscode.Uri.parse(feedbackUrl(kind.feedback, version, environment)));
    }),
    vscode.commands.registerCommand("rapt.newBo", newBo),
    vscode.commands.registerCommand("rapt.abapgit", withProject(abapGit)),
    vscode.commands.registerCommand("rapt.generate", withProject(generate)),
    vscode.commands.registerCommand("rapt.setMode", withProject(setMode)),
    vscode.commands.registerCommand("rapt.mcp", withProject(mcp)),
    vscode.commands.registerCommand("rapt.newObject", withProject((root) => newObject(root))),
    vscode.commands.registerCommand("rapt.floorplan", withProject(floorplan)),
    vscode.commands.registerCommand("rapt.ir", withProject(showIr)),
    vscode.commands.registerCommand("rapt.launchpad", launchpad),
    vscode.commands.registerCommand("rapt.refreshObjects", () => objectsView?.refresh()),
    vscode.window.registerTreeDataProvider("raptObjects", (objectsView = new RapObjectsProvider())),
    vscode.workspace.onDidCreateFiles(() => objectsView?.refresh()),
    vscode.workspace.onDidDeleteFiles(() => objectsView?.refresh()),
    // check on save, unless rapt dev already rebuilds this project
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.uri.scheme !== "file" || config().get<boolean>("checkOnSave") === false) {
        return;
      }
      const root = findProjectRoot(document.uri.fsPath, vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath);
      if (root === undefined || dev?.root === root || document.uri.fsPath.includes(`${path.sep}.rapt${path.sep}`)) {
        return;
      }
      clearTimeout(checkTimers.get(root));
      checkTimers.set(
        root,
        setTimeout(() => void check(root, true), 300),
      );
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("rapt.terminal") || event.affectsConfiguration("rapt.cliPath") || event.affectsConfiguration("rapt.nodePath")) {
        installTerminalCommand(context);
      }
    }),
  );
  installTerminalCommand(context);
  registerAgentServer(context);
}

/**
 * `rapt` in the integrated terminals (D64): shims in the storage of the extension, first on the
 * PATH of the terminals it opens from now on. Updated when the CLI settings change.
 */
function installTerminalCommand(context: vscode.ExtensionContext): void {
  const collection = context.environmentVariableCollection;
  collection.clear();
  if (config().get<boolean>("terminal.addToPath") === false) {
    return;
  }
  const shims = terminalShims(cli());
  if (shims.length === 0) {
    return;
  }
  const bin = path.join(context.globalStorageUri.fsPath, "bin");
  mkdirSync(bin, { recursive: true });
  for (const shim of shims) {
    const file = path.join(bin, shim.name);
    writeFileSync(file, shim.content);
    if (shim.executable) {
      chmodSync(file, 0o755);
    }
  }
  collection.description = "Adds the rapt command of the Open RAP Runtime extension";
  collection.prepend("PATH", `${bin}${path.delimiter}`);
}

/** The MCP server of rapt (`rapt agent`), offered to the agent mode of VS Code (D64). */
function registerAgentServer(context: vscode.ExtensionContext): void {
  const lm = vscode.lm as typeof vscode.lm & { registerMcpServerDefinitionProvider?: typeof vscode.lm.registerMcpServerDefinitionProvider };
  if (typeof lm.registerMcpServerDefinitionProvider !== "function" || typeof vscode.McpStdioServerDefinition !== "function") {
    return;
  }
  const changed = new vscode.EventEmitter<void>();
  const version = String((context.extension.packageJSON as { version?: string }).version ?? "");
  context.subscriptions.push(
    changed,
    vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()),
    lm.registerMcpServerDefinitionProvider("rapt.agent", {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: () => {
        if (config().get<boolean>("agent.enabled") === false) {
          return [];
        }
        const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => ({ name: f.name, path: f.uri.fsPath }));
        return agentServers(cli(), folders).map((server) => {
          const definition = new vscode.McpStdioServerDefinition(server.label, server.command, server.args, server.env, version);
          definition.cwd = vscode.Uri.file(server.cwd);
          return definition;
        });
      },
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("rapt.agent") || event.affectsConfiguration("rapt.cliPath") || event.affectsConfiguration("rapt.nodePath")) {
        changed.fire();
      }
    }),
  );
  void updateMenuContext();
}

export async function deactivate(): Promise<void> {
  await devStop();
}
