#!/usr/bin/env node
// rapt, installed from npm (npm install -g rap-transpiler, or npx rap-transpiler): the CLI of
// @rap-transpiler/compiler, with the runtime and what rapt dev serves (OpenUI5, PGlite) (D65).
import { main } from "@rap-transpiler/compiler/cli";

process.exitCode = await main(process.argv.slice(2));
