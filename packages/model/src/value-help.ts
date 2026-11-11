/**
 * Value helps of the elements (`@Consumption.valueHelpDefinition: [{ entity: { name, element } }]`,
 * D44): the entity set listing the values, the element giving the value, the columns shown.
 */

import { edmTypeOf } from "./abap-types.js";
import { getAnnotation, getArray } from "./annotations.js";
import { findEntity, same } from "./lookup.js";
import type { FieldModel, Model } from "./model.js";

export interface ValueHelp {
  /** Entity set of the value help entity. */
  set: string;
  /** Element of the value help entity giving the value. */
  element: string;
  label: string;
  /** Columns of the value help: the element first, then the other elements (at most five). */
  columns: Array<{ property: string; label: string; string: boolean }>;
  /**
   * The descriptions of the values, from the text entity (`_Text`, data category #TEXT): its
   * entity set, the element matching the value, the text, the language element.
   */
  text?: { set: string; key: string; element: string; label: string; language?: string };
  /**
   * `additionalBinding`: other elements of the value help bound to local elements, as filter
   * (the local value restricts the list), result (the chosen row fills the local element) or both.
   */
  bindings?: Array<{ local: string; element: string; usage: "filter" | "result" | "filterAndResult" }>;
  /** `useForValidation: true`: a value that is not in the list is an error (Common.ValueListForValidation). */
  validation?: boolean;
  /** `@ObjectModel.resultSet.sizeCategory: #XS` on the value help entity: a drop-down list (Common.ValueListWithFixedValues). */
  fixedValues?: boolean;
}

export function valueHelpOf(model: Model, field: FieldModel): ValueHelp | undefined {
  for (const definition of getArray(field.annotations, "Consumption.valueHelpDefinition") ?? []) {
    if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
      continue;
    }
    const target = definition["entity"];
    if (typeof target !== "object" || target === null || Array.isArray(target)) {
      continue;
    }
    const name = target["name"];
    const element = target["element"];
    if (typeof name !== "string" || typeof element !== "string") {
      continue;
    }
    const entity = findEntity(model, name);
    const set = model.service.entitySets.find((s) => same(s.entity, name));
    const key = entity?.fields.find((f) => same(f.name, element));
    if (entity === undefined || set === undefined || key === undefined) {
      continue;
    }
    const label = (f: FieldModel): string => {
      const text = getAnnotation(f.annotations, "EndUserText.label");
      return typeof text === "string" ? text : f.name;
    };
    const others = entity.fields.filter((f) => f !== key && getAnnotation(f.annotations, "UI.hidden") !== true).slice(0, 4);
    const entityLabel = getAnnotation(entity.annotations, "EndUserText.label");
    const help: ValueHelp = {
      set: set.name,
      element: key.name,
      label: typeof entityLabel === "string" ? entityLabel : entity.name,
      columns: [key, ...others].map((f) => ({ property: f.name, label: label(f), string: edmTypeOf(f.type).type === "Edm.String" })),
    };
    const bindings: NonNullable<ValueHelp["bindings"]> = [];
    for (const binding of Array.isArray(definition["additionalbinding"]) ? definition["additionalbinding"] : []) {
      if (typeof binding !== "object" || binding === null || Array.isArray(binding)) {
        continue;
      }
      const local = binding["localelement"];
      const remote = binding["element"];
      const usage = typeof binding["usage"] === "string" ? binding["usage"].replace(/^#/, "").toUpperCase() : "FILTER_AND_RESULT";
      const remoteField = typeof remote === "string" ? entity.fields.find((f) => same(f.name, remote)) : undefined;
      if (typeof local !== "string" || remoteField === undefined) {
        continue;
      }
      bindings.push({ local, element: remoteField.name, usage: usage === "FILTER" ? "filter" : usage === "RESULT" ? "result" : "filterAndResult" });
    }
    if (bindings.length > 0) {
      help.bindings = bindings;
    }
    if (definition["useforvalidation"] === true) {
      help.validation = true;
    }
    if (getAnnotation(entity.annotations, "ObjectModel.resultSet.sizeCategory") === "#XS") {
      help.fixedValues = true;
    }
    for (const association of entity.associations) {
      const textEntity = findEntity(model, association.target);
      const textSet = model.service.entitySets.find((s) => same(s.entity, association.target));
      const pair = association.on.find((o) => same(o.source, key.name));
      const textElement = textEntity?.fields.find((f) => getAnnotation(f.annotations, "Semantics.text") === true);
      if (textEntity === undefined || textSet === undefined || pair === undefined || textElement === undefined || getAnnotation(textEntity.annotations, "ObjectModel.dataCategory") !== "#TEXT") {
        continue;
      }
      const language = textEntity.fields.find((f) => getAnnotation(f.annotations, "Semantics.language") === true);
      help.text = { set: textSet.name, key: pair.target, element: textElement.name, label: label(textElement), ...(language === undefined ? {} : { language: language.name }) };
      break;
    }
    return help;
  }
  return undefined;
}
