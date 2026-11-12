// Builds the website of the project (D62, D63) into a folder (default: _site): the static pages of
// site/, the screenshots of docs/images, and the documentation rendered from the Markdown of the
// repository (docs/<page>.html), with the renderer of the compiler. Run after `pnpm build`.
// The workflow site.yml adds the .vsix of the VS Code extension; its version (environment variable
// VSIX_VERSION, default: the version of packages/vscode) replaces %VSIX_VERSION% in the pages.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] ?? path.join(repo, "_site"));
const { generateSiteDocs } = await import(path.join(repo, "packages", "compiler", "dist", "gen", "docs", "site.js"));

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "images"), { recursive: true });
cpSync(path.join(repo, "site"), out, { recursive: true });
const version = process.env.VSIX_VERSION || JSON.parse(readFileSync(path.join(repo, "packages", "vscode", "package.json"), "utf8")).version;
for (const file of readdirSync(out).filter((f) => f.endsWith(".html"))) {
  const page = path.join(out, file);
  writeFileSync(page, readFileSync(page, "utf8").replaceAll("%VSIX_VERSION%", version));
}
for (const file of readdirSync(path.join(repo, "docs", "images"))) {
  cpSync(path.join(repo, "docs", "images", file), path.join(out, "images", file));
}
const pages = generateSiteDocs(path.join(repo, "docs"));
for (const page of pages) {
  mkdirSync(path.dirname(path.join(out, page.path)), { recursive: true });
  writeFileSync(path.join(out, page.path), page.content);
}
console.log(`${out}: ${pages.length} documentation pages`);
