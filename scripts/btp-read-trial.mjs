#!/usr/bin/env node
// Round 2 on the SAP BTP trial (D111): reads the CDS views of the variant `cds` (fixtures/cds) on
// the user's trial, with the session of the browser signed in by scripts/fe-record-trial.mjs, and
// writes each answer, made neutral (scripts/lib/cds-reads.mjs), next to the $metadata of the
// service. No cookie, token, host or user name is written.
//
//   node scripts/btp-read-trial.mjs --service <service root URL> --suffix <XYZ> --out <dir> [--state <file>]

import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { CDS_READS, neutralAnswer, readUrl } from "./lib/cds-reads.mjs";

const USAGE = `Usage: node scripts/btp-read-trial.mjs --service <service root URL> --suffix <XYZ> --out <dir> [--state <file>]

  --service  the root of the OData service on the trial (…/srvd/sap/<service>/0001/)
  --suffix   the suffix of the objects of the repository on the trial
  --out      where the answers go (one JSON file per read, and metadata.xml)
  --state    the signed-in session of the browser (default: ~/.rapt/btp-trial-state.json, written
             by scripts/fe-record-trial.mjs)
`;

let values;
try {
  ({ values } = parseArgs({ options: { service: { type: "string" }, suffix: { type: "string" }, out: { type: "string" }, state: { type: "string" }, help: { type: "boolean", short: "h" } } }));
} catch (error) {
  process.stderr.write(`${error.message}\n${USAGE}`);
  process.exit(2);
}
if (values.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (values.service === undefined || values.suffix === undefined || values.out === undefined) {
  process.stderr.write(`missing: --service, --suffix and --out are needed\n${USAGE}`);
  process.exit(2);
}
const statePath = path.resolve(values.state ?? path.join(homedir(), ".rapt", "btp-trial-state.json"));
if (!existsSync(statePath)) {
  process.stderr.write(`${statePath}: no session; sign in first with node scripts/fe-record-trial.mjs --login …\n`);
  process.exit(2);
}
let playwright;
try {
  playwright = createRequire(import.meta.url)("playwright");
} catch {
  process.stderr.write("Playwright is needed: npm install --no-save playwright\n");
  process.exit(1);
}
const root = values.service.endsWith("/") ? values.service : `${values.service}/`;
const suffix = values.suffix.toUpperCase();
const out = path.resolve(values.out);
mkdirSync(out, { recursive: true });
const context = await playwright.request.newContext({ storageState: statePath, extraHTTPHeaders: { accept: "application/json" } });
try {
  const metadata = await context.get(`${root}$metadata`, { headers: { accept: "application/xml" } });
  const xml = await metadata.text();
  const namespace = /<Schema[^>]*Namespace="([^"]+)"/.exec(xml)?.[1];
  writeFileSync(path.join(out, "metadata.xml"), xml);
  for (const read of CDS_READS) {
    const response = await context.get(readUrl(root, read, suffix));
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { text: text.slice(0, 2000) };
    }
    const answer = { id: read.id, url: read.url, compare: read.compare, ...neutralAnswer(response.status(), body, { namespace, suffix }) };
    writeFileSync(path.join(out, `${read.id}.json`), `${JSON.stringify(answer, null, 2)}\n`);
    process.stdout.write(`${read.id}: ${response.status()}\n`);
  }
} finally {
  await context.dispose();
}
process.stdout.write(`${out}: metadata.xml and ${CDS_READS.length} answers\n`);
