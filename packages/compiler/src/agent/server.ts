/**
 * `rapt agent` (decision D64): an MCP server for the AI coding agents that write RAP sources with
 * rapt (GitHub Copilot, Claude Code, Cursor…). It speaks the Model Context Protocol over stdio
 * (newline-delimited JSON-RPC) and offers what an agent needs and cannot easily find alone:
 * the diagnostics of the project, the catalog of the object types and their creation, the
 * floorplans, the abapGit files, and the documentation of Open RAP Runtime (which is not in the
 * project of the user). The VS Code extension registers it, so that the agent mode of VS Code
 * finds it without configuration; other clients start `rapt agent <workspace>`.
 *
 * Not to be confused with `rapt mcp` (D47), which writes the MCP tools of a *service*: the
 * application then serves them to agents that use the business object.
 *
 * Every path is relative to the workspace given on start; paths outside it are refused.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { generateAbapGitFiles } from "../authoring/abapgit.js";
import { FLOORPLAN_CATALOG, OBJECT_CATALOG } from "../authoring/catalog.js";
import { floorplans } from "../authoring/floorplan.js";
import { generateObject } from "../authoring/generate.js";
import { newBusinessObject } from "../authoring/new.js";
import { generateApplication } from "../build.js";
import { countDiagnostics } from "../diagnostics.js";
import { documentationSources } from "../gen/docs/index.js";
import { headingId } from "../gen/docs/markdown.js";
import { loadProject } from "../input/project.js";
import { registerApp } from "../launchpad/workspace.js";
import { COMPILER_VERSION } from "../version.js";

/** Versions of the protocol this server speaks, the newest first. */
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `rapt compiles RAP business objects (ABAP RESTful Application Programming Model sources in abapGit format: tables, CDS views, metadata extensions, behavior definitions, ABAP behavior pools, service definitions and bindings) into a Node.js application, without an SAP system.
- Write the sources as in ADT; prefer rapt_generate (or rapt_new_business_object) to create objects: file names and abapGit XML are then right.
- After each change, run rapt_check until there are no errors; each diagnostic has a code explained by rapt_docs_read({ page: "diagnostics" }).
- Stay in standard mode (as on SAP) unless the user asks for the enhanced extensions.
- Read the documentation with rapt_docs_search and rapt_docs_read (guide, features, annotations, known gaps with their workarounds) before guessing.
- Never edit .rapt/ (generated). To run the application, the user starts rapt dev (or the "RAP: Start rapt dev" command in VS Code).`;

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  run: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

class ToolError extends Error {}

const PROJECT = { type: "string", description: "The folder of the RAP project (the one with .abapgit.xml), relative to the workspace. Default: the only project of the workspace." };

/** Folders that contain a RAP project, under the workspace (not in node_modules, .rapt, hidden folders). */
function findProjects(root: string, depth = 4): string[] {
  const found: string[] = [];
  const visit = (dir: string, level: number): void => {
    if (existsSync(path.join(dir, ".abapgit.xml")) || (existsSync(path.join(dir, "src")) && existsSync(path.join(dir, "rapt")))) {
      found.push(dir);
      return;
    }
    if (level >= depth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;
      const full = path.join(dir, entry);
      if (statSync(full, { throwIfNoEntry: false })?.isDirectory() === true) visit(full, level + 1);
    }
  };
  visit(root, 0);
  return found;
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** Splits a Markdown document into its sections (by heading), for the search and the reading. */
function sections(markdown: string): Array<{ heading: string; id: string; level: number; text: string }> {
  const result: Array<{ heading: string; id: string; level: number; text: string }> = [];
  let current = { heading: "", id: "", level: 1, lines: [] as string[] };
  let code = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) code = !code;
    const heading = code ? null : /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading !== null) {
      result.push({ heading: current.heading, id: current.id, level: current.level, text: current.lines.join("\n").trim() });
      const title = (heading[2] ?? "").replace(/`/g, "");
      current = { heading: title, id: headingId(heading[2] ?? ""), level: heading[1]?.length ?? 1, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  result.push({ heading: current.heading, id: current.id, level: current.level, text: current.lines.join("\n").trim() });
  return result.filter((s) => s.text !== "");
}

export class AgentServer {
  private readonly tools: Tool[];

  public constructor(private readonly workspace: string) {
    this.workspace = path.resolve(workspace);
    this.tools = this.defineTools();
  }

  /** The project folder of a call: given (inside the workspace), or the only one of the workspace. */
  private project(args: Record<string, unknown>): string {
    const given = str(args, "project");
    if (given !== undefined) {
      const full = path.resolve(this.workspace, given);
      const relative = path.relative(this.workspace, full);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new ToolError(`${given}: outside the workspace ${this.workspace}`);
      }
      return full;
    }
    const projects = findProjects(this.workspace);
    if (projects.length === 1 && projects[0] !== undefined) return projects[0];
    if (projects.length === 0) throw new ToolError("no RAP project in the workspace: create one with rapt_new_business_object (project: a new folder)");
    throw new ToolError(`several RAP projects, give "project": ${projects.map((p) => path.relative(this.workspace, p) || ".").join(", ")}`);
  }

  private relative(full: string): string {
    return path.relative(this.workspace, full).split(path.sep).join("/") || ".";
  }

  private defineTools(): Tool[] {
    const docs = (): ReturnType<typeof documentationSources> => documentationSources();
    return [
      {
        name: "rapt_projects",
        title: "List the RAP projects",
        description: "Lists the RAP projects (abapGit folders) of the workspace.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        run: () => ({ workspace: this.workspace, projects: findProjects(this.workspace).map((p) => this.relative(p)) }),
      },
      {
        name: "rapt_check",
        title: "Check the project",
        description:
          "Compiles the RAP project (CDS, BDEF, behavior pool ABAP with abaplint, service) without writing anything and returns its diagnostics: file, line, column, severity, code, message. Run it after each change until there are no errors.",
        inputSchema: { type: "object", properties: { project: PROJECT, service: { type: "string", description: "Service definition, when the project has several." }, mode: { type: "string", enum: ["standard", "enhanced"] } } },
        annotations: { readOnlyHint: true },
        run: async (args) => {
          const root = this.project(args);
          const service = str(args, "service");
          const mode = str(args, "mode");
          const { diagnostics } = await generateApplication(loadProject(root), { scaffold: false, ...(service === undefined ? {} : { service }), ...(mode === undefined ? {} : { mode }) });
          const items = diagnostics.sorted().map((d) => ({ ...d, ...(d.file === undefined ? {} : { file: this.relative(path.join(root, ...d.file.split("/"))) }) }));
          return { project: this.relative(root), ok: !diagnostics.hasErrors(), counts: countDiagnostics(items), diagnostics: items };
        },
      },
      {
        name: "rapt_object_types",
        title: "List the object types",
        description: "The types of objects rapt_generate creates (table, view, projection, behavior definition, behavior pool, service…), with what each one is, what it derives from and its inputs; and the floorplans of the generated UI.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true },
        run: () => ({ objectTypes: OBJECT_CATALOG, floorplans: FLOORPLAN_CATALOG }),
      },
      {
        name: "rapt_generate",
        title: "Create an object",
        description:
          "Writes one new object of the project, derived from an existing one as the ADT wizards do, with its abapGit XML: e.g. kind view from a table, projection from a view, behavior from a root entity, pool for a BDEF, service exposing entities, binding for a service. See rapt_object_types for the kinds and their inputs. Never overwrites a file.",
        inputSchema: {
          type: "object",
          required: ["kind", "name"],
          properties: {
            project: PROJECT,
            kind: { type: "string", enum: OBJECT_CATALOG.filter((e) => e.kind !== "bo").map((e) => e.kind) },
            name: { type: "string", description: "Name of the new object (e.g. ZR_Order, ZBP_R_ORDER)." },
            description: { type: "string", description: "Label (EndUserText.label)." },
            from: { type: "string", description: "The object it derives from (view ← table, projection ← view, behavior/metadata/access ← entity, dataelement ← domain)." },
            for: { type: "string", description: "The BDEF of a pool, the service definition of a binding." },
            expose: { type: "array", items: { type: "string" }, description: "service: the exposed entities." },
            root: { type: "boolean", description: "view, tableentity: a root entity." },
            bindingType: { type: "string", enum: ["ui", "webapi"] },
            type: { type: "string", description: "dataelement, domain: the built-in type (abap.char(10))." },
          },
        },
        run: (args) => {
          const root = this.project(args);
          const kind = str(args, "kind");
          const name = str(args, "name");
          if (kind === undefined || name === undefined) throw new ToolError("kind and name are required");
          const expose = Array.isArray(args["expose"]) ? (args["expose"] as unknown[]).filter((e): e is string => typeof e === "string") : undefined;
          const options = Object.fromEntries(
            Object.entries({ from: str(args, "from"), for: str(args, "for"), bindingType: str(args, "bindingType"), type: str(args, "type"), description: str(args, "description") }).filter(([, v]) => v !== undefined),
          ) as Record<string, string>;
          const result = generateObject(root, kind, name, { ...options, ...(expose === undefined ? {} : { expose }), ...(args["root"] === true ? { root: true } : {}) });
          if (result.error !== undefined) throw new ToolError(result.error);
          return { project: this.relative(root), written: result.written, next: "rapt_check" };
        },
      },
      {
        name: "rapt_new_business_object",
        title: "Create a complete business object",
        description:
          "Writes a complete managed RAP business object, activatable on SAP: table, root view and projection, metadata extension (List Report and Object Page), behavior definitions, behavior pool, service definition and binding, initial data, abapGit XML. The project folder is created when it does not exist. Never overwrites a file.",
        inputSchema: {
          type: "object",
          required: ["entity"],
          properties: {
            project: { type: "string", description: "Folder of the project, relative to the workspace (created if needed). Default: the workspace." },
            entity: { type: "string", description: "Name of the root entity, e.g. Travel." },
            prefix: { type: "string", description: "Prefix of the object names (Z by default): ZRT gives zrt_travel, ZRT_R_Travel…" },
            description: { type: "string" },
            launchpad: { type: "boolean", description: "Add the application to the launchpad of the workspace (default true)." },
          },
        },
        run: (args) => {
          const given = str(args, "project");
          const root = given === undefined ? this.workspace : path.resolve(this.workspace, given);
          if (path.relative(this.workspace, root).startsWith("..")) throw new ToolError(`${given ?? ""}: outside the workspace`);
          const entity = str(args, "entity");
          if (entity === undefined) throw new ToolError("entity is required");
          const prefix = str(args, "prefix");
          const description = str(args, "description");
          const result = newBusinessObject(root, entity, { ...(prefix === undefined ? {} : { prefix }), ...(description === undefined ? {} : { description }) });
          if (result.error !== undefined) throw new ToolError(result.error);
          // as rapt new: the application joins the launchpad of the workspace (D69)
          const launchpad = args["launchpad"] === false ? undefined : registerApp(root);
          return { project: this.relative(root), written: result.written, ...(launchpad === undefined ? {} : { launchpad: { ...launchpad, file: this.relative(launchpad.file) } }), next: "rapt_check, then the user runs rapt dev" };
        },
      },
      {
        name: "rapt_floorplan",
        title: "Floorplan of the UI",
        description:
          "Without entitySet: the root entity sets of the service with their floorplan (chosen or default), and the floorplans with what each one needs. With entitySet and floorplan: sets the floorplan (listReport, worklist, analyticalListPage, formEntry) in rapt/config.json and adds the application to the launchpad of the workspace.",
        inputSchema: { type: "object", properties: { project: PROJECT, entitySet: { type: "string" }, floorplan: { type: "string", enum: FLOORPLAN_CATALOG.map((f) => f.floorplan) }, launchpad: { type: "boolean", description: "Setting a floorplan adds the application to the launchpad of the workspace (default true)." } } },
        run: (args) => {
          const result = floorplans(this.project(args), str(args, "entitySet"), str(args, "floorplan"));
          if (!result.ok) throw new ToolError(result.error);
          // as rapt floorplan: the application is created once its floorplan is chosen (D69)
          const launchpad = "file" in result && args["launchpad"] !== false ? registerApp(result.root) : undefined;
          return { ...result, root: this.relative(result.root), ...(launchpad === undefined ? {} : { launchpad: { ...launchpad, file: this.relative(launchpad.file) } }) };
        },
      },
      {
        name: "rapt_abapgit",
        title: "Write the abapGit files",
        description: "Writes the abapGit XML files the sources lack (needed to import the project into an SAP system with abapGit); check: true only reports them.",
        inputSchema: { type: "object", properties: { project: PROJECT, check: { type: "boolean" } } },
        run: (args) => {
          const root = this.project(args);
          return { project: this.relative(root), ...generateAbapGitFiles(root, { check: args["check"] === true }) };
        },
      },
      {
        name: "rapt_docs_search",
        title: "Search the documentation",
        description: "Searches the documentation of Open RAP Runtime (guide, features, annotations, diagnostic codes, known gaps and workarounds, decisions…) and returns the best sections, to read with rapt_docs_read.",
        inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } } },
        annotations: { readOnlyHint: true },
        run: (args) => {
          const query = str(args, "query");
          if (query === undefined) throw new ToolError("query is required");
          const terms = query.toLowerCase().split(/[^\p{L}\p{N}_@.#-]+/u).filter((t) => t.length > 1);
          const limit = typeof args["limit"] === "number" ? Math.min(20, Math.max(1, Math.floor(args["limit"]))) : 8;
          const hits = docs().flatMap((page) =>
            sections(page.markdown).map((s) => {
              const text = s.text.toLowerCase();
              const heading = s.heading.toLowerCase();
              let score = 0;
              for (const term of terms) {
                const count = text.split(term).length - 1;
                if (count === 0) return { score: 0, page, s };
                score += Math.min(count, 10) + (heading.includes(term) ? 10 : 0);
              }
              return { score, page, s };
            }),
          );
          return {
            results: hits
              .filter((h) => h.score > 0)
              .sort((a, b) => b.score - a.score)
              .slice(0, limit)
              .map((h) => {
                const at = Math.max(0, h.s.text.toLowerCase().indexOf(terms[0] ?? "") - 80);
                return { page: h.page.id, title: h.page.title, section: h.s.heading, sectionId: h.s.id, excerpt: h.s.text.slice(at, at + 300).replace(/\s+/g, " ") };
              }),
          };
        },
      },
      {
        name: "rapt_docs_read",
        title: "Read the documentation",
        description: "Returns a page of the documentation of Open RAP Runtime as Markdown (or one of its sections). Without page: the list of the pages.",
        inputSchema: { type: "object", properties: { page: { type: "string", description: "e.g. guide, features, annotations, diagnostics, known_gaps, decisions, deployment, mcp." }, section: { type: "string", description: "A heading or section id of the page." } } },
        annotations: { readOnlyHint: true },
        run: (args) => {
          const pages = docs();
          const id = str(args, "page")?.toLowerCase().replace(/\.md$/, "");
          if (id === undefined) return { pages: pages.map((p) => ({ page: p.id, title: p.title })) };
          const page = pages.find((p) => p.id === id);
          if (page === undefined) throw new ToolError(`${id}: no such page (${pages.map((p) => p.id).join(", ")})`);
          const wanted = str(args, "section");
          if (wanted === undefined) return { page: page.id, title: page.title, markdown: page.markdown };
          const all = sections(page.markdown);
          const index = all.findIndex((s) => s.id === headingId(wanted) || s.id === wanted || s.heading.toLowerCase().includes(wanted.toLowerCase()));
          if (index < 0) throw new ToolError(`${wanted}: no such section of ${page.id}`);
          const start = all[index];
          // the section and its subsections
          const parts = [start];
          for (const s of all.slice(index + 1)) {
            if (start === undefined || s.level <= start.level) break;
            parts.push(s);
          }
          return { page: page.id, title: page.title, section: start?.heading, markdown: parts.map((p) => p?.text).join("\n\n") };
        },
      },
    ];
  }

  /** Handles one JSON-RPC message; undefined for a notification. */
  public async handle(message: { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }): Promise<Record<string, unknown> | undefined> {
    const id = message.id ?? null;
    const reply = (body: Record<string, unknown>): Record<string, unknown> | undefined => (message.id === undefined ? undefined : { jsonrpc: "2.0", id, ...body });
    switch (message.method) {
      case "initialize": {
        const asked = typeof message.params?.["protocolVersion"] === "string" ? message.params["protocolVersion"] : undefined;
        return reply({
          result: {
            protocolVersion: asked !== undefined && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "rapt", title: "open-rap-runtime", version: COMPILER_VERSION },
            instructions: INSTRUCTIONS,
          },
        });
      }
      case "ping":
        return reply({ result: {} });
      case "tools/list":
        return reply({ result: { tools: this.tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, ...(t.annotations ?? {}) } })) } });
      case "tools/call": {
        const name = message.params?.["name"];
        const tool = this.tools.find((t) => t.name === name);
        if (tool === undefined) return reply({ error: { code: -32602, message: `unknown tool ${String(name)}` } });
        const args = typeof message.params?.["arguments"] === "object" && message.params["arguments"] !== null ? (message.params["arguments"] as Record<string, unknown>) : {};
        try {
          const result = await tool.run(args);
          return reply({ result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false } });
        } catch (error) {
          return reply({ result: { content: [{ type: "text", text: (error as Error).message }], isError: true } });
        }
      }
      default:
        if (message.method?.startsWith("notifications/") === true) return undefined;
        return reply({ error: { code: -32601, message: `method ${String(message.method)} not found` } });
    }
  }
}

/**
 * Serves the agent over stdio until stdin closes. Anything else written to stdout (a log of a
 * library) would break the protocol: it goes to stderr.
 */
export async function serveAgent(workspace: string): Promise<number> {
  const server = new AgentServer(workspace);
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => (process.stderr.write as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest)) as typeof process.stdout.write;
  console.log = console.error;
  const send = (body: unknown): void => {
    write(`${JSON.stringify(body)}\n`);
  };
  let buffer = "";
  let queue = Promise.resolve();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (line === "") continue;
      // one message at a time, in order: the compiler is not reentrant on the same project
      queue = queue.then(async () => {
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
          return;
        }
        const messages = Array.isArray(message) ? message : [message];
        const replies = [];
        for (const m of messages) {
          const r = await server.handle(m as Parameters<AgentServer["handle"]>[0]);
          if (r !== undefined) replies.push(r);
        }
        if (replies.length > 0) send(Array.isArray(message) ? replies : replies[0]);
      });
    }
  });
  await new Promise<void>((resolve) => process.stdin.once("end", resolve));
  await queue;
  return 0;
}
