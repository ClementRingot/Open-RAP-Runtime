/** The rap-transpiler npm package (D65): its rapt command runs the CLI of the compiler. */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const BIN = fileURLToPath(new URL("../bin/rapt.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../../../fixtures/travel", import.meta.url));

describe("rap-transpiler (npm)", () => {
  it("rapt checks a project and prints its version once", () => {
    const out = execFileSync(process.execPath, [BIN, "check", FIXTURE, "--json"], { encoding: "utf8" });
    expect(JSON.parse(out)).toMatchObject({ command: "check", ok: true, root: path.resolve(FIXTURE) });
    const help = execFileSync(process.execPath, [BIN, "--help"], { encoding: "utf8" });
    expect(help.match(/^rapt \d+\.\d+\.\d+/gm)).toHaveLength(1);
    expect(help).toContain("rapt agent");
  }, 60_000);
});
