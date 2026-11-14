/**
 * SAP Fiori elements protocol cases (D79): each file of cases/ runs on its own database; a case
 * marked `fails` is expected to fail until its decision is delivered (it.fails: a case that starts
 * passing makes the test fail, so that its marker is removed). No network, no SAPUI5.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProtocolServer, runCase, type ProtocolFile } from "./protocol.js";

const DIR = fileURLToPath(new URL("./cases/", import.meta.url));
const FILES: Array<{ name: string; file: ProtocolFile }> = readdirSync(DIR)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => ({ name, file: JSON.parse(readFileSync(`${DIR}${name}`, "utf8")) as ProtocolFile }));

describe("Fiori elements protocol case files", () => {
  it("are well formed", () => {
    expect(FILES.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const { name, file } of FILES) {
      expect(["travel", "travel-draft"], name).toContain(file.fixture);
      expect(["specification", "har"], name).toContain(file.source);
      if (file.source === "har") expect(file.release, `${name}: the SAP BTP release of the HAR`).toBeTypeOf("string");
      for (const c of file.cases) {
        const id = `${file.scenario}/${c.id}`;
        expect(ids.has(id), `duplicate case ${id}`).toBe(false);
        ids.add(id);
        expect(c.steps.length, id).toBeGreaterThan(0);
        if (c.fails !== undefined) expect(c.fails, `${id}: fails names a decision (Dnn)`).toMatch(/^D\d+[a-z]?$/);
        for (const step of [...c.steps, ...(c.cleanup ?? [])]) {
          expect((step.request === undefined) !== (step.batch === undefined), `${id}: a step has a request or a batch`).toBe(true);
        }
      }
    }
  });
});

for (const { name, file } of FILES) {
  describe(`Fiori elements protocol: ${file.scenario} (${name})`, () => {
    let server: ProtocolServer;
    beforeAll(async () => {
      server = await ProtocolServer.start(file.fixture);
    }, 180_000);
    afterAll(async () => {
      await server?.close();
    });
    for (const c of file.cases) {
      const title = `${c.id}: ${c.title}${c.fails === undefined ? "" : ` (fails until ${c.fails})`}`;
      (c.fails === undefined ? it : it.fails)(title, async () => {
        await runCase(server, c);
      });
    }
  });
}
