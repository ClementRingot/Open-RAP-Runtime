@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Orders'
@Metadata.allowExtensions: true
define root view entity ZRT_C_ORDER
  provider contract transactional_query
  as projection on ZRT_ORDER
{
  key OrderId,
      Name,
      Status,
      Priority,
      @Consumption.valueHelpDefinition: [{ entity: { name: 'ZRT_ORDER_CAT', element: 'Category' },
                                           additionalBinding: [{ localElement: 'Currency', element: 'DefaultCurrency', usage: #RESULT }] }]
      Category,
      @Semantics.amount.currencyCode: 'Currency'
      Amount,
      @Consumption.valueHelpDefinition: [{ entity: { name: 'I_Currency', element: 'Currency' }, useForValidation: true }]
      Currency,
      Note
}
