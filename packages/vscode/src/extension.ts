/**
 * RAP Transpiler for VS Code: a thin layer over the rapt command line (`--json`). The commands,
 * the Problems panel, the status bar and the UI preview all come from `rapt check`, `rapt build`
 * and `rapt dev`; the extension compiles nothing itself.
 */

import path from "node:path";
import * as vscode from "vscode";
import { diagnosticPath, DevProcess, findProjectRoot, position, resolveCli, runJson, summary, type Cli, type DevEvent, type RaptDiagnostic } from "./rapt.js";

const SEVERITY: Record<RaptDiagnostic["severity"], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

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
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
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
  output = vscode.window.createOutputChannel("RAP Transpiler");
  diagnostics = vscode.languages.createDiagnosticCollection("rapt");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  showStatus("$(debug-start)", "RAP", "rapt.devStart", "Lancer rapt dev");

  const withProject = (run: (root: string) => Promise<void>) => async (uri?: vscode.Uri) => {
    const root = await project(uri);
    if (root !== undefined) {
      await run(root);
    }
  };
  context.subscriptions.push(
    output,
    diagnostics,
    status,
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
}

export async function deactivate(): Promise<void> {
  await devStop();
}
