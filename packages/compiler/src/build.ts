/** `rapt build`: writes the generated application into the output folder. */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Model } from "@rap-transpiler/model";
import type { Diagnostics } from "./diagnostics.js";
import { generateAbap } from "./gen/abap/generate.js";
import { findDestinations, generateScaffold } from "./gen/app/index.js";
import { generateCsdl } from "./gen/csdl.js";
import { generateSql } from "./gen/sql.js";
import { buildMcpTools, loadMcpConfig } from "./gen/mcp.js";
import { generateUi } from "./gen/ui/index.js";
import type { Project } from "./input/project.js";
import { buildModel, type BuildOptions } from "./ir/builder.js";
import { loadSeed } from "./ir/seed.js";

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

export interface GenerateOptions extends BuildOptions {
  /** Run the transpiler (default true); `rapt check` can skip writing but still transpiles. */
  transpile?: boolean;
  /** Write package.json, server.mjs, Docker files and the embedded runtime (default true). */
  scaffold?: boolean;
  /** Folder of the @rap-transpiler/runtime package to embed (default: next to the compiler). */
  runtimeDir?: string;
}

/** Generates the files of the application in memory. */
export async function generateApplication(project: Project, options: GenerateOptions = {}): Promise<BuildApplicationResult> {
  const { model, diagnostics } = buildModel(project, options);
  if (model === undefined || diagnostics.hasErrors()) {
    return model === undefined ? { diagnostics, files: [] } : { diagnostics, model, files: [] };
  }
  const seed = loadSeed(project, model, diagnostics);
  if (diagnostics.hasErrors()) {
    return { diagnostics, model, files: [] };
  }
  const abap = await generateAbap(project, model, diagnostics, options.transpile === false ? { transpile: false } : {});
  if (abap === undefined || diagnostics.hasErrors()) {
    return { diagnostics, model, files: [] };
  }
  const files: GeneratedFile[] = [
    { path: "model/model.json", content: `${JSON.stringify(model, null, 2)}\n` },
    { path: "db/schema.sql", content: generateSql(model).schema },
    { path: "odata/metadata.xml", content: generateCsdl(model) },
    ...abap.modules.map((m) => ({ path: `abap/${m.path}`, content: m.content })),
    ...abap.sources.map((s) => ({ path: `abap/src/${s.fileName}`, content: s.content })),
    // a Web API (D60) has no UI
    ...(model.service.webApi === true ? [] : generateUi(model).map((f) => ({ path: `ui/${f.path}`, content: f.content }))),
  ];
  // the MCP server of the service (D47), when rapt/mcp.json asks for it
  const mcp = loadMcpConfig(project, diagnostics);
  if (mcp !== undefined) {
    files.push({ path: "mcp/tools.json", content: `${JSON.stringify(buildMcpTools(model, mcp, diagnostics), null, 2)}\n` });
  }
  if (seed.json !== undefined) {
    files.push({ path: "db/seed.json", content: `${JSON.stringify(seed.json, null, 2)}\n` });
  }
  if (seed.sql !== undefined) {
    files.push({ path: "db/seed.sql", content: seed.sql });
  }
  if (options.scaffold !== false) {
    const destinations = findDestinations(abap.sources.filter((source) => source.original !== undefined));
    files.push(...generateScaffold(model, diagnostics, { destinations, ...(options.runtimeDir === undefined ? {} : { runtimeDir: options.runtimeDir }) }));
    if (diagnostics.hasErrors()) {
      return { diagnostics, model, files: [] };
    }
  }
  return { diagnostics, model, files };
}

export function writeFiles(outDir: string, files: GeneratedFile[]): void {
  for (const file of files) {
    const target = path.join(outDir, ...file.path.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
}
