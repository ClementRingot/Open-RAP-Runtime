#!/usr/bin/env node
// CI guard (D77): a pull request that changes what Open RAP Runtime ships carries a changeset, so
// that no change is released without its version and its line in the changelog. What ships:
// scripts/lib/versions.mjs (shippedChanges).
//
//   node scripts/require-changeset.mjs [base ref, default origin/main]
//
// Exempt: the "Version packages" pull request (it consumes the changesets), and a pull request
// that bumps the version of the five packages itself. A change not to be released records it
// with an empty changeset: pnpm changeset add --empty.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseChangeset, shippedChanges } from "./lib/versions.mjs";

const baseRef = process.argv[2] || process.env.CHANGESET_BASE_REF || "origin/main";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

let base = baseRef;
try {
  base = git("merge-base", baseRef, "HEAD").trim();
} catch {
  // a shallow checkout: the base ref itself
}
const entries = git("diff", "--name-status", base, "HEAD")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const parts = line.split("\t");
    return { status: parts[0][0], path: parts[parts.length - 1] };
  });
const jsonAt = (file) => {
  let before = null;
  try {
    before = JSON.parse(git("show", `${base}:${file}`));
  } catch {
    // a new file
  }
  return [before, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null];
};

const found = shippedChanges(
  entries.map((e) => e.path),
  jsonAt,
);
if (found.length === 0) {
  console.log(`✓ nothing released changed against ${baseRef}: no changeset needed`);
  process.exit(0);
}

const isChangeset = (file) => file.startsWith(".changeset/") && file.endsWith(".md") && !file.endsWith("/README.md");
const added = entries.filter((e) => isChangeset(e.path) && e.status !== "D").map((e) => e.path);
const consumed = entries.filter((e) => isChangeset(e.path) && e.status === "D");
if (added.length === 0 && consumed.length > 0) {
  console.log(`✓ Version packages pull request: ${consumed.length} changeset(s) consumed`);
  process.exit(0);
}
const [cliBefore, cliAfter] = jsonAt("packages/cli/package.json");
if (added.length === 0 && cliBefore !== null && cliAfter !== null && cliBefore.version !== cliAfter.version) {
  console.log(`✓ the pull request releases a version itself: ${cliBefore.version} → ${cliAfter.version}`);
  process.exit(0);
}
if (added.length === 0) {
  console.error(`✗ released content changed against ${baseRef}, without a changeset:\n`);
  for (const f of found) console.error(`    ${f}`);
  console.error("\n  Add one: pnpm changeset   (the bump, and one line for the changelog)");
  console.error("  Not to be released (yet): pnpm changeset add --empty\n");
  process.exit(1);
}
const parsed = added.map((file) => parseChangeset(readFileSync(file, "utf8")));
const bumps = [...new Set(parsed.flatMap((c) => c.packages))];
console.log(
  bumps.length > 0 ? `✓ changeset: ${bumps.join(", ")} (the five packages share one version)` : "⚠ empty changeset: the change is deliberately not released",
);
