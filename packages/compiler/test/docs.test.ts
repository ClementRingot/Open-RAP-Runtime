/** The documentation app of rapt dev (D49): Markdown rendered, pages found, launchpad of rapt dev. */

import { describe, expect, it } from "vitest";
import { devLaunchpadModel } from "../src/dev.js";
import { documentationPages, generateDocsApp } from "../src/gen/docs/index.js";
import { headingId, inline, renderMarkdown } from "../src/gen/docs/markdown.js";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";
import { FIXTURE_DIR } from "./helpers.js";

describe("Markdown of the documentation app", () => {
  it("renders the constructions of the documentation", () => {
    const html = renderMarkdown(`# Titre

Un paragraphe avec \`code <b>\`, **gras**, *italique* et un [lien](docs/DIAGNOSTICS.md#codes).

- un
- deux
  - deux.un
1. premier

| A | B |
|---|---:|
| \`x | y\` | 2 |

\`\`\`sh
rapt dev <src>
\`\`\`

> note
`);
    expect(html).toContain('<h1 id="anchor-titre">Titre</h1>');
    expect(html).toContain("<code>code &lt;b&gt;</code>");
    expect(html).toContain("<strong>gras</strong>");
    expect(html).toContain("<em>italique</em>");
    expect(html).toContain('<a href="#/page/diagnostics/codes">lien</a>');
    expect(html).toContain("<ul><li>un</li><li>deux<ul><li>deux.un</li></ul></li></ul>");
    expect(html).toContain("<ol><li>premier</li></ol>");
    expect(html).toContain('<td style="text-align:right">2</td>');
    expect(html).toContain("<td><code>x | y</code></td>");
    expect(html).toContain('<pre><code class="language-sh">rapt dev &lt;src&gt;</code></pre>');
    expect(html).toContain("<blockquote><p>note</p></blockquote>");
    expect(inline("![capture](docs/images/x.png) texte")).toBe(" texte");
    expect(inline("[site](https://example.org)")).toBe('<a href="https://example.org" target="_blank" rel="noopener">site</a>');
    expect(headingId("D44 — Vues standards (`I_Currency`)")).toBe("d44--vues-standards-i_currency");
  });

  it("finds the pages of the documentation, README first", () => {
    const pages = documentationPages();
    expect(pages[0]?.file).toBe("README.md");
    expect(pages.map((p) => p.id)).toEqual(expect.arrayContaining(["features", "diagnostics", "decisions"]));
    expect(generateDocsApp(pages).map((f) => f.path)).toContain("pages.json");
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
