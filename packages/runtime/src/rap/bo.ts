/**
 * The business objects of the model as the managed runtime sees them: for each entity of a
 * managed BDEF, its persistent table, keys, parent, lock and authorization masters, ETag and
 * administrative fields.
 */

import {
  derivedTypesInterfaceName,
  findEntity,
  findTable,
  same,
  savingOf,
  type AdminSemantics,
  type AssociationModel,
  type BehaviorModel,
  type EntityBehaviorModel,
  type EntityModel,
  type FieldCharacteristic,
  type FieldModel,
  type Model,
  type TableModel,
} from "@rap-transpiler/model";
import type { Row } from "./types.js";

export interface BoAssociation {
  name: string;
  /** 1-based index among the associations of the source entity that stay in the BDEF (`bN`). */
  index: number;
  kind: AssociationModel["kind"];
  target: BoEntity;
  /** Source field → target field. */
  on: Array<{ source: string; target: string }>;
  collection: boolean;
  behavior?: EntityBehaviorModel["associations"][number];
}

export interface BoEntity {
  bdef: BehaviorModel;
  behavior: EntityBehaviorModel;
  entity: EntityModel;
  /** 1-based index in the BDEF (the `eN` of the derived types). */
  index: number;
  /** Name of the derived types interface (upper case, the key of abap.Classes). */
  iface: string;
  /** Where the instances are read and locked: the persistent table, or the CDS view (unmanaged save). */
  table: TableModel;
  /** CDS field → column of `table` (lower case for a table). */
  columns: Map<string, string>;
  /** Who writes the instances: the runtime, the runtime and save_modified, save_modified alone. */
  saving: "managed" | "additional" | "unmanaged";
  /** The table of `mapping for` (or the persistent table), for INSERT … MAPPING FROM ENTITY. */
  mapped?: { table: TableModel; columns: Map<string, string> };
  keys: FieldModel[];
  fields: FieldModel[];
  associations: BoAssociation[];
  /** The to-parent association, for child entities. */
  parent?: BoAssociation;
  compositions: BoAssociation[];
  admin: Partial<Record<AdminSemantics, string>>;
  /** Own ETag field (`etag master F`). */
  etagField?: string;
}

export class BoModel {
  public readonly entities: BoEntity[] = [];
  private readonly byName = new Map<string, BoEntity>();

  public constructor(public readonly model: Model) {
    for (const bdef of model.behaviors.filter((b) => b.implementationType === "managed")) {
      bdef.entities.forEach((behavior, i) => {
        const entity = findEntity(model, behavior.entity);
        const saving = savingOf(bdef, behavior);
        const persistent = behavior.persistentTable === undefined ? undefined : findTable(model, behavior.persistentTable);
        const mappingTable = persistent ?? (behavior.mapping === undefined ? undefined : findTable(model, behavior.mapping.table));
        if (entity === undefined) {
          return;
        }
        const columnsOf = (table: TableModel): Map<string, string> => {
          const columns = new Map<string, string>();
          for (const field of entity.fields) {
            const mapped = Object.entries(behavior.mapping?.fields ?? {}).find(([f]) => same(f, field.name))?.[1];
            const column = (mapped ?? field.column ?? field.name).toLowerCase();
            if (table.columns.some((c) => c.name === column)) {
              columns.set(field.name, column);
            }
          }
          return columns;
        };
        let table: TableModel;
        let columns: Map<string, string>;
        if (persistent !== undefined && saving !== "unmanaged") {
          table = persistent;
          columns = columnsOf(persistent);
        } else if (saving === "unmanaged" && (entity.sqlView !== undefined || entity.kind === "custom")) {
          // no persistent table: the instances are read through the CDS view, or the query class of a custom entity (D43)
          table = { name: entity.sqlView ?? "", columns: entity.fields.map((f) => ({ name: f.name, type: f.type, key: f.key, notNull: false, client: false })) };
          columns = new Map(entity.fields.map((f) => [f.name, f.name]));
        } else {
          return;
        }
        const admin: Partial<Record<AdminSemantics, string>> = {};
        for (const field of entity.fields) {
          if (field.semantics !== undefined) {
            admin[field.semantics] = field.name;
          }
        }
        const bo: BoEntity = {
          bdef,
          behavior,
          entity,
          index: i + 1,
          iface: derivedTypesInterfaceName(bdef.name),
          table,
          columns,
          saving,
          ...(mappingTable === undefined ? {} : { mapped: { table: mappingTable, columns: columnsOf(mappingTable) } }),
          keys: entity.fields.filter((f) => f.key),
          fields: entity.fields,
          associations: [],
          compositions: [],
          admin,
          ...(behavior.etag?.kind === "master" ? { etagField: fieldName(entity, behavior.etag.field) } : {}),
        };
        this.entities.push(bo);
        this.byName.set(entity.name.toUpperCase(), bo);
      });
    }
    for (const bo of this.entities) {
      for (const association of bo.entity.associations) {
        const target = this.find(association.target);
        if (target === undefined || target.bdef !== bo.bdef) {
          continue;
        }
        const resolved: BoAssociation = {
          name: association.name,
          index: bo.associations.length + 1,
          kind: association.kind,
          target,
          on: association.on,
          collection: association.cardinality.max === "*" || association.cardinality.max > 1,
        };
        const behavior = bo.behavior.associations.find((a) => same(a.name, association.name));
        if (behavior !== undefined) {
          resolved.behavior = behavior;
        }
        bo.associations.push(resolved);
        if (association.kind === "toParent") {
          bo.parent = resolved;
        } else if (association.kind === "composition") {
          bo.compositions.push(resolved);
        }
      }
    }
  }

  public find(entity: string): BoEntity | undefined {
    return this.byName.get(entity.toUpperCase());
  }

  public get(entity: string): BoEntity {
    const found = this.find(entity);
    if (found === undefined) {
      throw new Error(`no managed behavior for ${entity}`);
    }
    return found;
  }

  /** An entity of a BDEF by alias or entity name. */
  public inBdef(bdef: string, name: string): BoEntity | undefined {
    return this.entities.find((e) => same(e.bdef.name, bdef) && (same(e.behavior.alias, name) || same(e.entity.name, name)));
  }

  public association(bo: BoEntity, name: string): BoAssociation | undefined {
    return bo.associations.find((a) => same(a.name, name.replace(/^\\/, "")));
  }

  public root(bo: BoEntity): BoEntity {
    let current = bo;
    const seen = new Set<BoEntity>();
    while (current.parent !== undefined && !seen.has(current)) {
      seen.add(current);
      current = current.parent.target;
    }
    return current;
  }

  /** The entity whose lock covers `bo` (`lock dependent by` up to a `lock master`). */
  public lockMaster(bo: BoEntity): BoEntity {
    return this.master(bo, (b) => b.behavior.lock);
  }

  /** The entity whose authorization handlers check `bo`. */
  public authorizationMaster(bo: BoEntity): BoEntity {
    return this.master(bo, (b) => b.behavior.authorization);
  }

  /** The entity whose ETag field covers `bo`. */
  public etagMaster(bo: BoEntity): BoEntity {
    return this.master(bo, (b) => b.behavior.etag);
  }

  private master(bo: BoEntity, of: (b: BoEntity) => { kind: "master" } | { kind: "dependent"; by: string } | undefined): BoEntity {
    let current = bo;
    for (let depth = 0; depth < 20; depth++) {
      const spec = of(current);
      if (spec === undefined || spec.kind === "master") {
        return current;
      }
      const association = this.association(current, spec.by);
      if (association === undefined) {
        return this.root(current);
      }
      current = association.target;
    }
    return current;
  }

  public characteristics(bo: BoEntity, field: string): FieldCharacteristic[] {
    return Object.entries(bo.behavior.fieldCharacteristics).find(([f]) => same(f, field))?.[1] ?? [];
  }

  public field(bo: BoEntity, name: string): FieldModel | undefined {
    return bo.fields.find((f) => same(f.name, name));
  }
}

function fieldName(entity: EntityModel, name: string): string {
  return entity.fields.find((f) => same(f.name, name))?.name ?? name;
}

/** Canonical key string of an instance (its key values in key order). */
/** The entity whose BDEF mapping (or persistent table) is the table `name`. */
export function entityOfTable(model: BoModel, name: string): BoEntity | undefined {
  return model.entities.find((e) => e.mapped !== undefined && same(e.mapped.table.name, name));
}

export function keyString(bo: BoEntity, row: Row): string {
  return JSON.stringify(bo.keys.map((k) => row[k.name] ?? null));
}

export function keyOf(bo: BoEntity, row: Row): Row {
  const key: Row = {};
  for (const k of bo.keys) {
    key[k.name] = row[k.name] ?? null;
  }
  return key;
}
