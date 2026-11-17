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
} from "@open-rap/model";
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
      // custom entities have no SQL view: their query class reads them (D43)
      if (type === undefined || entity === undefined || (entity.sqlView === undefined && entity.kind !== "custom")) {
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
        // draft (D54): the view of the active instances and the drafts
        view: entity.draft !== undefined && !("admin" in entity.draft) ? entity.draft.view : (entity.sqlView ?? ""),
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

  /** D107: whether a view reads, through its data sources, a parameterized view. */
  public needsParameters(info: TypeInfo): boolean {
    let entity: EntityModel | undefined = info.entity;
    for (let depth = 0; entity !== undefined && depth < 20; depth++) {
      if ((entity.parameters?.length ?? 0) > 0) return true;
      entity = entity.source === undefined ? undefined : findEntity(this.model, entity.source);
    }
    return false;
  }

  /**
   * D107: the settings of the transaction a read of a parameterized view needs: the values of its
   * parameters (from the key predicate of `View(p=…)/Set`, or the session for a system field), then
   * those the view passes to its parameterized data sources.
   */
  public parameterSettings(info: TypeInfo, predicate: KeyPredicate | undefined, session: { user: string; language: string; date: string }): Array<[string, string]> {
    const given = new Map<string, CanonicalValue>();
    const properties = info.set.parameters?.properties ?? [];
    const pairs = predicate === undefined ? [] : predicate.kind === "single" ? [{ name: properties[0]?.name ?? "", value: predicate.value }] : predicate.values;
    for (const { name, value } of pairs) {
      const property = properties.find((p) => p.name === name);
      const parameter = info.entity.parameters?.find((p) => p.name === name);
      if (property === undefined || parameter === undefined) {
        throw badRequest(`${name} is not a parameter of ${info.set.name}`);
      }
      if (value.kind !== "literal") {
        throw badRequest(`The parameter ${name} must be a literal`);
      }
      given.set(name, literalToCanonical(parameter.type, property.edm, value.literal, name));
    }
    const settings: Array<[string, string]> = [];
    const system = (field: string | undefined): CanonicalValue | undefined =>
      field === "system_date" ? session.date : field === "user" ? session.user : field === "system_language" ? session.language : field === "client" ? "100" : undefined;
    const visit = (entity: EntityModel, values: Map<string, CanonicalValue>, depth: number): void => {
      for (const parameter of entity.parameters ?? []) {
        const value = values.get(parameter.name) ?? system(parameter.systemField);
        if (value === undefined || value === null) {
          throw badRequest(`The parameter ${parameter.name} of ${entity.name} is needed: ${info.set.name}(${parameter.name}=…)/Set`);
        }
        settings.push([`rapt.p_${entity.name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}__${parameter.name.toLowerCase()}`, String(value)]);
      }
      const source = entity.source === undefined ? undefined : findEntity(this.model, entity.source);
      if (source !== undefined && depth < 20) {
        const next = new Map<string, CanonicalValue>();
        for (const { name, value } of entity.sourceParameters ?? []) {
          const v = value.kind === "literal" ? value.value : value.kind === "parameter" ? values.get(value.name) ?? system(entity.parameters?.find((p) => p.name === value.name)?.systemField) : value.kind === "session" ? system(value.variable) : undefined;
          if (v !== undefined && v !== null) next.set(name, typeof v === "number" ? v : String(v));
        }
        visit(source, next, depth + 1);
      }
    };
    visit(info.entity, given, 0);
    return settings;
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
