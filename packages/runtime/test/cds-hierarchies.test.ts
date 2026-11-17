/**
 * CDS hierarchies (D108): `define hierarchy … as parent child hierarchy( … )` on a view entity with
 * a self association, read by a recursive view (preorder, hierarchy attributes, DEPTH, ORPHANS,
 * CYCLES, the exceptions SAP raises), and the OData recursive hierarchy of a view entity annotated
 * `@OData.hierarchy.recursiveHierarchy` (TopLevels, descendants, ancestors as OpenUI5 sends them).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatedVariant, SERVICE, writableApp, type TestApp } from "./helpers.js";

const lf = (content: string): string => content.replace(/\r\n/g, "\n");

const TABLE = `@ClientHandling.type: #CLIENT_DEPENDENT
@AbapCatalog.deliveryClass: #APPLICATION_DATA
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Nodes'
define table entity ZRT_NODE
{
  key NodeId   : abap.char(4);
      ParentId : abap.char(4);
      @EndUserText.label: 'Name'
      Name     : abap.char(40);
      Seq      : abap.int4;
}
`;

const NODE = `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Node'
@OData.hierarchy.recursiveHierarchy: [{ entity.name: 'ZRT_I_NodeHier' }]
@Search.searchable: true
define view entity ZRT_I_Node
  as select from ZRT_NODE
  association of many to one ZRT_I_Node as _Parent on $projection.ParentId = _Parent.NodeId
{
  key NodeId,
      ParentId,
      @Search.defaultSearchElement: true
      Name,
      Seq,
      _Parent
}
`;

const HIERARCHY = `@EndUserText.label: 'Node hierarchy'
define hierarchy ZRT_I_NodeHier
  as parent child hierarchy(
    source ZRT_I_Node
    child to parent association _Parent
    start where ParentId is initial
    siblings order by Seq ascending
  )
{
  key NodeId,
      ParentId,
      Name,
      $node.hierarchy_level       as HierLevel,
      $node.hierarchy_rank        as HierRank,
      $node.hierarchy_tree_size   as TreeSize,
      $node.hierarchy_parent_rank as ParentRank,
      $node.node_id               as NodeKey,
      $node.parent_id             as ParentKey
}
`;

const OPTIONS = `define hierarchy ZRT_I_NodeHierOpt
  with parameters p_depth : abap.int4
  as parent child hierarchy(
    source ZRT_I_Node
    child to parent association _Parent
    start where NodeId = 'A'
    siblings order by Name descending
    depth :p_depth
    multiple parents allowed
    cycles breakup
  )
{
  NodeId,
  $node.hierarchy_level    as HierLevel,
  $node.hierarchy_is_cycle as IsCycle
}
`;

const ORPHANS = `define hierarchy ZRT_I_NodeHierOrphans
  as parent child hierarchy(
    source ZRT_I_Node
    child to parent association _Parent
    start where ParentId is initial
    siblings order by NodeId
    orphans root
  )
{
  NodeId,
  $node.hierarchy_is_orphan as IsOrphan
}
`;

const STRICT = `define hierarchy ZRT_I_NodeHierStrict
  as parent child hierarchy(
    source ZRT_I_Node
    child to parent association _Parent
    start where ParentId is initial
    siblings order by NodeId
    orphans error
  )
{
  NodeId
}
`;

// the defaults: MULTIPLE PARENTS NOT ALLOWED, CYCLES ERROR
const MULTI = `define hierarchy ZRT_I_NodeHierMulti
  as parent child hierarchy(
    source ZRT_I_Node
    child to parent association _Parent
    start where NodeId = 'A' or NodeId = 'A2'
    siblings order by NodeId
  )
{
  NodeId
}
`;

// A (A2 (A21), A1), B; X is an orphan (its parent Z is missing)
const SEED = `INSERT INTO zrt_node (nodeid, parentid, name, seq) VALUES
 ('A', '', 'Alpha', 1), ('A1', 'A', 'Alpha one', 2), ('A2', 'A', 'Alpha two', 1), ('A21', 'A2', 'Alpha two one', 1),
 ('B', '', 'Beta', 2), ('X', 'Z', 'Orphan', 1);`;

let test: TestApp;

beforeAll(async () => {
  test = await writableApp(
    generatedVariant({
      "zrt_node.ddls.asddls": TABLE,
      "zrt_i_node.ddls.asddls": NODE,
      "zrt_i_nodehier.ddls.asddls": HIERARCHY,
      "zrt_i_nodehieropt.ddls.asddls": OPTIONS,
      "zrt_i_nodehierorphans.ddls.asddls": ORPHANS,
      "zrt_i_nodehierstrict.ddls.asddls": STRICT,
      "zrt_i_nodehiermulti.ddls.asddls": MULTI,
      "zrt_ui_travel.srvd.srvdsrv": (c) => lf(c).replace("  expose ZRT_C_Booking as Booking;", "  expose ZRT_C_Booking as Booking;\n  expose ZRT_I_Node as Node;"),
    }),
  );
  await test.pglite.exec(SEED);
}, 180_000);

afterAll(async () => {
  await test?.close();
});

async function rows(sql: string): Promise<Array<Record<string, unknown>>> {
  return (await test.pglite.query<Record<string, unknown>>(sql)).rows;
}

describe("CDS hierarchies (D108)", () => {
  it("reads the nodes in preorder with the hierarchy attributes", async () => {
    const result = await rows(`SELECT "NodeId", "ParentId", "HierLevel", "HierRank", "TreeSize", "ParentRank", "NodeKey", "ParentKey" FROM zrt_i_nodehier ORDER BY "HierRank"`);
    expect(result.map((r) => [r["NodeId"], r["HierLevel"], Number(r["HierRank"]), Number(r["TreeSize"]), Number(r["ParentRank"])])).toEqual([
      ["A", 1, 1, 4, 0],
      ["A2", 2, 2, 2, 1],
      ["A21", 3, 3, 1, 2],
      ["A1", 2, 4, 1, 1],
      ["B", 1, 5, 1, 0],
    ]);
    expect(result[2]).toMatchObject({ NodeKey: "A21", ParentKey: "A2" });
    expect(result[0]?.["ParentKey"]).toBeNull();
  });

  it("limits the levels with DEPTH (a parameter), orders siblings descending, breaks cycles", async () => {
    const at = async (depth: number): Promise<unknown[]> => {
      await test.pglite.exec(`SET rapt.p_zrt_i_nodehieropt__p_depth = '${depth}'`);
      return (await rows(`SELECT "NodeId" FROM zrt_i_nodehieropt ORDER BY "$path"`)).map((r) => r["NodeId"]);
    };
    expect(await at(0)).toEqual(["A"]);
    expect(await at(1)).toEqual(["A", "A2", "A1"]);
    expect(await at(5)).toEqual(["A", "A2", "A21", "A1"]);
    expect(await at(-1)).toEqual([]);
    // a cycle A → A2 → A21 → A: broken where it closes
    await test.pglite.exec(`UPDATE zrt_node SET parentid = 'A21' WHERE nodeid = 'A'`);
    await test.pglite.exec(`SET rapt.p_zrt_i_nodehieropt__p_depth = '5'`);
    try {
      const cycle = await rows(`SELECT "NodeId", "IsCycle" FROM zrt_i_nodehieropt ORDER BY "$path"`);
      expect(cycle.map((r) => [r["NodeId"], r["IsCycle"]])).toEqual([["A", 0], ["A2", 0], ["A21", 0], ["A", 1], ["A1", 0]]);
      // CYCLES ERROR (the default) raises
      await expect(rows(`SELECT * FROM zrt_i_nodehiermulti`)).rejects.toThrow(/node cycle/);
    } finally {
      await test.pglite.exec(`UPDATE zrt_node SET parentid = '' WHERE nodeid = 'A'`);
    }
  });

  it("makes the orphans root nodes with ORPHANS ROOT, and raises with ORPHANS ERROR", async () => {
    const result = await rows(`SELECT "NodeId", "IsOrphan" FROM zrt_i_nodehierorphans ORDER BY "$path"`);
    expect(result.map((r) => [r["NodeId"], r["IsOrphan"]])).toEqual([["A", 0], ["A1", 0], ["A2", 0], ["A21", 0], ["B", 0], ["X", 1]]);
    await expect(rows(`SELECT * FROM zrt_i_nodehierstrict`)).rejects.toThrow(/orphan node/);
  });

  it("raises on a node with several parents unless MULTIPLE PARENTS ALLOWED", async () => {
    // A2 is a root node and a child of A
    await expect(rows(`SELECT * FROM zrt_i_nodehiermulti`)).rejects.toThrow(/multiple parents/);
  });
});

async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await test.app.inject({ method: "GET", url: `${SERVICE}${path}`, headers: { accept: "application/json" } });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

const TOP = "com.sap.vocabularies.Hierarchy.v1.TopLevels(HierarchyNodes=$root/Node,HierarchyQualifier='ZRT_I_NodeHier',NodeProperty='NodeId'";
const SELECT = "$select=DistanceFromRoot,DrillState,LimitedDescendantCount,LimitedRank,Name,NodeId";

/** The nodes of a hierarchical request: id, distance from the root, drill state, descendants in the result. */
async function tree(apply: string, extra = ""): Promise<{ count: unknown; nodes: unknown[] }> {
  const result = await get(`Node?$apply=${encodeURIComponent(apply)}&${SELECT}&$count=true&$skip=0&$top=100${extra}`);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  const rows = result.body["value"] as Array<Record<string, unknown>>;
  rows.forEach((r, i) => expect(r["LimitedRank"]).toBe(i));
  return { count: result.body["@odata.count"], nodes: rows.map((r) => [r["NodeId"], r["DistanceFromRoot"], r["DrillState"], r["LimitedDescendantCount"]]) };
}

describe("OData recursive hierarchy (D108)", () => {
  it("describes the recursive hierarchy in $metadata", async () => {
    const response = await test.app.inject({ method: "GET", url: `${SERVICE}$metadata` });
    const xml = response.body;
    expect(xml).toContain('Namespace="Org.OData.Aggregation.V1"');
    expect(xml).toContain('Namespace="com.sap.vocabularies.Hierarchy.v1"');
    expect(xml).toMatch(/<Annotation Term="[A-Za-z_]*[Aa]ggregation\.RecursiveHierarchy" Qualifier="ZRT_I_NodeHier">\s*<Record>\s*<PropertyValue Property="NodeProperty" PropertyPath="NodeId"\/>\s*<PropertyValue Property="ParentNavigationProperty" NavigationPropertyPath="_Parent"\/>/);
    expect(xml).toMatch(/<Annotation Term="[A-Za-z_]*[Hh]ierarchy\.RecursiveHierarchy" Qualifier="ZRT_I_NodeHier">/);
    for (const name of ["LimitedDescendantCount", "DistanceFromRoot", "LimitedRank"]) expect(xml).toContain(`<Property Name="${name}" Type="Edm.Int64"/>`);
    expect(xml).toContain('<Property Name="DrillState" Type="Edm.String"/>');
  });

  it("reads the top levels, expanded to Levels", async () => {
    expect(await tree(`${TOP},Levels=1)`)).toEqual({ count: 2, nodes: [["A", 0, "collapsed", 0], ["B", 0, "leaf", 0]] });
    expect(await tree(`${TOP},Levels=2)`)).toEqual({
      count: 4,
      nodes: [["A", 0, "expanded", 2], ["A2", 1, "collapsed", 0], ["A1", 1, "leaf", 0], ["B", 0, "leaf", 0]],
    });
    // all levels, then a page
    expect((await tree(`${TOP})`)).nodes.map((n) => (n as unknown[])[0])).toEqual(["A", "A2", "A21", "A1", "B"]);
    const page = await get(`Node?$apply=${encodeURIComponent(`${TOP})`)}&$select=NodeId,LimitedRank&$skip=1&$top=2`);
    expect((page.body["value"] as Array<Record<string, unknown>>).map((r) => [r["NodeId"], r["LimitedRank"]])).toEqual([["A2", 1], ["A21", 2]]);
  });

  it("keeps the expanded and collapsed nodes with ExpandLevels, sorts the siblings with orderby", async () => {
    expect((await tree(`${TOP},Levels=1,ExpandLevels=[{"NodeID":"A","Levels":1}])`)).nodes).toEqual([["A", 0, "expanded", 2], ["A2", 1, "collapsed", 0], ["A1", 1, "leaf", 0], ["B", 0, "leaf", 0]]);
    expect((await tree(`${TOP},Levels=3,ExpandLevels=[{"NodeID":"A2","Levels":0}])`)).nodes).toEqual([["A", 0, "expanded", 2], ["A2", 1, "collapsed", 0], ["A1", 1, "leaf", 0], ["B", 0, "leaf", 0]]);
    expect((await tree(`orderby(Name desc)/${TOP},Levels=2)`)).nodes.map((n) => (n as unknown[])[0])).toEqual(["B", "A", "A2", "A1"]);
  });

  it("reads the children of a node with descendants", async () => {
    // the distance counts the ancestors in the sub-hierarchy of descendants (Hierarchy vocabulary)
    expect(await tree(`descendants($root/Node,ZRT_I_NodeHier,NodeId,filter(NodeId eq 'A'),1)/orderby(Name)`)).toEqual({
      count: 2,
      nodes: [["A1", 0, "leaf", 0], ["A2", 0, "collapsed", 0]],
    });
  });

  it("filters and searches with ancestors, keeping the path to the matching nodes", async () => {
    expect((await tree(`ancestors($root/Node,ZRT_I_NodeHier,NodeId,filter(Name eq 'Alpha two one'),keep start)/${TOP},Levels=3)`)).nodes).toEqual([
      ["A", 0, "expanded", 2],
      ["A2", 1, "expanded", 1],
      ["A21", 2, "leaf", 0],
    ]);
    expect((await tree(`ancestors($root/Node,ZRT_I_NodeHier,NodeId,search(Beta),keep start)/${TOP},Levels=1)`)).nodes).toEqual([["B", 0, "leaf", 0]]);
  });

  it("refuses another hierarchy, and reads the entity set as usual without $apply", async () => {
    expect((await get(`Node?$apply=${encodeURIComponent("com.sap.vocabularies.Hierarchy.v1.TopLevels(HierarchyNodes=$root/Node,HierarchyQualifier='Other',NodeProperty='NodeId',Levels=1)")}`)).status).toBe(400);
    const plain = await get("Node?$orderby=NodeId&$select=NodeId");
    expect((plain.body["value"] as Array<Record<string, unknown>>).map((r) => r["NodeId"])).toEqual(["A", "A1", "A2", "A21", "B", "X"]);
  });
});
