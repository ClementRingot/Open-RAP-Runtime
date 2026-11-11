/**
 * CDS annotations in the IR.
 *
 * CDS annotation names are not case sensitive, so every key of the tree is stored in lower case:
 * `@UI.lineItem: [{ position: 10 }]` becomes `{ ui: { lineitem: [{ position: 10 }] } }`.
 * Values keep their case. Enumeration values keep their `#` prefix (`"#HIGH"`).
 */

export type AnnotationValue = string | number | boolean | null | AnnotationValue[] | AnnotationObject;

export interface AnnotationObject {
  [key: string]: AnnotationValue;
}

export type Annotations = AnnotationObject;

function isObject(v: AnnotationValue | undefined): v is AnnotationObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reads an annotation by its dotted path, case-insensitively: `getAnnotation(a, "UI.headerInfo.typeName")`. */
export function getAnnotation(annotations: Annotations | undefined, path: string): AnnotationValue | undefined {
  let current: AnnotationValue | undefined = annotations;
  for (const segment of path.toLowerCase().split(".")) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

export function getString(annotations: Annotations | undefined, path: string): string | undefined {
  const v = getAnnotation(annotations, path);
  return typeof v === "string" ? v : undefined;
}

export function getBoolean(annotations: Annotations | undefined, path: string): boolean | undefined {
  const v = getAnnotation(annotations, path);
  return typeof v === "boolean" ? v : undefined;
}

export function getArray(annotations: Annotations | undefined, path: string): AnnotationValue[] | undefined {
  const v = getAnnotation(annotations, path);
  if (v === undefined || v === null) {
    return undefined;
  }
  return Array.isArray(v) ? v : [v];
}

/**
 * Flattens an annotation tree to its leaf annotations. Arrays are leaves: a metadata extension
 * replaces a whole `@UI.lineItem` array, it does not merge it element by element.
 */
export function flattenAnnotations(annotations: Annotations, prefix = ""): Map<string, AnnotationValue> {
  const result = new Map<string, AnnotationValue>();
  for (const [key, value] of Object.entries(annotations)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (isObject(value)) {
      for (const [p, v] of flattenAnnotations(value, path)) {
        result.set(p, v);
      }
    } else {
      result.set(path, value);
    }
  }
  return result;
}

/** Sets an annotation by dotted path (lower-cased), creating intermediate objects. */
export function setAnnotation(annotations: Annotations, path: string, value: AnnotationValue): void {
  const segments = path.toLowerCase().split(".");
  let current: AnnotationObject = annotations;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i] as string;
    const next = current[segment];
    if (isObject(next)) {
      current = next;
    } else {
      const created: AnnotationObject = {};
      current[segment] = created;
      current = created;
    }
  }
  const last = segments[segments.length - 1] as string;
  const existing = current[last];
  if (isObject(existing) && isObject(value)) {
    // `@UI.facet: …` then `@UI: { lineItem: … }` on the same element: both are kept
    for (const [key, inner] of Object.entries(value)) {
      setAnnotation(existing, key, inner);
    }
    return;
  }
  current[last] = value;
}

/**
 * Merges annotation trees; later trees win, leaf annotation by leaf annotation
 * (see {@link flattenAnnotations}).
 */
export function mergeAnnotations(...layers: Array<Annotations | undefined>): Annotations {
  const merged = new Map<string, AnnotationValue>();
  for (const layer of layers) {
    if (layer === undefined) {
      continue;
    }
    for (const [path, value] of flattenAnnotations(layer)) {
      // a leaf replaces everything below it, and a deeper leaf replaces a shorter one
      for (const existing of [...merged.keys()]) {
        if (existing.startsWith(path + ".") || path.startsWith(existing + ".")) {
          merged.delete(existing);
        }
      }
      merged.set(path, value);
    }
  }
  const result: Annotations = {};
  for (const [path, value] of merged) {
    setAnnotation(result, path, value);
  }
  return result;
}
