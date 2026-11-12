// Copies the documentation of the repository next to the compiled compiler (packages/compiler/docs):
// the documentation app of rapt dev reads it there, also once the compiler is packaged (D49).
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..", "..");
const target = path.join(here, "..", "docs");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const file of readdirSync(path.join(repo, "docs")).filter((f) => f.endsWith(".md"))) {
  copyFileSync(path.join(repo, "docs", file), path.join(target, file));
}
for (const file of ["README.md", "KNOWN_GAPS.md", "AGENTS.md", "PLAN.md"]) {
  if (existsSync(path.join(repo, file))) {
    copyFileSync(path.join(repo, file), path.join(target, file));
  }
}
