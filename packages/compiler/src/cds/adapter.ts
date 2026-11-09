/**
 * Adapter over the CDS parser of abaplint (PLAN.md, V1): turns its expression tree into a small
 * typed AST for view entities, projections, abstract entities and metadata extensions.
 */

import * as abaplint from "@abaplint/core";
import { setAnnotation, type AnnotationObject, type AnnotationValue, type Annotations } from "@rap-transpiler/model";

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
  /** `name : abap.char( 10 )` or `name : data_element` in abstract entities. */
  declaredType?: string;
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

export type CdsEntityKind = "view" | "projection" | "abstract" | "custom" | "other";

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
  annotations: Annotations;
  elements: CdsElementAst[];
  associations: CdsAssociationAst[];
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
      return entity;
    }

    if (kind === "view") {
      const select = tree.findDirectExpression(E.CDSSelect);
      if (select !== undefined) {
        const source = select.findDirectExpression(E.CDSSource);
        if (source !== undefined) {
          const prefixed = source.findDirectExpression(E.CDSPrefixedName);
          entity.source = (prefixed ?? source).concatTokens().replace(/\s+/g, "");
          const as = source.findDirectExpression(E.CDSAs);
          if (as !== undefined) {
            entity.sourceAlias = as.findDirectExpression(E.CDSName)?.concatTokens() ?? "";
          }
        }
        entity.hasJoin = select.findDirectExpressions(E.CDSJoin).length > 0;
        entity.hasWhere = select.findDirectExpression(E.CDSWhere) !== undefined;
        entity.associations = this.associations(select);
        entity.elements = select.findDirectExpressions(E.CDSElement).map((e) => this.element(e));
      }
      return entity;
    }

    // abstract and custom entities: `[key] name : type;`
    entity.elements = this.typedElements(tree);
    return entity;
  }

  private associations(parent: abaplint.Nodes.ExpressionNode): CdsAssociationAst[] {
    const result: CdsAssociationAst[] = [];
    for (const child of parent.getChildren()) {
      if (!isExpression(child)) {
        continue;
      }
      const isComposition = child.get() instanceof E.CDSComposition;
      if (!isComposition && !(child.get() instanceof E.CDSAssociation)) {
        continue;
      }
      const tokens = child.getChildren().filter(isToken).map((t) => tokenText(t).toUpperCase());
      const relation = child.findDirectExpression(E.CDSRelation);
      const target = relation?.getFirstToken().getStr() ?? "";
      const alias = relation?.findDirectExpression(E.CDSAs)?.findDirectExpression(E.CDSName)?.concatTokens() ?? target;
      const kind: CdsAssociationAst["kind"] = isComposition ? "composition" : tokens.includes("PARENT") ? "toParent" : "association";
      result.push({
        kind,
        target,
        alias,
        cardinality: this.cardinality(child, kind),
        on: this.onCondition(child.findDirectExpression(E.CDSCondition)),
        loc: this.loc(child),
      });
    }
    return result;
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
    if (expressionNode !== undefined && expressionNode.get() instanceof E.CDSPrefixedName) {
      const path = this.path(expressionNode);
      element.path = path;
      element.name = alias ?? path[path.length - 1] ?? "";
    } else if (expressionNode !== undefined) {
      element.expression = expressionNode.concatTokens();
      element.name = alias ?? "";
    }
    if (tokens.includes("REDIRECTED")) {
      const target = node.findDirectExpressions(E.CDSName).map((n) => n.concatTokens());
      const kind = tokens.includes("CHILD") ? "compositionChild" : tokens.includes("PARENT") ? "parent" : "plain";
      element.redirect = { kind, target: target[target.length - 1] ?? "" };
    }
    return element;
  }

  /** Elements of abstract/custom entities: `[key] name : type;`. */
  private typedElements(tree: abaplint.Nodes.ExpressionNode): CdsElementAst[] {
    const result: CdsElementAst[] = [];
    let pendingAnnotations: abaplint.Nodes.ExpressionNode[] = [];
    let key = false;
    let name: abaplint.Nodes.ExpressionNode | undefined;
    const children = tree.getChildren();
    let afterBrace = false;
    for (const child of children) {
      if (isToken(child)) {
        const text = tokenText(child).toUpperCase();
        if (text === "{") {
          afterBrace = true;
        } else if (text === "KEY" && afterBrace) {
          key = true;
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
        result.push({
          name: name.concatTokens(),
          key,
          declaredType: child.concatTokens().replace(/\s+/g, ""),
          annotations: this.annotations(pendingAnnotations),
          loc: this.loc(name),
        });
        pendingAnnotations = [];
        key = false;
        name = undefined;
      } else if (statement instanceof E.CDSElement) {
        result.push(this.element(child));
      }
    }
    return result;
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
