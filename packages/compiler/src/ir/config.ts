/**
 * The configuration of a project (decision D45): `rapt/config.json` next to the abapGit sources.
 *
 * ```json
 * { "mode": "enhanced" }
 * ```
 *
 * - `standard` (default): the sources behave as on SAP; what SAP refuses, rap-transpiler refuses.
 *   A project that builds in this mode can be imported and activated on SAP.
 * - `enhanced`: rap-transpiler extensions that SAP does not have: a managed BO with unmanaged save
 *   on a custom entity (D43), `field ( mandatory )` checked when saving without a validation.
 *
 * `rapt … --mode standard|enhanced` overrides the file.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ProjectMode } from "@rap-transpiler/model";
import type { Diagnostics } from "../diagnostics.js";
import type { Project } from "../input/project.js";

export const CONFIG_FILE = "rapt/config.json";

export const MODES: readonly ProjectMode[] = ["standard", "enhanced"];

export interface ProjectConfig {
  mode: ProjectMode;
}

export function loadConfig(project: Project, diagnostics: Diagnostics, override?: string): ProjectConfig {
  const config: ProjectConfig = { mode: "standard" };
  const file = path.join(project.root, CONFIG_FILE);
  const at = { file: CONFIG_FILE, line: 1 };
  if (existsSync(file)) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      diagnostics.error("CFG001", `${CONFIG_FILE} is not valid JSON: ${(error as Error).message}`, at);
      json = {};
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      diagnostics.error("CFG001", `${CONFIG_FILE} must be an object, for example { "mode": "enhanced" }`, at);
    } else {
      for (const [name, value] of Object.entries(json)) {
        if (name === "mode") {
          if (typeof value === "string" && (MODES as readonly string[]).includes(value)) {
            config.mode = value as ProjectMode;
          } else {
            diagnostics.error("CFG001", `${CONFIG_FILE}: mode must be ${MODES.map((m) => `"${m}"`).join(" or ")}`, at);
          }
        } else if (name !== "$schema") {
          diagnostics.warning("CFG002", `${CONFIG_FILE}: unknown setting ${name} ignored`, at);
        }
      }
    }
  }
  if (override !== undefined) {
    if ((MODES as readonly string[]).includes(override)) {
      config.mode = override as ProjectMode;
    } else {
      diagnostics.error("CFG001", `--mode must be ${MODES.join(" or ")}, not ${override}`);
    }
  }
  return config;
}
