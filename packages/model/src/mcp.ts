/**
 * The MCP server of a generated application (decision D47): the tools the OData service offers to
 * an AI agent (Model Context Protocol), each one an OData request. Built by the compiler from the
 * service and the descriptions of `rapt/mcp.json`, written as `mcp/tools.json`, served at `/mcp`.
 */

export interface McpToolsModel {
  server: { name: string; version: string; instructions?: string };
  tools: McpToolModel[];
}

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  format?: string;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  additionalProperties?: boolean;
  pattern?: string;
};

export type McpCallKind = "list" | "get" | "create" | "createChild" | "update" | "delete" | "action" | "function";

export interface McpToolModel {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  call: {
    kind: McpCallKind;
    /** Entity set of the request. */
    set: string;
    /** Key properties and their EDM types (key predicate). */
    keys: Array<{ name: string; edm: string }>;
    /** Composition navigation (createChild). */
    navigation?: string;
    /** Qualified action or function name. */
    operation?: string;
    /** Collection-bound (static) action or function. */
    collectionBound?: boolean;
    /** Parameters of an action or function, or properties of a create or update. */
    fields?: Array<{ name: string; edm: string }>;
  };
}
