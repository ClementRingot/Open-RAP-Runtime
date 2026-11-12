#!/usr/bin/env node
/** rapt: command line of the RAP → Node.js compiler. */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { generateAbapGitFiles, type AbapGitResult } from "./authoring/abapgit.js";
import { generateObject, OBJECT_KINDS } from "./authoring/generate.js";
import { writeMcpFile } from "./authoring/mcp.js";
import { newBusinessObject } from "./authoring/new.js";
import { generateApplication, writeFiles, type GenerateOptions } from "./build.js";
import { parseArgs } from "node:util";
import { DevSession, type DevOptions } from "./dev.js";
import { countDiagnostics, formatDiagnostic, type Diagnostics } from "./diagnostics.js";
import { generateLaunchpad } from "./gen/launchpad/index.js";
import { loadProject } from "./input/project.js";
import { buildModel, type BuildOptions } from "./ir/builder.js";
import { COMPILER_VERSION } from "./version.js";

const USAGE = `rapt ${COMPILER_VERSION}: compiles RAP sources (abapGit format) into a Node.js OData V4 application

Usage:
  rapt check <src> [--service <SRVD>]           report the diagnostics of the sources
  rapt ir    <src> [--service <SRVD>] [--out f] print (or write) the intermediate representation
  rapt build <src> --out <dir> [--service <SRVD>] generate the application into <dir>
  rapt launchpad <launchpad.json> --out <dir>    generate the launchpad of applications into <dir>
  rapt dev   <src> [--port <n>] [--out <dir>]    build, run with an embedded database, rebuild on change
  rapt new   <src> <Entity> [--prefix Z…]        write the sources of a new business object (and their XML)
  rapt abapgit <src> [--check]                   write the abapGit XML files the sources lack
  rapt mcp   <src>                               write rapt/mcp.json: the MCP tools of the service, to describe;
                                                 the application then serves them at /mcp
  rapt generate <src> <kind> <name> [--from X]   write one new object (table, view, projection, behavior,
                                                 pool, metadata, access, service, binding…; no kind: the list)

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
  --json             machine-readable output (rapt check, rapt build: one JSON object;
                     rapt dev: one JSON event per line)
  --prefix <Z…>      prefix of the object names (rapt new, default Z): ZRT → zrt_travel, ZRT_R_Travel…
  --description <t>  description of the business object (rapt new)
  --from <name>      rapt generate: the object the new one derives from (view ← table, projection ← view,
                     behavior/metadata/access ← entity)
  --for <name>       rapt generate: the BDEF of a pool, the service definition of a binding
  --expose <A,B>     rapt generate service: the exposed entities
  --root             rapt generate view: a root view entity
  --check            report the missing XML files without writing them, exit code 1 if any (rapt abapgit)
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
  if (command === "generate") {
    return generateCommand(source, parsed.positionals[2], parsed.positionals[3], parsed.values, parsed.values["json"] === true);
  }
  if (command === "abapgit") {
    return abapGitCommand(source, parsed.values["check"] === true, parsed.values["json"] === true);
  }
  if (command === "launchpad") {
    const out = parsed.values["out"];
    if (typeof out !== "string") {
      process.stderr.write(`rapt launchpad needs --out <dir>\n\n${USAGE}`);
      return 2;
    }
    const runtimeDir = parsed.values["runtime"];
    const result = generateLaunchpad(source, { outDir: out, ...(typeof runtimeDir === "string" ? { runtimeDir } : {}) });
    report(result.diagnostics);
    if (result.files.length === 0 || (parsed.values["warnings-as-errors"] === true && result.diagnostics.items.some((d) => d.severity === "warning"))) {
      return 1;
    }
    writeFiles(out, result.files);
    process.stdout.write(`${result.files.length} files written to ${path.resolve(out)}\n`);
    return 0;
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

function generateCommand(source: string, kind: string | undefined, name: string | undefined, values: Record<string, unknown>, json: boolean): number {
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
    process.stdout.write(`${JSON.stringify({ command: "new", ok: result.error === undefined, root: path.resolve(source), ...result })}\n`);
    return result.error === undefined ? 0 : 1;
  }
  if (result.error !== undefined) {
    process.stderr.write(`${result.error}\n`);
    return 1;
  }
  for (const file of result.written) {
    process.stdout.write(`written: ${file}\n`);
  }
  process.stdout.write(`next: rapt dev ${source}\n`);
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

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly || process.argv[1]?.endsWith("/rapt")) {
  process.exitCode = await main(process.argv.slice(2));
}
