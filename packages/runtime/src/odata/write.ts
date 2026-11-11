/**
 * Writes and operations of the OData service, on the managed RAP runtime: POST (create, deep
 * insert, create through a navigation), PATCH and PUT, DELETE, bound and static actions,
 * functions, change sets of $batch, If-Match, feature control of the rows read (enrich) and the
 * translation of the RAP responses into OData errors and `sap-messages`.
 *
 * One request (or one change set) is one LUW: the operations, the determinations on modify after
 * each request (D21), then the save; responses are rendered once the LUW is committed, from the
 * projection views, so that they show what the database holds.
 */

import {
  baseEntityOf,
  baseFieldOf,
  ENTITY_CONTROL,
  entitySetOfEntity,
  FIELD_CONTROL,
  findEntity,
  OPERATION_CONTROL,
  same,
  type EdmType,
  type FieldModel,
  type ODataOperation,
} from "@rap-transpiler/model";
import type { Kysely } from "kysely";
import type { BoEntity } from "../rap/bo.js";
import type { RapRuntime } from "../rap/runtime.js";
import { operationId, type ActionResult, type CreateRequest, type Transaction } from "../rap/transaction.js";
import { ODATA_MODE, RapRuntimeError, Responses, type FailCause, type FailedEntry, type ReportedEntry, type Row } from "../rap/types.js";
import { fromJson, toJson, type CanonicalValue, type JsonValue } from "../values.js";
import type { BatchResponsePart } from "./batch.js";
import { badRequest, methodNotAllowed, notFound, ODataError, type ODataMessage, type Severity } from "./errors.js";
import { ChangesetFailure, errorResponse, jsonResponse, sapMessagesHeader, toPart, type HandlerContext, type ODataRequest, type ODataResponse, type Target, type WriteHandler } from "./handler.js";
import { etagOf, etagValue, JsonWriter } from "./json.js";
import type { ReadEngine } from "./read.js";
import { DraftRuntime } from "./draft.js";
import type { Key, ServiceRuntime, TypeInfo } from "./service.js";
import type { QueryOptions } from "./uri/ast.js";

/** An entity set and the managed entity behind it. */
export interface SetInfo {
  info: TypeInfo;
  bo: BoEntity;
  /** OData property → base field. */
  toBase: Map<string, string>;
  /** Base field → OData property. */
  toProperty: Map<string, string>;
}

/** A number of a request body, with its exact text. */
class JsonNumber {
  public constructor(public readonly text: string) {}
}

function parseBody(body: string | undefined): unknown {
  if (body === undefined || body.trim() === "") {
    return {};
  }
  try {
    return JSON.parse(body, ((_key: string, value: unknown, context?: { source?: string }) =>
      typeof value === "number" ? new JsonNumber(context?.source ?? String(value)) : value) as unknown as (key: string, value: unknown) => unknown);
  } catch {
    throw badRequest("The request body is not valid JSON");
  }
}

function jsonValue(edm: EdmType, value: unknown): unknown {
  if (!(value instanceof JsonNumber)) {
    return value;
  }
  return edm.type === "Edm.Decimal" || edm.type === "Edm.Int64" ? value.text : Number(value.text);
}

const STATUS: Record<FailCause, number> = {
  unspecific: 400,
  unauthorized: 403,
  not_found: 404,
  locked: 409,
  conflict: 409,
  readonly: 400,
  disabled: 409,
  dependency: 424,
};

const SEVERITY: Record<string, Severity> = { E: "error", W: "warning", I: "info", S: "success", " ": "info" };

interface ChangesetState {
  tx: Transaction;
}

/** What a request did, to be rendered once the LUW is committed. */
export interface Outcome {
  status: number;
  /** The entity to return (read after the commit). */
  entity?: { set: SetInfo; key: Key };
  /** Entities to return as a collection. */
  entities?: Array<{ set: SetInfo; key: Key }>;
  /** A complex value (action result of an abstract entity). */
  complex?: { value: Record<string, JsonValue> | Array<Record<string, JsonValue>>; context: string };
  location?: string;
  messages: ODataMessage[];
  options: QueryOptions;
  minimal: boolean;
}

export class RapWriteHandler implements WriteHandler {
  public readonly sets = new Map<string, SetInfo>();
  private readonly json: JsonWriter;
  private servicePath = "/";

  /** The drafts of the draft BOs (D54). */
  private readonly drafts: DraftRuntime | undefined;

  public constructor(
    public readonly service: ServiceRuntime,
    private readonly read: ReadEngine,
    private readonly db: Kysely<unknown>,
    public readonly rap: RapRuntime,
  ) {
    this.json = new JsonWriter(service, read);
    const model = service.model;
    for (const info of service.sets()) {
      const base = baseEntityOf(model, info.entity);
      const bo = rap.bo.find(base.name);
      if (bo === undefined) {
        continue;
      }
      const toBase = new Map<string, string>();
      const toProperty = new Map<string, string>();
      for (const [name, { field }] of info.properties) {
        const baseField = baseFieldOf(model, info.entity, field)?.name ?? field.name;
        toBase.set(name, baseField);
        toProperty.set(baseField, name);
      }
      this.sets.set(info.set.name, { info, bo, toBase, toProperty });
    }
    this.drafts = [...this.sets.values()].some((s) => s.info.set.draft !== undefined) ? new DraftRuntime(this) : undefined;
  }

  public setServicePath(path: string): void {
    this.servicePath = path;
  }

  public setInfo(info: TypeInfo): SetInfo {
    const set = this.sets.get(info.set.name);
    if (set === undefined) {
      throw methodNotAllowed(`${info.set.name} is read-only`);
    }
    return set;
  }

  /** The entity set exposing a base entity. */
  private setOfBase(entity: string): SetInfo | undefined {
    return [...this.sets.values()].find((s) => same(s.bo.entity.name, entity));
  }

  public baseKey(set: SetInfo, key: Key): Row {
    const row: Row = {};
    for (const [property, value] of Object.entries(key)) {
      if (set.info.properties.get(property)?.field.draft === true) {
        continue; // IsActiveEntity (D54): not a field of the business object
      }
      row[set.toBase.get(property) ?? property] = value;
    }
    return row;
  }

  public projectedKey(set: SetInfo, key: Row): Key {
    const result: Key = {};
    for (const name of set.info.type.keys) {
      // IsActiveEntity (D54): an instance of the business object is active, unless the key says so
      result[name] = set.info.properties.get(name)?.field.draft === true ? (key[name] ?? true) : (key[set.toBase.get(name) ?? name] ?? null);
    }
    return result;
  }

  public path(set: SetInfo, key: Key): string {
    return `${set.info.set.name}${this.service.keyPredicate(set.info, key)}`;
  }

  // -------------------------------------------------------------------------------------------
  // WriteHandler

  public async handle(request: ODataRequest, target: Target, ctx: HandlerContext): Promise<ODataResponse> {
    const changeset = ctx.changeset as ChangesetState | undefined;
    if (changeset !== undefined) {
      const outcome = await this.execute(changeset.tx, request, target, ctx);
      return { status: outcome.status, headers: {}, deferred: () => this.render(outcome, ctx) };
    }
    const outcome = await this.luw(ctx, async (tx) => {
      const result = await this.execute(tx, request, target, ctx);
      if (request.method !== "GET") {
        const resource = result.entity === undefined ? undefined : { set: result.entity.set, key: this.baseKey(result.entity.set, result.entity.key) };
        result.messages.push(...(await this.save(tx, resource)));
      }
      return result;
    });
    return this.render(outcome, ctx);
  }

  public async changeset(
    run: (ctx: HandlerContext) => Promise<Array<{ response: ODataResponse; contentId?: string }>>,
    ctx: HandlerContext,
  ): Promise<BatchResponsePart[] | ODataResponse> {
    let responses: Array<{ response: ODataResponse; contentId?: string }>;
    let saveMessages: ODataMessage[] = [];
    try {
      responses = await this.luw(ctx, async (tx) => {
        const changesetCtx: HandlerContext = { ...ctx, changeset: { tx } satisfies ChangesetState, contentIds: ctx.contentIds ?? new Map() };
        const result = await run(changesetCtx);
        saveMessages = await this.save(tx);
        return result;
      });
    } catch (error) {
      if (error instanceof ChangesetFailure) {
        return error.response;
      }
      return errorResponse(error, ctx.ieee754);
    }
    const parts: BatchResponsePart[] = [];
    for (const [i, { response, contentId }] of responses.entries()) {
      let rendered = response.deferred === undefined ? response : await response.deferred();
      if (i === responses.length - 1 && saveMessages.length > 0) {
        rendered = { ...rendered, headers: { ...rendered.headers, ...sapMessagesHeader([...this.messagesOf(rendered), ...saveMessages]) } };
      }
      parts.push(toPart(rendered, contentId));
    }
    return parts;
  }

  private messagesOf(response: ODataResponse): ODataMessage[] {
    const header = response.headers["sap-messages"];
    if (header === undefined) {
      return [];
    }
    const numeric: Record<number, Severity> = { 1: "success", 2: "info", 3: "warning", 4: "error" };
    return (JSON.parse(header) as Array<{ code: string; message: string; target?: string; numericSeverity: number }>).map((m) => ({
      code: m.code,
      message: m.message,
      severity: numeric[m.numericSeverity] ?? "info",
      ...(m.target === undefined ? {} : { target: m.target }),
    }));
  }

  private luw<T>(ctx: HandlerContext, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.rap.transaction(this.db, ctx.user, ctx.language, async (tx) => {
      try {
        return await fn(tx);
      } catch (error) {
        if (error instanceof RapRuntimeError) {
          throw new ODataError(400, "RAP_RUNTIME_ERROR", error.message);
        }
        throw error;
      }
    });
  }

  /** The save sequence; an error (and a rollback) when it fails. Returns the other messages. */
  private async save(tx: Transaction, resource?: { set: SetInfo; key: Row }): Promise<ODataMessage[]> {
    const responses = await tx.save();
    if (responses.hasFailed) {
      throw this.error(responses, resource);
    }
    return this.messages(responses.reported, resource);
  }

  // -------------------------------------------------------------------------------------------
  // requests

  private async execute(tx: Transaction, request: ODataRequest, target: Target, ctx: HandlerContext): Promise<Outcome> {
    const { segments, options } = target;
    const last = segments[segments.length - 1];
    const minimal = /return=minimal/i.test(request.headers["prefer"] ?? "");
    const outcome = (status: number): Outcome => ({ status, messages: [], options, minimal });
    // drafts and the actions of the draft (D54); active instances go on below
    const draft = this.drafts === undefined ? undefined : await this.drafts.route(tx, request, target, ctx, minimal);
    if (draft !== undefined) {
      return draft;
    }
    const resolved = await this.resolve(tx, segments);

    if (last?.kind === "operation") {
      return this.operation(tx, request, resolved, last.name, last.parameters ?? [], options, ctx, minimal);
    }
    const method = request.method;
    if (method === "POST") {
      if (resolved.key !== undefined && resolved.navigation === undefined) {
        throw methodNotAllowed("POST on an entity: use PATCH, or POST on its collection");
      }
      const body = parseBody(request.body);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw badRequest("The request body must be a JSON object");
      }
      let created: { set: SetInfo; key: Row; responses: Responses };
      if (resolved.navigation !== undefined && resolved.parent !== undefined) {
        // POST Travel(…)/_Booking: create by association
        const { parent, navigation } = resolved;
        const nav = parent.set.info.navigations.get(navigation) as NonNullable<ReturnType<TypeInfo["navigations"]["get"]>>;
        if (!nav.insertable) {
          throw methodNotAllowed(`${parent.set.info.set.name}/${navigation}: creation through this navigation is not allowed`);
        }
        created = await this.createBy(tx, parent.set, this.baseKey(parent.set, parent.key), navigation, body as Record<string, unknown>);
      } else {
        const set = resolved.set;
        if (!set.info.set.insertable) {
          throw methodNotAllowed(`${set.info.set.name} does not allow creation`);
        }
        created = await this.createDeep(tx, set, body as Record<string, unknown>);
      }
      await this.determine(tx, created.responses);
      const key = this.projectedKey(created.set, created.key);
      if (request.contentId !== undefined && ctx.contentIds !== undefined) {
        ctx.contentIds.set(request.contentId, this.path(created.set, key));
      }
      return { ...outcome(minimal ? 204 : 201), entity: { set: created.set, key }, location: this.path(created.set, key), messages: this.messages(created.responses.reported, undefined) };
    }
    if (resolved.key === undefined) {
      throw methodNotAllowed(`${method} needs a single entity`);
    }
    const set = resolved.set;
    const key = this.baseKey(set, resolved.key);
    if (method === "PATCH" || method === "PUT") {
      if (!set.info.set.updatable) {
        throw methodNotAllowed(`${set.info.set.name} does not allow updates`);
      }
      await this.checkEtag(tx, request, set, key, true);
      const body = parseBody(request.body);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw badRequest("The request body must be a JSON object");
      }
      const { values, fields } = this.values(set, body as Record<string, unknown>, method === "PUT");
      for (const k of set.bo.keys) {
        if (fields.has(k.name)) {
          if (values[k.name] !== key[k.name]) {
            throw badRequest(`The key property ${set.toProperty.get(k.name) ?? k.name} cannot be changed`, set.toProperty.get(k.name));
          }
          fields.delete(k.name);
        }
      }
      const responses = await tx.update(set.bo, [{ key, values, fields }], ODATA_MODE);
      this.failIf(responses, set, resolved.key);
      await this.determine(tx, responses);
      return { ...outcome(minimal ? 204 : 200), entity: { set, key: resolved.key }, messages: this.messages(responses.reported, { set, key }) };
    }
    if (method === "DELETE") {
      if (!set.info.set.deletable) {
        throw methodNotAllowed(`${set.info.set.name} does not allow deletion`);
      }
      await this.checkEtag(tx, request, set, key, true);
      const responses = await tx.delete(set.bo, [{ key }], ODATA_MODE);
      this.failIf(responses, set, resolved.key);
      await this.determine(tx, responses);
      return { ...outcome(204), messages: this.messages(responses.reported, { set, key }) };
    }
    throw methodNotAllowed(`${method} is not supported`);
  }

  /** Determinations on modify at the end of a request (D21). */
  public async determine(tx: Transaction, previous: Responses): Promise<void> {
    const responses = await tx.determineOnModify();
    previous.reported.push(...responses.reported);
    if (responses.hasFailed) {
      throw this.error(responses, undefined);
    }
  }

  /**
   * The entity set, key, and the navigation of a write's resource path. Navigations are followed
   * in the LUW, which sees the instances created earlier in the change set (`$1/_Booking`).
   */
  private async resolve(tx: Transaction, segments: Target["segments"]): Promise<{ set: SetInfo; key?: Key; navigation?: string; parent?: { set: SetInfo; key: Key } }> {
    const [first, ...rest] = segments;
    if (first === undefined || first.kind !== "entitySet") {
      throw badRequest("The resource path must start with an entity set");
    }
    let set = this.setInfo(this.service.set(first.name));
    let key: Key | undefined = first.key === undefined ? undefined : this.service.key(set.info, first.key);
    let parent: { set: SetInfo; key: Key } | undefined;
    let navigation: string | undefined;
    for (const segment of rest) {
      if (segment.kind === "operation") {
        break;
      }
      if (segment.kind !== "navigation") {
        throw badRequest(`Writes are not supported on ${segment.kind} segments`);
      }
      if (key === undefined) {
        throw badRequest(`${segment.name}: navigation needs a single entity`);
      }
      const { navigation: nav, target } = this.service.navigationTarget(set.info, segment.name);
      const targetSet = this.setInfo(target);
      const association = this.associationOf(set, segment.name);
      const { results, responses } = await tx.readByAssociation(set.bo, association, [this.baseKey(set, key)]);
      if (responses.hasFailed) {
        throw notFound(this.path(set, key));
      }
      if (segment.key !== undefined || !nav.collection) {
        const wanted = segment.key === undefined ? undefined : this.service.key(target, segment.key);
        const found = results.map((r) => this.projectedKey(targetSet, r.target)).find((k) => wanted === undefined || target.type.keys.every((name) => k[name] === wanted[name]));
        if (found === undefined) {
          throw notFound(wanted === undefined ? `${this.path(set, key)}/${segment.name}` : this.path(targetSet, wanted));
        }
        set = targetSet;
        key = found;
        navigation = undefined;
        parent = undefined;
      } else {
        parent = { set, key };
        set = targetSet;
        key = undefined;
        navigation = segment.name;
      }
    }
    const result: { set: SetInfo; key?: Key; navigation?: string; parent?: { set: SetInfo; key: Key } } = { set };
    if (key !== undefined) result.key = key;
    if (navigation !== undefined) result.navigation = navigation;
    if (parent !== undefined) result.parent = parent;
    return result;
  }

  /** Properties of a request body → base values and the fields given. */
  public values(set: SetInfo, body: Record<string, unknown>, replace: boolean): { values: Row; fields: Set<string>; navigations: Map<string, unknown> } {
    const values: Row = {};
    const fields = new Set<string>();
    const navigations = new Map<string, unknown>();
    for (const [name, value] of Object.entries(body)) {
      if (name.includes("@")) {
        continue; // @odata.type, @odata.etag…
      }
      if (name.startsWith("__")) {
        continue; // instance feature control sent back by clients
      }
      const property = set.info.properties.get(name);
      if (property?.field.draft === true) {
        continue; // IsActiveEntity, HasDraftEntity… sent back by clients (D54)
      }
      if (property === undefined) {
        if (set.info.navigations.has(name)) {
          navigations.set(name, value);
          continue;
        }
        throw badRequest(`${set.info.type.name} has no property ${name}`, name);
      }
      const base = set.toBase.get(name) ?? name;
      values[base] = fromJson(property.field.type, property.property.edm, jsonValue(property.property.edm, value), name);
      fields.add(base);
    }
    if (replace) {
      for (const [name, property] of set.info.properties) {
        const base = set.toBase.get(name) ?? name;
        if (!fields.has(base) && !property.property.key && !property.property.computed) {
          values[base] = fromJson(property.field.type, property.property.edm, null, name);
          fields.add(base);
        }
      }
    }
    return { values, fields, navigations };
  }

  private async createDeep(tx: Transaction, set: SetInfo, body: Record<string, unknown>): Promise<{ set: SetInfo; key: Row; responses: Responses }> {
    const { values, fields, navigations } = this.values(set, body, false);
    const cid = "%ODATA-ROOT";
    const responses = await tx.create(set.bo, [{ cid, values, fields }], ODATA_MODE);
    this.failIf(responses, set, undefined);
    const created = tx.createdByCid(cid);
    if (created === undefined) {
      throw new ODataError(500, "INTERNAL_ERROR", "the created instance has no key");
    }
    await this.createChildren(tx, set, cid, navigations, responses);
    return { set, key: created.key, responses };
  }

  /** Deep insert: the children given inline, created by association with %cid_ref. */
  private async createChildren(tx: Transaction, set: SetInfo, cid: string, navigations: Map<string, unknown>, responses: Responses): Promise<void> {
    let n = 0;
    for (const [name, value] of navigations) {
      const navigation = set.info.navigations.get(name);
      if (navigation === undefined || !navigation.insertable) {
        throw badRequest(`${set.info.type.name}/${name}: deep insert is only possible through compositions that allow creation`, name);
      }
      const targetSet = this.setInfo(this.service.set(navigation.targetSet));
      const association = this.associationOf(set, name);
      const children = Array.isArray(value) ? value : [value];
      const targets: CreateRequest[] = [];
      const nested: Array<{ cid: string; navigations: Map<string, unknown> }> = [];
      for (const child of children) {
        if (typeof child !== "object" || child === null) {
          throw badRequest(`${name}: the children must be JSON objects`, name);
        }
        const converted = this.values(targetSet, child as Record<string, unknown>, false);
        const childCid = `${cid}/${name}/${n++}`;
        targets.push({ cid: childCid, values: converted.values, fields: converted.fields });
        nested.push({ cid: childCid, navigations: converted.navigations });
      }
      const created = await tx.createByAssociation(set.bo, association, [{ key: {}, cidRef: cid, targets }], ODATA_MODE);
      this.failIf(created, targetSet, undefined);
      responses.add(created);
      for (const child of nested) {
        if (child.navigations.size > 0) {
          await this.createChildren(tx, targetSet, child.cid, child.navigations, responses);
        }
      }
    }
  }

  public associationOf(set: SetInfo, navigation: string): NonNullable<ReturnType<RapRuntime["bo"]["association"]>> {
    const projected = set.info.entity.associations.find((a) => a.name === navigation);
    const association = this.rap.bo.association(set.bo, projected?.baseAssociation ?? navigation);
    if (association === undefined) {
      throw badRequest(`${navigation} is not an association of the business object`);
    }
    return association;
  }

  private async createBy(tx: Transaction, parent: SetInfo, parentKey: Row, navigation: string, body: Record<string, unknown>): Promise<{ set: SetInfo; key: Row; responses: Responses }> {
    const nav = parent.info.navigations.get(navigation);
    const targetSet = this.setInfo(this.service.set(nav?.targetSet ?? ""));
    const association = this.associationOf(parent, navigation);
    const { values, fields, navigations } = this.values(targetSet, body, false);
    const cid = "%ODATA-CHILD";
    const responses = await tx.createByAssociation(parent.bo, association, [{ key: parentKey, targets: [{ cid, values, fields }] }], ODATA_MODE);
    this.failIf(responses, parent, this.projectedKey(parent, parentKey));
    const created = tx.createdByCid(cid);
    if (created === undefined) {
      throw new ODataError(500, "INTERNAL_ERROR", "the created instance has no key");
    }
    await this.createChildren(tx, targetSet, cid, navigations, responses);
    return { set: targetSet, key: created.key, responses };
  }

  /** If-Match against the current ETag of the instance (in the LUW). */
  private async checkEtag(tx: Transaction, request: ODataRequest, set: SetInfo, key: Row, required: boolean): Promise<void> {
    const etagProperty = set.info.type.etag;
    if (etagProperty === undefined && set.info.type.etagPath === undefined) {
      return;
    }
    const header = request.headers["if-match"];
    if (header === undefined || header.trim() === "") {
      if (required) {
        throw new ODataError(428, "PRECONDITION_REQUIRED", `${set.info.set.name}: the request needs an If-Match header`);
      }
      return;
    }
    if (header.trim() === "*") {
      return;
    }
    // the ETag field of the instance, or of its ETag master (etag dependent by, D32)
    const current = await tx.etagValue(set.bo, key);
    if (current === undefined) {
      throw notFound(this.path(set, this.projectedKey(set, key)));
    }
    const etag = etagValue(current.value);
    const given = header.split(",").map((t) => t.trim());
    if (!given.includes(etag)) {
      throw new ODataError(412, "PRECONDITION_FAILED", `${this.path(set, this.projectedKey(set, key))} was changed in the meantime: reload it`);
    }
  }

  // -------------------------------------------------------------------------------------------
  // actions and functions

  private async operation(
    tx: Transaction,
    request: ODataRequest,
    resolved: { set: SetInfo; key?: Key },
    qualifiedName: string,
    urlParameters: Array<{ name: string; value: unknown }>,
    options: QueryOptions,
    ctx: HandlerContext,
    minimal: boolean,
  ): Promise<Outcome> {
    const set = resolved.set;
    const name = qualifiedName.includes(".") ? qualifiedName.slice(qualifiedName.lastIndexOf(".") + 1) : qualifiedName;
    const operation = this.service.operation(set.info, name, resolved.key === undefined);
    const action = set.bo.behavior.actions.find((a) => same(a.name, operation.action));
    if (action === undefined) {
      throw badRequest(`${name} is not an operation of ${set.info.type.name}`);
    }
    if (operation.kind === "action" && request.method !== "POST") {
      throw methodNotAllowed(`The action ${name} is called with POST`);
    }
    if (operation.kind === "function" && request.method !== "GET") {
      throw methodNotAllowed(`The function ${name} is called with GET`);
    }
    const parameterEntity = action.parameter === undefined || action.parameter === "$self" ? undefined : findEntity(this.service.model, action.parameter);
    const param = this.parameters(operation, parameterEntity?.fields ?? [], request, urlParameters);
    const key = resolved.key === undefined ? undefined : this.baseKey(set, resolved.key);
    if (key !== undefined && operation.kind === "action") {
      await this.checkEtag(tx, request, set, key, false);
    }
    const cid = "%ODATA-ACTION";
    const { results, responses } = await tx.execute(set.bo, action, [{ ...(key === undefined ? {} : { key }), ...(action.static || action.factory ? { cid } : {}), param }], ODATA_MODE);
    this.failIf(responses, set, resolved.key);
    if (operation.kind === "action") {
      await this.determine(tx, responses);
    }
    const base: Outcome = { status: 200, messages: this.messages(responses.reported, key === undefined ? undefined : { set, key }), options, minimal };
    void ctx;
    if (operation.returnType === undefined) {
      return { ...base, status: 204 };
    }
    if (action.factory) {
      const created = responses.mapped.find((m) => m.cid === cid);
      const targetSet = created === undefined ? undefined : this.setOfBase(created.entity);
      if (created === undefined || targetSet === undefined) {
        throw new ODataError(500, "INTERNAL_ERROR", `the factory action ${name} did not map its %cid`);
      }
      return { ...base, entity: { set: targetSet, key: this.projectedKey(targetSet, created.key) } };
    }
    return this.actionResult(base, set, action.result?.entity ?? "$self", operation, results);
  }

  private actionResult(base: Outcome, set: SetInfo, resultEntity: string, operation: ODataOperation, results: ActionResult[]): Outcome {
    const returnType = operation.returnType as NonNullable<ODataOperation["returnType"]>;
    if (returnType.entityType) {
      const targetSet = resultEntity === "$self" ? set : this.setOf(resultEntity);
      // instance actions: the key of the result row; static actions and other entities: the result itself
      const entities = results
        .map((r) => (resultEntity === "$self" && r.key !== undefined ? r.key : r.value))
        .filter((k): k is Row => k !== undefined)
        .map((k) => ({ set: targetSet, key: this.projectedKey(targetSet, k) }));
      if (!returnType.collection) {
        const entity = entities[0];
        if (entity === undefined) {
          return { ...base, status: 204 };
        }
        return { ...base, entity };
      }
      return { ...base, entities };
    }
    const complex = this.service.odata.complexTypes.find((c) => c.name === returnType.type);
    const render = (value: Row | undefined): Record<string, JsonValue> => {
      const object: Record<string, JsonValue> = {};
      for (const p of complex?.properties ?? []) {
        object[p.name] = toJson(p.edm, value?.[p.name] ?? null, false);
      }
      return object;
    };
    const values = results.map((r) => render(r.value));
    const context = `$metadata#${this.service.namespace}.${returnType.type}`;
    return { ...base, complex: { value: returnType.collection ? values : (values[0] ?? {}), context: returnType.collection ? `${context.replace("#", "#Collection(")})` : context } };
  }

  private setOf(entity: string): SetInfo {
    const set = entitySetOfEntity(this.service.model, entity);
    const info = set === undefined ? undefined : this.sets.get(set.name);
    if (info === undefined) {
      throw new ODataError(500, "INTERNAL_ERROR", `no entity set for ${entity}`);
    }
    return info;
  }

  private parameters(operation: ODataOperation, fields: FieldModel[], request: ODataRequest, urlParameters: Array<{ name: string; value: unknown }>): Row {
    const given: Record<string, unknown> = {};
    if (operation.kind === "action") {
      const body = parseBody(request.body);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw badRequest("The action parameters must be a JSON object");
      }
      Object.assign(given, body);
    } else {
      for (const p of urlParameters) {
        const value = p.value as { kind?: string; literal?: { value?: unknown } };
        given[p.name] = value?.kind === "literal" ? value.literal?.value : undefined;
      }
    }
    const param: Row = {};
    for (const [name, value] of Object.entries(given)) {
      if (name.includes("@")) {
        continue;
      }
      const p = operation.parameters.find((x) => x.name === name);
      const field = fields.find((f) => f.name === name);
      if (p === undefined || field === undefined) {
        throw badRequest(`${operation.name} has no parameter ${name}`, name);
      }
      param[field.name] = fromJson(field.type, p.edm, jsonValue(p.edm, value), name);
    }
    return param;
  }

  // -------------------------------------------------------------------------------------------
  // responses

  public failIf(responses: Responses, set: SetInfo, key: Key | undefined): void {
    if (responses.hasFailed) {
      throw this.error(responses, key === undefined ? undefined : { set, key: this.baseKey(set, key) });
    }
  }

  /** Messages of the RAP responses, with their OData targets. */
  public messages(reported: ReportedEntry[], resource: { set: SetInfo; key: Row } | undefined, severities = new Set(["S", "I", "W", " "])): ODataMessage[] {
    return reported
      .filter((r) => severities.has(r.message.severity))
      .map((r) => {
        const message: ODataMessage = { code: r.message.msgid === undefined ? "RAP" : `${r.message.msgid}/${r.message.msgno ?? ""}`, message: r.message.text, severity: SEVERITY[r.message.severity] ?? "info" };
        const target = this.target(r.entity, r.key, r.elements, resource);
        if (target !== undefined) {
          message.target = target;
        }
        return message;
      });
  }

  /** `Field` for the resource of the request, `/Set(key)/Field` for another instance. */
  private target(entity: string | undefined, key: Row | undefined, elements: string[], resource: { set: SetInfo; key: Row } | undefined): string | undefined {
    if (entity === undefined || key === undefined) {
      return undefined;
    }
    const set = this.setOfBase(entity);
    if (set === undefined) {
      return undefined;
    }
    const property = elements.map((e) => set.toProperty.get(e) ?? set.info.navigations.get(e)?.name).find((p) => p !== undefined);
    const own = resource !== undefined && resource.set === set && set.bo.keys.every((k) => resource.key[k.name] === key[k.name]);
    if (own) {
      return property;
    }
    const path = `/${this.path(set, this.projectedKey(set, key))}`;
    return property === undefined ? path : `${path}/${property}`;
  }

  /** The OData error of failed RAP responses. */
  public error(responses: Responses, resource: { set: SetInfo; key: Row } | undefined): ODataError {
    const failed = responses.failed[0] as FailedEntry;
    const errors = this.messages(responses.reported, resource, new Set(["E"]));
    const others = this.messages(responses.reported, resource);
    const status = STATUS[failed.cause] ?? 400;
    if (errors.length === 0) {
      errors.push({ code: `RAP/${failed.cause.toUpperCase()}`, message: this.genericMessage(failed), severity: "error" });
    }
    const [main, ...details] = [...errors, ...others];
    const first = main as ODataMessage;
    return new ODataError(status, first.code, first.message, first.target, details.length === 0 ? [] : [first, ...details]);
  }

  private genericMessage(failed: FailedEntry): string {
    const set = this.setOfBase(failed.entity);
    const instance = set === undefined || failed.key === undefined ? (set?.info.set.name ?? failed.entity) : this.path(set, this.projectedKey(set, failed.key));
    const operation = failed.operation === undefined ? "" : failed.operation.kind === "action" ? `the action ${failed.operation.name}` : failed.operation.kind === "association" ? `the creation of ${failed.operation.name}` : `the ${failed.operation.kind}`;
    switch (failed.cause) {
      case "not_found":
        return `${instance} not found`;
      case "unauthorized":
        return `You are not authorized to perform ${operation || "this operation"} on ${instance}`;
      case "locked":
        return `${instance} is locked by another user`;
      case "conflict":
        return `${instance} already exists`;
      case "disabled":
        return `${operation === "" ? "The operation" : operation[0]?.toUpperCase() + operation.slice(1)} is not possible for ${instance}`;
      case "readonly":
        return `${instance}: a read-only field cannot be changed`;
      case "dependency":
        return `${instance}: a related operation failed`;
      default:
        return `${operation === "" ? "The operation" : operation[0]?.toUpperCase() + operation.slice(1)} failed for ${instance}`;
    }
  }

  private async render(outcome: Outcome, ctx: HandlerContext): Promise<ODataResponse> {
    const headers: Record<string, string> = { ...sapMessagesHeader(outcome.messages) };
    if (outcome.location !== undefined) {
      headers["Location"] = `${this.servicePath}${outcome.location}`;
      headers["OData-EntityId"] = headers["Location"];
    }
    if (outcome.complex !== undefined) {
      const body = Array.isArray(outcome.complex.value) ? { "@odata.context": outcome.complex.context, value: outcome.complex.value } : { "@odata.context": outcome.complex.context, ...outcome.complex.value };
      return jsonResponse(200, body, ctx.ieee754, headers);
    }
    if (outcome.entities !== undefined) {
      const rows = [];
      for (const { set, key } of outcome.entities) {
        const row = await this.read.readOne(set.info, key, outcome.options);
        if (row !== undefined) {
          await this.enrich(set.info, [row], outcome.options, ctx);
          rows.push(this.json.entity(set.info, row, outcome.options, ctx));
        }
      }
      const set = outcome.entities[0]?.set;
      return jsonResponse(200, { "@odata.context": set === undefined ? "$metadata" : this.json.contextUrl(set.info, outcome.options, false), value: rows }, ctx.ieee754, headers);
    }
    if (outcome.entity === undefined || outcome.status === 204) {
      return { status: 204, headers: { "OData-Version": "4.0", ...headers } };
    }
    const { set, key } = outcome.entity;
    const row = await this.read.readOne(set.info, key, outcome.options);
    if (row === undefined) {
      return { status: 204, headers: { "OData-Version": "4.0", ...headers } };
    }
    await this.enrich(set.info, [row], outcome.options, ctx);
    const etag = etagOf(set.info, row);
    if (etag !== undefined) {
      headers["ETag"] = etag;
    }
    const body = { "@odata.context": this.json.contextUrl(set.info, outcome.options, true), ...this.json.entity(set.info, row, outcome.options, ctx) };
    return jsonResponse(outcome.status, body, ctx.ieee754, headers);
  }

  // -------------------------------------------------------------------------------------------
  // permissions of the user (the UI shows the creation it may perform, D36)

  /** Whether the user may create instances of each entity set that allows creation. */
  public async permissions(ctx: HandlerContext): Promise<Record<string, { create: boolean }>> {
    const result: Record<string, { create: boolean }> = {};
    for (const [name, set] of this.sets) {
      if (!set.info.set.insertable) {
        continue;
      }
      const allowed = await this.rap.transaction(this.db, ctx.user, ctx.language, (tx) => tx.allowed(set.bo, [{ kind: "create" }]));
      result[name] = { create: allowed.has("create") };
    }
    return result;
  }

  // -------------------------------------------------------------------------------------------
  // feature control of the rows read

  public async enrich(info: TypeInfo, rowsRead: Array<Record<string, unknown>>, options: QueryOptions, ctx: HandlerContext): Promise<void> {
    const set = this.sets.get(info.set.name);
    const type = info.type;
    let rows = rowsRead;
    if (set === undefined || rows.length === 0) {
      return;
    }
    const selected = (name: string): boolean => options.select === undefined || options.select.some((p) => p[0] === "*" || p[0] === name);
    const wantEntity = type.entityControl !== undefined && selected(ENTITY_CONTROL);
    const wantOperations = type.operationControl.length > 0 && selected(OPERATION_CONTROL);
    const wantFields = type.fieldControl.length > 0 && selected(FIELD_CONTROL);
    if (!wantEntity && !wantOperations && !wantFields) {
      return;
    }
    // drafts (D54): edited by their user, actions after the activation
    const drafts = rows.filter((row) => row["IsActiveEntity"] === false);
    for (const row of drafts) {
      if (wantEntity) row[ENTITY_CONTROL] = { Updatable: true, Deletable: true };
      if (wantOperations) row[OPERATION_CONTROL] = Object.fromEntries(type.operationControl.map((name) => [name, info.navigations.has(name)]));
      if (wantFields) row[FIELD_CONTROL] = Object.fromEntries(type.fieldControl.map((p) => [p, type.properties.find((x) => x.name === p)?.mandatory === true ? 7 : 3]));
    }
    rows = rows.filter((row) => row["IsActiveEntity"] !== false);
    if (rows.length === 0) {
      return;
    }
    const keys = rows.map((row) => this.baseKey(set, Object.fromEntries(type.keys.map((k) => [k, (row[k] ?? null) as CanonicalValue]))));
    const operations = [
      ...(type.entityControl?.updatable === true ? [{ kind: "update" as const }] : []),
      ...(type.entityControl?.deletable === true ? [{ kind: "delete" as const }] : []),
      ...type.operationControl.map((name) => {
        const operation = this.service.odata.operations.find((o) => o.boundType === type.name && o.name === name);
        if (operation !== undefined) {
          return { kind: "action" as const, name: operation.action };
        }
        const projected = info.entity.associations.find((a) => a.name === name);
        return { kind: "association" as const, name: projected?.baseAssociation ?? name };
      }),
    ];
    const fields = type.fieldControl.map((p) => set.toBase.get(p) ?? p);
    const features = await this.rap.transaction(this.db, ctx.user, ctx.language, (tx) => tx.features(set.bo, keys, operations, fields));
    rows.forEach((row, i) => {
      const k = JSON.stringify(set.bo.keys.map((f) => keys[i]?.[f.name] ?? null));
      const enabled = (op: (typeof operations)[number]): boolean => !features.global.has(operationId(op)) && !features.disabled.has(`${k}|${operationId(op)}`);
      if (wantEntity) {
        row[ENTITY_CONTROL] = {
          Updatable: type.entityControl?.updatable === true ? enabled({ kind: "update" }) : true,
          Deletable: type.entityControl?.deletable === true ? enabled({ kind: "delete" }) : true,
        };
      }
      if (wantOperations) {
        const control: Record<string, boolean> = {};
        type.operationControl.forEach((name, j) => {
          control[name] = enabled(operations[(type.entityControl?.updatable === true ? 1 : 0) + (type.entityControl?.deletable === true ? 1 : 0) + j] as (typeof operations)[number]);
        });
        row[OPERATION_CONTROL] = control;
      }
      if (wantFields) {
        const readonly = features.readonly.get(k);
        const control: Record<string, number> = {};
        for (const property of type.fieldControl) {
          const mandatory = type.properties.find((p) => p.name === property)?.mandatory === true;
          control[property] = readonly?.has(set.toBase.get(property) ?? property) === true ? 1 : mandatory ? 7 : 3;
        }
        row[FIELD_CONTROL] = control;
      }
    });
  }
}
