/**
 * D108: the recursive hierarchy of an entity set (Aggregation.RecursiveHierarchy and
 * Hierarchy.RecursiveHierarchy): the transformations of `$apply` that OpenUI5 sends for a tree
 * table — ancestors, descendants, orderby, Hierarchy.TopLevels — computed on the nodes of the CDS
 * hierarchy (its view gives their preorder), and the properties LimitedDescendantCount,
 * DistanceFromRoot, DrillState and LimitedRank of each node of the result.
 */

/** An occurrence of a node in the CDS hierarchy (a node with several parents occurs several times). */
export interface Occurrence {
  id: number;
  node: string;
}

/** A forest over occurrences: the roots and the children of each occurrence, in sibling order. */
export interface Forest {
  roots: Occurrence[];
  children: Map<Occurrence, Occurrence[]>;
  parent: Map<Occurrence, Occurrence | undefined>;
}

export type DrillState = "expanded" | "collapsed" | "leaf";

export interface HierarchyNode {
  occurrence: Occurrence;
  LimitedDescendantCount: number;
  DistanceFromRoot: number;
  DrillState: DrillState;
  LimitedRank: number;
}

const childrenOf = (forest: Forest, o: Occurrence): Occurrence[] => forest.children.get(o) ?? [];

/** The occurrences of a forest in preorder. */
export function preorder(forest: Forest): Occurrence[] {
  const result: Occurrence[] = [];
  const visit = (o: Occurrence): void => {
    result.push(o);
    for (const c of childrenOf(forest, o)) visit(c);
  };
  for (const r of forest.roots) visit(r);
  return result;
}

/**
 * The forest of the rows of the hierarchy view, in preorder (`path`: the sibling ranks from the
 * root), restricted to the visible nodes: an occurrence whose parent is not kept is left out with
 * its descendants.
 */
export function buildForest(rows: Array<{ node: string; path: Array<number | string> }>, visible: (node: string) => boolean): Forest {
  const forest: Forest = { roots: [], children: new Map(), parent: new Map() };
  const byPath = new Map<string, Occurrence>();
  let id = 0;
  for (const row of rows) {
    if (!visible(row.node)) continue;
    const path = row.path.map(String);
    const occurrence: Occurrence = { id: id++, node: row.node };
    if (path.length > 1) {
      const parent = byPath.get(path.slice(0, -1).join("."));
      if (parent === undefined) continue;
      forest.parent.set(occurrence, parent);
      const siblings = forest.children.get(parent) ?? [];
      siblings.push(occurrence);
      forest.children.set(parent, siblings);
    } else {
      forest.parent.set(occurrence, undefined);
      forest.roots.push(occurrence);
    }
    byPath.set(path.join("."), occurrence);
  }
  return forest;
}

/** The forest of the kept occurrences: each one under its nearest kept ancestor, in the same order. */
export function restrict(forest: Forest, keep: (o: Occurrence) => boolean): Forest {
  const result: Forest = { roots: [], children: new Map(), parent: new Map() };
  for (const o of preorder(forest)) {
    if (!keep(o)) continue;
    let ancestor = forest.parent.get(o);
    while (ancestor !== undefined && !keep(ancestor)) ancestor = forest.parent.get(ancestor);
    result.parent.set(o, ancestor);
    if (ancestor === undefined) {
      result.roots.push(o);
    } else {
      const siblings = result.children.get(ancestor) ?? [];
      siblings.push(o);
      result.children.set(ancestor, siblings);
    }
  }
  return result;
}

/** The number of ancestors of an occurrence in a forest. */
export function depthOf(forest: Forest, o: Occurrence): number {
  let depth = 0;
  for (let p = forest.parent.get(o); p !== undefined; p = forest.parent.get(p)) depth++;
  return depth;
}

/**
 * `ancestors(…, filter, [distance], [keep start])`: the matching occurrences (with keep start) and
 * their ancestors, up to `distance` levels above them.
 */
export function ancestors(forest: Forest, matches: (o: Occurrence) => boolean, distance: number | undefined, keepStart: boolean): Forest {
  const kept = new Set<Occurrence>();
  for (const o of preorder(forest)) {
    if (!matches(o)) continue;
    if (keepStart) kept.add(o);
    let level = 0;
    for (let p = forest.parent.get(o); p !== undefined && (distance === undefined || level < distance); p = forest.parent.get(p)) {
      kept.add(p);
      level++;
    }
  }
  return restrict(forest, (o) => kept.has(o));
}

/**
 * `descendants(…, filter, [distance], [keep start])`: the descendants of the matching occurrences,
 * up to `distance` levels below them, and the matching ones with keep start.
 */
export function descendants(forest: Forest, matches: (o: Occurrence) => boolean, distance: number | undefined, keepStart: boolean): Forest {
  const kept = new Set<Occurrence>();
  const below = (o: Occurrence, level: number): void => {
    if (distance !== undefined && level > distance) return;
    kept.add(o);
    for (const c of childrenOf(forest, o)) below(c, level + 1);
  };
  for (const o of preorder(forest)) {
    if (!matches(o)) continue;
    if (keepStart) kept.add(o);
    for (const c of childrenOf(forest, o)) below(c, 1);
  }
  return restrict(forest, (o) => kept.has(o));
}

/** `orderby(…)`: the siblings sorted, stably (ties keep the order of SIBLINGS ORDER BY). */
export function orderSiblings(forest: Forest, compare: (a: Occurrence, b: Occurrence) => number): Forest {
  const sort = (list: Occurrence[]): Occurrence[] => list.map((o, i) => ({ o, i })).sort((a, b) => compare(a.o, b.o) || a.i - b.i).map((x) => x.o);
  const children = new Map<Occurrence, Occurrence[]>();
  for (const [o, list] of forest.children) children.set(o, sort(list));
  return { roots: sort(forest.roots), children, parent: forest.parent };
}

/**
 * Hierarchy.TopLevels: the occurrences with less than `levels` ancestors, then the nodes of
 * ExpandLevels expanded (by their levels, all of them for null) or collapsed (0), and the ancestors
 * of the nodes of Show expanded; in preorder.
 */
export function topLevels(forest: Forest, options: { levels?: number; expandLevels?: Array<{ nodeId: string; levels: number | null }>; show?: string[] }): HierarchyNode[] {
  const expand = new Map<string, number | null>();
  for (const e of options.expandLevels ?? []) expand.set(e.nodeId, e.levels);
  const forced = new Set<Occurrence>();
  const shown = new Set(options.show ?? []);
  for (const o of preorder(forest)) {
    if (!shown.has(o.node)) continue;
    for (let p = forest.parent.get(o); p !== undefined; p = forest.parent.get(p)) forced.add(p);
  }
  const visible: Occurrence[] = [];
  const open = new Set<Occurrence>();
  const visit = (o: Occurrence, budget: number): void => {
    visible.push(o);
    let remaining = budget;
    if (expand.has(o.node)) {
      const levels = expand.get(o.node);
      remaining = levels === null || levels === undefined ? Number.POSITIVE_INFINITY : levels;
    }
    if (forced.has(o)) remaining = Math.max(remaining, 1);
    if (remaining < 1) return;
    const children = childrenOf(forest, o);
    if (children.length > 0) open.add(o);
    for (const c of children) visit(c, remaining - 1);
  };
  const levels = options.levels ?? Number.POSITIVE_INFINITY;
  if (levels >= 1) for (const r of forest.roots) visit(r, levels - 1);
  return limited(forest, visible, open);
}

/** The whole forest, every node expanded (a request without TopLevels). */
export function allLevels(forest: Forest, unlimited: Forest): HierarchyNode[] {
  const visible = preorder(forest);
  const open = new Set(visible.filter((o) => childrenOf(forest, o).length > 0));
  return limited(unlimited, visible, open, forest);
}

/**
 * The properties of the limited hierarchy: `visible` in preorder, `open` the expanded occurrences;
 * the drill state and the distance from the root against the unlimited hierarchy.
 */
function limited(unlimited: Forest, visible: Occurrence[], open: Set<Occurrence>, shape: Forest = unlimited): HierarchyNode[] {
  const index = new Map(visible.map((o, i) => [o, i]));
  const descendantCount = new Map<Occurrence, number>();
  for (let i = visible.length - 1; i >= 0; i--) {
    const o = visible[i] as Occurrence;
    const count = open.has(o) ? childrenOf(shape, o).filter((c) => index.has(c)).reduce((n, c) => n + 1 + (descendantCount.get(c) ?? 0), 0) : 0;
    descendantCount.set(o, count);
  }
  return visible.map((o, i) => ({
    occurrence: o,
    LimitedDescendantCount: descendantCount.get(o) ?? 0,
    DistanceFromRoot: depthOf(unlimited, o),
    DrillState: childrenOf(unlimited, o).length === 0 ? "leaf" : open.has(o) && childrenOf(shape, o).some((c) => index.has(c)) ? "expanded" : "collapsed",
    LimitedRank: i,
  }));
}
