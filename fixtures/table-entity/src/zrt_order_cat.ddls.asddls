@ClientHandling.type: #CLIENT_DEPENDENT
@AbapCatalog.deliveryClass: #CUSTOMIZING
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Order category'
@ObjectModel.resultSet.sizeCategory: #XS
define table entity ZRT_ORDER_CAT
{
  key Category        : abap.char(2);
      @EndUserText.label: 'Description'
      Description     : abap.char(40);
      @EndUserText.label: 'Default currency'
      DefaultCurrency : abap.cuky;
}
