// Round trip to an SAP BTP ABAP trial (D99): pure helpers of scripts/btp-roundtrip.mjs, tested by
// scripts/lib/roundtrip.test.mjs.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Applies variants of fixtures/variants.json to the sources of a copy: each file gets its exact
 * replacements in order (each must be found once), `null` removes the file.
 */
export function applyVariants(srcDir, definitions, names) {
  for (const name of names) {
    const variant = definitions[name];
    if (variant === undefined || name.startsWith("$")) {
      throw new Error(`unknown variant ${name}: ${Object.keys(definitions).filter((k) => !k.startsWith("$")).join(", ")}`);
    }
    for (const [file, replacements] of Object.entries(variant.files)) {
      const target = path.join(srcDir, file);
      if (replacements === null) {
        rmSync(target, { force: true });
        continue;
      }
      if (!existsSync(target)) {
        throw new Error(`variant ${name}: ${file} does not exist`);
      }
      let content = readFileSync(target, "utf8");
      for (const [from, to] of replacements) {
        if (!content.includes(from)) {
          throw new Error(`variant ${name}: text not found in ${file}: ${from.slice(0, 80)}`);
        }
        content = content.replace(from, () => to);
      }
      writeFileSync(target, content);
    }
  }
}

/** The steps on the trial, written next to the repository. */
export function roundTripReadme(expected) {
  const service = expected.service;
  return `# Round trip to the SAP BTP ABAP trial (D99)

Fixture \`${expected.fixture}\`, variants ${expected.variants.map((v) => `\`${v}\``).join(", ") || "none"}, suffix \`${expected.suffix}\`:
every object of this repository ends with \`${expected.suffix}\`, because the trial is shared by
its users. Expected: ${expected.expect}.

1. Push this folder to a Git repository of yours (public, or reachable by the trial).
2. In ADT, connected to the trial: create a package of your own under \`ZLOCAL\`, then with
   *abapGit Repositories* (abapGit for ADT): *Link* the repository to the package, *Pull*, and
   *Activate* all the inactive objects. Note the result of each object and the exact text of each
   error in \`results/activation.md\`.
3. Open the service binding \`${service?.binding ?? "(the binding)"}\`, press *Publish*, select the root entity and
   open the *Preview* of Fiori elements; copy its URL.
4. Record the scenarios of SAP Fiori elements:
   \`node scripts/fe-record-trial.mjs --url <preview URL> --release <release of the trial>\`
   (from the repository of Open RAP Runtime).
5. Keep in \`results/\` the \`$metadata\` of the service
   (\`${service?.path ?? "<service path>"}$metadata\`) for the comparison of D100.

The trial account lasts 30 days by default: repeat these steps on a new account or a new release.
Objects of this repository:

${expected.objects.map((o) => `- ${o.from} → ${o.to} (${o.types.join(", ")})`).join("\n")}
`;
}
