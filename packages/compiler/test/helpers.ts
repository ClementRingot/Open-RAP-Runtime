import { mkdtempSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_DIR = fileURLToPath(new URL("../../../fixtures/travel", import.meta.url));

export function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, "src", name), "utf8");
}

/**
 * A copy of the Travel fixture in a temporary folder, with some files changed:
 * `changes` maps a file name of `src/` to its new content (or null to delete it).
 */
export function fixtureVariant(changes: Record<string, string | null | ((content: string) => string)>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "rapt-fixture-"));
  mkdirSync(path.join(dir, "src"));
  copyFileSync(path.join(FIXTURE_DIR, ".abapgit.xml"), path.join(dir, ".abapgit.xml"));
  for (const file of readdirSync(path.join(FIXTURE_DIR, "src"))) {
    copyFileSync(path.join(FIXTURE_DIR, "src", file), path.join(dir, "src", file));
  }
  for (const [file, change] of Object.entries(changes)) {
    const target = path.join(dir, "src", file);
    if (change === null) {
      rmSync(target);
    } else if (typeof change === "function") {
      writeFileSync(target, change(readFileSync(target, "utf8")));
    } else {
      writeFileSync(target, change);
    }
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
