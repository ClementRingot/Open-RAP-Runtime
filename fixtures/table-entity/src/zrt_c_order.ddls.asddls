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
      @Semantics.amount.currencyCode: 'Currency'
      Amount,
      Currency,
      Note
}
