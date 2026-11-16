#!/usr/bin/env node
// Round trip to an SAP BTP ABAP trial (D99): the abapGit repository of a fixture and its variants
// (fixtures/variants.json), renamed with the suffix of the user for the shared trial, with the
// draft tables SAP needs, an expected.json of what must happen on SAP, and the steps to follow.
//
//   node scripts/btp-roundtrip.mjs --suffix CR1 --out ../trial-travel [--variants draft,trial] [--fixture fixtures/travel]

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { applyVariants, roundTripReadme } from "./lib/roundtrip.mjs";

const USAGE = `Usage: node scripts/btp-roundtrip.mjs --suffix <XYZ> --out <dir> [--variants draft,trial] [--fixture fixtures/travel]

  --suffix    1 to 6 letters or digits of your own: the trial is shared by its users
  --variants  variants of fixtures/variants.json applied in order (default: draft,trial: the draft
              BO the Fiori elements scenarios need, without the authorizations the trial cannot grant)
`;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let values;
try {
  ({ values } = parseArgs({ options: { suffix: { type: "string" }, out: { type: "string" }, variants: { type: "string" }, fixture: { type: "string" }, help: { type: "boolean", short: "h" } } }));
} catch (error) {
  process.stderr.write(`${error.message}\n${USAGE}`);
  process.exit(2);
}
if (values.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (values.suffix === undefined || values.out === undefined) {
  process.stderr.write(`missing: ${[values.suffix === undefined ? "--suffix" : "", values.out === undefined ? "--out" : ""].filter(Boolean).join(", ")}\n${USAGE}`);
  process.exit(2);
}
const fixture = path.resolve(root, values.fixture ?? "fixtures/travel");
const variants = (values.variants ?? "draft,trial").split(",").map((v) => v.trim()).filter((v) => v !== "");
const out = path.resolve(values.out);
if (existsSync(out)) {
  process.stderr.write(`${out} exists: give a new folder\n`);
  process.exit(2);
}

const work = mkdtempSync(path.join(tmpdir(), "rapt-roundtrip-"));
try {
  // the fixture and its variants, in a copy
  cpSync(path.join(fixture, "src"), path.join(work, "src"), { recursive: true });
  cpSync(path.join(fixture, ".abapgit.xml"), path.join(work, ".abapgit.xml"));
  const definitions = JSON.parse(readFileSync(path.join(root, "fixtures", "variants.json"), "utf8"));
  applyVariants(path.join(work, "src"), definitions, variants);
  // the renamed copy, with the draft tables (rapt abapgit --suffix)
  const cli = path.join(root, "packages", "compiler", "dist", "cli.js");
  let result;
  try {
    result = JSON.parse(execFileSync("node", [cli, "abapgit", work, "--suffix", values.suffix, "--out", out, "--json"], { encoding: "utf8" }));
  } catch (error) {
    const text = String(error.stdout ?? error.message);
    process.stderr.write(`${text}\n`);
    process.exit(1);
  }
  const renamed = result.renamed;
  const binding = renamed.find((r) => r.types.includes("SRVB"));
  const definition = renamed.find((r) => r.types.includes("SRVD"));
  const expected = {
    fixture: path.relative(root, fixture).split(path.sep).join("/"),
    variants,
    suffix: values.suffix.toUpperCase(),
    expect: "every object activates without error",
    objects: renamed,
    service: binding === undefined || definition === undefined ? undefined : { binding: binding.to, path: `/sap/opu/odata4/sap/${binding.to.toLowerCase()}/srvd/sap/${definition.to.toLowerCase()}/0001/` },
  };
  writeFileSync(path.join(out, "expected.json"), `${JSON.stringify(expected, null, 2)}\n`);
  writeFileSync(path.join(out, "README.md"), roundTripReadme(expected));
  for (const o of renamed.filter((r) => !r.to.startsWith(r.from))) {
    process.stdout.write(`warning: ${o.from} is cut to ${o.to} (${o.types.join(", ")}): a shorter suffix keeps it whole\n`);
  }
  process.stdout.write(`${out}: ${result.files} files, ${renamed.length} objects renamed with ${expected.suffix}\n`);
  process.stdout.write(`next: follow ${path.join(out, "README.md")}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
