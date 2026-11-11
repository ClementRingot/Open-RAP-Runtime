/** AST of OData URLs: resource path, key predicates and system query options. */

import type { UrlLiteral } from "../../values.js";

export type Expr =
  | { kind: "literal"; literal: UrlLiteral }
  | { kind: "member"; path: string[] }
  | { kind: "binary"; op: "eq" | "ne" | "gt" | "ge" | "lt" | "le" | "and" | "or"; left: Expr; right: Expr }
  | { kind: "not"; operand: Expr }
  | { kind: "in"; operand: Expr; list: Expr[] }
  | { kind: "call"; name: string; args: Expr[] };

export interface OrderItem {
  path: string[];
  descending: boolean;
}

export interface ExpandItem {
  path: string[];
  options: QueryOptions;
}

export interface QueryOptions {
  filter?: Expr;
  orderby?: OrderItem[];
  /** Undefined: all properties. `["*"]`: all properties too. */
  select?: string[][];
  expand?: ExpandItem[];
  top?: number;
  skip?: number;
  count?: boolean;
  search?: string;
  /** `$apply` (data aggregation, D52): filter, then one groupby or aggregate. */
  apply?: ApplyStep[];
}

/** An aggregate of `$apply`: `Price with sum as Total`, `$count as Count`. */
export interface AggregateItem {
  /** Property aggregated; undefined for `$count`. */
  property?: string;
  method: "sum" | "min" | "max" | "average" | "countdistinct" | "count";
  alias: string;
}

export type ApplyStep =
  | { kind: "filter"; filter: Expr }
  | { kind: "groupby"; properties: string[]; aggregate: AggregateItem[] }
  | { kind: "aggregate"; aggregate: AggregateItem[] };

/** `(value)` or `(Name=value,…)`. */
export type KeyPredicate = { kind: "single"; value: Expr } | { kind: "named"; values: Array<{ name: string; value: Expr }> };

export type Segment =
  | { kind: "entitySet"; name: string; key?: KeyPredicate }
  | { kind: "navigation"; name: string; key?: KeyPredicate }
  | { kind: "count" }
  | { kind: "operation"; name: string; namespace: string; parameters?: Array<{ name: string; value: Expr }> }
  | { kind: "contentId"; id: string; rest?: string }
  | { kind: "property"; name: string }
  | { kind: "value" };
