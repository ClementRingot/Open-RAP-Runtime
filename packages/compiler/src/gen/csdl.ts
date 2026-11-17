/**
 * $metadata (CSDL XML, OData V4) of the service, with the UI, Common, Core, Capabilities and
 * Measures annotations derived from the CDS annotations and the behavior (PLAN.md §6.5).
 */

import {
  buildODataService,
  CONTAINER_NAME,
  ENTITY_CONTROL,
  STATE_MESSAGE_TYPE,
  STATE_MESSAGES,
  exposedBehavior,
  FIELD_CONTROL,
  fieldControlTypeName,
  findEntity,
  getAnnotation,
  valueHelpOf,
  getArray,
  HIERARCHY_PROPERTIES,
  OPERATION_CONTROL,
  operationControlTypeName,
  createByAssociationControlTypeName,
  CREATE_BY_ASSOCIATION_CONTROL,
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
  type SideEffectModel,
} from "@open-rap/model";
import { el, renderXml, type XmlElement } from "./xml.js";

const VOCABULARIES = [
  { uri: "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.xml", namespace: "Org.OData.Core.V1", alias: "Core" },
  { uri: "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Capabilities.V1.xml", namespace: "Org.OData.Capabilities.V1", alias: "Capabilities" },
  { uri: "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Measures.V1.xml", namespace: "Org.OData.Measures.V1", alias: "Measures" },
  { uri: "https://sap.github.io/odata-vocabularies/vocabularies/Common.xml", namespace: "com.sap.vocabularies.Common.v1", alias: "Common" },
  { uri: "https://sap.github.io/odata-vocabularies/vocabularies/UI.xml", namespace: "com.sap.vocabularies.UI.v1", alias: "UI" },
  { uri: "https://sap.github.io/odata-vocabularies/vocabularies/Communication.xml", namespace: "com.sap.vocabularies.Communication.v1", alias: "Communication" },
];

/** D108: the vocabularies of the recursive hierarchies, referenced by a service that has one. */
const HIERARCHY_VOCABULARIES = [
  { uri: "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Aggregation.V1.xml", namespace: "Org.OData.Aggregation.V1", alias: "Aggregation" },
  { uri: "https://sap.github.io/odata-vocabularies/vocabularies/Hierarchy.xml", namespace: "com.sap.vocabularies.Hierarchy.v1", alias: "Hierarchy" },
];

const isObject = (v: AnnotationValue | undefined): v is AnnotationObject => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: AnnotationValue | undefined): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);

/**
 * The AllowedExpressions of a filter field (FilterExpressionRestrictions) from
 * `@Consumption.filter.selectionType` and `multipleSelections` (D57, D68); undefined: any condition.
 */
export function allowedFilterExpressions(annotations: AnnotationObject): "SingleValue" | "SingleRange" | "MultiRange" | undefined {
  const selection = str(getAnnotation(annotations, "Consumption.filter.selectionType"))?.replace(/^#/, "").toUpperCase();
  const single = getAnnotation(annotations, "Consumption.filter.multipleSelections") === false;
  if (selection === "SINGLE" || (single && selection === undefined)) return "SingleValue";
  if (selection === "INTERVAL") return single ? "SingleRange" : "MultiRange";
  return selection === "RANGE" && single ? "SingleRange" : undefined;
}
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

/** Terms a Web API binding leaves out (D60): UI information, value helps, side effects. */
const UI_ONLY = /^(UI\.|Common\.ValueList|Common\.SideEffects|Common\.FilterDefaultValue)/;

/** An annotation of a Web API: without the UI information, nested annotations included. */
function webApiAnnotation(element: XmlElement): XmlElement | undefined {
  const term = element.attributes?.["Term"];
  if (element.name === "Annotation" && typeof term === "string" && UI_ONLY.test(term)) {
    return undefined;
  }
  return {
    ...element,
    children: (element.children ?? []).map((c) => (typeof c === "object" && c !== null ? webApiAnnotation(c) : c)),
  };
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
    // D107: the type of the parameters of a parameterized view, its results by the navigation Set
    for (const set of this.service.entitySets) {
      if (set.parameters === undefined) continue;
      schemaChildren.push(
        el(
          "EntityType",
          { Name: set.parameters.type },
          el("Key", undefined, ...set.parameters.properties.map((p) => el("PropertyRef", { Name: p.name }))),
          ...set.parameters.properties.map((p) => el("Property", { Name: p.name, ...edmAttributes(p.edm), Nullable: "false" })),
          el("NavigationProperty", { Name: "Set", Type: `Collection(${this.qualified(set.entityType)})`, Partner: "Parameters", ContainsTarget: "true" }),
        ),
      );
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
    // D95: the batch formats (multipart and JSON) and the functions of $filter, as on SAP BTP
    this.annotations(`${SCHEMA_ALIAS}.${CONTAINER_NAME}`, [
      annotation("Capabilities.BatchSupport", {}, record("Capabilities.BatchSupportType", pv("SupportedFormats", {}, collection(el("String", undefined, "application/json"), el("String", undefined, "multipart/mixed"))))),
      annotation("Capabilities.FilterFunctions", {}, collection(...["eq", "ne", "gt", "ge", "lt", "le", "and", "or", "contains", "startswith", "endswith", "any", "all"].map((f) => el("String", undefined, f)))),
    ]);
    schemaChildren.push(...this.annotationBlocks);
    const edmx = el(
      "edmx:Edmx",
      { Version: "4.0", "xmlns:edmx": "http://docs.oasis-open.org/odata/ns/edmx" },
      ...[...VOCABULARIES, ...(this.service.entityTypes.some((t) => t.recursiveHierarchy !== undefined) ? HIERARCHY_VOCABULARIES : [])].map((v) =>
        el("edmx:Reference", { Uri: v.uri }, el("edmx:Include", { Namespace: v.namespace, Alias: v.alias })),
      ),
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
    if (type.createByAssociationControl.length > 0) {
      children.push(el("Property", { Name: CREATE_BY_ASSOCIATION_CONTROL, Type: this.qualified(createByAssociationControlTypeName(type)) }));
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
    if (type.stateMessages === true) {
      children.push(el("Property", { Name: STATE_MESSAGES, Type: `Collection(${this.qualified(STATE_MESSAGE_TYPE)})`, Nullable: "false" }));
    }
    // D108: the properties of the recursive hierarchy, computed by each hierarchical request
    if (type.recursiveHierarchy !== undefined) {
      for (const property of HIERARCHY_PROPERTIES) children.push(el("Property", { Name: property.name, ...edmAttributes(property.edm) }));
    }
    // D107: the results of a parameterized view lead back to their parameters
    const parameterized = this.service.entitySets.find((s) => s.entityType === type.name && s.parameters !== undefined);
    if (parameterized?.parameters !== undefined) {
      children.push(el("NavigationProperty", { Name: "Parameters", Type: this.qualified(parameterized.parameters.type), Nullable: "false", Partner: "Set" }));
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
          // D92: the children of a composition go with their parent, as on SAP BTP
          navigation.kind === "composition" ? el("OnDelete", { Action: "Cascade" }) : undefined,
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
      if (type.createByAssociationControl.length > 0) {
        result.push(el("ComplexType", { Name: createByAssociationControlTypeName(type) }, ...type.createByAssociationControl.map((n) => el("Property", { Name: n, Type: "Edm.Boolean", Nullable: "false" }))));
      }
      if (type.operationControl.length > 0) {
        result.push(el("ComplexType", { Name: operationControlTypeName(type) }, ...type.operationControl.map((o) => el("Property", { Name: o, Type: "Edm.Boolean", Nullable: "false" }))));
      }
      if (type.fieldControl.length > 0) {
        result.push(el("ComplexType", { Name: fieldControlTypeName(type) }, ...type.fieldControl.map((f) => el("Property", { Name: f, Type: "Edm.Byte", Nullable: "false" }))));
      }
    }
    if (this.service.entityTypes.some((t) => t.stateMessages === true)) {
      // the state messages of a draft (D81)
      result.push(
        el(
          "ComplexType",
          { Name: STATE_MESSAGE_TYPE },
          el("Property", { Name: "code", Type: "Edm.String", Nullable: "false" }),
          el("Property", { Name: "message", Type: "Edm.String", Nullable: "false" }),
          el("Property", { Name: "target", Type: "Edm.String" }),
          el("Property", { Name: "additionalTargets", Type: "Collection(Edm.String)", Nullable: "false" }),
          el("Property", { Name: "transition", Type: "Edm.Boolean", Nullable: "false" }),
          el("Property", { Name: "numericSeverity", Type: "Edm.Byte", Nullable: "false" }),
          el("Property", { Name: "longtextUrl", Type: "Edm.String" }),
        ),
      );
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
      if (parameter.complexType !== undefined) {
        const type = `${SCHEMA_ALIAS}.${parameter.complexType}`;
        children.push(el("Parameter", { Name: parameter.name, Type: parameter.collection === true ? `Collection(${type})` : type, Nullable: parameter.nullable ? undefined : "false" }));
        continue;
      }
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
          // D107: a parameterized view is an entity set of its parameters
          { Name: set.name, EntityType: this.qualified(set.parameters?.type ?? set.entityType) },
          ...(set.parameters !== undefined ? [] : (type?.navigations ?? [])).map((n) => el("NavigationPropertyBinding", { Path: n.name, Target: n.targetSet })),
        );
      }),
    );
  }

  // -------------------------------------------------------------------------------------------
  // annotations

  private annotations(target: string, children: Array<XmlElement | undefined>): void {
    const list = children.filter((c): c is XmlElement => c !== undefined).map((c) => (this.model.service.webApi === true ? webApiAnnotation(c) : c)).filter((c): c is XmlElement => c !== undefined);
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
      if (getAnnotation(a, "Consumption.filter.hidden") === true) children.push(annotation("UI.HiddenFilter"));
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
        // D92: as on SAP BTP, the action with its binding parameter, Isolated unless said otherwise
        const grouping = str(entry["invocationgrouping"]) ?? "#ISOLATED";
        const operation = this.service.operations.find((o) => o.name === action && this.service.entityTypes.find((t) => t.name === o.boundType)?.entity === entity.name);
        result.push(
          record(
            "UI.DataFieldForAction",
            pv("Action", { String: operation === undefined ? `${this.service.namespace}.${action}` : `${this.service.namespace}.${action}(${operation.collectionBound ? `Collection(${this.service.namespace}.${operation.boundType})` : `${this.service.namespace}.${operation.boundType}`})` }),
            label === undefined ? undefined : pv("Label", { String: label }),
            pv("InvocationGrouping", { EnumMember: `UI.OperationGroupingType/${enumName(grouping)}` }),
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
            // D108: the tree of a recursive hierarchy, expanded to a level
            str(variant["recursiveHierarchyQualifier"]) === undefined ? undefined : pv("RecursiveHierarchyQualifier", { String: (str(variant["recursiveHierarchyQualifier"]) ?? "").replace(/[^A-Za-z0-9_]/g, "_") }),
            typeof variant["initialExpansionLevel"] === "number" ? pv("InitialExpansionLevel", { Int: variant["initialExpansionLevel"] }) : undefined,
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
          ),
        ),
      );
    }
    const semanticKey = getArray(a, "ObjectModel.semanticKey")?.map(str).filter((k): k is string => k !== undefined);
    if (semanticKey !== undefined && semanticKey.length > 0) {
      children.push(annotation("Common.SemanticKey", {}, collection(...semanticKey.map(propertyPath))));
    }
    children.push(...this.sideEffects(type, entity));
    // D92: the administrative fields of the entity, from @Semantics of the fields (of its base)
    const base = exposedBehavior(this.model, entity).baseEntity;
    const semantics: Array<[string, string]> = [
      ["Semantics.user.createdBy", "Common.CreatedBy"],
      ["Semantics.systemDateTime.createdAt", "Common.CreatedAt"],
      ["Semantics.user.lastChangedBy", "Common.ChangedBy"],
      ["Semantics.systemDateTime.lastChangedAt", "Common.ChangedAt"],
    ];
    for (const [key, term] of semantics) {
      const own = entity.fields.find((f) => getAnnotation(f.annotations, key) === true)?.name;
      const inherited = base.fields.find((f) => getAnnotation(f.annotations, key) === true)?.name;
      const name = own ?? (inherited === undefined ? undefined : projectedFieldName(this.model, entity, inherited));
      if (name !== undefined && type.properties.some((p) => p.name === name)) children.push(annotation(term, { Path: name }));
    }
    const label = str(getAnnotation(a, "EndUserText.label"));
    if (label !== undefined) children.push(annotation("Common.Label", { String: label }));
    if (type.stateMessages === true) children.push(annotation("Common.Messages", { Path: STATE_MESSAGES }));
    // D108: the recursive hierarchy, both terms with the qualifier of the CDS hierarchy
    const recursive = type.recursiveHierarchy;
    if (recursive !== undefined) {
      children.push(
        annotation(
          "Aggregation.RecursiveHierarchy",
          { Qualifier: recursive.qualifier },
          record(undefined, pv("NodeProperty", { PropertyPath: recursive.nodeProperty }), pv("ParentNavigationProperty", { NavigationPropertyPath: recursive.parentNavigation })),
        ),
        annotation("Hierarchy.RecursiveHierarchy", { Qualifier: recursive.qualifier }, record(undefined, ...HIERARCHY_PROPERTIES.map((p) => pv(p.name, { PropertyPath: p.name })))),
      );
    }
    this.annotations(this.qualified(type.name), children);
    for (const property of recursive === undefined ? [] : HIERARCHY_PROPERTIES) {
      this.annotations(`${this.qualified(type.name)}/${property.name}`, [annotation("Core.Computed"), annotation("UI.HiddenFilter"), annotation("UI.Hidden")]);
    }
    // D92: the controls of the instances are computed, hidden, not filterable (as on SAP BTP)
    for (const control of this.controls(type)) {
      this.annotations(`${this.qualified(type.name)}/${control}`, [annotation("Core.Computed"), annotation("UI.HiddenFilter"), annotation("UI.Hidden")]);
    }
    for (const navigation of type.navigations.filter((n) => n.kind === "composition")) {
      this.annotations(`${this.qualified(type.name)}/${navigation.name}`, [annotation("Common.Composition")]);
    }
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

  /** The side effects of the base BDEF the service exposes: a projection needs `use side effects;` (D86). */
  private exposedSideEffects(entity: EntityModel): SideEffectModel[] {
    const exposed = exposedBehavior(this.model, entity);
    const projection = exposed.projection;
    if (projection !== undefined && this.model.behaviors.find((b) => b.entities.includes(projection))?.useSideEffects !== true) {
      return [];
    }
    return exposed.base?.sideEffects ?? [];
  }

  /** BDEF side effects of the base entity, renamed through the projection. */
  private sideEffects(type: ODataEntityType, entity: EntityModel): XmlElement[] {
    const result: XmlElement[] = [];
    // D92: one side effect per source field, qualified SAP__Field_<field> as on SAP BTP
    const bySource = new Map<string, { properties: string[]; entities: string[] }>();
    for (const effect of this.exposedSideEffects(entity)) {
      if (effect.trigger.kind !== "field") {
        continue;
      }
      const source = projectedFieldName(this.model, entity, effect.trigger.name);
      if (source === undefined) {
        continue;
      }
      const found = this.sideEffectTargets(type, entity, effect.targets, "");
      const merged = bySource.get(source) ?? { properties: [], entities: [] };
      merged.properties.push(...found.properties.filter((p) => !merged.properties.includes(p)));
      merged.entities.push(...found.entities.filter((p) => !merged.entities.includes(p)));
      bySource.set(source, merged);
    }
    for (const [source, targets] of bySource) {
      if (targets.properties.length + targets.entities.length === 0) {
        continue;
      }
      result.push(
        annotation(
          "Common.SideEffects",
          { Qualifier: `SAP__Field_${source}` },
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
      const allowed = allowedFilterExpressions(f.annotations);
      return allowed === undefined ? [] : [{ property: f.name, allowed }];
    });
    const controls = this.controls(type);
    if (required.length === 0 && expressions.length === 0 && controls.length === 0) return undefined;
    return annotation(
      "Capabilities.FilterRestrictions",
      {},
      record(
        "Capabilities.FilterRestrictionsType",
        pv("Filterable", { Bool: true }),
        required.length === 0 ? undefined : pv("RequiredProperties", {}, collection(...required.map(propertyPath))),
        expressions.length === 0
          ? undefined
          : pv(
              "FilterExpressionRestrictions",
              {},
              collection(...expressions.map((e) => record("Capabilities.FilterExpressionRestrictionType", pv("Property", { PropertyPath: e.property }), pv("AllowedExpressions", { String: e.allowed })))),
            ),
        // D94: the controls of the instances cannot be filtered (as SAP says)
        controls.length === 0 ? undefined : pv("NonFilterableProperties", {}, collection(...controls.map(propertyPath))),
      ),
    );
  }

  /** The control properties of the instances of a type (D89), in the order of SAP BTP. */
  private controls(type: ODataEntityType): string[] {
    return [
      ...(type.createByAssociationControl.length > 0 ? [CREATE_BY_ASSOCIATION_CONTROL] : []),
      ...(type.entityControl !== undefined ? [ENTITY_CONTROL] : []),
      ...(type.operationControl.length > 0 ? [OPERATION_CONTROL] : []),
    ];
  }

  /** The entity set of the draft root of a draft node, up its associations to the parent. */
  private draftRootSet(type: ODataEntityType): string | undefined {
    let current: ODataEntityType | undefined = type;
    for (let depth = 0; current !== undefined && depth < 20; depth++) {
      const set = this.service.entitySets.find((s) => s.entityType === current?.name);
      if (set?.draft?.root === true) return set.name;
      const parent: ODataEntityType["navigations"][number] | undefined = current.navigations.find((n) => n.kind === "toParent");
      current = parent === undefined ? undefined : this.service.entityTypes.find((t) => t.name === parent.targetType);
    }
    return undefined;
  }

  private setAnnotations(type: ODataEntityType): void {
    const set = this.service.entitySets.find((s) => s.entityType === type.name);
    if (set === undefined) {
      return;
    }
    // D94: as on SAP BTP: insertable by default; delta updates, deep updates with Content-ID, and the
    // navigations not updatable through the instance on an updatable set; $select on the updates
    // the navigations of the draft first, as SAP orders them
    const draftFirst = (names: ODataEntityType["navigations"]): ODataEntityType["navigations"] => [...names.filter((n) => n.name === "DraftAdministrativeData" || n.sibling === true), ...names.filter((n) => !(n.name === "DraftAdministrativeData" || n.sibling === true))];
    const updatableNavigations = set.updatable ? draftFirst(type.navigations).map((n) => n.name) : [];
    const children: Array<XmlElement | undefined> = [
      set.insertable ? undefined : annotation("Capabilities.InsertRestrictions", {}, record("Capabilities.InsertRestrictionsType", pv("Insertable", { Bool: false }))),
      annotation(
        "Capabilities.UpdateRestrictions",
        {},
        record(
          "Capabilities.UpdateRestrictionsType",
          set.updatable ? pv("DeltaUpdateSupported", { Bool: true }) : undefined,
          pv("Updatable", type.entityControl?.updatable === true && set.updatable ? { Path: `${ENTITY_CONTROL}/Updatable` } : { Bool: set.updatable }),
          updatableNavigations.length === 0 ? undefined : pv("NonUpdatableNavigationProperties", {}, collection(...updatableNavigations.map(propertyPath))),
          pv("QueryOptions", {}, record("Capabilities.ModificationQueryOptionsType", pv("SelectSupported", { Bool: true }))),
        ),
      ),
      set.updatable ? annotation("Capabilities.DeepUpdateSupport", {}, record("Capabilities.DeepUpdateSupportType", pv("ContentIDSupported", { Bool: true }))) : undefined,
      annotation(
        "Capabilities.DeleteRestrictions",
        {},
        record(
          "Capabilities.DeleteRestrictionsType",
          pv("Deletable", type.entityControl?.deletable === true && set.deletable ? { Path: `${ENTITY_CONTROL}/Deletable` } : { Bool: set.deletable }),
        ),
      ),
      annotation(
        "Capabilities.SearchRestrictions",
        {},
        record(
          "Capabilities.SearchRestrictionsType",
          pv("Searchable", { Bool: set.searchable }),
          // D94: the terms of $search are all required, without AND, NOT nor groups (as SAP says)
          set.searchable ? pv("UnsupportedExpressions", { EnumMember: "Capabilities.SearchExpressions/AND Capabilities.SearchExpressions/NOT Capabilities.SearchExpressions/group" }) : undefined,
          set.searchable ? pv("SearchSyntax", { String: "https://url.sap/odata-search" }) : undefined,
        ),
      ),
      this.filterRestrictions(type),
      this.controls(type).length === 0 ? undefined : annotation("Capabilities.SortRestrictions", {}, record("Capabilities.SortRestrictionsType", pv("NonSortableProperties", {}, collection(...this.controls(type).map(propertyPath))))),
      set.draftAdministrativeData === true ? annotation("Capabilities.ReadRestrictions", {}, record("Capabilities.ReadRestrictionsType", pv("Readable", { Bool: false }))) : undefined,
    ];
    // D94: as on SAP BTP, the compositions (insertable or not), the association to the parent and
    // the sibling of a draft (neither insertable nor deeply updatable)
    const restricted = type.navigations.filter((n) => n.collection || n.kind === "toParent" || n.sibling === true);
    const navigations = draftFirst(restricted);
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
                  // the type of the items of the collection, which SAP leaves out
                  record(
                    undefined,
                    pv("NavigationProperty", { NavigationPropertyPath: n.name }),
                    n.collection || n.kind === "toParent" || set.draft?.root === true
                      ? pv(
                          "InsertRestrictions",
                          {},
                          record("Capabilities.InsertRestrictionsType", pv("Insertable", n.insertableDynamic ? { Path: `${CREATE_BY_ASSOCIATION_CONTROL}/${n.name}` } : { Bool: n.collection ? n.insertable : false })),
                        )
                      : undefined,
                    n.collection ? undefined : pv("DeepUpdateSupport", {}, record("Capabilities.DeepUpdateSupportType", pv("Supported", { Bool: false }))),
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
          record("Common.DraftRootType", pv("ActivationAction", { String: action("Activate") }), pv("EditAction", { String: action("Edit") }), pv("PreparationAction", { String: action("Prepare") }), pv("DiscardAction", { String: action("Discard") }), pv("ResumeAction", { String: action("Resume") }), set.draft.collaborative === true ? pv("ShareAction", { String: action("Share") }) : undefined),
        ),
      );
    } else if (set.draft !== undefined) {
      // D92: as on SAP BTP, the node names the entity set of its root
      const root = this.draftRootSet(type);
      children.push(annotation("Common.DraftNode"));
      if (root !== undefined) children.push(annotation("Common.DraftActivationVia", {}, collection(el("String", undefined, `${SCHEMA_ALIAS}.${CONTAINER_NAME}/${root}`))));
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
    const effects = entity === undefined ? [] : this.exposedSideEffects(entity);
    for (const effect of effects.filter((e) => e.trigger.kind === "action" && same(e.trigger.name, operation.action))) {
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
