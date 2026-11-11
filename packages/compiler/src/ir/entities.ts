/** CDS view entities, projections and abstract entities → IR entities. */

import {
  getAnnotation,
  getString,
  mergeAnnotations,
  setAnnotation,
  sqlName,
  type AbapType,
  type AdminSemantics,
  type Annotations,
  type AssociationModel,
  type EntityModel,
  type FieldModel,
} from "@rap-transpiler/model";
import { parseCds, type CdsElementAst, type CdsEntityAst, type CdsMetadataExtensionAst } from "../cds/adapter.js";
import { parseBuiltInType } from "../ddic/catalog.js";
import type { Diagnostics } from "../diagnostics.js";
import { filesOfType, type Project, type SourceFile } from "../input/project.js";
import type { Dictionary } from "./dictionary.js";

const LAYERS = ["#CORE", "#LOCALIZATION", "#INDUSTRY", "#PARTNER", "#CUSTOMER"];

const SEMANTICS: Array<[string, AdminSemantics]> = [
  ["semantics.user.createdby", "createdBy"],
  ["semantics.systemdatetime.createdat", "createdAt"],
  ["semantics.user.lastchangedby", "lastChangedBy"],
  ["semantics.systemdatetime.lastchangedat", "lastChangedAt"],
  ["semantics.systemdatetime.localinstancelastchangedat", "localInstanceLastChangedAt"],
];

interface ParsedEntity {
  ast: CdsEntityAst;
  file: SourceFile;
}

export class EntityResolver {
  private readonly parsed = new Map<string, ParsedEntity>();
  private readonly extensions = new Map<string, Array<{ ast: CdsMetadataExtensionAst; file: SourceFile }>>();
  private readonly resolved = new Map<string, EntityModel | undefined>();
  private readonly inProgress = new Set<string>();

  public constructor(
    project: Project,
    private readonly dictionary: Dictionary,
    private diagnostics: Diagnostics,
  ) {
    for (const file of filesOfType(project, "DDLS").filter((f) => f.extension === "asddls")) {
      const result = parseCds(file.fileName, file.content);
      if (!result.ok) {
        diagnostics.error("CDS001", result.message, { file: file.path, ...result.loc });
      } else if ("entity" in result) {
        this.parsed.set(result.entity.name.toUpperCase(), { ast: result.entity, file });
      }
    }
    for (const file of filesOfType(project, "DDLX").filter((f) => f.extension === "asddlxs")) {
      const result = parseCds(file.fileName, file.content);
      if (!result.ok) {
        diagnostics.error("CDS001", result.message, { file: file.path, ...result.loc });
      } else if ("extension" in result) {
        const key = result.extension.entity.toUpperCase();
        const list = this.extensions.get(key) ?? [];
        list.push({ ast: result.extension, file });
        this.extensions.set(key, list);
      }
    }
    for (const [entity, list] of this.extensions) {
      if (!this.parsed.has(entity)) {
        for (const { ast, file } of list) {
          diagnostics.warning("CDS006", `metadata extension for unknown entity ${ast.entity}`, { file: file.path, ...ast.loc });
        }
      }
    }
  }

  public has(name: string): boolean {
    return this.parsed.has(name.toUpperCase());
  }

  /** Names of the abstract entities of the project. */
  public abstractNames(): string[] {
    return [...this.parsed.values()].filter((p) => p.ast.kind === "abstract").map((p) => p.ast.name);
  }

  /** Resolves an entity with its diagnostics in `sink` (an entity the BO may not need). */
  public resolveInto(name: string, sink: Diagnostics): EntityModel | undefined {
    const previous = this.diagnostics;
    this.diagnostics = sink;
    try {
      return this.resolve(name);
    } finally {
      this.diagnostics = previous;
    }
  }

  public ast(name: string): ParsedEntity | undefined {
    return this.parsed.get(name.toUpperCase());
  }

  public all(): EntityModel[] {
    return [...this.resolved.values()].filter((e): e is EntityModel => e !== undefined);
  }

  /** Resolves an entity (and the entities it depends on); undefined when it cannot be built. */
  public resolve(name: string): EntityModel | undefined {
    const key = name.toUpperCase();
    if (this.resolved.has(key)) {
      return this.resolved.get(key);
    }
    const parsed = this.parsed.get(key);
    if (parsed === undefined || this.inProgress.has(key)) {
      return undefined;
    }
    this.inProgress.add(key);
    let entity: EntityModel | undefined;
    switch (parsed.ast.kind) {
      case "view":
        entity = this.view(parsed);
        break;
      case "projection":
        entity = this.projection(parsed);
        break;
      case "abstract":
        entity = this.abstract(parsed);
        break;
      case "custom":
        entity = this.custom(parsed);
        break;
      default:
        this.diagnostics.error("CDS002", `${parsed.ast.name}: ${parsed.ast.statement} is not supported`, { file: parsed.file.path, ...parsed.ast.loc });
    }
    this.inProgress.delete(key);
    this.resolved.set(key, entity);
    return entity;
  }

  // -------------------------------------------------------------------------------------------

  private loc(file: SourceFile, loc: { line: number; column: number }): { file: string; line: number; column: number } {
    return { file: file.path, line: loc.line, column: loc.column };
  }

  private entityAnnotations(parsed: ParsedEntity): Annotations {
    const own = parsed.ast.annotations;
    const extensions = this.applicableExtensions(parsed);
    const headers = extensions.map((x) => withoutLayer(x.ast.annotations));
    return mergeAnnotations(own, ...headers);
  }

  private applicableExtensions(parsed: ParsedEntity): Array<{ ast: CdsMetadataExtensionAst; file: SourceFile }> {
    const list = this.extensions.get(parsed.ast.name.toUpperCase()) ?? [];
    if (list.length === 0) {
      return [];
    }
    if (getAnnotation(parsed.ast.annotations, "Metadata.allowExtensions") !== true) {
      for (const { ast, file } of list) {
        this.diagnostics.warning(
          "CDS007",
          `metadata extension of ${parsed.ast.name} ignored: the entity does not declare @Metadata.allowExtensions: true`,
          { file: file.path, ...ast.loc },
        );
      }
      return [];
    }
    return [...list].sort((a, b) => LAYERS.indexOf(a.ast.layer) - LAYERS.indexOf(b.ast.layer));
  }

  private elementExtensionAnnotations(parsed: ParsedEntity, element: string): Annotations[] {
    return this.applicableExtensions(parsed).flatMap((x) =>
      x.ast.elements.filter((e) => e.name.toUpperCase() === element.toUpperCase()).map((e) => e.annotations),
    );
  }

  private checkExtensionElements(parsed: ParsedEntity, entity: EntityModel): void {
    for (const { ast, file } of this.applicableExtensions(parsed)) {
      for (const element of ast.elements) {
        const known =
          entity.fields.some((f) => f.name.toUpperCase() === element.name.toUpperCase()) ||
          entity.associations.some((a) => a.name.toUpperCase() === element.name.toUpperCase());
        if (!known) {
          this.diagnostics.warning("CDS008", `metadata extension annotates unknown element ${entity.name}.${element.name}`, {
            file: file.path,
            ...element.loc,
          });
        }
      }
    }
  }

  private fieldFromElement(
    parsed: ParsedEntity,
    element: CdsElementAst,
    type: AbapType,
    inherited: Annotations | undefined,
  ): FieldModel {
    const own = element.annotations;
    const annotations = mergeAnnotations(inherited, own, ...this.elementExtensionAnnotations(parsed, element.name));
    const field: FieldModel = { name: element.name, type: { ...type }, key: element.key, annotations, src: this.loc(parsed.file, element.loc) };
    for (const [path, semantics] of SEMANTICS) {
      if (getAnnotation(annotations, path) === true) {
        field.semantics = semantics;
      }
    }
    // an admin time stamp typed DEC(15) / DEC(21,7) is a time stamp
    if (field.semantics !== undefined && /At$/.test(field.semantics) && (type.kind === "dec" || type.kind === "timestampl")) {
      field.type.kind = type.decimals === 7 || type.length === 21 ? "timestampl" : type.kind === "dec" ? "timestamp" : type.kind;
    }
    const currency = getString(annotations, "Semantics.amount.currencyCode");
    if (currency !== undefined) {
      field.currencyCode = currency;
    }
    const unit = getString(annotations, "Semantics.quantity.unitOfMeasure");
    if (unit !== undefined) {
      field.unitOfMeasure = unit;
    }
    return field;
  }

  // -------------------------------------------------------------------------------------------
  // view entities

  private view(parsed: ParsedEntity): EntityModel | undefined {
    const { ast, file } = parsed;
    if (ast.source === undefined) {
      this.diagnostics.error("CDS003", `${ast.name}: no data source`, this.loc(file, ast.loc));
      return undefined;
    }
    if (ast.hasJoin) {
      this.diagnostics.error("CDS002", `${ast.name}: joins are not supported yet`, this.loc(file, ast.loc));
    }
    if (ast.hasWhere) {
      this.diagnostics.warning("CDS002", `${ast.name}: the WHERE condition is not supported yet and is ignored`, this.loc(file, ast.loc));
    }
    const table = this.dictionary.table(ast.source);
    const sourceEntity = table === undefined ? this.resolve(ast.source) : undefined;
    if (table === undefined && sourceEntity === undefined) {
      this.diagnostics.error("CDS003", `${ast.name}: unknown data source ${ast.source} (no TABL or DDLS in the sources)`, this.loc(file, ast.loc));
      return undefined;
    }
    const associationNames = new Set(ast.associations.map((a) => a.alias.toUpperCase()));
    const fields: FieldModel[] = [];
    for (const element of ast.elements) {
      if (element.path === undefined) {
        this.diagnostics.error(
          "CDS002",
          `${ast.name}.${element.name || "?"}: expressions in the select list are not supported yet (${element.expression ?? ""})`,
          this.loc(file, element.loc),
        );
        continue;
      }
      let path = element.path;
      if (path.length > 1 && ast.sourceAlias !== undefined && path[0]?.toUpperCase() === ast.sourceAlias.toUpperCase()) {
        path = path.slice(1);
      } else if (path.length > 1 && path[0]?.toUpperCase() === ast.source.toUpperCase()) {
        path = path.slice(1);
      }
      if (path.length === 1 && associationNames.has((path[0] ?? "").toUpperCase())) {
        continue; // association exposure
      }
      if (path.length > 1) {
        this.diagnostics.error("CDS002", `${ast.name}.${element.name}: path expressions (${path.join(".")}) are not supported yet`, this.loc(file, element.loc));
        continue;
      }
      const sourceName = path[0] ?? "";
      if (table !== undefined) {
        const column = table.columns.find((c) => c.name === sourceName.toLowerCase());
        if (column === undefined) {
          this.diagnostics.error("CDS004", `${ast.name}.${element.name}: ${table.name} has no column ${sourceName}`, this.loc(file, element.loc));
          continue;
        }
        const field = this.fieldFromElement(parsed, element, column.type, undefined);
        field.column = column.name;
        if (column.client) {
          this.diagnostics.warning("CDS009", `${ast.name}.${element.name}: client fields are not exposed (single tenant, decision D9)`, this.loc(file, element.loc));
          continue;
        }
        fields.push(field);
      } else if (sourceEntity !== undefined) {
        const base = sourceEntity.fields.find((f) => f.name.toUpperCase() === sourceName.toUpperCase());
        if (base === undefined) {
          this.diagnostics.error("CDS004", `${ast.name}.${element.name}: ${sourceEntity.name} has no element ${sourceName}`, this.loc(file, element.loc));
          continue;
        }
        const field = this.fieldFromElement(parsed, element, base.type, propagated(ast, base.annotations));
        field.baseField = base.name;
        fields.push(field);
      }
    }
    if (table !== undefined) {
      this.addDataElementLabels(fields, table.name);
    }
    const entity: EntityModel = {
      name: ast.name,
      kind: "view",
      root: ast.root,
      source: table !== undefined ? table.name : (sourceEntity as EntityModel).name,
      sqlView: sqlName(ast.name),
      fields,
      associations: [],
      annotations: this.entityAnnotations(parsed),
      src: this.loc(file, ast.loc),
    };
    entity.associations = this.associationsOf(parsed, entity);
    if (fields.filter((f) => f.key).length === 0) {
      this.diagnostics.error("CDS011", `${ast.name}: no key element`, this.loc(file, ast.loc));
    }
    this.checkExtensionElements(parsed, entity);
    return entity;
  }

  /** The associations of a view or custom entity, ON conditions resolved. */
  private associationsOf(parsed: ParsedEntity, entity: EntityModel): AssociationModel[] {
    const { ast, file } = parsed;
    return ast.associations.map((a) => {
      const association: AssociationModel = {
        name: a.alias,
        target: this.ast(a.target)?.ast.name ?? a.target,
        kind: a.kind,
        cardinality: a.cardinality,
        on: [],
        src: this.loc(file, a.loc),
      };
      for (const pair of a.on) {
        const resolvedPair = this.resolveOnPair(entity, ast, a.alias, pair.left, pair.right);
        if (resolvedPair === undefined) {
          this.diagnostics.error(
            "CDS010",
            `${ast.name}.${a.alias}: ON condition ${pair.left.join(".")} = ${pair.right.join(".")} not supported (only equalities between an element and a target element)`,
            this.loc(file, a.loc),
          );
        } else {
          association.on.push(resolvedPair);
        }
      }
      if (!this.has(a.target)) {
        this.diagnostics.error("CDS005", `${ast.name}.${a.alias}: unknown target entity ${a.target}`, this.loc(file, a.loc));
      }
      return association;
    });
  }

  private addDataElementLabels(fields: FieldModel[], _table: string): void {
    for (const field of fields) {
      if (getAnnotation(field.annotations, "EndUserText.label") !== undefined || field.type.dataElement === undefined) {
        continue;
      }
      const label = this.dictionary.dataElement(field.type.dataElement)?.label;
      if (label !== undefined) {
        setAnnotation(field.annotations, "EndUserText.label", label);
      }
    }
  }

  /** `$projection.A = _X.B`, `source.col = _X.B`, `A = _X.B` (both orders). */
  private resolveOnPair(
    entity: EntityModel,
    ast: CdsEntityAst,
    alias: string,
    left: string[],
    right: string[],
  ): { source: string; target: string } | undefined {
    const isTarget = (p: string[]): boolean => p.length === 2 && (p[0] ?? "").toUpperCase() === alias.toUpperCase();
    const [sourcePath, targetPath] = isTarget(right) ? [left, right] : isTarget(left) ? [right, left] : [undefined, undefined];
    if (sourcePath === undefined || targetPath === undefined) {
      return undefined;
    }
    let element: string | undefined;
    const head = (sourcePath[0] ?? "").toUpperCase();
    if (sourcePath.length === 2 && head === "$PROJECTION") {
      element = sourcePath[1];
    } else if (sourcePath.length === 2 && (head === ast.source?.toUpperCase() || head === ast.sourceAlias?.toUpperCase())) {
      const column = (sourcePath[1] ?? "").toLowerCase();
      element = entity.fields.find((f) => f.column === column)?.name;
    } else if (sourcePath.length === 1) {
      const name = (sourcePath[0] ?? "").toUpperCase();
      element = entity.fields.find((f) => f.name.toUpperCase() === name || f.column === name.toLowerCase())?.name;
    }
    const field = element === undefined ? undefined : entity.fields.find((f) => f.name.toUpperCase() === element?.toUpperCase());
    if (field === undefined) {
      return undefined;
    }
    return { source: field.name, target: targetPath[1] ?? "" };
  }

  // -------------------------------------------------------------------------------------------
  // projections

  private projection(parsed: ParsedEntity): EntityModel | undefined {
    const { ast, file } = parsed;
    const base = ast.source === undefined ? undefined : this.resolve(ast.source);
    if (base === undefined) {
      this.diagnostics.error("CDS003", `${ast.name}: unknown projected entity ${ast.source ?? ""}`, this.loc(file, ast.loc));
      return undefined;
    }
    const fields: FieldModel[] = [];
    const associations: AssociationModel[] = [];
    for (const element of ast.elements) {
      const source = element.path?.join(".") ?? "";
      if (element.path === undefined || element.path.length !== 1) {
        this.diagnostics.error(
          "CDS002",
          `${ast.name}.${element.name || "?"}: only elements of the projected entity can be projected (${element.expression ?? source})`,
          this.loc(file, element.loc),
        );
        continue;
      }
      const baseAssociation = base.associations.find((a) => a.name.toUpperCase() === source.toUpperCase());
      if (baseAssociation !== undefined) {
        const target = element.redirect?.target ?? baseAssociation.target;
        const association: AssociationModel = {
          name: element.name,
          target: this.ast(target)?.ast.name ?? target,
          kind: baseAssociation.kind,
          cardinality: baseAssociation.cardinality,
          on: [],
          baseAssociation: baseAssociation.name,
          src: this.loc(file, element.loc),
        };
        if (element.redirect === undefined && baseAssociation.kind !== "association") {
          this.diagnostics.warning(
            "CDS012",
            `${ast.name}.${element.name}: a ${baseAssociation.kind === "composition" ? "composition" : "to-parent association"} should be redirected to the projection of its target`,
            this.loc(file, element.loc),
          );
        }
        if (element.redirect !== undefined && !this.has(element.redirect.target)) {
          this.diagnostics.error("CDS005", `${ast.name}.${element.name}: unknown redirection target ${element.redirect.target}`, this.loc(file, element.loc));
        }
        associations.push(association);
        continue;
      }
      const baseField = base.fields.find((f) => f.name.toUpperCase() === source.toUpperCase());
      if (baseField === undefined) {
        this.diagnostics.error("CDS004", `${ast.name}.${element.name}: ${base.name} has no element ${source}`, this.loc(file, element.loc));
        continue;
      }
      const field = this.fieldFromElement(parsed, { ...element, key: element.key || baseField.key }, baseField.type, propagated(ast, baseField.annotations));
      field.baseField = baseField.name;
      if (field.semantics === undefined && baseField.semantics !== undefined) {
        field.semantics = baseField.semantics;
      }
      if (baseField.currencyCode !== undefined && field.currencyCode === undefined) {
        field.currencyCode = projectedName(ast, baseField.currencyCode);
      }
      if (baseField.unitOfMeasure !== undefined && field.unitOfMeasure === undefined) {
        field.unitOfMeasure = projectedName(ast, baseField.unitOfMeasure);
      }
      fields.push(field);
    }
    // ON conditions: the pairs of the base association, renamed through both projections
    const entity: EntityModel = {
      name: ast.name,
      kind: "projection",
      root: ast.root,
      source: base.name,
      sqlView: sqlName(ast.name),
      fields,
      associations,
      annotations: this.entityAnnotations(parsed),
      src: this.loc(file, ast.loc),
    };
    if (ast.providerContract !== undefined) {
      entity.providerContract = ast.providerContract;
    }
    for (const association of associations) {
      const baseAssociation = base.associations.find((a) => a.name === association.baseAssociation);
      const target = this.resolveLazy(association.target);
      for (const pair of baseAssociation?.on ?? []) {
        const source = fields.find((f) => (f.baseField ?? f.name).toUpperCase() === pair.source.toUpperCase());
        const targetField =
          target === undefined ? undefined : target.fields.find((f) => (f.baseField ?? f.name).toUpperCase() === pair.target.toUpperCase());
        if (source === undefined || (target !== undefined && targetField === undefined)) {
          this.diagnostics.error(
            "CDS013",
            `${ast.name}.${association.name}: the projection must expose ${pair.source} and its target ${pair.target} for the association`,
            association.src === undefined ? undefined : { ...association.src },
          );
          continue;
        }
        association.on.push({ source: source.name, target: targetField?.name ?? pair.target });
      }
    }
    if (fields.filter((f) => f.key).length === 0) {
      this.diagnostics.error("CDS011", `${ast.name}: no key element`, this.loc(file, ast.loc));
    }
    this.checkExtensionElements(parsed, entity);
    return entity;
  }

  /** Resolves an entity unless it is being resolved (cycles through associations). */
  private resolveLazy(name: string): EntityModel | undefined {
    const key = name.toUpperCase();
    if (this.inProgress.has(key)) {
      return undefined;
    }
    return this.resolve(name);
  }

  // -------------------------------------------------------------------------------------------
  // abstract entities (action parameters)

  /** A custom entity: typed elements, read by the class of `@ObjectModel.query.implementedBy` (D43). */
  private custom(parsed: ParsedEntity): EntityModel | undefined {
    const { ast, file } = parsed;
    const fields: FieldModel[] = [];
    for (const element of ast.elements) {
      const declared = element.declaredType ?? "";
      const type = parseBuiltInType(declared) ?? this.dictionary.dataElement(declared)?.type;
      if (type === undefined) {
        this.diagnostics.error("CDS014", `${ast.name}.${element.name}: unknown type ${declared}`, this.loc(file, element.loc));
        continue;
      }
      fields.push(this.fieldFromElement(parsed, element, type, undefined));
    }
    const implementedBy = getAnnotation(ast.annotations, "ObjectModel.query.implementedBy");
    const entity: EntityModel = {
      name: ast.name,
      kind: "custom",
      root: ast.root,
      fields,
      associations: [],
      annotations: this.entityAnnotations(parsed),
      src: this.loc(file, ast.loc),
    };
    if (typeof implementedBy === "string" && /^ABAP:\s*\S+$/i.test(implementedBy)) {
      entity.queryClass = implementedBy.replace(/^ABAP:\s*/i, "").toUpperCase();
    } else {
      this.diagnostics.error("CDS016", `${ast.name}: a custom entity needs @ObjectModel.query.implementedBy: 'ABAP:<query class>'`, this.loc(file, ast.loc));
    }
    entity.associations = this.associationsOf(parsed, entity);
    if (fields.filter((f) => f.key).length === 0) {
      this.diagnostics.error("CDS011", `${ast.name}: no key element`, this.loc(file, ast.loc));
    }
    this.checkExtensionElements(parsed, entity);
    return entity;
  }

  private abstract(parsed: ParsedEntity): EntityModel | undefined {
    const { ast, file } = parsed;
    const fields: FieldModel[] = [];
    for (const element of ast.elements) {
      const declared = element.declaredType ?? "";
      const type = parseBuiltInType(declared) ?? this.dictionary.dataElement(declared)?.type;
      if (type === undefined) {
        this.diagnostics.error("CDS014", `${ast.name}.${element.name}: unknown type ${declared}`, this.loc(file, element.loc));
        continue;
      }
      fields.push(this.fieldFromElement(parsed, element, type, undefined));
    }
    return {
      name: ast.name,
      kind: "abstract",
      root: ast.root,
      fields,
      associations: [],
      annotations: this.entityAnnotations(parsed),
      src: this.loc(file, ast.loc),
    };
  }
}

function withoutLayer(annotations: Annotations): Annotations {
  const copy = mergeAnnotations(annotations);
  const metadata = copy["metadata"];
  if (typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)) {
    delete metadata["layer"];
    if (Object.keys(metadata).length === 0) {
      delete copy["metadata"];
    }
  }
  return copy;
}

/** Element annotations propagate from the projected entity unless the projection opts out. */
function propagated(ast: CdsEntityAst, annotations: Annotations): Annotations | undefined {
  return getAnnotation(ast.annotations, "Metadata.ignorePropagatedAnnotations") === true ? undefined : annotations;
}

/** The name under which a projection exposes an element of its base. */
function projectedName(ast: CdsEntityAst, baseName: string): string {
  const element = ast.elements.find((e) => e.path?.length === 1 && (e.path[0] ?? "").toUpperCase() === baseName.toUpperCase());
  return element?.name ?? baseName;
}
