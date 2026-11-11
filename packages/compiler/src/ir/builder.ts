/** Builds the IR (model.json) from the sources of a project. */

import {
  findEntityBehavior,
  MODEL_FORMAT_VERSION,
  same,
  sqlName,
  type BehaviorModel,
  type EntityModel,
  type Model,
  type TableModel,
} from "@rap-transpiler/model";
import { parseBdef } from "../bdef/parser.js";
import type { BdefAst } from "../bdef/ast.js";
import { readMsagXml } from "../ddic/xml.js";
import { Diagnostics } from "../diagnostics.js";
import { filesOfType, type Project, type SourceFile } from "../input/project.js";
import { COMPILER_VERSION } from "../version.js";
import { buildBehavior } from "./behaviors.js";
import { Dictionary } from "./dictionary.js";
import { EntityResolver } from "./entities.js";
import { loadAccessControls } from "./access-controls.js";
import { checkAuthorityChecks, loadAuthorizations } from "./authorizations.js";
import { loadNumberRanges, usedServices } from "./number-ranges.js";
import { abaplintRegistry, attachHandlers, syntaxCheck } from "./handlers.js";
import { selectService, type ServiceOptions } from "./service.js";

export type BuildOptions = ServiceOptions;

export interface BuildResult {
  model?: Model;
  diagnostics: Diagnostics;
}

export function buildModel(project: Project, options: BuildOptions = {}): BuildResult {
  const diagnostics = new Diagnostics();
  for (const issue of project.issues) {
    diagnostics.add(issue.severity, issue.code, issue.message, { file: issue.file, line: issue.line, column: issue.column });
  }
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
      if (association.kind === "association" && !exposed.has(association.target.toUpperCase())) {
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
    const behavior = buildBehavior(name, ast, file, { diagnostics, dictionary, entity: resolveForBehavior });
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
    service,
    tables: [...tables.values()].sort((a, b) => a.name.localeCompare(b.name)),
    entities: sortedEntities,
    behaviors: behaviors.sort((a, b) => a.name.localeCompare(b.name)),
    messageClasses,
    ...(authorizations === undefined ? {} : { authorizations }),
    ...(numberRanges === undefined ? {} : { numberRanges }),
    ...(services === undefined ? {} : { services }),
  };
  // access controls (DCL) of the exposed entities (D35)
  const accessControls = loadAccessControls(project, model, authorizations, diagnostics);
  if (accessControls.length > 0) {
    model.accessControls = accessControls;
  }
  return diagnostics.hasErrors() ? { diagnostics, model } : { diagnostics, model };
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
