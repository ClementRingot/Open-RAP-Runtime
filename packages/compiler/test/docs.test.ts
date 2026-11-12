/** The documentation app of rapt dev (D49): Markdown rendered, pages found, launchpad of rapt dev. */

import { describe, expect, it } from "vitest";
import { devLaunchpadModel } from "../src/dev.js";
import { documentationPages, generateDocsApp } from "../src/gen/docs/index.js";
import { headingId, inline, renderMarkdown } from "../src/gen/docs/markdown.js";
import { generateSiteDocs, siteRenderOptions } from "../src/gen/docs/site.js";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";
import { FIXTURE_DIR } from "./helpers.js";

describe("Markdown of the documentation app", () => {
  it("renders the constructions of the documentation", () => {
    const html = renderMarkdown(`# Title

A paragraph with \`code <b>\`, **bold**, *italic* and a [link](docs/DIAGNOSTICS.md#codes).

- one
- two
  - two.one
1. first

| A | B |
|---|---:|
| \`x | y\` | 2 |

\`\`\`sh
rapt dev <src>
\`\`\`

> note
`);
    expect(html).toContain('<h1 id="anchor-title">Title</h1>');
    expect(html).toContain("<code>code &lt;b&gt;</code>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain('<a href="#/page/diagnostics/codes">link</a>');
    expect(html).toContain("<ul><li>one</li><li>two<ul><li>two.one</li></ul></li></ul>");
    expect(html).toContain("<ol><li>first</li></ol>");
    expect(html).toContain('<td style="text-align:right">2</td>');
    expect(html).toContain("<td><code>x | y</code></td>");
    expect(html).toContain('<pre><code class="language-sh">rapt dev &lt;src&gt;</code></pre>');
    expect(html).toContain("<blockquote><p>note</p></blockquote>");
    expect(inline("![screenshot](docs/images/x.png) text")).toBe(" text");
    expect(inline("[site](https://example.org)")).toBe('<a href="https://example.org" target="_blank" rel="noopener">site</a>');
    expect(headingId("D44 — SAP standard views (`I_Currency`)")).toBe("d44--sap-standard-views-i_currency");
  });

  it("finds the pages of the documentation, README first", () => {
    const pages = documentationPages();
    expect(pages[0]?.file).toBe("README.md");
    expect(pages.map((p) => p.id)).toEqual(expect.arrayContaining(["features", "diagnostics", "decisions"]));
    expect(generateDocsApp(pages).map((f) => f.path)).toContain("pages.json");
    // without documentation (a packaging problem), the app says so instead of being empty
    const empty = JSON.parse(generateDocsApp([]).find((f) => f.path === "pages.json")?.content ?? "[]") as Array<{ title: string }>;
    expect(empty.map((p) => p.title)).toEqual(["Documentation not found"]);
  });

  it("renders the pages of the website without links to the repository (D63)", () => {
    const options = siteRenderOptions(new Set(["readme", "guide", "known_gaps"]));
    expect(inline("[guide](docs/GUIDE.md#3-the-project)", options)).toBe('<a href="guide.html#anchor-3-the-project">guide</a>');
    expect(inline("[gaps](../KNOWN_GAPS.md) [home](README.md) [here](#modes)", options)).toBe('<a href="known_gaps.html">gaps</a> <a href="index.html">home</a> <a href="#anchor-modes">here</a>');
    expect(inline("[fixture](fixtures/travel/README.md), [LICENSE](LICENSE), [ext](../packages/vscode), [plan](PLAN.md)", options)).toBe("fixture, LICENSE, ext, plan");
    expect(inline("![List Report](docs/images/list-report.png)", options)).toBe('<img src="../images/list-report.png" alt="List Report" style="max-width:100%">');
    expect(inline("[site](https://example.org)", options)).toContain('href="https://example.org"');

    const files = generateSiteDocs();
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["docs/index.html", "docs/guide.html", "docs/decisions.html", "docs/known_gaps.html", "docs/deployment.html", "docs/plan.html"]));
    for (const file of files) {
      expect(file.content).not.toMatch(/github\.com\/ClementRingot\/(RAP-Transpiler|Open-Rap-Runtime)(?!-feedback)/i); // the private repository (the public feedback repository is fine)
      expect(file.content).toContain('<html lang="en">');
    }
    const guide = files.find((f) => f.path === "docs/guide.html")?.content ?? "";
    expect(guide).toContain('<li class="current"><a href="guide.html" aria-current="page">');
    expect(guide).toContain('href="diagnostics.html"');
    expect(files.find((f) => f.path === "docs/index.html")?.content).toContain('src="../images/list-report.png"');
  });

  it("puts the application and the tools on the launchpad of rapt dev", () => {
    const { model } = buildModel(loadProject(FIXTURE_DIR));
    const launchpad = devLaunchpadModel(model!, true);
    expect(launchpad.groups.flatMap((g) => g.tiles).map((t) => [t.id, t.target])).toEqual([
      ["app", "/ui/index.html"],
      ["docs", "/docs/index.html"],
      ["metadata", "/sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001/$metadata"],
      ["oauth", "/oauth/.well-known/openid-configuration"],
      ["mcp", "/docs/index.html#/page/mcp"],
    ]);
    expect(launchpad.groups[0]?.tiles[0]?.count).toBe("/sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001/Travel/$count");
  });
});
