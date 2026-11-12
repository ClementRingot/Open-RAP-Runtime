/**
 * The MCP tools of the service (decision D47): for each entity set, list, get, create, update and
 * delete, and each action and function, as RAP exposes them in OData. Their descriptions come from
 * the UI and CDS labels, unless `rapt/mcp.json` gives one (it may also turn a tool off). `rapt mcp`
 * writes that file with every tool, for the developer to explain each one.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildODataService,
  findEntity,
  getAnnotation,
  type EdmType,
  type JsonSchema,
  type McpToolModel,
  type McpToolsModel,
  type Model,
  type ODataEntityType,
  type ODataService,
} from "@open-rap-runtime/model";
import type { Diagnostics } from "../diagnostics.js";
import type { Project } from "../input/project.js";

export const MCP_FILE = "rapt/mcp.json";

/** `rapt/mcp.json`: the server and, per tool, a description (or false: the tool is not offered). */
export interface McpConfig {
  server?: { name?: string; instructions?: string };
  tools?: Record<string, string | false>;
}

export function loadMcpConfig(project: Project, diagnostics: Diagnostics): McpConfig | undefined {
  const file = path.join(project.root, MCP_FILE);
  if (!existsSync(file)) {
    return undefined;
  }
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      throw new Error("expected an object { server, tools }");
    }
    return json as McpConfig;
  } catch (error) {
    diagnostics.error("MCP001", `${MCP_FILE}: ${(error as Error).message}`, { file: MCP_FILE, line: 1 });
    return undefined;
  }
}

function schemaOf(edm: EdmType, description?: string): JsonSchema {
  const withDescription = (s: JsonSchema): JsonSchema => (description === undefined ? s : { ...s, description });
  switch (edm.type) {
    case "Edm.Boolean":
      return withDescription({ type: "boolean" });
    case "Edm.Byte":
    case "Edm.Int16":
    case "Edm.Int32":
    case "Edm.Int64":
      return withDescription({ type: "integer" });
    case "Edm.Decimal":
    case "Edm.Double":
      return withDescription({ type: "number" });
    case "Edm.Date":
      return withDescription({ type: "string", format: "date" });
    case "Edm.DateTimeOffset":
      return withDescription({ type: "string", format: "date-time" });
    case "Edm.TimeOfDay":
      return withDescription({ type: "string", pattern: "^\\d{2}:\\d{2}:\\d{2}$" });
    case "Edm.Guid":
      return withDescription({ type: "string", format: "uuid" });
    default: {
      const s: JsonSchema = { type: "string" };
      if (edm.maxLength !== undefined) s.maxLength = edm.maxLength;
      if (edm.digitSequence === true) s.pattern = "^\\d*$";
      return withDescription(s);
    }
  }
}

class ToolBuilder {
  private readonly service: ODataService;
  public readonly tools: McpToolModel[] = [];

  public constructor(private readonly model: Model) {
    this.service = buildODataService(model);
  }

  private labelOf(type: ODataEntityType, property: string): string | undefined {
    const entity = findEntity(this.model, type.entity);
    const field = entity?.fields.find((f) => f.name === type.properties.find((p) => p.name === property)?.field);
    const label = getAnnotation(field?.annotations, "EndUserText.label");
    const quickInfo = getAnnotation(field?.annotations, "EndUserText.quickInfo");
    return typeof quickInfo === "string" ? quickInfo : typeof label === "string" ? label : undefined;
  }

  private names(type: ODataEntityType, set: string): { singular: string; plural: string } {
    const entity = findEntity(this.model, type.entity);
    const header = getAnnotation(entity?.annotations, "UI.headerInfo");
    const record = typeof header === "object" && header !== null && !Array.isArray(header) ? header : {};
    const singular = typeof record["typename"] === "string" ? record["typename"] : set;
    const plural = typeof record["typenameplural"] === "string" ? record["typenameplural"] : `${singular} entries`;
    return { singular, plural };
  }

  private keySchema(type: ODataEntityType): { properties: Record<string, JsonSchema>; required: string[] } {
    const properties: Record<string, JsonSchema> = {};
    for (const key of type.keys) {
      const property = type.properties.find((p) => p.name === key);
      if (property !== undefined) properties[key] = schemaOf(property.edm, this.labelOf(type, key));
    }
    return { properties, required: [...type.keys] };
  }

  private keys(type: ODataEntityType): Array<{ name: string; edm: string }> {
    return type.keys.map((k) => ({ name: k, edm: type.properties.find((p) => p.name === k)?.edm.type ?? "Edm.String" }));
  }

  /** Writable properties of a create (not computed) or an update (neither computed nor immutable). */
  private writable(type: ODataEntityType, update: boolean): { properties: Record<string, JsonSchema>; fields: Array<{ name: string; edm: string }>; required: string[] } {
    const properties: Record<string, JsonSchema> = {};
    const fields: Array<{ name: string; edm: string }> = [];
    const required: string[] = [];
    for (const p of type.properties) {
      if (p.computed || p.name.startsWith("__") || (update && (p.immutable || p.key))) continue;
      properties[p.name] = schemaOf(p.edm, this.labelOf(type, p.name));
      fields.push({ name: p.name, edm: p.edm.type });
      if (!update && p.mandatory) required.push(p.name);
    }
    return { properties, fields, required };
  }

  public build(): void {
    for (const set of this.service.entitySets) {
      const type = this.service.entityTypes.find((t) => t.name === set.entityType);
      if (type === undefined || set.draftAdministrativeData === true) continue;
      const { singular, plural } = this.names(type, set.name);
      const help = set.valueHelp === true ? " (value help)" : "";
      const filterable = type.properties.filter((p) => !p.name.startsWith("__")).map((p) => p.name).join(", ");
      this.tools.push({
        name: `${set.name}_list`,
        title: `List ${plural}${help}`,
        description: `Lists the ${plural}${help}. Properties: ${filterable}.`,
        inputSchema: {
          type: "object",
          properties: {
            filter: { type: "string", description: `OData $filter, e.g. ${type.properties.find((p) => !p.key && p.edm.type === "Edm.String")?.name ?? type.keys[0] ?? "Name"} eq 'X'` },
            ...(set.searchable ? { search: { type: "string", description: "Free text search" } } : {}),
            select: { type: "array", items: { type: "string" }, description: "Properties to return (all by default)" },
            orderby: { type: "string", description: "OData $orderby, e.g. Name desc" },
            top: { type: "integer", minimum: 1, maximum: 1000, description: "Maximum number of entries (default 50)" },
            skip: { type: "integer", minimum: 0, description: "Entries to skip (paging)" },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
        call: { kind: "list", set: set.name, keys: this.keys(type) },
      });
      const key = this.keySchema(type);
      this.tools.push({
        name: `${set.name}_get`,
        title: `Read a ${singular}`,
        description: `Reads one ${singular} by its key (${type.keys.join(", ")}).`,
        inputSchema: { type: "object", properties: key.properties, required: key.required, additionalProperties: false },
        annotations: { readOnlyHint: true },
        call: { kind: "get", set: set.name, keys: this.keys(type) },
      });
      if (set.insertable) {
        const w = this.writable(type, false);
        this.tools.push({
          name: `${set.name}_create`,
          title: `Create a ${singular}`,
          description: `Creates a ${singular}; the business object checks it (validations) and returns it, or its messages.`,
          inputSchema: { type: "object", properties: w.properties, required: w.required, additionalProperties: false },
          annotations: {},
          call: { kind: "create", set: set.name, keys: this.keys(type), fields: w.fields },
        });
      }
      if (set.updatable) {
        const w = this.writable(type, true);
        this.tools.push({
          name: `${set.name}_update`,
          title: `Change a ${singular}`,
          description: `Changes the given properties of a ${singular} (the others are kept).`,
          inputSchema: { type: "object", properties: { ...key.properties, ...w.properties }, required: key.required, additionalProperties: false },
          annotations: { idempotentHint: true },
          call: { kind: "update", set: set.name, keys: this.keys(type), fields: w.fields },
        });
      }
      if (set.deletable) {
        this.tools.push({
          name: `${set.name}_delete`,
          title: `Delete a ${singular}`,
          description: `Deletes a ${singular}${type.navigations.some((n) => n.kind === "composition") ? " and its compositions" : ""}.`,
          inputSchema: { type: "object", properties: key.properties, required: key.required, additionalProperties: false },
          annotations: { destructiveHint: true, idempotentHint: true },
          call: { kind: "delete", set: set.name, keys: this.keys(type) },
        });
      }
      for (const navigation of type.navigations.filter((n) => n.kind === "composition" && n.insertable)) {
        const child = this.service.entityTypes.find((t) => t.name === navigation.targetType);
        if (child === undefined) continue;
        const w = this.writable(child, false);
        const childNames = this.names(child, navigation.targetSet);
        this.tools.push({
          name: `${set.name}_create${navigation.name}`,
          title: `Create a ${childNames.singular} of a ${singular}`,
          description: `Creates a ${childNames.singular} under a ${singular} (composition ${navigation.name}).`,
          inputSchema: { type: "object", properties: { ...key.properties, ...w.properties }, required: [...key.required, ...w.required.filter((r) => !key.required.includes(r))], additionalProperties: false },
          annotations: {},
          call: { kind: "createChild", set: set.name, keys: this.keys(type), navigation: navigation.name, fields: w.fields },
        });
      }
      for (const operation of this.service.operations.filter((o) => o.boundType === type.name)) {
        const parameters: Record<string, JsonSchema> = {};
        for (const p of operation.parameters) parameters[p.name] = schemaOf(p.edm);
        const properties = operation.collectionBound ? parameters : { ...key.properties, ...parameters };
        const required = [...(operation.collectionBound ? [] : key.required), ...operation.parameters.filter((p) => !p.nullable).map((p) => p.name)];
        const isFunction = operation.kind === "function";
        this.tools.push({
          name: `${set.name}_${operation.name}`,
          title: `${operation.name} (${singular})`,
          description: `${isFunction ? "Function" : "Action"} ${operation.name} of ${operation.collectionBound ? `the ${plural}` : `a ${singular}`}${operation.factory ? " (creates a new instance)" : ""}.`,
          inputSchema: { type: "object", properties, required, additionalProperties: false },
          annotations: isFunction ? { readOnlyHint: true } : {},
          call: {
            kind: isFunction ? "function" : "action",
            set: set.name,
            keys: this.keys(type),
            operation: `${this.service.namespace}.${operation.name}`,
            collectionBound: operation.collectionBound,
            fields: operation.parameters.map((p) => ({ name: p.name, edm: p.edm.type })),
          },
        });
      }
    }
  }
}

/** Every tool of the service, with its default description. */
export function defaultMcpTools(model: Model): McpToolModel[] {
  const builder = new ToolBuilder(model);
  builder.build();
  return builder.tools;
}

/** The tools of the application: the defaults, with the descriptions and choices of rapt/mcp.json. */
export function buildMcpTools(model: Model, config: McpConfig, diagnostics: Diagnostics): McpToolsModel {
  const all = defaultMcpTools(model);
  const configured = config.tools ?? {};
  for (const name of Object.keys(configured)) {
    if (!all.some((t) => t.name === name)) {
      diagnostics.warning("MCP002", `${MCP_FILE}: no tool ${name} in the service (run rapt mcp to update the file)`, { file: MCP_FILE, line: 1 });
    }
  }
  const tools = all
    .filter((t) => configured[t.name] !== false)
    .map((t) => {
      const description = configured[t.name];
      return typeof description === "string" && description.trim() !== "" ? { ...t, description } : t;
    });
  const server: McpToolsModel["server"] = { name: config.server?.name ?? model.service.name.toLowerCase(), version: "1.0.0" };
  if (config.server?.instructions !== undefined) server.instructions = config.server.instructions;
  return { server, tools };
}
