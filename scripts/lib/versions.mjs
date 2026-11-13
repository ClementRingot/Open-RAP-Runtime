// The versions of Open RAP Runtime (decision D77): what carries the version, what ships, and the
// pieces of a changeset or a changelog the release scripts read. Pure functions over file
// contents and git paths, tested by scripts/lib/versions.test.mjs.
//
// The five packages share ONE version (a "fixed" group in .changeset/config.json): the tag vX.Y.Z,
// the npm packages and the VS Code extension are released together.

import { readFileSync } from "node:fs";
import path from "node:path";

/** The packages of the release, by folder: their package.json carries the version. */
export const PACKAGES = ["model", "compiler", "runtime", "cli", "vscode"];

/**
 * Files that are not package.json but carry the same version: `changeset version` does not know
 * them, scripts/sync-versions.mjs copies the version into them.
 */
export const MIRRORS = [
  {
    // the version the generated applications report (runtime of Open RAP Runtime)
    file: "packages/runtime/src/index.ts",
    read: (src) => /\bRUNTIME_VERSION = "([^"]+)"/.exec(src)?.[1],
    write: (src, version) => src.replace(/(\bRUNTIME_VERSION = ")[^"]+(")/, `$1${version}$2`),
  },
  {
    // the generator of the reference model (snapshot of fixtures/travel)
    file: "packages/compiler/test/__snapshots__/travel.model.json",
    read: (src) => /"generator":\s*\{\s*"name":\s*"open-rap-runtime",\s*"version":\s*"([^"]+)"/.exec(src)?.[1],
    write: (src, version) => src.replace(/("generator":\s*\{\s*"name":\s*"open-rap-runtime",\s*"version":\s*")[^"]+(")/, `$1${version}$2`),
  },
];

/** Every file that carries the version, with its version (undefined when it cannot be read). */
export function versions(root) {
  const read = (rel) => readFileSync(path.join(root, rel), "utf8");
  return [
    ...PACKAGES.map((p) => {
      const file = `packages/${p}/package.json`;
      return { file, version: JSON.parse(read(file)).version };
    }),
    ...MIRRORS.map((m) => ({ file: m.file, version: m.read(read(m.file)) })),
  ];
}

/** The fields of a published package.json that change what is installed or what the extension does. */
const SHIPPED_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies", "bin", "exports", "main", "engines", "contributes", "activationEvents"];

/**
 * The changes of a pull request that are released, so that need a changeset: the sources of a
 * package (not its tests), the grammars and the build scripts of the extension, the
 * documentation (copied into the compiler: rapt dev, rapt agent), and the shipped fields of a
 * package.json. `jsonAt(file)` gives [before, after] of a package.json.
 */
export function shippedChanges(paths, jsonAt = () => [null, null]) {
  const found = [];
  for (const file of paths) {
    if (/^packages\/[^/]+\/src\//.test(file) && !/\.test\.[cm]?[jt]s$/.test(file)) {
      found.push(`source   ${file}`);
    } else if (/^packages\/vscode\/(syntaxes|scripts)\//.test(file)) {
      found.push(`vscode   ${file}`);
    } else if (/^docs\/.+\.md$/.test(file)) {
      found.push(`docs     ${file}`);
    } else if (/^packages\/[^/]+\/package\.json$/.test(file)) {
      const [before, after] = jsonAt(file);
      for (const field of SHIPPED_FIELDS) {
        if (JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field])) {
          found.push(`package  ${file} (${field})`);
        }
      }
    }
  }
  return found;
}

/** The packages a changeset bumps, from its front matter; an empty changeset bumps none. */
export function parseChangeset(src) {
  const front = /^---\r?\n([\s\S]*?)\r?\n?---/.exec(src);
  const body = front?.[1]?.trim() ?? "";
  const packages = body
    .split("\n")
    .map((line) => /^\s*['"]?([^'":]+)['"]?\s*:/.exec(line)?.[1]?.trim())
    .filter((name) => name !== undefined);
  return { packages, empty: packages.length === 0 };
}

/** The section of a version in a changelog written by Changesets (`## 1.2.3`), without its title. */
export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start === -1) return undefined;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  const notes = lines.slice(start + 1, end === -1 ? undefined : end).join("\n").trim();
  return notes === "" ? undefined : notes;
}

/**
 * The notes of a release: the sections of the version in the changelogs of the packages, merged
 * by kind (### Major / Minor / Patch Changes), each entry once, without the "Updated dependencies"
 * entries the fixed group adds to every package. A changeset names one package or several; its
 * line is in the changelog of each one it names.
 */
export function mergedReleaseNotes(changelogs, version) {
  const kinds = new Map();
  for (const changelog of changelogs) {
    const section = releaseNotes(changelog, version);
    if (section === undefined) continue;
    let kind = "";
    let entry;
    const close = () => {
      if (entry === undefined) return;
      const text = entry.join("\n").trimEnd();
      // "Updated dependencies", or a bare "- @open-rap/model@1.2.3": the fixed group, not a change
      if (!/^- (Updated dependencies|(@open-rap\/[\w-]+|open-rap-runtime(-vscode)?)@\d)/.test(text)) {
        if (!kinds.has(kind)) kinds.set(kind, []);
        if (!kinds.get(kind).includes(text)) kinds.get(kind).push(text);
      }
      entry = undefined;
    };
    for (const line of section.split("\n")) {
      if (/^### /.test(line)) {
        close();
        kind = line.trim();
      } else if (/^- /.test(line)) {
        close();
        entry = [line];
      } else if (entry !== undefined && (line.startsWith(" ") || line.trim() === "")) {
        entry.push(line);
      }
    }
    close();
  }
  const order = ["### Major Changes", "### Minor Changes", "### Patch Changes"];
  const sorted = [...kinds.keys()].sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9));
  const text = sorted.map((k) => (k === "" ? "" : `${k}\n\n`) + kinds.get(k).join("\n")).join("\n\n").trim();
  return text === "" ? undefined : text;
}

/** A semantic version without prefix: 1.2.3 (or 1.2.3-next.1). */
export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
