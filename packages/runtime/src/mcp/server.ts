/**
 * The MCP server of the application (decision D47): the Model Context Protocol over HTTP
 * ("Streamable HTTP" transport, JSON responses) at `/mcp`. Each tool is an OData request run by the
 * service itself, as the user of the MCP request: authorizations, access controls, feature
 * control, validations and messages are those of the OData service.
 *
 * Authentication: a bearer token (OIDC), or the development user with AUTH_MODE=none. Browser
 * sessions (cookies) are not accepted: a web page could otherwise call the tools in the user's name.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { McpToolModel, McpToolsModel } from "@rap-transpiler/model";
import { AuthenticationError, type Authenticator } from "../auth/auth.js";
import type { User } from "../auth/user.js";
import { withReader } from "../odata/access.js";
import type { ODataHandler, ODataRequest } from "../odata/handler.js";

export const MCP_PATH = "/mcp";

/** Versions of the protocol this server speaks, the newest first. */
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpOptions {
  tools: McpToolsModel;
  handler: ODataHandler;
  authenticator: Authenticator;
}

/** The literal of a key value in a key predicate or a function parameter. */
function literal(edm: string, value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  switch (edm) {
    case "Edm.String":
      return `'${String(value).replace(/'/g, "''")}'`;
    default:
      return String(value);
  }
}

function keyPredicate(tool: McpToolModel, args: Record<string, unknown>): string {
  const keys = tool.call.keys;
  const missing = keys.filter((k) => args[k.name] === undefined || args[k.name] === "");
  if (missing.length > 0) {
    throw new ToolInputError(`missing key ${missing.map((k) => k.name).join(", ")}`);
  }
  if (keys.length === 1 && keys[0] !== undefined) {
    return `(${literal(keys[0].edm, args[keys[0].name])})`;
  }
  return `(${keys.map((k) => `${k.name}=${literal(k.edm, args[k.name])}`).join(",")})`;
}

class ToolInputError extends Error {}

/** The fields of the arguments for the body of a create, an update or an action. */
function body(tool: McpToolModel, args: Record<string, unknown>): string {
  const result: Record<string, unknown> = {};
  for (const field of tool.call.fields ?? []) {
    if (args[field.name] !== undefined) {
      result[field.name] = args[field.name];
    }
  }
  return JSON.stringify(result);
}

/** The OData request of a tool call. */
export function odataRequest(tool: McpToolModel, args: Record<string, unknown>): ODataRequest {
  const set = tool.call.set;
  const json = { "content-type": "application/json", accept: "application/json", "if-match": "*" };
  switch (tool.call.kind) {
    case "list": {
      const query = new URLSearchParams();
      const top = typeof args["top"] === "number" ? Math.min(Math.max(1, Math.trunc(args["top"])), 1000) : 50;
      query.set("$top", String(top));
      query.set("$count", "true");
      if (typeof args["skip"] === "number" && args["skip"] > 0) query.set("$skip", String(Math.trunc(args["skip"])));
      if (typeof args["filter"] === "string" && args["filter"].trim() !== "") query.set("$filter", args["filter"]);
      if (typeof args["orderby"] === "string" && args["orderby"].trim() !== "") query.set("$orderby", args["orderby"]);
      if (typeof args["search"] === "string" && args["search"].trim() !== "") query.set("$search", args["search"]);
      if (Array.isArray(args["select"]) && args["select"].length > 0) query.set("$select", args["select"].map(String).join(","));
      return { method: "GET", path: set, query: query.toString().replace(/\+/g, "%20"), headers: { accept: "application/json" } };
    }
    case "get":
      return { method: "GET", path: `${set}${keyPredicate(tool, args)}`, query: "", headers: { accept: "application/json" } };
    case "create":
      return { method: "POST", path: set, query: "", headers: json, body: body(tool, args) };
    case "createChild":
      return { method: "POST", path: `${set}${keyPredicate(tool, args)}/${tool.call.navigation ?? ""}`, query: "", headers: json, body: body(tool, args) };
    case "update":
      return { method: "PATCH", path: `${set}${keyPredicate(tool, args)}`, query: "", headers: json, body: body(tool, args) };
    case "delete":
      return { method: "DELETE", path: `${set}${keyPredicate(tool, args)}`, query: "", headers: json };
    case "action": {
      const target = tool.call.collectionBound === true ? set : `${set}${keyPredicate(tool, args)}`;
      return { method: "POST", path: `${target}/${tool.call.operation ?? ""}`, query: "", headers: json, body: body(tool, args) };
    }
    case "function": {
      const target = tool.call.collectionBound === true ? set : `${set}${keyPredicate(tool, args)}`;
      const parameters = (tool.call.fields ?? []).filter((f) => args[f.name] !== undefined).map((f) => `${f.name}=${literal(f.edm, args[f.name])}`);
      return { method: "GET", path: `${target}/${tool.call.operation ?? ""}(${parameters.join(",")})`, query: "", headers: { accept: "application/json" } };
    }
  }
}

/** The text of an OData response for the agent: the JSON without the OData control information. */
function resultText(status: number, text: string | undefined): { text: string; error: boolean; structured?: unknown } {
  if (status === 204 || text === undefined || text === "") {
    return { text: status < 400 ? "Done." : `Failed (HTTP ${status}).`, error: status >= 400 };
  }
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    if (status >= 400) {
      const error = json["error"] as { message?: string; details?: Array<{ message?: string; target?: string }> } | undefined;
      const details = (error?.details ?? []).map((d) => `- ${d.message ?? ""}${d.target === undefined ? "" : ` (${d.target})`}`);
      return { text: [`Failed (HTTP ${status}): ${error?.message ?? text}`, ...details].join("\n"), error: true };
    }
    const clean = JSON.parse(JSON.stringify(json, (key, value: unknown) => (key.startsWith("@odata.") && key !== "@odata.count" ? undefined : key.startsWith("__") ? undefined : value))) as unknown;
    return { text: JSON.stringify(clean, null, 2), error: false, structured: clean };
  } catch {
    return { text, error: status >= 400 };
  }
}

export function registerMcp(app: FastifyInstance, options: McpOptions): void {
  const tools = new Map(options.tools.tools.map((t) => [t.name, t]));

  const user = async (request: FastifyRequest): Promise<User> => {
    const found = await options.authenticator.fromAuthorization(request.headers.authorization);
    if (found === undefined) {
      throw new AuthenticationError("a bearer token is required");
    }
    return found;
  };

  const call = async (who: User, params: Record<string, unknown>): Promise<unknown> => {
    const name = String(params["name"] ?? "");
    const tool = tools.get(name);
    if (tool === undefined) {
      throw new JsonRpcError(-32602, `unknown tool ${name}`);
    }
    const args = (typeof params["arguments"] === "object" && params["arguments"] !== null ? params["arguments"] : {}) as Record<string, unknown>;
    let request: ODataRequest;
    try {
      request = odataRequest(tool, args);
    } catch (error) {
      if (error instanceof ToolInputError) {
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
      throw error;
    }
    const response = await withReader(who, () => options.handler.handle(request, { user: who, ieee754: false, language: "en" }));
    const result = resultText(response.status, response.body);
    return {
      content: [{ type: "text", text: result.text }],
      ...(result.structured !== undefined && typeof result.structured === "object" && !Array.isArray(result.structured) ? { structuredContent: result.structured } : {}),
      isError: result.error,
    };
  };

  const dispatch = async (who: User, message: JsonRpcRequest): Promise<JsonRpcResponse | undefined> => {
    const id = message.id ?? null;
    try {
      let result: unknown;
      switch (message.method) {
        case "initialize": {
          const asked = typeof message.params?.["protocolVersion"] === "string" ? message.params["protocolVersion"] : undefined;
          result = {
            protocolVersion: asked !== undefined && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: options.tools.server.name, version: options.tools.server.version },
            ...(options.tools.server.instructions === undefined ? {} : { instructions: options.tools.server.instructions }),
          };
          break;
        }
        case "ping":
          result = {};
          break;
        case "tools/list":
          result = {
            tools: options.tools.tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, ...t.annotations } })),
          };
          break;
        case "tools/call":
          result = await call(who, message.params ?? {});
          break;
        default:
          if (message.method.startsWith("notifications/")) {
            return undefined;
          }
          throw new JsonRpcError(-32601, `method ${message.method} not found`);
      }
      return message.id === undefined ? undefined : { jsonrpc: "2.0", id, result };
    } catch (error) {
      const code = error instanceof JsonRpcError ? error.code : -32603;
      return message.id === undefined ? undefined : { jsonrpc: "2.0", id, error: { code, message: (error as Error).message } };
    }
  };

  app.post(MCP_PATH, async (request: FastifyRequest, reply: FastifyReply) => {
    let who: User;
    try {
      who = await user(request);
    } catch (error) {
      const status = error instanceof AuthenticationError ? error.status : 401;
      return reply.status(status).header("WWW-Authenticate", 'Bearer realm="rap-transpiler"').send({ jsonrpc: "2.0", id: null, error: { code: -32001, message: (error as Error).message } });
    }
    let payload: unknown;
    try {
      payload = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    } catch {
      return reply.status(400).send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    }
    const messages = (Array.isArray(payload) ? payload : [payload]) as JsonRpcRequest[];
    if (messages.some((m) => typeof m !== "object" || m === null || typeof m.method !== "string")) {
      return reply.status(400).send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } });
    }
    const responses = (await Promise.all(messages.map((m) => dispatch(who, m)))).filter((r): r is JsonRpcResponse => r !== undefined);
    if (responses.length === 0) {
      return reply.status(202).send();
    }
    return reply.header("Content-Type", "application/json").send(JSON.stringify(Array.isArray(payload) ? responses : responses[0]));
  });

  // no server-sent events: the responses come in the body of the POST
  app.get(MCP_PATH, async (_request, reply) => reply.status(405).header("Allow", "POST").send());
  app.delete(MCP_PATH, async (_request, reply) => reply.status(405).header("Allow", "POST").send());
}

class JsonRpcError extends Error {
  public constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
