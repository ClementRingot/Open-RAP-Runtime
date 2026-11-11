/**
 * $metadata (CSDL XML, OData V4) of the service, with the UI, Common, Core, Capabilities and
 * Measures annotations derived from the CDS annotations and the behavior (PLAN.md §6.5).
 */

import {
  buildODataService,
  CONTAINER_NAME,
  ENTITY_CONTROL,
  exposedBehavior,
  FIELD_CONTROL,
  fieldControlTypeName,
  findEntity,
  getAnnotation,
  valueHelpOf,
  getArray,
  OPERATION_CONTROL,
  operationControlTypeName,
  projectedFieldName,
  same,
  SCHEMA_ALIAS,
  type AnnotationObject,
  type AnnotationValue,
  type EdmType,
  type EntityModel,
  type Model,
  type ODataEntityType,
  type ODataOperation,
  type ODataService,
} from "@rap-transpiler/model";
import { el, renderXml, type XmlElement } from "./xml.js";

const VOCABULARIES = [
  { uri: "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.xml", namespace: "Org.OData.Core.V1", alias: "Core" },
  { uri: "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Capabilities.V1.xml", namespace: "Org.OData.Capabilities.V1", alias: "Capabilities" },
  { uri: "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Measures.V1.xml", namespace: "Org.OData.Measures.V1", alias: "Measures" },
  { uri: "https://sap.github.io/odata-vocabularies/vocabularies/Common.xml", namespace: "com.sap.vocabularies.Common.v1", alias: "Common" },
  { uri: "https://sap.github.io/odata-vocabularies/vocabularies/UI.xml", namespace: "com.sap.vocabularies.UI.v1", alias: "UI" },
  { uri: "https://sap.github.io/odata-vocabularies/vocabularies/Communication.xml", namespace: "com.sap.vocabularies.Communication.v1", alias: "Communication" },
];

const isObject = (v: AnnotationValue | undefined): v is AnnotationObject => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: AnnotationValue | undefined): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const num = (v: AnnotationValue | undefined): number => (typeof v === "number" ? v : Number.POSITIVE_INFINITY);

/** `#HIGH` → `High`, `#FOR_ACTION` → `ForAction`. */
function enumName(value: string | undefined): string {
  return (value ?? "")
    .replace(/^#/, "")
    .toLowerCase()
    .split("_")
    .map((p) => (p === "" ? "" : p[0]?.toUpperCase() + p.slice(1)))
    .join("");
}

function edmAttributes(edm: EdmType): Record<string, string | number | undefined> {
  if (edm.enum !== undefined) {
    // an OData enumeration type of the enhanced mode (D55)
    return { Type: `${SCHEMA_ALIAS}.${edm.enum.name}` };
  }
  const attributes: Record<string, string | number | undefined> = { Type: edm.type };
  if (edm.maxLength !== undefined) attributes["MaxLength"] = edm.maxLength;
  if (edm.precision !== undefined) attributes["Precision"] = edm.precision;
  if (edm.type === "Edm.Decimal") attributes["Scale"] = edm.scale ?? "variable";
  return attributes;
}

const annotation = (term: string, attributes: Record<string, string | number | boolean | undefined> = {}, ...children: Array<XmlElement | undefined>): XmlElement =>
  el("Annotation", { Term: term, ...attributes }, ...children);
const pv = (property: string, attributes: Record<string, string | number | boolean | undefined>, ...children: Array<XmlElement | undefined>): XmlElement =>
  el("PropertyValue", { Property: property, ...attributes }, ...children);
const record = (type: string | undefined, ...children: Array<XmlElement | undefined>): XmlElement => el("Record", type === undefined ? undefined : { Type: type }, ...children);
const collection = (...children: Array<XmlElement | undefined>): XmlElement => el("Collection", undefined, ...children);
const propertyPath = (path: string): XmlElement => el("PropertyPath", undefined, path);

interface FieldEntry {
  field: string;
  entry: AnnotationObject;
}

/** The entries of an element-level array annotation (`@UI.lineItem`) over all fields, by position. */
function entriesOf(entity: EntityModel, path: string): FieldEntry[] {
  const result: FieldEntry[] = [];
  for (const field of entity.fields) {
    for (const entry of getArray(field.annotations, path) ?? []) {
      if (isObject(entry)) {
        result.push({ field: field.name, entry });
      }
    }
  }
  return result.sort((a, b) => num(a.entry["position"]) - num(b.entry["position"]));
}

class CsdlBuilder {
  private readonly qualified: (name: string) => string;
  private readonly annotationBlocks: XmlElement[] = [];

  public constructor(
    private readonly model: Model,
    private readonly service: ODataService,
  ) {
    this.qualified = (name: string) => `${SCHEMA_ALIAS}.${name}`;
  }

  public build(): string {
    const schemaChildren: XmlElement[] = [];
    for (const type of this.service.entityTypes) {
      schemaChildren.push(this.entityType(type));
    }
    schemaChildren.push(...this.complexTypes());
    for (const operation of this.service.operations) {
      schemaChildren.push(this.operation(operation));
    }
    schemaChildren.push(this.container());
    for (const type of this.service.entityTypes) {
      const entity = findEntity(this.model, type.entity);
      if (entity !== undefined) {
        this.propertyAnnotations(type, entity);
        this.typeAnnotations(type, entity);
        this.setAnnotations(type);
      }
    }
    for (const operation of this.service.operations) {
      this.operationAnnotations(operation);
    }
    schemaChildren.push(...this.annotationBlocks);
    const edmx = el(
      "edmx:Edmx",
      { Version: "4.0", "xmlns:edmx": "http://docs.oasis-open.org/odata/ns/edmx" },
      ...VOCABULARIES.map((v) => el("edmx:Reference", { Uri: v.uri }, el("edmx:Include", { Namespace: v.namespace, Alias: v.alias }))),
      el(
        "edmx:DataServices",
        undefined,
        el("Schema", { Namespace: this.service.namespace, Alias: SCHEMA_ALIAS, xmlns: "http://docs.oasis-open.org/odata/ns/edm" }, ...schemaChildren),
      ),
    );
    return renderXml(edmx);
  }

  // -------------------------------------------------------------------------------------------
  // types

  private entityType(type: ODataEntityType): XmlElement {
    const children: XmlElement[] = [el("Key", undefined, ...type.keys.map((k) => el("PropertyRef", { Name: k })))];
    for (const property of type.properties) {
      children.push(el("Property", { Name: property.name, ...edmAttributes(property.edm), Nullable: property.nullable ? undefined : "false" }));
    }
    if (type.entityControl !== undefined) {
      children.push(el("Property", { Name: ENTITY_CONTROL, Type: this.qualified("EntityControl") }));
    }
    if (type.operationControl.length > 0) {
      children.push(el("Property", { Name: OPERATION_CONTROL, Type: this.qualified(operationControlTypeName(type)) }));
    }
    if (type.fieldControl.length > 0) {
      children.push(el("Property", { Name: FIELD_CONTROL, Type: this.qualified(fieldControlTypeName(type)) }));
    }
    for (const navigation of type.navigations) {
      const targetType = this.qualified(navigation.targetType);
      children.push(
        el(
          "NavigationProperty",
          {
            Name: navigation.name,
            Type: navigation.collection ? `Collection(${targetType})` : targetType,
            Nullable: navigation.collection || navigation.nullable ? undefined : "false",
            Partner: navigation.partner,
          },
          ...navigation.constraints.map((c) => el("ReferentialConstraint", { Property: c.property, ReferencedProperty: c.referencedProperty })),
        ),
      );
    }
    return el("EntityType", { Name: type.name }, ...children);
  }

  private complexTypes(): XmlElement[] {
    const result: XmlElement[] = [];
    if (this.service.entityTypes.some((t) => t.entityControl !== undefined)) {
      result.push(
        el(
          "ComplexType",
          { Name: "EntityControl" },
          el("Property", { Name: "Deletable", Type: "Edm.Boolean", Nullable: "false" }),
          el("Property", { Name: "Updatable", Type: "Edm.Boolean", Nullable: "false" }),
        ),
      );
    }
    for (const type of this.service.entityTypes) {
      if (type.operationControl.length > 0) {
        result.push(el("ComplexType", { Name: operationControlTypeName(type) }, ...type.operationControl.map((o) => el("Property", { Name: o, Type: "Edm.Boolean", Nullable: "false" }))));
      }
      if (type.fieldControl.length > 0) {
        result.push(el("ComplexType", { Name: fieldControlTypeName(type) }, ...type.fieldControl.map((f) => el("Property", { Name: f, Type: "Edm.Byte", Nullable: "false" }))));
      }
    }
    for (const complex of this.service.complexTypes) {
      result.push(
        el("ComplexType", { Name: complex.name }, ...complex.properties.map((p) => el("Property", { Name: p.name, ...edmAttributes(p.edm), Nullable: p.nullable ? undefined : "false" }))),
      );
    }
    for (const enumeration of this.service.enumTypes ?? []) {
      result.push(
        el(
          "EnumType",
          { Name: enumeration.name, UnderlyingType: enumeration.underlyingType === "Edm.Int32" ? undefined : enumeration.underlyingType },
          ...enumeration.members.map((m) =>
            el("Member", { Name: m.name, Value: m.value }, m.label === undefined ? undefined : annotation("Core.Description", { String: m.label })),
          ),
        ),
      );
    }
    return result;
  }

  private bindingType(operation: ODataOperation): string {
    const type = this.qualified(operation.boundType);
    return operation.collectionBound ? `Collection(${type})` : type;
  }

  private operation(operation: ODataOperation): XmlElement {
    const returnsSelf = operation.returnType?.entityType === true && operation.returnType.type === operation.boundType;
    const children: XmlElement[] = [el("Parameter", { Name: "_it", Type: this.bindingType(operation), Nullable: "false" })];
    for (const parameter of operation.parameters) {
      children.push(el("Parameter", { Name: parameter.name, ...edmAttributes(parameter.edm), Nullable: parameter.nullable ? undefined : "false" }));
    }
    if (operation.returnType !== undefined) {
      const type = this.qualified(operation.returnType.type);
      children.push(el("ReturnType", { Type: operation.returnType.collection ? `Collection(${type})` : type, Nullable: operation.returnType.nullable ? undefined : "false" }));
    }
    return el(operation.kind === "action" ? "Action" : "Function", { Name: operation.name, IsBound: "true", EntitySetPath: returnsSelf ? "_it" : undefined }, ...children);
  }

  private container(): XmlElement {
    return el(
      "EntityContainer",
      { Name: CONTAINER_NAME },
      ...this.service.entitySets.map((set) => {
        const type = this.service.entityTypes.find((t) => t.name === set.entityType);
        return el(
          "EntitySet",
          { Name: set.name, EntityType: this.qualified(set.entityType) },
          ...(type?.navigations ?? []).map((n) => el("NavigationPropertyBinding", { Path: n.name, Target: n.targetSet })),
        );
      }),
    );
  }

  // -------------------------------------------------------------------------------------------
  // annotations

  private annotations(target: string, children: Array<XmlElement | undefined>): void {
    const list = children.filter((c): c is XmlElement => c !== undefined);
    if (list.length > 0) {
      this.annotationBlocks.push(el("Annotations", { Target: target }, ...list));
    }
  }

  private propertyAnnotations(type: ODataEntityType, entity: EntityModel): void {
    for (const property of type.properties) {
      const field = entity.fields.find((f) => f.name === property.field);
      if (field === undefined) {
        continue;
      }
      const a = field.annotations;
      const children: Array<XmlElement | undefined> = [];
      const label = str(getAnnotation(a, "EndUserText.label"));
      if (label !== undefined) children.push(annotation("Common.Label", { String: label }));
      const quickInfo = str(getAnnotation(a, "EndUserText.quickInfo"));
      if (quickInfo !== undefined) children.push(annotation("Common.QuickInfo", { String: quickInfo }));
      if (property.computed) children.push(annotation("Core.Computed"));
      // D57: multi-line texts, e-mail addresses and phone numbers, default filter values
      if (getAnnotation(a, "UI.multiLineText") === true) children.push(annotation("UI.MultiLineText"));
      if (getAnnotation(a, "Semantics.email.address") === true) children.push(annotation("Communication.IsEmailAddress"));
      if (getAnnotation(a, "Semantics.telephone.type") !== undefined) children.push(annotation("Communication.IsPhoneNumber"));
      const filterDefault = getAnnotation(a, "Consumption.filter.defaultValue");
      if (typeof filterDefault === "string" || typeof filterDefault === "number") children.push(annotation("Common.FilterDefaultValue", { String: String(filterDefault) }));
      if (property.immutable) children.push(annotation("Core.Immutable"));
      if (property.dynamic) {
        children.push(annotation("Common.FieldControl", { Path: `${FIELD_CONTROL}/${property.name}` }));
      } else if (property.mandatory) {
        children.push(annotation("Common.FieldControl", { EnumMember: "Common.FieldControlType/Mandatory" }));
      }
      if (property.edm.digitSequence === true && property.edm.enum === undefined) children.push(annotation("Common.IsDigitSequence"));
      if (field.type.kind === "cuky") children.push(annotation("Common.IsCurrency"));
      if (field.type.kind === "unit") children.push(annotation("Common.IsUnit"));
      if (field.currencyCode !== undefined) children.push(annotation("Measures.ISOCurrency", { Path: field.currencyCode }));
      if (field.unitOfMeasure !== undefined) children.push(annotation("Measures.Unit", { Path: field.unitOfMeasure }));
      if (getAnnotation(a, "UI.hidden") === true) children.push(annotation("UI.Hidden"));
      const help = valueHelpOf(this.model, field);
      if (help !== undefined) {
        children.push(
          annotation(
            "Common.ValueList",
            {},
            record(
              "Common.ValueListType",
              pv("Label", { String: help.label }),
              pv("CollectionPath", { String: help.set }),
              pv("SearchSupported", { Bool: this.service.entitySets.find((s) => s.name === help.set)?.searchable === true }),
              pv(
                "Parameters",
                {},
                collection(
                  record("Common.ValueListParameterInOut", pv("LocalDataProperty", { PropertyPath: property.name }), pv("ValueListProperty", { String: help.element })),
                  // additionalBinding: In (filter), Out (result), InOut (both)
                  ...(help.bindings ?? []).map((b) =>
                    record(
                      b.usage === "filter" ? "Common.ValueListParameterIn" : b.usage === "result" ? "Common.ValueListParameterOut" : "Common.ValueListParameterInOut",
                      pv("LocalDataProperty", { PropertyPath: b.local }),
                      pv("ValueListProperty", { String: b.element }),
                    ),
                  ),
                  ...help.columns
                    .slice(1)
                    .filter((c) => !(help.bindings ?? []).some((b) => b.element === c.property))
                    .map((c) => record("Common.ValueListParameterDisplayOnly", pv("ValueListProperty", { String: c.property }))),
                ),
              ),
            ),
          ),
        );
        if (help.validation === true) children.push(annotation("Common.ValueListForValidation", { String: "" }));
        if (help.fixedValues === true) children.push(annotation("Common.ValueListWithFixedValues"));
      }
      const text = getArray(a, "ObjectModel.text.element")?.map(str).find((t) => t !== undefined);
      if (text !== undefined) {
        const arrangement = str(getAnnotation(a, "UI.textArrangement"));
        children.push(
          annotation(
            "Common.Text",
            { Path: text },
            arrangement === undefined ? undefined : annotation("UI.TextArrangement", { EnumMember: `UI.TextArrangementType/${enumName(arrangement)}` }),
          ),
        );
      }
      this.annotations(`${this.qualified(type.name)}/${property.name}`, children);
    }
  }

  /** `@UI.dataPoint` of the elements: UI.DataPoint, qualified by its qualifier or the element name (D57). */
  private dataPoints(entity: EntityModel): XmlElement[] {
    const result: XmlElement[] = [];
    for (const field of entity.fields) {
      const point = getAnnotation(field.annotations, "UI.dataPoint");
      if (!isObject(point)) continue;
      const title = str(point["title"]) ?? str(getAnnotation(field.annotations, "EndUserText.label"));
      const criticality = str(point["criticality"]);
      const target = point["targetvalue"];
      const visualization = str(point["visualization"]);
      result.push(
        annotation(
          "UI.DataPoint",
          { Qualifier: str(point["qualifier"]) ?? field.name },
          record(
            "UI.DataPointType",
            pv("Value", { Path: field.name }),
            title === undefined ? undefined : pv("Title", { String: title }),
            str(point["description"]) === undefined ? undefined : pv("Description", { String: str(point["description"]) }),
            typeof target === "number" ? pv("TargetValue", { Decimal: target }) : undefined,
            criticality === undefined ? undefined : pv("Criticality", { Path: criticality }),
            visualization === undefined ? undefined : pv("Visualization", { EnumMember: `UI.VisualizationType/${enumName(visualization)}` }),
          ),
        ),
      );
    }
    return result;
  }

  private dataFields(entity: EntityModel, path: string): XmlElement[] {
    const result: XmlElement[] = [];
    for (const { field, entry } of entriesOf(entity, path)) {
      const kind = str(entry["type"]) ?? "#STANDARD";
      const label = str(entry["label"]);
      const importance = str(entry["importance"]);
      const importanceAnnotation = importance === undefined ? undefined : annotation("UI.Importance", { EnumMember: `UI.ImportanceType/${enumName(importance)}` });
      const hidden = entry["hidden"] === true ? annotation("UI.Hidden") : undefined;
      if (kind === "#FOR_ACTION") {
        const action = str(entry["dataaction"]);
        if (action === undefined) {
          continue;
        }
        const grouping = str(entry["invocationgrouping"]);
        result.push(
          record(
            "UI.DataFieldForAction",
            pv("Action", { String: `${this.service.namespace}.${action}` }),
            label === undefined ? undefined : pv("Label", { String: label }),
            grouping === undefined ? undefined : pv("InvocationGrouping", { EnumMember: `UI.OperationGroupingType/${enumName(grouping)}` }),
            entry["inline"] === true ? pv("Inline", { Bool: true }) : undefined,
            importanceAnnotation,
            hidden,
          ),
        );
        continue;
      }
      const criticality = str(entry["criticality"]);
      const url = str(entry["url"]);
      if (kind === "#AS_DATAPOINT") {
        const point = getAnnotation(entity.fields.find((f) => f.name === field)?.annotations, "UI.dataPoint");
        const qualifier = isObject(point) ? (str(point["qualifier"]) ?? field) : field;
        result.push(record("UI.DataFieldForAnnotation", pv("Target", { AnnotationPath: `@UI.DataPoint#${qualifier}` }), label === undefined ? undefined : pv("Label", { String: label }), importanceAnnotation, hidden));
        continue;
      }
      result.push(
        record(
          kind === "#WITH_URL" && url !== undefined ? "UI.DataFieldWithUrl" : "UI.DataField",
          pv("Value", { Path: field }),
          label === undefined ? undefined : pv("Label", { String: label }),
          kind === "#WITH_URL" && url !== undefined ? pv("Url", { Path: url }) : undefined,
          criticality === undefined ? undefined : pv("Criticality", { Path: criticality }),
          importanceAnnotation,
          hidden,
        ),
      );
    }
    return result;
  }

  private typeAnnotations(type: ODataEntityType, entity: EntityModel): void {
    const a = entity.annotations;
    const children: Array<XmlElement | undefined> = [];
    const header = getAnnotation(a, "UI.headerInfo");
    if (isObject(header)) {
      const dataField = (value: AnnotationValue | undefined): XmlElement | undefined => {
        if (!isObject(value)) {
          return undefined;
        }
        const path = str(value["value"]);
        return path === undefined ? undefined : record("UI.DataField", pv("Value", { Path: path }), str(value["label"]) === undefined ? undefined : pv("Label", { String: str(value["label"]) }));
      };
      const title = dataField(header["title"]);
      const description = dataField(header["description"]);
      children.push(
        annotation(
          "UI.HeaderInfo",
          {},
          record(
            "UI.HeaderInfoType",
            pv("TypeName", { String: str(header["typename"]) ?? type.name.replace(/Type$/, "") }),
            pv("TypeNamePlural", { String: str(header["typenameplural"]) ?? type.name.replace(/Type$/, "") }),
            title === undefined ? undefined : pv("Title", {}, title),
            description === undefined ? undefined : pv("Description", {}, description),
            str(header["imageurl"]) === undefined ? undefined : pv("ImageUrl", { Path: str(header["imageurl"]) }),
          ),
        ),
      );
    }
    const lineItem = this.dataFields(entity, "UI.lineItem");
    if (lineItem.length > 0) children.push(annotation("UI.LineItem", {}, collection(...lineItem)));
    const identification = this.dataFields(entity, "UI.identification");
    if (identification.length > 0) children.push(annotation("UI.Identification", {}, collection(...identification)));
    const selection = entriesOf(entity, "UI.selectionField");
    if (selection.length > 0) children.push(annotation("UI.SelectionFields", {}, collection(...selection.map((s) => propertyPath(s.field)))));
    const groups = new Map<string, FieldEntry[]>();
    for (const item of entriesOf(entity, "UI.fieldGroup")) {
      const qualifier = str(item.entry["qualifier"]) ?? "";
      groups.set(qualifier, [...(groups.get(qualifier) ?? []), item]);
    }
    for (const [qualifier, items] of groups) {
      const fields = items.map((i) =>
        record("UI.DataField", pv("Value", { Path: i.field }), str(i.entry["label"]) === undefined ? undefined : pv("Label", { String: str(i.entry["label"]) })),
      );
      children.push(
        annotation("UI.FieldGroup", { Qualifier: qualifier === "" ? undefined : qualifier }, record("UI.FieldGroupType", pv("Data", {}, collection(...fields)))),
      );
    }
    children.push(...this.facets(entity));
    children.push(...this.dataPoints(entity));
    const variant = getArray(a, "UI.presentationVariant")?.find(isObject);
    if (variant !== undefined) {
      const sortOrder = (getArray(variant, "sortOrder") ?? []).filter(isObject);
      children.push(
        annotation(
          "UI.PresentationVariant",
          {},
          record(
            "UI.PresentationVariantType",
            sortOrder.length === 0
              ? undefined
              : pv(
                  "SortOrder",
                  {},
                  collection(
                    ...sortOrder.map((s) =>
                      record("Common.SortOrderType", pv("Property", { PropertyPath: str(s["by"]) ?? "" }), pv("Descending", { Bool: str(s["direction"]) === "#DESC" })),
                    ),
                  ),
                ),
            pv("Visualizations", {}, collection(el("AnnotationPath", undefined, "@UI.LineItem"))),
          ),
        ),
      );
    }
    const semanticKey = getArray(a, "ObjectModel.semanticKey")?.map(str).filter((k): k is string => k !== undefined);
    if (semanticKey !== undefined && semanticKey.length > 0) {
      children.push(annotation("Common.SemanticKey", {}, collection(...semanticKey.map(propertyPath))));
    }
    children.push(...this.sideEffects(type, entity));
    const label = str(getAnnotation(a, "EndUserText.label"));
    if (label !== undefined) children.push(annotation("Common.Label", { String: label }));
    this.annotations(this.qualified(type.name), children);
  }

  private facets(entity: EntityModel): XmlElement[] {
    const all: AnnotationObject[] = [];
    for (const field of entity.fields) {
      for (const facet of getArray(field.annotations, "UI.facet") ?? []) {
        if (isObject(facet)) {
          all.push(facet);
        }
      }
    }
    if (all.length === 0) {
      return [];
    }
    const byPosition = (x: AnnotationObject, y: AnnotationObject): number => num(x["position"]) - num(y["position"]);
    const render = (facet: AnnotationObject): XmlElement | undefined => {
      const type = str(facet["type"]) ?? "#COLLECTION";
      const id = str(facet["id"]);
      const label = str(facet["label"]);
      const common = [id === undefined ? undefined : pv("ID", { String: id }), label === undefined ? undefined : pv("Label", { String: label })];
      const hidden = facet["hidden"] === true ? annotation("UI.Hidden") : undefined;
      if (type === "#COLLECTION") {
        const children = all.filter((f) => str(f["parentid"]) === id && id !== undefined).sort(byPosition).map(render);
        return record("UI.CollectionFacet", ...common, pv("Facets", {}, collection(...children)), hidden);
      }
      const qualifier = str(facet["targetqualifier"]);
      const suffix = qualifier === undefined ? "" : `#${qualifier}`;
      let target: string | undefined;
      switch (type) {
        case "#IDENTIFICATION_REFERENCE":
          target = `@UI.Identification${suffix}`;
          break;
        case "#FIELDGROUP_REFERENCE":
          target = `@UI.FieldGroup${suffix}`;
          break;
        case "#LINEITEM_REFERENCE": {
          const element = str(facet["targetelement"]);
          target = element === undefined ? `@UI.LineItem${suffix}` : `${element}/@UI.LineItem${suffix}`;
          break;
        }
        case "#DATAPOINT_REFERENCE":
          target = `@UI.DataPoint${suffix}`;
          break;
        case "#PRESENTATIONVARIANT_REFERENCE":
          target = `@UI.PresentationVariant${suffix}`;
          break;
        default:
          return undefined;
      }
      return record("UI.ReferenceFacet", ...common, pv("Target", { AnnotationPath: target }), hidden);
    };
    const topLevel = (purpose: string): XmlElement[] =>
      all
        .filter((f) => str(f["parentid"]) === undefined && (str(f["purpose"]) ?? "#STANDARD") === purpose)
        .sort(byPosition)
        .map(render)
        .filter((x): x is XmlElement => x !== undefined);
    const result: XmlElement[] = [];
    const standard = topLevel("#STANDARD");
    if (standard.length > 0) result.push(annotation("UI.Facets", {}, collection(...standard)));
    const header = topLevel("#HEADER");
    if (header.length > 0) result.push(annotation("UI.HeaderFacets", {}, collection(...header)));
    return result;
  }

  /** BDEF side effects of the base entity, renamed through the projection. */
  private sideEffects(type: ODataEntityType, entity: EntityModel): XmlElement[] {
    const behavior = exposedBehavior(this.model, entity).base;
    const result: XmlElement[] = [];
    let index = 0;
    for (const effect of behavior?.sideEffects ?? []) {
      if (effect.trigger.kind !== "field") {
        continue;
      }
      const source = projectedFieldName(this.model, entity, effect.trigger.name);
      if (source === undefined) {
        continue;
      }
      const targets = this.sideEffectTargets(type, entity, effect.targets, "");
      if (targets.properties.length + targets.entities.length === 0) {
        continue;
      }
      index++;
      result.push(
        annotation(
          "Common.SideEffects",
          { Qualifier: `${source}${index > 1 ? index : ""}` },
          record(
            "Common.SideEffectsType",
            pv("SourceProperties", {}, collection(propertyPath(source))),
            targets.properties.length === 0 ? undefined : pv("TargetProperties", {}, collection(...targets.properties.map((p) => el("String", undefined, p)))),
            targets.entities.length === 0 ? undefined : pv("TargetEntities", {}, collection(...targets.entities.map((p) => el("NavigationPropertyPath", undefined, p)))),
          ),
        ),
      );
    }
    return result;
  }

  private sideEffectTargets(
    type: ODataEntityType,
    entity: EntityModel,
    targets: Array<{ kind: string; path: string }>,
    prefix: string,
  ): { properties: string[]; entities: string[] } {
    const properties: string[] = [];
    const entities: string[] = [];
    for (const target of targets) {
      const segments = target.path.split(".");
      if (target.kind === "field" && segments.length === 1) {
        const projected = projectedFieldName(this.model, entity, segments[0] ?? "");
        if (projected !== undefined) properties.push(`${prefix}${projected}`);
      } else if (target.kind === "field" && segments.length === 2) {
        const navigation = type.navigations.find((n) => same(n.name, segments[0] ?? ""));
        const targetEntity = navigation === undefined ? undefined : findEntity(this.model, navigation.targetEntity);
        const projected = targetEntity === undefined ? undefined : projectedFieldName(this.model, targetEntity, segments[1] ?? "");
        if (navigation !== undefined && projected !== undefined) properties.push(`${prefix}${navigation.name}/${projected}`);
      } else if (target.kind === "entity") {
        const navigation = type.navigations.find((n) => same(n.name, target.path));
        if (navigation !== undefined) entities.push(`${prefix}${navigation.name}`);
        else if (target.path === "$self" || target.path === "") entities.push(prefix === "" ? "" : prefix.replace(/\/$/, ""));
      }
    }
    return { properties, entities };
  }

  /** `@Consumption.filter.mandatory` and `selectionType` / `multipleSelections` (D57). */
  private filterRestrictions(type: ODataEntityType): XmlElement | undefined {
    const entity = findEntity(this.model, type.entity);
    if (entity === undefined) return undefined;
    const exposed = entity.fields.filter((f) => type.properties.some((p) => p.name === f.name));
    const required = exposed.filter((f) => getAnnotation(f.annotations, "Consumption.filter.mandatory") === true).map((f) => f.name);
    const expressions = exposed.flatMap((f) => {
      const selection = str(getAnnotation(f.annotations, "Consumption.filter.selectionType"))?.replace(/^#/, "").toUpperCase();
      const single = getAnnotation(f.annotations, "Consumption.filter.multipleSelections") === false;
      const allowed = selection === "SINGLE" || (single && selection === undefined) ? "SingleValue" : selection === "INTERVAL" ? (single ? "SingleRange" : "MultiRange") : selection === "RANGE" && single ? "SingleRange" : undefined;
      return allowed === undefined ? [] : [{ property: f.name, allowed }];
    });
    if (required.length === 0 && expressions.length === 0) return undefined;
    return annotation(
      "Capabilities.FilterRestrictions",
      {},
      record(
        "Capabilities.FilterRestrictionsType",
        required.length === 0 ? undefined : pv("RequiredProperties", {}, collection(...required.map(propertyPath))),
        expressions.length === 0
          ? undefined
          : pv(
              "FilterExpressionRestrictions",
              {},
              collection(...expressions.map((e) => record("Capabilities.FilterExpressionRestrictionType", pv("Property", { PropertyPath: e.property }), pv("AllowedExpressions", { String: e.allowed })))),
            ),
      ),
    );
  }

  private setAnnotations(type: ODataEntityType): void {
    const set = this.service.entitySets.find((s) => s.entityType === type.name);
    if (set === undefined) {
      return;
    }
    const children: Array<XmlElement | undefined> = [
      annotation("Capabilities.InsertRestrictions", {}, record("Capabilities.InsertRestrictionsType", pv("Insertable", { Bool: set.insertable }))),
      annotation(
        "Capabilities.UpdateRestrictions",
        {},
        record(
          "Capabilities.UpdateRestrictionsType",
          pv("Updatable", type.entityControl?.updatable === true && set.updatable ? { Path: `${ENTITY_CONTROL}/Updatable` } : { Bool: set.updatable }),
        ),
      ),
      annotation(
        "Capabilities.DeleteRestrictions",
        {},
        record(
          "Capabilities.DeleteRestrictionsType",
          pv("Deletable", type.entityControl?.deletable === true && set.deletable ? { Path: `${ENTITY_CONTROL}/Deletable` } : { Bool: set.deletable }),
        ),
      ),
      annotation("Capabilities.SearchRestrictions", {}, record("Capabilities.SearchRestrictionsType", pv("Searchable", { Bool: set.searchable }))),
      this.filterRestrictions(type),
    ];
    const navigations = type.navigations.filter((n) => n.collection);
    if (navigations.length > 0) {
      children.push(
        annotation(
          "Capabilities.NavigationRestrictions",
          {},
          record(
            "Capabilities.NavigationRestrictionsType",
            pv(
              "RestrictedProperties",
              {},
              collection(
                ...navigations.map((n) =>
                  record(
                    "Capabilities.NavigationPropertyRestriction",
                    pv("NavigationProperty", { NavigationPropertyPath: n.name }),
                    pv(
                      "InsertRestrictions",
                      {},
                      record("Capabilities.InsertRestrictionsType", pv("Insertable", n.insertableDynamic ? { Path: `${OPERATION_CONTROL}/${n.name}` } : { Bool: n.insertable })),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }
    if (type.etag !== undefined) {
      children.push(annotation("Core.OptimisticConcurrency", {}, collection(propertyPath(type.etag))));
    } else if (type.etagPath !== undefined) {
      // etag dependent by: the ETag property of the master, through the to-one navigations
      children.push(annotation("Core.OptimisticConcurrency", {}, collection(propertyPath([...type.etagPath.navigations, type.etagPath.property].join("/")))));
    }
    // draft (D54): the root and the nodes of a draft BO, with the actions of the draft
    if (set.draft?.root === true) {
      const action = (name: string): string => `${this.service.namespace}.${name}`;
      children.push(
        annotation(
          "Common.DraftRoot",
          {},
          record("Common.DraftRootType", pv("ActivationAction", { String: action("Activate") }), pv("EditAction", { String: action("Edit") }), pv("PreparationAction", { String: action("Prepare") }), pv("DiscardAction", { String: action("Discard") }), pv("ResumeAction", { String: action("Resume") })),
        ),
      );
    } else if (set.draft !== undefined) {
      children.push(annotation("Common.DraftNode", {}, record("Common.DraftNodeType", pv("PreparationAction", { String: `${this.service.namespace}.Prepare` }))));
    }
    this.annotations(`${SCHEMA_ALIAS}.${CONTAINER_NAME}/${set.name}`, children);
  }

  private operationAnnotations(operation: ODataOperation): void {
    const target = `${this.qualified(operation.name)}(${this.bindingType(operation)})`;
    const children: Array<XmlElement | undefined> = [];
    if (operation.dynamic && !operation.collectionBound) {
      children.push(annotation("Core.OperationAvailable", { Path: `_it/${OPERATION_CONTROL}/${operation.name}` }));
    }
    const type = this.service.entityTypes.find((t) => t.name === operation.boundType);
    const entity = type === undefined ? undefined : findEntity(this.model, type.entity);
    const behavior = entity === undefined ? undefined : exposedBehavior(this.model, entity).base;
    for (const effect of behavior?.sideEffects.filter((e) => e.trigger.kind === "action" && same(e.trigger.name, operation.action)) ?? []) {
      if (type === undefined || entity === undefined) {
        break;
      }
      const targets = this.sideEffectTargets(type, entity, effect.targets, "_it/");
      if (targets.properties.length + targets.entities.length > 0) {
        children.push(
          annotation(
            "Common.SideEffects",
            {},
            record(
              "Common.SideEffectsType",
              targets.properties.length === 0 ? undefined : pv("TargetProperties", {}, collection(...targets.properties.map((p) => el("String", undefined, p)))),
              targets.entities.length === 0 ? undefined : pv("TargetEntities", {}, collection(...targets.entities.map((p) => el("NavigationPropertyPath", undefined, p)))),
            ),
          ),
        );
      }
    }
    this.annotations(target, children);
    // parameter labels
    const action = behavior?.actions.find((a) => same(a.name, operation.action));
    const parameterEntity = action?.parameter === undefined ? undefined : findEntity(this.model, action.parameter);
    for (const parameter of operation.parameters) {
      const field = parameterEntity?.fields.find((f) => f.name === parameter.name);
      const label = str(getAnnotation(field?.annotations, "EndUserText.label"));
      if (label !== undefined) {
        this.annotations(`${target}/${parameter.name}`, [annotation("Common.Label", { String: label })]);
      }
    }
  }
}

export function generateCsdl(model: Model, service: ODataService = buildODataService(model)): string {
  return new CsdlBuilder(model, service).build();
}
