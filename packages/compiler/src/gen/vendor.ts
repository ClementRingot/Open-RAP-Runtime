/**
 * The packages of this repository embedded in a generated folder (`vendor/`, decision D15): the
 * application or the launchpad installs them without a private registry.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shortHash } from "@open-rap-runtime/model";

export interface PackageJson {
  name: string;
  version: string;
  license?: string;
  type?: string;
  main?: string;
  types?: string;
  exports?: unknown;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** The folder of a package of this repository: installed next to the compiler, or in the monorepo. */
export function packageDir(name: string, folder: string, given?: string): string | undefined {
  const candidates: string[] = [];
  if (given !== undefined) {
    candidates.push(path.resolve(given));
  }
  try {
    let dir = path.dirname(createRequire(import.meta.url).resolve(name));
    while (!existsSync(path.join(dir, "package.json")) && path.dirname(dir) !== dir) {
      dir = path.dirname(dir);
    }
    candidates.push(dir);
  } catch {
    // not installed: the monorepo layout
  }
  candidates.push(fileURLToPath(new URL(`../../../${folder}/`, import.meta.url)));
  return candidates.find((dir) => existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "dist")));
}

function filesBelow(root: string, dir = root): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      result.push(...filesBelow(root, full));
    } else if (!entry.endsWith(".tsbuildinfo")) {
      result.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
  return result;
}

/** A package of the repository, as files of `vendor/<folder>/`: its dist and a production package.json. */
export function vendorPackage(dir: string, folder: string, rename: Record<string, string>): Array<{ path: string; content: string }> {
  const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as PackageJson;
  const dependencies: Record<string, string> = {};
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    dependencies[name] = rename[name] ?? version;
  }
  const dist = filesBelow(path.join(dir, "dist")).map((file) => ({ path: `vendor/${folder}/dist/${file}`, content: readFileSync(path.join(dir, "dist", file), "utf8") }));
  // a version that changes with the content: npm install updates the copy after a new rapt build
  const version = `${manifest.version}-rapt.${shortHash(dist.map((f) => `${f.path}\n${f.content}`).join("\n"))}`;
  const vendored: PackageJson = { name: manifest.name, version, license: manifest.license ?? "MIT", type: manifest.type ?? "module", dependencies };
  if (manifest.main !== undefined) vendored.main = manifest.main;
  if (manifest.types !== undefined) vendored.types = manifest.types;
  if (manifest.exports !== undefined) vendored.exports = manifest.exports;
  if (manifest.engines !== undefined) vendored.engines = manifest.engines;
  const files = [{ path: `vendor/${folder}/package.json`, content: `${JSON.stringify(vendored, null, 2)}\n` }, ...dist];
  const license = [path.join(dir, "LICENSE"), path.join(dir, "..", "..", "LICENSE")].find((f) => existsSync(f));
  if (license !== undefined) {
    files.push({ path: `vendor/${folder}/LICENSE`, content: readFileSync(license, "utf8") });
  }
  return files;
}
