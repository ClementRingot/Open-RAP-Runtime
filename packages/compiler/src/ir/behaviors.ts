/** BDEF AST → IR behavior, with the checks against the CDS entities and the dictionary. */

import {
  findAssociation,
  findField,
  type ActionModel,
  type BehaviorAssociationModel,
  type BehaviorModel,
  type DeterminationModel,
  type EntityBehaviorModel,
  type EntityModel,
  type ProjectMode,
  type FeatureControl,
  type FieldCharacteristic,
  type OperationModel,
  type SideEffectModel,
  type TriggerModel,
  type ValidationModel,
} from "@rap-transpiler/model";
import type { BdefAst, BehaviorAst, BodyItemAst, Loc, OperationOptionAst, TriggerAst } from "../bdef/ast.js";
import type { Diagnostics } from "../diagnostics.js";
import type { SourceFile } from "../input/project.js";
import type { Dictionary } from "./dictionary.js";

const FIELD_CHARACTERISTICS: Record<string, FieldCharacteristic> = {
  readonly: "readonly",
  "readonly:update": "readonlyUpdate",
  mandatory: "mandatory",
  "mandatory:create": "mandatoryCreate",
  "numbering:managed": "numberingManaged",
  "features:instance": "featuresInstance",
  suppress: "suppress",
};

/** The actions of a draft BO, provided by the runtime (D54). */
export const DRAFT_ACTIONS = new Set(["edit", "activate", "discard", "resume", "prepare", "share"]);

export interface BehaviorContext {
  diagnostics: Diagnostics;
  dictionary: Dictionary;
  entity: (name: string) => EntityModel | undefined;
  /** The mode of the project (D45): some constructions are rap-transpiler extensions. */
  mode?: ProjectMode;
}

export function buildBehavior(name: string, ast: BdefAst, file: SourceFile, ctx: BehaviorContext): BehaviorModel | undefined {
  const at = (loc: Loc): { file: string; line: number; column: number } => ({ file: file.path, line: loc.line, column: loc.column });
  const { diagnostics } = ctx;
  const implementation = ast.headers.find((h) => h.kind === "implementation");
  if (implementation === undefined || implementation.kind !== "implementation") {
    diagnostics.error("BDEF010", "missing implementation type (managed or projection)", { file: file.path, line: 1, column: 1 });
    return undefined;
  }
  if (implementation.type !== "managed" && implementation.type !== "projection") {
    diagnostics.error("BDEF002", `implementation type ${implementation.type} is not supported (managed and projection only)`, at(implementation.loc));
    return undefined;
  }
  const behavior: BehaviorModel = {
    name: name.toUpperCase(),
    implementationType: implementation.type,
    privilegedMode: false,
    entities: [],
    src: at(implementation.loc),
  };
  if (implementation.className !== undefined) {
    behavior.implementationClass = implementation.className.text.toUpperCase();
  }
  if (implementation.saving !== undefined) {
    if (implementation.type !== "managed") {
      diagnostics.error("BDEF012", `with ${implementation.saving.variant} save is only possible in a managed BDEF`, at(implementation.loc));
    } else {
      behavior.saving = { kind: implementation.saving.variant, fullData: implementation.saving.fullData };
    }
  }
  for (const header of ast.headers) {
    switch (header.kind) {
      case "implementation":
        break;
      case "strict":
        behavior.strict = header.version;
        break;
      case "withDraft":
        behavior.draft = true;
        if (header.collaborative === true) {
          // with collaborative draft: several users edit the draft, invited by Share (D59)
          behavior.collaborativeDraft = true;
        }
        break;
      case "privilegedMode":
        behavior.privilegedMode = true;
        break;
      case "use":
        if (header.what.includes("draft")) {
          behavior.draft = true;
        } else {
          diagnostics.warning("BDEF003", `use ${header.what} is ignored`, at(header.loc));
        }
        break;
      case "foreignEntity":
        diagnostics.warning("BDEF003", `foreign entity ${header.name.text} is ignored`, at(header.loc));
        break;
      case "unknown":
        diagnostics.warning("BDEF003", `unknown BDEF header statement ignored: ${header.text}`, at(header.loc));
        break;
    }
  }
  for (const other of ast.others) {
    diagnostics.warning("BDEF003", `statement ignored: ${other.text}`, at(other.loc));
  }
  for (const definition of ast.behaviors) {
    const entityBehavior = buildEntityBehavior(behavior, definition, at, ctx);
    if (entityBehavior !== undefined) {
      behavior.entities.push(entityBehavior);
    }
  }
  if (behavior.implementationType === "managed" && behavior.implementationClass === undefined && behavior.entities.every((e) => e.implementationClass === undefined)) {
    const needsCode = behavior.entities.some((e) => e.determinations.length + e.validations.length + e.actions.length > 0);
    if (needsCode) {
      diagnostics.error("BDEF011", "a behavior pool is required (implementation in class … unique) for determinations, validations and actions", at(implementation.loc));
    }
  }
  return behavior;
}

function buildEntityBehavior(
  behavior: BehaviorModel,
  ast: BehaviorAst,
  at: (loc: Loc) => { file: string; line: number; column: number },
  ctx: BehaviorContext,
): EntityBehaviorModel | undefined {
  const { diagnostics } = ctx;
  const entity = ctx.entity(ast.entity.text);
  if (entity === undefined) {
    diagnostics.error("BDEF004", `unknown CDS entity ${ast.entity.text}`, at(ast.entity.loc));
    return undefined;
  }
  const isProjection = behavior.implementationType === "projection";
  const model: EntityBehaviorModel = {
    entity: entity.name,
    alias: ast.alias?.text ?? entity.name,
    root: entity.root,
    earlyNumbering: false,
    operations: [],
    associations: [],
    fieldCharacteristics: {},
    determinations: [],
    validations: [],
    actions: [],
    sideEffects: [],
    useEtag: false,
    precheckHandlers: {},
    src: at(ast.loc),
  };
  const checkField = (name: string, loc: Loc, what: string): string | undefined => {
    const field = findField(entity, name);
    if (field === undefined) {
      diagnostics.error("BDEF005", `${what}: ${entity.name} has no element ${name}`, at(loc));
      return undefined;
    }
    return field.name;
  };
  const checkAssociation = (name: string, loc: Loc, what: string): string | undefined => {
    const association = findAssociation(entity, name);
    if (association === undefined) {
      diagnostics.error("BDEF006", `${what}: ${entity.name} has no association ${name}`, at(loc));
      return undefined;
    }
    return association.name;
  };

  for (const option of ast.options) {
    switch (option.kind) {
      case "persistentTable":
        if (isProjection) {
          diagnostics.error("BDEF012", "a projection BDEF has no persistent table", at(option.loc));
        } else if (!ctx.dictionary.hasTable(option.table.text)) {
          diagnostics.error("BDEF007", `unknown persistent table ${option.table.text}`, at(option.table.loc));
        } else {
          model.persistentTable = option.table.text.toLowerCase();
        }
        break;
      case "lockMaster":
        if (option.unmanaged) {
          diagnostics.error("BDEF002", "lock master unmanaged is not supported", at(option.loc));
        }
        model.lock = { kind: "master" };
        break;
      case "lockDependent": {
        const by = option.by === undefined ? parentAssociation(entity) : checkAssociation(option.by.text, option.by.loc, "lock dependent");
        if (by !== undefined) {
          model.lock = { kind: "dependent", by };
        }
        break;
      }
      case "authorizationMaster": {
        const values = option.values.map((v) => v.toLowerCase());
        if (values.includes("none")) {
          break;
        }
        model.authorization = { kind: "master", global: values.includes("global"), instance: values.includes("instance") };
        for (const v of values.filter((x) => !["global", "instance"].includes(x))) {
          diagnostics.warning("BDEF003", `authorization master option ${v} is ignored`, at(option.loc));
        }
        break;
      }
      case "authorizationDependent": {
        const by = option.by === undefined ? parentAssociation(entity) : checkAssociation(option.by.text, option.by.loc, "authorization dependent");
        if (by !== undefined) {
          model.authorization = { kind: "dependent", by };
        }
        break;
      }
      case "etagMaster": {
        const field = checkField(option.field.text, option.field.loc, "etag master");
        if (field !== undefined) {
          model.etag = { kind: "master", field };
        }
        break;
      }
      case "etagDependent": {
        const by = option.by === undefined ? parentAssociation(entity) : checkAssociation(option.by.text, option.by.loc, "etag dependent");
        if (by !== undefined) {
          model.etag = { kind: "dependent", by };
        }
        break;
      }
      case "totalEtag":
        // the ETag of the draft: the change time of the draft, kept by the runtime (D54)
        break;
      case "draftTable":
        model.draftTable = option.table.text.toLowerCase();
        break;
      case "earlyNumbering":
        model.earlyNumbering = true;
        break;
      case "lateNumbering":
        diagnostics.error("BDEF002", "late numbering is not supported", at(option.loc));
        break;
      case "implementationInClass":
        model.implementationClass = option.className.text.toUpperCase();
        break;
      case "withSave":
        if (isProjection) {
          diagnostics.error("BDEF012", `with ${option.variant} save is only possible in a managed BDEF`, at(option.loc));
        } else {
          model.saving = { kind: option.variant, fullData: option.fullData };
        }
        break;
      case "useEtag":
        if (!isProjection) {
          diagnostics.error("BDEF012", "use etag is only allowed in a projection BDEF", at(option.loc));
        }
        model.useEtag = true;
        break;
      case "unknown":
        diagnostics.warning("BDEF003", `entity option ignored: ${option.text}`, at(option.loc));
        break;
    }
  }

  for (const item of ast.items) {
    buildItem(model, item, entity, behavior, at, ctx, checkField, checkAssociation);
  }

  if (!isProjection) {
    const unmanagedSave = (model.saving ?? behavior.saving)?.kind === "unmanaged";
    if (entity.kind === "custom" && unmanagedSave) {
      // rap-transpiler only (D43): instances read by the query class, written by save_modified;
      // an extension of the enhanced mode (D45)
      if (ctx.mode === "enhanced") {
        diagnostics.info(
          "BDEF027",
          `${entity.name}: managed BO with unmanaged save on a custom entity (enhanced mode): it cannot be activated on SAP (unmanaged BO there)`,
          at(ast.entity.loc),
        );
      } else {
        diagnostics.error(
          "BDEF027",
          `${entity.name}: a managed BO with unmanaged save on a custom entity is an extension of rap-transpiler: set "mode": "enhanced" in rapt/config.json (on SAP, an unmanaged BO)`,
          at(ast.entity.loc),
        );
      }
    } else if (entity.kind !== "view") {
      diagnostics.error("BDEF013", `${entity.name}: a managed BDEF must be defined on a view entity, not a ${entity.kind}${entity.kind === "custom" ? " (except with unmanaged save, D43)" : ""}`, at(ast.entity.loc));
    }
    if (model.persistentTable === undefined && !unmanagedSave && entity.tableEntity === true && entity.source !== undefined) {
      // a table entity is its own persistence (D55)
      model.persistentTable = entity.source;
    }
    if (model.persistentTable === undefined && !unmanagedSave) {
      diagnostics.error("BDEF014", `${entity.name}: a managed entity needs a persistent table (or with unmanaged save)`, at(ast.loc));
    }
    if (model.persistentTable !== undefined && unmanagedSave) {
      diagnostics.warning("BDEF003", `${entity.name}: with unmanaged save, the persistent table is not written by the RAP runtime (save_modified writes)`, at(ast.loc));
    }
    if (model.lock === undefined) {
      diagnostics.error("BDEF015", `${entity.name}: lock master or lock dependent is required`, at(ast.loc));
    } else if (model.lock.kind === "master" && !entity.root) {
      diagnostics.error("BDEF015", `${entity.name}: only the root entity can be lock master`, at(ast.loc));
    }
    if (behavior.strict !== undefined && behavior.strict >= 1 && model.authorization === undefined) {
      diagnostics.warning("BDEF016", `${entity.name}: strict mode requires an authorization definition`, at(ast.loc));
    }
    for (const [field, characteristics] of Object.entries(model.fieldCharacteristics)) {
      if (characteristics.includes("numberingManaged")) {
        const f = findField(entity, field);
        if (f !== undefined && !f.key) {
          diagnostics.error("BDEF017", `${entity.name}.${field}: numbering : managed applies to key fields`, at(ast.loc));
        } else if (f !== undefined && !(f.type.kind === "raw" && f.type.length === 16)) {
          diagnostics.error("BDEF017", `${entity.name}.${field}: numbering : managed needs a RAW(16) UUID field`, at(ast.loc));
        }
      }
    }
    checkMapping(model, entity, at, ctx);
  }
  return model;
}

function parentAssociation(entity: EntityModel): string | undefined {
  return entity.associations.find((a) => a.kind === "toParent")?.name;
}

function features(options: OperationOptionAst[], at: (loc: Loc) => object, ctx: BehaviorContext, what: string): { features?: FeatureControl; precheck: boolean } {
  const result: { features?: FeatureControl; precheck: boolean } = { precheck: false };
  for (const option of options) {
    if (option.name === "features" && (option.value === "instance" || option.value === "global")) {
      result.features = option.value;
    } else if (option.name === "precheck") {
      result.precheck = true;
    } else if (option.name === "authorization" && (option.value === "update" || option.value === "none")) {
      ctx.diagnostics.warning("BDEF003", `${what}: authorization : ${option.value} is ignored`, at(option.loc));
    } else {
      ctx.diagnostics.warning("BDEF003", `${what}: option ${option.name}${option.value ? ` : ${option.value}` : ""} is ignored`, at(option.loc));
    }
  }
  return result;
}

function buildItem(
  model: EntityBehaviorModel,
  item: BodyItemAst,
  entity: EntityModel,
  behavior: BehaviorModel,
  at: (loc: Loc) => { file: string; line: number; column: number },
  ctx: BehaviorContext,
  checkField: (name: string, loc: Loc, what: string) => string | undefined,
  checkAssociation: (name: string, loc: Loc, what: string) => string | undefined,
): void {
  const { diagnostics } = ctx;
  const isProjection = behavior.implementationType === "projection";
  const triggers = (t: TriggerAst, what: string): TriggerModel => ({
    create: t.create,
    update: t.update,
    delete: t.delete,
    fields: t.fields.map((f) => checkField(f.text, f.loc, what)).filter((f): f is string => f !== undefined),
  });
  switch (item.kind) {
    case "operation": {
      if (isProjection) {
        diagnostics.error("BDEF012", `a projection BDEF reuses operations with use ${item.op}`, at(item.loc));
        return;
      }
      const { features: f, precheck } = features(item.options, at, ctx, item.op);
      const operation: OperationModel = { kind: item.op, internal: item.internal, precheck };
      if (f !== undefined) {
        operation.features = f;
      }
      if (item.op === "create" && !entity.root) {
        diagnostics.warning("BDEF018", `${entity.name}: child entities are created by association (association _X { create; })`, at(item.loc));
      }
      model.operations.push(operation);
      return;
    }
    case "useOperation": {
      const { features: f, precheck } = features(item.options, at, ctx, `use ${item.op}`);
      const operation: OperationModel = { kind: item.op, internal: false, precheck, use: true };
      if (f !== undefined) {
        operation.features = f;
      }
      model.operations.push(operation);
      return;
    }
    case "association": {
      const name = checkAssociation(item.name.text, item.name.loc, "association");
      if (name === undefined) {
        return;
      }
      const createFeatures = item.create === undefined ? { precheck: false } : features(item.create.options, at, ctx, `association ${name} create`);
      const association: BehaviorAssociationModel = {
        name,
        create: item.create !== undefined,
        createInternal: item.create?.internal ?? false,
        createPrecheck: createFeatures.precheck,
        internal: item.internal,
      };
      if (createFeatures.features !== undefined) {
        association.createFeatures = createFeatures.features;
      }
      const cds = findAssociation(entity, name);
      if (association.create && cds?.kind !== "composition") {
        diagnostics.error("BDEF019", `${entity.name}.${name}: only compositions can be created by association`, at(item.loc));
      }
      model.associations.push(association);
      return;
    }
    case "useAssociation": {
      const name = checkAssociation(item.name.text, item.name.loc, "use association");
      if (name !== undefined) {
        model.associations.push({ name, create: item.create, createInternal: false, createPrecheck: false, internal: false, use: true });
      }
      return;
    }
    case "field": {
      const characteristics: FieldCharacteristic[] = [];
      for (const c of item.characteristics) {
        const mapped = FIELD_CHARACTERISTICS[c.text.replace(/\s/g, "")];
        if (mapped === undefined) {
          diagnostics.warning("BDEF003", `field characteristic ${c.text} is ignored`, at(c.loc));
        } else {
          characteristics.push(mapped);
        }
      }
      for (const f of item.fields) {
        const name = checkField(f.text, f.loc, "field");
        if (name !== undefined) {
          const existing = model.fieldCharacteristics[name] ?? [];
          model.fieldCharacteristics[name] = [...new Set([...existing, ...characteristics])];
        }
      }
      return;
    }
    case "determination": {
      if (isProjection) {
        diagnostics.error("BDEF012", "determinations belong to the base BDEF", at(item.loc));
        return;
      }
      const determination: DeterminationModel = {
        name: item.name.text,
        on: item.on,
        internal: item.internal,
        triggers: triggers(item.triggers, `determination ${item.name.text}`),
        src: at(item.loc),
      };
      if (!item.triggers.create && !item.triggers.update && !item.triggers.delete && item.triggers.fields.length === 0) {
        diagnostics.warning("BDEF020", `determination ${item.name.text} has no trigger`, at(item.loc));
      }
      model.determinations.push(determination);
      return;
    }
    case "validation": {
      if (isProjection) {
        diagnostics.error("BDEF012", "validations belong to the base BDEF", at(item.loc));
        return;
      }
      const validation: ValidationModel = { name: item.name.text, triggers: triggers(item.triggers, `validation ${item.name.text}`), src: at(item.loc) };
      model.validations.push(validation);
      return;
    }
    case "action": {
      if (isProjection) {
        diagnostics.error("BDEF012", "a projection BDEF reuses actions with use action", at(item.loc));
        return;
      }
      const { features: f, precheck } = features(item.options, at, ctx, `${item.actionKind} ${item.name.text}`);
      const action: ActionModel = {
        name: item.name.text,
        kind: item.actionKind,
        static: item.static,
        factory: item.factory,
        internal: item.internal,
        precheck,
        src: at(item.loc),
      };
      if (f !== undefined) {
        action.features = f;
      }
      if (item.parameter !== undefined) {
        const parameter = item.parameter.text;
        if (parameter.toLowerCase() !== "$self" && ctx.entity(parameter) === undefined) {
          diagnostics.error("BDEF021", `${item.name.text}: unknown parameter entity ${parameter}`, at(item.parameter.loc));
        }
        action.parameter = ctx.entity(parameter)?.name ?? parameter;
      }
      if (item.result !== undefined) {
        const target = item.result.entity.text;
        if (target.toLowerCase() !== "$self" && ctx.entity(target) === undefined) {
          diagnostics.error("BDEF021", `${item.name.text}: unknown result entity ${target}`, at(item.result.entity.loc));
        }
        action.result = {
          cardinality: item.result.cardinality,
          entity: target.toLowerCase() === "$self" ? "$self" : (ctx.entity(target)?.name ?? target),
          selective: item.result.selective,
        };
      }
      if (item.factoryCardinality !== undefined) {
        action.factoryCardinality = item.factoryCardinality;
      }
      if (action.factory && action.result !== undefined) {
        diagnostics.error("BDEF022", `factory action ${action.name}: a factory action returns the created instance, it has no result`, at(item.loc));
      }
      if (item.actionKind === "function" && item.result === undefined) {
        diagnostics.error("BDEF022", `function ${action.name}: a function needs a result`, at(item.loc));
      }
      model.actions.push(action);
      return;
    }
    case "useAction": {
      if (DRAFT_ACTIONS.has(item.name.text.toLowerCase())) {
        return; // use action Edit, Activate… of a draft BO: the actions of the draft (D54)
      }
      model.actions.push({ name: item.name.text, kind: item.actionKind, static: false, factory: false, internal: false, precheck: false, use: true, src: at(item.loc) });
      if (item.alias !== undefined) {
        diagnostics.warning("BDEF003", `use ${item.actionKind} ${item.name.text} as ${item.alias.text}: the alias is ignored`, at(item.loc));
      }
      return;
    }
    case "mapping": {
      if (isProjection) {
        diagnostics.error("BDEF012", "mappings belong to the base BDEF", at(item.loc));
        return;
      }
      const fields: Record<string, string> = {};
      for (const pair of item.pairs) {
        const field = checkField(pair.field.text, pair.field.loc, "mapping");
        if (field !== undefined) {
          fields[field] = pair.column.text.toLowerCase();
        }
      }
      model.mapping = { table: item.table.text.toLowerCase(), corresponding: item.corresponding, fields };
      return;
    }
    case "sideEffects": {
      for (const sideEffect of item.items) {
        const effect: SideEffectModel = {
          trigger: { kind: sideEffect.trigger.kind === "determineAction" ? "action" : sideEffect.trigger.kind, name: sideEffect.trigger.name.text },
          targets: [],
        };
        for (const target of sideEffect.targets) {
          if (target.kind === "unknown") {
            diagnostics.warning("BDEF003", `side effect target ignored: ${target.path}`, at(sideEffect.loc));
          } else {
            effect.targets.push({ kind: target.kind, path: target.path });
          }
        }
        model.sideEffects.push(effect);
      }
      return;
    }
    case "unsupported":
      if (item.what === "draft") {
        // draft action Edit, Activate, Discard, Resume; draft determine action Prepare (D54)
        if (!/^draft\s+(determine\s+)?action\s+(Edit|Activate|Discard|Resume|Prepare|Share)\b/i.test(item.text)) {
          diagnostics.warning("BDEF003", `draft statement ignored: ${item.text}`, at(item.loc));
        } else if (/\bShare\b/i.test(item.text)) {
          model.draftShare = true;
        }
      } else {
        diagnostics.warning("BDEF003", `${item.what} is not supported yet and is ignored: ${item.text}`, at(item.loc));
      }
      return;
    case "unknown":
      diagnostics.warning("BDEF003", `unknown statement ignored: ${item.text}`, at(item.loc));
      return;
  }
}

/** BDEF mapping and CDS select list must agree on the persistent table columns. */
function checkMapping(model: EntityBehaviorModel, entity: EntityModel, at: (loc: Loc) => object, ctx: BehaviorContext): void {
  const table = model.persistentTable === undefined ? undefined : ctx.dictionary.table(model.persistentTable);
  if (table === undefined) {
    return;
  }
  const loc = model.src === undefined ? undefined : model.src;
  if (model.mapping !== undefined && model.mapping.table !== table.name) {
    ctx.diagnostics.error("BDEF008", `${entity.name}: mapping for ${model.mapping.table} does not match the persistent table ${table.name}`, loc);
  }
  for (const field of entity.fields) {
    if (field.expression !== undefined) {
      continue; // a calculated element (D67) has no column
    }
    const column = model.mapping?.fields[field.name] ?? (entity.source === table.name ? field.column : undefined) ?? (model.mapping?.corresponding ? field.name.toLowerCase() : undefined);
    if (column === undefined) {
      ctx.diagnostics.error("BDEF009", `${entity.name}.${field.name}: no column of ${table.name} is mapped to this element`, loc);
    } else if (!table.columns.some((c) => c.name === column)) {
      ctx.diagnostics.error("BDEF009", `${entity.name}.${field.name}: ${table.name} has no column ${column}`, loc);
    } else if (entity.source === table.name && field.column !== undefined && field.column !== column) {
      ctx.diagnostics.error("BDEF008", `${entity.name}.${field.name}: the BDEF maps it to ${column}, the CDS view selects ${field.column}`, loc);
    }
  }
  void at;
}
