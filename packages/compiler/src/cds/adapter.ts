/**
 * Adapter over the CDS parser of abaplint (PLAN.md, V1): turns its expression tree into a small
 * typed AST for view entities, projections, abstract entities and metadata extensions.
 */

import * as abaplint from "@abaplint/core";
import { getString, setAnnotation, type AnnotationObject, type AnnotationValue, type Annotations } from "@open-rap/model";
import { CdsExpressionError, parseCdsCondition, parseCdsExpression, type CdsCondAst, type CdsExprAst } from "./expression-ast.js";

type Node = abaplint.INode;
const E = abaplint.ExpressionsCDS;

export interface CdsLoc {
  line: number;
  column: number;
}

export interface CdsElementAst {
  /** Alias, or the last segment of the path. */
  name: string;
  key: boolean;
  /** Source path: `travel_uuid`, `_Travel.TravelID`… Undefined for expressions. */
  path?: string[];
  /** Text of an expression that is not a plain path (CAST, CASE, literal…). */
  expression?: string;
  /** The parsed expression (D67); undefined with `expressionError` when a construct is not supported. */
  expr?: CdsExprAst;
  /** The unsupported construct of `expression`. */
  expressionError?: string;
  /** `name : abap.char( 10 )` or `name : data_element` in abstract entities. */
  declaredType?: string;
  /** Table entities (D55): `name : type null`. */
  nullable?: boolean;
  /** Projections: `_X : redirected to [composition child | parent] Target`. */
  redirect?: { kind: "compositionChild" | "parent" | "plain"; target: string };
  annotations: Annotations;
  loc: CdsLoc;
}

export interface CdsAssociationAst {
  kind: "composition" | "toParent" | "association";
  target: string;
  alias: string;
  cardinality: { min: number; max: number | "*" };
  /** Equality pairs of the ON condition, each side as a path. */
  on: Array<{ left: string[]; right: string[] }>;
  loc: CdsLoc;
}

export type CdsEntityKind = "view" | "projection" | "abstract" | "custom" | "table" | "hierarchy" | "other";

/** D108: `as parent child hierarchy( … )` of a CDS hierarchy. */
export interface CdsHierarchyAst {
  source: string;
  association: string;
  directory?: { association: string; filter?: CdsCondAst; error?: string };
  start?: CdsCondAst;
  startError?: string;
  siblings: Array<{ path: string[]; descending: boolean }>;
  /** DEPTH: an integer literal or a parameter (`:p`, `$parameters.p`). */
  depth?: { value?: number; parameter?: string };
  multipleParents?: "notAllowed" | "leavesOnly" | "allowed";
  orphans?: "ignore" | "error" | "root";
  cycles?: "error" | "breakup";
  /** Additions not supported yet: PERIOD, GENERATE SPANTREE. */
  unsupported: string[];
  loc: CdsLoc;
}

export interface CdsEntityAst {
  kind: CdsEntityKind;
  /** The CDS-level kind of statement, for diagnostics: CDSDefineView… */
  statement: string;
  name: string;
  root: boolean;
  /** View entities: the data source. Projections: the projected entity. */
  source?: string;
  sourceAlias?: string;
  providerContract?: string;
  hasJoin: boolean;
  hasWhere: boolean;
  /** D104: the joins of the data source, in order. */
  joins?: CdsJoinAst[];
  /** D107: the input parameters of the entity (`with parameters`). */
  parameters?: Array<{ name: string; type: string; systemField?: string; annotations: Annotations; loc: CdsLoc }>;
  /** D107: the actual parameters passed to the data source (`select from X( p: … )`). */
  sourceParameters?: Array<{ name: string; value?: CdsExprAst; error?: string }>;
  /** D108: a CDS hierarchy. */
  hierarchy?: CdsHierarchyAst;
  /** D106: the other branches of a UNION [ALL], in order. */
  unions?: Array<{ all: boolean; branch: CdsEntityAst }>;
  /** D105: the GROUP BY paths and the HAVING condition (or the construct it could not parse). */
  groupBy?: string[][];
  having?: CdsCondAst;
  havingError?: string;
  /** D101: the condition of the WHERE clause, or the construct it could not parse. */
  where?: CdsCondAst;
  whereError?: string;
  whereLoc?: CdsLoc;
  annotations: Annotations;
  elements: CdsElementAst[];
  associations: CdsAssociationAst[];
  loc: CdsLoc;
}

/** D104: `inner join | left outer join | right outer join | cross join source [as alias] on cond`. */
export interface CdsJoinAst {
  kind: "inner" | "left" | "right" | "cross";
  source: string;
  alias?: string;
  on?: CdsCondAst;
  /** The construct of the ON condition that could not be parsed. */
  error?: string;
  loc: CdsLoc;
}

export interface CdsMetadataExtensionAst {
  entity: string;
  layer: string;
  annotations: Annotations;
  elements: Array<{ name: string; annotations: Annotations; loc: CdsLoc }>;
  loc: CdsLoc;
}

export type CdsParseResult =
  | { ok: true; entity: CdsEntityAst }
  | { ok: true; extension: CdsMetadataExtensionAst }
  | { ok: false; message: string; loc: CdsLoc };

const isExpression = (n: Node): n is abaplint.Nodes.ExpressionNode => n instanceof abaplint.Nodes.ExpressionNode;
const isToken = (n: Node): n is abaplint.Nodes.TokenNode => n instanceof abaplint.Nodes.TokenNode;
const tokenText = (n: Node): string => n.getFirstToken().getStr();

/** Parses a DDLS or DDLX source. */
export function parseCds(fileName: string, source: string): CdsParseResult {
  const lines = source.replace(/\r/g, "").split("\n");
  const tree = new abaplint.CDSParser().parse(new abaplint.MemoryFile(fileName, source));
  if (tree === undefined) {
    return { ok: false, message: "the CDS source could not be parsed (abaplint CDS parser)", loc: { line: 1, column: 1 } };
  }
  const ctx = new AdapterContext(lines);
  const statement = tree.get();
  if (statement instanceof E.CDSAnnotate) {
    return { ok: true, extension: ctx.metadataExtension(tree) };
  }
  return { ok: true, entity: ctx.entity(tree) };
}

class AdapterContext {
  public constructor(private readonly lines: string[]) {}

  /** abaplint reports the column where a CDS token ends: find where it starts. */
  public loc(node: Node): CdsLoc {
    const token = node.getFirstToken();
    const row = token.getStart().getRow();
    const col = token.getStart().getCol();
    const text = token.getStr();
    const line = this.lines[row - 1] ?? "";
    const index = line.lastIndexOf(text, Math.max(0, col - 1));
    return { line: row, column: index >= 0 ? index + 1 : Math.max(1, col - text.length) };
  }

  public entity(tree: abaplint.Nodes.ExpressionNode): CdsEntityAst {
    const statement = tree.get();
    const kind: CdsEntityKind =
      statement instanceof E.CDSDefineView
        ? "view"
        : statement instanceof E.CDSDefineProjection
          ? "projection"
          : statement instanceof E.CDSDefineAbstract
            ? "abstract"
            : statement instanceof E.CDSDefineCustom
              ? "custom"
              : statement instanceof E.CDSDefineTableEntity
                ? "table"
                : statement instanceof E.CDSDefineHierarchy
                  ? "hierarchy"
                  : "other";
    const topTokens = tree.getChildren().filter(isToken).map((t) => tokenText(t).toUpperCase());
    const names = tree.findDirectExpressions(E.CDSName);
    const nameNode = names[0];
    // the annotations of the entity are those before its body: in abstract and custom entities, the
    // annotations of the elements are direct children of the definition too
    const header: abaplint.Nodes.ExpressionNode[] = [];
    for (const child of tree.getChildren()) {
      if (isToken(child)) {
        if (tokenText(child) === "{") {
          break;
        }
        continue;
      }
      if (child.get() instanceof E.CDSAnnotation) {
        header.push(child);
      }
    }
    const entity: CdsEntityAst = {
      kind,
      statement: statement.constructor.name,
      name: nameNode ? nameNode.concatTokens() : "",
      root: topTokens.includes("ROOT"),
      hasJoin: false,
      hasWhere: false,
      annotations: this.annotations(header),
      elements: [],
      associations: [],
      loc: this.loc(nameNode ?? tree),
    };

    if (kind === "projection") {
      const base = names[1];
      if (base !== undefined) {
        entity.source = base.concatTokens();
      }
      const contract = tree.findDirectExpression(E.CDSProviderContract);
      if (contract !== undefined) {
        const parts = contract.concatTokens().split(/\s+/);
        entity.providerContract = (parts[parts.length - 1] ?? "").toLowerCase();
      }
      entity.elements = tree.findDirectExpressions(E.CDSElement).map((e) => this.element(e));
      entity.associations = this.associations(tree);
      // D102: the WHERE condition of a projection
      this.where(entity, tree.findDirectExpression(E.CDSWhere));
      return entity;
    }

    if (kind === "view") {
      // D107: the input parameters
      const withParameters = tree.findDirectExpression(E.CDSWithParameters);
      if (withParameters !== undefined) entity.parameters = this.parameterList(withParameters);
      const select = tree.findDirectExpression(E.CDSSelect);
      if (select !== undefined) {
        this.select(entity, select);
        // D106: the branches of UNION [ALL], each a nested SELECT
        let current: abaplint.Nodes.ExpressionNode | undefined = select;
        for (let depth = 0; current !== undefined && depth < 50; depth++) {
          const words = current
            .getChildren()
            .filter((c) => c instanceof abaplint.Nodes.TokenNode)
            .map((c) => c.getFirstToken().getStr().toLowerCase());
          const next = current.findDirectExpression(E.CDSSelect);
          if (next === undefined || !words.includes("union")) break;
          const branch: CdsEntityAst = { ...entity, annotations: {}, elements: [], associations: [], hasJoin: false, hasWhere: false, loc: this.loc(next) };
          for (const key of ["source", "sourceAlias", "joins", "where", "whereError", "whereLoc", "groupBy", "having", "havingError", "unions"] as const) delete branch[key];
          this.select(branch, next);
          (entity.unions ??= []).push({ all: words.includes("all"), branch });
          current = next;
        }
      }
      return entity;
    }

    if (kind === "hierarchy") {
      const withParameters = tree.findDirectExpression(E.CDSWithParameters);
      if (withParameters !== undefined) entity.parameters = this.parameterList(withParameters);
      this.hierarchy(entity, tree);
      return entity;
    }

    // abstract, custom and table entities: `[key] name : type [null];`, `_Assoc : association … ;`
    const typed = this.typedElements(tree);
    entity.elements = typed.elements;
    entity.associations = typed.associations;
    return entity;
  }

  /**
   * D108: the definition of a CDS hierarchy: the additions in parentheses, read in order, and the
   * element list (`[key] path [as alias]`, `$node.attribute as alias`, associations).
   */
  private hierarchy(entity: CdsEntityAst, tree: abaplint.Nodes.ExpressionNode): void {
    const children = tree.getChildren();
    const open = children.findIndex((c) => isToken(c) && tokenText(c) === "(");
    const brace = children.findIndex((c) => isToken(c) && tokenText(c) === "{");
    const additions = children.slice(open + 1, brace);
    const word = (i: number): string => {
      const c = additions[i];
      return c !== undefined && isToken(c) ? tokenText(c).toLowerCase() : "";
    };
    const hierarchy: CdsHierarchyAst = { source: "", association: "", siblings: [], unsupported: [], loc: this.loc(tree) };
    const condition = (node: Node | undefined): { cond?: CdsCondAst; error?: string } => {
      if (node === undefined || !isExpression(node)) return { error: "a missing condition" };
      try {
        return { cond: parseCdsCondition(node) };
      } catch (error) {
        if (!(error instanceof CdsExpressionError)) throw error;
        return { error: error.message };
      }
    };
    for (let i = 0; i < additions.length; i++) {
      const w = word(i);
      const next = additions[i + 1];
      if (w === "source" && next !== undefined && isExpression(next)) {
        hierarchy.source = next.concatTokens().replace(/\s+/g, "");
        i++;
      } else if (w === "association" && next !== undefined && isExpression(next)) {
        hierarchy.association = next.concatTokens();
        i++;
      } else if (w === "directory" && next !== undefined && isExpression(next)) {
        // DIRECTORY _assoc FILTER BY cond
        const result = condition(additions[i + 4]);
        hierarchy.directory = { association: next.concatTokens(), ...(result.cond === undefined ? {} : { filter: result.cond }), ...(result.error === undefined ? {} : { error: result.error }) };
        i += 4;
      } else if (w === "start" && word(i + 1) === "where") {
        const result = condition(additions[i + 2]);
        if (result.cond !== undefined) hierarchy.start = result.cond;
        if (result.error !== undefined) hierarchy.startError = result.error;
        i += 2;
      } else if (w === "siblings" && word(i + 1) === "order" && word(i + 2) === "by") {
        let j = i + 3;
        for (; j < additions.length; j++) {
          const item = additions[j];
          if (item !== undefined && isExpression(item) && item.get() instanceof E.CDSPrefixedName) {
            const descending = word(j + 1) === "descending";
            hierarchy.siblings.push({ path: this.path(item), descending });
            if (word(j + 1) === "ascending" || descending) j++;
            if (word(j + 1) !== ",") break;
            j++;
          } else {
            break;
          }
        }
        i = j;
      } else if (w === "depth" && next !== undefined) {
        const text = next.concatTokens().replace(/\s+/g, "");
        if (/^-?\d+$/.test(text)) hierarchy.depth = { value: Number.parseInt(text, 10) };
        else hierarchy.depth = { parameter: text.replace(/^:/, "").replace(/^\$parameters\./i, "") };
        i++;
      } else if (w === "multiple" && word(i + 1) === "parents") {
        if (word(i + 2) === "not") {
          hierarchy.multipleParents = "notAllowed";
          i += 3;
        } else if (word(i + 2) === "leaves") {
          hierarchy.multipleParents = "leavesOnly";
          i += word(i + 3) === "only" ? 3 : 2;
        } else {
          hierarchy.multipleParents = "allowed";
          i += 2;
        }
      } else if (w === "orphans") {
        const value = word(i + 1);
        hierarchy.orphans = value === "root" ? "root" : value === "error" ? "error" : "ignore";
        i++;
      } else if (w === "cycles") {
        hierarchy.cycles = word(i + 1) === "breakup" ? "breakup" : "error";
        i++;
      } else if (w === "period") {
        hierarchy.unsupported.push("PERIOD");
      } else if (w === "generate") {
        hierarchy.unsupported.push("GENERATE SPANTREE");
      }
      // LOAD, CACHE and NODETYPE only tune the database or inform analytical engines
    }
    entity.source = hierarchy.source;
    entity.hierarchy = hierarchy;
    // the element list
    let annotations: abaplint.Nodes.ExpressionNode[] = [];
    let key = false;
    for (let i = brace + 1; i < children.length; i++) {
      const child = children[i];
      if (child === undefined) continue;
      if (isToken(child)) {
        if (tokenText(child).toLowerCase() === "key") key = true;
        continue;
      }
      if (child.get() instanceof E.CDSAnnotation) {
        annotations.push(child);
        continue;
      }
      if (child.get() instanceof E.CDSPrefixedName) {
        const path = this.path(child);
        const as = children[i + 1];
        const alias = as !== undefined && isExpression(as) && as.get() instanceof E.CDSAs ? as.findDirectExpression(E.CDSName)?.concatTokens() : undefined;
        entity.elements.push({ name: alias ?? path[path.length - 1] ?? "", key, path, annotations: this.annotations(annotations), loc: this.loc(child) });
        annotations = [];
        key = false;
      }
    }
  }

  private associations(parent: abaplint.Nodes.ExpressionNode): CdsAssociationAst[] {
    const result: CdsAssociationAst[] = [];
    for (const child of parent.getChildren()) {
      const association = isExpression(child) ? this.association(child) : undefined;
      if (association !== undefined) {
        result.push(association);
      }
    }
    return result;
  }

  /** An association or composition node; `name` for those of custom and abstract entities (`_X : association …`). */
  private association(child: abaplint.Nodes.ExpressionNode, name?: string): CdsAssociationAst | undefined {
    const isComposition = child.get() instanceof E.CDSComposition;
    if (!isComposition && !(child.get() instanceof E.CDSAssociation)) {
      return undefined;
    }
    const tokens = child.getChildren().filter(isToken).map((t) => tokenText(t).toUpperCase());
    const relation = child.findDirectExpression(E.CDSRelation);
    const target = relation?.getFirstToken().getStr() ?? "";
    const alias = name ?? relation?.findDirectExpression(E.CDSAs)?.findDirectExpression(E.CDSName)?.concatTokens() ?? target;
    const kind: CdsAssociationAst["kind"] = isComposition ? "composition" : tokens.includes("PARENT") ? "toParent" : "association";
    return {
      kind,
      target,
      alias,
      cardinality: this.cardinality(child, kind),
      on: this.onCondition(child.findDirectExpression(E.CDSCondition)),
      loc: this.loc(child),
    };
  }

  /** D107: the actual parameters `( name: value, … )` of a data source. */
  private actualParameters(node: abaplint.Nodes.ExpressionNode): NonNullable<CdsEntityAst["sourceParameters"]> {
    const result: NonNullable<CdsEntityAst["sourceParameters"]> = [];
    const children = node.getChildren();
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!(child instanceof abaplint.Nodes.ExpressionNode) || !(child.get() instanceof E.CDSName) || children[i + 1]?.getFirstToken().getStr() !== ":") continue;
      // the value: the nodes up to the next comma or the closing parenthesis
      const value: abaplint.Nodes.ExpressionNode[] = [];
      let j = i + 2;
      const names: string[] = [];
      for (; j < children.length; j++) {
        const next = children[j];
        const token = next?.getFirstToken().getStr();
        if (next instanceof abaplint.Nodes.TokenNode && (token === "," || token === ")")) break;
        if (next instanceof abaplint.Nodes.ExpressionNode) {
          value.push(next.get() instanceof E.CDSFunctionInput ? ((next.getChildren().find((c) => c instanceof abaplint.Nodes.ExpressionNode) as abaplint.Nodes.ExpressionNode | undefined) ?? next) : next);
          if (next.get() instanceof E.CDSName) names.push(next.concatTokens());
        }
      }
      const name = child.concatTokens();
      if (names.length === value.length && names.length > 0) {
        result.push({ name, value: { kind: "path", path: names } });
      } else if (value.length === 1 && value[0] !== undefined) {
        try {
          result.push({ name, value: parseCdsExpression(value[0]) });
        } catch (error) {
          if (!(error instanceof CdsExpressionError)) throw error;
          result.push({ name, error: error.message });
        }
      } else {
        result.push({ name, error: "this actual parameter" });
      }
      i = j;
    }
    return result;
  }

  /** D107: the input parameters of `with parameters`, with their annotations. */
  private parameterList(node: abaplint.Nodes.ExpressionNode): NonNullable<CdsEntityAst["parameters"]> {
    const result: NonNullable<CdsEntityAst["parameters"]> = [];
    let annotations: abaplint.Nodes.ExpressionNode[] = [];
    const children = node.getChildren();
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!(child instanceof abaplint.Nodes.ExpressionNode)) continue;
      if (child.get() instanceof E.CDSAnnotation) {
        annotations.push(child);
        continue;
      }
      if (child.get() instanceof E.CDSName && children[i + 1]?.getFirstToken().getStr() === ":") {
        const type = children.slice(i + 2).find((c): c is abaplint.Nodes.ExpressionNode => c instanceof abaplint.Nodes.ExpressionNode && c.get() instanceof E.CDSType);
        const parameter: NonNullable<CdsEntityAst["parameters"]>[number] = { name: child.concatTokens(), type: type?.concatTokens().replace(/\s+/g, "") ?? "", annotations: this.annotations(annotations), loc: this.loc(child) };
        const field = getString(parameter.annotations, "Environment.systemField");
        if (field !== undefined) parameter.systemField = field.replace(/^#/, "").toLowerCase();
        result.push(parameter);
        annotations = [];
      }
    }
    return result;
  }

  /** The data source, joins, conditions, grouping, associations and elements of a SELECT. */
  private select(entity: CdsEntityAst, select: abaplint.Nodes.ExpressionNode): void {
    const source = select.findDirectExpression(E.CDSSource);
    if (source !== undefined) {
      const prefixed = source.findDirectExpression(E.CDSPrefixedName);
      // D107: the name of the data source, without its actual parameters (abaplint reads
      // `View( p: 'X' )` as a function call, `View( p: $parameters.q )` as a name with parameters)
      const parameters = prefixed?.findDirectExpression(E.CDSParametersSelect);
      const call = prefixed === undefined ? source.findDirectExpression(E.CDSFunction) : undefined;
      entity.source = (
        call !== undefined
          ? call.getFirstToken().getStr()
          : parameters === undefined
            ? (prefixed ?? source).concatTokens()
            : (prefixed?.findDirectExpression(E.CDSName)?.concatTokens() ?? "")
      ).replace(/\s+/g, "");
      if (parameters !== undefined) entity.sourceParameters = this.actualParameters(parameters);
      if (call !== undefined) entity.sourceParameters = this.actualParameters(call);
      const as = source.findDirectExpression(E.CDSAs);
      if (as !== undefined) {
        entity.sourceAlias = as.findDirectExpression(E.CDSName)?.concatTokens() ?? "";
      }
    }
    entity.hasJoin = select.findDirectExpressions(E.CDSJoin).length > 0;
    entity.joins = select.findDirectExpressions(E.CDSJoin).map((j) => this.join(j));
    this.where(entity, select.findDirectExpression(E.CDSWhere));
    // D105: GROUP BY and HAVING
    const groupBy = select.findDirectExpression(E.CDSGroupBy);
    if (groupBy !== undefined) {
      entity.groupBy = groupBy.findDirectExpressions(E.CDSPrefixedName).map((p) => p.findAllExpressions(E.CDSName).map((n) => n.concatTokens()));
    }
    const having = select.findDirectExpression(E.CDSHaving);
    if (having !== undefined) {
      try {
        entity.having = parseCdsCondition(having);
      } catch (error) {
        if (!(error instanceof CdsExpressionError)) throw error;
        entity.havingError = error.message;
      }
    }
    entity.associations = this.associations(select);
    entity.elements = select.findDirectExpressions(E.CDSElement).map((e) => this.element(e));
  }

  /** D104: a join of the data source. */
  private join(node: abaplint.Nodes.ExpressionNode): CdsJoinAst {
    const words = node
      .getChildren()
      .filter((c) => c instanceof abaplint.Nodes.TokenNode)
      .map((c) => c.getFirstToken().getStr().toLowerCase());
    const kind: CdsJoinAst["kind"] = words.includes("left") ? "left" : words.includes("right") ? "right" : words.includes("cross") ? "cross" : "inner";
    const source = node.findDirectExpression(E.CDSSource);
    const prefixed = source?.findDirectExpression(E.CDSPrefixedName);
    const join: CdsJoinAst = { kind, source: (prefixed ?? source)?.concatTokens().replace(/\s+/g, "") ?? "", loc: this.loc(node) };
    const alias = source?.findDirectExpression(E.CDSAs)?.findDirectExpression(E.CDSName)?.concatTokens();
    if (alias !== undefined) join.alias = alias;
    const condition = node.findDirectExpression(E.CDSCondition);
    if (condition !== undefined) {
      try {
        join.on = parseCdsCondition(condition);
      } catch (error) {
        if (!(error instanceof CdsExpressionError)) throw error;
        join.error = error.message;
      }
    }
    return join;
  }

  /** D101: the WHERE condition of a view entity or a projection, or the construct it cannot parse. */
  private where(entity: CdsEntityAst, where: abaplint.Nodes.ExpressionNode | undefined): void {
    entity.hasWhere = where !== undefined;
    if (where === undefined) return;
    entity.whereLoc = this.loc(where);
    try {
      entity.where = parseCdsCondition(where);
    } catch (error) {
      if (!(error instanceof CdsExpressionError)) throw error;
      entity.whereError = error.message;
    }
  }

  private cardinality(node: abaplint.Nodes.ExpressionNode, kind: CdsAssociationAst["kind"]): { min: number; max: number | "*" } {
    const text = node.concatTokens().replace(/\s+/g, "");
    const match = /\[(\d+|\*)?(?:\.\.(\d+|\*))?\]/.exec(text);
    if (match === null) {
      // defaults: a to-parent association is [1..1], a composition [0..*], an association [0..1]
      return kind === "toParent" ? { min: 1, max: 1 } : kind === "composition" ? { min: 0, max: "*" } : { min: 0, max: 1 };
    }
    const parse = (v: string | undefined): number | "*" => (v === undefined || v === "*" ? "*" : Number.parseInt(v, 10));
    if (match[2] === undefined) {
      const single = parse(match[1]);
      return single === "*" ? { min: 0, max: "*" } : { min: 0, max: single };
    }
    const min = parse(match[1]);
    return { min: min === "*" ? 0 : min, max: parse(match[2]) };
  }

  private onCondition(condition: abaplint.Nodes.ExpressionNode | undefined): Array<{ left: string[]; right: string[] }> {
    if (condition === undefined) {
      return [];
    }
    const pairs: Array<{ left: string[]; right: string[] }> = [];
    const visit = (node: abaplint.Nodes.ExpressionNode): void => {
      const children = node.getChildren();
      for (let i = 0; i < children.length; i++) {
        const child = children[i] as Node;
        if (isToken(child) && tokenText(child) === "=") {
          const left = children[i - 1];
          const right = children[i + 1];
          if (left !== undefined && right !== undefined && isExpression(left) && isExpression(right)) {
            pairs.push({ left: this.path(left), right: this.path(right) });
          }
        } else if (isExpression(child) && child.get() instanceof E.CDSCondition) {
          visit(child);
        }
      }
    };
    visit(condition);
    return pairs;
  }

  private path(node: abaplint.Nodes.ExpressionNode): string[] {
    return node.findAllExpressions(E.CDSName).map((n) => n.concatTokens());
  }

  private element(node: abaplint.Nodes.ExpressionNode): CdsElementAst {
    const annotations = this.annotations(node.findDirectExpressions(E.CDSAnnotation));
    const tokens = node.getChildren().filter(isToken).map((t) => tokenText(t).toUpperCase());
    const key = tokens.includes("KEY");
    const as = node.findDirectExpression(E.CDSAs);
    const alias = as?.findDirectExpression(E.CDSName)?.concatTokens();
    const expressionNode = node.getChildren().find(
      (c): c is abaplint.Nodes.ExpressionNode =>
        isExpression(c) && !(c.get() instanceof E.CDSAnnotation) && !(c.get() instanceof E.CDSAs) && !(c.get() instanceof E.CDSName),
    );
    const element: CdsElementAst = { name: alias ?? "", key, annotations, loc: this.loc(expressionNode ?? node) };
    if (expressionNode !== undefined && expressionNode.get() instanceof E.CDSPrefixedName && !/^(\$|null$|\d)/i.test(expressionNode.concatTokens())) {
      const path = this.path(expressionNode);
      element.path = path;
      element.name = alias ?? path[path.length - 1] ?? "";
    } else if (expressionNode !== undefined) {
      element.expression = expressionNode.concatTokens();
      element.name = alias ?? "";
      try {
        element.expr = parseCdsExpression(expressionNode);
      } catch (error) {
        if (!(error instanceof CdsExpressionError)) {
          throw error;
        }
        element.expressionError = error.message;
      }
    }
    if (tokens.includes("REDIRECTED")) {
      const target = node.findDirectExpressions(E.CDSName).map((n) => n.concatTokens());
      const kind = tokens.includes("CHILD") ? "compositionChild" : tokens.includes("PARENT") ? "parent" : "plain";
      element.redirect = { kind, target: target[target.length - 1] ?? "" };
    }
    return element;
  }

  /** Elements of abstract/custom entities: `[key] name : type;`. */
  private typedElements(tree: abaplint.Nodes.ExpressionNode): { elements: CdsElementAst[]; associations: CdsAssociationAst[] } {
    const result: CdsElementAst[] = [];
    const associations: CdsAssociationAst[] = [];
    let pendingAnnotations: abaplint.Nodes.ExpressionNode[] = [];
    let key = false;
    let name: abaplint.Nodes.ExpressionNode | undefined;
    const children = tree.getChildren();
    let afterBrace = false;
    // the fields of a table entity are nodes of their own (CDSTableField): their content is read alike
    const flat = children.flatMap((c) => (!isToken(c) && c.get() instanceof E.CDSTableField ? c.getChildren() : [c]));
    let previous: CdsElementAst | undefined;
    for (const child of flat) {
      if (isToken(child)) {
        const text = tokenText(child).toUpperCase();
        if (text === "{") {
          afterBrace = true;
        } else if (text === "KEY" && afterBrace) {
          key = true;
        } else if (text === "NULL" && previous !== undefined) {
          previous.nullable = true;
        } else if (text === ";") {
          previous = undefined;
        }
        continue;
      }
      if (!afterBrace) {
        continue;
      }
      const statement = child.get();
      if (statement instanceof E.CDSAnnotation) {
        pendingAnnotations.push(child);
      } else if (statement instanceof E.CDSName && name === undefined) {
        name = child;
      } else if (statement instanceof E.CDSType && name !== undefined) {
        previous = {
          name: name.concatTokens(),
          key,
          declaredType: child.concatTokens().replace(/\s+/g, ""),
          annotations: this.annotations(pendingAnnotations),
          loc: this.loc(name),
        };
        result.push(previous);
        pendingAnnotations = [];
        key = false;
        name = undefined;
      } else if ((statement instanceof E.CDSAssociation || statement instanceof E.CDSComposition) && name !== undefined) {
        const association = this.association(child, name.concatTokens());
        if (association !== undefined) {
          associations.push({ ...association, loc: this.loc(name) });
        }
        pendingAnnotations = [];
        key = false;
        name = undefined;
      } else if (statement instanceof E.CDSElement) {
        result.push(this.element(child));
      }
    }
    return { elements: result, associations };
  }

  public metadataExtension(tree: abaplint.Nodes.ExpressionNode): CdsMetadataExtensionAst {
    const annotations = this.annotations(tree.findDirectExpressions(E.CDSAnnotation));
    const name = tree.findDirectExpression(E.CDSName);
    const layer = typeof annotations["metadata"] === "object" ? String((annotations["metadata"] as AnnotationObject)["layer"] ?? "#CORE") : "#CORE";
    const elements = tree.findDirectExpressions(E.CDSElement).map((e) => {
      const element = this.element(e);
      return { name: element.name, annotations: element.annotations, loc: element.loc };
    });
    return { entity: name?.concatTokens() ?? "", layer: layer.toUpperCase(), annotations, elements, loc: this.loc(name ?? tree) };
  }

  // -------------------------------------------------------------------------------------------
  // annotations

  public annotations(nodes: readonly abaplint.Nodes.ExpressionNode[]): Annotations {
    const result: Annotations = {};
    for (const node of nodes) {
      const children = node.getChildren();
      let path = "";
      let value: AnnotationValue = true;
      for (const child of children) {
        if (isToken(child)) {
          const text = tokenText(child);
          if (text === ":") {
            continue;
          }
          path += text.replace(/^@/, "");
        } else {
          value = this.annotationValue(child);
        }
      }
      setAnnotation(result, path.replace(/\s+/g, ""), value);
    }
    return result;
  }

  private annotationValue(node: abaplint.Nodes.ExpressionNode): AnnotationValue {
    const statement = node.get();
    if (statement instanceof E.CDSAnnotationArray) {
      return node
        .getChildren()
        .filter(isExpression)
        .map((c) => this.annotationValue(c));
    }
    if (statement instanceof E.CDSAnnotationObject) {
      const object: AnnotationObject = {};
      let key = "";
      for (const child of node.getChildren()) {
        if (isToken(child)) {
          const text = tokenText(child);
          if (text === "." && key !== "") {
            key += ".";
          }
          continue;
        }
        if (child.get() instanceof E.CDSName) {
          key += child.concatTokens();
        } else {
          setAnnotation(object, key, this.annotationValue(child));
          key = "";
        }
      }
      return object;
    }
    const str = node.findFirstExpression(E.CDSString);
    if (str !== undefined) {
      const raw = str.concatTokens();
      return raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw;
    }
    const text = node.concatTokens().replace(/\s+/g, "");
    if (/^true$/i.test(text)) {
      return true;
    }
    if (/^false$/i.test(text)) {
      return false;
    }
    if (/^null$/i.test(text)) {
      return null;
    }
    if (/^-?\d+(\.\d+)?$/.test(text)) {
      return Number(text);
    }
    if (text.startsWith("'") && text.endsWith("'")) {
      return text.slice(1, -1).replace(/''/g, "'");
    }
    return text;
  }
}
