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
        <a href="../feedback.html">Feedback</a>
        <a class="github" href="https://github.com/ClementRingot/Open-RAP-Runtime" aria-label="Open RAP Runtime on GitHub"><svg aria-hidden="true" viewBox="0 0 16 16" width="18" height="18"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg><span>GitHub</span></a>
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
      <span class="foot-links"><a href="../index.html">Home</a> · <a href="https://github.com/ClementRingot/Open-RAP-Runtime">GitHub</a> · <a href="../feedback.html">Report a bug or request a feature</a></span>
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
