#!/usr/bin/env node
/** rapt: command line of the RAP → Node.js compiler. */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { generateAbapGitFiles, type AbapGitResult } from "./authoring/abapgit.js";
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

Options:
  --service <name>   service definition to build (required when the sources have several)
  --binding <name>   service binding name (default: the SRVB of the service, else <SRVD>_O4)
  --path <path>      service root path (default: /sap/opu/odata4/sap/<binding>/srvd/sap/<srvd>/0001/)
  --runtime <dir>    @rap-transpiler/runtime package to embed in the application (default: next to rapt)
  --out <path>       output file (rapt ir) or folder (rapt build, rapt launchpad, rapt dev: <src>/.rapt/dev)
  --port <n>         port of the application (rapt dev, default: PORT, else 8080)
  --json             machine-readable output (rapt check, rapt build: one JSON object;
                     rapt dev: one JSON event per line)
  --prefix <Z…>      prefix of the object names (rapt new, default Z): ZRT → zrt_travel, ZRT_R_Travel…
  --description <t>  description of the business object (rapt new)
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
        binding: { type: "string" },
        path: { type: "string" },
        out: { type: "string" },
        runtime: { type: "string" },
        port: { type: "string" },
        json: { type: "boolean" },
        prefix: { type: "string" },
        description: { type: "string" },
        check: { type: "boolean" },
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
  if (typeof parsed.values["path"] === "string") options.path = parsed.values["path"];
  if (typeof parsed.values["runtime"] === "string") options.runtimeDir = parsed.values["runtime"];

  if (command === "dev") {
    return dev(source, options, parsed.values["out"], parsed.values["port"], parsed.values["json"] === true);
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
async function dev(source: string, generate: GenerateOptions, out: unknown, port: unknown, json: boolean): Promise<number> {
  const options: DevOptions = { ...generate };
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
