@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Node of a tree (round 2)'
@OData.hierarchy.recursiveHierarchy: [{ entity.name: 'ZRT_I_CdsNodeHier' }]
@UI.presentationVariant: [{ recursiveHierarchyQualifier: 'ZRT_I_CdsNodeHier', initialExpansionLevel: 1 }]
@Search.searchable: true
define view entity ZRT_I_CdsNode
  as select from ZRT_CDSNODE
  association of many to one ZRT_I_CdsNode as _Parent on $projection.ParentId = _Parent.NodeId
{
      @UI.lineItem: [{ position: 10 }]
  key NodeId,
      @UI.lineItem: [{ position: 20 }]
      ParentId,
      @UI.lineItem: [{ position: 30 }]
      @Search.defaultSearchElement: true
      Name,
      Seq,
      _Parent
}
