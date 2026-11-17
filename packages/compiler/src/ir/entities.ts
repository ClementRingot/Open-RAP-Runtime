/** CDS view entities, projections and abstract entities → IR entities. */

import {
  getAnnotation,
  getString,
  mergeAnnotations,
  same,
  setAnnotation,
  sqlName,
  type AbapType,
  type AdminSemantics,
  type Annotations,
  type AssociationModel,
  type CdsCondition,
  type CdsExpression,
  type ColumnModel,
  type EntityModel,
  type FieldModel,
  type TableModel,
} from "@open-rap/model";
import { parseCds, type CdsElementAst, type CdsEntityAst, type CdsMetadataExtensionAst } from "../cds/adapter.js";
import { parseBuiltInType } from "../ddic/catalog.js";
import type { Diagnostics } from "../diagnostics.js";
import { filesOfType, type Project, type SourceFile } from "../input/project.js";
import type { Dictionary } from "./dictionary.js";
import { ExpressionIssue, resolveCondition, resolveExpression, type ExpressionScope } from "./expressions.js";

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

  /** Names of the table entities of the project (D55). */
  public tableEntityNames(): string[] {
    return [...this.parsed.values()].filter((p) => p.ast.kind === "table").map((p) => p.ast.name);
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
      case "table":
        entity = this.tableEntity(parsed);
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
  // calculated elements (D67)

  /** The fields in the order of the select list: the plain ones, and the calculated elements resolved. */
  private withCalculatedFields(
    parsed: ParsedEntity,
    slots: Array<FieldModel | CdsElementAst>,
    scope: Omit<ExpressionScope, "element" | "dictionary">,
  ): FieldModel[] {
    const done = new Map<CdsElementAst, FieldModel | undefined>();
    const active = new Set<CdsElementAst>();
    const isPlain = (slot: FieldModel | CdsElementAst): slot is FieldModel => "type" in slot;
    const resolve = (element: CdsElementAst): FieldModel | undefined => {
      if (done.has(element)) {
        return done.get(element);
      }
      if (active.has(element)) {
        throw new ExpressionIssue("CDS022", `circular reference through $projection.${element.name}`);
      }
      active.add(element);
      try {
        const field = this.calculatedField(parsed, element, { ...scope, dictionary: this.dictionary, element: elementOf });
        done.set(element, field);
        return field;
      } finally {
        active.delete(element);
      }
    };
    const elementOf = (name: string): { name: string; type: AbapType } | undefined => {
      const slot = slots.find((s) => s.name.toUpperCase() === name.toUpperCase());
      if (slot === undefined) {
        return undefined;
      }
      const field = isPlain(slot) ? slot : resolve(slot);
      if (field === undefined) {
        throw new ExpressionIssue("CDS022", `$projection.${name} is not a valid element`);
      }
      return { name: field.name, type: field.type };
    };
    return slots.flatMap((slot) => {
      if (isPlain(slot)) {
        return [slot];
      }
      const field = resolve(slot);
      return field === undefined ? [] : [field];
    });
  }

  private calculatedField(parsed: ParsedEntity, element: CdsElementAst, scope: ExpressionScope): FieldModel | undefined {
    const { ast, file } = parsed;
    const where = this.loc(file, element.loc);
    const label = `${ast.name}.${element.name || "?"}`;
    if (element.expr === undefined) {
      this.diagnostics.error("CDS002", `${label}: ${element.expressionError ?? "this expression"} is not supported yet`, where);
      return undefined;
    }
    try {
      if (element.name === "") {
        throw new ExpressionIssue("CDS022", "a calculated element needs a name (AS alias)");
      }
      const expression = resolveExpression(element.expr, scope);
      // D104: a column of a joined data source may be a key element
      if (element.key && !(expression.kind === "column" && expression.source !== undefined)) {
        throw new ExpressionIssue("CDS022", "a calculated element cannot be a key element");
      }
      const field = this.fieldFromElement(parsed, element, expression.type, undefined);
      field.expression = expression;
      // D100: an element of an association keeps the label of the element it reaches
      if (expression.kind === "path" && getAnnotation(field.annotations, "EndUserText.label") === undefined) {
        const label = this.pathLabels.get(expression.associations.concat(expression.element).join(".").toUpperCase());
        if (label !== undefined) setAnnotation(field.annotations, "EndUserText.label", label);
      }
      return field;
    } catch (error) {
      if (!(error instanceof ExpressionIssue)) {
        throw error;
      }
      this.diagnostics.error(error.code, `${label}: ${error.message}`, where);
      return undefined;
    }
  }

  // -------------------------------------------------------------------------------------------
  // view entities

  private view(parsed: ParsedEntity): EntityModel | undefined {
    const { ast, file } = parsed;
    if (ast.source === undefined) {
      this.diagnostics.error("CDS003", `${ast.name}: no data source`, this.loc(file, ast.loc));
      return undefined;
    }
    // D104: the joined data sources, by alias
    const joined = new Map<string, { kind: "inner" | "left" | "right" | "cross"; alias: string; table?: TableModel; entity?: EntityModel; ast: NonNullable<CdsEntityAst["joins"]>[number] }>();
    for (const join of ast.joins ?? []) {
      if (join.kind === "right" || join.kind === "cross") {
        this.diagnostics.error("CDS002", `${ast.name}: ${join.kind === "right" ? "right outer" : "cross"} joins are not supported yet (inner and left outer joins are)`, this.loc(file, join.loc));
        continue;
      }
      if (join.error !== undefined) {
        this.diagnostics.error("CDS002", `${ast.name}: ON condition of the join of ${join.source}: ${join.error} is not supported yet`, this.loc(file, join.loc));
        continue;
      }
      if (this.parsed.get(join.source.toUpperCase())?.ast.kind === "table") {
        this.resolve(join.source);
      }
      const joinTable = this.dictionary.table(join.source);
      const joinEntity = joinTable === undefined ? this.resolve(join.source) : undefined;
      if (joinTable === undefined && joinEntity === undefined) {
        this.diagnostics.error("CDS003", `${ast.name}: unknown joined data source ${join.source} (no TABL or DDLS in the sources)`, this.loc(file, join.loc));
        continue;
      }
      const alias = join.alias ?? join.source;
      joined.set(alias.toUpperCase(), { kind: join.kind, alias, ...(joinTable === undefined ? {} : { table: joinTable }), ...(joinEntity === undefined ? {} : { entity: joinEntity }), ast: join });
    }
    const joinedColumn = (alias: string, name: string): { name: string; type: AbapType } | undefined => {
      const source = joined.get(alias.toUpperCase());
      if (source?.table !== undefined) {
        const column = source.table.columns.find((c) => c.name === name.toLowerCase() && !c.client);
        return column === undefined ? undefined : { name: column.name, type: column.type };
      }
      const field = source?.entity?.fields.find((f) => same(f.name, name) && f.draft !== true);
      return field === undefined ? undefined : { name: field.name, type: field.type };
    };
    if (ast.hasWhere && ast.where === undefined) {
      this.diagnostics.error("CDS002", `${ast.name}: ${ast.whereError ?? "this WHERE condition"} is not supported yet`, this.loc(file, ast.whereLoc ?? ast.loc));
    }
    if (this.parsed.get(ast.source.toUpperCase())?.ast.kind === "table") {
      this.resolve(ast.source); // a table entity is read as its table (D55)
    }
    const table = this.dictionary.table(ast.source);
    const sourceEntity = table === undefined ? this.resolve(ast.source) : undefined;
    if (table === undefined && sourceEntity === undefined) {
      this.diagnostics.error("CDS003", `${ast.name}: unknown data source ${ast.source} (no TABL or DDLS in the sources)`, this.loc(file, ast.loc));
      return undefined;
    }
    const associationNames = new Set(ast.associations.map((a) => a.alias.toUpperCase()));
    const slots: Array<FieldModel | CdsElementAst> = [];
    for (const element of ast.elements) {
      if (element.path === undefined) {
        slots.push(element); // a calculated element (D67), resolved once the plain ones are known
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
      if (path.length > 1 && associationNames.has((path[0] ?? "").toUpperCase())) {
        // D100: an element reached through to-one associations, read-only like a calculated element
        slots.push(asPathElement(element, path));
        continue;
      }
      // D104: a column of a joined data source, read-only like a calculated element
      if (path.length === 2 && joined.has((path[0] ?? "").toUpperCase())) {
        slots.push(asPathElement(element, path));
        continue;
      }
      if (path.length === 1 && joined.size > 0 && (table !== undefined ? !table.columns.some((c) => c.name === (path[0] ?? "").toLowerCase()) : !sourceEntity?.fields.some((f) => same(f.name, path[0] ?? "")))) {
        const owners = [...joined.values()].filter((j) => joinedColumn(j.alias, path[0] ?? "") !== undefined);
        if (owners.length === 1) {
          slots.push(asPathElement(element, [(owners[0] as { alias: string }).alias, path[0] ?? ""]));
          continue;
        }
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
        slots.push(field);
      } else if (sourceEntity !== undefined) {
        const base = sourceEntity.fields.find((f) => f.name.toUpperCase() === sourceName.toUpperCase());
        if (base === undefined) {
          this.diagnostics.error("CDS004", `${ast.name}.${element.name}: ${sourceEntity.name} has no element ${sourceName}`, this.loc(file, element.loc));
          continue;
        }
        const field = this.fieldFromElement(parsed, element, base.type, propagated(ast, base.annotations));
        field.baseField = base.name;
        slots.push(field);
      }
    }
    const scope: Omit<ExpressionScope, "element" | "dictionary"> = {
      sourceName: table?.name ?? sourceEntity?.name ?? ast.source,
      sourcePrefixes: [ast.source, ...(ast.sourceAlias === undefined ? [] : [ast.sourceAlias])],
      associations: associationNames,
      associationPath: (path) => this.associationPath(ast.associations.map((a) => ({ name: a.alias, target: a.target, cardinality: a.cardinality })), "self", path),
      joined: joinedColumn,
      column: (name) => {
        if (table !== undefined) {
          const column = table.columns.find((c) => c.name === name.toLowerCase() && !c.client);
          return column === undefined ? undefined : { name: column.name, type: column.type };
        }
        const base = sourceEntity?.fields.find((f) => f.name.toUpperCase() === name.toUpperCase() && f.draft !== true);
        return base === undefined ? undefined : { name: base.name, type: base.type };
      },
    };
    const fields = this.withCalculatedFields(parsed, slots, scope);
    if (table !== undefined) {
      this.addDataElementLabels(fields, table.name);
    }
    // D104: the ON conditions of the joins, on the columns of the joined sources
    let joins: EntityModel["joins"];
    if (joined.size > 0) {
      joins = { alias: ast.sourceAlias ?? ast.source, sources: [] };
      for (const source of joined.values()) {
        try {
          const on = source.ast.on === undefined ? undefined : resolveCondition(source.ast.on, { ...scope, dictionary: this.dictionary, element: () => undefined });
          joins.sources.push({
            kind: source.kind as "inner" | "left",
            alias: source.alias,
            ...(source.table === undefined ? {} : { table: source.table.name }),
            ...(source.entity === undefined ? {} : { entity: source.entity.name }),
            ...(on === undefined ? {} : { on }),
          });
        } catch (error) {
          if (!(error instanceof ExpressionIssue)) throw error;
          this.diagnostics.error(error.code, `${ast.name}: ON condition of the join of ${source.ast.source}: ${error.message}`, this.loc(file, source.ast.loc));
        }
      }
    }
    // D101: the WHERE condition, on the columns of the source, its associations and $projection
    let where: CdsCondition | undefined;
    if (ast.where !== undefined) {
      try {
        where = resolveCondition(ast.where, {
          ...scope,
          dictionary: this.dictionary,
          element: (name) => {
            const field = fields.find((f) => same(f.name, name));
            return field === undefined ? undefined : { name: field.name, type: field.type };
          },
        });
      } catch (error) {
        if (!(error instanceof ExpressionIssue)) throw error;
        this.diagnostics.error(error.code, `${ast.name}: WHERE: ${error.message}`, this.loc(file, ast.whereLoc ?? ast.loc));
      }
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
      ...(where === undefined ? {} : { where }),
      ...(joins === undefined ? {} : { joins }),
      ...this.grouping(parsed, fields, scope),
    };
    entity.associations = this.associationsOf(parsed, entity);
    if (fields.filter((f) => f.key).length === 0) {
      this.diagnostics.error("CDS011", `${ast.name}: no key element`, this.loc(file, ast.loc));
    }
    this.checkExtensionElements(parsed, entity);
    return entity;
  }

  /**
   * D105: the GROUP BY and HAVING of a view entity with aggregate expressions, checked as SAP does:
   * the aggregates need a GROUP BY, which lists every field the select list does not aggregate.
   */
  private grouping(parsed: ParsedEntity, fields: FieldModel[], scope: Omit<ExpressionScope, "element" | "dictionary">): Pick<EntityModel, "groupBy" | "having"> {
    const { ast, file } = parsed;
    const where = this.loc(file, ast.loc);
    const full: ExpressionScope = {
      ...scope,
      dictionary: this.dictionary,
      element: (name) => {
        const field = fields.find((f) => same(f.name, name));
        return field === undefined ? undefined : { name: field.name, type: field.type };
      },
    };
    const aggregated = fields.some((f) => f.expression !== undefined && containsAggregate(f.expression));
    if (ast.havingError !== undefined) {
      this.diagnostics.error("CDS002", `${ast.name}: HAVING: ${ast.havingError} is not supported yet`, where);
    }
    if (ast.groupBy === undefined) {
      if (aggregated) this.diagnostics.error("CDS022", `${ast.name}: aggregate expressions need a GROUP BY clause listing the other elements`, where);
      if (ast.having !== undefined) this.diagnostics.error("CDS022", `${ast.name}: HAVING needs a GROUP BY clause`, where);
      return {};
    }
    const groupBy: CdsExpression[] = [];
    for (const path of ast.groupBy) {
      try {
        groupBy.push(resolveExpression({ kind: "path", path }, full));
      } catch (error) {
        if (!(error instanceof ExpressionIssue)) throw error;
        this.diagnostics.error(error.code, `${ast.name}: GROUP BY: ${error.message}`, where);
      }
    }
    // every column outside the aggregates is grouped
    const grouped = new Set(groupBy.flatMap((g) => columnsOf(g, false)));
    for (const field of fields.filter((f) => f.draft !== true)) {
      const columns = field.expression === undefined ? [`.${(field.column ?? field.baseField ?? field.name).toLowerCase()}`] : columnsOf(field.expression, true);
      const missing = columns.filter((c) => !grouped.has(c));
      if (missing.length > 0) {
        this.diagnostics.error("CDS022", `${ast.name}.${field.name}: not aggregated, so listed in GROUP BY (${missing.map((c) => c.replace(/^\./, "")).join(", ")})`, where);
      }
    }
    let having: CdsCondition | undefined;
    if (ast.having !== undefined) {
      try {
        having = resolveCondition(ast.having, full);
      } catch (error) {
        if (!(error instanceof ExpressionIssue)) throw error;
        this.diagnostics.error(error.code, `${ast.name}: HAVING: ${error.message}`, where);
      }
    }
    return { groupBy, ...(having === undefined ? {} : { having }) };
  }

  /** The labels of the elements reached by the paths (D100), by path in upper case. */
  private readonly pathLabels = new Map<string, string>();

  /**
   * D100: the element a path reaches through to-one associations, from the associations of the
   * entity (a view) or of its source (a projection).
   */
  private associationPath(
    start: Array<{ name: string; target: string; cardinality: { min: number; max: number | "*" } }>,
    from: "self" | "source",
    path: string[],
  ): { from: "self" | "source"; element: string; type: AbapType } {
    let associations = start;
    let target: EntityModel | undefined;
    for (const name of path.slice(0, -1)) {
      const association = associations.find((a) => same(a.name, name));
      if (association === undefined) {
        throw new ExpressionIssue("CDS004", `${path.join(".")}: no association ${name}`);
      }
      if (association.cardinality.max === "*" || association.cardinality.max > 1) {
        throw new ExpressionIssue("CDS002", `${path.join(".")}: ${name} is a to-many association: a path in the select list needs one value per instance`);
      }
      target = this.resolve(association.target);
      if (target === undefined) {
        throw new ExpressionIssue("CDS004", `${path.join(".")}: unknown target entity ${association.target}`);
      }
      associations = target.associations;
    }
    const last = path[path.length - 1] ?? "";
    const field = target?.fields.find((f) => same(f.name, last) && f.draft !== true);
    if (target === undefined || field === undefined) {
      throw new ExpressionIssue("CDS004", `${path.join(".")}: ${target?.name ?? "the target"} has no element ${last}`);
    }
    const label = getAnnotation(field.annotations, "EndUserText.label");
    if (typeof label === "string") this.pathLabels.set(path.join(".").toUpperCase(), label);
    return { from, element: field.name, type: field.type };
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
    if (ast.hasWhere && ast.where === undefined) {
      this.diagnostics.error("CDS002", `${ast.name}: ${ast.whereError ?? "this WHERE condition"} is not supported yet`, this.loc(file, ast.whereLoc ?? ast.loc));
    }
    const base = ast.source === undefined ? undefined : this.resolve(ast.source);
    if (base === undefined) {
      this.diagnostics.error("CDS003", `${ast.name}: unknown projected entity ${ast.source ?? ""}`, this.loc(file, ast.loc));
      return undefined;
    }
    const fields: FieldModel[] = [];
    const slots: Array<FieldModel | CdsElementAst> = [];
    const associations: AssociationModel[] = [];
    for (const element of ast.elements) {
      const source = element.path?.join(".") ?? "";
      if (element.path === undefined) {
        slots.push(element); // a calculated element (D67)
        continue;
      }
      if (element.path.length > 1 && base.associations.some((a) => same(a.name, element.path?.[0] ?? ""))) {
        // D100: an element reached through to-one associations of the projected entity
        slots.push(asPathElement(element, element.path));
        continue;
      }
      if (element.path.length !== 1) {
        this.diagnostics.error(
          "CDS002",
          `${ast.name}.${element.name || "?"}: path expressions (${source}) are not supported here: only elements of the projected entity and paths through its associations can be projected`,
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
      slots.push(field);
    }
    const scope: Omit<ExpressionScope, "element" | "dictionary"> = {
        sourceName: base.name,
        sourcePrefixes: [base.name, ...(ast.sourceAlias === undefined ? [] : [ast.sourceAlias])],
        associations: new Set(base.associations.map((a) => a.name.toUpperCase())),
        associationPath: (path) => this.associationPath(base.associations, "source", path),
        column: (name) => {
          const baseField = base.fields.find((f) => f.name.toUpperCase() === name.toUpperCase() && f.draft !== true);
          return baseField === undefined ? undefined : { name: baseField.name, type: baseField.type };
        },
      };
    fields.push(...this.withCalculatedFields(parsed, slots, scope));
    // D102: the WHERE condition of a projection, on the elements of the projected entity
    let where: CdsCondition | undefined;
    if (ast.where !== undefined) {
      try {
        where = resolveCondition(ast.where, {
          ...scope,
          dictionary: this.dictionary,
          element: (name) => {
            const field = fields.find((f) => same(f.name, name));
            return field === undefined ? undefined : { name: field.name, type: field.type };
          },
        });
      } catch (error) {
        if (!(error instanceof ExpressionIssue)) throw error;
        this.diagnostics.error(error.code, `${ast.name}: WHERE: ${error.message}`, this.loc(file, ast.whereLoc ?? ast.loc));
      }
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
      ...(where === undefined ? {} : { where }),
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
  // table entities (D55)

  /**
   * A table entity: a table of the same name, whose columns are the elements in lower case, and
   * a view entity on it. Its elements are typed with built-in types, data elements, CDS simple
   * types or CDS enumerated types.
   */
  private tableEntity(parsed: ParsedEntity): EntityModel | undefined {
    const { ast, file } = parsed;
    if (ast.name.length > 25) {
      this.diagnostics.error("CDS019", `${ast.name}: the name of a table entity has at most 25 characters`, this.loc(file, ast.loc));
    }
    const columns: ColumnModel[] = [];
    const fields: FieldModel[] = [];
    let keysDone = false;
    for (const element of ast.elements) {
      const declared = element.declaredType ?? "";
      const type = parseBuiltInType(declared) ?? this.dictionary.dataElement(declared)?.type;
      if (type === undefined) {
        this.diagnostics.error("CDS014", `${ast.name}.${element.name}: unknown type ${declared}`, this.loc(file, element.loc));
        continue;
      }
      if (element.key && keysDone) {
        this.diagnostics.error("CDS020", `${ast.name}.${element.name}: the key elements come first, without gaps`, this.loc(file, element.loc));
      }
      keysDone ||= !element.key;
      if (element.key && element.nullable === true) {
        this.diagnostics.error("CDS020", `${ast.name}.${element.name}: a key element cannot be null`, this.loc(file, element.loc));
      }
      if ((type.kind === "string" || type.kind === "rawstring") && element.nullable !== true) {
        this.diagnostics.error("CDS020", `${ast.name}.${element.name}: an element of type ${type.kind} is declared null (no default value on the database)`, this.loc(file, element.loc));
      }
      const column: ColumnModel = { name: element.name.toLowerCase(), type: { ...type }, key: element.key, notNull: element.nullable !== true, client: false };
      columns.push(column);
      const field = this.fieldFromElement(parsed, element, type, undefined);
      field.column = column.name;
      fields.push(field);
    }
    const table: TableModel = { name: sqlName(ast.name), columns, src: this.loc(file, ast.loc) };
    const label = getString(ast.annotations, "EndUserText.label");
    if (label !== undefined) {
      table.description = label;
    }
    this.dictionary.registerEntityTable(table);
    this.addDataElementLabels(fields, table.name);
    const entity: EntityModel = {
      name: ast.name,
      kind: "view",
      tableEntity: true,
      root: ast.root,
      source: table.name,
      sqlView: `${sqlName(ast.name)}_entity`,
      fields,
      associations: [],
      annotations: this.entityAnnotations(parsed),
      src: this.loc(file, ast.loc),
    };
    entity.associations = this.associationsOf(parsed, entity);
    if (fields.filter((f) => f.key).length === 0 && entity.associations.length > 0) {
      this.diagnostics.error("CDS011", `${ast.name}: a table entity with associations needs key elements`, this.loc(file, ast.loc));
    }
    this.checkExtensionElements(parsed, entity);
    return entity;
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

/** D100: a path element (`_Agency.Name`) as a calculated element, resolved by the expressions. */
function asPathElement(element: CdsElementAst, path: string[]): CdsElementAst {
  const { path: _path, ...rest } = element;
  return { ...rest, expr: { kind: "path", path } };
}

/** D105: whether an expression contains an aggregate. */
function containsAggregate(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  if ((e as { kind?: string }).kind === "aggregate") return true;
  return Object.values(e).some((v) => (Array.isArray(v) ? v.some(containsAggregate) : containsAggregate(v)));
}

/** D105: the columns an expression reads (`source.name`), outside its aggregates when `outside`. */
function columnsOf(e: unknown, outside: boolean): string[] {
  if (typeof e !== "object" || e === null) return [];
  const node = e as { kind?: string; name?: string; source?: string };
  if (node.kind === "aggregate" && outside) return [];
  if (node.kind === "column") return [`${node.source ?? ""}.${(node.name ?? "").toLowerCase()}`];
  return Object.values(e).flatMap((v) => (Array.isArray(v) ? v.flatMap((x) => columnsOf(x, outside)) : columnsOf(v, outside)));
}
