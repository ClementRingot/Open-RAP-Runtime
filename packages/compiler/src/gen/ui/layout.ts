/**
 * The layout of the generated UI (List Report and Object Page, decision D10), derived from the
 * UI annotations of the IR the same way as the CSDL ($metadata): line items, selection fields,
 * header info, facets, identification, field groups, actions and presentation variant.
 *
 * The layout is written as `ui/model/layout.json`; the generic controllers read it.
 */

import {
  buildODataService,
  findEntity,
  getAnnotation,
  getArray,
  isUuid,
  valueHelpOf,
  same,
  type AnnotationObject,
  type AnnotationValue,
  type EdmType,
  type EntityModel,
  type Model,
  type ODataEntityType,
  type ODataOperation,
  type ODataService,
  type ValueHelp,
} from "@rap-transpiler/model";

export type FieldKind = "text" | "digits" | "integer" | "decimal" | "amount" | "boolean" | "date" | "time" | "datetime" | "uuid";

export interface UiField {
  property: string;
  label: string;
  kind: FieldKind;
  edm: EdmType["type"];
  maxLength?: number;
  /** Currency or unit of an amount (`@Semantics.amount.currencyCode`). */
  unit?: string;
  key: boolean;
  /** Never editable (readonly, managed numbering, administrative fields). */
  computed: boolean;
  /** Editable on creation only (readonly : update, keys of external numbering). */
  immutable: boolean;
  mandatory: boolean;
  /** Under instance feature control (`__FieldControl`). */
  dynamic: boolean;
  importance?: "High" | "Medium" | "Low";
  /** Value help of the field (`@Consumption.valueHelpDefinition`, `Common.ValueList`). */
  valueHelp?: UiValueHelp;
}

/** A value help: the entity set listing the values, its element and its columns (D44). */
export type UiValueHelp = ValueHelp;

export interface UiParameter {
  name: string;
  label: string;
  kind: FieldKind;
  edm: EdmType["type"];
}

export interface UiAction {
  /** Unqualified action name. */
  name: string;
  /** Qualified name for the binding path (`namespace.action`). */
  qualified: string;
  label: string;
  /** Static (collection-bound) action. */
  static: boolean;
  factory: boolean;
  kind: "action" | "function";
  parameters: UiParameter[];
  /** Under instance feature control (`__OperationControl/<name>`). */
  dynamic: boolean;
  /** The result is an instance of the entity set (navigate to it for factory actions). */
  returnsEntity: boolean;
}

export interface UiTable {
  /** Entity set of the rows. */
  set: string;
  /** Composition navigation from the object (child tables), undefined for the list report. */
  navigation?: string;
  columns: UiField[];
  actions: UiAction[];
  insertable: boolean;
  deletable: boolean;
  orderby?: string;
  /** The rows open an object page. */
  navigable: boolean;
}

export type UiSection =
  | { id: string; label: string; kind: "form"; fields: UiField[] }
  | { id: string; label: string; kind: "table"; table: UiTable }
  | { id: string; label: string; kind: "collection"; sections: UiSection[] };

/** A chart (`@UI.chart`, D53): one dimension, measures with their aggregation (`@Aggregation.default`). */
export interface UiChart {
  qualifier?: string;
  title: string;
  type: "column" | "bar" | "line" | "pie" | "donut";
  dimension: { property: string; label: string; kind: FieldKind };
  measures: Array<{ property: string; label: string; aggregation: "sum" | "min" | "max" | "average" }>;
}

/** A selection variant (`@UI.selectionVariant`): the tabs of a worklist (D53). */
export interface UiSelectionVariant {
  key: string;
  text: string;
  /** OData $filter. */
  filter?: string;
}

/** A card of the Overview Page (D53). */
export interface UiCard {
  id: string;
  type: "list" | "table" | "chart" | "kpi";
  set: string;
  title: string;
  subtitle?: string;
  filter?: string;
  orderby?: string;
  top: number;
  /** list, table: the first columns of the line item; the title field first. */
  fields: UiField[];
  chart?: UiChart;
  kpi?: { property?: string; label: string; aggregation: "sum" | "min" | "max" | "average" | "count"; unit?: string };
  /** The list report of the set opens from the header of the card. */
  navigable: boolean;
}

export interface UiPage {
  set: string;
  /** The floorplan of the start page of a root entity set (D53). */
  floorplan: "listReport" | "worklist" | "analyticalListPage" | "formEntry";
  /** The charts of the entity (`@UI.chart`), for the Analytical List Page and the cards. */
  charts: UiChart[];
  selectionVariants: UiSelectionVariant[];
  entityType: string;
  typeName: string;
  typeNamePlural: string;
  keys: string[];
  title?: string;
  description?: string;
  /** List report of a root entity set. */
  list?: {
    table: UiTable;
    /** Filters shown by default (`@UI.selectionField`). */
    selectionFields: UiField[];
    /** Every field the user may filter by ("Adapt Filters"): the selection fields, then the columns. */
    filterFields: UiField[];
    searchable: boolean;
  };
  sections: UiSection[];
  /** Object page header actions (identification). */
  actions: UiAction[];
  updatable: boolean;
  deletable: boolean;
  insertable: boolean;
  updatableDynamic: boolean;
  deletableDynamic: boolean;
  /** Fields of the object page, by property (editability in edit mode). */
  fields: Record<string, UiField>;
}

export interface UiLayout {
  title: string;
  servicePath: string;
  namespace: string;
  /** Entity set of the start page (list report). */
  start: string;
  pages: UiPage[];
  /** An Overview Page as start page (D53). */
  overview?: { title: string; cards: UiCard[] };
}

const isObject = (v: AnnotationValue | undefined): v is AnnotationObject => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: AnnotationValue | undefined): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const num = (v: AnnotationValue | undefined): number => (typeof v === "number" ? v : Number.POSITIVE_INFINITY);

function entriesOf(entity: EntityModel, path: string): Array<{ field: string; entry: AnnotationObject }> {
  const result: Array<{ field: string; entry: AnnotationObject }> = [];
  for (const field of entity.fields) {
    for (const entry of getArray(field.annotations, path) ?? []) {
      if (isObject(entry)) {
        result.push({ field: field.name, entry });
      }
    }
  }
  return result.sort((a, b) => num(a.entry["position"]) - num(b.entry["position"]));
}

function kindOf(edm: EdmType, key: boolean, uuid: boolean, currency: boolean): FieldKind {
  if (uuid) return "uuid";
  switch (edm.type) {
    case "Edm.Boolean":
      return "boolean";
    case "Edm.Date":
      return "date";
    case "Edm.TimeOfDay":
      return "time";
    case "Edm.DateTimeOffset":
      return "datetime";
    case "Edm.Byte":
    case "Edm.Int16":
    case "Edm.Int32":
    case "Edm.Int64":
      return "integer";
    case "Edm.Decimal":
    case "Edm.Double":
      return currency ? "amount" : "decimal";
    case "Edm.String":
      return edm.digitSequence === true ? "digits" : "text";
    default:
      void key;
      return "text";
  }
}

class LayoutBuilder {
  private readonly service: ODataService;

  public constructor(private readonly model: Model) {
    this.service = buildODataService(model);
  }

  public build(): UiLayout {
    const pages = this.service.entitySets.filter((s) => s.valueHelp !== true || this.model.ui?.overview?.cards.some((c) => c.entitySet === s.name) === true).map((set) => this.page(set.name)).filter((p): p is UiPage => p !== undefined);
    const start = pages.find((p) => p.list !== undefined)?.set ?? pages[0]?.set ?? "";
    const root = pages.find((p) => p.set === start);
    const layout: UiLayout = {
      title: root?.typeNamePlural ?? this.model.service.name,
      servicePath: this.model.service.path,
      namespace: this.service.namespace,
      start,
      pages,
    };
    const overview = this.model.ui?.overview;
    if (overview !== undefined) {
      layout.title = overview.title;
      layout.overview = { title: overview.title, cards: overview.cards.map((c, i) => this.card(c, i, pages)).filter((c): c is UiCard => c !== undefined) };
    }
    return layout;
  }

  private typeOf(set: string): { type: ODataEntityType; entity: EntityModel } | undefined {
    const entitySet = this.service.entitySets.find((s) => s.name === set);
    const type = this.service.entityTypes.find((t) => t.name === entitySet?.entityType);
    const entity = entitySet === undefined ? undefined : findEntity(this.model, entitySet.entity);
    return type === undefined || entity === undefined ? undefined : { type, entity };
  }

  private field(type: ODataEntityType, entity: EntityModel, name: string, label?: string, importance?: string): UiField | undefined {
    const property = type.properties.find((p) => p.name === name);
    const field = entity.fields.find((f) => f.name === name);
    if (property === undefined || field === undefined) {
      return undefined;
    }
    const unit = field.currencyCode ?? field.unitOfMeasure;
    const result: UiField = {
      property: name,
      label: label ?? str(getAnnotation(field.annotations, "EndUserText.label")) ?? name,
      kind: kindOf(property.edm, property.key, isUuid(field.type), field.currencyCode !== undefined),
      edm: property.edm.type,
      key: property.key,
      computed: property.computed || field.semantics !== undefined,
      immutable: property.immutable || (property.key && !property.computed),
      mandatory: property.mandatory,
      dynamic: property.dynamic,
    };
    if (property.edm.maxLength !== undefined) result.maxLength = property.edm.maxLength;
    const help = valueHelpOf(this.model, field);
    if (help !== undefined) result.valueHelp = help;
    if (unit !== undefined && type.properties.some((p) => p.name === unit)) result.unit = unit;
    const level = importance?.replace(/^#/, "").toLowerCase();
    if (level === "high" || level === "medium" || level === "low") result.importance = level === "high" ? "High" : level === "medium" ? "Medium" : "Low";
    return result;
  }

  private action(type: ODataEntityType, name: string, label?: string): UiAction | undefined {
    const operation: ODataOperation | undefined = this.service.operations.find((o) => o.boundType === type.name && same(o.name, name));
    if (operation === undefined) {
      return undefined;
    }
    const parameterEntity = this.model.behaviors
      .flatMap((b) => b.entities)
      .find((e) => same(e.entity, operation.behaviorEntity))
      ?.actions.find((a) => same(a.name, operation.action))?.parameter;
    const abstract = parameterEntity === undefined ? undefined : findEntity(this.model, parameterEntity);
    return {
      name: operation.name,
      qualified: `${this.service.namespace}.${operation.name}`,
      label: label ?? operation.name,
      static: operation.collectionBound,
      factory: operation.factory,
      kind: operation.kind,
      parameters: operation.parameters.map((p) => {
        const field = abstract?.fields.find((f) => f.name === p.name);
        return {
          name: p.name,
          label: str(getAnnotation(field?.annotations, "EndUserText.label")) ?? p.name,
          kind: kindOf(p.edm, false, field !== undefined && isUuid(field.type), false),
          edm: p.edm.type,
        };
      }),
      dynamic: operation.dynamic,
      returnsEntity: operation.returnType?.entityType === true && operation.returnType.type === type.name,
    };
  }

  /** Data fields and actions of an element-level annotation (`UI.lineItem`, `UI.identification`…). */
  private dataFields(type: ODataEntityType, entity: EntityModel, path: string, qualifier?: string): { fields: UiField[]; actions: UiAction[] } {
    const fields: UiField[] = [];
    const actions: UiAction[] = [];
    for (const { field, entry } of entriesOf(entity, path)) {
      if (str(entry["qualifier"]) !== qualifier || entry["hidden"] === true) {
        continue;
      }
      const kind = str(entry["type"]) ?? "#STANDARD";
      if (kind === "#FOR_ACTION") {
        const action = this.action(type, str(entry["dataaction"]) ?? "", str(entry["label"]));
        if (action !== undefined && !actions.some((a) => a.name === action.name)) {
          actions.push(action);
        }
        continue;
      }
      if (kind !== "#STANDARD" && kind !== "#WITH_URL") {
        continue;
      }
      const uiField = this.field(type, entity, field, str(entry["label"]), str(entry["importance"]));
      if (uiField !== undefined && !fields.some((f) => f.property === uiField.property)) {
        fields.push(uiField);
      }
    }
    return { fields, actions };
  }

  private table(set: string, navigation?: string): UiTable | undefined {
    const typed = this.typeOf(set);
    if (typed === undefined) {
      return undefined;
    }
    const { type, entity } = typed;
    const { fields, actions } = this.dataFields(type, entity, "UI.lineItem");
    const columns = fields.length > 0 ? fields : type.keys.map((k) => this.field(type, entity, k)).filter((f): f is UiField => f !== undefined);
    const entitySet = this.service.entitySets.find((s) => s.name === set);
    const table: UiTable = {
      set,
      columns,
      actions,
      insertable: navigation === undefined ? entitySet?.insertable === true : false,
      deletable: entitySet?.deletable === true,
      navigable: true,
    };
    if (navigation !== undefined) {
      table.navigation = navigation;
    }
    const order = this.orderby(entity);
    if (order !== undefined) {
      table.orderby = order;
    }
    return table;
  }

  private orderby(entity: EntityModel): string | undefined {
    const variants = getArray(entity.annotations, "UI.presentationVariant") ?? [];
    const variant = variants.find(isObject);
    const sort = Array.isArray(variant?.["sortorder"]) ? (variant?.["sortorder"] as AnnotationValue[]) : [];
    const items = sort.filter(isObject).map((s) => `${str(s["by"]) ?? ""}${str(s["direction"]) === "#DESC" ? " desc" : ""}`);
    return items.length === 0 ? undefined : items.join(",");
  }

  private page(set: string): UiPage | undefined {
    const typed = this.typeOf(set);
    if (typed === undefined) {
      return undefined;
    }
    const { type, entity } = typed;
    const entitySet = this.service.entitySets.find((s) => s.name === set);
    const header = getAnnotation(entity.annotations, "UI.headerInfo");
    const value = (v: AnnotationValue | undefined): string | undefined => (isObject(v) ? str(v["value"]) : undefined);
    const typeName = isObject(header) ? (str(header["typename"]) ?? set) : set;
    const page: UiPage = {
      set,
      entityType: type.name,
      typeName,
      typeNamePlural: isObject(header) ? (str(header["typenameplural"]) ?? typeName) : typeName,
      keys: type.keys,
      sections: this.sections(type, entity),
      actions: this.dataFields(type, entity, "UI.identification").actions,
      updatable: entitySet?.updatable === true,
      deletable: entitySet?.deletable === true,
      insertable: entitySet?.insertable === true,
      updatableDynamic: type.entityControl?.updatable === true,
      deletableDynamic: type.entityControl?.deletable === true,
      fields: Object.fromEntries(type.properties.map((p) => [p.name, this.field(type, entity, p.name) as UiField])),
      floorplan: this.model.ui?.floorplans?.[set] ?? "listReport",
      charts: this.charts(type, entity),
      selectionVariants: this.selectionVariants(entity),
    };
    const title = isObject(header) ? value(header["title"]) : undefined;
    const description = isObject(header) ? value(header["description"]) : undefined;
    if (title !== undefined) page.title = title;
    if (description !== undefined) page.description = description;
    if (entity.root) {
      const table = this.table(set);
      if (table !== undefined) {
        const selectionFields = this.dataFields(type, entity, "UI.selectionField").fields;
        const filterFields = [...selectionFields];
        for (const column of table.columns) {
          if (!filterFields.some((f) => f.property === column.property)) {
            filterFields.push(column);
          }
        }
        page.list = {
          table,
          selectionFields,
          filterFields,
          searchable: entitySet?.searchable === true,
        };
      }
    }
    return page;
  }

  /** `@UI.chart`: the first dimension and the measures, aggregated as `@Aggregation.default` says (sum). */
  private charts(type: ODataEntityType, entity: EntityModel): UiChart[] {
    const result: UiChart[] = [];
    for (const raw of getArray(entity.annotations, "UI.chart") ?? []) {
      if (!isObject(raw)) continue;
      const list = (v: AnnotationValue | undefined): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => x !== undefined) : str(v) === undefined ? [] : [str(v) as string]);
      const dimension = list(raw["dimensions"])[0];
      const dimensionField = dimension === undefined ? undefined : this.field(type, entity, dimension);
      if (dimensionField === undefined) continue;
      const measures = list(raw["measures"])
        .map((m) => this.field(type, entity, m))
        .filter((f): f is UiField => f !== undefined)
        .map((f) => {
          const declared = str(getAnnotation(entity.fields.find((x) => x.name === f.property)?.annotations, "Aggregation.default"))?.replace(/^#/, "").toLowerCase();
          const aggregation = declared === "min" || declared === "max" || declared === "average" || declared === "avg" ? (declared === "avg" ? "average" : declared) : "sum";
          return { property: f.property, label: f.label, aggregation: aggregation as UiChart["measures"][number]["aggregation"] };
        });
      if (measures.length === 0) continue;
      const kind = str(raw["charttype"])?.replace(/^#/, "").toLowerCase() ?? "column";
      const chart: UiChart = {
        title: str(raw["title"]) ?? measures.map((m) => m.label).join(", "),
        type: kind === "bar" || kind === "line" || kind === "pie" || kind === "donut" ? kind : "column",
        dimension: { property: dimensionField.property, label: dimensionField.label, kind: dimensionField.kind },
        measures,
      };
      const qualifier = str(raw["qualifier"]);
      if (qualifier !== undefined) chart.qualifier = qualifier;
      result.push(chart);
    }
    return result;
  }

  /** `@UI.selectionVariant`: `filter: 'Status EQ ''O'' AND …'` becomes an OData $filter. */
  private selectionVariants(entity: EntityModel): UiSelectionVariant[] {
    return (getArray(entity.annotations, "UI.selectionVariant") ?? []).filter(isObject).map((raw, i) => {
      const key = (str(raw["qualifier"]) ?? `variant${i}`).replace(/[^A-Za-z0-9_]/g, "_");
      const variant: UiSelectionVariant = { key, text: str(raw["text"]) ?? key };
      const filter = str(raw["filter"]);
      if (filter !== undefined) {
        variant.filter = filter.replace(/\s+(EQ|NE|GT|GE|LT|LE|AND|OR)\s+/gi, (_m, op: string) => ` ${op.toLowerCase()} `);
      }
      return variant;
    });
  }

  private card(card: NonNullable<NonNullable<Model["ui"]>["overview"]>["cards"][number], index: number, pages: UiPage[]): UiCard | undefined {
    const typed = this.typeOf(card.entitySet);
    if (typed === undefined) return undefined;
    const { type, entity } = typed;
    const page = pages.find((p) => p.set === card.entitySet);
    const lineItem = this.dataFields(type, entity, "UI.lineItem").fields;
    const title = page?.title === undefined ? undefined : this.field(type, entity, page.title);
    const fields = [...(title === undefined ? [] : [title]), ...lineItem.filter((f) => f.property !== title?.property)].slice(0, card.type === "table" ? 4 : 3);
    const result: UiCard = {
      id: `card${index}`,
      type: card.type,
      set: card.entitySet,
      title: card.title,
      top: card.top ?? 5,
      fields: fields.length > 0 ? fields : type.keys.map((k) => this.field(type, entity, k)).filter((f): f is UiField => f !== undefined),
      navigable: page?.list !== undefined,
    };
    if (card.subtitle !== undefined) result.subtitle = card.subtitle;
    if (card.filter !== undefined) result.filter = card.filter;
    if (card.orderby !== undefined) result.orderby = card.orderby;
    if (card.type === "chart") {
      const charts = this.charts(type, entity);
      const chart = charts.find((c) => c.qualifier === card.chart) ?? (card.chart === undefined ? charts[0] : undefined);
      if (chart === undefined) return undefined;
      result.chart = chart;
    }
    if (card.type === "kpi") {
      const measure = card.measure === undefined ? undefined : this.field(type, entity, card.measure);
      result.kpi = {
        label: measure?.label ?? "Count",
        aggregation: card.aggregation ?? (measure === undefined ? "count" : "sum"),
        ...(measure === undefined ? {} : { property: measure.property }),
        ...(measure?.unit === undefined ? {} : { unit: measure.unit }),
      };
    }
    return result;
  }

  private sections(type: ODataEntityType, entity: EntityModel): UiSection[] {
    const all: AnnotationObject[] = [];
    for (const field of entity.fields) {
      for (const facet of getArray(field.annotations, "UI.facet") ?? []) {
        if (isObject(facet) && facet["hidden"] !== true && (str(facet["purpose"]) ?? "#STANDARD") === "#STANDARD") {
          all.push(facet);
        }
      }
    }
    const byPosition = (x: AnnotationObject, y: AnnotationObject): number => num(x["position"]) - num(y["position"]);
    const render = (facet: AnnotationObject, index: number): UiSection | undefined => {
      const kind = str(facet["type"]) ?? "#COLLECTION";
      const id = (str(facet["id"]) ?? `section${index}`).replace(/[^A-Za-z0-9_]/g, "_");
      const label = str(facet["label"]) ?? id;
      const qualifier = str(facet["targetqualifier"]);
      switch (kind) {
        case "#COLLECTION": {
          const sections = all
            .filter((f) => str(f["parentid"]) === str(facet["id"]))
            .sort(byPosition)
            .map(render)
            .filter((s): s is UiSection => s !== undefined);
          return { id, label, kind: "collection", sections };
        }
        case "#IDENTIFICATION_REFERENCE":
          return { id, label, kind: "form", fields: this.dataFields(type, entity, "UI.identification", qualifier).fields };
        case "#FIELDGROUP_REFERENCE":
          return { id, label, kind: "form", fields: this.dataFields(type, entity, "UI.fieldGroup", qualifier).fields };
        case "#LINEITEM_REFERENCE": {
          const element = str(facet["targetelement"]);
          const navigation = element === undefined ? undefined : type.navigations.find((n) => same(n.name, element));
          if (navigation === undefined) {
            return undefined;
          }
          const table = this.table(navigation.targetSet, navigation.name);
          if (table === undefined) {
            return undefined;
          }
          table.insertable = navigation.insertable;
          return { id, label, kind: "table", table };
        }
        default:
          return undefined;
      }
    };
    const top = all
      .filter((f) => str(f["parentid"]) === undefined)
      .sort(byPosition)
      .map(render)
      .filter((s): s is UiSection => s !== undefined);
    if (top.length > 0) {
      return top;
    }
    // no facets: one form with every property that is not hidden
    const fields = type.properties
      .filter((p) => getAnnotation(entity.fields.find((f) => f.name === p.name)?.annotations, "UI.hidden") !== true)
      .map((p) => this.field(type, entity, p.name))
      .filter((f): f is UiField => f !== undefined);
    return [{ id: "General", label: "General Information", kind: "form", fields }];
  }
}

export function buildUiLayout(model: Model): UiLayout {
  return new LayoutBuilder(model).build();
}
