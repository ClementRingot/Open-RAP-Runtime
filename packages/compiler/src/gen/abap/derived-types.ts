/**
 * BDEF derived types (decision D2): for each managed BDEF, an ABAP interface with the types RAP
 * derives from the behavior (`%tky`, `%control`, tables FOR CREATE/UPDATE/…, responses FAILED,
 * REPORTED, MAPPED…), written with named includes so that `%tky-TravelUUID` and `TravelUUID`
 * both work, as in ABAP.
 */

import {
  abapName,
  derivedType,
  derivedTypesInterfaceName,
  findEntity,
  same,
  type AbapType,
  type ActionModel,
  type BehaviorModel,
  type EntityBehaviorModel,
  type EntityModel,
  type FeatureControl,
  type Model,
} from "@rap-transpiler/model";

/** ABAP type of a dictionary type, with built-in types only. */
export function abapTypeText(t: AbapType): string {
  switch (t.kind) {
    case "char":
    case "cuky":
    case "unit":
    case "lang":
    case "clnt":
      return `c LENGTH ${t.length ?? 1}`;
    case "bool":
      return "c LENGTH 1";
    case "numc":
      return `n LENGTH ${t.length ?? 1}`;
    case "string":
    case "sstring":
      return "string";
    case "dec":
    case "curr":
    case "quan":
      return `p LENGTH ${Math.floor((t.length ?? 16) / 2) + 1} DECIMALS ${t.decimals ?? 0}`;
    case "timestamp":
      return "p LENGTH 8 DECIMALS 0";
    case "timestampl":
      return "p LENGTH 11 DECIMALS 7";
    case "utclong":
      return "utclong";
    case "int1":
    case "int2":
      // ABAP has no built-in names for them (the DDIC types are INT1 and INT2): i holds their values
      return "i";
    case "int4":
      return "i";
    case "int8":
      return "int8";
    case "fltp":
      return "f";
    case "decfloat16":
      return "decfloat16";
    case "decfloat34":
      return "decfloat34";
    case "dats":
      return "d";
    case "tims":
      return "t";
    case "raw":
      return `x LENGTH ${t.length ?? 1}`;
    case "rawstring":
      return "xstring";
  }
}

/** Associations of an entity whose target is in the same BDEF, numbered from 1 (`\_assoc`). */
export function bdefAssociations(model: Model, behavior: BehaviorModel, entity: EntityBehaviorModel): Array<{ name: string; target: EntityBehaviorModel; targetIndex: number; index: number }> {
  const cds = findEntity(model, entity.entity);
  const result: Array<{ name: string; target: EntityBehaviorModel; targetIndex: number; index: number }> = [];
  for (const association of cds?.associations ?? []) {
    const targetIndex = behavior.entities.findIndex((e) => same(e.entity, association.target));
    const target = behavior.entities[targetIndex];
    if (target !== undefined) {
      result.push({ name: association.name, target, targetIndex: targetIndex + 1, index: result.length + 1 });
    }
  }
  return result;
}

/** Actions and associations (`create`) of an entity under feature control of the given level. */
function featureControlled<A extends { name: string }>(entity: EntityBehaviorModel, associations: A[], level: FeatureControl): { actions: ActionModel[]; associations: A[] } {
  return {
    actions: entity.actions.filter((a) => a.features === level),
    associations: associations.filter((a) => entity.associations.some((b) => same(b.name, a.name) && b.create && b.createFeatures === level)),
  };
}

/** Ancestors of an entity, from its parent up to the root. */
export function ancestors(model: Model, behavior: BehaviorModel, entity: EntityBehaviorModel): Array<{ entity: EntityBehaviorModel; index: number }> {
  const result: Array<{ entity: EntityBehaviorModel; index: number }> = [];
  let current: EntityBehaviorModel | undefined = entity;
  const seen = new Set<string>();
  while (current !== undefined && !seen.has(current.entity.toUpperCase())) {
    seen.add(current.entity.toUpperCase());
    const cds = findEntity(model, current.entity);
    const parent = cds?.associations.find((a) => a.kind === "toParent");
    const index: number = parent === undefined ? -1 : behavior.entities.findIndex((e) => same(e.entity, parent.target));
    current = index < 0 ? undefined : behavior.entities[index];
    if (current !== undefined) {
      result.push({ entity: current, index: index + 1 });
    }
  }
  return result;
}

class Writer {
  private readonly lines: string[] = [];

  public line(text = ""): void {
    this.lines.push(text === "" ? "" : `  ${text}`);
  }

  /**
   * `TYPES: BEGIN OF name, …, END OF name[, table].` A named include ends the chained statement:
   * the components after it start a new `TYPES:` chain, as ABAP requires.
   */
  public structure(name: string, parts: Array<{ component: string; type: string } | { include: string; as?: string }>, tableName?: string): void {
    const list = parts.length === 0 ? [{ component: "dummy", type: "c LENGTH 1" }] : parts;
    let items: string[] = [`BEGIN OF ${name}`];
    const chain = (): void => {
      if (items.length > 0) {
        this.line(`TYPES: ${items.join(",\n           ")}.`);
      }
      items = [];
    };
    for (const part of list) {
      if ("include" in part) {
        chain();
        this.line(`  INCLUDE TYPE ${part.include}${part.as === undefined ? "" : ` AS ${part.as}`}.`);
      } else {
        items.push(`${part.component} TYPE ${part.type}`);
      }
    }
    items.push(`END OF ${name}`);
    if (tableName !== undefined) {
      items.push(`${tableName} TYPE STANDARD TABLE OF ${name} WITH DEFAULT KEY`);
    }
    chain();
  }

  public alias(name: string, type: string): void {
    this.line(`TYPES ${name} TYPE ${type}.`);
  }

  public table(name: string, row: string): void {
    this.line(`TYPES ${name} TYPE STANDARD TABLE OF ${row} WITH DEFAULT KEY.`);
  }

  public text(): string {
    return this.lines.join("\n");
  }
}

export interface DerivedTypes {
  interfaceName: string;
  source: string;
}

export function generateDerivedTypes(model: Model, behavior: BehaviorModel): DerivedTypes {
  const interfaceName = derivedTypesInterfaceName(behavior.name);
  const w = new Writer();
  w.line(`" Derived types of the behavior definition ${behavior.name}, generated by rap-transpiler.`);
  w.alias("flag", "x LENGTH 1");
  w.alias("cid", "c LENGTH 80");
  w.alias("pid", "x LENGTH 16");
  w.structure("ts_fail", [{ component: "cause", type: "if_abap_behv=>t_fail_cause" }]);
  w.table("tt_other", "REF TO if_abap_behv_message");

  const entities = behavior.entities.map((entity, i) => ({ entity, index: i + 1, cds: findEntity(model, entity.entity) as EntityModel }));
  for (const { entity, index: e, cds } of entities) {
    if (cds === undefined) {
      continue;
    }
    const keys = cds.fields.filter((f) => f.key);
    const data = cds.fields.filter((f) => !f.key);
    const component = (name: string, type: string) => ({ component: abapName(name), type });
    const actions = entity.actions;
    const associations = bdefAssociations(model, behavior, entity);
    const hasData = data.length > 0;
    w.line();
    w.line(`" ---- ${entity.alias} (${entity.entity}): entity ${e}`);
    w.structure(derivedType.key(e), keys.map((f) => component(f.name, abapTypeText(f.type))));
    w.structure(derivedType.pky(e), [{ component: "%pid", type: "pid" }, { include: derivedType.key(e), as: "%key" }]);
    w.structure(derivedType.tky(e), [{ include: derivedType.pky(e), as: "%pky" }]);
    if (hasData) {
      w.structure(derivedType.data(e), data.map((f) => component(f.name, abapTypeText(f.type))));
    }
    w.structure(`ts_e${e}_full`, [{ include: derivedType.key(e), as: "%key" }, ...(hasData ? [{ include: derivedType.data(e) }] : [])]);
    w.structure(derivedType.control(e), cds.fields.map((f) => component(f.name, "flag")));
    w.structure(derivedType.element(e), [...cds.fields.map((f) => component(f.name, "flag")), ...cds.associations.map((a) => component(a.name, "flag"))]);
    const featureFields = new Set(
      Object.entries(entity.fieldCharacteristics)
        .filter(([, characteristics]) => characteristics.includes("featuresInstance"))
        .map(([field]) => field.toUpperCase()),
    );
    if (actions.length > 0) {
      w.structure(`ts_e${e}_act`, actions.map((a) => component(a.name, "flag")));
    }
    if (associations.length > 0) {
      w.structure(`ts_e${e}_asc`, associations.map((a) => component(a.name, "flag")));
    }
    // feature control: only the operations, actions, associations and fields declared with features
    for (const [suffix, level] of [["ifc", "instance"], ["gfc", "global"]] as const) {
      const controlled = featureControlled(entity, associations, level);
      if (controlled.actions.length > 0) {
        w.structure(`ts_e${e}_${suffix}_act`, controlled.actions.map((a) => component(a.name, "flag")));
      }
      if (controlled.associations.length > 0) {
        w.structure(`ts_e${e}_${suffix}_asc`, controlled.associations.map((a) => component(a.name, "flag")));
      }
    }
    w.structure(derivedType.fieldControl(e), cds.fields.filter((f) => featureFields.has(f.name.toUpperCase())).map((f) => component(f.name, "flag")));
    w.structure(`ts_e${e}_tkyw`, [{ include: derivedType.tky(e), as: "%tky" }]);

    // operations
    w.structure(
      derivedType.createRow(e),
      [{ component: "%cid", type: "cid" }, { include: `ts_e${e}_full`, as: "%data" }, { component: "%control", type: derivedType.control(e) }],
      derivedType.create(e),
    );
    w.structure(
      derivedType.updateRow(e),
      [
        { component: "%cid_ref", type: "cid" },
        { include: derivedType.tky(e), as: "%tky" },
        ...(hasData ? [{ include: derivedType.data(e), as: "%data" }] : []),
        { component: "%control", type: derivedType.control(e) },
      ],
      derivedType.update(e),
    );
    w.structure(`ts_e${e}_del`, [{ component: "%cid_ref", type: "cid" }, { include: derivedType.tky(e), as: "%tky" }], derivedType.delete(e));
    // save_modified of additional and unmanaged save: TYPE TABLE FOR CHANGE
    w.structure(
      derivedType.changeRow(e),
      [{ include: derivedType.tky(e), as: "%tky" }, ...(hasData ? [{ include: derivedType.data(e), as: "%data" }] : []), { component: "%control", type: derivedType.control(e) }],
      derivedType.change(e),
    );
    w.structure(`ts_e${e}_rimp`, [{ include: derivedType.tky(e), as: "%tky" }, { component: "%control", type: derivedType.control(e) }], derivedType.readImport(e));
    w.structure(derivedType.readResultRow(e), [{ include: derivedType.tky(e), as: "%tky" }, ...(hasData ? [{ include: derivedType.data(e), as: "%data" }] : [])], derivedType.readResult(e));
    w.structure(`ts_e${e}_keys`, [{ include: derivedType.tky(e), as: "%tky" }], derivedType.keys(e));
    w.structure(`ts_e${e}_lock`, [{ include: derivedType.tky(e), as: "%tky" }], derivedType.lock(e));
  }

  // the types below refer to the types of other entities: they come after all of them
  for (const { entity, index: e, cds } of entities) {
    if (cds === undefined) {
      continue;
    }
    const actions = entity.actions;
    const associations = bdefAssociations(model, behavior, entity);
    const actionPart = actions.length > 0 ? [{ component: "%action", type: `ts_e${e}_act` }] : [];
    const assocPart = associations.length > 0 ? [{ component: "%assoc", type: `ts_e${e}_asc` }] : [];
    w.line();
    w.line(`" ---- ${entity.alias}: actions, associations, authorizations, features, responses`);

    // actions and functions
    actions.forEach((action, i) => {
      const a = i + 1;
      writeAction(w, model, behavior, e, a, action);
    });

    // associations
    for (const association of associations) {
      const b = association.index;
      const t = association.targetIndex;
      w.structure(
        `ts_e${e}_b${b}_cre`,
        [{ component: "%cid_ref", type: "cid" }, { include: derivedType.tky(e), as: "%tky" }, { component: "%target", type: derivedType.create(t) }],
        derivedType.assocCreate(e, b),
      );
      w.structure(`ts_e${e}_b${b}_rimp`, [{ include: derivedType.tky(e), as: "%tky" }, { component: "%control", type: derivedType.control(t) }], derivedType.assocReadImport(e, b));
      w.alias(derivedType.assocReadResult(e, b), derivedType.readResult(t));
      w.structure(`ts_e${e}_b${b}_link`, [{ component: "source", type: `ts_e${e}_tkyw` }, { component: "target", type: `ts_e${t}_tkyw` }], derivedType.assocLink(e, b));
    }

    // authorization and feature control
    const flags = (names: string[]) => names.map((n) => ({ component: n, type: "flag" }));
    const featureParts = (suffix: "ifc" | "gfc", level: FeatureControl, operations: Array<"create" | "update" | "delete">) => {
      const controlled = featureControlled(entity, associations, level);
      return [
        ...flags(operations.filter((kind) => entity.operations.some((o) => o.kind === kind && o.features === level)).map((kind) => `%${kind}`)),
        ...(controlled.actions.length > 0 ? [{ component: "%action", type: `ts_e${e}_${suffix}_act` }] : []),
        ...(controlled.associations.length > 0 ? [{ component: "%assoc", type: `ts_e${e}_${suffix}_asc` }] : []),
      ];
    };
    w.structure(derivedType.globalAuthRequest(e), [...flags(["%create", "%update", "%delete"]), ...actionPart, ...assocPart]);
    w.alias(derivedType.globalAuthResult(e), derivedType.globalAuthRequest(e));
    w.structure(derivedType.instanceAuthRequest(e), [...flags(["%update", "%delete"]), ...actionPart, ...assocPart]);
    w.structure(`ts_e${e}_iauth_r`, [{ include: derivedType.tky(e), as: "%tky" }, ...flags(["%update", "%delete"]), ...actionPart, ...assocPart], derivedType.instanceAuthResult(e));
    w.structure(`ts_e${e}_feat`, [...featureParts("ifc", "instance", ["update", "delete"]), { component: "%field", type: derivedType.fieldControl(e) }]);
    w.alias(derivedType.instanceFeaturesRequest(e), `ts_e${e}_feat`);
    w.structure(`ts_e${e}_ifeat_r`, [{ include: derivedType.tky(e), as: "%tky" }, { include: `ts_e${e}_feat`, as: "%features" }], derivedType.instanceFeaturesResult(e));
    w.structure(derivedType.globalFeaturesRequest(e), featureParts("gfc", "global", ["create", "update", "delete"]));
    w.alias(derivedType.globalFeaturesResult(e), derivedType.globalFeaturesRequest(e));

    // responses
    const path = ancestors(model, behavior, entity);
    if (path.length > 0) {
      w.structure(derivedType.path(e), path.map((p) => ({ component: abapName(p.entity.alias), type: `ts_e${p.index}_tkyw` })));
    }
    w.structure(
      `ts_e${e}_failr`,
      [
        { component: "%cid", type: "cid" },
        { include: derivedType.tky(e), as: "%tky" },
        { component: "%fail", type: "ts_fail" },
        ...flags(["%create", "%update", "%delete"]),
        ...actionPart,
        ...assocPart,
      ],
      derivedType.failedRows(e),
    );
    w.structure(
      `ts_e${e}_repr`,
      [
        { component: "%cid", type: "cid" },
        { include: derivedType.tky(e), as: "%tky" },
        { component: "%msg", type: "REF TO if_abap_behv_message" },
        { component: "%element", type: derivedType.element(e) },
        { component: "%state_area", type: "string" },
        { component: "%global", type: "flag" },
        ...(path.length > 0 ? [{ component: "%path", type: derivedType.path(e) }] : []),
      ],
      derivedType.reportedRows(e),
    );
    w.structure(`ts_e${e}_mapr`, [{ component: "%cid", type: "cid" }, { include: derivedType.tky(e), as: "%tky" }], derivedType.mappedRows(e));
  }

  // responses of the BO
  w.line();
  w.line(`" ---- responses of ${behavior.name}`);
  const perEntity = (rows: (e: number) => string) => entities.map(({ entity, index }) => ({ component: abapName(entity.alias), type: rows(index) }));
  w.structure(derivedType.failedEarly, perEntity(derivedType.failedRows));
  w.alias(derivedType.failedLate, derivedType.failedEarly);
  w.structure(derivedType.reportedEarly, [...perEntity(derivedType.reportedRows), { component: "%other", type: "tt_other" }]);
  w.alias(derivedType.reportedLate, derivedType.reportedEarly);
  w.structure(derivedType.mappedEarly, perEntity(derivedType.mappedRows));
  w.alias(derivedType.mappedLate, derivedType.mappedEarly);
  // the parameters of save_modified: TYPE REQUEST FOR CHANGE / FOR DELETE
  w.structure(derivedType.requestChange, perEntity(derivedType.change));
  w.structure(derivedType.requestDelete, perEntity(derivedType.delete));

  const source = `INTERFACE ${interfaceName.toLowerCase()} PUBLIC.\n${w.text()}\nENDINTERFACE.\n`;
  return { interfaceName, source };
}

function writeAction(w: Writer, model: Model, behavior: BehaviorModel, e: number, a: number, action: ActionModel): void {
  const parameterEntity = action.parameter === undefined || action.parameter === "$self" ? undefined : findEntity(model, action.parameter);
  const hasParameter = parameterEntity !== undefined && parameterEntity.fields.length > 0;
  if (hasParameter) {
    w.structure(derivedType.actionParam(e, a), parameterEntity.fields.map((f) => ({ component: abapName(f.name), type: abapTypeText(f.type) })));
  }
  const instance = !action.static;
  const head: Array<{ component: string; type: string } | { include: string; as?: string }> = instance
    ? [{ component: action.factory ? "%cid" : "%cid_ref", type: "cid" }, { include: derivedType.tky(e), as: "%tky" }]
    : [{ component: "%cid", type: "cid" }];
  w.structure(`ts_e${e}_a${a}_imp`, [...head, ...(hasParameter ? [{ component: "%param", type: derivedType.actionParam(e, a) }] : [])], derivedType.actionImport(e, a));
  let resultParam: string | undefined;
  if (action.result !== undefined) {
    if (action.result.entity === "$self") {
      resultParam = derivedType.readResultRow(e);
    } else {
      const target = behavior.entities.findIndex((x) => same(x.entity, action.result?.entity ?? ""));
      const resultEntity = findEntity(model, action.result.entity);
      if (target >= 0) {
        resultParam = derivedType.readResultRow(target + 1);
      } else if (resultEntity !== undefined && resultEntity.kind === "abstract" && resultEntity.fields.length > 0) {
        resultParam = `ts_e${e}_a${a}_rpar`;
        w.structure(resultParam, resultEntity.fields.map((f) => ({ component: abapName(f.name), type: abapTypeText(f.type) })));
      }
    }
  }
  const resultHead: Array<{ component: string; type: string } | { include: string; as?: string }> = instance
    ? [{ component: "%cid_ref", type: "cid" }, { include: derivedType.tky(e), as: "%tky" }]
    : [{ component: "%cid", type: "cid" }];
  w.structure(`ts_e${e}_a${a}_res`, [...resultHead, ...(resultParam === undefined ? [] : [{ component: "%param", type: resultParam }])], derivedType.actionResult(e, a));
}
