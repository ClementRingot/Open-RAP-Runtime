/**
 * The access controls of the exposed entities (decision D35): the roles of the DCL sources
 * (DCLS objects of abapGit) resolved for each entity set of the service, their conditions
 * written with the elements of the exposed entity. `inheriting conditions from entity B` takes
 * the conditions of B, its elements renamed as the projection exposes them. A construct the
 * application cannot evaluate grants nothing (fail closed) and is reported.
 */

import { findEntity, projectedFieldName, same, type AccessCondition, type AccessControlModel, type AuthorizationsModel, type EntityModel, type Model } from "@rap-transpiler/model";
import { parseDcl, type DclCondition, type DclGrant } from "../dcl/parser.js";
import type { Diagnostics, Location } from "../diagnostics.js";
import { filesOfType, type Project } from "../input/project.js";

interface ParsedGrant extends DclGrant {
  role: string;
  file: string;
}

export function loadAccessControls(project: Project, model: Omit<Model, "accessControls">, authorizations: AuthorizationsModel | undefined, diagnostics: Diagnostics): AccessControlModel[] {
  const grants: ParsedGrant[] = [];
  for (const file of filesOfType(project, "DCLS").filter((f) => f.extension === "asdcls")) {
    const result = parseDcl(file.content);
    for (const error of result.errors) {
      diagnostics.error("DCL001", `access control: ${error.message}`, { file: file.path, line: error.line });
    }
    for (const grant of result.role?.grants ?? []) {
      grants.push({ ...grant, role: result.role?.name ?? file.name, file: file.path });
    }
  }
  if (grants.length === 0) {
    return [];
  }
  const objects = new Map((authorizations?.objects ?? []).map((o) => [o.name, o]));
  const result: AccessControlModel[] = [];
  for (const set of model.service.entitySets) {
    const entity = findEntity(model as Model, set.entity);
    if (entity === undefined) {
      continue;
    }
    const own = grants.filter((g) => same(g.entity, entity.name));
    for (const grant of own) {
      const at: Location = { file: grant.file, line: grant.line };
      const condition = grant.condition === undefined ? ({ kind: "true" } as AccessCondition) : resolve(grant.condition, entity, entity, grants, model as Model, objects, diagnostics, at, new Set([entity.name.toUpperCase()]));
      const existing = result.find((r) => r.role === grant.role && same(r.entity, entity.name));
      if (existing === undefined) {
        result.push({ role: grant.role, entity: entity.name, conditions: [condition] });
      } else {
        existing.conditions.push(condition);
      }
    }
  }
  return result;
}

/** A condition of a grant on `source`, written with the elements of the exposed entity `target`. */
function resolve(
  condition: DclCondition,
  source: EntityModel,
  target: EntityModel,
  grants: ParsedGrant[],
  model: Model,
  objects: Map<string, { fields: string[] }>,
  diagnostics: Diagnostics,
  at: Location,
  seen: Set<string>,
): AccessCondition {
  const element = (name: string): string | undefined => {
    const [associationName, path] = name.split(".");
    if (path !== undefined) {
      return pathElement(associationName as string, path);
    }
    const field = source.fields.find((f) => same(f.name, name));
    if (field === undefined) {
      diagnostics.warning("DCL003", `access control: ${source.name} has no element ${name}; the condition grants no row`, at);
      return undefined;
    }
    if (source === target) {
      return field.name;
    }
    const projected = projectedFieldName(model, target, field.name);
    if (projected === undefined) {
      diagnostics.warning("DCL003", `access control: ${target.name} does not expose ${source.name}.${field.name}, needed by the inherited conditions; they grant no row`, at);
    }
    return projected;
  };
  /** `_Assoc.Element`: a to-one association of the entity whose target is an entity set of the service. */
  const pathElement = (associationName: string, path: string): string | undefined => {
    const association = source.associations.find((a) => same(a.name, associationName));
    const sourceTarget = association === undefined ? undefined : findEntity(model, association.target);
    const field = sourceTarget?.fields.find((f) => same(f.name, path));
    if (association === undefined || sourceTarget === undefined || field === undefined || association.cardinality.max === "*" || association.cardinality.max > 1) {
      diagnostics.warning("DCL003", `access control: ${source.name} has no to-one association ${associationName} with an element ${path}; the condition grants no row`, at);
      return undefined;
    }
    // in the exposed entity: the association projecting this one, and the element as its target exposes it
    const exposed = source === target ? association : target.associations.find((a) => same(a.baseAssociation ?? a.name, association.name) || same(a.name, association.name));
    const exposedTarget = exposed === undefined ? undefined : findEntity(model, exposed.target);
    const exposedField = exposedTarget === undefined ? undefined : source === target ? field.name : projectedFieldName(model, exposedTarget, field.name);
    if (exposed === undefined || exposedTarget === undefined || exposedField === undefined || !model.service.entitySets.some((s) => same(s.entity, exposedTarget.name))) {
      diagnostics.warning("DCL003", `access control: ${target.name} does not expose ${associationName}.${path} through an entity set of the service; the condition grants no row`, at);
      return undefined;
    }
    return `${exposed.name}.${exposedField}`;
  };
  const no: AccessCondition = { kind: "false" };
  switch (condition.kind) {
    case "and":
    case "or":
      return { kind: condition.kind, operands: condition.operands.map((o) => resolve(o, source, target, grants, model, objects, diagnostics, at, seen)) };
    case "not":
      return { kind: "not", operand: resolve(condition.operand, source, target, grants, model, objects, diagnostics, at, seen) };
    case "compare": {
      const name = element(condition.element);
      return name === undefined ? no : { kind: "compare", element: name, operator: condition.operator, value: condition.value };
    }
    case "null": {
      const name = element(condition.element);
      return name === undefined ? no : { kind: "null", element: name, negated: condition.negated };
    }
    case "user": {
      const name = element(condition.element);
      return name === undefined ? no : { kind: "user", element: name, orInitial: condition.orInitial };
    }
    case "pfcg": {
      const names = condition.elements.map(element);
      if (names.some((n) => n === undefined)) {
        return no;
      }
      const object = objects.get(condition.object);
      if (object === undefined) {
        diagnostics.warning("DCL004", `access control: aspect pfcg_auth( ${condition.object} ): the authorization object is neither in the sources (SUSO) nor in rapt/authorizations.json; no role grants it`, at);
      } else {
        for (const field of [...condition.fields, ...Object.keys(condition.filters)]) {
          if (!object.fields.includes(field)) {
            diagnostics.error("DCL004", `access control: aspect pfcg_auth( ${condition.object} ): the object has no field ${field}`, at);
          }
        }
      }
      return { kind: "pfcg", elements: names as string[], object: condition.object, fields: condition.fields, filters: condition.filters, orInitial: condition.orInitial };
    }
    case "inherit": {
      const base = findEntity(model, condition.entity);
      if (base === undefined) {
        diagnostics.warning("DCL003", `access control: inheriting conditions from entity ${condition.entity}: unknown entity; they grant no row`, at);
        return no;
      }
      if (seen.has(base.name.toUpperCase())) {
        diagnostics.error("DCL001", `access control: the conditions of ${base.name} inherit from themselves`, at);
        return no;
      }
      const inherited = grants.filter((g) => same(g.entity, base.name));
      if (inherited.length === 0) {
        // the base entity has no role: no restriction to inherit (as in ABAP CDS)
        return { kind: "true" };
      }
      const next = new Set([...seen, base.name.toUpperCase()]);
      const operands = inherited.map((g) => (g.condition === undefined ? ({ kind: "true" } as AccessCondition) : resolve(g.condition, base, target, grants, model, objects, diagnostics, { file: g.file, line: g.line }, next)));
      return operands.length === 1 ? (operands[0] as AccessCondition) : { kind: "or", operands };
    }
    case "unsupported":
      diagnostics.warning("DCL002", `access control: ${condition.text} is not evaluated by the application; this condition grants no row`, at);
      return no;
  }
}
