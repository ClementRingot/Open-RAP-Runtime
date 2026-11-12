/**
 * The "Objets RAP" view (D61): the objects of the RAP projects of the workspace, grouped as in
 * the project explorer of ADT (dictionary, data definitions, behavior definitions, services…);
 * a click opens the source. Its title bar creates an object, checks the project, runs rapt dev.
 */

import path from "node:path";
import * as vscode from "vscode";
import { groupObjects, OBJECT_GROUPS } from "./rapt.js";

type Node = { kind: "project"; root: string } | { kind: "group"; root: string; id: string; label: string; files: string[] } | { kind: "file"; root: string; file: string };

const PATTERN = "**/*.{astabl,xml,asddls,acds,asdrty,asddlxs,asdcls,asbdef,srvdsrv,abap}";
const EXCLUDE = "{**/node_modules/**,**/.rapt/**}";

export class RapObjectsProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  public readonly onDidChangeTreeData = this.changed.event;

  public refresh(): void {
    this.changed.fire(undefined);
  }

  public getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "project") {
      const item = new vscode.TreeItem(path.basename(node.root), vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon("package");
      item.description = vscode.workspace.asRelativePath(node.root);
      item.contextValue = "raptProject";
      item.resourceUri = vscode.Uri.file(node.root);
      return item;
    }
    if (node.kind === "group") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon("folder");
      item.description = String(node.files.length);
      return item;
    }
    const item = new vscode.TreeItem(path.basename(node.file).split(".")[0]?.toUpperCase().replace(/#/g, "/") ?? node.file, vscode.TreeItemCollapsibleState.None);
    item.description = path.basename(node.file).split(".").slice(1).join(".");
    item.resourceUri = vscode.Uri.file(node.file);
    item.command = { command: "vscode.open", title: "Ouvrir", arguments: [vscode.Uri.file(node.file)] };
    item.contextValue = "raptObject";
    return item;
  }

  public async getChildren(node?: Node): Promise<Node[]> {
    if (node === undefined) {
      const found = await vscode.workspace.findFiles("**/.abapgit.xml", EXCLUDE, 50);
      return [...new Set(found.map((f) => path.dirname(f.fsPath)))].sort().map((root) => ({ kind: "project", root }));
    }
    if (node.kind === "project") {
      const files = await vscode.workspace.findFiles(new vscode.RelativePattern(node.root, PATTERN), EXCLUDE);
      const groups = groupObjects(files.map((f) => f.fsPath));
      return OBJECT_GROUPS.filter((g) => (groups[g.id] ?? []).length > 0).map((g) => ({ kind: "group", root: node.root, id: g.id, label: g.label, files: groups[g.id] ?? [] }));
    }
    if (node.kind === "group") {
      return node.files.map((file) => ({ kind: "file", root: node.root, file }));
    }
    return [];
  }
}
