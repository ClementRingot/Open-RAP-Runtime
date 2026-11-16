#!/usr/bin/env node
// SAP Fiori elements protocol cases from a HAR (decision D79), run locally by the user.
//
// The HAR is recorded on the user's SAP BTP trial, in the Fiori elements preview of the service
// of a fixture of the project; it stays with the user. This writes the shape of its requests and
// the structure of its responses as a case file of packages/runtime/test/fe-protocol/cases/,
// replayed against Open RAP Runtime by `pnpm test` (see docs/GUIDE.md, "Checking with SAP Fiori
// elements locally").
//
//   node scripts/fe-har-to-cases.mjs <file.har> --scenario draft-object-page --floorplan objectPage \
//     --release 2611 [--fixture travel-draft] [--case edit-and-activate] [--map <guid>=T1]... [--out <file>]

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { harToCases } from "./lib/fe-har.mjs";

const USAGE = `Usage: node scripts/fe-har-to-cases.mjs <file.har> --scenario <name> --floorplan <floorplan> --release <SAP BTP release>
  [--fixture travel|travel-draft] [--case <id>] [--title <text>] [--map <guid>=<T1|T2|T3|B1…>]... [--observe a,b] [--out <file>]

  --observe    properties whose values are kept in "observed" (Name* for a prefix, error, sap-messages)
  --floorplan  listReport, objectPage, worklist, analyticalListPage, overviewPage or formEntry
  --map        a key of an instance of the SAP system → a seeded key of the fixture (T1, T2, T3, B1…B4)
  --out        default: packages/runtime/test/fe-protocol/cases/<scenario>-har.json
`;

const FLOORPLANS = ["listReport", "objectPage", "worklist", "analyticalListPage", "overviewPage", "formEntry"];

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      scenario: { type: "string" },
      floorplan: { type: "string" },
      release: { type: "string" },
      fixture: { type: "string" },
      case: { type: "string" },
      title: { type: "string" },
      map: { type: "string", multiple: true },
      observe: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (error) {
  process.stderr.write(`${error.message}\n${USAGE}`);
  process.exit(2);
}
const { values, positionals } = parsed;
if (values.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}
const [harFile] = positionals;
const missing = [harFile === undefined ? "<file.har>" : undefined, ...["scenario", "floorplan", "release"].filter((o) => values[o] === undefined).map((o) => `--${o}`)].filter((m) => m !== undefined);
if (missing.length > 0) {
  process.stderr.write(`missing: ${missing.join(", ")}\n${USAGE}`);
  process.exit(2);
}
if (!FLOORPLANS.includes(values.floorplan)) {
  process.stderr.write(`--floorplan: one of ${FLOORPLANS.join(", ")}\n`);
  process.exit(2);
}
if (values.fixture !== undefined && !["travel", "travel-draft"].includes(values.fixture)) {
  process.stderr.write("--fixture: travel or travel-draft\n");
  process.exit(2);
}
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(values.scenario)) {
  process.stderr.write("--scenario: lower case words separated by dashes, e.g. draft-object-page\n");
  process.exit(2);
}
const map = {};
for (const entry of values.map ?? []) {
  const [guid, name] = entry.split("=");
  if (guid === undefined || name === undefined || !/^[TB]\d$/.test(name)) {
    process.stderr.write(`--map ${entry}: expected <guid>=T1 (a seeded key of the fixture)\n`);
    process.exit(2);
  }
  map[guid] = name;
}

let har;
try {
  har = JSON.parse(readFileSync(harFile, "utf8"));
} catch (error) {
  process.stderr.write(`${harFile}: ${error.message}\n`);
  process.exit(1);
}
let result;
try {
  result = harToCases(har, { scenario: values.scenario, floorplan: values.floorplan, release: values.release, fixture: values.fixture, caseId: values.case, title: values.title, map, observe: (values.observe ?? "").split(",").map((o) => o.trim()).filter((o) => o !== "") });
} catch (error) {
  process.stderr.write(`${harFile}: ${error.message}\n`);
  process.exit(1);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = values.out ?? path.join(root, "packages", "runtime", "test", "fe-protocol", "cases", `${values.scenario}-har.json`);
writeFileSync(out, `${JSON.stringify(result.file, null, 2)}\n`);
const steps = result.file.cases[0].steps.length;
process.stdout.write(`${out}: ${steps} step${steps === 1 ? "" : "s"}\n`);
for (const warning of result.warnings) process.stdout.write(`warning: ${warning}\n`);
process.stdout.write("next: pnpm build, then npx vitest run packages/runtime/test/fe-protocol; mark a failing case with \"fails\": \"Dnn\" (the decision that will fix it)\n");
