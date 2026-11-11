/** Builds the IR (model.json) from the sources of a project. */

import {
  findEntityBehavior,
  MODEL_FORMAT_VERSION,
  same,
  sqlName,
  type BehaviorModel,
  type EntityModel,
  baseEntityOf,
  findEntity,
  getAnnotation,
  getArray,
  type FieldModel,
  type Model,
  type ServiceModel,
  type UiConfigModel,
  type TableModel,
} from "@rap-transpiler/model";
import { parseBdef } from "../bdef/parser.js";
import type { BdefAst } from "../bdef/ast.js";
import { readMsagXml } from "../ddic/xml.js";
import { Diagnostics } from "../diagnostics.js";
import { filesOfType, STANDARD_FOLDER, type Project, type SourceFile } from "../input/project.js";
import { COMPILER_VERSION } from "../version.js";
import { buildBehavior } from "./behaviors.js";
import { Dictionary } from "./dictionary.js";
import { EntityResolver } from "./entities.js";
import { loadAccessControls } from "./access-controls.js";
import { checkAuthorityChecks, loadAuthorizations } from "./authorizations.js";
import { loadNumberRanges, usedServices } from "./number-ranges.js";
import { abaplintRegistry, attachHandlers, syntaxCheck } from "./handlers.js";
import { selectService, type ServiceOptions } from "./service.js";
import { loadConfig } from "./config.js";

export interface BuildOptions extends ServiceOptions {
  /** Mode of the project, overriding rapt/config.json (D45): standard or enhanced. */
  mode?: string;
}

export interface BuildResult {
  model?: Model;
  diagnostics: Diagnostics;
}

/**
 * The entities of the value helps of the exposed entities (`@Consumption.valueHelpDefinition`)
 * are exposed implicitly, read-only, as RAP does: the value help reads them from the service.
 */
function addValueHelps(service: ServiceModel, entities: EntityResolver, diagnostics: Diagnostics): void {
  const names = new Set(service.entitySets.map((s) => s.name.toUpperCase()));
  const exposedEntities = new Set(service.entitySets.map((s) => s.entity.toUpperCase()));
  for (const set of [...service.entitySets]) {
    const entity = entities.resolve(set.entity);
    for (const field of entity?.fields ?? []) {
      for (const definition of getArray(field.annotations, "Consumption.valueHelpDefinition") ?? []) {
        const target = typeof definition === "object" && definition !== null && !Array.isArray(definition) ? definition["entity"] : undefined;
        const name = typeof target === "object" && target !== null && !Array.isArray(target) ? target["name"] : undefined;
        if (typeof name !== "string" || exposedEntities.has(name.toUpperCase())) {
          continue;
        }
        const resolved = entities.resolve(name);
        if (resolved === undefined) {
          diagnostics.warning("CDS018", `${entity?.name ?? set.entity}.${field.name}: value help entity ${name} not found, the value help is omitted`, field.src);
          continue;
        }
        if (names.has(resolved.name.toUpperCase())) {
          continue;
        }
        service.entitySets.push({ name: resolved.name, entity: resolved.name, valueHelp: true });
        names.add(resolved.name.toUpperCase());
        exposedEntities.add(resolved.name.toUpperCase());
        // its text entity (`_Text` to an entity of data category #TEXT): the descriptions of the values
        for (const association of resolved.associations) {
          const text = entities.resolve(association.target);
          if (text === undefined || getAnnotation(text.annotations, "ObjectModel.dataCategory") !== "#TEXT" || names.has(text.name.toUpperCase())) {
            continue;
          }
          service.entitySets.push({ name: text.name, entity: text.name, valueHelp: true });
          names.add(text.name.toUpperCase());
          exposedEntities.add(text.name.toUpperCase());
        }
      }
    }
  }
}

/** The UI settings name entity sets of the service (D53): CFG003 otherwise. */
function checkUi(ui: UiConfigModel, service: ServiceModel, diagnostics: Diagnostics): UiConfigModel {
  const at = { file: "rapt/config.json", line: 1 };
  const sets = new Set(service.entitySets.map((s) => s.name));
  for (const set of Object.keys(ui.floorplans ?? {})) {
    if (!sets.has(set)) diagnostics.error("CFG003", `rapt/config.json: ui.floorplans: no entity set ${set} in the service`, at);
  }
  for (const card of ui.overview?.cards ?? []) {
    if (!sets.has(card.entitySet)) diagnostics.error("CFG003", `rapt/config.json: card ${card.title}: no entity set ${card.entitySet} in the service`, at);
  }
  return ui;
}

export function buildModel(project: Project, options: BuildOptions = {}): BuildResult {
  const diagnostics = new Diagnostics();
  for (const issue of project.issues) {
    diagnostics.add(issue.severity, issue.code, issue.message, { file: issue.file, line: issue.line, column: issue.column });
  }
  const config = loadConfig(project, diagnostics, options.mode);
  const dictionary = new Dictionary(project, diagnostics);
  const entities = new EntityResolver(project, dictionary, diagnostics);

  // ------------------------------------------------------------------------------- service
  const selection = selectService(project, options, diagnostics);
  if (selection === undefined) {
    return { diagnostics };
  }
  const { service } = selection;

  // ----------------------------------------------------------------- entities, from the service
  const required = new Map<string, EntityModel>();
  const queue: string[] = [];
  addValueHelps(service, entities, diagnostics);
  const exposed = new Set(service.entitySets.map((s) => s.entity.toUpperCase()));
  for (const set of service.entitySets) {
    const expose = selection.ast.exposes.find((e) => same(e.entity, set.entity));
    const entity = entities.resolve(set.entity);
    if (entity === undefined) {
      if (!entities.has(set.entity)) {
        diagnostics.error("SRVD005", `exposed entity ${set.entity} not found in the sources`, {
          file: selection.file.path,
          line: expose?.line ?? 1,
          column: expose?.column ?? 1,
        });
      }
      continue;
    }
    set.entity = entity.name;
    queue.push(entity.name);
  }
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (required.has(name.toUpperCase())) {
      continue;
    }
    const entity = entities.resolve(name);
    if (entity === undefined) {
      continue;
    }
    required.set(name.toUpperCase(), entity);
    if (entity.kind === "projection" && entity.source !== undefined) {
      queue.push(entity.source);
    }
    for (const association of entity.associations) {
      // compositions and parents belong to the BO; other associations only matter when exposed
      if (association.kind !== "association" || exposed.has(association.target.toUpperCase())) {
        queue.push(association.target);
      }
    }
  }
  for (const entity of required.values()) {
    for (const association of entity.associations) {
      if (association.kind === "association" && !exposed.has(association.target.toUpperCase()) && association.src?.file.startsWith(STANDARD_FOLDER) !== true) {
        diagnostics.info("SRVD006", `${entity.name}.${association.name}: target ${association.target} is not exposed, the navigation is omitted`, association.src);
      }
    }
  }

  // ------------------------------------------------------------------------------ behaviors
  const bdefs = new Map<string, { ast: BdefAst; file: SourceFile }>();
  for (const file of filesOfType(project, "BDEF").filter((f) => f.extension === "asbdef")) {
    const parsed = parseBdef(file.content);
    if (parsed.ast === undefined) {
      for (const e of parsed.errors) {
        diagnostics.error("BDEF001", e.message, { file: file.path, line: e.line, column: e.column });
      }
      continue;
    }
    bdefs.set(file.name, { ast: parsed.ast, file });
  }
  const behaviors: BehaviorModel[] = [];
  const extraEntities = new Map<string, EntityModel>();
  const resolveForBehavior = (name: string): EntityModel | undefined => {
    const entity = entities.resolve(name);
    if (entity !== undefined && !required.has(name.toUpperCase())) {
      extraEntities.set(name.toUpperCase(), entity);
    }
    return entity;
  };
  for (const [name, { ast, file }] of bdefs) {
    const relevant = ast.behaviors.some((b) => required.has(b.entity.text.toUpperCase()));
    if (!relevant) {
      continue;
    }
    const behavior = buildBehavior(name, ast, file, { diagnostics, dictionary, entity: resolveForBehavior, mode: config.mode });
    if (behavior !== undefined) {
      behaviors.push(behavior);
    }
  }
  // entities used as action parameters or results (abstract entities) stay in the model
  for (const [key, entity] of extraEntities) {
    if (behaviors.some((b) => b.entities.some((e) => e.actions.some((a) => same(a.parameter ?? "", entity.name) || same(a.result?.entity ?? "", entity.name))))) {
      required.set(key, entity);
    }
  }

  // the other abstract entities of the project (types of the ABAP code: an abstract entity
  // generated by a service consumption model types the data of a remote service, D31)
  for (const name of entities.abstractNames()) {
    if (required.has(name.toUpperCase())) {
      continue;
    }
    const quiet = new Diagnostics();
    const entity = entities.resolveInto(name, quiet);
    if (entity !== undefined && !quiet.hasErrors()) {
      required.set(name.toUpperCase(), entity);
    }
  }

  checkBusinessObjects([...required.values()], behaviors, diagnostics);

  // ------------------------------------------------------- authorization objects and roles (D34)
  const authorizations = loadAuthorizations(project, diagnostics);
  const numberRanges = loadNumberRanges(project, diagnostics);
  const services = usedServices(project);

  // --------------------------------------------------------------------- behavior pools (ABAP)
  const pools = behaviors.flatMap((b) => [b.implementationClass, ...b.entities.map((e) => e.implementationClass)]).filter((c): c is string => c !== undefined);
  if (pools.length > 0) {
    const registry = abaplintRegistry(project);
    syntaxCheck(project, registry, pools, diagnostics);
    for (const behavior of behaviors) {
      attachHandlers(behavior, registry, project, diagnostics, [...required.values()]);
    }
    checkAuthorityChecks(registry, project, authorizations, diagnostics);
  }
  // query classes of the custom entities (D43)
  const queryClasses = [...required.values()].filter((e) => e.kind === "custom" && e.queryClass !== undefined);
  for (const entity of queryClasses) {
    if (!project.files.some((f) => f.type === "CLAS" && f.name === entity.queryClass)) {
      diagnostics.error("CDS017", `${entity.name}: query class ${entity.queryClass ?? ""} not found in the sources`, entity.src);
    }
  }
  if (queryClasses.length > 0) {
    syntaxCheck(project, abaplintRegistry(project), queryClasses.map((e) => e.queryClass ?? ""), diagnostics);
  }

  // --------------------------------------------------------------------------- tables, texts
  const tables = new Map<string, TableModel>();
  const addTable = (name: string | undefined): void => {
    if (name === undefined || tables.has(name)) {
      return;
    }
    const table = dictionary.table(name);
    if (table !== undefined) {
      tables.set(name, table);
    }
  };
  for (const entity of required.values()) {
    if (entity.kind === "view" && entity.source !== undefined && dictionary.hasTable(entity.source)) {
      addTable(entity.source);
    }
  }
  for (const behavior of behaviors) {
    for (const entity of behavior.entities) {
      addTable(entity.persistentTable ?? entity.mapping?.table);
    }
  }
  // the table entities of the project (D55): their tables, for the ABAP SQL of the behavior pools
  for (const name of entities.tableEntityNames()) {
    if (tables.has(sqlName(name))) {
      continue;
    }
    const quiet = new Diagnostics();
    const entity = entities.resolveInto(name, quiet);
    if (entity !== undefined && !quiet.hasErrors()) {
      addTable(entity.source);
    } else {
      diagnostics.addAll(quiet);
    }
  }
  // the other transparent tables of the project, for the ABAP SQL of the behavior pools (D26):
  // one that cannot be built is left out, the BO does not need it
  for (const name of dictionary.transparentTableNames()) {
    const lower = sqlName(name);
    if (tables.has(lower)) {
      continue;
    }
    const quiet = new Diagnostics();
    const table = dictionary.table(lower, quiet);
    const problem = quiet.items.find((d) => d.severity === "error");
    if (table !== undefined && problem === undefined) {
      tables.set(lower, table);
    } else {
      diagnostics.info("DDIC005", `${name}: not created in the database (${problem?.message ?? "not readable"}); no CDS entity or BDEF uses it`, problem?.file === undefined ? undefined : { file: problem.file, line: problem.line ?? 1 });
    }
  }
  const messageClasses: Record<string, Record<string, string>> = {};
  for (const file of filesOfType(project, "MSAG").filter((f) => f.extension === "xml")) {
    const msag = readMsagXml(file.content);
    if (msag !== undefined) {
      messageClasses[msag.name.toUpperCase()] = msag.texts;
    }
  }

  const sortedEntities = [...required.values()].sort((a, b) => a.name.localeCompare(b.name));
  finalizeProjectionAssociations(sortedEntities);
  deriveCompositionConditions(sortedEntities, diagnostics);
  const model: Model = {
    formatVersion: MODEL_FORMAT_VERSION,
    generator: { name: "rap-transpiler", version: COMPILER_VERSION },
    ...(config.mode === "enhanced" ? { mode: config.mode } : {}),
    ...(config.ui === undefined ? {} : { ui: checkUi(config.ui, service, diagnostics) }),
    service,
    tables: [...tables.values()].sort((a, b) => a.name.localeCompare(b.name)),
    entities: sortedEntities,
    behaviors: behaviors.sort((a, b) => a.name.localeCompare(b.name)),
    messageClasses,
    ...(authorizations === undefined ? {} : { authorizations }),
    ...(numberRanges === undefined ? {} : { numberRanges }),
    ...(services === undefined ? {} : { services }),
  };
  const enumTypes = dictionary.cdsTypeEntries().flatMap((t) => (t.info.enum === undefined ? [] : [t.info.enum]));
  if (enumTypes.length > 0) {
    model.enumTypes = enumTypes.sort((a, b) => a.name.localeCompare(b.name));
  }
  checkExposedTypes(model, diagnostics);
  applyDraft(model, diagnostics);
  // access controls (DCL) of the exposed entities (D35)
  const accessControls = loadAccessControls(project, model, authorizations, diagnostics);
  if (accessControls.length > 0) {
    model.accessControls = accessControls;
  }
  return diagnostics.hasErrors() ? { diagnostics, model } : { diagnostics, model };
}

/**
 * CDS enumerated types in the service (D55): SAP does not expose them in RAP OData services, the
 * enhanced mode exposes them as OData enumeration types. Exposed table entities need keys.
 */
function checkExposedTypes(model: Model, diagnostics: Diagnostics): void {
  for (const set of model.service.entitySets) {
    const entity = findEntity(model, set.entity);
    if (entity === undefined) {
      continue;
    }
    if (entity.fields.every((f) => !f.key)) {
      diagnostics.error("CDS011", `${entity.name}: an exposed entity needs key elements`, entity.src);
    }
    if (model.mode === "enhanced") {
      continue;
    }
    for (const field of entity.fields.filter((f) => f.type.enumType !== undefined)) {
      diagnostics.error(
        "CDS021",
        `${entity.name}.${field.name}: SAP does not expose CDS enumerated types (${field.type.enumType ?? ""}) in RAP OData services; set "mode": "enhanced" in rapt/config.json to expose an OData enumeration type`,
        field.src,
      );
    }
  }
}

/** The entity of the administrative data of the drafts (D54), a table of the runtime. */
export const DRAFT_ADMIN_ENTITY = "DraftAdministrativeData";
export const DRAFT_ADMIN_TABLE = "rapt_draft_admin";

/**
 * Draft (D54): each exposed entity of a draft BO gets the key IsActiveEntity, HasActiveEntity,
 * HasDraftEntity and DraftUUID (to DraftAdministrativeData), its compositions join on
 * IsActiveEntity too, and it is read from a view of its active instances and its drafts.
 */
function applyDraft(model: Model, diagnostics: Diagnostics): void {
  const drafted = new Map<string, { table: string; root: boolean }>();
  for (const behavior of model.behaviors.filter((b) => b.implementationType === "managed" && b.draft === true)) {
    for (const entity of behavior.entities) {
      if (entity.draftTable === undefined) {
        diagnostics.error("BDEF028", `${entity.entity}: a draft BO needs a draft table for each entity (draft table <name>)`, entity.src);
        continue;
      }
      if (entity.persistentTable === undefined) {
        diagnostics.error("BDEF028", `${entity.entity}: draft needs a persistent table (not an unmanaged save)`, entity.src);
        continue;
      }
      drafted.set(entity.entity.toUpperCase(), { table: entity.draftTable, root: entity.root });
    }
  }
  if (drafted.size === 0) {
    return;
  }
  const exposed = model.service.entitySets.map((set) => findEntity(model, set.entity)).filter((e): e is EntityModel => e !== undefined);
  const isDrafted = (entity: EntityModel): boolean => drafted.has(baseEntityOf(model, entity).name.toUpperCase());
  const bool: FieldModel["type"] = { kind: "bool" };
  for (const entity of exposed.filter(isDrafted)) {
    const base = baseEntityOf(model, entity);
    const info = drafted.get(base.name.toUpperCase()) as { table: string; root: boolean };
    const hidden = { ui: { hidden: true } };
    entity.fields.push(
      { name: "IsActiveEntity", type: bool, key: true, annotations: { endusertext: { label: "Is Active" }, ...hidden }, draft: true },
      { name: "HasActiveEntity", type: bool, key: false, annotations: { endusertext: { label: "Has Active" }, ...hidden }, draft: true },
      { name: "HasDraftEntity", type: bool, key: false, annotations: { endusertext: { label: "Has Draft" }, ...hidden }, draft: true },
      { name: "DraftUUID", type: { kind: "raw", length: 16 }, key: false, annotations: { endusertext: { label: "Draft" }, ...hidden }, draft: true },
    );
    for (const association of entity.associations) {
      const target = exposed.find((e) => same(e.name, association.target));
      if ((association.kind === "composition" || association.kind === "toParent") && target !== undefined && isDrafted(target)) {
        association.on.push({ source: "IsActiveEntity", target: "IsActiveEntity" });
      }
    }
    entity.associations.push({ name: DRAFT_ADMIN_ENTITY, target: DRAFT_ADMIN_ENTITY, kind: "association", cardinality: { min: 0, max: 1 }, on: [{ source: "DraftUUID", target: "DraftUUID" }] });
    entity.draft = { view: `${entity.sqlView ?? sqlName(entity.name)}_all`.slice(0, 63), table: info.table, base: base.name, root: info.root };
  }
  const text = (length: number): FieldModel["type"] => ({ kind: "char", length });
  const stamp: FieldModel["type"] = { kind: "timestampl" };
  const label = (l: string): FieldModel["annotations"] => ({ endusertext: { label: l } });
  model.entities.push({
    name: DRAFT_ADMIN_ENTITY,
    kind: "view",
    root: false,
    sqlView: DRAFT_ADMIN_TABLE,
    fields: [
      { name: "DraftUUID", type: { kind: "raw", length: 16 }, key: true, annotations: label("Draft") },
      { name: "CreationDateTime", type: stamp, key: false, annotations: label("Draft Created On") },
      { name: "CreatedByUser", type: text(12), key: false, annotations: label("Draft Created By") },
      { name: "LastChangeDateTime", type: stamp, key: false, annotations: label("Draft Last Changed On") },
      { name: "LastChangedByUser", type: text(12), key: false, annotations: label("Draft Last Changed By") },
      { name: "InProcessByUser", type: text(12), key: false, annotations: label("Draft In Process By") },
    ],
    associations: [],
    annotations: label("Draft Administrative Data"),
    draft: { admin: true },
  });
  model.service.entitySets.push({ name: DRAFT_ADMIN_ENTITY, entity: DRAFT_ADMIN_ENTITY, draftAdministrativeData: true });
}

/** The ON pairs of projection associations name the target fields as the target projection does. */
function finalizeProjectionAssociations(entities: EntityModel[]): void {
  for (const entity of entities.filter((e) => e.kind === "projection")) {
    for (const association of entity.associations) {
      const target = entities.find((e) => same(e.name, association.target));
      if (target === undefined) {
        continue;
      }
      for (const pair of association.on) {
        const field = target.fields.find((f) => same(f.baseField ?? f.name, pair.target) || same(f.name, pair.target));
        if (field !== undefined) {
          pair.target = field.name;
        }
      }
    }
  }
}

/**
 * A CDS composition has no ON condition: it is the inverse of the to-parent association of the
 * child (`association to parent X as _P on $projection.ParentKey = _P.Key`).
 */
function deriveCompositionConditions(entities: EntityModel[], diagnostics: Diagnostics): void {
  for (const entity of entities) {
    for (const composition of entity.associations.filter((a) => a.kind === "composition" && a.on.length === 0)) {
      const child = entities.find((e) => same(e.name, composition.target));
      const toParent = child?.associations.find((a) => a.kind === "toParent" && same(a.target, entity.name));
      if (toParent === undefined) {
        diagnostics.error("CDS015", `${entity.name}.${composition.name}: ${composition.target} has no association to parent ${entity.name}`, composition.src);
        continue;
      }
      composition.on = toParent.on.map((pair) => ({ source: pair.target, target: pair.source }));
    }
  }
}

/** Cross-object checks: composition trees, projections against their base behavior. */
function checkBusinessObjects(entities: EntityModel[], behaviors: BehaviorModel[], diagnostics: Diagnostics): void {
  const model = { behaviors };
  for (const behavior of behaviors.filter((b) => b.implementationType === "managed")) {
    for (const entityBehavior of behavior.entities) {
      const entity = entities.find((e) => same(e.name, entityBehavior.entity));
      if (entity === undefined) {
        continue;
      }
      for (const composition of entity.associations.filter((a) => a.kind === "composition")) {
        if (!behavior.entities.some((e) => same(e.entity, composition.target))) {
          diagnostics.error("BDEF024", `${entity.name}.${composition.name}: the composition child ${composition.target} has no behavior in ${behavior.name}`, entityBehavior.src);
        }
      }
      if (!entity.root && !entity.associations.some((a) => a.kind === "toParent")) {
        diagnostics.error("BDEF025", `${entity.name}: a child entity needs an association to parent`, entityBehavior.src);
      }
    }
  }
  for (const behavior of behaviors.filter((b) => b.implementationType === "projection")) {
    for (const projected of behavior.entities) {
      const entity = entities.find((e) => same(e.name, projected.entity));
      if (entity === undefined || entity.kind !== "projection" || entity.source === undefined) {
        diagnostics.error("BDEF026", `${projected.entity}: a projection BDEF must be defined on a projection view`, projected.src);
        continue;
      }
      const base = findEntityBehavior(model, entity.source);
      if (base === undefined || base.behavior.implementationType !== "managed") {
        diagnostics.error("BDEF026", `${projected.entity}: the projected entity ${entity.source} has no managed behavior`, projected.src);
        continue;
      }
      for (const operation of projected.operations) {
        const baseOperation = base.entity.operations.find((o) => o.kind === operation.kind);
        if (baseOperation === undefined || baseOperation.internal) {
          diagnostics.error("BDEF023", `${projected.entity}: use ${operation.kind}, but ${base.entity.entity} has no public ${operation.kind}`, projected.src);
        }
      }
      for (const action of projected.actions) {
        const baseAction = base.entity.actions.find((a) => same(a.name, action.name));
        if (baseAction === undefined || baseAction.internal) {
          diagnostics.error("BDEF023", `${projected.entity}: use ${action.kind} ${action.name}, but ${base.entity.entity} has no public ${action.kind} ${action.name}`, action.src);
        }
      }
      for (const association of projected.associations) {
        const projectedAssociation = entity.associations.find((a) => same(a.name, association.name));
        const baseName = projectedAssociation?.baseAssociation ?? association.name;
        const baseAssociation = base.entity.associations.find((a) => same(a.name, baseName));
        if (association.create && (baseAssociation === undefined || !baseAssociation.create || baseAssociation.createInternal)) {
          diagnostics.error("BDEF023", `${projected.entity}: use association ${association.name} { create; }, but the base does not allow it`, projected.src);
        }
      }
    }
  }
}
