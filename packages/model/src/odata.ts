/**
 * The OData V4 view of a service, derived from the IR. The compiler renders it as CSDL
 * ($metadata) and the runtime serves requests with it: both must agree, hence one derivation.
 */

import { edmTypeOf, type EdmType } from "./abap-types.js";
import { getBoolean } from "./annotations.js";
import { baseEntityOf, entitySetOfEntity, findEntity, findEntityBehavior, same } from "./lookup.js";
import type { ActionModel, EntityBehaviorModel, EntityModel, FieldCharacteristic, FieldModel, Model } from "./model.js";

export const SCHEMA_ALIAS = "SAP__self";
export const CONTAINER_NAME = "Container";

export interface ODataProperty {
  name: string;
  /** The CDS element behind the property. */
  field: string;
  edm: EdmType;
  nullable: boolean;
  key: boolean;
  /** Static field control: readonly or managed numbering (Core.Computed). */
  computed: boolean;
  /** readonly : update (Core.Immutable). */
  immutable: boolean;
  /** mandatory or mandatory : create. */
  mandatory: boolean;
  /** features : instance (Common.FieldControl through __FieldControl). */
  dynamic: boolean;
}

export interface ODataNavigation {
  name: string;
  /** Entity type of the target, unqualified. */
  targetType: string;
  targetSet: string;
  targetEntity: string;
  kind: "composition" | "toParent" | "association";
  collection: boolean;
  nullable: boolean;
  partner?: string;
  /** Referential constraints (to-one side): property of this type → property of the target. */
  constraints: Array<{ property: string; referencedProperty: string }>;
  /** Join pairs: field of this entity → field of the target. */
  on: Array<{ source: string; target: string }>;
  /** Compositions: the parent may create children through this navigation. */
  insertable: boolean;
  /** Create by association under instance feature control (__OperationControl/<nav>). */
  insertableDynamic: boolean;
}

export interface ODataEntityType {
  name: string;
  /** Exposed CDS entity (projection or view entity). */
  entity: string;
  /** Base view entity carrying the behavior. */
  baseEntity: string;
  keys: string[];
  properties: ODataProperty[];
  navigations: ODataNavigation[];
  /** Property holding the ETag (etag master). */
  etag?: string;
  /** Feature control of update/delete (instance or global): __EntityControl. */
  entityControl?: { updatable: boolean; deletable: boolean };
  /** Actions and create-by-association navigations under instance feature control. */
  operationControl: string[];
  /** Fields under instance feature control. */
  fieldControl: string[];
}

export interface ODataEntitySet {
  name: string;
  entityType: string;
  entity: string;
  insertable: boolean;
  updatable: boolean;
  deletable: boolean;
  searchable: boolean;
  /** Search fields (@Search.defaultSearchElement). */
  searchFields: string[];
}

export interface ODataParameter {
  name: string;
  edm: EdmType;
  nullable: boolean;
}

export interface ODataOperation {
  name: string;
  kind: "action" | "function";
  /** Entity type the operation is bound to. */
  boundType: string;
  /** Static operations are bound to the collection. */
  collectionBound: boolean;
  parameters: ODataParameter[];
  returnType?: { type: string; entityType: boolean; collection: boolean; nullable: boolean };
  /** Base entity and action of the behavior. */
  behaviorEntity: string;
  action: string;
  factory: boolean;
  /** features : instance or global (instance actions) → Core.OperationAvailable through __OperationControl. */
  dynamic: boolean;
}

export interface ODataComplexType {
  name: string;
  properties: ODataParameter[];
}

export interface ODataService {
  namespace: string;
  alias: typeof SCHEMA_ALIAS;
  container: typeof CONTAINER_NAME;
  entityTypes: ODataEntityType[];
  entitySets: ODataEntitySet[];
  operations: ODataOperation[];
  complexTypes: ODataComplexType[];
}

const NULLABLE_TYPES = new Set(["Edm.Date", "Edm.TimeOfDay", "Edm.DateTimeOffset", "Edm.Guid", "Edm.Binary"]);

export function isNullableType(edm: EdmType): boolean {
  return NULLABLE_TYPES.has(edm.type);
}

/** Behavior of an exposed entity: its projection BDEF (if any) and the managed base. */
export interface ExposedBehavior {
  projection?: EntityBehaviorModel;
  base?: EntityBehaviorModel;
  baseEntity: EntityModel;
}

export function exposedBehavior(model: Model, entity: EntityModel): ExposedBehavior {
  const own = findEntityBehavior(model, entity.name);
  const baseEntity = baseEntityOf(model, entity);
  const base = findEntityBehavior(model, baseEntity.name);
  const result: ExposedBehavior = { baseEntity };
  if (own?.behavior.implementationType === "projection") {
    result.projection = own.entity;
  }
  if (base?.behavior.implementationType === "managed") {
    result.base = base.entity;
  }
  return result;
}

/** Field characteristics of a field, from the base BDEF and the projection BDEF. */
export function characteristicsOf(model: Model, entity: EntityModel, field: FieldModel): FieldCharacteristic[] {
  const behavior = exposedBehavior(model, entity);
  const baseField = baseFieldName(model, entity, field);
  const fromBase = behavior.base === undefined || baseField === undefined ? [] : (behavior.base.fieldCharacteristics[baseField] ?? []);
  const fromProjection = behavior.projection?.fieldCharacteristics[field.name] ?? [];
  return [...new Set([...fromBase, ...fromProjection])];
}

function baseFieldName(model: Model, entity: EntityModel, field: FieldModel): string | undefined {
  let currentEntity: EntityModel | undefined = entity;
  let current: string | undefined = field.name;
  while (currentEntity !== undefined && currentEntity.kind === "projection" && current !== undefined) {
    const f: FieldModel | undefined = currentEntity.fields.find((x) => same(x.name, current as string));
    current = f?.baseField ?? f?.name;
    currentEntity = currentEntity.source === undefined ? undefined : findEntity(model, currentEntity.source);
  }
  return current;
}

/** Name under which a projection exposes an element of its base entity. */
export function projectedFieldName(model: Model, entity: EntityModel, baseField: string): string | undefined {
  return entity.fields.find((f) => same(baseFieldName(model, entity, f) ?? "", baseField))?.name;
}

function publicOperation(behavior: ExposedBehavior, kind: "create" | "update" | "delete"): boolean {
  const base = behavior.base?.operations.find((o) => o.kind === kind && !o.internal);
  if (base === undefined) {
    return false;
  }
  return behavior.projection === undefined ? true : behavior.projection.operations.some((o) => o.kind === kind);
}

function exposedActions(behavior: ExposedBehavior): ActionModel[] {
  const base = behavior.base?.actions.filter((a) => !a.internal) ?? [];
  if (behavior.projection === undefined) {
    return base;
  }
  return base.filter((a) => behavior.projection?.actions.some((p) => same(p.name, a.name)));
}

export function buildODataService(model: Model): ODataService {
  const service: ODataService = {
    namespace: model.service.namespace,
    alias: SCHEMA_ALIAS,
    container: CONTAINER_NAME,
    entityTypes: [],
    entitySets: [],
    operations: [],
    complexTypes: [],
  };
  const typeOfSet = (setName: string): string => `${setName}Type`;
  const complexTypes = new Map<string, EntityModel>();

  for (const set of model.service.entitySets) {
    const entity = findEntity(model, set.entity);
    if (entity === undefined) {
      continue;
    }
    const behavior = exposedBehavior(model, entity);
    const typeName = typeOfSet(set.name);
    const properties: ODataProperty[] = [];
    for (const field of entity.fields) {
      const characteristics = characteristicsOf(model, entity, field);
      if (characteristics.includes("suppress")) {
        continue;
      }
      const edm = edmTypeOf(field.type);
      properties.push({
        name: field.name,
        field: field.name,
        edm,
        nullable: field.key ? false : isNullableType(edm),
        key: field.key,
        computed: characteristics.includes("readonly") || characteristics.includes("numberingManaged"),
        immutable: characteristics.includes("readonlyUpdate"),
        mandatory: characteristics.includes("mandatory") || characteristics.includes("mandatoryCreate"),
        dynamic: characteristics.includes("featuresInstance"),
      });
    }
    const entityType: ODataEntityType = {
      name: typeName,
      entity: entity.name,
      baseEntity: behavior.baseEntity.name,
      keys: entity.fields.filter((f) => f.key).map((f) => f.name),
      properties,
      navigations: [],
      operationControl: [],
      fieldControl: properties.filter((p) => p.dynamic).map((p) => p.name),
    };
    const etag = behavior.base?.etag;
    const etagAllowed = behavior.projection === undefined || behavior.projection.useEtag;
    if (etag?.kind === "master" && etagAllowed) {
      const projected = projectedFieldName(model, entity, etag.field);
      if (projected !== undefined) {
        entityType.etag = projected;
      }
    }
    // instance and global feature control are both consumer hints of the instances (RAP)
    const updateDynamic = behavior.base?.operations.some((o) => o.kind === "update" && o.features !== undefined) ?? false;
    const deleteDynamic = behavior.base?.operations.some((o) => o.kind === "delete" && o.features !== undefined) ?? false;
    if (updateDynamic || deleteDynamic) {
      entityType.entityControl = { updatable: updateDynamic, deletable: deleteDynamic };
    }
    for (const association of entity.associations) {
      const targetSet = entitySetOfEntity(model, association.target);
      if (targetSet === undefined) {
        continue;
      }
      const target = findEntity(model, association.target);
      const collection = association.cardinality.max === "*" || association.cardinality.max > 1;
      const partner = target?.associations.find(
        (a) =>
          same(a.target, entity.name) &&
          ((association.kind === "composition" && a.kind === "toParent") || (association.kind === "toParent" && a.kind === "composition")),
      );
      const baseName = association.baseAssociation ?? association.name;
      const baseAssociation = behavior.base?.associations.find((a) => same(a.name, baseName));
      const projectedAssociation = behavior.projection?.associations.find((a) => same(a.name, association.name));
      const insertable =
        association.kind === "composition" &&
        baseAssociation?.create === true &&
        !baseAssociation.createInternal &&
        (behavior.projection === undefined || projectedAssociation?.create === true);
      const navigation: ODataNavigation = {
        name: association.name,
        targetType: typeOfSet(targetSet.name),
        targetSet: targetSet.name,
        targetEntity: association.target,
        kind: association.kind,
        collection,
        nullable: !collection && association.cardinality.min === 0,
        constraints: association.kind === "toParent" ? association.on.map((p) => ({ property: p.source, referencedProperty: p.target })) : [],
        on: association.on,
        insertable,
        insertableDynamic: insertable && baseAssociation?.createFeatures === "instance",
      };
      if (partner !== undefined) {
        navigation.partner = partner.name;
      }
      entityType.navigations.push(navigation);
      if (navigation.insertableDynamic) {
        entityType.operationControl.push(navigation.name);
      }
    }
    for (const action of exposedActions(behavior)) {
      const operation: ODataOperation = {
        name: action.name,
        kind: action.kind,
        boundType: typeName,
        collectionBound: action.static,
        parameters: [],
        behaviorEntity: behavior.baseEntity.name,
        action: action.name,
        factory: action.factory,
        dynamic: action.features === "instance" || (action.features === "global" && !action.static),
      };
      if (action.parameter !== undefined && action.parameter.toLowerCase() !== "$self") {
        const parameterEntity = findEntity(model, action.parameter);
        for (const field of parameterEntity?.fields ?? []) {
          const edm = edmTypeOf(field.type);
          operation.parameters.push({ name: field.name, edm, nullable: isNullableType(edm) });
        }
      }
      if (action.factory) {
        operation.returnType = { type: typeName, entityType: true, collection: false, nullable: false };
      } else if (action.result !== undefined) {
        const many = action.result.cardinality.max === "*" || action.result.cardinality.max > 1;
        if (action.result.entity === "$self") {
          operation.returnType = { type: typeName, entityType: true, collection: many, nullable: !many && action.result.cardinality.min === 0 };
        } else {
          const resultSet = entitySetOfEntity(model, action.result.entity);
          const resultEntity = findEntity(model, action.result.entity);
          if (resultSet !== undefined) {
            operation.returnType = { type: typeOfSet(resultSet.name), entityType: true, collection: many, nullable: !many && action.result.cardinality.min === 0 };
          } else if (resultEntity !== undefined) {
            complexTypes.set(resultEntity.name.toUpperCase(), resultEntity);
            operation.returnType = { type: complexTypeName(resultEntity), entityType: false, collection: many, nullable: !many && action.result.cardinality.min === 0 };
          }
        }
      }
      if (operation.dynamic) {
        entityType.operationControl.push(action.name);
      }
      service.operations.push(operation);
    }
    service.entityTypes.push(entityType);
    service.entitySets.push({
      name: set.name,
      entityType: typeName,
      entity: entity.name,
      insertable: entity.root && publicOperation(behavior, "create"),
      updatable: publicOperation(behavior, "update"),
      deletable: publicOperation(behavior, "delete"),
      searchable: getBoolean(entity.annotations, "Search.searchable") === true,
      searchFields: entity.fields.filter((f) => getBoolean(f.annotations, "Search.defaultSearchElement") === true).map((f) => f.name),
    });
  }
  for (const entity of complexTypes.values()) {
    service.complexTypes.push({
      name: complexTypeName(entity),
      properties: entity.fields.map((f) => {
        const edm = edmTypeOf(f.type);
        return { name: f.name, edm, nullable: isNullableType(edm) };
      }),
    });
  }
  return service;
}

export function complexTypeName(entity: EntityModel): string {
  return `${entity.name.replace(/\//g, "")}Type`;
}

export function operationControlTypeName(entityType: ODataEntityType): string {
  return `${entityType.name.replace(/Type$/, "")}OperationControl`;
}

export function fieldControlTypeName(entityType: ODataEntityType): string {
  return `${entityType.name.replace(/Type$/, "")}FieldControl`;
}

/** Virtual properties of instance feature control. */
export const ENTITY_CONTROL = "__EntityControl";
export const OPERATION_CONTROL = "__OperationControl";
export const FIELD_CONTROL = "__FieldControl";
