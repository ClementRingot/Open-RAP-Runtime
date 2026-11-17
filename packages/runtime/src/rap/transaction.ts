/**
 * The managed RAP transaction (LUW): transactional buffer over the persistent tables, the
 * operations of the business objects with their checks (authorization, feature control, locks,
 * numbering, administrative fields), the determinations on modify (decision D21) and the save
 * sequence (determinations on save, validations, write).
 */

import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { abapName, derivedType, getAnnotation, same, type ActionModel, type DeterminationModel, type EntityModel, type FieldModel, type HandlerRef, type TableModel, type TriggerModel, type ValidationModel } from "@open-rap/model";
import type { AbapBridge } from "../abap/bridge.js";
import { appendRow, component, getAbapValue, isFlagOn, rowsOf, setAbapValue, setFlag, type AbapData } from "../abap/convert.js";
import type { User } from "../auth/user.js";
import { withSavepoint } from "../db/database.js";
import { fromSql, initialValue, isInitial, toSql, type CanonicalValue } from "../values.js";
import { keyOf, keyString, type BoAssociation, type BoEntity, type BoModel } from "./bo.js";
import { RapRuntimeError, Responses, type AccessMode, type FailCause, type FailedOperation, type Row } from "./types.js";

export interface CreateRequest {
  cid?: string;
  values: Row;
  /** Fields given by the consumer (`%control`). */
  fields: Set<string>;
}

export interface UpdateRequest {
  key: Row;
  cidRef?: string;
  values: Row;
  fields: Set<string>;
}

export interface DeleteRequest {
  key: Row;
  cidRef?: string;
}

export interface CreateByAssociationRequest {
  key: Row;
  cidRef?: string;
  targets: CreateRequest[];
}

export interface ActionRequest {
  /** Instance actions: the instance. */
  key?: Row;
  cidRef?: string;
  /** Static and factory actions: the content ID of the call. */
  cid?: string;
  param: Row;
}

export interface ActionResult {
  key?: Row;
  cidRef?: string;
  cid?: string;
  /** The result: a row of the result entity (or of the abstract entity), when the action has one. */
  value?: Row;
}

interface Instance {
  bo: BoEntity;
  row: Row;
  /** Image in the database; undefined for an instance created in this LUW. */
  persisted?: Row;
  deleted: boolean;
  /** Fields changed in this LUW (all given fields for a creation). */
  changed: Set<string>;
  cid?: string;
  /** D109: late numbering, the preliminary identifier of a created instance (%pid, 32 hexadecimal digits). */
  pid?: string;
}

interface ChangeEvent {
  seq: number;
  bo: BoEntity;
  key: Row;
  kind: "create" | "update" | "delete";
  fields: Set<string>;
  /** The determination whose handler made the change. */
  source?: string;
}

export interface TransactionServices {
  bo: BoModel;
  bridge: AbapBridge;
  /** Reads the instances of a custom entity through its query class (D43): rows by element. */
  customRead?: (entity: EntityModel, equalities: Array<{ name: string; value: CanonicalValue }>) => Promise<Row[]>;
  /** Time stamps of the administrative fields: ISO UTC with microseconds, strictly increasing. */
  now(): string;
}

const MAX_ROUNDS = 20;

/** A failure of an operation on one instance. */
interface Failure {
  cause: FailCause;
  key?: Row;
  cid?: string;
}

export class Transaction {
  private readonly instances = new Map<string, Instance>();
  private readonly cids = new Map<string, { bo: BoEntity; key: Row }>();
  private readonly events: ChangeEvent[] = [];
  private seq = 0;
  private readonly seen = new Map<string, number>();
  private readonly locked = new Set<string>();
  private source: string | undefined;
  private saved = false;
  /** ETag masters whose ETag field changes with their `etag dependent` instances (D32). */
  private readonly etagTouched = new Set<Instance>();
  /** D110: a transaction on the drafts (D81: its buffer holds a draft), whose instances have %is_draft on. */
  public draft = false;
  /** D110: the drafts created by EML (%is_draft on) in a transaction on the active instances, written by the save. */
  private readonly newDrafts: Array<{ bo: BoEntity; row: Row; uuid: string }> = [];
  /** D109: the final keys given by adjust_numbers, by the buffer id of the preliminary key. */
  private readonly renumbered = new Map<string, Row>();
  private pidCounter = 0;
  /** The saver runs (save_modified, cleanup): the only place where ABAP SQL may write. */
  public inSaver = false;

  public constructor(
    private readonly services: TransactionServices,
    public readonly db: Kysely<unknown>,
    public readonly user: User,
  ) {}

  private get bo(): BoModel {
    return this.services.bo;
  }

  private get bridge(): AbapBridge {
    return this.services.bridge;
  }

  // -------------------------------------------------------------------------------------------
  // buffer

  private id(bo: BoEntity, key: Row): string {
    return `${bo.entity.name.toUpperCase()}|${keyString(bo, key)}`;
  }

  /** The instances of a custom entity meeting equalities, read by its query class (D43). */
  private async readCustom(bo: BoEntity, equalities: Array<{ name: string; value: CanonicalValue }>): Promise<Row[]> {
    if (this.services.customRead === undefined) {
      throw new RapRuntimeError(`${bo.entity.name}: custom entities need their query class`);
    }
    const rows = await this.services.customRead(bo.entity, equalities);
    return rows.map((record) => Object.fromEntries(bo.fields.map((f) => [f.name, record[f.name] ?? initialValue(f.type)])) as Row);
  }

  private async load(bo: BoEntity, key: Row): Promise<Row | undefined> {
    if (bo.entity.kind === "custom") {
      return (await this.readCustom(bo, bo.keys.map((k) => ({ name: k.name, value: (key[k.name] ?? null) as CanonicalValue }))))[0];
    }
    const conditions = bo.keys.map((k) => sql`${sql.id(bo.columns.get(k.name) ?? abapName(k.name))} = ${toSql(k.type, key[k.name] ?? null)}`);
    const result = await sql<Record<string, unknown>>`SELECT * FROM ${sql.id(bo.table.name)} WHERE ${sql.join(conditions, sql` AND `)}`.execute(this.db);
    const record = result.rows[0];
    return record === undefined ? undefined : (await this.withCalculated(bo, [this.fromRecord(bo, record)]))[0];
  }

  /**
   * The calculated elements (D67) of instances read from the persistent table, read from the CDS
   * view: their values as of the last save.
   */
  private async withCalculated(bo: BoEntity, rows: Row[]): Promise<Row[]> {
    const calculated = bo.fields.filter((f) => f.expression !== undefined);
    const view = bo.entity.sqlView;
    if (calculated.length === 0 || view === undefined || same(view, bo.table.name) || rows.length === 0) {
      return rows;
    }
    const byKey = (row: Row): ReturnType<typeof sql> => sql`(${sql.join(bo.keys.map((k) => sql`${sql.id(k.name)} = ${toSql(k.type, row[k.name] ?? null)}`), sql` AND `)})`;
    const result = await sql<Record<string, unknown>>`SELECT ${sql.join([...bo.keys, ...calculated].map((f) => sql.id(f.name)))} FROM ${sql.id(view)} WHERE ${sql.join(rows.map(byKey), sql` OR `)}`.execute(this.db);
    const records = new Map(result.rows.map((record) => [keyString(bo, Object.fromEntries(bo.keys.map((k) => [k.name, fromSql(k.type, record[k.name])])) as Row), record]));
    for (const row of rows) {
      const record = records.get(keyString(bo, row));
      for (const field of calculated) {
        row[field.name] = record === undefined ? initialValue(field.type) : fromSql(field.type, record[field.name]);
      }
    }
    return rows;
  }

  private fromRecord(bo: BoEntity, record: Record<string, unknown>): Row {
    const row: Row = {};
    for (const field of bo.fields) {
      const column = bo.columns.get(field.name);
      row[field.name] = column === undefined ? initialValue(field.type) : fromSql(field.type, record[column]);
    }
    return row;
  }

  /** The instance with this key, from the buffer or the database; undefined if it does not exist. */
  private async instance(bo: BoEntity, key: Row): Promise<Instance | undefined> {
    const id = this.id(bo, key);
    const buffered = this.instances.get(id);
    if (buffered !== undefined) {
      return buffered.deleted ? undefined : buffered;
    }
    const row = await this.load(bo, key);
    if (row === undefined) {
      return undefined;
    }
    const instance: Instance = { bo, row, persisted: { ...row }, deleted: false, changed: new Set() };
    this.instances.set(id, instance);
    return instance;
  }

  /** Key of a request row: its key, the instance of its `%pid` (D109), or the instance created with its `%cid_ref`. */
  private resolveKey(bo: BoEntity, key: Row | undefined, cidRef: string | undefined): Row | undefined {
    const pid = key?.["%pid"];
    if (typeof pid === "string" && !/^0*$/.test(pid)) {
      for (const instance of this.instances.values()) {
        if (instance.bo === bo && instance.pid?.toUpperCase() === pid.toUpperCase()) {
          return keyOf(bo, instance.row);
        }
      }
    }
    if (cidRef !== undefined && cidRef !== "") {
      const created = this.cids.get(cidRef);
      if (created !== undefined && created.bo === bo) {
        return created.key;
      }
    }
    if (key === undefined || bo.keys.every((k) => isInitial(k.type, key[k.name]))) {
      return cidRef === undefined || cidRef === "" ? key : undefined;
    }
    return keyOf(bo, key);
  }

  private record(bo: BoEntity, key: Row, kind: ChangeEvent["kind"], fields: Set<string>): void {
    const event: ChangeEvent = { seq: ++this.seq, bo, key: { ...key }, kind, fields };
    if (this.source !== undefined) {
      event.source = this.source;
    }
    this.events.push(event);
  }

  /** Instances of the buffer and the database reached by an association. */
  private async associated(bo: BoEntity, association: BoAssociation, source: Row): Promise<Row[]> {
    const target = association.target;
    const conditions = association.on.map((pair) => {
      const field = target.fields.find((f) => same(f.name, pair.target)) as FieldModel;
      return { field, value: source[bo.fields.find((f) => same(f.name, pair.source))?.name ?? pair.source] ?? null };
    });
    const read =
      target.entity.kind === "custom"
        ? await this.readCustom(target, conditions.map(({ field, value }) => ({ name: field.name, value: value as CanonicalValue })))
        : await this.withCalculated(
            target,
            (
              await sql<Record<string, unknown>>`SELECT * FROM ${sql.id(target.table.name)} WHERE ${sql.join(
                conditions.map(({ field, value }) => sql`${sql.id(target.columns.get(field.name) ?? abapName(field.name))} = ${toSql(field.type, value)}`),
                sql` AND `,
              )}`.execute(this.db)
            ).rows.map((record) => this.fromRecord(target, record)),
          );
    const rows = new Map<string, Row>();
    for (const row of read) {
      const id = this.id(target, row);
      const buffered = this.instances.get(id);
      if (buffered === undefined) {
        this.instances.set(id, { bo: target, row, persisted: { ...row }, deleted: false, changed: new Set() });
        rows.set(id, row);
      }
    }
    for (const [id, instance] of this.instances) {
      if (instance.bo !== target || instance.deleted) {
        continue;
      }
      const matches = conditions.every(({ field, value }) => instance.row[field.name] === value);
      if (matches) {
        rows.set(id, instance.row);
      } else {
        rows.delete(id);
      }
    }
    return [...rows.values()];
  }

  // -------------------------------------------------------------------------------------------
  // drafts (D81): the logic of the BO runs on a draft in a transaction whose buffer holds it

  /**
   * Puts an instance of a draft in the buffer, without a change event: a change of its active
   * instance (its image in the database), or a creation when it has none.
   */
  public async seedDraft(bo: BoEntity, row: Row, hasActive: boolean): Promise<void> {
    const key = keyOf(bo, row);
    const persisted = hasActive ? (await this.instance(bo, key))?.persisted : undefined;
    const changed = new Set(persisted === undefined ? bo.fields.map((f) => f.name) : bo.fields.filter((f) => f.expression === undefined && JSON.stringify(row[f.name] ?? null) !== JSON.stringify(persisted[f.name] ?? null)).map((f) => f.name));
    const instance: Instance = { bo, row: { ...(persisted ?? {}), ...row }, deleted: false, changed };
    if (persisted !== undefined) {
      instance.persisted = { ...persisted };
    }
    this.instances.set(this.id(bo, key), instance);
  }

  /** An active instance that the draft removed. */
  public async seedDraftDeletion(bo: BoEntity, key: Row): Promise<void> {
    const instance = await this.instance(bo, key);
    if (instance !== undefined) {
      instance.deleted = true;
    }
  }

  /** A change made on the draft outside the buffer (the draft tables), as a change event: it triggers the determinations. */
  public recordDraftChange(bo: BoEntity, key: Row, kind: "create" | "update", fields: Set<string>): void {
    this.record(bo, keyOf(bo, key), kind, fields);
  }

  /** The instances of the buffer, for the draft tables. */
  public draftInstances(): Array<{ bo: BoEntity; row: Row; deleted: boolean; created: boolean }> {
    return [...this.instances.values()].map((i) => ({ bo: i.bo, row: { ...i.row }, deleted: i.deleted, created: i.persisted === undefined }));
  }

  /**
   * `draft determine action Prepare` (D81): the determinations on save, then the validations it
   * names, for the instances of the draft changed since its active image (or created).
   */
  public async prepare(items: Array<{ bo: BoEntity; kind: "validation" | "determination"; name: string }>, ran: Array<{ bo: BoEntity; validation: string; keys: Row[] }> = []): Promise<Responses> {
    const responses = new Responses();
    for (const kind of ["determination", "validation"] as const) {
      for (const item of items.filter((i) => i.kind === kind)) {
        const definition = (kind === "validation" ? item.bo.behavior.validations : item.bo.behavior.determinations.filter((d) => d.on === "save")).find((d) => same(d.name, item.name));
        if (definition === undefined) {
          continue;
        }
        const keys = this.triggeredInLuw(item.bo, definition.triggers);
        if (keys.length > 0) {
          const result = await this.runDetermination(item.bo, definition, keys, true);
          if (kind === "validation") {
            for (const entry of result.reported) {
              entry.source = definition.name;
            }
            ran.push({ bo: item.bo, validation: definition.name, keys });
          }
          responses.add(result);
        }
      }
    }
    return responses;
  }

  // -------------------------------------------------------------------------------------------
  // checks

  private failure(responses: Responses, bo: BoEntity, failure: Failure, operation?: FailedOperation): void {
    const entry: Responses["failed"][number] = { entity: bo.entity.name, cause: failure.cause };
    if (failure.key !== undefined) {
      entry.key = failure.key;
    }
    if (failure.cid !== undefined) {
      entry.cid = failure.cid;
    }
    if (operation !== undefined) {
      entry.operation = operation;
    }
    responses.failed.push(entry);
  }

  /** Locks the lock master of an existing instance (`SELECT … FOR UPDATE NOWAIT`). */
  private async lock(bo: BoEntity, key: Row): Promise<boolean> {
    let master = bo;
    let masterKey = key;
    for (let depth = 0; depth < 20 && this.bo.lockMaster(master) !== master; depth++) {
      const parent = master.parent;
      if (parent === undefined) {
        break;
      }
      const instance = await this.instance(master, masterKey);
      if (instance === undefined) {
        return true;
      }
      const parentKey: Row = {};
      for (const pair of parent.on) {
        parentKey[parent.target.fields.find((f) => same(f.name, pair.target))?.name ?? pair.target] = instance.row[master.fields.find((f) => same(f.name, pair.source))?.name ?? pair.source] ?? null;
      }
      master = parent.target;
      masterKey = keyOf(master, parentKey);
    }
    const id = this.id(master, masterKey);
    if (this.locked.has(id)) {
      return true;
    }
    const buffered = this.instances.get(id);
    if (buffered !== undefined && buffered.persisted === undefined) {
      this.locked.add(id);
      return true;
    }
    if (master.entity.kind === "custom") {
      // instances of an API: no database lock, the LUWs of the application are serialized (D43)
      this.locked.add(id);
      return true;
    }
    const conditions = master.keys.map((k) => sql`${sql.id(master.columns.get(k.name) ?? abapName(k.name))} = ${toSql(k.type, masterKey[k.name] ?? null)}`);
    try {
      await withSavepoint(this.db, () => sql`SELECT 1 FROM ${sql.id(master.table.name)} WHERE ${sql.join(conditions, sql` AND `)} FOR UPDATE NOWAIT`.execute(this.db));
    } catch (error) {
      if ((error as { code?: string }).code === "55P03") {
        return false;
      }
      throw error;
    }
    this.locked.add(id);
    return true;
  }

  /** Global authorization of operations: the result of the authorization master's handler. */
  private async globalAuthorization(bo: BoEntity, requested: Array<FailedOperation>, mode: AccessMode): Promise<Set<string>> {
    const denied = new Set<string>();
    const master = this.bo.authorizationMaster(bo);
    const handler = master.behavior.globalAuthorizationHandler;
    if (mode.local || mode.privileged || handler === undefined) {
      return denied;
    }
    const request = this.bridge.data(master, derivedType.globalAuthRequest(master.index));
    const result = this.bridge.data(master, derivedType.globalAuthResult(master.index));
    const flags = master === bo ? requested.map(authorizedAs) : [{ kind: "update" as const }];
    for (const op of flags) {
      setFlag(this.operationFlag(request, op), true);
    }
    const failed = this.bridge.response(master, "failed");
    const reported = this.bridge.response(master, "reported");
    await this.call(handler, { requested: request, result, failed, reported });
    for (const op of requested) {
      const checked = master === bo ? authorizedAs(op) : { kind: "update" as const };
      if (isFlagOn(this.operationFlag(result, checked))) {
        denied.add(operationId(op));
      }
    }
    return denied;
  }

  /** Instance authorization: denied operations per instance key (of `bo`). */
  private async instanceAuthorization(bo: BoEntity, keys: Row[], op: FailedOperation, mode: AccessMode): Promise<Set<string>> {
    const denied = new Set<string>();
    const master = this.bo.authorizationMaster(bo);
    const handler = master.behavior.instanceAuthorizationHandler;
    if (mode.local || mode.privileged || handler === undefined || keys.length === 0) {
      return denied;
    }
    const masterKeys = await Promise.all(keys.map((k) => this.masterKey(bo, master, k)));
    const unique = [...new Map(masterKeys.filter((k): k is Row => k !== undefined).map((k) => [keyString(master, k), k])).values()];
    const request = this.bridge.data(master, derivedType.instanceAuthRequest(master.index));
    const checked = master === bo ? authorizedAs(op) : { kind: "update" as const };
    setFlag(this.operationFlag(request, checked), true);
    const result = this.bridge.data(master, derivedType.instanceAuthResult(master.index));
    const failed = this.bridge.response(master, "failed");
    const reported = this.bridge.response(master, "reported");
    await this.call(handler, { keys: this.bridge.keysTable(master, unique), requested: request, result, failed, reported });
    const deniedMasters = new Set<string>();
    for (const row of rowsOf(result)) {
      if (isFlagOn(this.operationFlag(row, checked))) {
        deniedMasters.add(keyString(master, this.bridge.readKey(row, master)));
      }
    }
    keys.forEach((key, i) => {
      const masterKey = masterKeys[i];
      if (masterKey !== undefined && deniedMasters.has(keyString(master, masterKey))) {
        denied.add(keyString(bo, key));
      }
    });
    return denied;
  }

  /** Key of the instance of `master` (an ancestor) that `key` of `bo` belongs to. */
  private async masterKey(bo: BoEntity, master: BoEntity, key: Row): Promise<Row | undefined> {
    let current = bo;
    let currentKey = key;
    for (let depth = 0; depth < 20 && current !== master; depth++) {
      const parent = current.parent;
      const instance = await this.instance(current, currentKey);
      if (parent === undefined || instance === undefined) {
        return undefined;
      }
      const parentKey: Row = {};
      for (const pair of parent.on) {
        parentKey[parent.target.fields.find((f) => same(f.name, pair.target))?.name ?? pair.target] = instance.row[current.fields.find((f) => same(f.name, pair.source))?.name ?? pair.source] ?? null;
      }
      current = parent.target;
      currentKey = keyOf(current, parentKey);
    }
    return current === master ? currentKey : undefined;
  }

  /** Instance feature control: operations disabled per instance, and read-only fields. */
  private async instanceFeatures(bo: BoEntity, keys: Row[], requested: { operations: FailedOperation[]; fields: string[] }, mode: AccessMode): Promise<{ disabled: Set<string>; readonly: Map<string, Set<string>> }> {
    const disabled = new Set<string>();
    const readonly = new Map<string, Set<string>>();
    const handler = bo.behavior.instanceFeaturesHandler;
    if (mode.local || handler === undefined || keys.length === 0) {
      return { disabled, readonly };
    }
    const request = this.bridge.data(bo, derivedType.instanceFeaturesRequest(bo.index));
    for (const op of requested.operations) {
      setFlag(this.operationFlag(request, op), true);
    }
    const fieldRequest = component(request, "%field");
    for (const field of requested.fields) {
      setFlag(fieldRequest === undefined ? undefined : component(fieldRequest, field), true);
    }
    const result = this.bridge.data(bo, derivedType.instanceFeaturesResult(bo.index));
    const failed = this.bridge.response(bo, "failed");
    const reported = this.bridge.response(bo, "reported");
    await this.call(handler, { keys: this.bridge.keysTable(bo, keys), requested: request, result, failed, reported });
    for (const row of rowsOf(result)) {
      const key = keyString(bo, this.bridge.readKey(row, bo));
      for (const op of requested.operations) {
        if (isFlagOn(this.operationFlag(row, op))) {
          disabled.add(`${key}|${operationId(op)}`);
        }
      }
      const fields = component(row, "%field");
      for (const field of requested.fields) {
        const value = fields === undefined ? undefined : component(fields, field);
        const code = value === undefined ? "00" : String(value.get());
        // fc-f-read_only '01' and mandatory_and_read_only '03'
        if (code === "01" || code === "03") {
          const set = readonly.get(key) ?? new Set<string>();
          set.add(field);
          readonly.set(key, set);
        }
      }
    }
    return { disabled, readonly };
  }

  /** Global feature control: disabled operations. */
  private async globalFeatures(bo: BoEntity, requested: FailedOperation[], mode: AccessMode): Promise<Set<string>> {
    const disabled = new Set<string>();
    const handler = bo.behavior.globalFeaturesHandler;
    if (mode.local || handler === undefined) {
      return disabled;
    }
    const request = this.bridge.data(bo, derivedType.globalFeaturesRequest(bo.index));
    for (const op of requested) {
      setFlag(this.operationFlag(request, op), true);
    }
    const result = this.bridge.data(bo, derivedType.globalFeaturesResult(bo.index));
    const failed = this.bridge.response(bo, "failed");
    const reported = this.bridge.response(bo, "reported");
    await this.call(handler, { requested: request, result, failed, reported });
    for (const op of requested) {
      if (isFlagOn(this.operationFlag(result, op))) {
        disabled.add(operationId(op));
      }
    }
    return disabled;
  }

  private operationFlag(structure: AbapData, op: FailedOperation): AbapData | undefined {
    if (op.kind === "action") {
      const action = component(structure, "%action");
      return action === undefined ? undefined : component(action, op.name);
    }
    if (op.kind === "association") {
      const assoc = component(structure, "%assoc");
      return assoc === undefined ? undefined : component(assoc, op.name);
    }
    return component(structure, `%${op.kind}`);
  }

  /** Calls a handler with the parameter names of its definition. */
  private async call(ref: HandlerRef, args: { keys?: AbapData; entities?: AbapData; requested?: AbapData; result?: AbapData; failed?: AbapData; reported?: AbapData; mapped?: AbapData }): Promise<void> {
    const params: Record<string, AbapData> = {};
    for (const [role, value] of Object.entries(args)) {
      if (value !== undefined) {
        params[ref.params[role as keyof HandlerRef["params"]] ?? role] = value;
      }
    }
    await this.bridge.call(ref, params);
  }

  private async precheck(bo: BoEntity, operation: string, entities: AbapData, mode: AccessMode): Promise<Responses> {
    const handler = bo.behavior.precheckHandlers[operation];
    if (handler === undefined || mode.local) {
      return new Responses();
    }
    const failed = this.bridge.response(bo, "failed");
    const reported = this.bridge.response(bo, "reported");
    await this.call(handler, { entities, failed, reported });
    return this.bridge.readResponses(bo, failed, reported);
  }

  // -------------------------------------------------------------------------------------------
  // operations

  private setAdminFields(bo: BoEntity, row: Row, create: boolean, changed: Set<string>): void {
    const now = this.services.now();
    const set = (field: string | undefined, value: string): void => {
      if (field !== undefined) {
        row[field] = value;
        changed.add(field);
      }
    };
    if (create) {
      set(bo.admin.createdBy, this.user.abapName);
      set(bo.admin.createdAt, now);
    }
    set(bo.admin.lastChangedBy, this.user.abapName);
    set(bo.admin.lastChangedAt, now);
    set(bo.admin.localInstanceLastChangedAt, now);
  }

  /** Fields a consumer may not write: read-only, managed numbering, admin fields (outside local mode). */
  private writable(bo: BoEntity, field: string, mode: AccessMode, create: boolean): boolean {
    if (mode.local) {
      return true;
    }
    const characteristics = this.bo.characteristics(bo, field);
    if (characteristics.includes("readonly") || characteristics.includes("numberingManaged")) {
      return false;
    }
    if (!create && characteristics.includes("readonlyUpdate")) {
      return false;
    }
    if (!create && bo.keys.some((k) => k.name === field)) {
      return false;
    }
    return true;
  }

  public async create(bo: BoEntity, requests: CreateRequest[], mode: AccessMode, parent?: { association: BoAssociation; key: Row; numbered?: Map<string, Row>; draftUuid?: string }): Promise<Responses> {
    const responses = new Responses();
    const operation: FailedOperation = { kind: "create" };
    if (parent === undefined && !mode.local && mode.external && bo.behavior.operations.find((o) => o.kind === "create")?.internal === true) {
      throw new RapRuntimeError(`create of ${bo.behavior.alias} is internal`);
    }
    if (parent === undefined) {
      const denied = await this.globalAuthorization(bo, [{ kind: "create" }], mode);
      const disabled = bo.behavior.operations.some((o) => o.kind === "create" && o.features === "global") ? await this.globalFeatures(bo, [{ kind: "create" }], mode) : new Set<string>();
      if (denied.size > 0 || disabled.size > 0) {
        for (const request of requests) {
          this.failure(responses, bo, { cause: denied.size > 0 ? "unauthorized" : "disabled", ...(request.cid === undefined ? {} : { cid: request.cid }) }, operation);
        }
        return responses;
      }
    }
    // early numbering by a handler: of the creation, or of the creation by association (parent)
    let numbered: Map<string, Row> | undefined = parent?.numbered;
    if (parent === undefined && bo.behavior.earlyNumberingHandler !== undefined) {
      numbered = await this.number(bo, requests, responses);
    }
    if (parent === undefined && bo.behavior.operations.some((o) => o.kind === "create" && o.precheck)) {
      const entities = this.createTable(bo, requests);
      responses.add(await this.precheck(bo, "create", entities, mode));
    }
    const prechecked = new Set(responses.failed.filter((f) => f.cid !== undefined).map((f) => f.cid));
    for (const request of requests) {
      if (request.cid !== undefined && prechecked.has(request.cid)) {
        continue;
      }
      const row: Row = {};
      const changed = new Set<string>();
      for (const field of bo.fields) {
        row[field.name] = initialValue(field.type);
      }
      for (const field of request.fields) {
        const model = this.bo.field(bo, field);
        if (model !== undefined && this.writable(bo, model.name, mode, true)) {
          row[model.name] = request.values[model.name] ?? initialValue(model.type);
          changed.add(model.name);
        }
      }
      if (parent !== undefined) {
        // the foreign key of the child comes from the parent (ON condition of the composition)
        for (const pair of parent.association.on) {
          const field = bo.fields.find((f) => same(f.name, pair.target))?.name ?? pair.target;
          row[field] = parent.key[pair.source] ?? null;
          changed.add(field);
        }
      }
      const early = request.cid === undefined ? undefined : numbered?.get(request.cid);
      if (early !== undefined) {
        Object.assign(row, early);
      }
      if (mode.keepKeys === true) {
        for (const key of bo.keys) {
          if (request.values[key.name] !== undefined && request.values[key.name] !== null) {
            row[key.name] = request.values[key.name] ?? null;
            changed.add(key.name);
          }
        }
      }
      for (const field of bo.fields) {
        const characteristics = this.bo.characteristics(bo, field.name);
        if (characteristics.includes("numberingManaged") && (isInitial(field.type, row[field.name]) || (!mode.local && mode.keepKeys !== true))) {
          row[field.name] = randomUUID();
          changed.add(field.name);
        }
      }
      // D109: late numbering, a preliminary key until adjust_numbers (the initial key fields)
      const pid = bo.behavior.lateNumbering === undefined ? undefined : await this.preliminaryKey(bo, row, changed);
      if (!mode.local) {
        const missing = bo.fields.find((f) => this.bo.characteristics(bo, f.name).includes("mandatoryCreate") && isInitial(f.type, row[f.name]));
        if (missing !== undefined) {
          this.failure(responses, bo, { cause: "unspecific", ...(request.cid === undefined ? {} : { cid: request.cid }) }, operation);
          responses.reported.push({
            entity: bo.entity.name,
            ...(request.cid === undefined ? {} : { cid: request.cid }),
            message: { severity: "E", text: `${missing.name} is required` },
            elements: [missing.name],
            global: false,
          });
          continue;
        }
      }
      const key = keyOf(bo, row);
      // D110: %is_draft on in a transaction on the active instances: a new draft
      if (!this.draft && bo.bdef.draft === true && (request.values["%is_draft"] === true || parent?.draftUuid !== undefined)) {
        if (parent === undefined && ((await this.instance(bo, key)) !== undefined || (await this.draftRow(bo, key)) !== undefined)) {
          this.failure(responses, bo, { cause: "conflict", key, ...(request.cid === undefined ? {} : { cid: request.cid }) }, operation);
          continue;
        }
        this.setAdminFields(bo, row, true, changed);
        this.newDrafts.push({ bo, row, uuid: parent?.draftUuid ?? randomUUID() });
        const draftKey = { ...key, "%is_draft": true };
        if (request.cid !== undefined && request.cid !== "") {
          this.cids.set(request.cid, { bo, key: draftKey });
          responses.mapped.push({ entity: bo.entity.name, cid: request.cid, key: draftKey });
        }
        continue;
      }
      if ((await this.instance(bo, key)) !== undefined) {
        this.failure(responses, bo, { cause: "conflict", key, ...(request.cid === undefined ? {} : { cid: request.cid }) }, operation);
        continue;
      }
      this.setAdminFields(bo, row, true, changed);
      const id = this.id(bo, key);
      const previous = this.instances.get(id);
      const instance: Instance = { bo, row, deleted: false, changed, ...(pid === undefined ? {} : { pid }) };
      if (previous?.persisted !== undefined) {
        // re-created after a deletion in the same LUW: an update of the stored row
        instance.persisted = previous.persisted;
      }
      if (request.cid !== undefined && request.cid !== "") {
        instance.cid = request.cid;
        this.cids.set(request.cid, { bo, key });
        responses.mapped.push({ entity: bo.entity.name, cid: request.cid, key: pid === undefined ? key : { ...key, "%pid": pid } });
      }
      this.instances.set(id, instance);
      this.record(bo, key, "create", new Set(changed));
    }
    return responses;
  }

  /** D110: an instance of the draft table of the entity, undefined when there is none. */
  private async draftRow(bo: BoEntity, key: Row): Promise<Row | undefined> {
    const table = bo.behavior.draftTable;
    if (table === undefined) return undefined;
    const where = sql.join(bo.keys.map((k) => sql`${sql.id(k.name)} = ${toSql(k.type, key[k.name] ?? null)}`), sql` AND `);
    const { rows } = await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(table)} WHERE ${where}`.execute(this.db);
    const raw = rows[0];
    if (raw === undefined) return undefined;
    return Object.fromEntries(bo.fields.map((f) => [f.name, f.expression !== undefined ? initialValue(f.type) : fromSql(f.type, raw[f.name])])) as Row;
  }

  /** D110: the drafts created by EML in this transaction: their administrative data and their rows. */
  private async writeNewDrafts(): Promise<void> {
    const user = this.user.abapName;
    for (const uuid of new Set(this.newDrafts.map((d) => d.uuid))) {
      const root = this.newDrafts.find((d) => d.uuid === uuid && d.bo.parent === undefined) ?? this.newDrafts.find((d) => d.uuid === uuid);
      await sql`INSERT INTO "rapt_draft_admin" ("DraftUUID", "CreatedByUser", "LastChangedByUser", "InProcessByUser", "RootEntity") VALUES (${uuid}, ${user}, ${user}, ${user}, ${root?.bo.entity.name ?? ""})`.execute(this.db);
      if (root?.bo.bdef.collaborativeDraft === true) {
        await sql`INSERT INTO "rapt_draft_user" ("DraftUUID", "UserID", "UserDescription", "UserAccessRole") VALUES (${uuid}, ${user}, ${user}, 'O') ON CONFLICT ("DraftUUID", "UserID") DO NOTHING`.execute(this.db);
      }
    }
    for (const { bo, row, uuid } of this.newDrafts) {
      const stored = bo.fields.filter((f) => f.expression === undefined);
      const columns = [...stored.map((f) => sql.id(f.name)), sql.id("DraftUUID"), sql.id("HasActiveEntity")];
      const values = [...stored.map((f) => sql`${toSql(f.type, row[f.name] ?? initialValue(f.type))}`), sql`${uuid}`, sql`${false}`];
      await sql`INSERT INTO ${sql.table(bo.behavior.draftTable ?? "")} (${sql.join(columns)}) VALUES (${sql.join(values)})`.execute(this.db);
    }
  }

  /**
   * D109: the preliminary key of an instance created with late numbering: its initial key fields
   * get values no instance has (negative numbers, the highest NUMC values, `#`-prefixed texts, new
   * UUIDs), replaced by the final key of adjust_numbers in the late save phase. Returns its %pid.
   */
  private async preliminaryKey(bo: BoEntity, row: Row, changed: Set<string>): Promise<string> {
    const pid = (++this.pidCounter).toString(16).toUpperCase().padStart(32, "0");
    const initial = bo.keys.filter((k) => isInitial(k.type, row[k.name]));
    if (initial.length === 0) {
      return pid;
    }
    for (let attempt = 1; attempt < 100_000; attempt++) {
      const n = this.pidCounter + attempt - 1;
      for (const key of initial) {
        row[key.name] = preliminaryValue(key, n);
        changed.add(key.name);
      }
      if ((await this.instance(bo, keyOf(bo, row))) === undefined) {
        return pid;
      }
    }
    throw new RapRuntimeError(`late numbering of ${bo.behavior.alias}: no preliminary key is free`);
  }

  /**
   * D109: the late save phase of late numbering: adjust_numbers of the saver class maps the
   * preliminary identifiers (%pid, %tmp) of the created instances to their final keys; the buffer,
   * the foreign keys of the children and the content IDs take the final keys. A created instance
   * left without final key is a runtime error, as on SAP.
   */
  private async adjustNumbers(): Promise<Responses> {
    const responses = new Responses();
    for (const bdef of new Set(this.bo.entities.map((e) => e.bdef))) {
      const saver = bdef.saver;
      const entities = this.bo.entities.filter((e) => e.bdef === bdef && e.behavior.lateNumbering !== undefined);
      const first = this.bo.entities.find((e) => e.bdef === bdef);
      const created = [...this.instances.values()].filter((i) => i.pid !== undefined && !i.deleted && i.persisted === undefined && entities.includes(i.bo));
      if (saver?.adjustNumbers === undefined || first === undefined || created.length === 0) {
        continue;
      }
      const mapped = this.bridge.response(first, "mapped", true);
      for (const instance of created) {
        appendRow(component(mapped, abapName(instance.bo.behavior.alias)) as AbapData, (row) => {
          component(row, "%pid")?.set(instance.pid ?? "");
          for (const key of instance.bo.keys) {
            const data = component(row, `${key.name}_tmp`);
            if (data !== undefined) setAbapValue(data, key.type, instance.row[key.name] ?? null);
          }
        });
      }
      const reported = this.bridge.response(first, "reported", true);
      const failed = saver.withFailed ? this.bridge.response(first, "failed", true) : undefined;
      this.inSaver = true;
      try {
        await this.bridge.call(saver.adjustNumbers, { mapped, reported, ...(failed === undefined ? {} : { failed }) });
      } finally {
        this.inSaver = false;
      }
      responses.add(await this.bridge.readResponses(first, failed, reported));
      // the final keys, by %pid (or by the preliminary key %tmp)
      const finals = new Map<Instance, Row>();
      for (const bo of entities) {
        for (const row of rowsOf(component(mapped, abapName(bo.behavior.alias)) as AbapData)) {
          const pid = String(component(row, "%pid")?.get() ?? "");
          const tmp: Row = {};
          for (const key of bo.keys) {
            const data = component(row, `${key.name}_tmp`);
            tmp[key.name] = data === undefined ? null : getAbapValue(data, key.type);
          }
          const instance = created.find((i) => i.bo === bo && ((pid !== "" && !/^0+$/.test(pid) && i.pid?.toUpperCase() === pid.toUpperCase()) || keyString(bo, i.row) === keyString(bo, tmp)));
          if (instance !== undefined) {
            finals.set(instance, this.bridge.readKey(row, bo));
          }
        }
      }
      for (const instance of created) {
        const final = finals.get(instance);
        if (final === undefined || instance.bo.keys.every((k) => isInitial(k.type, final[k.name]))) {
          throw new RapRuntimeError(`adjust_numbers gave no final key to an instance of ${instance.bo.behavior.alias} created with late numbering`);
        }
      }
      this.applyFinalKeys(finals);
    }
    return responses;
  }

  /** D109: the buffer under the final keys; the foreign keys of the children follow their parents. */
  private applyFinalKeys(finals: Map<Instance, Row>): void {
    const moves: Array<{ instance: Instance; before: Row; after: Row }> = [];
    for (const [instance, final] of finals) {
      moves.push({ instance, before: keyOf(instance.bo, instance.row), after: keyOf(instance.bo, final) });
    }
    // the foreign keys of the instances whose to-parent association points to a preliminary key;
    // the final key of a child (given by adjust_numbers) is applied afterwards
    for (const { instance, before, after } of moves) {
      for (const other of this.instances.values()) {
        const parent = other.bo.parent;
        if (parent === undefined || parent.target !== instance.bo || other === instance) continue;
        if (parent.on.every((p) => JSON.stringify(other.row[p.source] ?? null) === JSON.stringify(before[p.target] ?? null))) {
          for (const p of parent.on) other.row[p.source] = after[p.target] ?? null;
        }
      }
    }
    for (const { instance, before, after } of moves) {
      const oldId = this.id(instance.bo, before);
      Object.assign(instance.row, after);
      this.instances.delete(oldId);
      this.instances.set(this.id(instance.bo, after), instance);
      this.renumbered.set(oldId, after);
      if (instance.cid !== undefined) {
        this.cids.set(instance.cid, { bo: instance.bo, key: after });
      }
    }
  }

  /** D109: the final key of an instance created with late numbering, after the save (else the key itself). */
  public finalKey(bo: BoEntity, key: Row): Row {
    return this.renumbered.get(this.id(bo, key)) ?? key;
  }

  private createTable(bo: BoEntity, requests: CreateRequest[]): AbapData {
    const table = this.bridge.data(bo, derivedType.create(bo.index));
    for (const request of requests) {
      appendRow(table, (row) => {
        component(row, "%cid")?.set(request.cid ?? "");
        this.bridge.fillRow(row, bo, request.values, request.fields);
        this.bridge.fillControl(row, bo, request.fields);
      });
    }
    return table;
  }

  /** Early numbering by the FOR NUMBERING handler: %cid → key. */
  private async number(bo: BoEntity, requests: CreateRequest[], responses: Responses): Promise<Map<string, Row>> {
    const handler = bo.behavior.earlyNumberingHandler as HandlerRef;
    const entities = this.createTable(bo, requests);
    const mapped = this.bridge.response(bo, "mapped");
    const failed = this.bridge.response(bo, "failed");
    const reported = this.bridge.response(bo, "reported");
    await this.call(handler, { entities, mapped, failed, reported });
    const result = await this.bridge.readResponses(bo, failed, reported, mapped);
    responses.failed.push(...result.failed);
    responses.reported.push(...result.reported);
    return new Map(result.mapped.filter((m) => m.entity === bo.entity.name).map((m) => [m.cid, m.key]));
  }

  /**
   * Early numbering of a creation by association (`FOR NUMBERING … FOR CREATE Travel\_Booking`):
   * the handler gets the parent instances with their %target, and maps the %cid of the children.
   */
  private async numberByAssociation(bo: BoEntity, association: BoAssociation, parents: Array<{ key: Row; targets: CreateRequest[] }>, responses: Responses): Promise<Map<string, Row>> {
    const handler = association.behavior?.earlyNumberingHandler as HandlerRef;
    const entities = this.bridge.data(bo, derivedType.assocCreate(bo.index, association.index));
    for (const { key, targets } of parents) {
      appendRow(entities, (row) => {
        this.bridge.fillKey(row, bo, key);
        const target = component(row, "%target");
        for (const t of targets) {
          appendRow(target, (r) => {
            component(r, "%cid")?.set(t.cid ?? "");
            this.bridge.fillRow(r, association.target, t.values, t.fields);
            this.bridge.fillControl(r, association.target, t.fields);
          });
        }
      });
    }
    const mapped = this.bridge.response(bo, "mapped");
    const failed = this.bridge.response(bo, "failed");
    const reported = this.bridge.response(bo, "reported");
    await this.call(handler, { entities, mapped, failed, reported });
    const result = await this.bridge.readResponses(bo, failed, reported, mapped);
    responses.failed.push(...result.failed);
    responses.reported.push(...result.reported);
    return new Map(result.mapped.filter((m) => m.entity === association.target.entity.name).map((m) => [m.cid, m.key]));
  }

  public async update(bo: BoEntity, requests: UpdateRequest[], mode: AccessMode): Promise<Responses> {
    const responses = new Responses();
    const operation: FailedOperation = { kind: "update" };
    if (!mode.local && mode.external && bo.behavior.operations.find((o) => o.kind === "update")?.internal === true) {
      throw new RapRuntimeError(`update of ${bo.behavior.alias} is internal`);
    }
    const targets: Array<{ request: UpdateRequest; key: Row; instance: Instance }> = [];
    for (const request of requests) {
      const key = this.resolveKey(bo, request.key, request.cidRef);
      const instance = key === undefined ? undefined : await this.instance(bo, key);
      if (key === undefined || instance === undefined) {
        this.failure(responses, bo, { cause: "not_found", ...(key === undefined ? {} : { key }), ...(request.cidRef === undefined ? {} : { cid: request.cidRef }) }, operation);
        continue;
      }
      targets.push({ request, key, instance });
    }
    const keys = targets.map((t) => t.key);
    const denied = await this.globalAuthorization(bo, [operation], mode);
    const deniedInstances = await this.instanceAuthorization(bo, keys, operation, mode);
    const dynamicFields = bo.fields.filter((f) => this.bo.characteristics(bo, f.name).includes("featuresInstance")).map((f) => f.name);
    const updateDynamic = bo.behavior.operations.some((o) => o.kind === "update" && o.features === "instance");
    const features = await this.instanceFeatures(bo, keys, { operations: updateDynamic ? [operation] : [], fields: dynamicFields }, mode);
    const globalDisabled = bo.behavior.operations.some((o) => o.kind === "update" && o.features === "global") ? await this.globalFeatures(bo, [operation], mode) : new Set<string>();
    if (bo.behavior.operations.some((o) => o.kind === "update" && o.precheck) && !mode.local) {
      const table = this.bridge.data(bo, derivedType.update(bo.index));
      for (const { request, key } of targets) {
        appendRow(table, (row) => {
          this.bridge.fillRow(row, bo, { ...request.values, ...key }, [...request.fields, ...bo.keys.map((k) => k.name)]);
          this.bridge.fillControl(row, bo, request.fields);
        });
      }
      responses.add(await this.precheck(bo, "update", table, mode));
    }
    const prechecked = new Set(responses.failed.map((f) => (f.key === undefined ? "" : keyString(bo, f.key))));
    for (const { request, key, instance } of targets) {
      const k = keyString(bo, key);
      if (prechecked.has(k)) {
        continue;
      }
      const cause: FailCause | undefined =
        denied.size > 0 || deniedInstances.has(k) ? "unauthorized" : globalDisabled.size > 0 || features.disabled.has(`${k}|update`) ? "disabled" : undefined;
      if (cause !== undefined) {
        this.failure(responses, bo, { cause, key }, operation);
        continue;
      }
      const readonly = features.readonly.get(k);
      const blocked = [...request.fields].find((f) => readonly?.has(f) === true);
      if (blocked !== undefined) {
        this.failure(responses, bo, { cause: "readonly", key }, operation);
        responses.reported.push({ entity: bo.entity.name, key, message: { severity: "E", text: `${blocked} is read-only` }, elements: [blocked], global: false });
        continue;
      }
      if (!(await this.lock(bo, key))) {
        this.failure(responses, bo, { cause: "locked", key }, operation);
        continue;
      }
      const changed = new Set<string>();
      for (const field of request.fields) {
        const model = this.bo.field(bo, field);
        if (model === undefined || model.key || !this.writable(bo, model.name, mode, false)) {
          continue;
        }
        instance.row[model.name] = request.values[model.name] ?? initialValue(model.type);
        changed.add(model.name);
      }
      this.setAdminFields(bo, instance.row, false, changed);
      for (const f of changed) {
        instance.changed.add(f);
      }
      this.record(bo, key, "update", changed);
    }
    return responses;
  }

  public async delete(bo: BoEntity, requests: DeleteRequest[], mode: AccessMode): Promise<Responses> {
    const responses = new Responses();
    const operation: FailedOperation = { kind: "delete" };
    if (!mode.local && mode.external && bo.behavior.operations.find((o) => o.kind === "delete")?.internal === true) {
      throw new RapRuntimeError(`delete of ${bo.behavior.alias} is internal`);
    }
    const targets: Array<{ key: Row; instance: Instance }> = [];
    for (const request of requests) {
      const key = this.resolveKey(bo, request.key, request.cidRef);
      const instance = key === undefined ? undefined : await this.instance(bo, key);
      if (key === undefined || instance === undefined) {
        this.failure(responses, bo, { cause: "not_found", ...(key === undefined ? {} : { key }) }, operation);
        continue;
      }
      targets.push({ key, instance });
    }
    const keys = targets.map((t) => t.key);
    const denied = await this.globalAuthorization(bo, [operation], mode);
    const deniedInstances = await this.instanceAuthorization(bo, keys, operation, mode);
    const deleteDynamic = bo.behavior.operations.some((o) => o.kind === "delete" && o.features === "instance");
    const features = deleteDynamic ? await this.instanceFeatures(bo, keys, { operations: [operation], fields: [] }, mode) : { disabled: new Set<string>(), readonly: new Map<string, Set<string>>() };
    const globalDisabled = bo.behavior.operations.some((o) => o.kind === "delete" && o.features === "global") ? await this.globalFeatures(bo, [operation], mode) : new Set<string>();
    if (bo.behavior.operations.some((o) => o.kind === "delete" && o.precheck) && !mode.local) {
      responses.add(await this.precheck(bo, "delete", this.bridge.keysTable(bo, keys, derivedType.delete(bo.index)), mode));
    }
    const prechecked = new Set(responses.failed.map((f) => (f.key === undefined ? "" : keyString(bo, f.key))));
    for (const { key, instance } of targets) {
      const k = keyString(bo, key);
      if (prechecked.has(k)) {
        continue;
      }
      const cause: FailCause | undefined =
        denied.size > 0 || deniedInstances.has(k) ? "unauthorized" : globalDisabled.size > 0 || features.disabled.has(`${k}|delete`) ? "disabled" : undefined;
      if (cause !== undefined) {
        this.failure(responses, bo, { cause, key }, operation);
        continue;
      }
      if (!(await this.lock(bo, key))) {
        this.failure(responses, bo, { cause: "locked", key }, operation);
        continue;
      }
      await this.cascade(bo, instance);
    }
    return responses;
  }

  /** Deletes an instance and its composition children. */
  private async cascade(bo: BoEntity, instance: Instance): Promise<void> {
    for (const composition of bo.compositions) {
      for (const child of await this.associated(bo, composition, instance.row)) {
        const childInstance = await this.instance(composition.target, keyOf(composition.target, child));
        if (childInstance !== undefined) {
          await this.cascade(composition.target, childInstance);
        }
      }
    }
    instance.deleted = true;
    this.record(bo, keyOf(bo, instance.row), "delete", new Set());
  }

  public async createByAssociation(bo: BoEntity, association: BoAssociation, requests: CreateByAssociationRequest[], mode: AccessMode): Promise<Responses> {
    const responses = new Responses();
    const operation: FailedOperation = { kind: "association", name: association.name };
    if (!mode.local && mode.external && (association.behavior?.createInternal === true || association.behavior?.create !== true)) {
      throw new RapRuntimeError(`create by association ${bo.behavior.alias}\\${association.name} is not allowed`);
    }
    const targets: Array<{ request: CreateByAssociationRequest; key: Row; instance: Instance }> = [];
    for (const request of requests) {
      const key = this.resolveKey(bo, request.key, request.cidRef);
      // D110: the children of a draft created by EML in this transaction are drafts too
      const pending = key === undefined ? undefined : this.newDrafts.find((d) => d.bo === bo && keyString(bo, d.row) === keyString(bo, key));
      if (pending !== undefined && !this.draft) {
        const parentKey: Row = {};
        for (const pair of association.on) parentKey[pair.source] = pending.row[pair.source] ?? null;
        responses.add(await this.create(association.target, request.targets, mode, { association, key: parentKey, draftUuid: pending.uuid }));
        continue;
      }
      const instance = key === undefined ? undefined : await this.instance(bo, key);
      if (key === undefined || instance === undefined) {
        this.failure(responses, bo, { cause: "not_found", ...(key === undefined ? {} : { key }) }, operation);
        for (const target of request.targets) {
          this.failure(responses, association.target, { cause: "dependency", ...(target.cid === undefined ? {} : { cid: target.cid }) }, { kind: "create" });
        }
        continue;
      }
      targets.push({ request, key, instance });
    }
    const keys = targets.map((t) => t.key);
    const denied = await this.globalAuthorization(bo, [operation], mode);
    const deniedInstances = await this.instanceAuthorization(bo, keys, operation, mode);
    const dynamic = association.behavior?.createFeatures === "instance";
    const features = dynamic ? await this.instanceFeatures(bo, keys, { operations: [operation], fields: [] }, mode) : { disabled: new Set<string>(), readonly: new Map<string, Set<string>>() };
    if (association.behavior?.createPrecheck === true && !mode.local) {
      const table = this.bridge.data(bo, derivedType.assocCreate(bo.index, association.index));
      for (const { request, key } of targets) {
        appendRow(table, (row) => {
          this.bridge.fillKey(row, bo, key);
          const target = component(row, "%target");
          for (const t of request.targets) {
            appendRow(target, (r) => {
              component(r, "%cid")?.set(t.cid ?? "");
              this.bridge.fillRow(r, association.target, t.values, t.fields);
              this.bridge.fillControl(r, association.target, t.fields);
            });
          }
        });
      }
      responses.add(await this.precheck(bo, `create:${association.name.toLowerCase()}`, table, mode));
    }
    const prechecked = new Set(responses.failed.map((f) => (f.key === undefined ? "" : keyString(bo, f.key))));
    const allowed: typeof targets = [];
    for (const target of targets) {
      const k = keyString(bo, target.key);
      if (prechecked.has(k)) {
        continue;
      }
      const cause: FailCause | undefined = denied.size > 0 || deniedInstances.has(k) ? "unauthorized" : features.disabled.has(`${k}|${operationId(operation)}`) ? "disabled" : undefined;
      const locked = cause === undefined ? await this.lock(bo, target.key) : true;
      if (cause !== undefined || !locked) {
        this.failure(responses, bo, { cause: cause ?? "locked", key: target.key }, operation);
        for (const child of target.request.targets) {
          this.failure(responses, association.target, { cause: "dependency", ...(child.cid === undefined ? {} : { cid: child.cid }) }, { kind: "create" });
        }
        continue;
      }
      allowed.push(target);
    }
    // early numbering of the children: one call of the handler for all the parents
    const numbered =
      association.behavior?.earlyNumberingHandler === undefined || allowed.length === 0
        ? undefined
        : await this.numberByAssociation(bo, association, allowed.map((t) => ({ key: t.key, targets: t.request.targets })), responses);
    const refused = new Set(responses.failed.filter((f) => f.entity === association.target.entity.name && f.cid !== undefined).map((f) => f.cid));
    for (const { request, instance } of allowed) {
      const parentKey: Row = {};
      for (const pair of association.on) {
        parentKey[pair.source] = instance.row[bo.fields.find((f) => same(f.name, pair.source))?.name ?? pair.source] ?? null;
      }
      const children = request.targets.filter((t) => t.cid === undefined || !refused.has(t.cid));
      responses.add(await this.create(association.target, children, mode, { association, key: parentKey, ...(numbered === undefined ? {} : { numbered }) }));
    }
    return responses;
  }

  // -------------------------------------------------------------------------------------------
  // reads

  public async read(bo: BoEntity, keys: Array<{ key: Row; cidRef?: string }>): Promise<{ rows: Array<Row | undefined>; responses: Responses }> {
    const responses = new Responses();
    const rows: Array<Row | undefined> = [];
    for (const { key: given, cidRef } of keys) {
      const key = this.resolveKey(bo, given, cidRef);
      // D110: the other image (%is_draft): the draft of an active transaction, the active instance of a draft one
      const wanted = given["%is_draft"] ?? key?.["%is_draft"];
      if (typeof wanted === "boolean" && wanted !== this.draft && bo.bdef.draft === true && key !== undefined) {
        const plain = keyOf(bo, key);
        const other = wanted ? (this.newDrafts.find((d) => d.bo === bo && keyString(bo, d.row) === keyString(bo, plain))?.row ?? (await this.draftRow(bo, plain))) : await this.load(bo, plain);
        if (other === undefined) {
          this.failure(responses, bo, { cause: "not_found", key: plain });
        }
        rows.push(other === undefined ? undefined : { ...other, "%is_draft": wanted });
        continue;
      }
      const instance = key === undefined ? undefined : await this.instance(bo, key);
      if (instance === undefined) {
        this.failure(responses, bo, { cause: "not_found", ...(key === undefined ? {} : { key }) });
        rows.push(undefined);
        continue;
      }
      rows.push({ ...instance.row });
    }
    return { rows, responses };
  }

  public async readByAssociation(bo: BoEntity, association: BoAssociation, keys: Row[]): Promise<{ results: Array<{ source: Row; target: Row }>; responses: Responses }> {
    const responses = new Responses();
    const results: Array<{ source: Row; target: Row }> = [];
    for (const given of keys) {
      const key = keyOf(bo, given);
      const instance = await this.instance(bo, key);
      if (instance === undefined) {
        this.failure(responses, bo, { cause: "not_found", key }, { kind: "association", name: association.name });
        continue;
      }
      for (const target of await this.associated(bo, association, instance.row)) {
        results.push({ source: key, target: { ...target } });
      }
    }
    return { results, responses };
  }

  // -------------------------------------------------------------------------------------------
  // actions and functions

  public async execute(bo: BoEntity, action: ActionModel, requests: ActionRequest[], mode: AccessMode): Promise<{ results: ActionResult[]; responses: Responses }> {
    const responses = new Responses();
    const results: ActionResult[] = [];
    const operation: FailedOperation = { kind: "action", name: action.name };
    if (!mode.local && mode.external && action.internal) {
      throw new RapRuntimeError(`${action.kind} ${bo.behavior.alias}~${action.name} is internal`);
    }
    if (action.handler === undefined) {
      throw new RapRuntimeError(`no handler for ${bo.behavior.alias}~${action.name}`);
    }
    const actionIndex = bo.behavior.actions.indexOf(action) + 1;
    const accepted: Array<{ request: ActionRequest; key?: Row }> = [];
    for (const request of requests) {
      if (action.static) {
        accepted.push({ request });
        continue;
      }
      const key = this.resolveKey(bo, request.key, request.cidRef);
      const instance = key === undefined ? undefined : await this.instance(bo, key);
      if (key === undefined || instance === undefined) {
        this.failure(responses, bo, { cause: "not_found", ...(key === undefined ? {} : { key }) }, operation);
        continue;
      }
      accepted.push({ request, key });
    }
    const keys = accepted.map((a) => a.key).filter((k): k is Row => k !== undefined);
    const denied = await this.globalAuthorization(bo, [operation], mode);
    const deniedInstances = action.static ? new Set<string>() : await this.instanceAuthorization(bo, keys, operation, mode);
    const features = action.features === "instance" ? await this.instanceFeatures(bo, keys, { operations: [operation], fields: [] }, mode) : { disabled: new Set<string>(), readonly: new Map<string, Set<string>>() };
    const globalDisabled = action.features === "global" ? await this.globalFeatures(bo, [operation], mode) : new Set<string>();
    const run: Array<{ request: ActionRequest; key?: Row }> = [];
    for (const item of accepted) {
      const k = item.key === undefined ? "" : keyString(bo, item.key);
      const cause: FailCause | undefined = denied.size > 0 || deniedInstances.has(k) ? "unauthorized" : globalDisabled.size > 0 || features.disabled.has(`${k}|${operationId(operation)}`) ? "disabled" : undefined;
      if (cause !== undefined) {
        this.failure(responses, bo, { cause, ...(item.key === undefined ? {} : { key: item.key }), ...(item.request.cid === undefined ? {} : { cid: item.request.cid }) }, operation);
        continue;
      }
      if (action.kind === "action" && item.key !== undefined && !(await this.lock(bo, item.key))) {
        this.failure(responses, bo, { cause: "locked", key: item.key }, operation);
        continue;
      }
      run.push(item);
    }
    if (run.length === 0) {
      return { results, responses };
    }
    const parameterEntity = action.parameter === undefined || action.parameter === "$self" ? undefined : this.bo.model.entities.find((e) => same(e.name, action.parameter ?? ""));
    const importTable = this.bridge.data(bo, derivedType.actionImport(bo.index, actionIndex));
    for (const item of run) {
      appendRow(importTable, (row) => {
        if (item.key !== undefined) {
          this.bridge.fillKey(row, bo, item.key);
        }
        component(row, action.factory || action.static ? "%cid" : "%cid_ref")?.set((action.factory || action.static ? item.request.cid : item.request.cidRef) ?? "");
        if (parameterEntity !== undefined) {
          this.bridge.fillParameter(row, parameterEntity.fields, item.request.param);
        }
      });
    }
    if (action.precheck && !mode.local) {
      responses.add(await this.precheck(bo, `action:${action.name.toLowerCase()}`, importTable, mode));
    }
    const result = action.result === undefined ? undefined : this.bridge.data(bo, derivedType.actionResult(bo.index, actionIndex));
    const mapped = this.bridge.response(bo, "mapped");
    const failed = this.bridge.response(bo, "failed");
    const reported = this.bridge.response(bo, "reported");
    await this.call(action.handler, { keys: importTable, ...(result === undefined ? {} : { result }), ...(action.kind === "action" ? { mapped } : {}), failed, reported });
    responses.add(await this.bridge.readResponses(bo, failed, reported, action.kind === "action" ? mapped : undefined));
    for (const m of responses.mapped) {
      const target = this.bo.find(m.entity);
      if (target !== undefined && m.cid !== "") {
        this.cids.set(m.cid, { bo: target, key: m.key });
      }
    }
    const resultEntity = action.result === undefined || action.result.entity === "$self" ? bo : this.bo.find(action.result.entity);
    const abstractResult = action.result !== undefined && resultEntity === undefined ? this.bo.model.entities.find((e) => same(e.name, action.result?.entity ?? "")) : undefined;
    for (const row of rowsOf(result)) {
      const entry: ActionResult = {};
      if (!action.static) {
        entry.key = this.bridge.readKey(row, bo);
      }
      const cid = this.bridge.readText(row, action.static ? "%cid" : "%cid_ref");
      if (cid !== "") {
        if (action.static) {
          entry.cid = cid;
        } else {
          entry.cidRef = cid;
        }
      }
      const param = component(row, "%param");
      if (param !== undefined && resultEntity !== undefined) {
        entry.value = this.bridge.readRow(param, resultEntity);
      } else if (param !== undefined && abstractResult !== undefined) {
        entry.value = this.bridge.readParameter(row, abstractResult.fields);
      }
      results.push(entry);
    }
    return { results, responses };
  }

  // -------------------------------------------------------------------------------------------
  // determinations and validations

  private matches(triggers: TriggerModel, kind: ChangeEvent["kind"], fields: Set<string>): boolean {
    if (kind === "delete") {
      return triggers.delete;
    }
    if (kind === "create" && triggers.create) {
      return true;
    }
    if (kind === "update" && triggers.update) {
      return true;
    }
    return triggers.fields.some((f) => [...fields].some((g) => same(f, g)));
  }

  /** Keys of the instances whose triggers were touched since `since`, not by `id` itself. */
  private triggered(bo: BoEntity, triggers: TriggerModel, since: number, id: string): Row[] {
    const keys = new Map<string, Row>();
    for (const event of this.events) {
      if (event.seq <= since || event.bo !== bo || event.source === id) {
        continue;
      }
      if (this.matches(triggers, event.kind, event.fields)) {
        keys.set(keyString(bo, event.key), event.key);
      }
    }
    return [...keys.values()].filter((key) => {
      const instance = this.instances.get(this.id(bo, key));
      return triggers.delete || (instance !== undefined && !instance.deleted);
    });
  }

  /** Keys of the instances changed in the LUW in a way that matches the triggers. */
  private triggeredInLuw(bo: BoEntity, triggers: TriggerModel): Row[] {
    const result: Row[] = [];
    for (const instance of this.instances.values()) {
      if (instance.bo !== bo) {
        continue;
      }
      const created = instance.persisted === undefined;
      if (instance.deleted) {
        if (triggers.delete && !created) {
          result.push(keyOf(bo, instance.row));
        }
        continue;
      }
      if (instance.changed.size === 0 && !created) {
        continue;
      }
      if (this.matches(triggers, created ? "create" : "update", instance.changed)) {
        result.push(keyOf(bo, instance.row));
      }
    }
    return result;
  }

  private async runDetermination(bo: BoEntity, determination: DeterminationModel | ValidationModel, keys: Row[], late: boolean): Promise<Responses> {
    if (determination.handler === undefined) {
      return new Responses();
    }
    const failed = this.bridge.response(bo, "failed", late);
    const reported = this.bridge.response(bo, "reported", late);
    const previous = this.source;
    this.source = `${bo.entity.name}~${determination.name}`;
    try {
      await this.call(determination.handler, { keys: this.bridge.keysTable(bo, keys), failed, reported });
    } finally {
      this.source = previous;
    }
    return this.bridge.readResponses(bo, failed, reported);
  }

  /** Determinations on modify, by rounds (D21). Called at the end of each modify request. */
  public async determineOnModify(): Promise<Responses> {
    return this.determine("modify");
  }

  private async determine(on: "modify" | "save"): Promise<Responses> {
    const responses = new Responses();
    const start = this.seq;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let ran = false;
      for (const bo of this.bo.entities) {
        for (const determination of bo.behavior.determinations.filter((d) => d.on === on)) {
          const id = `${on}:${bo.entity.name}~${determination.name}`;
          const source = `${bo.entity.name}~${determination.name}`;
          let keys: Row[];
          if (on === "save" && !this.seen.has(id)) {
            keys = this.triggeredInLuw(bo, determination.triggers);
          } else {
            keys = this.triggered(bo, determination.triggers, this.seen.get(id) ?? (on === "save" ? start : 0), source);
          }
          this.seen.set(id, this.seq);
          if (keys.length === 0) {
            continue;
          }
          ran = true;
          responses.add(await this.runDetermination(bo, determination, keys, on === "save"));
          this.seen.set(id, Math.max(this.seen.get(id) ?? 0, this.seq));
        }
      }
      if (!ran) {
        return responses;
      }
    }
    throw new RapRuntimeError(`the determinations on ${on} did not end after ${MAX_ROUNDS} rounds`);
  }

  // -------------------------------------------------------------------------------------------
  // save

  /** The save sequence: determinations on save, validations; the write when nothing failed. */
  public async save(): Promise<Responses> {
    if (this.saved) {
      throw new RapRuntimeError("the transaction is already saved");
    }
    const responses = await this.determine("save");
    if (this.bo.model.mode === "enhanced") {
      responses.add(this.checkMandatory());
    }
    for (const bo of this.bo.entities) {
      for (const validation of bo.behavior.validations) {
        const keys = this.triggeredInLuw(bo, validation.triggers);
        if (keys.length > 0) {
          responses.add(await this.runDetermination(bo, validation, keys, true));
        }
      }
    }
    if (responses.hasFailed) {
      return responses;
    }
    // D109: the late save phase, the final keys of late numbering
    responses.add(await this.adjustNumbers());
    await this.refreshEtagMasters();
    await this.write();
    await this.writeNewDrafts();
    // additional and unmanaged save: save_modified, whose failed (cl_abap_behavior_saver_failed)
    // makes the caller roll the LUW back
    responses.add(await this.saveModified());
    // D109: the cleanup of a saver class with late numbering only
    for (const bdef of new Set(this.bo.entities.map((e) => e.bdef))) {
      const saver = bdef.saver;
      if (saver?.adjustNumbers !== undefined && saver.saveModified === undefined && saver.cleanup !== undefined) {
        await this.bridge.call(saver.cleanup, {});
      }
    }
    this.saved = !responses.hasFailed;
    return responses;
  }

  /**
   * Enhanced mode (D45): `field ( mandatory )` is checked when saving, as a validation on save
   * would (on SAP, the mandatory characteristic is only a hint for the consumer, D20): each
   * created or changed instance with an initial mandatory field fails, with a message per field.
   */
  private checkMandatory(): Responses {
    const responses = new Responses();
    for (const instance of this.instances.values()) {
      const created = instance.persisted === undefined;
      if (instance.deleted || (!created && instance.changed.size === 0)) {
        continue;
      }
      const bo = instance.bo;
      const missing = bo.fields.filter((field) => {
        const characteristics = this.bo.characteristics(bo, field.name);
        return (characteristics.includes("mandatory") || (created && characteristics.includes("mandatoryCreate"))) && isInitial(field.type, instance.row[field.name]);
      });
      if (missing.length === 0) {
        continue;
      }
      const key = keyOf(bo, instance.row);
      this.failure(responses, bo, { cause: "unspecific", key });
      for (const field of missing) {
        const label = getAnnotation(field.annotations, "EndUserText.label");
        responses.reported.push({
          entity: bo.entity.name,
          key,
          message: { severity: "E", text: `${typeof label === "string" ? label : field.name} is mandatory` },
          elements: [field.name],
          global: false,
        });
      }
    }
    return responses;
  }

  /** The changes of the LUW for save_modified: created, updated and deleted instances. */
  private changes(bo: BoEntity): { created: Instance[]; updated: Instance[]; deleted: Instance[] } {
    const result = { created: [] as Instance[], updated: [] as Instance[], deleted: [] as Instance[] };
    for (const instance of this.instances.values()) {
      if (instance.bo !== bo) {
        continue;
      }
      if (instance.deleted) {
        if (instance.persisted !== undefined) {
          result.deleted.push(instance);
        }
      } else if (instance.persisted === undefined) {
        result.created.push(instance);
      } else if (instance.changed.size > 0) {
        result.updated.push(instance);
      }
    }
    return result;
  }

  /**
   * `INSERT|UPDATE|MODIFY|DELETE dbtab FROM [TABLE] @source [INDICATORS SET STRUCTURE %control]
   * MAPPING FROM ENTITY` in save_modified: the rows of the entity are written to the table of its
   * BDEF mapping. sy-subrc 4 when a row is not found (UPDATE, DELETE) or already there (INSERT of
   * a work area); an INSERT FROM TABLE with a duplicate key is a runtime error, as in ABAP.
   */
  public async writeMapped(bo: BoEntity, operation: string, rows: Array<{ values: Row; control: Set<string> | undefined }>, single: boolean, indicators: boolean): Promise<{ subrc: number; dbcnt: number }> {
    if (!this.inSaver) {
      throw new RapRuntimeError(`${operation} on a database table is only possible in save_modified (with additional or unmanaged save)`);
    }
    const mapped = bo.mapped;
    if (mapped === undefined) {
      throw new RapRuntimeError(`${bo.entity.name} has no table mapping`);
    }
    const columns = [...mapped.columns.entries()].map(([field, column]) => ({ field, column, type: (this.bo.field(bo, field) as FieldModel).type, key: bo.keys.some((k) => k.name === field) }));
    return this.writeRows(mapped.table.name, columns, operation, rows, single, indicators);
  }

  /**
   * `INSERT|UPDATE|MODIFY|DELETE dbtab FROM [TABLE] @source` in save_modified, without MAPPING FROM
   * ENTITY (D102): the rows are read from the ABAP structures by the columns of the table, with
   * their exact values (the transpiler would pass packed numbers through JavaScript numbers, and
   * drops the work area of DELETE dbtab FROM @wa).
   */
  public async writeTable(table: TableModel, operation: string, rows: Row[], single: boolean): Promise<{ subrc: number; dbcnt: number }> {
    if (!this.inSaver) {
      throw new RapRuntimeError(`${operation} on a database table is only possible in save_modified (with additional or unmanaged save)`);
    }
    const columns = table.columns.filter((c) => !c.client).map((c) => ({ field: c.name, column: c.name, type: c.type, key: c.key }));
    return this.writeRows(table.name, columns, operation, rows.map((values) => ({ values, control: undefined })), single, false);
  }

  /**
   * Writes rows to a table: sy-subrc 4 when a row is not found (UPDATE, DELETE) or already there
   * (INSERT of a work area); an INSERT FROM TABLE with a duplicate key is a runtime error, as in ABAP.
   */
  private async writeRows(
    tableName: string,
    columns: Array<{ field: string; column: string; type: FieldModel["type"]; key: boolean }>,
    operation: string,
    rows: Array<{ values: Row; control: Set<string> | undefined }>,
    single: boolean,
    indicators: boolean,
  ): Promise<{ subrc: number; dbcnt: number }> {
    const table = sql.id(tableName);
    let dbcnt = 0;
    let missing = false;
    for (const { values, control } of rows) {
      const value = (c: (typeof columns)[number]) => toSql(c.type, values[c.field] ?? null);
      const where = sql.join(columns.filter((c) => c.key).map((c) => sql`${sql.id(c.column)} = ${value(c)}`), sql` AND `);
      const names = sql.join(columns.map((c) => sql.id(c.column)));
      const list = sql.join(columns.map((c) => value(c)));
      if (operation === "INSERT") {
        try {
          await withSavepoint(this.db, () => sql`INSERT INTO ${table} (${names}) VALUES (${list})`.execute(this.db));
          dbcnt++;
        } catch (error) {
          if ((error as { code?: string }).code !== "23505") {
            throw error;
          }
          if (!single) {
            throw new RapRuntimeError(`INSERT ${tableName} FROM TABLE: a row with the same key exists (CX_SY_OPEN_SQL_DB)`);
          }
          missing = true;
        }
      } else if (operation === "UPDATE") {
        const sets = columns.filter((c) => !c.key && (!indicators || control?.has(c.field) === true)).map((c) => sql`${sql.id(c.column)} = ${value(c)}`);
        if (sets.length === 0) {
          continue;
        }
        const result = await sql`UPDATE ${table} SET ${sql.join(sets)} WHERE ${where}`.execute(this.db);
        const count = Number(result.numAffectedRows ?? 0n);
        dbcnt += count;
        missing ||= count === 0;
      } else if (operation === "MODIFY") {
        const keys = sql.join(columns.filter((c) => c.key).map((c) => sql.id(c.column)));
        const sets = columns.filter((c) => !c.key).map((c) => sql`${sql.id(c.column)} = EXCLUDED.${sql.id(c.column)}`);
        await sql`INSERT INTO ${table} (${names}) VALUES (${list}) ON CONFLICT (${keys}) DO ${sets.length === 0 ? sql`NOTHING` : sql`UPDATE SET ${sql.join(sets)}`}`.execute(this.db);
        dbcnt++;
      } else if (operation === "DELETE") {
        const result = await sql`DELETE FROM ${table} WHERE ${where}`.execute(this.db);
        const count = Number(result.numAffectedRows ?? 0n);
        dbcnt += count;
        missing ||= count === 0;
      } else {
        throw new RapRuntimeError(`unknown ABAP SQL operation ${operation}`);
      }
    }
    return { subrc: missing ? 4 : 0, dbcnt };
  }

  /** save_modified (and cleanup) of the BDEFs with additional or unmanaged save. */
  private async saveModified(): Promise<Responses> {
    const responses = new Responses();
    for (const bdef of new Set(this.bo.entities.map((e) => e.bdef))) {
      const saver = bdef.saver;
      const entities = this.bo.entities.filter((e) => e.bdef === bdef && e.saving !== "managed");
      const first = entities[0];
      if (saver?.saveModified === undefined || first === undefined) {
        continue;
      }
      const create = this.bridge.data(first, derivedType.requestChange);
      const update = this.bridge.data(first, derivedType.requestChange);
      const remove = this.bridge.data(first, derivedType.requestDelete);
      let changed = false;
      for (const bo of entities) {
        const alias = abapName(bo.behavior.alias);
        const { created, updated, deleted } = this.changes(bo);
        changed ||= created.length + updated.length + deleted.length > 0;
        for (const instance of created) {
          appendRow(component(create, alias), (row) => {
            this.bridge.fillRow(row, bo, instance.row);
            this.bridge.fillControl(row, bo, new Set([...instance.changed, ...bo.keys.map((k) => k.name)]));
          });
        }
        // the rows hold every field (with full data), %control the changed ones
        for (const instance of updated) {
          appendRow(component(update, alias), (row) => {
            this.bridge.fillRow(row, bo, instance.row);
            this.bridge.fillControl(row, bo, instance.changed);
          });
        }
        for (const instance of deleted) {
          appendRow(component(remove, alias), (row) => this.bridge.fillKey(row, bo, keyOf(bo, instance.persisted as Row)));
        }
      }
      if (!changed) {
        continue;
      }
      const reported = this.bridge.response(first, "reported", true);
      const failed = saver.withFailed ? this.bridge.response(first, "failed", true) : undefined;
      this.inSaver = true;
      try {
        await this.bridge.call(saver.saveModified, { create, update, delete: remove, reported, ...(failed === undefined ? {} : { failed }) });
        if (saver.cleanup !== undefined) {
          await this.bridge.call(saver.cleanup, {});
        }
      } finally {
        this.inSaver = false;
      }
      responses.add(await this.bridge.readResponses(first, failed, reported));
    }
    return responses;
  }

  private async write(): Promise<void> {
    for (const instance of this.instances.values()) {
      const { bo } = instance;
      if (bo.saving === "unmanaged") {
        // save_modified writes these instances
        continue;
      }
      const columns = [...bo.columns.entries()];
      const key = keyOf(bo, instance.row);
      const where = (row: Row) => sql.join(bo.keys.map((k) => sql`${sql.id(bo.columns.get(k.name) ?? abapName(k.name))} = ${toSql(k.type, row[k.name] ?? null)}`), sql` AND `);
      if (instance.deleted) {
        if (instance.persisted !== undefined) {
          await sql`DELETE FROM ${sql.id(bo.table.name)} WHERE ${where(instance.persisted)}`.execute(this.db);
        }
        continue;
      }
      if (instance.persisted === undefined) {
        const names = columns.map(([, c]) => sql.id(c));
        const values = columns.map(([f]) => toSql((this.bo.field(bo, f) as FieldModel).type, instance.row[f] ?? null));
        await sql`INSERT INTO ${sql.id(bo.table.name)} (${sql.join(names)}) VALUES (${sql.join(values)})`.execute(this.db);
        continue;
      }
      const touched = this.etagTouched.has(instance) ? bo.etagField : undefined;
      const changed = columns.filter(([f]) => (instance.changed.has(f) || f === touched) && !bo.keys.some((k) => k.name === f));
      if (changed.length === 0 && keyString(bo, instance.persisted) === keyString(bo, key)) {
        continue;
      }
      const sets = (changed.length === 0 ? columns.filter(([f]) => !bo.keys.some((k) => k.name === f)) : changed).map(
        ([f, c]) => sql`${sql.id(c)} = ${toSql((this.bo.field(bo, f) as FieldModel).type, instance.row[f] ?? null)}`,
      );
      if (sets.length > 0) {
        await sql`UPDATE ${sql.id(bo.table.name)} SET ${sql.join(sets)} WHERE ${where(instance.persisted)}`.execute(this.db);
      }
    }
  }

  /** Keys of the instances created in the LUW, by content ID. */
  public createdByCid(cid: string): { bo: BoEntity; key: Row } | undefined {
    return this.cids.get(cid);
  }

  /**
   * The instance whose ETag field covers an instance (of `bo`, with the values `row`): itself
   * for an `etag master`, the master reached by the `etag dependent by` associations otherwise.
   */
  private async etagMasterInstance(bo: BoEntity, row: Row): Promise<Instance | undefined> {
    let current = bo;
    let values: Row = row;
    for (let depth = 0; depth < 20; depth++) {
      const spec = current.behavior.etag;
      if (spec === undefined) {
        return undefined;
      }
      if (spec.kind === "master") {
        return this.instance(current, keyOf(current, values));
      }
      const association = this.bo.association(current, spec.by);
      if (association === undefined) {
        return undefined;
      }
      const targetKey: Row = {};
      for (const pair of association.on) {
        const target = association.target.fields.find((f) => same(f.name, pair.target))?.name ?? pair.target;
        targetKey[target] = values[current.fields.find((f) => same(f.name, pair.source))?.name ?? pair.source] ?? null;
      }
      const next = await this.instance(association.target, keyOf(association.target, targetKey));
      if (next === undefined) {
        return undefined;
      }
      current = association.target;
      values = next.row;
    }
    return undefined;
  }

  /**
   * The ETag value an If-Match is compared with: the ETag field of the instance or of its ETag
   * master, as it was when the LUW began (the state the client has read: the requests of a change
   * set carry the ETags read before it, and the changes of the LUW, a determination that updates
   * the master for example, do not make them stale); undefined when the instance is not found.
   */
  public async etagValue(bo: BoEntity, key: Row): Promise<{ value: unknown } | undefined> {
    const instance = await this.instance(bo, keyOf(bo, key));
    if (instance === undefined) {
      return undefined;
    }
    const master = await this.etagMasterInstance(bo, instance.row);
    const field = master?.bo.etagField;
    return { value: master === undefined || field === undefined ? undefined : (master.persisted ?? master.row)[field] };
  }

  /**
   * `etag dependent by` (D32): the ETag field of a master changes with its dependent instances.
   * The runtime sets it when it is an administrative time stamp it manages
   * (`localInstanceLastChangedAt`, `lastChangedAt`) and writes the master; at save time, so that
   * the requests of a change set check the ETag the client has read.
   */
  private async refreshEtagMasters(): Promise<void> {
    const masters = new Set<Instance>();
    for (const instance of [...this.instances.values()]) {
      if (instance.bo.behavior.etag?.kind !== "dependent") {
        continue;
      }
      const created = instance.persisted === undefined;
      const changed = instance.deleted ? !created : created || instance.changed.size > 0;
      if (!changed) {
        continue;
      }
      const master = await this.etagMasterInstance(instance.bo, instance.deleted ? (instance.persisted ?? instance.row) : instance.row);
      if (master !== undefined && !master.deleted) {
        masters.add(master);
      }
    }
    for (const master of masters) {
      const field = master.bo.etagField;
      if (field === undefined || master.bo.saving === "unmanaged" || (field !== master.bo.admin.localInstanceLastChangedAt && field !== master.bo.admin.lastChangedAt)) {
        continue;
      }
      master.row[field] = this.services.now();
      this.etagTouched.add(master);
    }
  }

  /**
   * Instance and global feature control of rows about to be read (GET): __EntityControl… The
   * global and instance authorizations of the user disable the operations they refuse, as RAP
   * presents both to its consumers (D36).
   */
  public async features(bo: BoEntity, keys: Row[], operations: FailedOperation[], fields: string[]): Promise<{ disabled: Set<string>; readonly: Map<string, Set<string>>; global: Set<string> }> {
    const mode: AccessMode = { local: false, privileged: false, external: true };
    const instance = await this.instanceFeatures(bo, keys, { operations, fields }, mode);
    const global = await this.globalFeatures(bo, operations, mode);
    for (const id of await this.globalAuthorization(bo, operations, mode)) {
      global.add(id);
    }
    for (const operation of operations) {
      for (const key of await this.instanceAuthorization(bo, keys, operation, mode)) {
        instance.disabled.add(`${key}|${operationId(operation)}`);
      }
    }
    return { ...instance, global };
  }

  /** The operations of an entity the user may perform: global authorization and global features (D36). */
  public async allowed(bo: BoEntity, operations: FailedOperation[]): Promise<Set<string>> {
    const mode: AccessMode = { local: false, privileged: false, external: true };
    const denied = await this.globalAuthorization(bo, operations, mode);
    const disabled = await this.globalFeatures(bo, operations, mode);
    return new Set(operations.map(operationId).filter((id) => !denied.has(id) && !disabled.has(id)));
  }
}

/**
 * The operation whose authorization decides: a creation by association is authorized as an update
 * of its source, the authorization types of SAP have no %assoc (D85).
 */
function authorizedAs(op: FailedOperation): FailedOperation {
  return op.kind === "association" ? { kind: "update" } : op;
}

export function operationId(op: FailedOperation): string {
  return op.kind === "action" || op.kind === "association" ? `${op.kind}:${op.name.toLowerCase()}` : op.kind;
}

/** D109: the n-th preliminary value of a key field of late numbering, unlike the final ones. */
function preliminaryValue(field: FieldModel, n: number): CanonicalValue {
  const t = field.type;
  switch (t.kind) {
    case "int1":
      return 255 - (n % 255);
    case "int2":
    case "int4":
    case "int8":
      return -n;
    case "numc": {
      const length = t.length ?? 10;
      const max = 10n ** BigInt(length) - 1n;
      return (max - BigInt(n - 1)).toString().padStart(length, "0");
    }
    case "raw":
      return randomUUID().replace(/-/g, "").toUpperCase().slice(0, (t.length ?? 16) * 2).padEnd((t.length ?? 16) * 2, "0");
    case "char":
    case "sstring":
    case "string": {
      if (isUuidLike(field)) return randomUUID();
      const text = `#${n.toString(36).toUpperCase()}`;
      return t.length === undefined ? text : text.slice(0, t.length);
    }
    default:
      return randomUUID();
  }
}

const isUuidLike = (field: FieldModel): boolean => field.type.kind === "char" && field.type.length === 36;

