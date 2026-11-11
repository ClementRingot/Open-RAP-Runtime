@ClientHandling.type: #CLIENT_DEPENDENT
@AbapCatalog.deliveryClass: #APPLICATION_DATA
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Orders (table entity)'
define root table entity ZRT_ORDER
{
  key OrderId  : abap.numc(8);
      Name     : zrt_order_name;
      Status   : zrt_order_status;
      Priority : zrt_priority;
      @EndUserText.label: 'Category'
      Category : abap.char(2);
      @Semantics.amount.currencyCode: 'Currency'
      Amount   : abap.curr(15,2);
      Currency : abap.cuky;
      @EndUserText.label: 'Note'
      Note     : abap.string null;
}
