#!/usr/bin/env node
// After `changeset version` (the `changeset:version` script, D77): copies the version of the
// packages into the files that carry it without being a package.json (RUNTIME_VERSION, the
// generator of the reference snapshot). The version is the one of packages/cli/package.json;
// the five packages share it (fixed group of .changeset/config.json).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MIRRORS } from "./lib/versions.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(path.join(root, "packages/cli/package.json"), "utf8")).version;

for (const mirror of MIRRORS) {
  const file = path.join(root, mirror.file);
  const src = readFileSync(file, "utf8");
  const before = mirror.read(src);
  if (before === undefined) throw new Error(`no version found in ${mirror.file}`);
  if (before !== version) {
    writeFileSync(file, mirror.write(src, version));
    console.log(`  ${mirror.file}: ${before} → ${version}`);
  }
}
console.log(`✓ version ${version} copied`);
