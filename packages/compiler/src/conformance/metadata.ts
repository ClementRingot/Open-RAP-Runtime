/**
 * The `$metadata` of a service compared with the one SAP BTP generated for the same sources (D90):
 * both documents become a list of facts (a key, a value) on the same names, and the facts that
 * differ are reported. Names are normalized: the aliases of the vocabularies (`SAP__common.Label`
 * and `Common.Label` are `Common.Label`), the namespace and alias of the service (`self`), and, for
 * a copy renamed for a shared system (D83), the suffix of the object names.
 */

import { XMLParser } from "fast-xml-parser";

/** One fact of a `$metadata`: `EntityType TravelType/Property BookingFee` → `Edm.Decimal …`. */
export interface MetadataFact {
  /** What the fact is about: `structure` (types, sets, operations) or `annotation`. */
  kind: "structure" | "annotation";
  /** The target: the entity type, set, operation or element it belongs to (`TravelType/BookingFee`). */
  target: string;
  /** The key of the fact within its target (`Property Type`, `@UI.LineItem`). */
  name: string;
  value: string;
}

export interface MetadataDifference {
  kind: MetadataFact["kind"];
  target: string;
  name: string;
  /** The value on SAP BTP, absent when only Open RAP Runtime has the fact. */
  sap?: string;
  /** The value of Open RAP Runtime, absent when only SAP BTP has the fact. */
  ours?: string;
}

export interface MetadataComparison {
  /** Facts on both sides with the same value. */
  same: number;
  differences: MetadataDifference[];
}

export interface CompareOptions {
  /** The suffix of the objects on SAP (`rapt abapgit --suffix`, D83), removed from the names. */
  suffix?: string;
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: false,
  isArray: (name) => !name.startsWith("@") && name !== "#text",
});

/** Short name of a vocabulary namespace: `com.sap.vocabularies.Common.v1` → `Common`. */
function vocabularyName(namespace: string): string {
  const match = /^(?:com\.sap\.vocabularies|Org\.OData)\.([A-Za-z0-9]+)\.[vV]\d+$/.exec(namespace);
  return match?.[1] ?? namespace;
}

const children = (node: Node, name: string): Node[] => (node[name] as Node[] | undefined) ?? [];
const attr = (node: Node, name: string): string | undefined => node[`@${name}`] as string | undefined;

/** The facts of a `$metadata` document. */
export function metadataFacts(xml: string, options: CompareOptions = {}): MetadataFact[] {
  const root = parser.parse(xml) as Node;
  const edmx = children(root, "edmx:Edmx")[0] ?? {};
  // the qualifiers of names: the vocabularies, the schema of the service
  const prefixes = new Map<string, string>();
  for (const reference of children(edmx, "edmx:Reference")) {
    for (const include of children(reference, "edmx:Include")) {
      const namespace = attr(include, "Namespace") ?? "";
      prefixes.set(namespace, vocabularyName(namespace));
      const alias = attr(include, "Alias");
      if (alias !== undefined) prefixes.set(alias, vocabularyName(namespace));
    }
  }
  const schemas = children(children(edmx, "edmx:DataServices")[0] ?? {}, "Schema");
  for (const schema of schemas) {
    prefixes.set(attr(schema, "Namespace") ?? "", "self");
    const alias = attr(schema, "Alias");
    if (alias !== undefined) prefixes.set(alias, "self");
  }
  // longest first: a namespace may start with another one
  const known = [...prefixes.keys()].filter((p) => p !== "").sort((a, b) => b.length - a.length);
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const qualified = known.length === 0 ? undefined : new RegExp(`(^|[^A-Za-z0-9_.])(${known.map(escape).join("|")})\\.(?=[A-Za-z_])`, "g");
  const suffix = options.suffix === undefined || options.suffix === "" ? undefined : new RegExp(`([A-Za-z0-9])${escape(options.suffix)}(?![A-Za-z0-9])`, "gi");
  const name = (value: string): string => {
    let result = qualified === undefined ? value : value.replace(qualified, (_m, before: string, prefix: string) => `${before}${prefixes.get(prefix) ?? prefix}.`);
    if (suffix !== undefined) result = result.replace(suffix, "$1");
    return result;
  };

  const facts: MetadataFact[] = [];
  const structure = (target: string, key: string, value: string): void => {
    facts.push({ kind: "structure", target: name(target), name: key, value: name(value) });
  };
  const describe = (node: Node, names: string[]): string =>
    names
      .map((n) => [n, attr(node, n)] as const)
      .filter(([, v]) => v !== undefined)
      .map(([n, v]) => `${n}=${v}`)
      .join(" ");

  for (const schema of schemas) {
    for (const type of [...children(schema, "EntityType"), ...children(schema, "ComplexType")]) {
      const typeName = `self.${attr(type, "Name") ?? ""}`;
      const keys = children(children(type, "Key")[0] ?? {}, "PropertyRef").map((r) => attr(r, "Name") ?? "");
      if (keys.length > 0) structure(typeName, "Key", keys.join(","));
      for (const property of children(type, "Property")) {
        structure(`${typeName}/${attr(property, "Name") ?? ""}`, "Property", describe(property, ["Type", "Nullable", "MaxLength", "Precision", "Scale", "SRID", "DefaultValue"]));
        annotations(`${typeName}/${attr(property, "Name") ?? ""}`, property);
      }
      for (const navigation of children(type, "NavigationProperty")) {
        const target = `${typeName}/${attr(navigation, "Name") ?? ""}`;
        structure(target, "NavigationProperty", describe(navigation, ["Type", "Nullable", "Partner", "ContainsTarget"]));
        for (const onDelete of children(navigation, "OnDelete")) structure(target, "OnDelete", attr(onDelete, "Action") ?? "");
        const constraints = children(navigation, "ReferentialConstraint").map((c) => `${attr(c, "Property") ?? ""}=${attr(c, "ReferencedProperty") ?? ""}`);
        if (constraints.length > 0) structure(target, "ReferentialConstraint", constraints.sort().join(","));
        annotations(target, navigation);
      }
      annotations(typeName, type);
    }
    for (const kind of ["Action", "Function"]) {
      for (const operation of children(schema, kind)) {
        const parameters = children(operation, "Parameter");
        const binding = attr(operation, "IsBound") === "true" ? (attr(parameters[0] ?? {}, "Type") ?? "") : "";
        const target = `self.${attr(operation, "Name") ?? ""}(${binding})`;
        structure(target, kind, describe(operation, ["IsBound", "EntitySetPath", "IsComposable"]));
        for (const parameter of parameters) {
          structure(`${target}/${attr(parameter, "Name") ?? ""}`, "Parameter", describe(parameter, ["Type", "Nullable", "MaxLength", "Precision", "Scale"]));
          annotations(`${target}/${attr(parameter, "Name") ?? ""}`, parameter);
        }
        for (const returnType of children(operation, "ReturnType")) structure(target, "ReturnType", describe(returnType, ["Type", "Nullable"]));
        annotations(target, operation);
      }
    }
    for (const container of children(schema, "EntityContainer")) {
      for (const set of [...children(container, "EntitySet"), ...children(container, "Singleton")]) {
        const target = `self.Container/${attr(set, "Name") ?? ""}`;
        structure(target, "EntitySet", attr(set, "EntityType") ?? attr(set, "Type") ?? "");
        for (const binding of children(set, "NavigationPropertyBinding")) structure(target, `NavigationPropertyBinding ${attr(binding, "Path") ?? ""}`, attr(binding, "Target") ?? "");
        annotations(target, set);
      }
      annotations("self.Container", container);
    }
    for (const block of children(schema, "Annotations")) {
      annotations(normalizeTarget(attr(block, "Target") ?? ""), block);
    }
  }
  return facts;

  /** The annotations of an element, inline or in an `Annotations` block, one fact per term. */
  function annotations(target: string, node: Node): void {
    for (const annotation of children(node, "Annotation")) {
      const qualifier = attr(annotation, "Qualifier");
      facts.push({
        kind: "annotation",
        target: name(target),
        name: `@${name(attr(annotation, "Term") ?? "")}${qualifier === undefined ? "" : `#${qualifier}`}`,
        value: name(expression(annotation)),
      });
    }
  }

  /** `self.Container/Travel` for the targets of the entity container, whatever its name. */
  function normalizeTarget(target: string): string {
    const container = schemas.flatMap((s) => children(s, "EntityContainer")).map((c) => attr(c, "Name") ?? "")[0];
    const normalized = name(target);
    return container === undefined || container === "" ? normalized : normalized.replace(new RegExp(`^self\\.${escape(container)}(?=/|$)`), "self.Container");
  }
}

/** A canonical text of the value of an annotation, a record or a collection. */
function expression(node: Node): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@")) {
      if (key === "@Term" || key === "@Qualifier" || key === "@Property") continue;
      // the type of a record that is the type of its term (Capabilities.InsertRestrictionsType…):
      // optional, SAP leaves it out; a derived type (UI.DataFieldForAction…) is kept
      if (key === "@Type" && /Type$/.test(String(value))) continue;
      parts.push(`${key.slice(1)}=${String(value)}`);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@") || key === "Annotation") continue;
    if (key === "#text") {
      parts.push(`"${String(value)}"`);
      continue;
    }
    for (const child of value as Node[]) {
      const inner = typeof child === "object" && child !== null ? expression(child) : `"${String(child)}"`;
      if (key === "PropertyValue") {
        parts.push(`${attr(child, "Property") ?? ""}: ${inner}`);
      } else {
        parts.push(`${key}(${inner})`);
      }
    }
  }
  // records: the order of the property values does not matter
  return node["PropertyValue"] !== undefined ? parts.sort().join(", ") : parts.join(", ");
}

/** The facts of SAP BTP and of Open RAP Runtime compared, on the same normalized names. */
export function compareMetadata(sapXml: string, oursXml: string, options: CompareOptions = {}): MetadataComparison {
  const index = (facts: MetadataFact[]): Map<string, MetadataFact> => new Map(facts.map((f) => [`${f.kind}|${f.target}|${f.name}`, f]));
  const sap = index(metadataFacts(sapXml, options));
  // the suffix also leaves the names of a project that is itself the renamed copy
  const ours = index(metadataFacts(oursXml, options));
  const differences: MetadataDifference[] = [];
  let same = 0;
  for (const [key, fact] of sap) {
    const mine = ours.get(key);
    if (mine === undefined) {
      differences.push({ kind: fact.kind, target: fact.target, name: fact.name, sap: fact.value });
    } else if (mine.value !== fact.value) {
      differences.push({ kind: fact.kind, target: fact.target, name: fact.name, sap: fact.value, ours: mine.value });
    } else {
      same++;
    }
  }
  for (const [key, fact] of ours) {
    if (!sap.has(key)) differences.push({ kind: fact.kind, target: fact.target, name: fact.name, ours: fact.value });
  }
  differences.sort((a, b) => a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target) || a.name.localeCompare(b.name));
  return { same, differences };
}

/** The comparison as Markdown: the counts, then the differences per target. */
export function comparisonReport(comparison: MetadataComparison, title: string): string {
  const { differences } = comparison;
  const count = (f: (d: MetadataDifference) => boolean): number => differences.filter(f).length;
  const onlySap = (d: MetadataDifference): boolean => d.ours === undefined;
  const onlyOurs = (d: MetadataDifference): boolean => d.sap === undefined;
  const lines = [
    `# ${title}`,
    "",
    "Written by `rapt conformance compare` (D90): the facts of the `$metadata` of SAP BTP and of Open RAP",
    "Runtime on normalized names (aliases of the vocabularies, namespace of the service, suffix).",
    "",
    "| | Structure | Annotations |",
    "|---|---|---|",
    `| Same | ${comparison.same} | |`,
    `| Only on SAP BTP | ${count((d) => onlySap(d) && d.kind === "structure")} | ${count((d) => onlySap(d) && d.kind === "annotation")} |`,
    `| Only in Open RAP Runtime | ${count((d) => onlyOurs(d) && d.kind === "structure")} | ${count((d) => onlyOurs(d) && d.kind === "annotation")} |`,
    `| Different | ${count((d) => !onlySap(d) && !onlyOurs(d) && d.kind === "structure")} | ${count((d) => !onlySap(d) && !onlyOurs(d) && d.kind === "annotation")} |`,
  ];
  const cell = (value: string | undefined): string => (value === undefined ? "—" : `\`${value.replace(/\|/g, "\\|").replace(/`/g, "'")}\``);
  for (const kind of ["structure", "annotation"] as const) {
    const items = differences.filter((d) => d.kind === kind);
    if (items.length === 0) continue;
    lines.push("", `## ${kind === "structure" ? "Structure" : "Annotations"}`);
    let target: string | undefined;
    for (const d of items) {
      if (d.target !== target) {
        target = d.target;
        lines.push("", `### \`${target}\``, "", "| | SAP BTP | Open RAP Runtime |", "|---|---|---|");
      }
      lines.push(`| ${d.name} | ${cell(d.sap)} | ${cell(d.ours)} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}
