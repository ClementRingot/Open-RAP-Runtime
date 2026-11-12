#!/usr/bin/env node
/**
 * rapt of the open-rap-runtime npm package (decision D65): the command line of
 * @open-rap/compiler, installed next to @open-rap/runtime and what rapt dev serves
 * (OpenUI5, PGlite, less-openui5), so that `npm install -g open-rap-runtime` gives a complete rapt.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The compiler's cli.js runs itself only when it is the invoked script (process.argv[1]): argv[1]
// is set to this file, so that only the call below runs the command.
process.argv[1] = realpathSync(fileURLToPath(import.meta.url));
const { main } = await import("@open-rap/compiler/cli");
process.exitCode = await main(process.argv.slice(2));
