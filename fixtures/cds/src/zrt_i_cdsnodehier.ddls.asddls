@EndUserText.label: 'Hierarchy of the nodes (round 2)'
define hierarchy ZRT_I_CdsNodeHier
  as parent child hierarchy(
    source ZRT_I_CdsNode
    child to parent association _Parent
    start where ParentId is initial
    siblings order by Seq ascending
  )
{
  key NodeId,
      ParentId,
      Name,
      $node.hierarchy_level as HierarchyLevel,
      $node.hierarchy_rank  as HierarchyRank
}
