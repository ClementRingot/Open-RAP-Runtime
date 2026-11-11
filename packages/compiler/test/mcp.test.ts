/** rapt mcp (D47): rapt/mcp.json written, merged, and the tools built into the application. */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeMcpFile } from "../src/authoring/mcp.js";
import { generateApplication } from "../src/build.js";
import { loadProject } from "../src/input/project.js";
import { fixtureVariant } from "./helpers.js";

describe("rapt mcp", () => {
  it("writes the tools to describe, keeps the descriptions, and builds them into the application", async () => {
    const variant = fixtureVariant({});
    try {
      const first = writeMcpFile(variant.dir);
      expect(first.error).toBeUndefined();
      expect(first.tools).toBe(13);
      const file = path.join(variant.dir, "rapt", "mcp.json");
      const config = JSON.parse(readFileSync(file, "utf8")) as { tools: Record<string, string | false> };
      expect(config.tools["Travel_list"]).toContain("Lists the Travels");
      config.tools["Travel_acceptTravel"] = "Accepts a travel.";
      config.tools["Booking_delete"] = false;
      config.tools["Old_tool"] = "gone";
      writeFileSync(file, JSON.stringify(config));
      const result = await generateApplication(loadProject(variant.dir), { scaffold: false, transpile: false });
      expect(result.diagnostics.sorted().map((d) => d.code)).toContain("MCP002");
      const tools = JSON.parse(result.files.find((f) => f.path === "mcp/tools.json")?.content ?? "{}") as { tools: Array<{ name: string; description: string }> };
      expect(tools.tools.find((x) => x.name === "Travel_acceptTravel")?.description).toBe("Accepts a travel.");
      expect(tools.tools.some((x) => x.name === "Booking_delete")).toBe(false);
      const second = writeMcpFile(variant.dir);
      expect(second).toMatchObject({ added: [], removed: ["Old_tool"] });
      const again = JSON.parse(readFileSync(file, "utf8")) as { tools: Record<string, string | false> };
      expect(again.tools["Travel_acceptTravel"]).toBe("Accepts a travel.");
      expect(again.tools["Booking_delete"]).toBe(false);
    } finally {
      variant.cleanup();
    }
  });

  it("serves no MCP without rapt/mcp.json", async () => {
    const variant = fixtureVariant({});
    try {
      const result = await generateApplication(loadProject(variant.dir), { scaffold: false, transpile: false });
      expect(result.files.some((f) => f.path === "mcp/tools.json")).toBe(false);
    } finally {
      variant.cleanup();
    }
  });
});
