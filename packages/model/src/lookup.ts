/** Case-insensitive lookups over the IR. */

import type {
  AssociationModel,
  BehaviorModel,
  EntityBehaviorModel,
  EntityModel,
  EntitySetModel,
  FieldModel,
  Model,
  TableModel,
} from "./model.js";

export const same = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase();

export function findEntity(model: Pick<Model, "entities">, name: string): EntityModel | undefined {
  return model.entities.find((e) => same(e.name, name));
}

export function getEntity(model: Pick<Model, "entities">, name: string): EntityModel {
  const entity = findEntity(model, name);
  if (entity === undefined) {
    throw new Error(`Unknown entity ${name}`);
  }
  return entity;
}

export function findTable(model: Pick<Model, "tables">, name: string): TableModel | undefined {
  return model.tables.find((t) => same(t.name, name));
}

export function findField(entity: EntityModel, name: string): FieldModel | undefined {
  return entity.fields.find((f) => same(f.name, name));
}

export function findAssociation(entity: EntityModel, name: string): AssociationModel | undefined {
  return entity.associations.find((a) => same(a.name, name));
}

export function keyFields(entity: EntityModel): FieldModel[] {
  return entity.fields.filter((f) => f.key);
}

export function findEntitySet(model: Pick<Model, "service">, name: string): EntitySetModel | undefined {
  return model.service.entitySets.find((s) => s.name === name) ?? model.service.entitySets.find((s) => same(s.name, name));
}

export function entitySetOfEntity(model: Pick<Model, "service">, entity: string): EntitySetModel | undefined {
  return model.service.entitySets.find((s) => same(s.entity, entity));
}

export interface BehaviorLookup {
  behavior: BehaviorModel;
  entity: EntityBehaviorModel;
  /** 1-based position of the entity in the BDEF: the index used by the derived type names. */
  index: number;
}

/** The behavior of a CDS entity, in managed or projection BDEFs. */
export function findEntityBehavior(model: Pick<Model, "behaviors">, entityName: string): BehaviorLookup | undefined {
  for (const behavior of model.behaviors) {
    const index = behavior.entities.findIndex((e) => same(e.entity, entityName));
    if (index >= 0) {
      return { behavior, entity: behavior.entities[index] as EntityBehaviorModel, index: index + 1 };
    }
  }
  return undefined;
}

/** Resolves an alias or an entity name inside one BDEF. */
export function findEntityBehaviorInBdef(behavior: BehaviorModel, aliasOrEntity: string): BehaviorLookup | undefined {
  const index = behavior.entities.findIndex((e) => same(e.alias, aliasOrEntity) || same(e.entity, aliasOrEntity));
  if (index < 0) {
    return undefined;
  }
  return { behavior, entity: behavior.entities[index] as EntityBehaviorModel, index: index + 1 };
}

export function findBehavior(model: Pick<Model, "behaviors">, name: string): BehaviorModel | undefined {
  return model.behaviors.find((b) => same(b.name, name));
}

/** The base (projected) entity of a projection, following the chain down to a view entity. */
export function baseEntityOf(model: Pick<Model, "entities">, entity: EntityModel): EntityModel {
  let current = entity;
  const seen = new Set<string>();
  while (current.kind === "projection" && current.source !== undefined) {
    if (seen.has(current.name.toUpperCase())) {
      break;
    }
    seen.add(current.name.toUpperCase());
    const next = findEntity(model, current.source);
    if (next === undefined) {
      break;
    }
    current = next;
  }
  return current;
}

/** The field of the base view entity a projection field ends up at. */
export function baseFieldOf(model: Pick<Model, "entities">, entity: EntityModel, field: FieldModel): FieldModel | undefined {
  let currentEntity = entity;
  let currentField: FieldModel | undefined = field;
  while (currentEntity.kind === "projection" && currentEntity.source !== undefined && currentField !== undefined) {
    const next = findEntity(model, currentEntity.source);
    if (next === undefined) {
      return undefined;
    }
    currentField = findField(next, currentField.baseField ?? currentField.name);
    currentEntity = next;
  }
  return currentField;
}

/** How an entity of a managed BO is saved: by the runtime, the runtime and save_modified, save_modified alone. */
export function savingOf(behavior: Pick<BehaviorModel, "saving">, entity: Pick<EntityBehaviorModel, "saving">): "managed" | "additional" | "unmanaged" {
  return (entity.saving ?? behavior.saving)?.kind ?? "managed";
}
