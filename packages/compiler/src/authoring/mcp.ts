/**
 * `rapt mcp <src>` (decision D47): writes `rapt/mcp.json`, the tools the MCP server of the
 * application offers, each with a description to explain to an AI agent what it does and when to
 * use it. A description already written is kept; new tools get their default description; tools
 * the service no longer has are removed. `false` instead of a description turns a tool off.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultMcpTools, MCP_FILE, type McpConfig } from "../gen/mcp.js";
import { loadProject } from "../input/project.js";
import { buildModel, type BuildOptions } from "../ir/builder.js";

export interface McpFileResult {
  file: string;
  tools: number;
  added: string[];
  removed: string[];
  error?: string;
}

export function writeMcpFile(dir: string, options: BuildOptions = {}): McpFileResult {
  const root = path.resolve(dir);
  const file = path.join(root, MCP_FILE);
  const { model, diagnostics } = buildModel(loadProject(root), options);
  if (model === undefined || diagnostics.hasErrors()) {
    return { file: MCP_FILE, tools: 0, added: [], removed: [], error: `the sources have errors (rapt check): ${diagnostics.errors()[0]?.message ?? ""}` };
  }
  let current: McpConfig = {};
  if (existsSync(file)) {
    try {
      current = JSON.parse(readFileSync(file, "utf8")) as McpConfig;
    } catch (error) {
      return { file: MCP_FILE, tools: 0, added: [], removed: [], error: `${MCP_FILE} is not valid JSON: ${(error as Error).message}` };
    }
  }
  const tools = defaultMcpTools(model);
  const previous = current.tools ?? {};
  const next: Record<string, string | false> = {};
  const added: string[] = [];
  for (const tool of tools) {
    const kept = previous[tool.name];
    if (kept === undefined) {
      added.push(tool.name);
    }
    next[tool.name] = kept ?? tool.description;
  }
  const removed = Object.keys(previous).filter((name) => !(name in next));
  const config: McpConfig = {
    server: {
      name: current.server?.name ?? model.service.name.toLowerCase(),
      instructions:
        current.server?.instructions ??
        `Business objects of the service ${model.service.name}. Read with the _list and _get tools before changing data; the business object checks every change and returns its messages.`,
    },
    tools: next,
  };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return { file: MCP_FILE, tools: tools.length, added, removed };
}
