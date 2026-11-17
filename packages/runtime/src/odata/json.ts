/** OData V4 JSON (odata.metadata=minimal): entities, collections, ETags, IEEE754Compatible. */

import { CREATE_BY_ASSOCIATION_CONTROL, ENTITY_CONTROL, FIELD_CONTROL, HIERARCHY_PROPERTIES, OPERATION_CONTROL, STATE_MESSAGES } from "@open-rap/model";
import { RawJsonNumber, toJson, type CanonicalValue, type JsonValue } from "../values.js";
import type { ReadEngine, Row } from "./read.js";
import type { ServiceRuntime, TypeInfo } from "./service.js";
import type { QueryOptions } from "./uri/ast.js";

/** JSON.stringify that writes RawJsonNumber verbatim. */
export function stringify(value: JsonValue): string {
  if (value instanceof RawJsonNumber) {
    return value.text;
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stringify).join(",")}]`;
  }
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}:${stringify(v)}`)
    .join(",")}}`;
}

/** Hidden member of the rows of an `etag dependent` entity: the ETag field of its master (D32). */
export const DEPENDENT_ETAG = "__etag";

/** The ETag of a row: its ETag field, or the one of its master (`etag dependent by`). */
export function etagOf(info: TypeInfo, row: Row): string | undefined {
  const name = info.type.etag ?? (info.type.etagPath === undefined ? undefined : DEPENDENT_ETAG);
  if (name === undefined) {
    return undefined;
  }
  return etagValue(row[name]);
}

/** The weak ETag of a value of an ETag field. */
export function etagValue(value: unknown): string {
  return `W/"${value === null || value === undefined ? "0" : String(value)}"`;
}

export interface JsonContext {
  ieee754: boolean;
}

export class JsonWriter {
  public constructor(
    private readonly service: ServiceRuntime,
    private readonly read: ReadEngine,
  ) {}

  public entity(info: TypeInfo, row: Row, options: QueryOptions, ctx: JsonContext): Record<string, JsonValue> {
    const result: Record<string, JsonValue> = {};
    const etag = etagOf(info, row);
    if (etag !== undefined) {
      result["@odata.etag"] = etag;
    }
    // D89: the actions under operation control advertised in a full representation, as on SAP BTP
    if (options.select === undefined && info.type.operationControl.length > 0) {
      for (const name of info.type.operationControl) {
        result[`#${this.service.odata.namespace}.${name}`] = {};
      }
    }
    for (const name of this.read.selectedProperties(info, options)) {
      const { property } = this.service.property(info, name);
      result[name] = toJson(property.edm, (row[name] ?? null) as CanonicalValue, ctx.ieee754);
    }
    // D108: the properties of a recursive hierarchy, in the rows of a hierarchical request
    for (const property of info.type.recursiveHierarchy === undefined ? [] : HIERARCHY_PROPERTIES) {
      const value = row[property.name];
      if (value !== undefined && isSelected(options, property.name)) {
        result[property.name] = toJson(property.edm, (typeof value === "number" && property.edm.type === "Edm.Int64" ? String(value) : value) as CanonicalValue, ctx.ieee754);
      }
    }
    for (const control of [CREATE_BY_ASSOCIATION_CONTROL, ENTITY_CONTROL, OPERATION_CONTROL, FIELD_CONTROL, STATE_MESSAGES]) {
      const value = row[control];
      if (value !== undefined && isSelected(options, control)) {
        result[control] = value as unknown as JsonValue;
      }
    }
    for (const item of options.expand ?? []) {
      const names = item.path[0] === "*" ? [...info.navigations.keys()] : [item.path[0] as string];
      for (const name of names) {
        const { navigation, target } = this.service.navigationTarget(info, name);
        const value = row[name];
        const nested = item.path[0] === "*" ? {} : item.options;
        if (navigation.collection) {
          const count = row[`${name}@odata.count`];
          if (typeof count === "number") {
            result[`${name}@odata.count`] = count;
          }
          result[name] = Array.isArray(value) ? value.map((r) => this.entity(target, r, nested, ctx)) : [];
        } else {
          result[name] = value === null || value === undefined || Array.isArray(value) || typeof value !== "object" ? null : this.entity(target, value, nested, ctx);
        }
      }
    }
    return result;
  }

  public contextUrl(info: TypeInfo, options: QueryOptions, single: boolean): string {
    const select = options.select !== undefined && !options.select.some((p) => p[0] === "*") ? `(${this.read.selectedProperties(info, options).join(",")})` : "";
    return `$metadata#${info.set.name}${select}${single ? "/$entity" : ""}`;
  }
}

function isSelected(options: QueryOptions, name: string): boolean {
  return options.select === undefined || options.select.some((p) => p[0] === "*" || p[0] === name);
}
