/**
 * RAP Transpiler for VS Code: a thin layer over the rapt command line (`--json`). The commands,
 * the Problems panel, the status bar and the UI preview all come from `rapt check`, `rapt build`
 * and `rapt dev`; the extension compiles nothing itself.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  menuContext,
  projectObjects,
  unchosenFloorplans,
  wizardArgs,
  type CatalogEntry,
  type AbapGitResult,
  type GenerateResult,
  type Cli,
  type DevEvent,
  type NewResult,
  type RaptDiagnostic,
  type RaptResult,
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

function cli(): Cli {
  const cliPath = config().get<string>("cliPath");
  const nodePath = config().get<string>("nodePath");
  return resolveCli({
    ...(cliPath === undefined ? {} : { cliPath }),
    ...(nodePath === undefined ? {} : { nodePath }),
    bundledCli: path.join(extensionPath, "rapt", "node_modules", "@rap-transpiler", "compiler", "dist", "cli.js"),
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
  const found = await vscode.workspace.findFiles("**/.abapgit.xml", "{**/node_modules/**,**/.rapt/**}", 50);
  const roots = [...new Set(found.map((f) => path.dirname(f.fsPath)))].sort();
  if (roots.length <= 1) {
    if (roots.length === 0) {
      void vscode.window.showWarningMessage("RAP : aucun projet abapGit (.abapgit.xml) dans l'espace de travail.");
    }
    return roots[0];
  }
  const picked = await vscode.window.showQuickPick(
    roots.map((root) => ({ label: path.basename(root), description: vscode.workspace.asRelativePath(root), root })),
    { placeHolder: "Projet RAP" },
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
      showStatus(result.ok ? "$(pass)" : "$(error)", `RAP : ${summary(result.counts)}`, result.ok ? undefined : "workbench.actions.view.problems");
    }
    if (!quiet) {
      const message = `RAP ${path.basename(root)} : ${summary(result.counts)}`;
      void (result.ok ? vscode.window.showInformationMessage(message) : vscode.window.showErrorMessage(message, "Problèmes").then((a) => a && vscode.commands.executeCommand("workbench.actions.view.problems")));
    }
  } catch (e) {
    cliFailed(e as Error);
  }
}

function cliFailed(error: Error): void {
  output.appendLine(error.message);
  void vscode.window.showErrorMessage(`RAP : ${error.message.split("\n")[0]}`, "Configurer", "Journal").then((action) => {
    if (action === "Configurer") {
      void vscode.commands.executeCommand("workbench.action.openSettings", "rapt.cliPath");
    } else if (action === "Journal") {
      output.show();
    }
  });
}

async function build(root: string): Promise<void> {
  if (!(await ensureFloorplans(root))) {
    return;
  }
  const defaultOut = path.join(root, "out", path.basename(root));
  const chosen = await vscode.window.showInputBox({ prompt: "Dossier de l'application générée", value: defaultOut, ignoreFocusOut: true });
  if (chosen === undefined) {
    return;
  }
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "RAP : génération de l'application" }, async () => {
    try {
      const result = await runJson(cli(), ["build", root, "--out", chosen], root);
      publish(root, result.diagnostics);
      if (result.ok) {
        const action = await vscode.window.showInformationMessage(`RAP : ${result.files ?? 0} fichiers écrits dans ${result.out ?? chosen}`, "Ouvrir le dossier");
        if (action !== undefined) {
          void vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(path.join(result.out ?? chosen, "package.json")));
        }
      } else {
        void vscode.window.showErrorMessage(`RAP : génération impossible, ${summary(result.counts)}`);
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
  const found = await vscode.workspace.findFiles("**/.abapgit.xml", "{**/node_modules/**,**/.rapt/**}", 2);
  if (found.length > 0) {
    return project();
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) {
    return folders[0]?.uri.fsPath;
  }
  const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: "Créer le BO ici" });
  return picked?.[0]?.fsPath;
}

async function newBo(uri?: vscode.Uri): Promise<void> {
  const root = await newBoFolder(uri);
  if (root === undefined) {
    return;
  }
  const entity = await vscode.window.showInputBox({
    title: "RAP : nouveau business object",
    prompt: "Nom de l'entité (ex. Travel, SalesOrder)",
    ignoreFocusOut: true,
    validateInput: (value) => (validEntityName(value) ? undefined : "Lettres et chiffres, en commençant par une lettre"),
  });
  if (entity === undefined) {
    return;
  }
  const prefix = await vscode.window.showInputBox({
    title: "RAP : nouveau business object",
    prompt: "Préfixe des objets (Z ou Y…) : ZRT donne zrt_travel, ZRT_R_Travel, ZBP_RT_R_TRAVEL…",
    value: config().get<string>("new.prefix") || "Z",
    ignoreFocusOut: true,
    validateInput: (value) => (/^[ZYzy][A-Za-z0-9_]*$/.test(value) ? undefined : "Commence par Z ou Y"),
  });
  if (prefix === undefined) {
    return;
  }
  const description = await vscode.window.showInputBox({ title: "RAP : nouveau business object", prompt: "Description", value: entity, ignoreFocusOut: true });
  if (description === undefined) {
    return;
  }
  try {
    const result = await runJson<NewResult>(cli(), ["new", root, entity, "--prefix", prefix, "--description", description], root);
    if (!result.ok) {
      void vscode.window.showErrorMessage(`RAP : ${result.error ?? "création impossible"}`);
      return;
    }
    output.appendLine(`rapt new ${entity}: ${result.written.join(", ")}`);
    const behavior = result.written.find((f) => f.endsWith(".bdef.asbdef") && f.includes("_r_"));
    if (behavior !== undefined) {
      await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, behavior)));
    }
    const action = await vscode.window.showInformationMessage(`RAP : ${entity} créé (${result.written.length} fichiers).`, "Lancer rapt dev");
    if (action !== undefined) {
      await devStart(root);
    }
  } catch (e) {
    cliFailed(e as Error);
  }
}

/** "Nouvel objet RAP…": rapt generate, with the object to derive from picked in a list (D46). */
async function generate(root: string): Promise<void> {
  const title = "RAP : nouvel objet";
  const picked = await vscode.window.showQuickPick(
    GENERATE_KINDS.map((k) => ({ label: k.label, description: k.kind, option: k })),
    { title, placeHolder: "Type d'objet", ignoreFocusOut: true },
  );
  if (picked === undefined) {
    return;
  }
  const kind = picked.option;
  const args = ["generate", root, kind.kind];
  let source: string | undefined;
  if (kind.source !== undefined) {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root, "**/*.{astabl,xml,asddls,asbdef,srvdsrv}"), "{**/node_modules/**,**/.rapt/**}");
    const candidates = projectObjects(files.map((f) => f.fsPath))[kind.source.of];
    source = await vscode.window.showQuickPick(candidates, { title, placeHolder: kind.source.prompt, ignoreFocusOut: true });
    if (source === undefined) {
      return;
    }
  }
  const name = await vscode.window.showInputBox({
    title,
    prompt: `Nom de l'objet (${kind.label})`,
    value: source !== undefined && kind.name !== undefined ? kind.name(source) : "",
    ignoreFocusOut: true,
    validateInput: (value) => (/^[A-Za-z][A-Za-z0-9_]*$/.test(value) ? undefined : "Lettres, chiffres et _, en commençant par une lettre"),
  });
  if (name === undefined) {
    return;
  }
  args.push(name);
  if (source !== undefined && kind.source !== undefined) {
    args.push(kind.source.option, source);
  }
  if (kind.kind === "view") {
    const root = await vscode.window.showQuickPick(["Vue racine (root view entity)", "Vue enfant"], { title, ignoreFocusOut: true });
    if (root === undefined) {
      return;
    }
    if (root.startsWith("Vue racine")) {
      args.push("--root");
    }
  }
  try {
    const result = await runJson<GenerateResult>(cli(), args, root);
    if (!result.ok) {
      void vscode.window.showErrorMessage(`RAP : ${result.error ?? "création impossible"}`);
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
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root, "**/*.{astabl,xml,asddls,asbdef,srvdsrv}"), "{**/node_modules/**,**/.rapt/**}");
  return projectObjects(files.map((f) => f.fsPath));
}

let objectsView: RapObjectsProvider | undefined;
let contextTimer: NodeJS.Timeout | undefined;

/** The context keys that grey out the commands not yet possible: no project, no service (D63). */
async function updateMenuContext(): Promise<void> {
  const files = await vscode.workspace.findFiles(SOURCE_FILES, "{**/node_modules/**,**/.rapt/**}");
  const { projects, apps } = menuContext(files.map((f) => f.fsPath));
  await vscode.commands.executeCommand("setContext", "rapt.projects", projects);
  await vscode.commands.executeCommand("setContext", "rapt.apps", apps);
  await vscode.commands.executeCommand("setContext", "rapt.hasProject", Object.keys(projects).length > 0);
  await vscode.commands.executeCommand("setContext", "rapt.hasApp", Object.keys(apps).length > 0);
}

function scheduleMenuContext(): void {
  clearTimeout(contextTimer);
  contextTimer = setTimeout(() => void updateMenuContext(), 300);
}

const SOURCE_FILES = "**/{.abapgit.xml,*.astabl,*.asddls,*.asddlxs,*.asdcls,*.asbdef,*.srvdsrv,*.acds,*.abap}";

/** "Nouvel objet RAP (assistant)": the wizard of the catalog of rapt generate, like ADT (D61). */
async function newObject(root: string, kind?: string): Promise<void> {
  let catalog: CatalogEntry[];
  try {
    catalog = (await runJson<{ kinds: CatalogEntry[] }>(cli(), ["generate", root], root)).kinds;
  } catch (e) {
    cliFailed(e as Error);
    return;
  }
  openWizard({
    title: `Nouvel objet RAP — ${path.basename(root)}`,
    catalog,
    objects: await objectsOf(root),
    ...(kind === undefined ? {} : { kind }),
    finish: async (answer) => {
      const entry = catalog.find((e) => e.kind === answer.kind);
      if (entry === undefined) return "Type d'objet inconnu";
      const args = wizardArgs(root, entry, answer.name, answer.description, answer.values);
      if (typeof args === "string") return args;
      try {
        const result = await runJson<GenerateResult>(cli(), args, root);
        if (!result.ok) return result.error ?? "création impossible";
        output.appendLine(`rapt ${args[0]} ${answer.kind} ${answer.name}: ${result.written.join(", ")}`);
        objectsView?.refresh();
        const main = result.written.find((f) => !f.endsWith(".xml") && !f.endsWith(".json") && f !== ".abapgit.xml") ?? result.written[0];
        if (main !== undefined) {
          await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, main)));
        }
        void vscode.window.showInformationMessage(`RAP : ${answer.name} créé (${result.written.length} fichiers).`);
        return undefined;
      } catch (e) {
        return (e as Error).message.split("\n")[0];
      }
    },
  });
}

/** "Choisir le floorplan de l'application": per root entity set, with what each floorplan is for (D61). */
async function floorplan(root: string): Promise<void> {
  const answer = await floorplans(root);
  if (answer === undefined) return;
  if (answer.sets.length === 0) {
    void vscode.window.showWarningMessage("RAP : le service n'expose aucune entité racine.");
    return;
  }
  const set = answer.sets.length === 1 ? answer.sets[0] : (await vscode.window.showQuickPick(answer.sets.map((s) => ({ label: s.set, description: s.chosen ? s.floorplan : "à choisir", s })), { title: "RAP : floorplan de l'application", placeHolder: "Entity set racine" }))?.s;
  if (set === undefined) return;
  if (await pickFloorplan(root, answer, set, false)) {
    void vscode.window.showInformationMessage(`RAP : floorplan de ${set.set} enregistré (rapt/config.json).${dev?.root === root ? "" : " Lancez rapt dev pour le voir."}`);
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
    answer.floorplans.map((f) => ({ label: `${set.chosen === true && f.floorplan === set.floorplan ? "$(check) " : ""}${f.label}`, description: f.floorplan, detail: `${f.description} Annotations : ${f.needs}`, f })),
    {
      title: `RAP : floorplan de l'application — ${set.set}${required ? " (obligatoire avant de générer l'application)" : ""}`,
      placeHolder: "Comment l'utilisateur travaille-t-il sur ces objets ?",
      matchOnDetail: true,
      ignoreFocusOut: required,
    },
  );
  if (picked === undefined) return false;
  try {
    const result = await runJson<{ ok: boolean; error?: string; file: string }>(cli(), ["floorplan", root, set.set, picked.f.floorplan], root);
    if (!result.ok) {
      void vscode.window.showErrorMessage(`RAP : ${result.error ?? "impossible"}`);
      return false;
    }
    output.appendLine(`rapt floorplan ${set.set}: ${picked.f.floorplan} (${result.file})`);
    return true;
  } catch (e) {
    cliFailed(e as Error);
    return false;
  }
}

/** The floorplan of each root entity set is chosen before the application is generated (D63). */
async function ensureFloorplans(root: string): Promise<boolean> {
  const answer = await floorplans(root);
  if (answer === undefined) return false;
  for (const name of unchosenFloorplans(answer.sets)) {
    const set = answer.sets.find((s) => s.set === name);
    if (set !== undefined && !(await pickFloorplan(root, answer, set, true))) {
      void vscode.window.showWarningMessage(`RAP : choisissez le floorplan de ${name} pour générer l'application.`);
      return false;
    }
  }
  return true;
}

/** "Afficher la représentation intermédiaire": rapt ir, in an editor (model.json). */
async function showIr(root: string): Promise<void> {
  const target = path.join(root, ".rapt", "model.json");
  try {
    await runJson(cli(), ["ir", root, "--out", target], root).catch(() => undefined);
    if (!existsSync(target)) {
      void vscode.window.showErrorMessage("RAP : la représentation intermédiaire n'a pas pu être construite (voir « Vérifier le BO »).");
      return;
    }
    await vscode.window.showTextDocument(vscode.Uri.file(target), { preview: true });
  } catch (e) {
    cliFailed(e as Error);
  }
}

/** "Générer le launchpad": rapt launchpad <launchpad.json> --out <dossier>. */
async function launchpad(): Promise<void> {
  const files = await vscode.workspace.findFiles("**/launchpad.json", "{**/node_modules/**,**/.rapt/**}", 20);
  const file = files.length === 1 ? files[0] : (await vscode.window.showQuickPick(files.map((f) => ({ label: vscode.workspace.asRelativePath(f), f })), { placeHolder: "launchpad.json" }))?.f;
  if (file === undefined) {
    void vscode.window.showWarningMessage("RAP : aucun launchpad.json dans l'espace de travail.");
    return;
  }
  const out = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: "Générer le launchpad ici" });
  const target = out?.[0];
  if (target === undefined) return;
  try {
    const result = await runJson<RaptResult>(cli(), ["launchpad", file.fsPath, "--out", target.fsPath], path.dirname(file.fsPath));
    if (result.ok) {
      void vscode.window.showInformationMessage(`RAP : launchpad généré dans ${target.fsPath}.`);
    } else {
      publish(path.dirname(file.fsPath), result.diagnostics);
      void vscode.window.showErrorMessage("RAP : launchpad.json a des erreurs (onglet Problèmes).");
    }
  } catch (e) {
    cliFailed(e as Error);
  }
}

/** "Générer le serveur MCP du service": rapt/mcp.json, opened to describe each tool (D47). */
async function mcp(root: string): Promise<void> {
  try {
    const result = await runJson<GenerateResult & { tools: number; added: string[]; removed: string[]; file: string }>(cli(), ["mcp", root], root);
    if (!result.ok) {
      void vscode.window.showErrorMessage(`RAP : ${result.error ?? "génération impossible"}`);
      return;
    }
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, result.file)));
    const port = config().get<number>("dev.port") ?? 8080;
    output.appendLine(`rapt mcp: ${result.tools} outils (${result.added.length} nouveaux). Connexion : claude mcp add --transport http rap http://localhost:${port}/mcp`);
    void vscode.window.showInformationMessage(
      `RAP : ${result.tools} outils MCP. Décrivez chaque outil dans rapt/mcp.json ; l'application les sert sur /mcp (rapt dev : http://localhost:${port}/mcp).`,
    );
  } catch (e) {
    cliFailed(e as Error);
  }
}

/** "Choisir le mode du projet": standard (as on SAP) or enhanced, in rapt/config.json (D45). */
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
      { label: "standard", description: "Comme sur SAP : ce qui ne s'active pas sur SAP est refusé", picked: current["mode"] !== "enhanced" },
      { label: "enhanced", description: "Extensions rap-transpiler : managed + unmanaged save sur entité custom, champs obligatoires contrôlés", picked: current["mode"] === "enhanced" },
    ],
    { title: "RAP : mode du projet", placeHolder: `Mode actuel : ${current["mode"] === "enhanced" ? "enhanced" : "standard"}`, ignoreFocusOut: true },
  );
  if (picked === undefined) {
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...current, mode: picked.label }, null, 2)}\n`);
  void vscode.window.showInformationMessage(`RAP : mode ${picked.label} (rapt/config.json)`);
  await check(root, true);
}

async function abapGit(root: string): Promise<void> {
  try {
    const result = await runJson<AbapGitResult>(cli(), ["abapgit", root], root);
    for (const skipped of result.skipped) {
      output.appendLine(`${skipped.file}: ${skipped.reason}`);
    }
    for (const file of result.written) {
      output.appendLine(`écrit : ${file}`);
    }
    if (result.issues.length > 0) {
      publish(
        root,
        result.issues.map((i) => ({ severity: i.severity, code: i.code, message: i.message, file: i.file, line: i.line, column: i.column, path: path.join(root, i.file) })),
      );
    }
    const message =
      result.written.length === 0 ? "RAP : les fichiers abapGit sont à jour." : `RAP : ${result.written.length} fichier(s) abapGit écrit(s).`;
    const extra = result.skipped.length > 0 ? ` ${result.skipped.length} objet(s) à compléter (voir le journal).` : "";
    void (result.ok ? vscode.window.showInformationMessage(message + extra) : vscode.window.showErrorMessage(`${message}${extra} Erreurs dans les sources de tables.`, "Problèmes").then((a) => a && vscode.commands.executeCommand("workbench.actions.view.problems")));
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
      showStatus("$(sync~spin)", "RAP : construction…", "rapt.devStop", "Arrêter rapt dev");
      output.appendLine(`[dev] construction de ${event.root}`);
      break;
    case "changed":
      output.appendLine(`[dev] ${event.file} modifié`);
      break;
    case "diagnostics":
      publish(root, event.diagnostics);
      output.appendLine(`[dev] ${summary(event.counts)}`);
      break;
    case "ready":
      if (dev !== undefined) {
        dev.url = event.url;
      }
      showStatus("$(radio-tower)", `RAP : ${new URL(event.url).host}`, "rapt.openUi", `${event.url}\nCliquer pour ouvrir l'application`);
      output.appendLine(`[dev] prêt : ${event.url}`);
      // the browser opens on the first start of a session, not on each rebuild
      if (config().get<boolean>("dev.openUi") === true && dev !== undefined && dev.opened !== true) {
        dev.opened = true;
        void vscode.env.openExternal(vscode.Uri.parse(event.url));
      }
      break;
    case "failed":
      showStatus("$(error)", event.running ? "RAP : erreurs (version précédente active)" : "RAP : erreurs", "workbench.actions.view.problems");
      break;
    case "server-failed":
      showStatus("$(error)", "RAP : le serveur n'a pas démarré", "rapt.showLog");
      break;
    case "database-reset":
      output.appendLine("[dev] le schéma a changé : base de développement réinitialisée");
      void vscode.window.showInformationMessage("RAP : le schéma a changé, la base de développement a été réinitialisée.");
      break;
    case "error":
      output.appendLine(`[dev] ${event.message}`);
      void vscode.window.showErrorMessage(`RAP : ${event.message}`);
      break;
    case "server-stopped":
      output.appendLine(`[dev] le serveur s'est arrêté (code ${event.code})`);
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
      showStatus("$(debug-start)", "RAP : dev arrêté", "rapt.devStart");
      if (code !== 0 && code !== null) {
        cliFailed(new Error(`rapt dev s'est arrêté (code ${code}), voir le journal RAP Transpiler`));
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
    showStatus("$(debug-start)", "RAP : dev arrêté", "rapt.devStart");
  }
}

export function activate(context: vscode.ExtensionContext): void {
  extensionPath = context.extensionPath;
  output = vscode.window.createOutputChannel("RAP Transpiler");
  diagnostics = vscode.languages.createDiagnosticCollection("rapt");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  showStatus("$(debug-start)", "RAP", "rapt.devStart", "Lancer rapt dev");

  const withProject = (run: (root: string) => Promise<void>) => async (uri?: vscode.Uri | { root?: string }) => {
    // a project of the "Objets RAP" view, or a file / folder of the explorer
    const root = uri !== undefined && !(uri instanceof vscode.Uri) && typeof uri.root === "string" ? uri.root : await project(uri instanceof vscode.Uri ? uri : undefined);
    if (root !== undefined) {
      await run(root);
    }
  };
  const watcher = vscode.workspace.createFileSystemWatcher(SOURCE_FILES, false, true, false);
  context.subscriptions.push(
    output,
    diagnostics,
    status,
    watcher,
    watcher.onDidCreate(scheduleMenuContext),
    watcher.onDidDelete(scheduleMenuContext),
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleMenuContext),
    vscode.workspace.onDidRenameFiles(scheduleMenuContext),
    vscode.commands.registerCommand("rapt.check", withProject((root) => check(root))),
    vscode.commands.registerCommand("rapt.build", withProject(build)),
    vscode.commands.registerCommand("rapt.devStart", withProject(devStart)),
    vscode.commands.registerCommand("rapt.devStop", devStop),
    vscode.commands.registerCommand("rapt.openUi", async () => {
      if (dev?.url === undefined) {
        void vscode.window.showWarningMessage("RAP : rapt dev ne tourne pas.", "Lancer").then((a) => a && vscode.commands.executeCommand("rapt.devStart"));
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(dev.url));
    }),
    vscode.commands.registerCommand("rapt.showLog", () => output.show()),
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
  );
  void updateMenuContext();
}

export async function deactivate(): Promise<void> {
  await devStop();
}
