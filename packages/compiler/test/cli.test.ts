import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
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

  it("check: succeeds on the fixture", () => {
    expect(main(["check", FIXTURE_DIR])).toBe(0);
    expect(out.join("")).toContain("0 error(s), 0 warning(s), 0 info");
  });

  it("check: fails with positioned errors", () => {
    const variant = fixtureVariant({ "zrt_r_travel.bdef.asbdef": (c) => c.replace("lock master", "lock mastr") });
    try {
      expect(main(["check", variant.dir])).toBe(1);
      expect(err.join("")).toMatch(/^src\/zrt_r_travel\.bdef\.asbdef:\d+:\d+: error BDEF/m);
    } finally {
      variant.cleanup();
    }
  });

  it("ir: writes the model", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rapt-cli-"));
    try {
      const file = path.join(dir, "model.json");
      expect(main(["ir", FIXTURE_DIR, "--out", file])).toBe(0);
      const model = JSON.parse(readFileSync(file, "utf8")) as { service: { name: string } };
      expect(model.service.name).toBe("ZRT_UI_TRAVEL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints the usage", () => {
    expect(main(["--help"])).toBe(0);
    expect(out.join("")).toContain("Usage:");
    expect(main([])).toBe(2);
    expect(main(["frobnicate", FIXTURE_DIR])).toBe(2);
  });
});
