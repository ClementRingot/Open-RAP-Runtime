#!/usr/bin/env node
/**
 * Prepares `rapt/` for the .vsix (decision D39): the compiler, the model and the runtime of this
 * repository, packed as npm packages, installed with their production dependencies and with what
 * `rapt dev` needs to serve an application (OpenUI5, PGlite, less-openui5). The extension runs
 * `rapt/node_modules/@open-rap/compiler/dist/cli.js` with the Node.js of VS Code.
 *
 * Needs the packages built (pnpm build) and access to the npm registry.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extension = path.resolve(here, "..");
const packages = path.resolve(extension, "..");
const stage = path.join(extension, "rapt");
const packs = path.join(extension, ".rapt-packs");
const windows = process.platform === "win32";

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: ["ignore", "inherit", "inherit"], shell: windows });
}

rmSync(stage, { recursive: true, force: true });
rmSync(packs, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(packs, { recursive: true });

// the packages of the repository, as published (workspace:* replaced by their versions)
const tarballs = {};
for (const folder of ["model", "compiler", "runtime"]) {
  const dir = path.join(packages, folder);
  const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  if (!statSync(path.join(dir, "dist"), { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`${manifest.name} is not built: run pnpm build`);
  }
  run("pnpm", ["pack", "--pack-destination", packs], dir);
  const tarball = readdirSync(packs).find((f) => f.startsWith(manifest.name.replace("@", "").replace("/", "-")) && f.endsWith(".tgz"));
  if (tarball === undefined) {
    throw new Error(`pnpm pack wrote no tarball for ${manifest.name}`);
  }
  tarballs[manifest.name] = `file:${path.join(packs, tarball)}`;
}

// what rapt dev serves: the versions of the runtime's development dependencies, as rapt build does
const runtime = JSON.parse(readFileSync(path.join(packages, "runtime", "package.json"), "utf8"));
const served = Object.fromEntries(
  Object.entries(runtime.devDependencies).filter(([name]) => name.startsWith("@openui5/") || name === "@electric-sql/pglite" || name === "less-openui5"),
);
writeFileSync(
  path.join(stage, "package.json"),
  `${JSON.stringify({ name: "rapt-bundled", private: true, description: "Open RAP Runtime embedded in the VS Code extension", dependencies: { ...tarballs, ...served } }, null, 2)}\n`,
);
run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--install-links", "--no-package-lock"], stage);

// files the CLI and the server never read: source maps, types, documentation, tests of the
// packages, OpenUI5 design time (UI adaptation), PGlite extensions (not loaded by the runtime).
// The documentation of Open RAP Runtime itself is kept: the documentation app of rapt dev and the
// MCP server of the extension read it (D49, D64).
const KEPT_FOLDER = new Set([path.join(stage, "node_modules", "@open-rap", "compiler", "docs")]);
let removed = 0;
const remove = (full) => {
  removed += statSync(full).isDirectory() ? readdirSync(full, { recursive: true }).length : 1;
  rmSync(full, { recursive: true, force: true });
};
const UNUSED_FILE = /(\.(map|ts|mts|cts|tsbuildinfo|md|markdown)|\.designtime\.js)$/;
const KEPT_FILE = /^(licen[cs]e|notice|thirdparty|copying)/i;
const UNUSED_PACKAGE_FOLDER = new Set(["test", "tests", "__tests__", "docs", "doc", "example", "examples", "benchmark", "benchmarks", ".github"]);
const prune = (dir) => {
  const isPackage = statSync(path.join(dir, "package.json"), { throwIfNoEntry: false }) !== undefined;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (KEPT_FOLDER.has(full)) {
      continue;
    }
    if (entry.isDirectory()) {
      if ((isPackage && UNUSED_PACKAGE_FOLDER.has(entry.name)) || entry.name === "designtime") {
        remove(full);
      } else {
        prune(full);
      }
    } else if (UNUSED_FILE.test(entry.name) && !KEPT_FILE.test(entry.name)) {
      remove(full);
    }
  }
};
prune(path.join(stage, "node_modules"));
remove(path.join(stage, "node_modules", "@electric-sql", "pglite", "dist", "contrib"));
rmSync(packs, { recursive: true, force: true });

const cli = path.join(stage, "node_modules", "@open-rap", "compiler", "dist", "cli.js");
statSync(cli);
// the documentation must be there: without it the documentation app of rapt dev is empty
for (const doc of ["README.md", "GUIDE.md", "DECISIONS.md"]) {
  statSync(path.join(stage, "node_modules", "@open-rap", "compiler", "docs", doc));
}
process.stdout.write(`rapt staged in ${stage} (${removed} files pruned)\n`);
