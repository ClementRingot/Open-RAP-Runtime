#!/usr/bin/env node
// Fails when the files that carry the version of Open RAP Runtime disagree (D77): the package.json
// of the five packages, RUNTIME_VERSION and the generator of the reference snapshot. With
// `--tag vX.Y.Z` (the Release workflow), also when the tag is not that version.
//
//   node scripts/check-version-sync.mjs [--tag v1.2.3]
//
// CI runs it on every push and pull request; scripts/sync-versions.mjs repairs a drift.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { versions } from "./lib/versions.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const all = versions(root);
const distinct = [...new Set(all.map((v) => v.version))];

if (distinct.length !== 1 || distinct[0] === undefined) {
  console.error("✗ the version of Open RAP Runtime differs between these files:");
  for (const { file, version } of all) console.error(`    ${String(version).padEnd(12)} ${file}`);
  console.error("  fix: node scripts/sync-versions.mjs (copies the version of packages/cli/package.json)");
  process.exit(1);
}
const version = distinct[0];

const tagIndex = process.argv.indexOf("--tag");
if (tagIndex !== -1) {
  const tag = process.argv[tagIndex + 1] ?? "";
  if (tag !== `v${version}`) {
    console.error(`✗ the tag ${tag || "(none)"} is not the version of the commit, v${version}: release the committed version (Changesets, D77)`);
    process.exit(1);
  }
  console.log(`✓ ${tag} is the version of the commit`);
}
console.log(`✓ version ${version} in ${all.length} files`);
