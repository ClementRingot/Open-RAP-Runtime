// Sources SAP BTP must refuse (D91): the cases of fixtures/negative/cases.json, each one the
// business object of `rapt new` with exact text replacements. Used by scripts/btp-roundtrip.mjs
// --negative and tested by scripts/lib/negative.test.mjs.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The cases of fixtures/negative/cases.json. */
export function negativeCases(root) {
  return JSON.parse(readFileSync(path.join(root, "fixtures", "negative", "cases.json"), "utf8"));
}

/**
 * Writes one case into the project `dir` (created by `rapt new`, the project may already hold
 * other cases): the business object of `prefix`, then the replacements of the case, in the file
 * of that business object whose name ends with each key ({prefix} stands for the prefix in lower
 * case).
 */
export function writeNegativeCase(root, dir, definitions, c, prefix = c.prefix) {
  const cli = path.join(root, "packages", "compiler", "dist", "cli.js");
  execFileSync("node", [cli, "new", dir, definitions.entity, "--prefix", prefix, "--no-launchpad", "--json"], { encoding: "utf8" });
  const src = path.join(dir, "src");
  const lower = prefix.toLowerCase();
  // the files of this business object: the prefix without its Z for the behavior pool (zbp_rna_…)
  const own = (file) => file.startsWith(lower) || file.startsWith(`zbp_${lower.slice(1)}`);
  for (const [suffix, replacements] of Object.entries(c.changes)) {
    const files = readdirSync(src).filter((f) => own(f) && f.endsWith(suffix));
    if (files.length !== 1) {
      throw new Error(`negative case ${c.id}: ${files.length} files end with ${suffix}`);
    }
    const file = path.join(src, files[0]);
    let content = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    for (const [from, to] of replacements) {
      const text = from.replaceAll("{prefix}", lower);
      if (!content.includes(text)) {
        throw new Error(`negative case ${c.id}: text not found in ${files[0]}: ${text.slice(0, 80)}`);
      }
      content = content.replace(text, () => to.replaceAll("{prefix}", lower));
    }
    writeFileSync(file, content);
  }
}

/** The steps on the trial for the negative cases, written next to the repository. */
export function negativeReadme(expected) {
  return `# Sources SAP BTP must refuse (D91)

Suffix \`${expected.suffix}\`: the business objects of this repository end with it, because the
trial is shared by its users. Each one is the business object of \`rapt new\` with one change;
\`control\` has none and must activate.

1. Push this folder to a Git repository of yours, link it to a new package under \`ZLOCAL\` with
   abapGit for ADT, *Pull*, then *Activate* all the inactive objects.
2. For each business object below, write in \`results/negative.md\` whether its objects activate,
   and the exact text of each error (object, line, message).
3. Bring \`results/negative.md\` back: the outcome of SAP goes to \`sap\` of
   \`fixtures/negative/cases.json\` in the repository of Open RAP Runtime.

| Case | Objects | Change | Open RAP Runtime | To settle |
|---|---|---|---|---|
${expected.cases.map((c) => `| ${c.id} | \`${c.prefix}_…\` | ${c.description} | ${c.code ?? "accepted"} | ${c.confirm ?? ""} |`).join("\n")}
`;
}
