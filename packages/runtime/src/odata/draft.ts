/**
 * Draft (decision D54): the drafts of a draft BO (`with draft`) are kept in the draft tables, one
 * per entity, with the administrative data of each draft (`rapt_draft_admin`). The OData service
 * reads the active instances and the drafts together (key IsActiveEntity); this module runs the
 * writes on drafts and the actions of the draft:
 *
 * - POST on the root collection creates a draft; POST through a composition of a draft creates a
 *   draft child; PATCH and DELETE change or remove drafts, without determinations or validations;
 * - Edit copies an active instance and its compositions into a draft (exclusive: one draft per
 *   instance, in process by one user; a draft unchanged for 15 minutes may be taken over);
 * - Activate applies the draft to the active instances through the managed runtime in the LUW of
 *   the request (creations, changes and deletions of the composition tree; determinations,
 *   validations and the saver run), then removes the draft;
 * - Discard removes the draft, Resume takes it over again, Prepare returns it.
 *
 * Active instances that have a draft cannot be changed directly (409).
 */

import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { FieldModel } from "@rap-transpiler/model";
import type { BoAssociation, BoEntity } from "../rap/bo.js";
import { operationId, type Transaction } from "../rap/transaction.js";
import { Responses, type AccessMode, type Row } from "../rap/types.js";
import { fromSql, initialValue, isInitial, toSql, type CanonicalValue } from "../values.js";
import { badRequest, methodNotAllowed, notFound, notImplemented, ODataError } from "./errors.js";
import type { HandlerContext, ODataRequest, Target } from "./handler.js";
import { etagValue } from "./json.js";
import type { Key } from "./service.js";
import type { Outcome, RapWriteHandler, SetInfo } from "./write.js";

/** A draft not changed for this long may be taken over by another user (SAP: 15 minutes). */
export const DRAFT_LOCK_MINUTES = 15;

const ACTIVATION: AccessMode = { local: false, privileged: false, external: false, keepKeys: true };
const DRAFT_ACTIONS = new Set(["Edit", "Activate", "Prepare", "Resume", "Discard", "Share"]);

interface Admin {
  DraftUUID: string;
  InProcessByUser: string;
  LastChangeDateTime: string;
}

export class DraftRuntime {
  public constructor(private readonly writes: RapWriteHandler) {}

  private table(bo: BoEntity): string {
    const table = bo.behavior.draftTable;
    if (table === undefined) {
      throw new ODataError(500, "INTERNAL_ERROR", `${bo.entity.name} has no draft table`);
    }
    return table;
  }

  private isDraftSet(set: SetInfo): boolean {
    return set.info.set.draft !== undefined;
  }

  // -------------------------------------------------------------------------------------------
  // SQL of the drafts

  private where(bo: BoEntity, key: Row): ReturnType<typeof sql> {
    return sql.join(
      bo.keys.map((k) => sql`${sql.id(k.name)} = ${toSql(k.type, (key[k.name] ?? null) as CanonicalValue)}`),
      sql` AND `,
    ) as unknown as ReturnType<typeof sql>;
  }

  private rowOf(bo: BoEntity, raw: Record<string, unknown>): Row & { DraftUUID: string; HasActiveEntity: boolean } {
    const row: Row = {};
    for (const field of bo.fields) {
      // a calculated element (D64) has no column in the draft table: the draft view computes it
      row[field.name] = field.expression !== undefined ? initialValue(field.type) : fromSql(field.type, raw[field.name]);
    }
    return { ...row, DraftUUID: String(raw["DraftUUID"]), HasActiveEntity: raw["HasActiveEntity"] === true };
  }

  private async draft(db: Kysely<unknown>, bo: BoEntity, key: Row): Promise<(Row & { DraftUUID: string; HasActiveEntity: boolean }) | undefined> {
    const { rows } = await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(this.table(bo))} WHERE ${this.where(bo, key)}`.execute(db);
    return rows[0] === undefined ? undefined : this.rowOf(bo, rows[0]);
  }

  private async children(db: Kysely<unknown>, association: BoAssociation, parent: Row & { DraftUUID: string }): Promise<Array<Row & { DraftUUID: string; HasActiveEntity: boolean }>> {
    const child = association.target;
    const conditions = association.on.map((p) => {
      const field = child.fields.find((f) => f.name === p.target) as FieldModel;
      return sql`${sql.id(p.target)} = ${toSql(field.type, (parent[p.source] ?? null) as CanonicalValue)}`;
    });
    const { rows } = await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(this.table(child))} WHERE "DraftUUID" = ${parent.DraftUUID} AND ${sql.join(conditions, sql` AND `)}`.execute(db);
    return rows.map((r) => this.rowOf(child, r));
  }

  private async insert(db: Kysely<unknown>, bo: BoEntity, row: Row, draftUuid: string, hasActive: boolean): Promise<void> {
    const stored = bo.fields.filter((f) => f.expression === undefined);
    const columns = [...stored.map((f) => sql.id(f.name)), sql.id("DraftUUID"), sql.id("HasActiveEntity")];
    const values = [...stored.map((f) => sql`${toSql(f.type, (row[f.name] ?? initialValue(f.type)) as CanonicalValue)}`), sql`${draftUuid}`, sql`${hasActive}`];
    await sql`INSERT INTO ${sql.table(this.table(bo))} (${sql.join(columns)}) VALUES (${sql.join(values)})`.execute(db);
    await this.touch(db, bo, row);
  }

  /** The change time of the draft, and its ETag field (the ETag of a draft changes with it). */
  private async touch(db: Kysely<unknown>, bo: BoEntity, key: Row): Promise<void> {
    const etag = bo.etagField === undefined ? sql`` : sql`, ${sql.id(bo.etagField)} = now()`;
    await sql`UPDATE ${sql.table(this.table(bo))} SET "DraftEntityLastChangeDateTime" = now()${etag} WHERE ${this.where(bo, key)}`.execute(db);
  }

  private async admin(db: Kysely<unknown>, draftUuid: string): Promise<Admin | undefined> {
    const { rows } = await sql<Admin>`SELECT "DraftUUID", "InProcessByUser", "LastChangeDateTime"::text AS "LastChangeDateTime" FROM "rapt_draft_admin" WHERE "DraftUUID" = ${draftUuid}`.execute(db);
    return rows[0];
  }

  private async touchAdmin(db: Kysely<unknown>, draftUuid: string, user: string): Promise<void> {
    await sql`UPDATE "rapt_draft_admin" SET "LastChangeDateTime" = now(), "LastChangedByUser" = ${user} WHERE "DraftUUID" = ${draftUuid}`.execute(db);
  }

  /** Removes a draft instance and the drafts of its compositions. */
  private async remove(db: Kysely<unknown>, bo: BoEntity, row: Row & { DraftUUID: string }): Promise<void> {
    for (const composition of bo.compositions) {
      for (const child of await this.children(db, composition, row)) {
        await this.remove(db, composition.target, child);
      }
    }
    await sql`DELETE FROM ${sql.table(this.table(bo))} WHERE ${this.where(bo, row)}`.execute(db);
  }

  private async removeDraft(db: Kysely<unknown>, root: BoEntity, row: Row & { DraftUUID: string }): Promise<void> {
    await this.remove(db, root, row);
    await sql`DELETE FROM "rapt_draft_admin" WHERE "DraftUUID" = ${row.DraftUUID}`.execute(db);
    await sql`DELETE FROM "rapt_draft_user" WHERE "DraftUUID" = ${row.DraftUUID}`.execute(db);
  }

  /** A BO `with collaborative draft` (D59). */
  private collaborative(bo: BoEntity): boolean {
    return bo.bdef.collaborativeDraft === true;
  }

  /** Adds a user to the users of a collaborative draft (O: owner, E: editor). */
  private async addUser(db: Kysely<unknown>, draftUuid: string, user: string, role: "O" | "E"): Promise<void> {
    await sql`INSERT INTO "rapt_draft_user" ("DraftUUID", "UserID", "UserDescription", "UserAccessRole") VALUES (${draftUuid}, ${user}, ${user}, ${role}) ON CONFLICT ("DraftUUID", "UserID") DO NOTHING`.execute(db);
  }

  private async isUser(db: Kysely<unknown>, draftUuid: string, user: string): Promise<boolean> {
    const { rows } = await sql<{ n: number }>`SELECT 1 AS n FROM "rapt_draft_user" WHERE "DraftUUID" = ${draftUuid} AND "UserID" = ${user}`.execute(db);
    return rows.length > 0;
  }

  /** A new draft: its administrative data, and its owner for a collaborative draft. */
  private async newDraft(db: Kysely<unknown>, bo: BoEntity, draftUuid: string, user: string): Promise<void> {
    await sql`INSERT INTO "rapt_draft_admin" ("DraftUUID", "CreatedByUser", "LastChangedByUser", "InProcessByUser", "RootEntity") VALUES (${draftUuid}, ${user}, ${user}, ${user}, ${bo.entity.name})`.execute(db);
    if (this.collaborative(bo)) {
      await this.addUser(db, draftUuid, user, "O");
    }
  }

  private expired(admin: Admin): boolean {
    return Date.now() - Date.parse(admin.LastChangeDateTime.replace(" ", "T").replace(/\+00$/, "Z")) > DRAFT_LOCK_MINUTES * 60_000;
  }

  /** The draft must be in process by the user. */
  private async owned(db: Kysely<unknown>, set: SetInfo, row: Row & { DraftUUID: string }, user: string): Promise<Admin> {
    const admin = await this.admin(db, row.DraftUUID);
    if (admin === undefined) {
      throw notFound(`the draft of ${set.info.set.name}`);
    }
    if (admin.InProcessByUser !== user && !(this.collaborative(set.bo) && (await this.isUser(db, row.DraftUUID, user)))) {
      throw new ODataError(409, "DRAFT_LOCKED", `The draft is in process by ${admin.InProcessByUser}`);
    }
    return admin;
  }

  // -------------------------------------------------------------------------------------------
  // routing

  /** The key without IsActiveEntity, and its value (undefined: not given). */
  private split(set: SetInfo, key: Key): { key: Row; active: boolean | undefined } {
    const active = key["IsActiveEntity"];
    return { key: this.writes.baseKey(set, key), active: active === undefined || active === null ? undefined : active === true || active === "true" };
  }

  /**
   * The outcome of a request on a draft BO when it concerns drafts or the actions of the draft;
   * undefined when the managed runtime handles it (an active instance), after the lock check.
   */
  public async route(tx: Transaction, request: ODataRequest, target: Target, ctx: HandlerContext, minimal: boolean): Promise<Outcome | undefined> {
    const segments = target.segments;
    const first = segments[0];
    if (first === undefined || first.kind !== "entitySet") {
      return undefined;
    }
    const firstSet = this.writes.sets.get(first.name);
    if (firstSet === undefined || !this.isDraftSet(firstSet)) {
      return undefined;
    }
    const options = target.options;
    const outcome = (status: number): Outcome => ({ status, messages: [], options, minimal });
    const user = ctx.user.abapName;
    const db = tx.db;
    const last = segments[segments.length - 1];

    // the path: entity set (key), then navigations (key)
    let set = firstSet;
    let key = first.key === undefined ? undefined : this.split(set, this.writes.service.key(set.info, first.key));
    let navigation: string | undefined;
    let parent: { set: SetInfo; key: Row } | undefined;
    for (const segment of segments.slice(1)) {
      if (segment.kind === "operation") break;
      if (segment.kind !== "navigation" || key === undefined) {
        throw badRequest(`Writes are not supported on ${segment.kind} segments`);
      }
      const nav = set.info.navigations.get(segment.name);
      const targetSet = nav === undefined ? undefined : this.writes.sets.get(nav.targetSet);
      if (nav === undefined || targetSet === undefined) {
        throw badRequest(`${set.info.type.name} has no navigation property ${segment.name}`);
      }
      if (segment.key !== undefined) {
        const next = this.split(targetSet, this.writes.service.key(targetSet.info, segment.key));
        set = targetSet;
        key = { key: next.key, active: next.active ?? key.active };
        navigation = undefined;
        parent = undefined;
      } else {
        parent = { set, key: key.key };
        navigation = segment.name;
        set = targetSet;
        key = { key: {}, active: key.active };
        if (!nav.collection) {
          throw notImplemented(`${segment.name}: writes through a to-one navigation of a draft`);
        }
      }
    }
    const isDraft = key?.active === false;

    // actions of the draft
    if (last?.kind === "operation" && DRAFT_ACTIONS.has(last.name.replace(/^.*\./, ""))) {
      if (key === undefined || navigation !== undefined) {
        throw badRequest(`${last.name} applies to an instance of ${set.info.set.name}`);
      }
      return this.action(tx, request, set, key.key, isDraft, last.name.replace(/^.*\./, ""), outcome, user);
    }
    // other operations: on active instances only
    if (last?.kind === "operation") {
      if (isDraft) {
        throw notImplemented(`${last.name} on a draft: activate the draft first`);
      }
      if (key !== undefined) await this.checkNotLocked(db, set, key.key);
      return undefined;
    }
    if (request.method === "POST") {
      const body = parseObject(request.body);
      if (navigation !== undefined && parent !== undefined) {
        if (key?.active !== false) {
          // creation through a composition of an active instance: the managed runtime, if not locked
          await this.checkNotLocked(db, parent.set, parent.key);
          return undefined;
        }
        const created = await this.createChild(db, parent.set, parent.key, navigation, body, user);
        return { ...outcome(minimal ? 204 : 201), entity: created, location: this.writes.path(created.set, created.key) };
      }
      if (key === undefined) {
        if (body["IsActiveEntity"] === true) {
          return undefined; // an active instance, created directly
        }
        const created = await this.createRoot(tx, set, body, user);
        return { ...outcome(minimal ? 204 : 201), entity: created, location: this.writes.path(created.set, created.key) };
      }
      throw methodNotAllowed("POST on an entity: use PATCH, or POST on its collection");
    }
    if (key === undefined) {
      throw methodNotAllowed(`${request.method} needs a single entity`);
    }
    if (!isDraft) {
      await this.checkNotLocked(db, set, key.key);
      return undefined;
    }
    const row = await this.draft(db, set.bo, key.key);
    if (row === undefined) {
      throw notFound(this.writes.path(set, { ...this.writes.projectedKey(set, key.key), IsActiveEntity: false }));
    }
    await this.owned(db, set, row, user);
    if (request.method === "PATCH" || request.method === "PUT") {
      this.checkEtag(request, set, row);
      await this.update(db, set, row, parseObject(request.body), request.method === "PUT", user);
      return { ...outcome(minimal ? 204 : 200), entity: { set, key: { ...this.writes.projectedKey(set, key.key), IsActiveEntity: false } } };
    }
    if (request.method === "DELETE") {
      if (set.bo.parent === undefined) {
        await this.removeDraft(db, set.bo, row);
      } else {
        await this.remove(db, set.bo, row);
        await this.touchAdmin(db, row.DraftUUID, user);
      }
      return outcome(204);
    }
    throw methodNotAllowed(`${request.method} is not supported`);
  }

  /** An active instance with a draft cannot be changed directly. */
  private async checkNotLocked(db: Kysely<unknown>, set: SetInfo, key: Row): Promise<void> {
    if (!this.isDraftSet(set) || set.bo.keys.some((k) => key[k.name] === undefined)) {
      return;
    }
    const row = await this.draft(db, set.bo, key);
    if (row !== undefined) {
      const admin = await this.admin(db, row.DraftUUID);
      throw new ODataError(409, "DRAFT_LOCKED", `${this.writes.path(set, this.writes.projectedKey(set, key))} has a draft (in process by ${admin?.InProcessByUser ?? "another user"}): edit or discard the draft`);
    }
  }

  private checkEtag(request: ODataRequest, set: SetInfo, row: Row): void {
    const header = request.headers["if-match"]?.trim();
    const property = set.info.type.etag;
    if (header === undefined || header === "" || header === "*" || property === undefined) {
      return;
    }
    const field = set.toBase.get(property) ?? property;
    if (!header.split(",").map((t) => t.trim()).includes(etagValue(row[field]))) {
      throw new ODataError(412, "PRECONDITION_FAILED", "The draft was changed in the meantime: reload it");
    }
  }

  // -------------------------------------------------------------------------------------------
  // creation and change of drafts

  /** Values of a body for a draft: the fields a consumer may write (keys of a creation included). */
  private draftValues(set: SetInfo, body: Record<string, unknown>, replace: boolean, create: boolean, hasActive: boolean): { values: Row; fields: Set<string> } {
    const { values, fields } = this.writes.values(set, body, replace);
    for (const field of [...fields]) {
      const characteristics = this.writes.rap.bo.characteristics(set.bo, field);
      const isKey = set.bo.keys.some((k) => k.name === field);
      const readonly = characteristics.includes("readonly") || characteristics.includes("numberingManaged") || (!create && isKey) || (hasActive && characteristics.includes("readonlyUpdate"));
      if (readonly) {
        if (replace) {
          fields.delete(field);
          continue;
        }
        throw badRequest(`${set.toProperty.get(field) ?? field} is read-only`, set.toProperty.get(field));
      }
    }
    return { values, fields };
  }

  private newRow(set: SetInfo, values: Row, fields: Set<string>): Row {
    const row: Row = {};
    for (const field of set.bo.fields) {
      row[field.name] = fields.has(field.name) ? (values[field.name] ?? initialValue(field.type)) : initialValue(field.type);
    }
    for (const key of set.bo.keys) {
      const characteristics = this.writes.rap.bo.characteristics(set.bo, key.name);
      if (characteristics.includes("numberingManaged")) {
        row[key.name] = randomUUID();
      } else if (isInitial(key.type, row[key.name] ?? null)) {
        throw badRequest(`${set.toProperty.get(key.name) ?? key.name}: the key is required`, set.toProperty.get(key.name));
      }
    }
    return row;
  }

  private async createRoot(tx: Transaction, set: SetInfo, body: Record<string, unknown>, user: string): Promise<{ set: SetInfo; key: Key }> {
    if (!set.info.set.insertable) {
      throw methodNotAllowed(`${set.info.set.name} does not allow creation`);
    }
    // the global authorization and features of the creation
    if (!(await tx.allowed(set.bo, [{ kind: "create" }])).has("create")) {
      throw new ODataError(403, "FORBIDDEN", `You are not authorized to create ${set.info.set.name}`);
    }
    const { values, fields } = this.draftValues(set, body, false, true, false);
    const row = this.newRow(set, values, fields);
    if (await this.draft(tx.db, set.bo, row)) {
      throw new ODataError(409, "CONFLICT", `${this.writes.path(set, this.writes.projectedKey(set, row))} already has a draft`);
    }
    const draftUuid = randomUUID();
    await this.newDraft(tx.db, set.bo, draftUuid, user);
    await this.insert(tx.db, set.bo, row, draftUuid, false);
    await this.createInline(tx.db, set, row, draftUuid, body);
    return { set, key: { ...this.writes.projectedKey(set, row), IsActiveEntity: false } };
  }

  /** Deep insert in a draft: the children given inline. */
  private async createInline(db: Kysely<unknown>, set: SetInfo, parentRow: Row, draftUuid: string, body: Record<string, unknown>): Promise<void> {
    for (const [name, value] of Object.entries(body)) {
      const nav = set.info.navigations.get(name);
      if (nav === undefined || nav.kind !== "composition") {
        continue;
      }
      const childSet = this.writes.sets.get(nav.targetSet) as SetInfo;
      const association = this.writes.associationOf(set, name);
      for (const child of Array.isArray(value) ? value : [value]) {
        const childBody = child as Record<string, unknown>;
        const { values, fields } = this.draftValues(childSet, childBody, false, true, false);
        const row = this.newRow(childSet, { ...values, ...this.foreignKey(association, parentRow) }, new Set([...fields, ...association.on.map((p) => p.target)]));
        await this.insert(db, childSet.bo, row, draftUuid, false);
        await this.createInline(db, childSet, row, draftUuid, childBody);
      }
    }
  }

  private foreignKey(association: BoAssociation, parent: Row): Row {
    return Object.fromEntries(association.on.map((p) => [p.target, parent[p.source] ?? null]));
  }

  private async createChild(db: Kysely<unknown>, parentSet: SetInfo, parentKey: Row, navigation: string, body: Record<string, unknown>, user: string): Promise<{ set: SetInfo; key: Key }> {
    const nav = parentSet.info.navigations.get(navigation);
    if (nav === undefined || nav.kind !== "composition" || !nav.insertable) {
      throw methodNotAllowed(`${parentSet.info.set.name}/${navigation}: creation through this navigation is not allowed`);
    }
    const parent = await this.draft(db, parentSet.bo, parentKey);
    if (parent === undefined) {
      throw notFound(`the draft of ${this.writes.path(parentSet, this.writes.projectedKey(parentSet, parentKey))}`);
    }
    await this.owned(db, parentSet, parent, user);
    const childSet = this.writes.sets.get(nav.targetSet) as SetInfo;
    const association = this.writes.associationOf(parentSet, navigation);
    const { values, fields } = this.draftValues(childSet, body, false, true, false);
    const row = this.newRow(childSet, { ...values, ...this.foreignKey(association, parent) }, new Set([...fields, ...association.on.map((p) => p.target)]));
    await this.insert(db, childSet.bo, row, parent.DraftUUID, false);
    await this.createInline(db, childSet, row, parent.DraftUUID, body);
    await this.touchAdmin(db, parent.DraftUUID, user);
    return { set: childSet, key: { ...this.writes.projectedKey(childSet, row), IsActiveEntity: false } };
  }

  private async update(db: Kysely<unknown>, set: SetInfo, row: Row & { DraftUUID: string; HasActiveEntity: boolean }, body: Record<string, unknown>, replace: boolean, user: string): Promise<void> {
    const { values, fields } = this.draftValues(set, body, replace, false, row.HasActiveEntity);
    for (const key of set.bo.keys) {
      fields.delete(key.name);
    }
    if (fields.size > 0) {
      const assignments = [...fields].map((name) => {
        const field = set.bo.fields.find((f) => f.name === name) as FieldModel;
        return sql`${sql.id(name)} = ${toSql(field.type, (values[name] ?? null) as CanonicalValue)}`;
      });
      await sql`UPDATE ${sql.table(this.table(set.bo))} SET ${sql.join(assignments)} WHERE ${this.where(set.bo, row)}`.execute(db);
    }
    await this.touch(db, set.bo, row);
    await this.touchAdmin(db, row.DraftUUID, user);
  }

  // -------------------------------------------------------------------------------------------
  // actions of the draft

  private async action(tx: Transaction, request: ODataRequest, set: SetInfo, key: Row, isDraft: boolean, name: string, outcome: (status: number) => Outcome, user: string): Promise<Outcome> {
    if (request.method !== "POST") {
      throw methodNotAllowed(`${name} is an action: POST`);
    }
    if (set.bo.parent !== undefined) {
      throw badRequest(`${name} applies to the root of the draft`);
    }
    const db = tx.db;
    const draftKey = (k: Row): Key => ({ ...this.writes.projectedKey(set, k), IsActiveEntity: false });
    if (name === "Edit") {
      if (isDraft) {
        throw badRequest("Edit applies to an active instance");
      }
      const body = parseObject(request.body);
      const existing = await this.draft(db, set.bo, key);
      if (existing !== undefined) {
        const admin = await this.admin(db, existing.DraftUUID);
        if (admin?.InProcessByUser === user && body["PreserveChanges"] !== true) {
          return { ...outcome(200), entity: { set, key: draftKey(key) } };
        }
        if (admin !== undefined && admin.InProcessByUser !== user && this.collaborative(set.bo)) {
          // collaborative draft (D59): the user joins the draft of the instance
          await this.addUser(db, existing.DraftUUID, user, "E");
          await this.touchAdmin(db, existing.DraftUUID, user);
          return { ...outcome(200), entity: { set, key: draftKey(key) } };
        }
        if (admin !== undefined && admin.InProcessByUser !== user && !this.expired(admin)) {
          throw new ODataError(409, "DRAFT_LOCKED", `${this.writes.path(set, this.writes.projectedKey(set, key))} is being edited by ${admin.InProcessByUser}`);
        }
        if (admin?.InProcessByUser === user) {
          throw new ODataError(409, "DRAFT_EXISTS", "You already have a draft of this instance: resume or discard it");
        }
        await this.removeDraft(db, set.bo, existing); // the lock of the other user has expired
      }
      // the user must be allowed to change the instance (authorization, feature control)
      const features = await tx.features(set.bo, [key], [{ kind: "update" }], []);
      const k = JSON.stringify(set.bo.keys.map((f) => key[f.name] ?? null));
      if (features.global.has(operationId({ kind: "update" })) || features.disabled.has(`${k}|update`)) {
        throw new ODataError(403, "FORBIDDEN", `${this.writes.path(set, this.writes.projectedKey(set, key))} cannot be edited`);
      }
      const { rows } = await tx.read(set.bo, [{ key }]);
      const active = rows[0];
      if (active === undefined) {
        throw notFound(this.writes.path(set, this.writes.projectedKey(set, key)));
      }
      const draftUuid = randomUUID();
      await this.newDraft(db, set.bo, draftUuid, user);
      await this.copy(tx, set.bo, active, draftUuid);
      return { ...outcome(200), entity: { set, key: draftKey(key) } };
    }
    if (!isDraft) {
      throw badRequest(`${name} applies to a draft (IsActiveEntity=false)`);
    }
    const row = await this.draft(db, set.bo, key);
    if (row === undefined) {
      throw notFound(this.writes.path(set, draftKey(key)));
    }
    const admin = await this.admin(db, row.DraftUUID);
    if (name === "Resume") {
      if (admin !== undefined && admin.InProcessByUser !== user && !this.expired(admin) && !(this.collaborative(set.bo) && (await this.isUser(db, row.DraftUUID, user)))) {
        throw new ODataError(409, "DRAFT_LOCKED", `The draft is in process by ${admin.InProcessByUser}`);
      }
      await sql`UPDATE "rapt_draft_admin" SET "InProcessByUser" = ${user}, "LastChangeDateTime" = now() WHERE "DraftUUID" = ${row.DraftUUID}`.execute(db);
      return { ...outcome(200), entity: { set, key: draftKey(key) } };
    }
    await this.owned(db, set, row, user);
    if (name === "Share") {
      // collaborative draft (D59): the users invited to edit the draft
      if (!this.collaborative(set.bo)) {
        throw badRequest(`${set.info.set.name} has no collaborative draft`);
      }
      const body = parseObject(request.body);
      const users = Array.isArray(body["Users"]) ? (body["Users"] as unknown[]) : [];
      for (const entry of users) {
        const id = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>)["UserID"] : undefined;
        if (typeof id !== "string" || id.trim() === "" || id.length > 12) {
          throw badRequest("Share: Users is a list of { UserID, UserAccessRole }, UserID of at most 12 characters", "Users");
        }
        await this.addUser(db, row.DraftUUID, id.trim().toUpperCase(), "E");
      }
      await this.touchAdmin(db, row.DraftUUID, user);
      return outcome(204);
    }
    if (name === "Discard") {
      await this.removeDraft(db, set.bo, row);
      return outcome(204);
    }
    if (name === "Prepare") {
      // the validations run at the activation, in the LUW that saves
      return { ...outcome(200), entity: { set, key: draftKey(key) } };
    }
    // Activate
    const responses = new Responses();
    const activeKey = await this.activate(tx, set, row, responses);
    await this.writes.determine(tx, responses);
    await this.removeDraft(db, set.bo, row);
    return { ...outcome(200), entity: { set, key: { ...this.writes.projectedKey(set, activeKey), IsActiveEntity: true } }, messages: this.writes.messages(responses.reported, { set, key: activeKey }) };
  }

  /** Copies an active instance and its compositions into the draft tables. */
  private async copy(tx: Transaction, bo: BoEntity, active: Row, draftUuid: string): Promise<void> {
    await this.insert(tx.db, bo, active, draftUuid, true);
    for (const composition of bo.compositions) {
      const { results } = await tx.readByAssociation(bo, composition, [active]);
      for (const { target } of results) {
        await this.copy(tx, composition.target, target, draftUuid);
      }
    }
  }

  /** The fields of a draft the activation writes (not those the runtime computes). */
  private writableFields(bo: BoEntity, create: boolean): string[] {
    return bo.fields
      .filter((f) => {
        const c = this.writes.rap.bo.characteristics(bo, f.name);
        const isKey = bo.keys.some((k) => k.name === f.name);
        if (isKey) return create;
        return !c.includes("readonly") && !c.includes("numberingManaged") && !(c.includes("readonlyUpdate") && !create) && f.semantics === undefined;
      })
      .map((f) => f.name);
  }

  private changed(bo: BoEntity, draft: Row, active: Row): Set<string> {
    return new Set(this.writableFields(bo, false).filter((f) => JSON.stringify(draft[f] ?? null) !== JSON.stringify(active[f] ?? null)));
  }

  /** Applies a draft to the active instances; returns the key of the active root. */
  private async activate(tx: Transaction, set: SetInfo, draft: Row & { DraftUUID: string; HasActiveEntity: boolean }, responses: Responses): Promise<Row> {
    const bo = set.bo;
    const fail = (r: Responses): void => {
      responses.add(r);
      if (r.hasFailed) {
        throw this.writes.error(r, { set, key: draft });
      }
    };
    let rootCid: string | undefined;
    let active: Row | undefined;
    if (draft.HasActiveEntity) {
      active = (await tx.read(bo, [{ key: draft }])).rows[0];
    }
    if (active !== undefined) {
      const fields = this.changed(bo, draft, active);
      if (fields.size > 0) {
        fail(await tx.update(bo, [{ key: draft, values: draft, fields }], ACTIVATION));
      }
    } else {
      rootCid = "%DRAFT-ROOT";
      fail(await tx.create(bo, [{ cid: rootCid, values: draft, fields: new Set(this.writableFields(bo, true)) }], ACTIVATION));
    }
    await this.activateChildren(tx, bo, draft, active !== undefined ? draft : undefined, rootCid, fail);
    const created = rootCid === undefined ? undefined : tx.createdByCid(rootCid);
    return created?.key ?? draft;
  }

  private async activateChildren(tx: Transaction, bo: BoEntity, draftParent: Row & { DraftUUID: string }, activeParentKey: Row | undefined, parentCid: string | undefined, fail: (r: Responses) => void): Promise<void> {
    let n = 0;
    for (const composition of bo.compositions) {
      const child = composition.target;
      const drafts = await this.children(tx.db, composition, draftParent);
      const actives = activeParentKey === undefined ? [] : (await tx.readByAssociation(bo, composition, [activeParentKey])).results.map((r) => r.target);
      const same = (a: Row, b: Row): boolean => child.keys.every((k) => JSON.stringify(a[k.name] ?? null) === JSON.stringify(b[k.name] ?? null));
      for (const removed of actives.filter((a) => !drafts.some((d) => same(a, d)))) {
        fail(await tx.delete(child, [{ key: removed }], ACTIVATION));
      }
      for (const draft of drafts) {
        const active = actives.find((a) => same(a, draft));
        let cid: string | undefined;
        if (active !== undefined) {
          const fields = this.changed(child, draft, active);
          if (fields.size > 0) {
            fail(await tx.update(child, [{ key: draft, values: draft, fields }], ACTIVATION));
          }
        } else {
          cid = `%DRAFT-${child.entity.name}-${n++}`;
          const target = { cid, values: draft, fields: new Set(this.writableFields(child, true)) };
          const request = parentCid !== undefined && activeParentKey === undefined ? { key: {}, cidRef: parentCid, targets: [target] } : { key: activeParentKey ?? draftParent, targets: [target] };
          fail(await tx.createByAssociation(bo, composition, [request], ACTIVATION));
        }
        await this.activateChildren(tx, child, draft, active !== undefined ? draft : undefined, cid, fail);
      }
    }
  }
}

function parseObject(body: string | undefined): Record<string, unknown> {
  if (body === undefined || body.trim() === "") {
    return {};
  }
  try {
    const value = JSON.parse(body) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw badRequest("The request body must be a JSON object");
  }
}
