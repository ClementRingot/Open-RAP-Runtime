/**
 * The documentation pages of the website (D63): the same Markdown documents as the documentation
 * app of `rapt dev` (D49), rendered as static pages `docs/<page>.html` next to the home page of
 * the website. Links between documents point to the rendered pages; links to files of the
 * repository that the website does not publish (sources, fixtures, license) become plain text,
 * so that the website never sends a visitor to the repository.
 */

import { type DocPage, documentationDir, documentationPages } from "./index.js";
import { pageId, type RenderOptions } from "./markdown.js";

const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The file of a page on the website: the README is the overview (`index.html`). */
export function sitePageFile(id: string): string {
  return id === "readme" ? "index.html" : `${id}.html`;
}

/** The links and images of the Markdown, for the pages of the website. */
export function siteRenderOptions(ids: ReadonlySet<string>): RenderOptions {
  return {
    link: (href) => {
      if (/^[a-z]+:/i.test(href)) {
        return { href, external: true };
      }
      if (href.startsWith("#")) {
        return { href: `#anchor-${href.slice(1)}`, external: false };
      }
      const match = /^((?:[\w.-]*\/)*)([\w-]+)\.md(?:#(.*))?$/i.exec(href);
      if (match === null || /(^|\/)(fixtures|packages|site)\//.test(match[1] ?? "")) {
        return null;
      }
      const id = pageId(match[2] ?? "");
      if (!ids.has(id)) {
        return null;
      }
      return { href: `${sitePageFile(id)}${match[3] === undefined ? "" : `#anchor-${match[3]}`}`, external: false };
    },
    image: (src) => {
      const match = /(?:^|\/)images\/([\w.-]+\.(?:png|jpe?g|svg|gif|webp))$/i.exec(src);
      return match === null ? undefined : `../images/${match[1]}`;
    },
  };
}

const ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230a6ed1'/%3E%3Cpath d='M9 22V10h7a4 4 0 0 1 0 8h-7m7 0 5 4' stroke='white' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

function title(page: DocPage): string {
  return page.id === "readme" ? "Overview" : page.title;
}

function pageList(pages: DocPage[], current: DocPage): string {
  return pages
    .map((p) => {
      const active = p.id === current.id;
      const toc = active && p.headings.some((h) => h.level === 2) ? `<ul>${p.headings.filter((h) => h.level === 2).map((h) => `<li><a href="#${escape(h.id)}">${escape(h.title.replace(/\*\*/g, ""))}</a></li>`).join("")}</ul>` : "";
      return `<li${active ? ' class="current"' : ""}><a href="${sitePageFile(p.id)}"${active ? ' aria-current="page"' : ""}>${escape(title(p))}</a>${toc}</li>`;
    })
    .join("");
}

function pageHtml(pages: DocPage[], page: DocPage): string {
  const list = pageList(pages, page);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title(page))} — Open RAP Runtime documentation</title>
  <meta name="description" content="Open RAP Runtime documentation: ${escape(title(page))}.">
  <link rel="icon" href="${ICON}">
  <link rel="stylesheet" href="../style.css">
</head>
<body class="docs-page">
  <header class="top">
    <div class="wrap nav">
      <a class="brand" href="../index.html"><span class="logo" aria-hidden="true">R</span>Open RAP Runtime</a>
      <nav aria-label="Main">
        <a href="../index.html#features">Features</a>
        <a href="index.html">Documentation</a>
        <a class="button small" href="../index.html#download">Download</a>
      </nav>
    </div>
  </header>
  <div class="wrap doc-layout">
    <aside class="doc-side" aria-label="Documentation pages">
      <details class="doc-menu">
        <summary>Documentation pages</summary>
        <ul>${list}</ul>
      </details>
      <ul class="doc-list">${list}</ul>
    </aside>
    <main class="doc" id="content">
${page.html}
    </main>
  </div>
  <footer>
    <div class="wrap foot">
      <span>Open RAP Runtime · MIT · not affiliated with SAP SE. SAP, ABAP, Fiori and SAP BTP are trademarks of SAP SE.</span>
      <a href="../index.html">Home</a>
    </div>
  </footer>
</body>
</html>
`;
}

/** The pages of the documentation for the website: `docs/index.html` (overview), `docs/<page>.html`. */
export function generateSiteDocs(dir = documentationDir()): Array<{ path: string; content: string }> {
  const ids = new Set(documentationPages(dir).map((p) => p.id));
  const pages = documentationPages(dir, siteRenderOptions(ids));
  return pages.map((page) => ({ path: `docs/${sitePageFile(page.id)}`, content: pageHtml(pages, page) }));
}
