/** The Fastify application of a generated service. */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import type { McpToolsModel, Model } from "@rap-transpiler/model";
import { registerMcp } from "./mcp/server.js";
import { AuthenticationError, Authenticator, type AuthOptions } from "./auth/auth.js";
import { OidcSessions } from "./auth/session.js";
import type { User } from "./auth/user.js";
import type { Database } from "./db/database.js";
import { Authorizations } from "./auth/authorizations.js";
import { AccessControls, withReader } from "./odata/access.js";
import { CsrfTokens } from "./odata/csrf.js";
import { errorResponse, isIeee754, ODataHandler, type HandlerContext, type ODataRequest, type ODataResponse, type WriteHandler } from "./odata/handler.js";
import { CustomQueries } from "./odata/custom.js";
import { ReadEngine } from "./odata/read.js";
import { ServiceRuntime } from "./odata/service.js";
import { ODataError } from "./odata/errors.js";
import { RapWriteHandler } from "./odata/write.js";
import type { RapRuntime } from "./rap/runtime.js";
import { registerUi, type UiOptions } from "./ui/plugin.js";
import { UiVariants, VariantError } from "./ui/variants.js";
import { BUSINESS_USER_TABLE, BusinessUsers } from "./auth/business-users.js";
import type { Kysely } from "kysely";

export interface AppOptions {
  model: Model;
  /** The generated $metadata document. */
  metadata: string;
  db: Database;
  auth?: AuthOptions;
  /** Secret of the CSRF tokens (default: random per process). */
  csrfSecret?: string;
  logger?: FastifyServerOptions["logger"];
  /** Factory of the write handler, given the service and the reads (default: the managed RAP runtime of `rap`). */
  writes?: (service: ServiceRuntime, read: ReadEngine, db: Database) => WriteHandler;
  /** The managed RAP runtime (transpiled behavior pools): writes, actions and feature control. */
  rap?: RapRuntime;
  /** The authorizations of the users (D34); default: those of the RAP runtime, or of the model. */
  authorizations?: Authorizations;
  /** The generated UI (`ui/` folder) and the OpenUI5 resources. */
  ui?: UiOptions;
  /** The MCP tools of the service (D47), served at /mcp. */
  mcp?: McpToolsModel;
  /** Extra plugins (UI, login routes), registered after the service. */
  extend?: (app: FastifyInstance, services: AppServices) => Promise<void> | void;
}

export interface AppServices {
  service: ServiceRuntime;
  handler: ODataHandler;
  authenticator: Authenticator;
  csrf: CsrfTokens;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
  }
}

/** Fastify keeps headers lower case; multi-valued ones are joined. */
function headersOf(request: FastifyRequest): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

function send(reply: FastifyReply, response: ODataResponse): FastifyReply {
  reply.status(response.status);
  for (const [name, value] of Object.entries(response.headers)) {
    reply.header(name, value);
  }
  // a Buffer keeps the Content-Type as written (Fastify rewrites JSON media types of strings)
  return reply.send(Buffer.from(response.body ?? "", "utf8"));
}

export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 20 * 1024 * 1024, return503OnClosing: true });
  const service = new ServiceRuntime(options.model);
  const authorizations = options.authorizations ?? options.rap?.authorizations ?? new Authorizations(options.model.authorizations);
  // the access controls (DCL) of the reads, for the user of each request (D35)
  const read = new ReadEngine(service, () => options.db, new AccessControls(options.model.accessControls, authorizations));
  if (options.rap !== undefined && options.model.entities.some((e) => e.kind === "custom")) {
    read.queries = new CustomQueries(service, () => options.db, options.rap);
  }
  const writes = options.writes?.(service, read, options.db) ?? (options.rap === undefined ? undefined : new RapWriteHandler(service, read, options.db as unknown as Kysely<unknown>, options.rap));
  const handler = new ODataHandler(service, read, options.metadata, writes);
  const servicePath = options.model.service.path;
  handler.setServicePath(servicePath);
  const authenticator = new Authenticator(options.auth ?? { mode: "none" });
  const csrf = new CsrfTokens(options.csrfSecret);
  const auth = options.auth;
  const variants = new UiVariants(() => options.db);
  // I_BusinessUserBasic (D44): the users who used the application
  const businessUsers = options.model.tables.some((t) => t.name === BUSINESS_USER_TABLE) ? new BusinessUsers(() => options.db) : undefined;
  const sessions = auth?.mode === "oidc" && auth.session !== undefined ? new OidcSessions(authenticator, { ...auth, session: auth.session }) : undefined;

  // bodies are read as text: the OData layer parses JSON (decimals as strings) and multipart
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) => done(null, body));

  app.decorateRequest("user", undefined);

  app.addHook("onRequest", async (request, reply) => {
    if (sessions !== undefined && (request.url === "/" || request.url.startsWith("/ui")) && request.headers.authorization === undefined) {
      // the UI needs a session: log in first
      let user: User | undefined;
      try {
        user = sessions.user(request);
      } catch (error) {
        // a session without the role the application requires (opened by a launchpad, D37)
        return reply.status(error instanceof AuthenticationError ? error.status : 401).type("text/plain").send((error as Error).message);
      }
      if (user === undefined) {
        return reply.redirect(sessions.loginUrl(request.url === "/" ? "/ui/index.html" : request.url));
      }
      return;
    }
    if (!request.url.startsWith(servicePath.replace(/\/$/, ""))) {
      return;
    }
    try {
      const user = request.user ?? (request.headers.authorization === undefined ? sessions?.user(request) : undefined) ?? (await authenticator.fromAuthorization(request.headers.authorization));
      if (user === undefined) {
        throw new AuthenticationError("authentication required");
      }
      request.user = user;
      businessUsers?.record(user);
    } catch (error) {
      const status = error instanceof AuthenticationError ? error.status : 401;
      const odata = new ODataError(status, status === 403 ? "FORBIDDEN" : "UNAUTHORIZED", (error as Error).message, undefined, [], status === 401 ? { "WWW-Authenticate": 'Bearer realm="rap-transpiler"' } : {});
      await send(reply, errorResponse(odata, false));
    }
  });

  const serve = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const user = request.user as User;
    const headers = headersOf(request);
    const url = request.url;
    const relative = url.startsWith(servicePath) ? url.slice(servicePath.length) : url === servicePath.replace(/\/$/, "") ? "" : url.slice(servicePath.length - 1);
    const question = relative.indexOf("?");
    const odataRequest: ODataRequest = {
      method: request.method,
      path: question < 0 ? relative : relative.slice(0, question),
      query: question < 0 ? "" : relative.slice(question + 1),
      headers,
    };
    if (typeof request.body === "string") {
      odataRequest.body = request.body;
    }
    const ieee754 = isIeee754(headers);
    const extra: Record<string, string> = {};
    if ((headers["x-csrf-token"] ?? "").toLowerCase() === "fetch") {
      extra["X-CSRF-Token"] = csrf.token(user, user.session);
    }
    if (csrf.required(user, request.method) && !csrf.valid(user, headers["x-csrf-token"], user.session)) {
      const failure = errorResponse(new ODataError(403, "CSRF_TOKEN_REQUIRED", "CSRF token validation failed", undefined, [], { "X-CSRF-Token": "Required" }), ieee754);
      return send(reply, failure);
    }
    const ctx: HandlerContext = { user, ieee754, language: (headers["accept-language"] ?? "en").split(",")[0]?.trim() ?? "en" };
    if (request.method === "HEAD") {
      return send(reply, { status: 200, headers: { "OData-Version": "4.0", ...extra } });
    }
    if (odataRequest.path === "$permissions" && request.method === "GET") {
      // the operations of the entity sets the user may perform (creation), for the UI (D36)
      const permissions = writes instanceof RapWriteHandler ? await withReader(user, () => writes.permissions(ctx)) : {};
      return send(reply, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra }, body: JSON.stringify(permissions) });
    }
    if (odataRequest.path === "$variants" && (request.method === "GET" || request.method === "PUT")) {
      // the views of the list reports of the user (filters, columns, sort order)
      const page = new URLSearchParams(odataRequest.query).get("page") ?? "";
      const json = { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra };
      if (page === "" || page.length > 200) {
        return send(reply, { status: 400, headers: json, body: JSON.stringify({ error: "the page parameter is required" }) });
      }
      try {
        if (request.method === "GET") {
          return send(reply, { status: 200, headers: json, body: JSON.stringify(await variants.read(user.id, page)) });
        }
        await variants.write(user.id, page, odataRequest.body ?? "");
        return send(reply, { status: 204, headers: extra });
      } catch (error) {
        if (error instanceof VariantError) {
          return send(reply, { status: 400, headers: json, body: JSON.stringify({ error: error.message }) });
        }
        throw error;
      }
    }
    const response = await withReader(user, () => handler.handle(odataRequest, ctx));
    response.headers = { ...response.headers, ...extra };
    return send(reply, response);
  };

  const root = servicePath.replace(/\/$/, "");
  app.route({ method: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"], url: root, handler: serve });
  app.route({ method: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"], url: `${root}/*`, handler: serve });

  app.get("/health", async () => ({ status: "ok" }));
  if (options.mcp !== undefined) {
    registerMcp(app, { tools: options.mcp, handler, authenticator });
  }
  sessions?.register(app);

  if (options.ui !== undefined) {
    await registerUi(app, options.ui);
  }

  await options.extend?.(app, { service, handler, authenticator, csrf });
  return app;
}
