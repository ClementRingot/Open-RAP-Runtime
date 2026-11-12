import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEntryPoint, main } from "../src/cli.js";
import { FIXTURE_DIR, fixtureVariant } from "./helpers.js";

describe("rapt CLI", () => {
  let out: string[];
  let err: string[];
  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      err.push(String(chunk));
      return true;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("recognizes its own script whatever the form of the path", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rapt-entry-"));
    try {
      mkdirSync(path.join(dir, "dist"));
      const cli = path.join(dir, "dist", "cli.js");
      writeFileSync(cli, "");
      writeFileSync(path.join(dir, "other.js"), "");
      const url = pathToFileURL(cli).href;
      expect(isEntryPoint(url, cli)).toBe(true);
      expect(isEntryPoint(url, path.relative(process.cwd(), cli))).toBe(true);
      expect(isEntryPoint(url, path.join(dir, "other.js"))).toBe(false);
      expect(isEntryPoint(url, path.join(dir, "missing.js"))).toBe(false);
      expect(isEntryPoint(url, undefined)).toBe(false);
      if (process.platform !== "win32") {
        symlinkSync(cli, path.join(dir, "rapt-link"));
        expect(isEntryPoint(url, path.join(dir, "rapt-link"))).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("check: succeeds on the fixture", async () => {
    expect(await main(["check", FIXTURE_DIR])).toBe(0);
    expect(out.join("")).toContain("0 error(s), 0 warning(s), 0 info");
  });

  it("check: fails with positioned errors", async () => {
    const variant = fixtureVariant({ "zrt_r_travel.bdef.asbdef": (c) => c.replace("lock master", "lock mastr") });
    try {
      expect(await main(["check", variant.dir])).toBe(1);
      expect(err.join("")).toMatch(/^src\/zrt_r_travel\.bdef\.asbdef:\d+:\d+: error BDEF/m);
    } finally {
      variant.cleanup();
    }
  });

  it("check --json: diagnostics with absolute paths", async () => {
    const variant = fixtureVariant({ "zrt_r_travel.bdef.asbdef": (c) => c.replace("lock master", "lock mastr") });
    try {
      expect(await main(["check", variant.dir, "--json"])).toBe(1);
      const result = JSON.parse(out.join("")) as { command: string; ok: boolean; counts: { error: number }; diagnostics: Array<{ code: string; file: string; path: string; line: number }> };
      expect(result).toMatchObject({ command: "check", ok: false });
      expect(result.counts.error).toBeGreaterThan(0);
      const bdef = result.diagnostics.find((d) => d.code.startsWith("BDEF") && d.file === "src/zrt_r_travel.bdef.asbdef");
      expect(bdef?.path).toBe(path.join(variant.dir, "src", "zrt_r_travel.bdef.asbdef"));
      expect(err.join("")).toBe("");
    } finally {
      variant.cleanup();
    }
  });

  it("ir: writes the model", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rapt-cli-"));
    try {
      const file = path.join(dir, "model.json");
      expect(await main(["ir", FIXTURE_DIR, "--out", file])).toBe(0);
      const model = JSON.parse(readFileSync(file, "utf8")) as { service: { name: string } };
      expect(model.service.name).toBe("ZRT_UI_TRAVEL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints the usage", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(out.join("")).toContain("Usage:");
    expect(await main([])).toBe(2);
    expect(await main(["frobnicate", FIXTURE_DIR])).toBe(2);
  });
});
