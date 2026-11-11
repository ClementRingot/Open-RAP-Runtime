@EndUserText.label: 'Review of a product'
@ObjectModel.query.implementedBy: 'ABAP:ZCL_REVIEW_QUERY'
define custom entity ZCE_Review
{
      @UI: { lineItem: [ { position: 10 } ] }
  key ProductID : abap.char(10);
      @UI: { lineItem: [ { position: 20 } ] }
  key ReviewID  : abap.numc(4);
      @UI: { lineItem: [ { position: 30 } ] }
      Rating    : abap.int1;
      @UI: { lineItem: [ { position: 40 } ] }
      Comment   : abap.char(80);
      _Product  : association [1..1] to ZCE_Product on $projection.ProductID = _Product.ProductID;
}
