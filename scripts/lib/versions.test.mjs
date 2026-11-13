// The versions of Open RAP Runtime (D77): what carries the version, what ships, changesets and
// release notes.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mergedReleaseNotes, MIRRORS, PACKAGES, parseChangeset, releaseNotes, shippedChanges, versions } from "./versions.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("the versions of Open RAP Runtime (D77)", () => {
  it("are the same in every file that carries one", () => {
    const all = versions(ROOT);
    expect(all.map((v) => v.file)).toEqual([...PACKAGES.map((p) => `packages/${p}/package.json`), ...MIRRORS.map((m) => m.file)]);
    expect(new Set(all.map((v) => v.version)).size).toBe(1);
    expect(execFileSync("node", ["scripts/check-version-sync.mjs"], { cwd: ROOT, encoding: "utf8" })).toContain(`✓ version ${all[0].version} in 7 files`);
  });

  it("copies the version into the mirrors, and reports a drift or a wrong tag", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rapt-versions-"));
    try {
      for (const f of ["scripts", ...PACKAGES.map((p) => `packages/${p}/package.json`), ...MIRRORS.map((m) => m.file)]) {
        cpSync(path.join(ROOT, f), path.join(dir, f), { recursive: true });
      }
      const node = (...args) => execFileSync("node", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      // changeset version bumped the packages only
      for (const p of PACKAGES) {
        const file = path.join(dir, "packages", p, "package.json");
        writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), version: "9.8.7" }, null, 2));
      }
      expect(() => node("scripts/check-version-sync.mjs")).toThrow(/differs between these files/);
      expect(node("scripts/sync-versions.mjs")).toContain("packages/runtime/src/index.ts");
      expect(readFileSync(path.join(dir, "packages/runtime/src/index.ts"), "utf8")).toContain('RUNTIME_VERSION = "9.8.7"');
      expect(node("scripts/check-version-sync.mjs", "--tag", "v9.8.7")).toContain("✓ v9.8.7 is the version of the commit");
      expect(() => node("scripts/check-version-sync.mjs", "--tag", "v9.8.8")).toThrow(/is not the version of the commit/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("knows what ships", () => {
    const json = { "packages/cli/package.json": [{ version: "1.0.0", dependencies: { a: "1" } }, { version: "1.0.0", dependencies: { a: "2" } }], "packages/model/package.json": [{ version: "1.0.0", devDependencies: { b: "1" } }, { version: "1.0.0", devDependencies: { b: "2" } }] };
    expect(
      shippedChanges(
        ["packages/compiler/src/cli.ts", "packages/compiler/test/cli.test.ts", "packages/runtime/src/x.test.ts", "packages/vscode/syntaxes/cds.json", "docs/GUIDE.md", "packages/cli/package.json", "packages/model/package.json", "README.md", ".github/workflows/ci.yml", "site/index.html"],
        (file) => json[file] ?? [null, null],
      ),
    ).toEqual(["source   packages/compiler/src/cli.ts", "vscode   packages/vscode/syntaxes/cds.json", "docs     docs/GUIDE.md", "package  packages/cli/package.json (dependencies)"]);
  });

  it("reads changesets and the notes of a version", () => {
    expect(parseChangeset('---\n"open-rap-runtime": minor\n"@open-rap/compiler": minor\n---\n\nrapt launchpad dev\n')).toEqual({ packages: ["open-rap-runtime", "@open-rap/compiler"], empty: false });
    expect(parseChangeset("---\n---\n")).toEqual({ packages: [], empty: true });
    const changelog = "# open-rap-runtime\n\n## 0.3.0\n\n### Minor Changes\n\n- abc: A Web API\n\n## 0.2.0\n\n- older\n";
    expect(releaseNotes(changelog, "0.3.0")).toBe("### Minor Changes\n\n- abc: A Web API");
    expect(releaseNotes(changelog, "0.2.0")).toBe("- older");
    expect(releaseNotes(changelog, "0.1.0")).toBeUndefined();

    // one changeset for the compiler, one for every package: each line once, no dependency updates
    const cli = "# open-rap-runtime\n\n## 0.3.0\n\n### Minor Changes\n\n- a1b2c3d: Web APIs\n\n### Patch Changes\n\n- Updated dependencies\n  - @open-rap/compiler@0.3.0\n";
    const compiler = "# @open-rap/compiler\n\n## 0.3.0\n\n### Minor Changes\n\n- a1b2c3d: Web APIs\n- d4e5f6a: rapt launchpad dev\n\n  with every application of the workspace\n\n### Patch Changes\n\n- 0f0f0f0: A fix\n";
    expect(mergedReleaseNotes([cli, compiler, "# @open-rap/model\n"], "0.3.0")).toBe(
      "### Minor Changes\n\n- a1b2c3d: Web APIs\n- d4e5f6a: rapt launchpad dev\n\n  with every application of the workspace\n\n### Patch Changes\n\n- 0f0f0f0: A fix",
    );
    expect(mergedReleaseNotes([cli], "0.4.0")).toBeUndefined();
    // a changeset not committed yet: the dependency updates are bare lines
    expect(mergedReleaseNotes(["# @open-rap/compiler\n\n## 0.3.0\n\n### Minor Changes\n\n- A test change\n\n### Patch Changes\n\n- @open-rap/model@0.3.0\n"], "0.3.0")).toBe("### Minor Changes\n\n- A test change");
  });
});
