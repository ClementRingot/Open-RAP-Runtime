/**
 * The ABAP rewrite pass (decision D2): turns the behavior pools into standard ABAP that abaplint
 * types completely and the transpiler accepts, without changing their meaning.
 *
 * - `FOR BEHAVIOR OF` is removed from the global class;
 * - the RAP handler definitions (`METHODS x FOR VALIDATE ON SAVE …`) become plain methods whose
 *   parameters are typed with the derived types of the BDEF;
 * - `TYPE TABLE|STRUCTURE|RESPONSE FOR …` become references to the derived types interface;
 * - every EML statement becomes a sequence of calls to the kernel class ZRAP_EML, with the `#`
 *   of its operands made explicit and its inline declarations (`RESULT DATA(x)`) hoisted.
 *
 * Every replacement keeps the line count of the text it replaces, so that diagnostics on the
 * rewritten sources point to the original lines.
 */

import type * as abaplint from "@abaplint/core";
import {
  derivedType,
  derivedTypesInterfaceName,
  findEntity,
  same,
  type ActionModel,
  type BehaviorModel,
  type EntityBehaviorModel,
  type EntityModel,
  type HandlerParamRole,
  type Model,
} from "@rap-transpiler/model";
import type { Diagnostics } from "../../diagnostics.js";
import { classifyMethodDefinition } from "../../ir/handlers.js";
import { bdefAssociations } from "./derived-types.js";
import {
  EmlSyntaxError,
  inferredTypeToken,
  inlineDeclaration,
  isEmlStatement,
  parseEml,
  type EmlStatement,
  type FieldSpec,
  type Operand,
} from "./eml.js";
import { KERNEL_CLASS } from "./framework.js";
import { joinTokens, SourceEdits, toks, type Tok } from "./tokens.js";

// ---------------------------------------------------------------------------------------------
// Catalog of the managed BDEFs

export interface EntityInfo {
  bdef: BdefInfo;
  behavior: EntityBehaviorModel;
  cds: EntityModel;
  /** 1-based index of the entity in the BDEF (the `eN` of the derived type names). */
  index: number;
}

export interface BdefInfo {
  behavior: BehaviorModel;
  /** Name of the derived types interface, lower case. */
  iface: string;
  entities: EntityInfo[];
}

export interface AssociationInfo {
  name: string;
  /** 1-based index among the associations of the source entity (the `bN`). */
  index: number;
  target: EntityInfo;
}

export class BdefCatalog {
  public readonly bdefs: BdefInfo[] = [];

  public constructor(public readonly model: Model) {
    for (const behavior of model.behaviors.filter((b) => b.implementationType === "managed")) {
      const info: BdefInfo = { behavior, iface: derivedTypesInterfaceName(behavior.name).toLowerCase(), entities: [] };
      behavior.entities.forEach((entity, i) => {
        const cds = findEntity(model, entity.entity);
        if (cds !== undefined) {
          info.entities.push({ bdef: info, behavior: entity, cds, index: i + 1 });
        }
      });
      this.bdefs.push(info);
    }
  }

  public bdef(name: string): BdefInfo | undefined {
    return this.bdefs.find((b) => same(b.behavior.name, name));
  }

  public isProjection(name: string): boolean {
    return this.model.behaviors.some((b) => b.implementationType === "projection" && same(b.name, name));
  }

  public entityOf(bdef: BdefInfo, name: string): EntityInfo | undefined {
    return bdef.entities.find((e) => same(e.behavior.alias, name) || same(e.behavior.entity, name));
  }

  /** An entity by its CDS name, in any managed BDEF. */
  public entityByName(name: string): EntityInfo | undefined {
    for (const bdef of this.bdefs) {
      const found = bdef.entities.find((e) => same(e.behavior.entity, name));
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  public associations(entity: EntityInfo): AssociationInfo[] {
    const result: AssociationInfo[] = [];
    for (const a of bdefAssociations(this.model, entity.bdef.behavior, entity.behavior)) {
      const target = entity.bdef.entities.find((e) => e.index === a.targetIndex);
      if (target !== undefined) {
        result.push({ name: a.name, index: a.index, target });
      }
    }
    return result;
  }

  public association(entity: EntityInfo, name: string): AssociationInfo | undefined {
    return this.associations(entity).find((a) => same(a.name, name.replace(/^\\/, "")));
  }

  public action(entity: EntityInfo, name: string): { action: ActionModel; index: number } | undefined {
    const index = entity.behavior.actions.findIndex((a) => same(a.name, name));
    const action = entity.behavior.actions[index];
    return action === undefined ? undefined : { action, index: index + 1 };
  }
}

// ---------------------------------------------------------------------------------------------
// Errors

class RewriteError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly token?: Tok,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------
// Paths of derived types: `zr_travel\\travel\_booking`, `travel~accept`, `zr_travel`

interface ResolvedPath {
  entity: EntityInfo;
  association?: AssociationInfo;
  action?: { action: ActionModel; index: number };
}

function resolvePath(catalog: BdefCatalog, token: Tok, pool: BdefInfo | undefined): ResolvedPath {
  const text = token.str;
  const m = /^([^\\~]+)(?:\\\\([^\\~]+))?(?:\\([^\\~]+))?(?:~(.+))?$/.exec(text);
  if (m === null) {
    throw new RewriteError("ABP006", `cannot read the entity path ${text}`, token);
  }
  const [, head = "", alias, association, action] = m;
  let entity: EntityInfo | undefined;
  if (alias !== undefined) {
    const bdef = catalog.bdef(head);
    if (bdef === undefined) {
      throw unknownBdef(catalog, head, token);
    }
    entity = catalog.entityOf(bdef, alias);
    if (entity === undefined) {
      throw new RewriteError("ABP006", `${bdef.behavior.name} has no entity ${alias}`, token);
    }
  } else {
    entity = (pool === undefined ? undefined : catalog.entityOf(pool, head)) ?? catalog.entityByName(head);
    if (entity === undefined) {
      const bdef = catalog.bdef(head);
      entity = bdef?.entities.find((e) => e.behavior.root) ?? bdef?.entities[0];
    }
    if (entity === undefined) {
      throw unknownBdef(catalog, head, token);
    }
  }
  const result: ResolvedPath = { entity };
  if (association !== undefined) {
    const found = catalog.association(entity, association);
    if (found === undefined) {
      throw new RewriteError("ABP006", `${entity.behavior.alias} has no association ${association} to an entity of ${entity.bdef.behavior.name}`, token);
    }
    result.association = found;
  }
  if (action !== undefined) {
    const found = catalog.action(entity, action);
    if (found === undefined) {
      throw new RewriteError("ABP006", `${entity.behavior.alias} has no action or function ${action}`, token);
    }
    result.action = found;
  }
  return result;
}

function unknownBdef(catalog: BdefCatalog, name: string, token: Tok): RewriteError {
  if (catalog.isProjection(name)) {
    return new RewriteError("ABP007", `EML and derived types of the projection ${name.toUpperCase()} are not supported: use the base behavior definition`, token);
  }
  return new RewriteError("ABP006", `unknown behavior definition or entity ${name} (it must be a managed BDEF of the service)`, token);
}

// ---------------------------------------------------------------------------------------------
// TYPE TABLE|STRUCTURE|RESPONSE|REQUEST FOR …

const TYPE_KINDS = new Set(["TABLE", "STRUCTURE", "RESPONSE", "REQUEST"]);

/** Derived type of `TYPE <shape> FOR <words> <path>`, as `iface=>name`. */
function derivedTypeName(catalog: BdefCatalog, shape: string, words: string[], pathToken: Tok, pool: BdefInfo | undefined): string {
  const key = words.join(" ");
  const fail = (): never => {
    throw new RewriteError("ABP007", `TYPE ${shape} FOR ${key} is not supported`, pathToken);
  };
  if (shape === "REQUEST") {
    return fail();
  }
  if (shape === "RESPONSE") {
    const m = /^(FAILED|REPORTED|MAPPED)(?: (EARLY|LATE))?$/.exec(key);
    if (m === null) {
      return fail();
    }
    const path = resolvePath(catalog, pathToken, pool);
    const late = m[2] === "LATE";
    const name = { FAILED: late ? derivedType.failedLate : derivedType.failedEarly, REPORTED: late ? derivedType.reportedLate : derivedType.reportedEarly, MAPPED: late ? derivedType.mappedLate : derivedType.mappedEarly }[m[1] as "FAILED" | "REPORTED" | "MAPPED"];
    return `${path.entity.bdef.iface}=>${name}`;
  }
  const table = shape === "TABLE";
  const path = resolvePath(catalog, pathToken, pool);
  const e = path.entity.index;
  const b = path.association?.index;
  const a = path.action?.index;
  const needAssociation = (): number => b ?? fail();
  const needAction = (): number => a ?? fail();
  const response = key.replace(/ (EARLY|LATE)$/, "");
  let name: string;
  switch (response) {
    case "CREATE":
      name = b === undefined ? (table ? derivedType.create(e) : derivedType.createRow(e)) : table ? derivedType.assocCreate(e, b) : `ts_e${e}_b${b}_cre`;
      break;
    case "UPDATE":
      name = table ? derivedType.update(e) : derivedType.updateRow(e);
      break;
    case "DELETE":
      name = table ? derivedType.delete(e) : `ts_e${e}_del`;
      break;
    case "LOCK":
      name = table ? derivedType.lock(e) : `ts_e${e}_lock`;
      break;
    case "READ IMPORT":
      name = b === undefined ? (table ? derivedType.readImport(e) : `ts_e${e}_rimp`) : table ? derivedType.assocReadImport(e, b) : `ts_e${e}_b${b}_rimp`;
      break;
    case "READ RESULT":
      name =
        b === undefined
          ? table
            ? derivedType.readResult(e)
            : derivedType.readResultRow(e)
          : table
            ? derivedType.assocReadResult(e, b)
            : derivedType.readResultRow((path.association as AssociationInfo).target.index);
      break;
    case "READ LINK":
      name = table ? derivedType.assocLink(e, needAssociation()) : `ts_e${e}_b${needAssociation()}_link`;
      break;
    case "ACTION IMPORT":
    case "FUNCTION IMPORT":
      name = table ? derivedType.actionImport(e, needAction()) : `ts_e${e}_a${needAction()}_imp`;
      break;
    case "ACTION RESULT":
    case "FUNCTION RESULT":
      name = table ? derivedType.actionResult(e, needAction()) : `ts_e${e}_a${needAction()}_res`;
      break;
    case "FAILED":
      name = table ? derivedType.failedRows(e) : `ts_e${e}_failr`;
      break;
    case "REPORTED":
      name = table ? derivedType.reportedRows(e) : `ts_e${e}_repr`;
      break;
    case "MAPPED":
      name = table ? derivedType.mappedRows(e) : `ts_e${e}_mapr`;
      break;
    case "DETERMINATION":
    case "VALIDATION":
    case "KEY OF":
    case "AUTHORIZATION KEY":
    case "INSTANCE AUTHORIZATION KEY":
    case "INSTANCE FEATURES KEY":
      name = table ? derivedType.keys(e) : `ts_e${e}_keys`;
      break;
    case "AUTHORIZATION REQUEST":
    case "INSTANCE AUTHORIZATION REQUEST":
      name = table ? fail() : derivedType.instanceAuthRequest(e);
      break;
    case "AUTHORIZATION RESULT":
    case "INSTANCE AUTHORIZATION RESULT":
      name = table ? derivedType.instanceAuthResult(e) : `ts_e${e}_iauth_r`;
      break;
    case "GLOBAL AUTHORIZATION REQUEST":
      name = table ? fail() : derivedType.globalAuthRequest(e);
      break;
    case "GLOBAL AUTHORIZATION RESULT":
      name = table ? fail() : derivedType.globalAuthResult(e);
      break;
    case "INSTANCE FEATURES REQUEST":
      name = table ? fail() : derivedType.instanceFeaturesRequest(e);
      break;
    case "INSTANCE FEATURES RESULT":
      name = table ? derivedType.instanceFeaturesResult(e) : `ts_e${e}_ifeat_r`;
      break;
    case "GLOBAL FEATURES REQUEST":
      name = table ? fail() : derivedType.globalFeaturesRequest(e);
      break;
    case "GLOBAL FEATURES RESULT":
      name = table ? fail() : derivedType.globalFeaturesResult(e);
      break;
    default:
      return fail();
  }
  return `${path.entity.bdef.iface}=>${name}`;
}

const TYPE_WORDS = new Set([
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOCK",
  "READ",
  "IMPORT",
  "RESULT",
  "LINK",
  "ACTION",
  "FUNCTION",
  "FAILED",
  "REPORTED",
  "MAPPED",
  "EARLY",
  "LATE",
  "DETERMINATION",
  "VALIDATION",
  "KEY",
  "OF",
  "INSTANCE",
  "GLOBAL",
  "AUTHORIZATION",
  "FEATURES",
  "REQUEST",
  "CHANGE",
  "PERMISSIONS",
  "HIERARCHY",
  "EVENT",
  "ONLY",
  "ENTITY",
]);

/** Glues a path token with the tokens written against it (`zr_travel`, `\`, `\travel`). */
function gluePath(tokens: Tok[], start: number): { token: Tok; next: number } {
  const first = tokens[start] as Tok;
  let last = first;
  let text = first.str;
  let i = start + 1;
  for (; i < tokens.length; i++) {
    const t = tokens[i] as Tok;
    if (!(last.endRow === t.row && last.endCol === t.col) || t.str === "." || t.str === ",") {
      break;
    }
    text += t.str;
    last = t;
  }
  return { token: { ...first, str: text, upper: text.toUpperCase(), endRow: last.endRow, endCol: last.endCol }, next: i };
}

// ---------------------------------------------------------------------------------------------
// The pass

export interface RewriteContext {
  catalog: BdefCatalog;
  diagnostics: Diagnostics;
  /** Path of the original file, for the diagnostics. */
  file: string;
  /** The BDEF the behavior pool implements, for the paths written with an alias only. */
  pool?: BdefInfo;
}

const KERNEL = KERNEL_CLASS.toLowerCase();

const literal = (s: string): string => `\`${s.toUpperCase()}\``;

/** Rewrites one ABAP file of a class or interface; returns the new source. */
export function rewriteAbapFile(file: abaplint.ABAPFile, context: RewriteContext): string {
  const edits = new SourceEdits(file.getRaw());
  for (const statement of file.getStatements()) {
    const tokens = toks(statement.getTokens());
    if (tokens.length === 0) {
      continue;
    }
    try {
      rewriteStatement(statement.get().constructor.name, tokens, edits, context);
    } catch (error) {
      if (error instanceof RewriteError) {
        const at = error.token ?? tokens[0];
        context.diagnostics.error(error.code, error.message, { file: context.file, line: at?.row ?? 1, column: at?.col ?? 1 });
      } else if (error instanceof EmlSyntaxError) {
        const at = error.token ?? tokens[tokens.length - 1];
        context.diagnostics.error("ABP005", `EML: ${error.message}`, { file: context.file, line: at?.row ?? 1, column: at?.col ?? 1 });
      } else {
        throw error;
      }
    }
  }
  return edits.size === 0 ? file.getRaw() : edits.apply();
}

function rewriteStatement(kind: string, tokens: Tok[], edits: SourceEdits, context: RewriteContext): void {
  const last = tokens[tokens.length - 1] as Tok;
  if (isEmlStatement(tokens)) {
    if (last.str !== ".") {
      throw new RewriteError("ABP005", "EML statements cannot be chained", tokens[0]);
    }
    const statement = parseEml(tokens.slice(0, -1));
    edits.replace(tokens[0] as Tok, last, emlCode(statement, context));
    return;
  }
  const head = `${tokens[0]?.upper ?? ""} ${tokens[1]?.upper ?? ""}`;
  if (head === "GET PERMISSIONS" || head === "SET LOCKS" || (head === "RAISE ENTITY" && tokens[2]?.upper === "EVENT")) {
    throw new RewriteError("ABP007", `${head} is not supported`, tokens[0]);
  }
  if (kind === "ClassDefinition") {
    const i = tokens.findIndex((t, n) => t.upper === "FOR" && tokens[n + 1]?.upper === "BEHAVIOR" && tokens[n + 2]?.upper === "OF");
    if (i >= 0 && tokens[i + 3] !== undefined) {
      edits.replace(tokens[i] as Tok, tokens[i + 3] as Tok, "");
    }
    return;
  }
  if (kind === "MethodDef" && rewriteHandlerDefinition(tokens, edits, context)) {
    return;
  }
  rewriteDerivedTypes(tokens, edits, context);
}

/** `TYPE TABLE FOR UPDATE zr_travel\\travel` → `TYPE zrap_dt_zr_travel=>tt_e1_upd`. */
function rewriteDerivedTypes(tokens: Tok[], edits: SourceEdits, context: RewriteContext): void {
  for (let i = 0; i + 3 < tokens.length; i++) {
    const type = tokens[i] as Tok;
    const shape = tokens[i + 1] as Tok;
    if (type.upper !== "TYPE" || !TYPE_KINDS.has(shape.upper) || tokens[i + 2]?.upper !== "FOR") {
      continue;
    }
    const words: string[] = [];
    let j = i + 3;
    while (j < tokens.length && TYPE_WORDS.has((tokens[j] as Tok).upper) && j + 1 < tokens.length && tokens[j + 1]?.str !== "." && tokens[j + 1]?.str !== ",") {
      words.push((tokens[j] as Tok).upper);
      j++;
    }
    if (j >= tokens.length) {
      throw new RewriteError("ABP007", `TYPE ${shape.upper} FOR ${words.join(" ")}: entity missing`, shape);
    }
    const { token: path, next } = gluePath(tokens, j);
    const name = derivedTypeName(context.catalog, shape.upper, words, path, context.pool);
    edits.replace(type, tokens[next - 1] as Tok, `TYPE ${name}`);
    i = next - 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Handler definitions

function rewriteHandlerDefinition(tokens: Tok[], edits: SourceEdits, context: RewriteContext): boolean {
  const classified = classifyMethodDefinition(joinTokens(tokens));
  if (classified === undefined) {
    return false;
  }
  const { kind, params } = classified;
  if (kind.kind === "other") {
    if (/^(EVENT|TESTING)\b/i.test(kind.text)) {
      return false;
    }
    throw new RewriteError("ABP007", `handler method FOR ${kind.text.split(" ").slice(0, 3).join(" ")} is not supported in a managed behavior pool`, tokens[2]);
  }
  const forIndex = tokens.findIndex((t, n) => n >= 2 && t.upper === "FOR");
  const last = tokens[tokens.length - 1] as Tok;
  const end = last.str === "." || last.str === "," ? tokens[tokens.length - 2] : last;
  if (forIndex < 0 || end === undefined) {
    return false;
  }
  const aliasText = kind.alias.split("\\")[0] ?? kind.alias;
  const entity = resolveHandlerEntity(context, aliasText, tokens[forIndex] as Tok);
  const t = (name: string): string => `${entity.bdef.iface}=>${name}`;
  const e = entity.index;
  const importing: Array<[string, string]> = [];
  const changing: Array<[string, string]> = [];
  const param = (role: HandlerParamRole, fallback: string): string => params[role] ?? fallback;
  const responses = (late: boolean, mapped: boolean): void => {
    if (mapped) {
      changing.push(["mapped", t(late ? derivedType.mappedLate : derivedType.mappedEarly)]);
    }
    changing.push(["failed", t(late ? derivedType.failedLate : derivedType.failedEarly)]);
    changing.push(["reported", t(late ? derivedType.reportedLate : derivedType.reportedEarly)]);
  };
  const actionOf = (name: string): { action: ActionModel; index: number } => {
    const found = context.catalog.action(entity, name);
    if (found === undefined) {
      throw new RewriteError("ABP006", `${entity.behavior.alias} has no action or function ${name}`, tokens[forIndex]);
    }
    return found;
  };
  switch (kind.kind) {
    case "validation":
      importing.push([param("keys", "keys"), t(derivedType.keys(e))]);
      responses(true, false);
      break;
    case "determination": {
      const determination = entity.behavior.determinations.find((d) => same(d.name, kind.name));
      importing.push([param("keys", "keys"), t(derivedType.keys(e))]);
      responses(determination?.on === "save", false);
      break;
    }
    case "action":
    case "function": {
      const { index: a } = actionOf(kind.name);
      importing.push([param("keys", "keys"), t(derivedType.actionImport(e, a))]);
      if (params.result !== undefined) {
        changing.push([params.result, t(derivedType.actionResult(e, a))]);
      }
      responses(false, kind.kind === "action");
      break;
    }
    case "globalAuthorization":
      importing.push([param("requested", "requested_authorizations"), t(derivedType.globalAuthRequest(e))]);
      changing.push([param("result", "result"), t(derivedType.globalAuthResult(e))]);
      responses(false, false);
      break;
    case "instanceAuthorization":
      importing.push([param("keys", "keys"), t(derivedType.keys(e))]);
      importing.push([param("requested", "requested_authorizations"), t(derivedType.instanceAuthRequest(e))]);
      changing.push([param("result", "result"), t(derivedType.instanceAuthResult(e))]);
      responses(false, false);
      break;
    case "globalFeatures":
      importing.push([param("requested", "requested_features"), t(derivedType.globalFeaturesRequest(e))]);
      changing.push([param("result", "result"), t(derivedType.globalFeaturesResult(e))]);
      responses(false, false);
      break;
    case "instanceFeatures":
      importing.push([param("keys", "keys"), t(derivedType.keys(e))]);
      importing.push([param("requested", "requested_features"), t(derivedType.instanceFeaturesRequest(e))]);
      changing.push([param("result", "result"), t(derivedType.instanceFeaturesResult(e))]);
      responses(false, false);
      break;
    case "numbering": {
      const association = kind.alias.includes("\\") ? kind.alias.slice(kind.alias.indexOf("\\") + 1) : undefined;
      const found = association === undefined ? undefined : context.catalog.association(entity, association);
      if (association !== undefined && found === undefined) {
        throw new RewriteError("ABP006", `${entity.behavior.alias} has no association ${association}`, tokens[forIndex]);
      }
      importing.push([param("entities", "entities"), t(found === undefined ? derivedType.create(e) : derivedType.assocCreate(e, found.index))]);
      responses(false, true);
      break;
    }
    case "precheck": {
      const [operation = "", detail] = kind.operation.split(":");
      let type: string;
      if (operation === "action") {
        type = derivedType.actionImport(e, actionOf(detail ?? "").index);
      } else if (operation === "create" && detail !== undefined) {
        const found = context.catalog.association(entity, detail);
        if (found === undefined) {
          throw new RewriteError("ABP006", `${entity.behavior.alias} has no association ${detail}`, tokens[forIndex]);
        }
        type = derivedType.assocCreate(e, found.index);
      } else if (operation === "create") {
        type = derivedType.create(e);
      } else if (operation === "update") {
        type = derivedType.update(e);
      } else {
        type = derivedType.delete(e);
      }
      importing.push([param("entities", "entities"), t(type)]);
      responses(false, false);
      break;
    }
  }
  const signature = [
    importing.length === 0 ? "" : `IMPORTING ${importing.map(([n, ty]) => `${n} TYPE ${ty}`).join(" ")}`,
    changing.length === 0 ? "" : `CHANGING ${changing.map(([n, ty]) => `${n} TYPE ${ty}`).join(" ")}`,
  ]
    .filter((s) => s !== "")
    .join(" ");
  edits.replace(tokens[forIndex] as Tok, end, signature);
  return true;
}

function resolveHandlerEntity(context: RewriteContext, alias: string, at: Tok): EntityInfo {
  const { catalog, pool } = context;
  const entity =
    (pool === undefined ? undefined : catalog.entityOf(pool, alias)) ??
    catalog.entityByName(alias) ??
    catalog.bdefs.map((b) => catalog.entityOf(b, alias)).find((e) => e !== undefined);
  if (entity === undefined) {
    throw new RewriteError("ABP006", `handler for ${alias}: no entity with this alias in the managed behavior definitions`, at);
  }
  return entity;
}

// ---------------------------------------------------------------------------------------------
// EML

function emlCode(statement: EmlStatement, context: RewriteContext): string {
  const { catalog } = context;
  const declarations: string[] = [];
  const calls: string[] = [];

  const source = (operand: Operand, iface: string, type: string): string => {
    const hash = inferredTypeToken(operand);
    return joinTokens(operand.tokens, hash === undefined ? undefined : new Map([[hash, `${iface}=>${type}`]]));
  };
  const target = (operand: Operand, iface: string, type: string): string => {
    const name = inlineDeclaration(operand);
    if (name !== undefined) {
      declarations.push(`DATA ${name} TYPE ${iface}=>${type}.`);
      return name;
    }
    return joinTokens(operand.tokens);
  };
  const changingPart = (pairs: Array<[string, string | undefined]>): string => {
    const given = pairs.filter((p): p is [string, string] => p[1] !== undefined);
    return given.length === 0 ? "" : ` CHANGING ${given.map(([n, v]) => `${n} = ${v}`).join(" ")}`;
  };
  /** `name( a = 1 b = 2 )`, or `name( EXPORTING a = 1 CHANGING c = x )` when there are changing parameters. */
  const call = (method: string, exporting: string, changing: string): string =>
    `${KERNEL}=>${method}(${changing === "" ? exporting : `${exporting === "" ? "" : ` EXPORTING${exporting}`}${changing}`} ).`;

  if (statement.kind === "rollback") {
    return `${KERNEL}=>rollback( ).`;
  }
  if (statement.kind === "commit") {
    calls.push(`${KERNEL}=>commit(${statement.simulation ? " simulation = abap_true " : " "}).`);
    for (const response of statement.responses) {
      const bdef = catalog.bdef(response.bdef.str);
      if (bdef === undefined) {
        throw unknownBdef(catalog, response.bdef.str, response.bdef);
      }
      const failed = response.failed === undefined ? undefined : target(response.failed, bdef.iface, derivedType.failedLate);
      const reported = response.reported === undefined ? undefined : target(response.reported, bdef.iface, derivedType.reportedLate);
      calls.push(call("commit_response", ` bdef = ${literal(bdef.behavior.name)}`, changingPart([["failed", failed], ["reported", reported]])));
    }
    return [...declarations, ...calls].join(" ");
  }

  // the BDEF of the statement and the entities of its groups
  let bdef: BdefInfo | undefined;
  const groupEntity: EntityInfo[] = [];
  if (statement.bdef !== undefined) {
    bdef = catalog.bdef(statement.bdef.str);
    if (bdef === undefined) {
      throw unknownBdef(catalog, statement.bdef.str, statement.bdef);
    }
    for (const group of statement.groups) {
      const entity = catalog.entityOf(bdef, group.entity.str);
      if (entity === undefined) {
        throw new RewriteError("ABP006", `${bdef.behavior.name} has no entity ${group.entity.str}`, group.entity);
      }
      groupEntity.push(entity);
    }
  } else {
    const group = statement.groups[0];
    if (group === undefined) {
      throw new RewriteError("ABP005", "EML statement without entity");
    }
    const resolved = resolvePath(catalog, group.entity, undefined);
    if (resolved.association !== undefined || resolved.action !== undefined) {
      throw new RewriteError("ABP005", `the entity of a short EML form is written without association or action: ${group.entity.str}`, group.entity);
    }
    bdef = resolved.entity.bdef;
    groupEntity.push(resolved.entity);
  }
  const iface = bdef.iface;
  const B = literal(bdef.behavior.name);

  const fieldArgs = (spec: FieldSpec, entity: EntityInfo, operation: "read" | "modify"): string => {
    switch (spec.kind) {
      case "all":
        return " fields = `*`";
      case "set":
        if (operation === "read") {
          throw new RewriteError("ABP005", "SET FIELDS WITH is not allowed in READ ENTITIES");
        }
        return " set_fields = abap_true";
      case "from":
        return "";
      case "list": {
        for (const field of spec.fields) {
          if (!entity.cds.fields.some((f) => same(f.name, field.str))) {
            throw new RewriteError("ABP006", `${entity.behavior.alias} has no field ${field.str}`, field);
          }
        }
        return ` fields = ${literal(spec.fields.map((f) => f.str).join(" "))}`;
      }
    }
  };

  statement.groups.forEach((group, g) => {
    const entity = groupEntity[g] as EntityInfo;
    const e = entity.index;
    const E = literal(entity.behavior.entity);
    const head = ` bdef = ${B} entity = ${E}`;
    for (const operation of group.operations) {
      switch (operation.kind) {
        case "read": {
          const result = operation.result === undefined ? undefined : target(operation.result, iface, derivedType.readResult(e));
          calls.push(call("read", `${head}${fieldArgs(operation.fields, entity, "read")} keys = ${source(operation.source, iface, derivedType.readImport(e))}`, changingPart([["result", result]])));
          break;
        }
        case "readBy": {
          const association = catalog.association(entity, operation.association.str);
          if (association === undefined) {
            throw new RewriteError("ABP006", `${entity.behavior.alias} has no association ${operation.association.str.replace(/^\\/, "")} to an entity of ${bdef?.behavior.name ?? ""}`, operation.association);
          }
          const b = association.index;
          const result = operation.result === undefined ? undefined : target(operation.result, iface, derivedType.assocReadResult(e, b));
          const link = operation.link === undefined ? undefined : target(operation.link, iface, derivedType.assocLink(e, b));
          calls.push(
            call(
              "read_by_association",
              `${head} association = ${literal(association.name)}${fieldArgs(operation.fields, association.target, "read")} keys = ${source(operation.source, iface, derivedType.assocReadImport(e, b))}`,
              changingPart([["result", result], ["link", link]]),
            ),
          );
          break;
        }
        case "function":
        case "execute": {
          const found = catalog.action(entity, operation.name.str);
          const expected = operation.kind === "function" ? "function" : "action";
          if (found === undefined || found.action.kind !== expected) {
            throw new RewriteError("ABP006", `${entity.behavior.alias} has no ${expected} ${operation.name.str}`, operation.name);
          }
          const a = found.index;
          const result = operation.result === undefined ? undefined : target(operation.result, iface, derivedType.actionResult(e, a));
          const autoFill = operation.kind === "execute" && operation.autoFillCid ? " auto_fill_cid = abap_true" : "";
          calls.push(call("execute", `${head} action = ${literal(found.action.name)}${autoFill} rows = ${source(operation.source, iface, derivedType.actionImport(e, a))}`, changingPart([["result", result]])));
          break;
        }
        case "create": {
          const autoFill = operation.autoFillCid ? " auto_fill_cid = abap_true" : "";
          calls.push(call("modify", `${head} operation = \`CREATE\`${fieldArgs(operation.fields, entity, "modify")}${autoFill} rows = ${source(operation.source, iface, derivedType.create(e))}`, ""));
          break;
        }
        case "createBy": {
          const association = catalog.association(entity, operation.association.str);
          if (association === undefined) {
            throw new RewriteError("ABP006", `${entity.behavior.alias} has no association ${operation.association.str.replace(/^\\/, "")} to an entity of ${bdef?.behavior.name ?? ""}`, operation.association);
          }
          const autoFill = operation.autoFillCid ? " auto_fill_cid = abap_true" : "";
          calls.push(
            call(
              "create_by_association",
              `${head} association = ${literal(association.name)}${fieldArgs(operation.fields, association.target, "modify")}${autoFill} rows = ${source(operation.source, iface, derivedType.assocCreate(e, association.index))}`,
              "",
            ),
          );
          break;
        }
        case "update":
          calls.push(call("modify", `${head} operation = \`UPDATE\`${fieldArgs(operation.fields, entity, "modify")} rows = ${source(operation.source, iface, derivedType.update(e))}`, ""));
          break;
        case "delete":
          calls.push(call("modify", `${head} operation = \`DELETE\` rows = ${source(operation.source, iface, derivedType.delete(e))}`, ""));
          break;
      }
    }
  });

  const mapped = statement.kind === "modify" && statement.mapped !== undefined ? target(statement.mapped, iface, derivedType.mappedEarly) : undefined;
  const failed = statement.failed === undefined ? undefined : target(statement.failed, iface, derivedType.failedEarly);
  const reported = statement.reported === undefined ? undefined : target(statement.reported, iface, derivedType.reportedEarly);
  const mode = statement.mode === "local" ? " local = abap_true" : statement.mode === "privileged" ? " privileged = abap_true" : "";
  return [
    ...declarations,
    call("begin", ` bdef = ${B}${mode}`, ""),
    ...calls,
    call("end", "", changingPart([["mapped", mapped], ["failed", failed], ["reported", reported]])),
  ].join(" ");
}

/** The BDEF a class implements: `FOR BEHAVIOR OF x` in its definition, or the model. */
export function poolBdefOf(catalog: BdefCatalog, className: string, mainFile: abaplint.ABAPFile | undefined): BdefInfo | undefined {
  for (const statement of mainFile?.getStatements() ?? []) {
    const tokens = toks(statement.getTokens());
    const i = tokens.findIndex((t, n) => t.upper === "FOR" && tokens[n + 1]?.upper === "BEHAVIOR" && tokens[n + 2]?.upper === "OF");
    if (i >= 0 && tokens[i + 3] !== undefined) {
      const found = catalog.bdef((tokens[i + 3] as Tok).str);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return catalog.bdefs.find((b) => same(b.behavior.implementationClass ?? "", className) || b.behavior.entities.some((e) => same(e.implementationClass ?? "", className)));
}
