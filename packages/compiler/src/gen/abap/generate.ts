/**
 * Generation of the JavaScript of the behavior pools: rewrite pass (D2), check with the
 * transpiler's own abaplint configuration, then @abaplint/transpiler.
 *
 * The registry given to the transpiler holds only standard ABAP: the clean-room framework, the
 * derived types interfaces, the shadow tables (D19) and the rewritten classes.
 */

import * as abaplint from "@abaplint/core";
import { config as transpilerConfig, Transpiler, UnknownTypesEnum } from "@abaplint/transpiler";
import { derivedTypesInterfaceName, type Model } from "@rap-transpiler/model";
import type { Diagnostics } from "../../diagnostics.js";
import type { Project, SourceFile } from "../../input/project.js";
import { abaplintRegistry } from "../../ir/handlers.js";
import { generateDerivedTypes } from "./derived-types.js";
import { FRAMEWORK_SOURCES } from "./framework.js";
import { QUERY_FRAMEWORK_SOURCES } from "./framework-query.js";
import { frameworkClosure, frameworkObjectName } from "./framework-utils.js";
import { BdefCatalog, findModelProviders, findSaverClasses, poolBdefOf, rewriteAbapFile } from "./rewrite.js";
import { frameworkDictionary, shadowEntity, shadowTable } from "./shadow.js";

export interface AbapSource {
  fileName: string;
  content: string;
  /** Path of the original source in the project, for rewritten files. */
  original?: string;
}

export interface AbapOutput {
  /** The ABAP given to the transpiler (written to `abap/src/` for reference). */
  sources: AbapSource[];
  /** The JavaScript modules, by path relative to the `abap/` folder. */
  modules: Array<{ path: string; content: string }>;
  /** Module to import at start-up (relative to `abap/`). */
  entry: string;
}

/** Objects copied as they are into the transpiler's registry. */
const DDIC_TYPES = new Set(["DTEL", "DOMA", "TTYP", "MSAG"]);

/** Behavior pools of the model and the classes and interfaces of the project they use. */
function objectsToRewrite(project: Project, model: Model, registry: abaplint.Registry): Set<string> {
  const candidates = new Map<string, SourceFile[]>();
  for (const file of project.files.filter((f) => f.type === "CLAS" || f.type === "INTF")) {
    const key = `${file.type}:${file.name}`;
    candidates.set(key, [...(candidates.get(key) ?? []), file]);
  }
  const names = new Map<string, string>();
  for (const key of candidates.keys()) {
    names.set(key.slice(5).toLowerCase(), key);
  }
  const pools = [
    ...model.behaviors.flatMap((b) => [b.implementationClass, ...b.entities.map((e) => e.implementationClass)]),
    // the query classes of the custom entities (D43)
    ...model.entities.map((e) => e.queryClass),
  ].filter((c): c is string => c !== undefined);
  const wanted = new Set<string>(pools.map((p) => `CLAS:${p.toUpperCase()}`).filter((k) => candidates.has(k)));
  const queue = [...wanted];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    const object = registry.getObject(key.slice(0, 4), key.slice(5));
    if (!(object instanceof abaplint.ABAPObject)) {
      continue;
    }
    for (const file of object.getABAPFiles()) {
      for (const token of file.getTokens()) {
        const used = names.get(token.getStr().toLowerCase());
        if (used !== undefined && !wanted.has(used)) {
          wanted.add(used);
          queue.push(used);
        }
      }
    }
  }
  return wanted;
}

function transpilerRegistry(sources: AbapSource[]): abaplint.Registry {
  const registry = new abaplint.Registry(new abaplint.Config(JSON.stringify(transpilerConfig)));
  for (const source of sources) {
    registry.addFile(new abaplint.MemoryFile(source.fileName, source.content));
  }
  registry.parse();
  return registry;
}

/** Rewrites the behavior pools and lists the ABAP given to the transpiler. */
export function abapSources(project: Project, model: Model, diagnostics: Diagnostics): AbapSource[] {
  const catalog = new BdefCatalog(model);
  const registry = abaplintRegistry(project);
  const sources: AbapSource[] = FRAMEWORK_SOURCES.map((f) => ({ fileName: f.fileName, content: f.source }));
  for (const bdef of catalog.bdefs) {
    const { interfaceName, source } = generateDerivedTypes(model, bdef.behavior);
    sources.push({ fileName: `${interfaceName.toLowerCase()}.intf.abap`, content: source });
  }
  for (const table of model.tables) {
    const shadow = shadowTable(table);
    sources.push({ fileName: shadow.fileName, content: shadow.content });
  }
  const projectObjects = new Set(project.files.map((f) => `${f.type}:${f.name}`));
  for (const table of model.tables) {
    projectObjects.add(`TABL:${table.name.toUpperCase()}`);
  }
  if (model.entities.some((e) => e.kind === "custom")) {
    for (const source of QUERY_FRAMEWORK_SOURCES) {
      sources.push({ fileName: source.fileName, content: source.source });
    }
  }
  for (const entity of model.entities.filter((e) => (e.sqlView !== undefined || e.kind === "abstract" || e.kind === "custom") && !projectObjects.has(`TABL:${e.name.toUpperCase()}`))) {
    const shadow = shadowEntity(entity);
    sources.push({ fileName: shadow.fileName, content: shadow.content });
    projectObjects.add(`TABL:${entity.name.toUpperCase()}`);
  }
  for (const file of frameworkDictionary(projectObjects)) {
    sources.push({ fileName: file.fileName, content: file.content });
  }
  for (const file of project.files.filter((f) => DDIC_TYPES.has(f.type) && f.extension === "xml")) {
    sources.push({ fileName: file.fileName, content: file.content, original: file.path });
  }
  for (const key of objectsToRewrite(project, model, registry)) {
    const [type = "", name = ""] = [key.slice(0, 4), key.slice(5)];
    const object = registry.getObject(type, name);
    if (!(object instanceof abaplint.ABAPObject)) {
      continue;
    }
    const files = object.getABAPFiles();
    const main = files.find((f) => /\.(clas|intf)\.abap$/.test(f.getFilename()));
    const pool = poolBdefOf(catalog, name, main);
    const saverClasses = findSaverClasses(files);
    const modelProviders = findModelProviders(files);
    for (const file of files) {
      if (/\.testclasses\.abap$/.test(file.getFilename())) {
        continue;
      }
      const original = project.files.find((f) => f.fileName === file.getFilename());
      const content = rewriteAbapFile(file, { catalog, diagnostics, file: original?.path ?? file.getFilename(), saverClasses, modelProviders, ...(pool === undefined ? {} : { pool }) });
      sources.push({ fileName: file.getFilename(), content, ...(original === undefined ? {} : { original: original.path }) });
    }
    for (const xml of project.files.filter((f) => f.type === type && f.name === name && f.extension === "xml")) {
      sources.push({ fileName: xml.fileName, content: xml.content, original: xml.path });
    }
  }
  // the utilities of ABAP Cloud the project uses (D40), unless it has objects of the same name
  for (const util of frameworkClosure(sources.filter((s) => s.original !== undefined))) {
    const type = (util.fileName.split(".")[1] ?? "").toUpperCase();
    if (!projectObjects.has(`${type}:${frameworkObjectName(util.fileName).toUpperCase()}`)) {
      sources.push({ fileName: util.fileName, content: util.source });
    }
  }
  return sources;
}

/**
 * Checks the rewritten ABAP with the configuration of the transpiler and reports the issues on
 * the original files (the rewrite pass keeps the line numbers). Issues in generated sources are
 * internal errors.
 */
export function checkAbap(sources: AbapSource[], diagnostics: Diagnostics): abaplint.Registry {
  const registry = transpilerRegistry(sources);
  const byFile = new Map(sources.map((s) => [s.fileName, s]));
  const seen = new Set<string>();
  for (const issue of registry.findIssues()) {
    const source = byFile.get(issue.getFilename());
    const line = issue.getStart().getRow();
    const message = issue.getMessage();
    const key = `${issue.getFilename()}:${line}:${message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (source?.original !== undefined) {
      diagnostics.error("ABP004", `ABAP check error (${issue.getKey()}): ${message}`, { file: source.original, line, column: issue.getStart().getCol() });
    } else {
      diagnostics.error("ABP008", `internal error in the generated ABAP ${issue.getFilename()}:${line}: ${message} (${issue.getKey()})`);
    }
  }
  if (!diagnostics.hasErrors()) {
    untypedSelectTargets(registry, byFile, diagnostics);
  }
  return registry;
}

type AbapTypeOf = ReturnType<abaplint.TypedIdentifier["getType"]>;

/** abaplint types the result of some SELECTs as void ("SELECT_todo…"), alone or as table rows. */
function isUntypedSelectResult(type: AbapTypeOf): boolean {
  const t = type instanceof abaplint.BasicTypes.TableType ? type.getRowType() : type;
  return t instanceof abaplint.BasicTypes.VoidType && (t.getVoided() ?? "").startsWith("SELECT_todo");
}

/**
 * Inline declarations of SELECT results that abaplint cannot type (a literal, an aggregate other
 * than COUNT(*), an expression in the field list): the transpiled method would throw when it
 * starts. Reported on the original line, the target has to be declared.
 */
function untypedSelectTargets(registry: abaplint.Registry, byFile: Map<string, AbapSource>, diagnostics: Diagnostics): void {
  const seen = new Set<string>();
  for (const object of registry.getObjects()) {
    if (!(object instanceof abaplint.ABAPObject) || !object.getABAPFiles().some((f) => byFile.get(f.getFilename())?.original !== undefined)) {
      continue;
    }
    const { spaghetti } = new abaplint.SyntaxLogic(registry, object).run();
    const visit = (node: abaplint.ISpaghettiScopeNode): void => {
      for (const id of Object.values(node.getData().vars)) {
        const source = byFile.get(id.getFilename());
        const key = `${id.getFilename()}:${id.getStart().getRow()}:${id.getName()}`;
        if (source?.original === undefined || seen.has(key) || !isUntypedSelectResult(id.getType())) {
          continue;
        }
        seen.add(key);
        diagnostics.error(
          "ABP009",
          `abaplint cannot type the inline declaration ${id.getName()} of this SELECT (literal, aggregate or expression in the field list): declare the target with DATA … TYPE …`,
          { file: source.original, line: id.getStart().getRow(), column: id.getStart().getCol() },
        );
      }
      node.getChildren().forEach(visit);
    };
    visit(spaghetti.getTop());
  }
}

/** Namespaced objects (/DMO/…) give module names with `#`, imported as `%23`: plain names are safer. */
function safeModulePath(file: string): string {
  return file.replace(/#/g, "_");
}

function safeImports(code: string): string {
  return code.replace(/(["'])(\.\/[^"'\n]*%23[^"'\n]*)\1/g, (_m, quote: string, specifier: string) => `${quote}${specifier.replace(/%23/g, "_")}${quote}`);
}

/** Rewrite, check and transpile. Returns undefined when there are errors (in `diagnostics`). */
export async function generateAbap(project: Project, model: Model, diagnostics: Diagnostics, options: { transpile?: boolean } = {}): Promise<AbapOutput | undefined> {
  const sources = abapSources(project, model, diagnostics);
  if (diagnostics.hasErrors()) {
    return undefined;
  }
  const registry = checkAbap(sources, diagnostics);
  if (diagnostics.hasErrors()) {
    return undefined;
  }
  model.abap = {
    modules: ["init.mjs"],
    derivedTypes: Object.fromEntries(model.behaviors.filter((b) => b.implementationType === "managed").map((b) => [b.name, derivedTypesInterfaceName(b.name)])),
  };
  if (options.transpile === false) {
    return { sources, modules: [], entry: "init.mjs" };
  }
  try {
    const output = await new Transpiler({ unknownTypes: UnknownTypesEnum.compileError, ignoreSourceMap: true, addCommonJS: true }).run(registry);
    const modules = output.objects.map((o) => ({ path: safeModulePath(o.filename), content: safeImports(o.chunk.getCode()) }));
    modules.push({ path: "init.mjs", content: safeImports(output.initializationScript) });
    return { sources, modules, entry: "init.mjs" };
  } catch (error) {
    diagnostics.error("ABP008", `transpiler: ${(error as Error).message}`);
    return undefined;
  }
}
