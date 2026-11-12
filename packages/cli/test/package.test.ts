import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const manifest = (folder: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(new URL(`../../${folder}/package.json`, import.meta.url), "utf8"));

describe("open-rap-runtime package (D65)", () => {
  it("depends on what rapt dev serves, at the versions of the runtime", () => {
    const runtime = manifest("runtime").devDependencies ?? {};
    const served = Object.entries(runtime).filter(([name]) => name.startsWith("@openui5/") || name === "@electric-sql/pglite" || name === "less-openui5");
    expect(served.length).toBeGreaterThan(0);
    expect(manifest("cli").dependencies).toEqual({
      ...Object.fromEntries(served),
      "@open-rap/compiler": "workspace:*",
      "@open-rap/runtime": "workspace:*",
    });
  });

  it("runs the command of the compiler once", () => {
    const out = execFileSync(process.execPath, [fileURLToPath(new URL("../dist/rapt.js", import.meta.url)), "--help"], { encoding: "utf8" });
    expect(out.match(/^rapt \S+: compiles RAP sources/gm)).toHaveLength(1);
  });
});
