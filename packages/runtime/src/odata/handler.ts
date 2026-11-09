/**
 * Transport-independent OData request handling, shared by the HTTP routes and the parts of a
 * $batch. Reads are served here; writes and operations are delegated to a write handler
 * (the managed RAP runtime).
 */

import type { User } from "../auth/user.js";
import { parseBatch, serializeBatch, type BatchItem, type BatchRequestPart, type BatchResponseItem, type BatchResponsePart } from "./batch.js";
import { badRequest, methodNotAllowed, notFound, notImplemented, ODataError, type ODataMessage } from "./errors.js";
import { etagOf, JsonWriter, stringify } from "./json.js";
import type { ReadEngine } from "./read.js";
import type { Key, ServiceRuntime, TypeInfo } from "./service.js";
import type { QueryOptions, Segment } from "./uri/ast.js";
import { parseQueryOptions, parseQueryString, parseResourcePath } from "./uri/parser.js";

export interface ODataRequest {
  method: string;
  /** Path relative to the service root, without query. */
  path: string;
  query: string;
  headers: Record<string, string | undefined>;
  body?: string;
  contentId?: string;
}

export interface ODataResponse {
  status: number;
  headers: Record<string, string>;
  body?: string;
}

export interface HandlerContext {
  user: User;
  ieee754: boolean;
  language: string;
  /** Change set of a $batch: shared by its requests, saved at its end (managed runtime). */
  changeset?: unknown;
  /** Entities created in the change set, by Content-ID: their canonical URL. */
  contentIds?: Map<string, string>;
}

/** The parsed target of a request. */
export interface Target {
  segments: Segment[];
  options: QueryOptions;
}

export interface WriteHandler {
  /** Handles POST, PATCH, PUT, DELETE and operation calls. */
  handle(request: ODataRequest, target: Target, ctx: HandlerContext): Promise<ODataResponse>;
  /** Runs the requests of a change set in one LUW: all succeed or all fail. */
  changeset(run: (ctx: HandlerContext) => Promise<BatchResponsePart[]>, ctx: HandlerContext): Promise<BatchResponsePart[] | ODataResponse>;
  /** Instance feature control and other computed values for rows about to be returned. */
  enrich?(info: TypeInfo, rows: Array<Record<string, unknown>>, options: QueryOptions, ctx: HandlerContext): Promise<void>;
}

export const JSON_TYPE = (ieee754: boolean): string => `application/json;odata.metadata=minimal;IEEE754Compatible=${ieee754 ? "true" : "false"}`;

export function isIeee754(headers: Record<string, string | undefined>): boolean {
  return /IEEE754Compatible=true/i.test(`${headers["accept"] ?? ""} ${headers["content-type"] ?? ""}`);
}

export function jsonResponse(status: number, body: unknown, ieee754: boolean, extra: Record<string, string> = {}): ODataResponse {
  return {
    status,
    headers: { "Content-Type": JSON_TYPE(ieee754), "OData-Version": "4.0", ...extra },
    body: typeof body === "string" ? body : stringify(body as Parameters<typeof stringify>[0]),
  };
}

/** Receives the unexpected errors (not ODataError): the application logs them. */
let internalErrorListener: (error: unknown) => void = (error) => {
  if (process.env["RAPT_DEBUG"] !== undefined) {
    console.error(error);
  }
};

export function onInternalError(listener: (error: unknown) => void): void {
  internalErrorListener = listener;
}

export function errorResponse(error: unknown, ieee754: boolean): ODataResponse {
  if (!(error instanceof ODataError)) {
    internalErrorListener(error);
  }
  const odata = error instanceof ODataError ? error : new ODataError(500, "INTERNAL_ERROR", "Internal server error");
  return jsonResponse(odata.status, odata.toJSON(), ieee754, odata.headers);
}

/** Success, information and warning messages, for the `sap-messages` response header. */
export function sapMessagesHeader(messages: ODataMessage[]): Record<string, string> {
  if (messages.length === 0) {
    return {};
  }
  const numeric = { success: 1, info: 2, warning: 3, error: 4 } as const;
  return {
    "sap-messages": JSON.stringify(
      messages.map((m) => ({ code: m.code, message: m.message, ...(m.target === undefined ? {} : { target: m.target }), numericSeverity: numeric[m.severity], transition: true })),
    ),
  };
}

export class ODataHandler {
  public readonly json: JsonWriter;

  public constructor(
    private readonly service: ServiceRuntime,
    private readonly read: ReadEngine,
    private readonly metadata: string,
    private readonly writes?: WriteHandler,
  ) {
    this.json = new JsonWriter(service, read);
  }

  public parse(request: ODataRequest, ctx: HandlerContext): Target {
    let path = request.path;
    // $<Content-ID> references of a change set
    const reference = /^\$(\d+)(\/.*)?$/.exec(path);
    if (reference !== null) {
      const url = ctx.contentIds?.get(reference[1] as string);
      if (url === undefined) {
        throw badRequest(`Unknown Content-ID reference $${reference[1] as string}`);
      }
      path = `${url}${reference[2] ?? ""}`;
    }
    const segments = parseResourcePath(path, (name) => this.service.isEntitySet(name), this.service.namespace);
    const options = parseQueryOptions(parseQueryString(request.query));
    return { segments, options };
  }

  public async handle(request: ODataRequest, ctx: HandlerContext): Promise<ODataResponse> {
    try {
      const path = request.path.replace(/^\/+/, "");
      if (path === "" || path === "/") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          throw methodNotAllowed("The service document is read-only");
        }
        return this.serviceDocument(ctx);
      }
      if (path === "$metadata") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          throw methodNotAllowed("$metadata is read-only");
        }
        return { status: 200, headers: { "Content-Type": "application/xml", "OData-Version": "4.0" }, body: this.metadata };
      }
      if (path === "$batch") {
        if (request.method !== "POST") {
          throw methodNotAllowed("$batch requires POST");
        }
        return await this.batch(request, ctx);
      }
      const target = this.parse({ ...request, path }, ctx);
      if (request.method === "GET" || request.method === "HEAD") {
        const last = target.segments[target.segments.length - 1];
        if (last?.kind === "operation") {
          return await this.write(request, target, ctx);
        }
        return await this.get(target, ctx);
      }
      return await this.write(request, target, ctx);
    } catch (error) {
      return errorResponse(error, ctx.ieee754);
    }
  }

  private async write(request: ODataRequest, target: Target, ctx: HandlerContext): Promise<ODataResponse> {
    if (this.writes === undefined) {
      throw notImplemented(`${request.method} requests`);
    }
    return this.writes.handle(request, target, ctx);
  }

  private serviceDocument(ctx: HandlerContext): ODataResponse {
    return jsonResponse(
      200,
      { "@odata.context": "$metadata", value: this.service.odata.entitySets.map((s) => ({ name: s.name, kind: "EntitySet", url: s.name })) },
      ctx.ieee754,
    );
  }

  /** Resolves the segments of a read to an entity set, an optional key and a navigation scope. */
  private async resolve(segments: Segment[]): Promise<{ info: TypeInfo; key?: Key; scope: import("kysely").RawBuilder<unknown>[]; single: boolean; count: boolean }> {
    const [first, ...rest] = segments;
    if (first === undefined || first.kind !== "entitySet") {
      throw badRequest("The resource path must start with an entity set");
    }
    let info = this.service.set(first.name);
    let key: Key | undefined = first.key === undefined ? undefined : this.service.key(info, first.key);
    let scope: import("kysely").RawBuilder<unknown>[] = [];
    let single = key !== undefined;
    let count = false;
    for (const segment of rest) {
      if (segment.kind === "count") {
        if (single) {
          throw badRequest("$count applies to collections");
        }
        count = true;
        continue;
      }
      if (segment.kind !== "navigation") {
        throw notImplemented(`The resource path segment ${segment.kind}`);
      }
      if (!single || key === undefined) {
        throw badRequest(`${segment.name}: navigation needs a single entity`);
      }
      const navigation = await this.read.navigationScope(info, key, segment.name);
      if (navigation === undefined) {
        throw notFound(`${info.set.name}${this.service.keyPredicate(info, key)}`);
      }
      info = navigation.target;
      scope = navigation.scope;
      key = segment.key === undefined ? undefined : this.service.key(info, segment.key);
      single = !navigation.collection || key !== undefined;
      if (key !== undefined) {
        // the instance must be reached through the navigation: keep its scope
        scope = [...scope, ...this.read.keyConditions(info, key)];
      }
    }
    const result: { info: TypeInfo; key?: Key; scope: import("kysely").RawBuilder<unknown>[]; single: boolean; count: boolean } = { info, scope, single, count };
    if (key !== undefined) {
      result.key = key;
    }
    return result;
  }

  private async get(target: Target, ctx: HandlerContext): Promise<ODataResponse> {
    const { info, key, scope, single, count } = await this.resolve(target.segments);
    if (count) {
      const n = await this.read.count(info, target.options, scope);
      return { status: 200, headers: { "Content-Type": "text/plain", "OData-Version": "4.0" }, body: String(n) };
    }
    if (single) {
      const row =
        key !== undefined && scope.length === 0
          ? await this.read.readOne(info, key, target.options)
          : (await this.read.readCollection(info, { ...target.options, top: 1 }, scope, false)).rows[0];
      if (row === undefined) {
        throw notFound(`${info.set.name}${key === undefined ? "" : this.service.keyPredicate(info, key)}`);
      }
      await this.writes?.enrich?.(info, [row], target.options, ctx);
      const body = { "@odata.context": this.json.contextUrl(info, target.options, true), ...this.json.entity(info, row, target.options, ctx) };
      const etag = etagOf(info, row);
      return jsonResponse(200, body, ctx.ieee754, etag === undefined ? {} : { ETag: etag });
    }
    const result = await this.read.readCollection(info, target.options, scope);
    await this.writes?.enrich?.(info, result.rows, target.options, ctx);
    const body: Record<string, unknown> = { "@odata.context": this.json.contextUrl(info, target.options, false) };
    if (result.count !== undefined) {
      body["@odata.count"] = result.count;
    }
    body["value"] = result.rows.map((row) => this.json.entity(info, row, target.options, ctx));
    return jsonResponse(200, body, ctx.ieee754);
  }

  // -------------------------------------------------------------------------------------------
  // $batch

  public toRequest(part: BatchRequestPart, servicePath: string): ODataRequest {
    let url = part.url;
    if (/^https?:\/\//i.test(url)) {
      const parsed = new URL(url);
      url = `${parsed.pathname}${parsed.search}`;
    }
    if (url.startsWith(servicePath)) {
      url = url.slice(servicePath.length);
    } else if (url.startsWith("/")) {
      const trimmed = servicePath.replace(/\/$/, "");
      url = url.startsWith(trimmed) ? url.slice(trimmed.length) : url;
    }
    const question = url.indexOf("?");
    const request: ODataRequest = {
      method: part.method,
      path: (question < 0 ? url : url.slice(0, question)).replace(/^\/+/, ""),
      query: question < 0 ? "" : url.slice(question + 1),
      headers: part.headers,
      body: part.body,
    };
    if (part.contentId !== undefined) {
      request.contentId = part.contentId;
    }
    return request;
  }

  private servicePath = "/";

  public setServicePath(path: string): void {
    this.servicePath = path;
  }

  private async batch(request: ODataRequest, ctx: HandlerContext): Promise<ODataResponse> {
    let items: BatchItem[];
    try {
      items = parseBatch(request.body ?? "", request.headers["content-type"]);
    } catch (error) {
      return errorResponse(error, ctx.ieee754);
    }
    const responses: BatchResponseItem[] = [];
    for (const item of items) {
      if (item.kind === "request") {
        const part = this.toRequest(item.request, this.servicePath);
        const partCtx: HandlerContext = { ...ctx, ieee754: isIeee754(part.headers) };
        const response = await this.handle(part, partCtx);
        responses.push({ kind: "response", response: toPart(response, item.request.contentId) });
        continue;
      }
      if (this.writes === undefined) {
        responses.push({ kind: "response", response: toPart(errorResponse(notImplemented("Change sets"), ctx.ieee754), undefined) });
        continue;
      }
      const result = await this.writes.changeset(async (changesetCtx) => {
        const parts: BatchResponsePart[] = [];
        for (const r of item.requests) {
          const part = this.toRequest(r, this.servicePath);
          const response = await this.handle(part, { ...changesetCtx, ieee754: isIeee754(part.headers) });
          if (response.status >= 400) {
            throw new ChangesetFailure(response);
          }
          parts.push(toPart(response, r.contentId));
        }
        return parts;
      }, ctx);
      if (Array.isArray(result)) {
        responses.push({ kind: "changeset", responses: result });
      } else {
        responses.push({ kind: "response", response: toPart(result, undefined) });
      }
    }
    const { contentType, body } = serializeBatch(responses);
    return { status: 200, headers: { "Content-Type": contentType, "OData-Version": "4.0" }, body };
  }
}

/** A request of a change set failed: the whole change set is answered by its error. */
export class ChangesetFailure extends Error {
  public constructor(public readonly response: ODataResponse) {
    super("change set failed");
  }
}

function toPart(response: ODataResponse, contentId: string | undefined): BatchResponsePart {
  const part: BatchResponsePart = { status: response.status, headers: response.headers };
  if (response.body !== undefined) {
    part.body = response.body;
  }
  if (contentId !== undefined) {
    part.contentId = contentId;
  }
  return part;
}
