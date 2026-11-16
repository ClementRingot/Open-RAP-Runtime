// Round trip to an SAP BTP ABAP trial (D99): the variants of the fixture and the repository for SAP.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyVariants, roundTripReadme } from "./roundtrip.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("variants of the fixtures (D99)", () => {
  it("replaces exact texts in order, removes files, and refuses what is not found", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "variants-"));
    try {
      writeFileSync(path.join(dir, "a.txt"), "one two one");
      writeFileSync(path.join(dir, "b.txt"), "b");
      const definitions = { $comment: "x", v: { files: { "a.txt": [["one", "1"], ["one", "$&"]], "b.txt": null } } };
      applyVariants(dir, definitions, ["v"]);
      expect(readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("1 two $&");
      expect(existsSync(path.join(dir, "b.txt"))).toBe(false);
      expect(() => applyVariants(dir, definitions, ["w"])).toThrow(/unknown variant w: v/);
      expect(() => applyVariants(dir, { v: { files: { "a.txt": [["three", "3"]] } } }, ["v"])).toThrow(/text not found in a.txt: three/);
      // a working copy with CRLF line endings is read as the repository holds it
      writeFileSync(path.join(dir, "c.txt"), "line one\r\nline two\r\n");
      applyVariants(dir, { v: { files: { "c.txt": [["one\nline two", "1\nline 2"]] } } }, ["v"]);
      expect(readFileSync(path.join(dir, "c.txt"), "utf8")).toBe("line 1\nline 2\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("apply to the Travel fixture as they are written", () => {
    const definitions = JSON.parse(readFileSync(path.join(ROOT, "fixtures", "variants.json"), "utf8"));
    const dir = mkdtempSync(path.join(tmpdir(), "variants-"));
    try {
      mkdirSync(path.join(dir, "src"));
      for (const file of readdirSync(path.join(ROOT, "fixtures", "travel", "src"))) {
        writeFileSync(path.join(dir, "src", file), readFileSync(path.join(ROOT, "fixtures", "travel", "src", file)));
      }
      applyVariants(path.join(dir, "src"), definitions, ["draft", "trial"]);
      expect(readFileSync(path.join(dir, "src", "zrt_r_travel.bdef.asbdef"), "utf8")).toContain("draft table zrt_d_travel");
      const bdef = readFileSync(path.join(dir, "src", "zrt_r_travel.bdef.asbdef"), "utf8");
      // total etag is an addition of lock master (BDEF031, refused by SAP otherwise, D85)
      expect(bdef).toContain("lock master total etag LastChangedAt\n");
      expect(bdef).toContain("validation Booking~validateMandatory;");
      // the side effects and the value help the scenarios of Fiori elements play (D86)
      expect(bdef).toContain("field BookingFee affects field TotalPrice;");
      expect(readFileSync(path.join(dir, "src", "zrt_c_travel.bdef.asbdef"), "utf8")).toContain("use draft;\nuse side effects;");
      expect(readFileSync(path.join(dir, "src", "zrt_c_travel.ddls.asddls"), "utf8")).toContain("@Consumption.valueHelpDefinition: [{ entity: { name: 'I_Currency', element: 'Currency' } }]\n      CurrencyCode,");
      const pool = readFileSync(path.join(dir, "src", "zbp_rt_r_travel.clas.locals_imp.abap"), "utf8");
      expect(pool).not.toContain("AUTHORITY-CHECK");
      // ABAP for Cloud Development only reads sy-subrc (D85)
      expect(pool).not.toMatch(/^\s*sy-subrc\s*=/im);
      expect(pool).not.toContain("%assoc-_Booking");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("repository for the SAP BTP trial (D99)", () => {
  it("writes the draft fixture renamed, with its draft tables and without authorization, and the steps", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "roundtrip-"));
    const out = path.join(parent, "trial");
    try {
      const output = execFileSync("node", ["scripts/btp-roundtrip.mjs", "--suffix", "xyz", "--out", out], { cwd: ROOT, encoding: "utf8" });
      expect(output).toContain("objects renamed with XYZ");
      const files = readdirSync(path.join(out, "src"));
      expect(files).toEqual(expect.arrayContaining(["zrt_d_travelxyz.tabl.xml", "zrt_d_bookingxyz.tabl.xml", "zrt_c_travelxyz.bdef.asbdef"]));
      expect(files.some((f) => f.endsWith(".suso.xml"))).toBe(false);
      // the draft table: client first, the elements of the CDS entity, the admin include
      const draft = readFileSync(path.join(out, "src", "zrt_d_travelxyz.tabl.xml"), "utf8");
      const fields = [...draft.matchAll(/<FIELDNAME>([^<]+)<\/FIELDNAME>/g)].map((m) => m[1]);
      expect(fields[0]).toBe("CLIENT");
      expect(fields).toEqual(expect.arrayContaining(["TRAVELUUID", "TRAVELID", "BOOKINGFEE", "CURRENCYCODE", "LOCALLASTCHANGEDAT", ".INCLUDE"]));
      expect(draft).toContain("<REFTABLE>ZRT_D_TRAVELXYZ</REFTABLE>");
      expect(draft).toMatch(/<PRECFIELD>SYCH_BDL_DRAFT_ADMIN_INC<\/PRECFIELD>\s*<GROUPNAME>%ADMIN<\/GROUPNAME>/);
      expect(readFileSync(path.join(out, "src", "zrt_r_travelxyz.bdef.asbdef"), "utf8")).toContain("draft table zrt_d_travelxyz");
      expect(readFileSync(path.join(out, "src", "zbp_rt_r_travelxyz.clas.locals_imp.abap"), "utf8")).not.toContain("AUTHORITY-CHECK");
      const expected = JSON.parse(readFileSync(path.join(out, "expected.json"), "utf8"));
      expect(expected).toMatchObject({ variants: ["draft", "trial"], suffix: "XYZ", service: { binding: "ZRT_UI_TRAVEL_O4XYZ", path: "/sap/opu/odata4/sap/zrt_ui_travel_o4xyz/srvd/sap/zrt_ui_travelxyz/0001/" } });
      expect(expected.fixture).toBe("fixtures/travel");
      const readme = readFileSync(path.join(out, "README.md"), "utf8");
      expect(readme).toContain("ZRT_UI_TRAVEL_O4XYZ");
      expect(readme).toContain("--out <this folder>/results/cases");
      // a folder that exists is not overwritten
      expect(() => execFileSync("node", ["scripts/btp-roundtrip.mjs", "--suffix", "xyz", "--out", out], { cwd: ROOT, stdio: "pipe" })).toThrow(/exists/);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("describes the steps on the trial", () => {
    const text = roundTripReadme({ fixture: "fixtures/travel", variants: [], suffix: "A1", expect: "x", objects: [{ from: "ZA", to: "ZAA1", types: ["TABL"] }] });
    expect(text).toContain("- ZA → ZAA1 (TABL)");
    expect(text).toContain("variants none");
    expect(text).not.toContain("is cut before the suffix");
    expect(roundTripReadme({ fixture: "f", variants: [], suffix: "CRG1", expect: "x", objects: [{ from: "ZRT_D_BOOKING", to: "ZRT_D_BOOKINCRG1", types: ["TABL"] }] })).toContain("is cut before the suffix");
  });
});
