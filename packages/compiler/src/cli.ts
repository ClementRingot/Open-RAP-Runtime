#!/usr/bin/env node
/** rapt: command line of the RAP → Node.js compiler. */

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { formatDiagnostic, type Diagnostics } from "./diagnostics.js";
import { loadProject } from "./input/project.js";
import { buildModel, type BuildOptions } from "./ir/builder.js";
import { COMPILER_VERSION } from "./version.js";

const USAGE = `rapt ${COMPILER_VERSION}: compiles RAP sources (abapGit format) into a Node.js OData V4 application

Usage:
  rapt check <src> [--service <SRVD>]           report the diagnostics of the sources
  rapt ir    <src> [--service <SRVD>] [--out f] print (or write) the intermediate representation

Options:
  --service <name>   service definition to build (required when the sources have several)
  --binding <name>   service binding name (default: the SRVB of the service, else <SRVD>_O4)
  --path <path>      service root path (default: /sap/opu/odata4/sap/<binding>/srvd/sap/<srvd>/0001/)
  --out <file>       output file (rapt ir)
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

export function main(argv: string[]): number {
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
  const options: BuildOptions = {};
  if (typeof parsed.values["service"] === "string") options.service = parsed.values["service"];
  if (typeof parsed.values["binding"] === "string") options.binding = parsed.values["binding"];
  if (typeof parsed.values["path"] === "string") options.path = parsed.values["path"];

  const project = loadProject(source);
  const { model, diagnostics } = buildModel(project, options);
  const failed = diagnostics.hasErrors() || (parsed.values["warnings-as-errors"] === true && diagnostics.items.some((d) => d.severity === "warning"));

  switch (command) {
    case "check": {
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

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly || process.argv[1]?.endsWith("/rapt")) {
  process.exitCode = main(process.argv.slice(2));
}
