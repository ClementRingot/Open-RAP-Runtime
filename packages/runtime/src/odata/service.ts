/** Runtime view of the OData service: the shared derivation of the model plus fast lookups. */

import {
  buildODataService,
  edmTypeOf,
  findEntity,
  type EdmType,
  type EntityModel,
  type FieldModel,
  type Model,
  type ODataEntitySet,
  type ODataEntityType,
  type ODataNavigation,
  type ODataOperation,
  type ODataProperty,
  type ODataService,
} from "@rap-transpiler/model";
import { literalToCanonical, type CanonicalValue } from "../values.js";
import { badRequest, notFound } from "./errors.js";
import type { Expr, KeyPredicate } from "./uri/ast.js";

export interface TypeInfo {
  type: ODataEntityType;
  set: ODataEntitySet;
  entity: EntityModel;
  /** SQL view of the exposed entity. */
  view: string;
  properties: Map<string, { property: ODataProperty; field: FieldModel }>;
  navigations: Map<string, ODataNavigation>;
}

export type Key = Record<string, CanonicalValue>;

export class ServiceRuntime {
  public readonly odata: ODataService;
  private readonly bySet = new Map<string, TypeInfo>();
  private readonly byType = new Map<string, TypeInfo>();

  public constructor(public readonly model: Model) {
    this.odata = buildODataService(model);
    for (const set of this.odata.entitySets) {
      const type = this.odata.entityTypes.find((t) => t.name === set.entityType);
      const entity = findEntity(model, set.entity);
      if (type === undefined || entity === undefined || entity.sqlView === undefined) {
        continue;
      }
      const properties = new Map<string, { property: ODataProperty; field: FieldModel }>();
      for (const property of type.properties) {
        const field = entity.fields.find((f) => f.name === property.field);
        if (field !== undefined) {
          properties.set(property.name, { property, field });
        }
      }
      const info: TypeInfo = {
        type,
        set,
        entity,
        view: entity.sqlView,
        properties,
        navigations: new Map(type.navigations.map((n) => [n.name, n])),
      };
      this.bySet.set(set.name, info);
      this.byType.set(type.name, info);
    }
  }

  public get namespace(): string {
    return this.odata.namespace;
  }

  public isEntitySet(name: string): boolean {
    return this.bySet.has(name);
  }

  public set(name: string): TypeInfo {
    const info = this.bySet.get(name);
    if (info === undefined) {
      throw notFound(`Entity set ${name}`);
    }
    return info;
  }

  public type(name: string): TypeInfo {
    const info = this.byType.get(name);
    if (info === undefined) {
      throw new Error(`unknown entity type ${name}`);
    }
    return info;
  }

  public sets(): TypeInfo[] {
    return [...this.bySet.values()];
  }

  public navigationTarget(info: TypeInfo, navigation: string): { navigation: ODataNavigation; target: TypeInfo } {
    const nav = info.navigations.get(navigation);
    if (nav === undefined) {
      throw badRequest(`${info.type.name} has no navigation property ${navigation}`);
    }
    return { navigation: nav, target: this.set(nav.targetSet) };
  }

  public operation(info: TypeInfo, name: string, collectionBound: boolean): ODataOperation {
    const operation = this.odata.operations.find((o) => o.boundType === info.type.name && o.name === name && o.collectionBound === collectionBound);
    if (operation === undefined) {
      throw badRequest(`${info.type.name}${collectionBound ? " collection" : ""} has no bound operation ${name}`);
    }
    return operation;
  }

  public property(info: TypeInfo, name: string): { property: ODataProperty; field: FieldModel } {
    const p = info.properties.get(name);
    if (p === undefined) {
      throw badRequest(`${info.type.name} has no property ${name}`, name);
    }
    return p;
  }

  public edm(info: TypeInfo, name: string): EdmType {
    return this.property(info, name).property.edm;
  }

  /** Canonical key values of a key predicate. */
  public key(info: TypeInfo, predicate: KeyPredicate): Key {
    const keys = info.type.keys;
    const key: Key = {};
    if (predicate.kind === "single") {
      if (keys.length !== 1) {
        throw badRequest(`${info.type.name} has ${keys.length} key properties: use Name=value pairs`);
      }
      const name = keys[0] as string;
      key[name] = this.literal(info, name, predicate.value);
      return key;
    }
    for (const { name, value } of predicate.values) {
      if (!keys.includes(name)) {
        throw badRequest(`${name} is not a key property of ${info.type.name}`);
      }
      key[name] = this.literal(info, name, value);
    }
    if (keys.some((k) => !(k in key))) {
      throw badRequest(`The key predicate of ${info.type.name} must give ${keys.join(", ")}`);
    }
    return key;
  }

  private literal(info: TypeInfo, name: string, value: Expr): CanonicalValue {
    if (value.kind !== "literal") {
      throw badRequest(`The key ${name} must be a literal`);
    }
    const { property, field } = this.property(info, name);
    const canonical = literalToCanonical(field.type, property.edm, value.literal, name);
    if (canonical === null) {
      throw badRequest(`The key ${name} cannot be null`);
    }
    return canonical;
  }

  /** `Travel(3f25…)` or `Travel(A='x',B=1)`: the canonical URL of an instance, relative to the service root. */
  public keyPredicate(info: TypeInfo, key: Key): string {
    const format = (name: string): string => {
      const value = key[name];
      const edm = this.edm(info, name);
      if (value === null || value === undefined) {
        return "null";
      }
      switch (edm.type) {
        case "Edm.String":
          return `'${encodeURIComponent(String(value).replace(/'/g, "''"))}'`;
        case "Edm.DateTimeOffset":
          return encodeURIComponent(String(value));
        default:
          return String(value);
      }
    };
    const keys = info.type.keys;
    return keys.length === 1 ? `(${format(keys[0] as string)})` : `(${keys.map((k) => `${k}=${format(k)}`).join(",")})`;
  }

  public edmOfField(field: FieldModel): EdmType {
    return edmTypeOf(field.type);
  }
}
