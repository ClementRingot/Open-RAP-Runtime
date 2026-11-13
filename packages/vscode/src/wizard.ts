/**
 * "New RAP object" (D61): a wizard like "New ABAP Repository Object" of ADT, in a webview. The
 * object types come from the catalog of the command line (`rapt generate <src> --json`): a
 * filter, the types by category, then the name, the description and the inputs of the chosen
 * type (the object it derives from is picked among the objects of the project). Finish runs
 * `rapt generate` (or `rapt new` for a complete business object).
 */

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { bindingNames, type CatalogEntry } from "./rapt.js";
import { wizardHtml } from "./wizard-html.js";

export interface WizardAnswer {
  kind: string;
  name: string;
  description: string;
  values: Record<string, string | string[]>;
}

export interface WizardOptions {
  title: string;
  catalog: CatalogEntry[];
  objects: Record<string, string[]>;
  /** Runs the answer; an error message keeps the wizard open. */
  finish: (answer: WizardAnswer) => Promise<string | undefined>;
  kind?: string;
}

export function openWizard(options: WizardOptions): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel("raptWizard", options.title, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
  const nonce = randomBytes(16).toString("base64");
  panel.webview.html = wizardHtml(nonce, panel.webview.cspSource);
  panel.webview.onDidReceiveMessage(async (message: { type: string; answer?: WizardAnswer }) => {
    if (message.type === "ready") {
      // the names a new binding gets for each service definition, UI or Web API (D76)
      await panel.webview.postMessage({ type: "init", catalog: options.catalog, objects: options.objects, bindingNames: bindingNames(options.objects["srvd"] ?? []), kind: options.kind });
    } else if (message.type === "finish" && message.answer !== undefined) {
      const error = await options.finish(message.answer);
      if (error === undefined) {
        panel.dispose();
      } else {
        await panel.webview.postMessage({ type: "error", message: error });
      }
    } else if (message.type === "cancel") {
      panel.dispose();
    }
  });
  return panel;
}
