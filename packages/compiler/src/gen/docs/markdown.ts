/**
 * A small Markdown renderer for the documentation app of `rapt dev` (D49): the subset the
 * documentation of rap-transpiler uses — headings, paragraphs, lists (nested), code blocks and
 * inline code, tables, block quotes, links, emphasis. Text is escaped; links to other pages
 * (`FILE.md`, `FILE.md#anchor`) become routes of the app (`#/page/file`).
 */

const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The id of a heading, as GitHub writes it. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** The page id of a Markdown file name: `docs/DIAGNOSTICS.md` → `diagnostics`. */
export function pageId(file: string): string {
  return (file.split("/").pop() ?? file).replace(/\.md$/i, "").toLowerCase();
}

function link(href: string): { href: string; external: boolean } {
  if (/^[a-z]+:/i.test(href)) {
    return { href, external: true };
  }
  const match = /^(?:\.{0,2}\/)*(?:[\w./-]*\/)?([\w-]+)\.md(#.*)?$/i.exec(href);
  if (match !== null) {
    return { href: `#/page/${(match[1] ?? "").toLowerCase()}${match[2] === undefined ? "" : `/${match[2].slice(1)}`}`, external: false };
  }
  if (href.startsWith("#")) {
    return { href: `#anchor-${href.slice(1)}`, external: false };
  }
  return { href, external: true };
}

/** Inline Markdown: code spans first (their content stays as written), then links and emphasis. */
export function inline(text: string): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${escape(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escape(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const target = link(href.replace(/&amp;/g, "&"));
    return `<a href="${escape(target.href)}"${target.external ? ' target="_blank" rel="noopener"' : ""}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)] ?? "");
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let code = false;
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "`") code = !code;
    if (c === "\\" && body[i + 1] === "|") {
      current += "|";
      i++;
      continue;
    }
    if (c === "|" && !code) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  cells.push(current.trim());
  return cells;
}

/** Renders a Markdown document as HTML. */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  const isBlockStart = (line: string): boolean => /^(#{1,6}\s|```|>\s?|\s*[-*]\s|\s*\d+\.\s|\|)/.test(line) || line.trim() === "";
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = heading[1]?.length ?? 1;
      const text = heading[2] ?? "";
      out.push(`<h${level} id="anchor-${escape(headingId(text))}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        code.push(lines[i] ?? "");
        i++;
      }
      i++;
      out.push(`<pre><code${language === "" ? "" : ` class="language-${escape(language)}"`}>${escape(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? "")) {
        quote.push((lines[i] ?? "").replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
      continue;
    }
    if (line.trim().startsWith("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1] ?? "").map((c) => (c.endsWith(":") ? (c.startsWith(":") ? "center" : "right") : ""));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        rows.push(splitRow(lines[i] ?? ""));
        i++;
      }
      const cell = (tag: string, text: string, index: number): string => `<${tag}${align[index] ? ` style="text-align:${align[index]}"` : ""}>${inline(text)}</${tag}>`;
      out.push(`<table><thead><tr>${header.map((h, k) => cell("th", h, k)).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => cell("td", c, k)).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const block: string[] = [];
      const ordered = /^\s*\d+\./.test(line);
      const indent = line.length - line.trimStart().length;
      while (i < lines.length && ((lines[i] ?? "").trim() === "" ? /^\s+([-*]|\d+\.)?\s*\S/.test(lines[i + 1] ?? "") : /^(\s*([-*]|\d+\.)\s|\s{2,}\S)/.test(lines[i] ?? ""))) {
        const current = lines[i] ?? "";
        // a list of the other kind at the same level starts a new list
        if (block.length > 0 && current.length - current.trimStart().length <= indent && /^\s*([-*]|\d+\.)\s/.test(current) && /^\s*\d+\./.test(current) !== ordered) {
          break;
        }
        block.push(current);
        i++;
      }
      out.push(renderList(block));
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && !isBlockStart(lines[i] ?? "")) {
      paragraph.push((lines[i] ?? "").trim());
      i++;
    }
    if (paragraph.length === 0) {
      paragraph.push(line.trim());
      i++;
    }
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  return out.join("\n");
}

/** A list and its nested lists (by indentation). */
function renderList(block: string[]): string {
  const indentOf = (l: string): number => l.length - l.trimStart().length;
  const base = indentOf(block.find((l) => l.trim() !== "") ?? "");
  const ordered = /^\s*\d+\./.test(block[0] ?? "");
  const items: string[][] = [];
  for (const line of block) {
    if (line.trim() === "") continue;
    if (indentOf(line) <= base + 1 && /^\s*([-*]|\d+\.)\s/.test(line)) {
      items.push([line.trim().replace(/^([-*]|\d+\.)\s+/, "")]);
    } else {
      items[items.length - 1]?.push(line);
    }
  }
  const html = items.map(([first = "", ...rest]) => {
    const nested = rest.filter((l) => /^\s*([-*]|\d+\.)\s/.test(l));
    const text = [first, ...rest.filter((l) => !/^\s*([-*]|\d+\.)\s/.test(l)).map((l) => l.trim())].join(" ");
    const sub = nested.length === 0 ? "" : renderList(rest.slice(rest.findIndex((l) => /^\s*([-*]|\d+\.)\s/.test(l))));
    return `<li>${inline(text)}${sub}</li>`;
  });
  return ordered ? `<ol>${html.join("")}</ol>` : `<ul>${html.join("")}</ul>`;
}
