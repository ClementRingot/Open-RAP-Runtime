@ClientHandling.type: #CLIENT_DEPENDENT
@AbapCatalog.deliveryClass: #APPLICATION_DATA
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Nodes of a tree (round 2)'
define table entity ZRT_CDSNODE
{
  key NodeId   : abap.char(4);
      ParentId : abap.char(4);
      Name     : abap.char(40);
      Seq      : abap.int4;
}
