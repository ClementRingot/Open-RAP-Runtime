/** `rapt build`: writes the generated application into the output folder. */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Model } from "@rap-transpiler/model";
import type { Diagnostics } from "./diagnostics.js";
import { generateCsdl } from "./gen/csdl.js";
import { generateSql } from "./gen/sql.js";
import type { Project } from "./input/project.js";
import { buildModel, type BuildOptions } from "./ir/builder.js";

export interface GeneratedFile {
  /** Path relative to the output folder, with forward slashes. */
  path: string;
  content: string;
}

export interface BuildApplicationResult {
  diagnostics: Diagnostics;
  model?: Model;
  files: GeneratedFile[];
}

/** Generates the files of the application in memory. */
export function generateApplication(project: Project, options: BuildOptions = {}): BuildApplicationResult {
  const { model, diagnostics } = buildModel(project, options);
  if (model === undefined || diagnostics.hasErrors()) {
    return model === undefined ? { diagnostics, files: [] } : { diagnostics, model, files: [] };
  }
  const files: GeneratedFile[] = [
    { path: "model/model.json", content: `${JSON.stringify(model, null, 2)}\n` },
    { path: "db/schema.sql", content: generateSql(model).schema },
    { path: "odata/metadata.xml", content: generateCsdl(model) },
  ];
  return { diagnostics, model, files };
}

export function writeFiles(outDir: string, files: GeneratedFile[]): void {
  for (const file of files) {
    const target = path.join(outDir, ...file.path.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
}
