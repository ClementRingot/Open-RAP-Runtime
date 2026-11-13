#!/usr/bin/env node
// The publish step of the Changesets workflow (D77): runs on a push to main without pending
// changesets, so right after the "Version packages" pull request is merged. When the committed
// version has no tag vX.Y.Z yet, it creates the tag on the commit of the push and runs the
// Release workflow on that tag, which publishes (GitHub release with the .vsix, Marketplace,
// Open VSX, npm).
//
// GH_TOKEN is the GITHUB_TOKEN of the workflow: a tag it creates does not start the tag trigger
// of release.yml (no second run), and the workflow_dispatch it sends does start release.yml.
//
// Idempotent: nothing when the tag exists, nor when a Release run of that version exists already
// (in progress, or failed: it is re-run from the Actions tab rather than started again on every
// push). Needs GITHUB_SHA, GITHUB_REPOSITORY and GH_TOKEN (contents and actions: write): meant
// to run in the workflow only.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEMVER } from "./lib/versions.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, ...args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8" }).trim();
const version = JSON.parse(readFileSync(path.join(root, "packages/cli/package.json"), "utf8")).version;
if (!SEMVER.test(version)) throw new Error(`not a version: ${version}`);
const tag = `v${version}`;

execFileSync("node", ["scripts/check-version-sync.mjs"], { cwd: root, stdio: "inherit" });

if (run("git", "ls-remote", "--tags", "origin", `refs/tags/${tag}`) !== "") {
  console.log(`✓ ${tag} is released already: nothing to do`);
  process.exit(0);
}
// the run-name of release.yml: "Release vX.Y.Z"
const runs = JSON.parse(run("gh", "run", "list", "--workflow", "release.yml", "--limit", "50", "--json", "displayTitle,status,conclusion,url"));
const existing = runs.find((r) => r.displayTitle === `Release ${tag}`);
if (existing !== undefined) {
  console.log(`• a Release run of ${tag} exists (${existing.status}${existing.conclusion ? `, ${existing.conclusion}` : ""}): ${existing.url}`);
  console.log("  not started again; re-run it from the Actions tab if it failed");
  process.exit(0);
}
const sha = process.env.GITHUB_SHA;
const repository = process.env.GITHUB_REPOSITORY;
if (!sha || !repository) throw new Error("GITHUB_SHA and GITHUB_REPOSITORY are needed: run it in the Changesets workflow");
// the tag on the commit of the version, not on whatever main is when the release starts
run("gh", "api", `repos/${repository}/git/refs`, "-f", `ref=refs/tags/${tag}`, "-f", `sha=${sha}`);
run("gh", "workflow", "run", "release.yml", "--ref", tag, "-f", `version=${version}`);
console.log(`✓ ${tag} tagged on ${sha.slice(0, 7)}, Release ${tag} started (workflow release.yml)`);
