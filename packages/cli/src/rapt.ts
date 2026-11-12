#!/usr/bin/env node
/**
 * rapt of the rap-transpiler npm package (decision D65): the command line of
 * @rap-transpiler/compiler, installed next to @rap-transpiler/runtime and what rapt dev serves
 * (OpenUI5, PGlite, less-openui5), so that `npm install -g rap-transpiler` gives a complete rapt.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The compiler's cli.js runs itself only when it is the invoked script (process.argv[1]): argv[1]
// is set to this file, so that only the call below runs the command.
process.argv[1] = realpathSync(fileURLToPath(import.meta.url));
const { main } = await import("@rap-transpiler/compiler/cli");
process.exitCode = await main(process.argv.slice(2));
