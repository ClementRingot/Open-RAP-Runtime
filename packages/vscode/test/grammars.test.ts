/** Syntax coloring: the TextMate grammars of the extension on the sources of the fixture. */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import * as oniguruma from "vscode-oniguruma";
import * as textmate from "vscode-textmate";

const SYNTAXES = fileURLToPath(new URL("../syntaxes/", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/travel/src/", import.meta.url));
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
  contributes: { grammars: { language: string; scopeName: string; path: string }[]; languages: { id: string; extensions: string[] }[] };
};

let registry: textmate.Registry;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  await oniguruma.loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).buffer as ArrayBuffer);
  registry = new textmate.Registry({
    onigLib: Promise.resolve({ createOnigScanner: (p) => new oniguruma.OnigScanner(p), createOnigString: (s) => new oniguruma.OnigString(s) }),
    loadGrammar: async (scopeName) => {
      const grammar = manifest.contributes.grammars.find((g) => g.scopeName === scopeName);
      if (grammar === undefined) return null;
      const file = path.join(SYNTAXES, "..", grammar.path);
      return textmate.parseRawGrammar(readFileSync(file, "utf8"), file);
    },
  });
});

/** Text → scope of each token, for the given source. */
async function tokens(scopeName: string, source: string): Promise<Map<string, string>> {
  const grammar = await registry.loadGrammar(scopeName);
  expect(grammar).not.toBeNull();
  const result = new Map<string, string>();
  let state = textmate.INITIAL;
  for (const line of source.split("\n")) {
    const r = grammar!.tokenizeLine(line, state);
    for (const t of r.tokens) {
      const text = line.slice(t.startIndex, t.endIndex).trim();
      if (text !== "" && !result.has(text)) result.set(text, t.scopes[t.scopes.length - 1] ?? "");
    }
    state = r.ruleStack;
  }
  return result;
}

describe("syntax coloring", () => {
  it("maps the abapGit source files to a language with a grammar", () => {
    const extensions = manifest.contributes.languages.flatMap((l) => l.extensions);
    expect(extensions).toEqual(expect.arrayContaining([".abap", ".asddls", ".asddlxs", ".asdcls", ".srvdsrv", ".astabl", ".asbdef"]));
    for (const language of manifest.contributes.languages) {
      expect(manifest.contributes.grammars.some((g) => g.language === language.id)).toBe(true);
    }
  });

  it("colors CDS entities, metadata extensions and tables", async () => {
    const view = await tokens("source.abapcds", readFileSync(path.join(FIXTURE, "zrt_r_travel.ddls.asddls"), "utf8"));
    expect(view.get("@AccessControl.authorizationCheck")).toMatch(/^storage\.type\.annotation/);
    expect(view.get("#CHECK")).toMatch(/^constant\.other\.enum/);
    expect(view.get("define")).toMatch(/^keyword/);
    expect(view.get("_Booking")).toMatch(/^variable\.other\.association/);
    expect(view.get("Travel")).toMatch(/^string\.quoted/);
    const table = await tokens("source.abapcds", "define table ztab {\n  key client : abap.clnt not null; // client\n  amount : abap.curr(16,2);\n}");
    expect(table.get("abap.clnt")).toMatch(/^support\.type/);
    expect(table.get("// client")).toMatch(/^comment/);
    expect(table.get("16")).toMatch(/^constant\.numeric/);
  });

  it("colors behavior definitions", async () => {
    const bdef = await tokens("source.abapbdef", readFileSync(path.join(FIXTURE, "zrt_r_travel.bdef.asbdef"), "utf8"));
    expect(bdef.get("managed")).toMatch(/^keyword/);
    expect(bdef.get("determination")).toMatch(/^keyword/);
    expect(bdef.get("$self")).toMatch(/^variable\.language/);
    expect(bdef.get("[1]")).toMatch(/^constant\.numeric/);
  });

  it("colors ABAP", async () => {
    const abap = await tokens("source.abap", readFileSync(path.join(FIXTURE, "zbp_rt_r_travel.clas.locals_imp.abap"), "utf8"));
    expect(abap.get("CLASS")).toMatch(/^storage\.type/);
    expect(abap.get("METHODS")).toMatch(/^keyword/);
  });
});
