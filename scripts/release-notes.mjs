#!/usr/bin/env node
// The notes of the GitHub release of a version (D77): its sections of the changelogs of the
// packages (CHANGELOG.md, written by Changesets), merged. Prints nothing when there is none: the
// Release workflow then lets GitHub generate the notes.
//
//   node scripts/release-notes.mjs 1.2.3

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergedReleaseNotes, PACKAGES } from "./lib/versions.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = (process.argv[2] ?? "").replace(/^v/, "");
const changelogs = PACKAGES.map((p) => path.join(root, "packages", p, "CHANGELOG.md"))
  .filter((file) => existsSync(file))
  .map((file) => readFileSync(file, "utf8"));
const notes = mergedReleaseNotes(changelogs, version);
if (notes !== undefined) process.stdout.write(`${notes}\n`);
