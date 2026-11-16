#!/usr/bin/env node
// Guided recording of the SAP Fiori elements protocol on the user's SAP BTP trial (D83), run
// locally by the user, under their own SAP license.
//
// A Chromium window opens on the Fiori elements preview of the draft fixture (imported on the trial
// with `rapt abapgit fixtures/… --suffix XYZ --out …`); the user signs in, then plays each scenario
// the terminal describes and presses Enter. Each scenario is recorded in its own HAR, limited to
// the OData service (no SAPUI5 resource is written), turned at once into a case file of
// packages/runtime/test/fe-protocol/cases/ by the logic of scripts/fe-har-to-cases.mjs, and the HAR
// is deleted (unless --keep-har). The session of the browser is kept outside the repository.
//
//   node scripts/fe-record-trial.mjs --url <preview URL> --release <release> [--scenarios a,b]
//     [--map <guid>=T1]... [--out <dir>] [--keep-har <dir>] [--state <file>] [--login]

import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { harToCases } from "./lib/fe-har.mjs";
import { SCENARIOS, scenariosOf } from "./lib/fe-scenarios.mjs";

const USAGE = `Usage: node scripts/fe-record-trial.mjs --url <preview URL> --release <SAP BTP release>
  [--scenarios ${SCENARIOS.map((s) => s.id).join(",")}]
  [--map <guid>=T1]... [--out <dir>] [--keep-har <dir>] [--state <file>] [--login]

  --url        the Fiori elements preview of the service binding of the draft fixture, on the trial
  --out        where the case files go (default: packages/runtime/test/fe-protocol/cases)
  --keep-har   keep the HAR files in this folder (default: deleted once turned into cases)
  --state      the signed-in session of the browser (default: ~/.rapt/btp-trial-state.json)
  --login      sign in again
`;

/** The requests recorded: the OData V4 services of SAP only (D83). */
const SERVICE_TRAFFIC = /\/sap\/opu\/odata4\//;

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: false,
    options: {
      url: { type: "string" },
      release: { type: "string" },
      scenarios: { type: "string" },
      map: { type: "string", multiple: true },
      out: { type: "string" },
      "keep-har": { type: "string" },
      state: { type: "string" },
      login: { type: "boolean" },
      // tests: no window, no keyboard: each step lasts this many milliseconds
      headless: { type: "boolean" },
      auto: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (error) {
  process.stderr.write(`${error.message}\n${USAGE}`);
  process.exit(2);
}
const { values } = parsed;
if (values.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (values.url === undefined || values.release === undefined) {
  process.stderr.write(`missing: ${[values.url === undefined ? "--url" : "", values.release === undefined ? "--release" : ""].filter(Boolean).join(", ")}\n${USAGE}`);
  process.exit(2);
}
let scenarios;
try {
  scenarios = scenariosOf(values.scenarios);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
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

const chromium = playwrightChromium();
if (chromium === undefined) {
  process.stderr.write("Playwright is needed: npm install --no-save playwright && npx playwright install chromium\n");
  process.exit(1);
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(values.out ?? path.join(root, "packages", "runtime", "test", "fe-protocol", "cases"));
const statePath = path.resolve(values.state ?? path.join(homedir(), ".rapt", "btp-trial-state.json"));
const auto = values.auto === undefined ? undefined : Number(values.auto);
const terminal = auto === undefined ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
const pause = async (prompt) => {
  if (auto !== undefined) {
    await new Promise((resolve) => setTimeout(resolve, auto));
    return;
  }
  await terminal.question(prompt);
};

const browser = await chromium.launch({ headless: values.headless === true });
let failed = false;
try {
  // the session: signed in once by the user, kept outside the repository
  if (values.login === true || !existsSync(statePath)) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(values.url);
    await pause("Sign in to SAP BTP in the browser window, wait for the preview, then press Enter: ");
    mkdirSync(path.dirname(statePath), { recursive: true });
    await context.storageState({ path: statePath });
    await context.close();
  }
  const work = mkdtempSync(path.join(tmpdir(), "rapt-trial-"));
  mkdirSync(out, { recursive: true });
  for (const [n, scenario] of scenarios.entries()) {
    const har = path.join(work, `${scenario.id}.har`);
    const context = await browser.newContext({ storageState: statePath, recordHar: { path: har, content: "embed", urlFilter: SERVICE_TRAFFIC } });
    const page = await context.newPage();
    process.stdout.write(`\n[${n + 1}/${scenarios.length}] ${scenario.title}${scenario.variants === undefined ? "" : ` (needs the variants ${scenario.variants.join(", ")} on the trial)`}\n${scenario.steps.map((s) => `  - ${s}`).join("\n")}\n`);
    await page.goto(values.url);
    await pause("Press Enter when the scenario is done: ");
    await context.close(); // writes the HAR
    try {
      const { file, warnings } = harToCases(JSON.parse(readFileSync(har, "utf8")), { scenario: `trial-${scenario.id}`, floorplan: scenario.floorplan, release: values.release, title: scenario.title, map, observe: scenario.observe ?? [] });
      const target = path.join(out, `trial-${scenario.id}-har.json`);
      writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`);
      process.stdout.write(`${target}: ${file.cases[0].steps.length} steps\n`);
      for (const warning of warnings) process.stdout.write(`warning: ${warning}\n`);
    } catch (error) {
      failed = true;
      process.stderr.write(`${scenario.id}: ${error.message}\n`);
    }
    if (values["keep-har"] !== undefined) {
      mkdirSync(values["keep-har"], { recursive: true });
      writeFileSync(path.join(values["keep-har"], `${scenario.id}.har`), readFileSync(har));
    }
  }
  rmSync(work, { recursive: true, force: true });
} finally {
  terminal?.close();
  await browser.close();
}
process.stdout.write("\nnext: review the request bodies of the case files, then npx vitest run packages/runtime/test/fe-protocol; mark a failing case with \"fails\": \"Dnn\"\n");
process.exit(failed ? 1 : 0);

/** Playwright from the project, or the copy pre-installed in a development container. */
function playwrightChromium() {
  const require = createRequire(import.meta.url);
  for (const id of [process.env.PLAYWRIGHT_MODULE, "playwright", "/opt/node-tools/node_modules/playwright"]) {
    if (id === undefined) continue;
    try {
      return require(id).chromium;
    } catch {
      // next
    }
  }
  return undefined;
}
