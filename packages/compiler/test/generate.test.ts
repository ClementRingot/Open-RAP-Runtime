/** rapt generate (D46): objects with the names abapGit expects, derived from the existing ones. */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { aliasOf, elementName, generateObject, poolName } from "../src/authoring/generate.js";
import { generateApplication } from "../src/build.js";
import { loadProject } from "../src/input/project.js";

const dir = mkdtempSync(path.join(tmpdir(), "rapt-generate-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ok = (kind: string, name: string, options: Parameters<typeof generateObject>[3] = {}): string[] => {
  const result = generateObject(dir, kind, name, options);
  expect(result.error).toBeUndefined();
  return result.written;
};
const source = (file: string): string => readFileSync(path.join(dir, "src", file), "utf8");
const change = (file: string, edit: (content: string) => string): void => writeFileSync(path.join(dir, "src", file), edit(source(file)));

describe("rapt generate", () => {
  it("names the elements and objects as RAP does", () => {
    expect(elementName("travel_uuid")).toBe("TravelUUID");
    expect(elementName("agency_id")).toBe("AgencyID");
    expect(aliasOf("ZRT_C_Booking")).toBe("Booking");
    expect(poolName("ZR_TRAVEL")).toBe("ZBP_R_TRAVEL");
  });

  it("builds a whole business object, step by step, as in the ABAP Development Tools", async () => {
    expect(ok("table", "zshop_order")).toEqual(expect.arrayContaining(["src/zshop_order.tabl.astabl", "src/zshop_order.tabl.xml", ".abapgit.xml"]));
    ok("table", "zshop_item");
    change("zshop_item.tabl.astabl", (c) => c.replace("  description ", "  parent_uuid           : sysuuid_x16;\n  description "));
    ok("view", "ZR_ShopOrder", { from: "zshop_order", root: true });
    ok("view", "ZR_ShopItem", { from: "zshop_item" });
    expect(source("zr_shoporder.ddls.asddls")).toContain("@Semantics.systemDateTime.localInstanceLastChangedAt: true\n      local_last_changed_at as LocalLastChangedAt");
    // the composition is written by hand, then everything else derives from the views
    change("zr_shoporder.ddls.asddls", (c) => c.replace("  as select from zshop_order\n{", "  as select from zshop_order\n  composition [0..*] of ZR_ShopItem as _Item\n{").replace("as LocalLastChangedAt\n}", "as LocalLastChangedAt,\n      _Item\n}"));
    change("zr_shopitem.ddls.asddls", (c) => c.replace("  as select from zshop_item\n{", "  as select from zshop_item\n  association to parent ZR_ShopOrder as _Order on $projection.ParentUUID = _Order.UUID\n{").replace("as LocalLastChangedAt\n}", "as LocalLastChangedAt,\n      _Order\n}"));
    ok("behavior", "ZR_ShopOrder");
    expect(source("zr_shoporder.bdef.asbdef")).toContain("lock dependent by _Order");
    expect(ok("pool", "ZBP_R_SHOPORDER")).toEqual(expect.arrayContaining(["src/zbp_r_shoporder.clas.abap", "src/zbp_r_shoporder.clas.locals_imp.abap"]));
    ok("projection", "ZC_ShopOrder", { from: "ZR_ShopOrder" });
    ok("projection", "ZC_ShopItem", { from: "ZR_ShopItem" });
    expect(source("zc_shoporder.ddls.asddls")).toContain("_Item : redirected to composition child ZC_ShopItem");
    ok("metadata", "ZC_ShopOrder");
    ok("behavior", "ZC_ShopOrder");
    ok("access", "ZC_ShopOrder");
    ok("service", "ZUI_SHOPORDER", { expose: ["ZC_ShopOrder", "ZC_ShopItem"] });
    ok("binding", "ZUI_SHOPORDER_O4", { for: "ZUI_SHOPORDER" });
    const result = await generateApplication(loadProject(dir), { scaffold: false });
    expect(result.diagnostics.sorted().filter((d) => d.severity !== "info")).toEqual([]);
    expect(result.model?.service.entitySets.map((s) => s.name)).toEqual(["ShopOrder", "ShopItem"]);
  }, 120_000);

  it("never overwrites, and explains what is missing", () => {
    expect(generateObject(dir, "table", "zshop_order").error).toContain("already present");
    expect(generateObject(dir, "view", "ZR_X").error).toContain("--from");
    expect(generateObject(dir, "projection", "ZC_X", { from: "ZR_Nowhere" }).error).toContain("no CDS entity");
    expect(generateObject(dir, "widget", "ZX").error).toContain("unknown kind");
    expect(generateObject(dir, "table", "zthis_name_is_too_long").error).toContain("16");
  });
});
