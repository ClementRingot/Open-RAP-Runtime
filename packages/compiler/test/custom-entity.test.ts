/** Custom entities (D43): the model, the query class, the Open RAP Runtime-only managed BO. */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/custom-entity", import.meta.url));

function variant(changes: Record<string, (content: string) => string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "rapt-custom-"));
  cpSync(FIXTURE, dir, { recursive: true, filter: (source) => !source.includes(`${path.sep}.rapt`) });
  for (const [file, change] of Object.entries(changes)) {
    const target = path.join(dir, "src", file);
    writeFileSync(target, change(readFileSync(target, "utf8")));
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("custom entities", () => {
  it("enter the model with their query class and associations, without SQL view", () => {
    const { model, diagnostics } = buildModel(loadProject(FIXTURE));
    expect(diagnostics.items.map((d) => d.code)).toEqual(["BDEF027"]);
    const product = model?.entities.find((e) => e.name === "ZCE_Product");
    expect(product).toMatchObject({ kind: "custom", root: true, queryClass: "ZCL_PRODUCT_QUERY" });
    expect(product?.sqlView).toBeUndefined();
    expect(product?.fields.find((f) => f.name === "Currency")?.type).toEqual({ kind: "cuky", length: 5 });
    expect(product?.associations).toEqual([expect.objectContaining({ name: "_Reviews", target: "ZCE_Review", kind: "association", on: [{ source: "ProductID", target: "ProductID" }] })]);
    expect(model?.behaviors[0]?.saving?.kind).toBe("unmanaged");
  });

  it("need a query class", () => {
    const v = variant({
      "zce_review.ddls.asddls": (c) => c.replace("@ObjectModel.query.implementedBy: 'ABAP:ZCL_REVIEW_QUERY'\n", ""),
      "zce_product.ddls.asddls": (c) => c.replace("ABAP:ZCL_PRODUCT_QUERY", "ABAP:ZCL_MISSING"),
    });
    try {
      const codes = buildModel(loadProject(v.dir)).diagnostics.items.filter((d) => d.severity === "error").map((d) => d.code);
      expect(codes).toEqual(expect.arrayContaining(["CDS016", "CDS017"]));
    } finally {
      v.cleanup();
    }
  });

  it("carry a managed BO only with unmanaged save", () => {
    const v = variant({ "zce_product.bdef.asbdef": (c) => c.replace("managed with unmanaged save implementation", "managed implementation") });
    try {
      const codes = buildModel(loadProject(v.dir)).diagnostics.items.map((d) => d.code);
      expect(codes).toContain("BDEF013");
      expect(codes).not.toContain("BDEF027");
    } finally {
      v.cleanup();
    }
  });
});
