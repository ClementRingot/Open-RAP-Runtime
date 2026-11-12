/**
 * Behavior pools: ABAP syntax check (abaplint) and discovery of the handler methods that
 * implement the validations, determinations, actions, authorizations and feature controls.
 */

import * as abaplint from "@abaplint/core";
import { same, type BehaviorModel, type EntityBehaviorModel, type EntityModel, type HandlerParamRole, type HandlerRef, type SaverModel } from "@open-rap-runtime/model";
import type { Diagnostics } from "../diagnostics.js";
import type { Project } from "../input/project.js";

const ABAP_TYPES = new Set(["CLAS", "INTF", "BDEF", "DDLS", "DDLX", "TABL", "DTEL", "DOMA", "SRVD", "MSAG", "DEVC", "TTYP"]);

export function abaplintRegistry(project: Project): abaplint.Registry {
  const config = new abaplint.Config(
    JSON.stringify({
      global: { files: "/**/*.*" },
      syntax: { version: abaplint.Version.Cloud, errorNamespace: "^(Z|Y|LCL_|LHC_|LSC_|TY_|LIF_)" },
      rules: { parser_error: true },
    }),
  );
  const registry = new abaplint.Registry(config);
  for (const file of project.files) {
    if (ABAP_TYPES.has(file.type)) {
      registry.addFile(new abaplint.MemoryFile(file.fileName, file.content));
    }
  }
  registry.parse();
  return registry;
}

const EML_START = /^\s*(?:(?:READ|MODIFY)\s+ENTIT|(?:COMMIT|ROLLBACK)\s+ENTITIES\b)/i;

/**
 * Parser errors of the behavior pools, on the lines of the original sources. The complete check
 * (types included) runs on the rewritten sources, where the derived types are known
 * (gen/abap/generate.ts). EML statements are parsed by the rewrite pass: abaplint does not know
 * every form of them.
 */
export function syntaxCheck(project: Project, registry: abaplint.Registry, classes: string[], diagnostics: Diagnostics): void {
  const wanted = new Set(classes.map((c) => c.toUpperCase()));
  for (const issue of registry.findIssues()) {
    const key = issue.getKey();
    if (key !== "parser_error") {
      continue;
    }
    const fileName = issue.getFilename();
    const file = project.files.find((f) => f.fileName === fileName);
    if (file === undefined || (file.type === "CLAS" && !wanted.has(file.name))) {
      continue;
    }
    if (file.type !== "CLAS" && file.type !== "INTF") {
      continue;
    }
    const lines = file.content.split("\n");
    const start = issue.getStart();
    const rest = [(lines[start.getRow() - 1] ?? "").slice(start.getCol() - 1), ...lines.slice(start.getRow(), start.getRow() + 2)].join("\n");
    if (EML_START.test(rest)) {
      continue;
    }
    diagnostics.error("ABP004", `ABAP ${key === "parser_error" ? "syntax" : "check"} error: ${issue.getMessage()}`, {
      file: file.path,
      line: issue.getStart().getRow(),
      column: issue.getStart().getCol(),
    });
  }
}

type HandlerKind =
  | { kind: "validation"; alias: string; name: string }
  | { kind: "determination"; alias: string; name: string }
  | { kind: "action"; alias: string; name: string }
  | { kind: "function"; alias: string; name: string }
  | { kind: "globalAuthorization"; alias: string }
  | { kind: "instanceAuthorization"; alias: string }
  | { kind: "globalFeatures"; alias: string }
  | { kind: "instanceFeatures"; alias: string }
  | { kind: "numbering"; alias: string }
  | { kind: "precheck"; alias: string; operation: string }
  | { kind: "other"; text: string };

interface FoundHandler {
  ref: HandlerRef;
  what: HandlerKind;
  file: string;
  line: number;
  used: boolean;
}

/** Classifies a RAP handler method definition (`METHODS x FOR …`). */
export function classifyMethodDefinition(statement: string): { method: string; kind: HandlerKind; params: Partial<Record<HandlerParamRole, string>> } | undefined {
  const text = statement.replace(/\s+/g, " ").trim().replace(/\.$/, "").trim();
  const head = /^(?:CLASS-)?METHODS (\S+) FOR (.*)$/i.exec(text);
  if (head === null) {
    return undefined;
  }
  const method = (head[1] ?? "").toLowerCase();
  const rest = head[2] ?? "";
  const params: Partial<Record<HandlerParamRole, string>> = {};
  const lower = (s: string | undefined): string => (s ?? "").toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /^VALIDATE ON SAVE IMPORTING (\S+) FOR (\S+)~(\S+)$/i.exec(rest))) {
    params.keys = lower(m[1]);
    return { method, kind: { kind: "validation", alias: m[2] ?? "", name: m[3] ?? "" }, params };
  }
  if ((m = /^DETERMINE ON (?:MODIFY|SAVE) IMPORTING (\S+) FOR (\S+)~(\S+)$/i.exec(rest))) {
    params.keys = lower(m[1]);
    return { method, kind: { kind: "determination", alias: m[2] ?? "", name: m[3] ?? "" }, params };
  }
  if ((m = /^MODIFY (?:IMPORTING )?(\S+) FOR ACTION (\S+)~(\S+)(?: (?:REQUEST (\S+) )?RESULT (\S+))?$/i.exec(rest))) {
    params.keys = lower(m[1]);
    if (m[5] !== undefined) {
      params.result = lower(m[5]);
    }
    return { method, kind: { kind: "action", alias: m[2] ?? "", name: m[3] ?? "" }, params };
  }
  if ((m = /^READ (?:IMPORTING )?(\S+) FOR FUNCTION (\S+)~(\S+)(?: (?:REQUEST (\S+) )?RESULT (\S+))?$/i.exec(rest))) {
    params.keys = lower(m[1]);
    if (m[5] !== undefined) {
      params.result = lower(m[5]);
    }
    return { method, kind: { kind: "function", alias: m[2] ?? "", name: m[3] ?? "" }, params };
  }
  if ((m = /^GLOBAL AUTHORIZATION IMPORTING REQUEST (\S+) FOR (\S+) RESULT (\S+)$/i.exec(rest))) {
    params.requested = lower(m[1]);
    params.result = lower(m[3]);
    return { method, kind: { kind: "globalAuthorization", alias: m[2] ?? "" }, params };
  }
  if ((m = /^(?:INSTANCE )?AUTHORIZATION IMPORTING (\S+) REQUEST (\S+) FOR (\S+) RESULT (\S+)$/i.exec(rest))) {
    params.keys = lower(m[1]);
    params.requested = lower(m[2]);
    params.result = lower(m[4]);
    return { method, kind: { kind: "instanceAuthorization", alias: m[3] ?? "" }, params };
  }
  if ((m = /^GLOBAL FEATURES IMPORTING REQUEST (\S+) FOR (\S+) RESULT (\S+)$/i.exec(rest))) {
    params.requested = lower(m[1]);
    params.result = lower(m[3]);
    return { method, kind: { kind: "globalFeatures", alias: m[2] ?? "" }, params };
  }
  if ((m = /^INSTANCE FEATURES IMPORTING (\S+) REQUEST (\S+) FOR (\S+) RESULT (\S+)$/i.exec(rest))) {
    params.keys = lower(m[1]);
    params.requested = lower(m[2]);
    params.result = lower(m[4]);
    return { method, kind: { kind: "instanceFeatures", alias: m[3] ?? "" }, params };
  }
  if ((m = /^NUMBERING IMPORTING (\S+) FOR CREATE (\S+)$/i.exec(rest))) {
    params.entities = lower(m[1]);
    return { method, kind: { kind: "numbering", alias: m[2] ?? "" }, params };
  }
  if ((m = /^PRECHECK IMPORTING (\S+) FOR (CREATE|UPDATE|DELETE) (\S+)$/i.exec(rest))) {
    params.entities = lower(m[1]);
    const target = m[3] ?? "";
    const byAssociation = /^(\S+?)\\(\S+)$/.exec(target);
    if (byAssociation !== null) {
      return { method, kind: { kind: "precheck", alias: byAssociation[1] ?? "", operation: `create:${byAssociation[2] ?? ""}` }, params };
    }
    return { method, kind: { kind: "precheck", alias: target, operation: lower(m[2]) }, params };
  }
  if ((m = /^PRECHECK IMPORTING (\S+) FOR ACTION (\S+)~(\S+)$/i.exec(rest))) {
    params.entities = lower(m[1]);
    return { method, kind: { kind: "precheck", alias: m[2] ?? "", operation: `action:${m[3] ?? ""}` }, params };
  }
  return { method, kind: { kind: "other", text: rest }, params };
}

/** Finds the local handler classes of a behavior pool and their RAP methods. */
function findHandlers(registry: abaplint.Registry, poolName: string, project: Project): FoundHandler[] {
  const object = registry.getObject("CLAS", poolName);
  if (!(object instanceof abaplint.Objects.Class)) {
    return [];
  }
  const found: FoundHandler[] = [];
  for (const file of object.getABAPFiles()) {
    const sourceFile = project.files.find((f) => f.fileName === file.getFilename());
    for (const definition of file.getStructure()?.findAllStructures(abaplint.Structures.ClassDefinition) ?? []) {
      const header = definition.findFirstStatement(abaplint.Statements.ClassDefinition);
      const headerText = (header?.concatTokens() ?? "").replace(/\s+/g, " ").replace(/\s*\.$/, "");
      const nameMatch = /^CLASS (\S+) DEFINITION/i.exec(headerText);
      const superMatch = /INHERITING FROM (\S+)/i.exec(headerText);
      const className = (nameMatch?.[1] ?? "").toUpperCase();
      if (superMatch === null || !same(superMatch[1] ?? "", "CL_ABAP_BEHAVIOR_HANDLER")) {
        continue;
      }
      for (const statement of definition.findAllStatements(abaplint.Statements.MethodDef)) {
        const classified = classifyMethodDefinition(statement.concatTokens());
        if (classified === undefined) {
          continue;
        }
        const params: Partial<Record<HandlerParamRole, string>> = { failed: "failed", reported: "reported", ...classified.params };
        if (classified.kind.kind === "action" || classified.kind.kind === "numbering") {
          params.mapped = "mapped";
        }
        found.push({
          ref: { classKey: `CLAS-${poolName.toUpperCase()}-${className}`, className, method: classified.method, params },
          what: classified.kind,
          file: sourceFile?.path ?? file.getFilename(),
          line: statement.getStart().getRow(),
          used: false,
        });
      }
    }
  }
  return found;
}

interface FoundSaver {
  saver: SaverModel;
  /** Saver methods redefined, lower case. */
  methods: Map<string, number>;
  file: string;
  line: number;
}

/** The local saver class of a behavior pool (`INHERITING FROM cl_abap_behavior_saver[_failed]`). */
function findSaver(registry: abaplint.Registry, poolName: string, project: Project): FoundSaver | undefined {
  const object = registry.getObject("CLAS", poolName);
  if (!(object instanceof abaplint.Objects.Class)) {
    return undefined;
  }
  for (const file of object.getABAPFiles()) {
    const sourceFile = project.files.find((f) => f.fileName === file.getFilename());
    for (const definition of file.getStructure()?.findAllStructures(abaplint.Structures.ClassDefinition) ?? []) {
      const header = definition.findFirstStatement(abaplint.Statements.ClassDefinition);
      const headerText = (header?.concatTokens() ?? "").replace(/\s+/g, " ");
      const superMatch = /INHERITING FROM (\S+)/i.exec(headerText);
      const superclass = (superMatch?.[1] ?? "").replace(/\.$/, "").toUpperCase();
      if (superclass !== "CL_ABAP_BEHAVIOR_SAVER" && superclass !== "CL_ABAP_BEHAVIOR_SAVER_FAILED") {
        continue;
      }
      const className = (/^CLASS (\S+) DEFINITION/i.exec(headerText)?.[1] ?? "").toUpperCase();
      const methods = new Map<string, number>();
      for (const statement of definition.findAllStatements(abaplint.Statements.MethodDef)) {
        const name = statement.getTokens()[1]?.getStr().toLowerCase();
        if (name !== undefined) {
          methods.set(name, statement.getStart().getRow());
        }
      }
      return {
        saver: { classKey: `CLAS-${poolName.toUpperCase()}-${className}`, className, withFailed: superclass === "CL_ABAP_BEHAVIOR_SAVER_FAILED" },
        methods,
        file: sourceFile?.path ?? file.getFilename(),
        line: header?.getStart().getRow() ?? 1,
      };
    }
  }
  return undefined;
}

/** The saver class for additional and unmanaged save (save_modified, cleanup). */
function attachSaver(behavior: BehaviorModel, pools: Set<string>, registry: abaplint.Registry, project: Project, diagnostics: Diagnostics): void {
  const needed = behavior.saving !== undefined || behavior.entities.some((e) => e.saving !== undefined);
  let found: FoundSaver | undefined;
  for (const pool of pools) {
    found ??= findSaver(registry, pool, project);
  }
  if (found === undefined) {
    if (needed) {
      diagnostics.error("ABP002", `${behavior.name}: with additional or unmanaged save, the behavior pool needs a saver class (INHERITING FROM cl_abap_behavior_saver) with save_modified`, behavior.src);
    }
    return;
  }
  if (!needed) {
    diagnostics.warning("ABP003", `saver class ${found.saver.className} is not called: the BDEF has no with additional save or with unmanaged save`, { file: found.file, line: found.line });
    return;
  }
  const ref = (method: string): HandlerRef => ({
    classKey: found.saver.classKey,
    className: found.saver.className,
    method,
    params: { reported: "reported", ...(found.saver.withFailed ? { failed: "failed" } : {}) },
  });
  if (found.methods.has("save_modified")) {
    found.saver.saveModified = ref("save_modified");
  } else {
    diagnostics.error("ABP002", `saver class ${found.saver.className} must redefine save_modified`, { file: found.file, line: found.line });
  }
  if (found.methods.has("cleanup")) {
    found.saver.cleanup = { ...ref("cleanup"), params: {} };
  }
  for (const [method, line] of found.methods) {
    if (method !== "save_modified" && method !== "cleanup") {
      diagnostics.warning("ABP003", `saver method ${method} is not available in a managed BO with additional or unmanaged save and is not called`, { file: found.file, line });
    }
  }
  behavior.saver = found.saver;
}

/** Links the handlers of the behavior pools to the BDEF elements and reports what is missing. */
/** The behavior, in the same BDEF, of the target of an association of `entity`. */
function targetBehavior(behavior: BehaviorModel, entity: EntityBehaviorModel, association: string, entities: readonly EntityModel[]): EntityBehaviorModel | undefined {
  const source = entities.find((e) => same(e.name, entity.entity));
  const target = source?.associations.find((a) => same(a.name, association))?.target;
  return target === undefined ? undefined : behavior.entities.find((e) => same(e.entity, target));
}

export function attachHandlers(behavior: BehaviorModel, registry: abaplint.Registry, project: Project, diagnostics: Diagnostics, entities: readonly EntityModel[] = []): void {
  if (behavior.implementationType !== "managed") {
    return;
  }
  const pools = new Set<string>();
  if (behavior.implementationClass !== undefined) {
    pools.add(behavior.implementationClass);
  }
  for (const entity of behavior.entities) {
    if (entity.implementationClass !== undefined) {
      pools.add(entity.implementationClass);
    }
  }
  const handlers: FoundHandler[] = [];
  for (const pool of pools) {
    const object = registry.getObject("CLAS", pool);
    if (object === undefined) {
      diagnostics.error("ABP001", `behavior pool ${pool} not found in the sources`, behavior.src);
      continue;
    }
    handlers.push(...findHandlers(registry, pool, project));
  }
  attachSaver(behavior, pools, registry, project, diagnostics);
  const take = (entity: EntityBehaviorModel, predicate: (h: FoundHandler) => boolean): HandlerRef | undefined => {
    const handler = handlers.find((h) => "alias" in h.what && (same(h.what.alias, entity.alias) || same(h.what.alias, entity.entity)) && predicate(h));
    if (handler !== undefined) {
      handler.used = true;
    }
    return handler?.ref;
  };
  for (const entity of behavior.entities) {
    for (const validation of entity.validations) {
      const ref = take(entity, (h) => h.what.kind === "validation" && same(h.what.name, validation.name));
      if (ref === undefined) {
        diagnostics.error("ABP002", `no handler method FOR VALIDATE ON SAVE for ${entity.alias}~${validation.name}`, validation.src);
      } else {
        validation.handler = ref;
      }
    }
    for (const determination of entity.determinations) {
      const ref = take(entity, (h) => h.what.kind === "determination" && same(h.what.name, determination.name));
      if (ref === undefined) {
        diagnostics.error("ABP002", `no handler method FOR DETERMINE ON ${determination.on.toUpperCase()} for ${entity.alias}~${determination.name}`, determination.src);
      } else {
        determination.handler = ref;
      }
    }
    for (const action of entity.actions) {
      const ref = take(entity, (h) => (h.what.kind === "action" || h.what.kind === "function") && same(h.what.name, action.name));
      if (ref === undefined) {
        diagnostics.error("ABP002", `no handler method for ${action.kind} ${entity.alias}~${action.name}`, action.src);
      } else {
        action.handler = ref;
      }
    }
    const needsInstanceFeatures =
      entity.operations.some((o) => o.features === "instance") ||
      entity.actions.some((a) => a.features === "instance") ||
      entity.associations.some((a) => a.createFeatures === "instance") ||
      Object.values(entity.fieldCharacteristics).some((c) => c.includes("featuresInstance"));
    const needsGlobalFeatures =
      entity.operations.some((o) => o.features === "global") ||
      entity.actions.some((a) => a.features === "global") ||
      entity.associations.some((a) => a.createFeatures === "global");
    const instanceFeatures = take(entity, (h) => h.what.kind === "instanceFeatures");
    if (instanceFeatures !== undefined) {
      entity.instanceFeaturesHandler = instanceFeatures;
    } else if (needsInstanceFeatures) {
      diagnostics.error("ABP002", `no handler method FOR INSTANCE FEATURES for ${entity.alias}`, entity.src);
    }
    const globalFeatures = take(entity, (h) => h.what.kind === "globalFeatures");
    if (globalFeatures !== undefined) {
      entity.globalFeaturesHandler = globalFeatures;
    } else if (needsGlobalFeatures) {
      diagnostics.error("ABP002", `no handler method FOR GLOBAL FEATURES for ${entity.alias}`, entity.src);
    }
    if (entity.authorization?.kind === "master") {
      const globalAuth = take(entity, (h) => h.what.kind === "globalAuthorization");
      const instanceAuth = take(entity, (h) => h.what.kind === "instanceAuthorization");
      if (globalAuth !== undefined) {
        entity.globalAuthorizationHandler = globalAuth;
      } else if (entity.authorization.global) {
        diagnostics.error("ABP002", `no handler method FOR GLOBAL AUTHORIZATION for ${entity.alias}`, entity.src);
      }
      if (instanceAuth !== undefined) {
        entity.instanceAuthorizationHandler = instanceAuth;
      } else if (entity.authorization.instance) {
        diagnostics.error("ABP002", `no handler method FOR INSTANCE AUTHORIZATION for ${entity.alias}`, entity.src);
      }
    }
    if (entity.earlyNumbering) {
      // the numbering of the direct creation; an entity created by association only (a child)
      // is numbered by the handlers of its parents' associations below
      const numbering = take(entity, (h) => h.what.kind === "numbering");
      if (numbering !== undefined) {
        entity.earlyNumberingHandler = numbering;
      } else if (entity.operations.some((o) => o.kind === "create")) {
        diagnostics.error("ABP002", `no handler method FOR NUMBERING for ${entity.alias}`, entity.src);
      }
    }
    // early numbering by association: FOR NUMBERING … FOR CREATE Travel\_Booking
    for (const association of entity.associations.filter((a) => a.create)) {
      const target = targetBehavior(behavior, entity, association.name, entities);
      if (target === undefined || !target.earlyNumbering) {
        continue;
      }
      const name = `${entity.alias}\\${association.name}`;
      const handler = handlers.find((h) => h.what.kind === "numbering" && (same(h.what.alias, name) || same(h.what.alias, `${entity.entity}\\${association.name}`)));
      if (handler === undefined) {
        diagnostics.error("ABP002", `no handler method FOR NUMBERING for ${name}`, entity.src);
      } else {
        handler.used = true;
        association.earlyNumberingHandler = handler.ref;
      }
    }
    for (const handler of handlers) {
      if (handler.what.kind === "precheck" && (same(handler.what.alias, entity.alias) || same(handler.what.alias, entity.entity))) {
        // the BDEF must declare the precheck of the operation, else the handler is not called
        const [operation = "", detail = ""] = handler.what.operation.toLowerCase().split(":");
        const declared =
          operation === "action"
            ? entity.actions.some((a) => same(a.name, detail) && a.precheck)
            : operation === "create" && detail !== ""
              ? entity.associations.some((a) => same(a.name, detail) && a.createPrecheck)
              : entity.operations.some((o) => o.kind === operation && o.precheck);
        if (declared) {
          entity.precheckHandlers[handler.what.operation.toLowerCase()] = handler.ref;
          handler.used = true;
        }
      }
    }
  }
  for (const handler of handlers.filter((h) => !h.used)) {
    const description = handler.what.kind === "other" ? `FOR ${handler.what.text}` : handler.what.kind;
    diagnostics.warning("ABP003", `handler method ${handler.ref.className}->${handler.ref.method} (${description}) does not match the BDEF and is not called`, {
      file: handler.file,
      line: handler.line,
    });
  }
}
