#!/usr/bin/env node
/** rapt: command line of the RAP → Node.js compiler. */

import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAbapGitFiles, type AbapGitResult } from "./authoring/abapgit.js";
import { generateObject, OBJECT_KINDS } from "./authoring/generate.js";
import { FLOORPLAN_CATALOG, OBJECT_CATALOG } from "./authoring/catalog.js";
import { floorplans } from "./authoring/floorplan.js";
import { serveAgent } from "./agent/server.js";
import { writeMcpFile } from "./authoring/mcp.js";
import { newBusinessObject } from "./authoring/new.js";
import { generateApplication, writeFiles, type GenerateOptions } from "./build.js";
import { parseArgs } from "node:util";
import { DevSession, type DevOptions } from "./dev.js";
import { countDiagnostics, formatDiagnostic, type Diagnostics } from "./diagnostics.js";
import { buildLaunchpad } from "./gen/launchpad/index.js";
import { loadProject } from "./input/project.js";
import { buildModel, type BuildOptions } from "./ir/builder.js";
import { registerApp, type RegisterResult } from "./launchpad/workspace.js";
import { COMPILER_VERSION } from "./version.js";

const USAGE = `rapt ${COMPILER_VERSION}: compiles RAP sources (abapGit format) into a Node.js OData V4 application

Usage:
  rapt check <src> [--service <SRVD>]           report the diagnostics of the sources
  rapt ir    <src> [--service <SRVD>] [--out f] print (or write) the intermediate representation
  rapt build <src> --out <dir> [--service <SRVD>] generate the application into <dir>
  rapt launchpad <launchpad.json> --out <dir>    generate the launchpad into <dir>, with its applications built
                                                 from their sources into <dir>/apps/<id>
  rapt launchpad add <src> [--launchpad <file>]  add the application of <src> to the launchpad of the workspace
                                                 (created, titled "Launchpad", when there is none)
  rapt dev   <src> [--port <n>] [--out <dir>]    build, run with an embedded database, rebuild on change
  rapt new   <src> <Entity> [--prefix Z…]        write the sources of a new business object (and their XML),
                                                 and add the application to the launchpad of the workspace
  rapt abapgit <src> [--check]                   write the abapGit XML files the sources lack
  rapt mcp   <src>                               write rapt/mcp.json: the MCP tools of the service, to describe;
                                                 the application then serves them at /mcp
  rapt generate <src> <kind> <name> [--from X]   write one new object (table, view, projection, behavior,
                                                 pool, metadata, access, service, binding…; no kind: the list)
  rapt floorplan <src> [<EntitySet> <fp>]       the floorplan of the UI of each root entity set: listReport,
                                                 worklist, analyticalListPage or formEntry (rapt/config.json);
                                                 choosing one adds the application to the launchpad
  rapt agent [<workspace>]                       MCP server (stdio) of rapt for AI coding agents: check,
                                                 create objects, floorplans, abapGit, documentation

Options:
  --service <name>   service definition to build (required when the sources have several)
  --mode <mode>      standard (as on SAP, the default) or enhanced (rap-transpiler extensions);
                     overrides "mode" of rapt/config.json
  --binding <name>   service binding name (default: the SRVB of the service, else <SRVD>_O4)
  --binding-type <t> ui or webapi (OData V4 - Web API: no UI information, no draft; default: the SRVB)
  --path <path>      service root path (default: /sap/opu/odata4/sap/<binding>/srvd/sap/<srvd>/0001/)
  --runtime <dir>    @rap-transpiler/runtime package to embed in the application (default: next to rapt)
  --out <path>       output file (rapt ir) or folder (rapt build, rapt launchpad, rapt dev: <src>/.rapt/dev)
  --port <n>         port of the application (rapt dev, default: PORT, else 8080)
  --host <address>   interface of rapt dev (default 127.0.0.1; 0.0.0.0 to open it to the network)
  --json             machine-readable output (rapt check, rapt build, rapt launchpad, rapt new…: one JSON
                     object; rapt dev: one JSON event per line)
  --prefix <Z…>      prefix of the object names (rapt new, default Z): ZRT → zrt_travel, ZRT_R_Travel…
  --description <t>  description of the business object (rapt new)
  --from <name>      rapt generate: the object the new one derives from (view ← table, projection ← view,
                     behavior/metadata/access ← entity)
  --for <name>       rapt generate: the BDEF of a pool, the service definition of a binding
  --expose <A,B>     rapt generate service: the exposed entities
  --root             rapt generate view: a root view entity
  --type <t>         rapt generate dataelement, domain: the built-in type (abap.char(10))
  --check            report the missing XML files without writing them, exit code 1 if any (rapt abapgit)
  --launchpad <file> the launchpad.json of rapt new, rapt floorplan, rapt launchpad add (default: the nearest
                     in the folder of the project or above, else <parent of the project>/launchpad.json)
  --no-launchpad     rapt new, rapt floorplan: do not add the application to a launchpad
  --warnings-as-errors
  -h, --help
`;

function report(diagnostics: Diagnostics): void {
  for (const d of diagnostics.sorted()) {
    const line = formatDiagnostic(d);
    if (d.severity === "error") {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: Record<string, { type: "string" | "boolean"; short?: string }>; allowPositionals: true }>>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        service: { type: "string" },
        mode: { type: "string" },
        binding: { type: "string" },
        "binding-type": { type: "string" },
        path: { type: "string" },
        out: { type: "string" },
        runtime: { type: "string" },
        port: { type: "string" },
        host: { type: "string" },
        json: { type: "boolean" },
        prefix: { type: "string" },
        description: { type: "string" },
        check: { type: "boolean" },
        from: { type: "string" },
        for: { type: "string" },
        expose: { type: "string" },
        root: { type: "boolean" },
        type: { type: "string" },
        launchpad: { type: "string" },
        "no-launchpad": { type: "boolean" },
        "warnings-as-errors": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const [command, source] = parsed.positionals;
  if (parsed.values["help"] === true || command === undefined) {
    process.stdout.write(USAGE);
    return command === undefined && parsed.values["help"] !== true ? 2 : 0;
  }
  if (command === "agent") {
    return serveAgent(source ?? ".");
  }
  if (source === undefined) {
    process.stderr.write(`missing <src>\n\n${USAGE}`);
    return 2;
  }
  if (command === "new") {
    return newCommand(source, parsed.positionals[2], parsed.values, parsed.values["json"] === true);
  }
  if (command === "mcp") {
    const result = writeMcpFile(source, {
      ...(typeof parsed.values["service"] === "string" ? { service: parsed.values["service"] } : {}),
      ...(typeof parsed.values["mode"] === "string" ? { mode: parsed.values["mode"] } : {}),
    });
    if (parsed.values["json"] === true) {
      process.stdout.write(`${JSON.stringify({ command: "mcp", ok: result.error === undefined, root: path.resolve(source), ...result })}\n`);
      return result.error === undefined ? 0 : 1;
    }
    if (result.error !== undefined) {
      process.stderr.write(`${result.error}\n`);
      return 1;
    }
    process.stdout.write(`${result.file}: ${result.tools} tools (${result.added.length} new${result.removed.length === 0 ? "" : `, removed: ${result.removed.join(", ")}`})\n`);
    process.stdout.write("describe each tool in that file; the application serves them at /mcp (rapt dev, rapt build)\n");
    return 0;
  }
  if (command === "floorplan") {
    return floorplanCommand(source, parsed.positionals[2], parsed.positionals[3], parsed.values, parsed.values["json"] === true);
  }
  if (command === "generate") {
    return generateCommand(source, parsed.positionals[2], parsed.positionals[3], parsed.values, parsed.values["json"] === true);
  }
  if (command === "abapgit") {
    return abapGitCommand(source, parsed.values["check"] === true, parsed.values["json"] === true);
  }
  if (command === "launchpad") {
    if (source === "add") {
      return launchpadAddCommand(parsed.positionals[2], parsed.values, parsed.values["json"] === true);
    }
    return launchpadCommand(source, parsed.values, parsed.values["json"] === true);
  }
  const options: GenerateOptions = {};
  if (typeof parsed.values["service"] === "string") options.service = parsed.values["service"];
  if (typeof parsed.values["binding"] === "string") options.binding = parsed.values["binding"];
  if (typeof parsed.values["binding-type"] === "string") options.bindingType = parsed.values["binding-type"];
  if (typeof parsed.values["mode"] === "string") options.mode = parsed.values["mode"];
  if (typeof parsed.values["path"] === "string") options.path = parsed.values["path"];
  if (typeof parsed.values["runtime"] === "string") options.runtimeDir = parsed.values["runtime"];

  if (command === "dev") {
    return dev(source, options, parsed.values["out"], parsed.values["port"], parsed.values["json"] === true, parsed.values["host"]);
  }
  const json = parsed.values["json"] === true;
  const project = loadProject(source);
  if (command === "build") {
    const out = parsed.values["out"];
    if (typeof out !== "string") {
      process.stderr.write(`rapt build needs --out <dir>\n\n${USAGE}`);
      return 2;
    }
    const result = await generateApplication(project, options);
    const buildFailed = result.files.length === 0 || (parsed.values["warnings-as-errors"] === true && result.diagnostics.items.some((d) => d.severity === "warning"));
    if (!buildFailed) {
      writeFiles(out, result.files);
    }
    if (json) {
      writeJson("build", project.root, result.diagnostics, !buildFailed, buildFailed ? {} : { out: path.resolve(out), files: result.files.length });
      return buildFailed ? 1 : 0;
    }
    report(result.diagnostics);
    if (buildFailed) {
      return 1;
    }
    process.stdout.write(`${result.files.length} files written to ${path.resolve(out)}\n`);
    return 0;
  }
  // check: the whole generation (ABAP rewrite, check and transpilation), without writing
  const { model, diagnostics } = command === "check" ? await generateApplication(project, { ...options, scaffold: false }) : buildModel(project, options);
  const failed = diagnostics.hasErrors() || (parsed.values["warnings-as-errors"] === true && diagnostics.items.some((d) => d.severity === "warning"));

  switch (command) {
    case "check": {
      if (json) {
        writeJson("check", project.root, diagnostics, !failed);
        return failed ? 1 : 0;
      }
      report(diagnostics);
      const counts = { error: 0, warning: 0, info: 0 };
      for (const d of diagnostics.items) {
        counts[d.severity]++;
      }
      process.stdout.write(`${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info\n`);
      return failed ? 1 : 0;
    }
    case "ir": {
      report(diagnostics);
      if (model === undefined || failed) {
        return 1;
      }
      const json = `${JSON.stringify(model, null, 2)}\n`;
      if (typeof parsed.values["out"] === "string") {
        mkdirSync(path.dirname(path.resolve(parsed.values["out"])), { recursive: true });
        writeFileSync(parsed.values["out"], json);
      } else {
        process.stdout.write(json);
      }
      return 0;
    }
    default:
      process.stderr.write(`unknown command ${command}\n\n${USAGE}`);
      return 2;
  }
}

function abapGitCommand(source: string, check: boolean, json: boolean): number {
  let result: AbapGitResult;
  try {
    result = generateAbapGitFiles(source, { check });
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 2;
  }
  const errors = result.issues.filter((i) => i.severity === "error");
  const failed = errors.length > 0 || (check && result.written.length > 0);
  if (json) {
    process.stdout.write(`${JSON.stringify({ command: "abapgit", ok: !failed, root: path.resolve(source), check, ...result })}\n`);
    return failed ? 1 : 0;
  }
  for (const issue of result.issues) {
    const line = `${issue.file}:${issue.line}:${issue.column}: ${issue.severity} ${issue.code} ${issue.message}`;
    (issue.severity === "error" ? process.stderr : process.stdout).write(`${line}\n`);
  }
  for (const skipped of result.skipped) {
    process.stdout.write(`${skipped.file}: skipped, ${skipped.reason}\n`);
  }
  for (const file of result.written) {
    process.stdout.write(`${check ? "missing or outdated" : "written"}: ${file}\n`);
  }
  process.stdout.write(result.written.length === 0 ? "abapGit files up to date\n" : `${result.written.length} file(s) ${check ? "to write (run rapt abapgit)" : "written"}\n`);
  return failed ? 1 : 0;
}

/**
 * `rapt floorplan <src>`: the root entity sets and their floorplan; `rapt floorplan <src> <Set>
 * <floorplan>` sets it in rapt/config.json (D61).
 */
function floorplanCommand(source: string, set: string | undefined, floorplan: string | undefined, values: Record<string, unknown>, json: boolean): number {
  const result = floorplans(source, set, floorplan);
  // the application is created once its floorplan is chosen: it joins the launchpad (D69)
  const launchpad = result.ok && "file" in result ? register(result.root, values) : undefined;
  if (json) {
    process.stdout.write(`${JSON.stringify({ command: "floorplan", ...result, ...(launchpad === undefined ? {} : { launchpad }) })}\n`);
    return result.ok ? 0 : 1;
  }
  if (!result.ok) {
    process.stderr.write(`${result.error}\n`);
    return 1;
  }
  if ("file" in result) {
    process.stdout.write(`${result.set}: ${result.label} (${result.file})\n${launchpadLine(launchpad)}`);
    return 0;
  }
  for (const s of result.sets) process.stdout.write(`${s.set.padEnd(24)}${s.floorplan}${s.chosen ? "" : " (default, not chosen)"}\n`);
  process.stdout.write(`\nFloorplans:\n${FLOORPLAN_CATALOG.map((f) => `  ${f.floorplan.padEnd(20)}${f.label}: ${f.description}`).join("\n")}\n`);
  return 0;
}

function generateCommand(source: string, kind: string | undefined, name: string | undefined, values: Record<string, unknown>, json: boolean): number {
  if (kind === undefined && json) {
    // the catalog of the objects, for the creation wizard of the VS Code extension (D61)
    process.stdout.write(`${JSON.stringify({ command: "generate", ok: true, root: path.resolve(source), kinds: OBJECT_CATALOG })}\n`);
    return 0;
  }
  if (kind === undefined || name === undefined) {
    process.stderr.write(`rapt generate needs a kind and a name, e.g. rapt generate . behavior ZR_Travel\n\nKinds:\n${Object.entries(OBJECT_KINDS)
      .map(([k, d]) => `  ${k.padEnd(11)}${d}`)
      .join("\n")}\n`);
    return 2;
  }
  const str = (key: string): string | undefined => (typeof values[key] === "string" ? (values[key] as string) : undefined);
  const expose = str("expose");
  const result = generateObject(source, kind, name, {
    ...(str("from") === undefined ? {} : { from: str("from") as string }),
    ...(str("for") === undefined ? {} : { for: str("for") as string }),
    ...(expose === undefined ? {} : { expose: expose.split(",").map((e) => e.trim()).filter((e) => e !== "") }),
    ...(values["root"] === true ? { root: true } : {}),
    ...(str("binding-type") === undefined ? {} : { bindingType: str("binding-type") as string }),
    ...(str("type") === undefined ? {} : { type: str("type") as string }),
    ...(str("description") === undefined ? {} : { description: str("description") as string }),
  });
  if (json) {
    process.stdout.write(`${JSON.stringify({ command: "generate", ok: result.error === undefined, root: path.resolve(source), kind, name, ...result })}\n`);
    return result.error === undefined ? 0 : 1;
  }
  if (result.error !== undefined) {
    process.stderr.write(`${result.error}\n`);
    return 1;
  }
  for (const file of result.written) {
    process.stdout.write(`written: ${file}\n`);
  }
  return 0;
}

function newCommand(source: string, entity: string | undefined, values: Record<string, unknown>, json: boolean): number {
  if (entity === undefined) {
    process.stderr.write(`rapt new needs the name of the entity, e.g. rapt new . Travel --prefix ZRT\n`);
    return 2;
  }
  const result = newBusinessObject(source, entity, {
    ...(typeof values["prefix"] === "string" ? { prefix: values["prefix"] } : {}),
    ...(typeof values["description"] === "string" ? { description: values["description"] } : {}),
  });
  if (json) {
    const launchpad = result.error === undefined ? register(source, values) : undefined;
    process.stdout.write(`${JSON.stringify({ command: "new", ok: result.error === undefined, root: path.resolve(source), ...result, ...(launchpad === undefined ? {} : { launchpad }) })}\n`);
    return result.error === undefined ? 0 : 1;
  }
  if (result.error !== undefined) {
    process.stderr.write(`${result.error}\n`);
    return 1;
  }
  for (const file of result.written) {
    process.stdout.write(`written: ${file}\n`);
  }
  process.stdout.write(launchpadLine(register(source, values)));
  process.stdout.write(`next: rapt dev ${source}\n`);
  return 0;
}

/** Adds the application of a project to the launchpad of the workspace, unless --no-launchpad (D69). */
function register(root: string, values: Record<string, unknown>): RegisterResult | undefined {
  if (values["no-launchpad"] === true) {
    return undefined;
  }
  return registerApp(root, {
    ...(typeof values["launchpad"] === "string" ? { launchpad: values["launchpad"] } : {}),
    ...(typeof values["service"] === "string" ? { service: values["service"] } : {}),
  });
}

function launchpadLine(result: RegisterResult | undefined): string {
  if (result === undefined) return "";
  if (result.error !== undefined) return `launchpad: not added (${result.error})\n`;
  if (!result.added) return `launchpad: ${result.app?.id ?? "the application"} already in ${result.file}\n`;
  return `launchpad: ${result.app?.id ?? ""} added to ${result.file}${result.created ? " (created)" : ""}\n`;
}

/** `rapt launchpad add <src>`: the application of <src> in the launchpad of the workspace (D69). */
function launchpadAddCommand(source: string | undefined, values: Record<string, unknown>, json: boolean): number {
  if (source === undefined) {
    process.stderr.write(`rapt launchpad add needs the folder of the project, e.g. rapt launchpad add .\n`);
    return 2;
  }
  const result = registerApp(source, {
    ...(typeof values["launchpad"] === "string" ? { launchpad: values["launchpad"] } : {}),
    ...(typeof values["service"] === "string" ? { service: values["service"] } : {}),
  });
  if (json) {
    process.stdout.write(`${JSON.stringify({ command: "launchpad add", ok: result.error === undefined, root: path.resolve(source), ...result })}\n`);
  } else if (result.error !== undefined) {
    process.stderr.write(`${result.error}\n`);
  } else {
    process.stdout.write(launchpadLine(result));
  }
  return result.error === undefined ? 0 : 1;
}

/** `rapt launchpad <launchpad.json> --out <dir>`: the launchpad and the applications of its sources (D37, D69). */
async function launchpadCommand(file: string, values: Record<string, unknown>, json: boolean): Promise<number> {
  const out = values["out"];
  if (typeof out !== "string") {
    process.stderr.write(`rapt launchpad needs --out <dir>\n\n${USAGE}`);
    return 2;
  }
  const runtimeDir = values["runtime"];
  const result = await buildLaunchpad(file, { outDir: out, ...(typeof runtimeDir === "string" ? { runtimeDir } : {}) });
  const failed = result.files.length === 0 || (values["warnings-as-errors"] === true && result.diagnostics.items.some((d) => d.severity === "warning"));
  if (!failed) {
    writeFiles(out, result.files);
  }
  if (json) {
    const diagnostics = result.diagnostics.sorted().map((d) => (d.file === undefined ? d : { ...d, path: path.resolve(path.dirname(path.resolve(file)), d.file) }));
    const apps = result.apps.map((a) => ({ id: a.id, source: a.source, out: a.out }));
    process.stdout.write(`${JSON.stringify({ command: "launchpad", ok: !failed, root: path.dirname(path.resolve(file)), file: path.resolve(file), ...(failed ? {} : { out: path.resolve(out), files: result.files.length }), apps, counts: countDiagnostics(diagnostics), diagnostics })}\n`);
    return failed ? 1 : 0;
  }
  report(result.diagnostics);
  if (failed) {
    return 1;
  }
  for (const app of result.apps) {
    process.stdout.write(`${app.id}: built from ${app.source} into ${app.out}\n`);
  }
  process.stdout.write(`${result.files.length} files written to ${path.resolve(out)}\n`);
  return 0;
}

/** `rapt check --json`, `rapt build --json`: diagnostics with absolute paths, for tools. */
function writeJson(command: string, root: string, diagnostics: Diagnostics, ok: boolean, extra: Record<string, unknown> = {}): void {
  const sorted = diagnostics.sorted().map((d) => (d.file === undefined ? d : { ...d, path: path.join(root, ...d.file.split("/")) }));
  process.stdout.write(`${JSON.stringify({ command, ok, root, ...extra, counts: countDiagnostics(sorted), diagnostics: sorted })}\n`);
}

/** rapt dev: runs until SIGINT or SIGTERM. */
async function dev(source: string, generate: GenerateOptions, out: unknown, port: unknown, json: boolean, host: unknown): Promise<number> {
  const options: DevOptions = { ...generate };
  if (typeof host === "string") options.host = host;
  if (json) options.events = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  if (typeof out === "string") options.outDir = out;
  if (typeof port === "string") {
    const value = Number(port);
    if (!Number.isInteger(value) || value <= 0 || value > 65535) {
      process.stderr.write(`invalid --port ${port}\n`);
      return 2;
    }
    options.port = value;
  }
  const session = new DevSession(source, options);
  const stopped = new Promise<void>((resolve) => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => void session.close().then(resolve));
    }
  });
  await session.watch();
  await stopped;
  return 0;
}

/**
 * Whether `script` (process.argv[1]) is the module at `moduleUrl`: compares the real paths, so
 * that relative paths, symbolic links (npm bin) and Windows paths (backslashes, drive letter case,
 * 8.3 short names) are recognized.
 */
export function isEntryPoint(moduleUrl: string, script: string | undefined, realpath: (p: string) => string = realpathSync.native): boolean {
  if (script === undefined) {
    return false;
  }
  try {
    const self = realpath(fileURLToPath(moduleUrl));
    const invoked = realpath(path.resolve(script));
    return process.platform === "win32" ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
  } catch {
    return false;
  }
}

// not when imported (the rapt of the npm package rap-transpiler imports main, D65)
if (isEntryPoint(import.meta.url, process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
