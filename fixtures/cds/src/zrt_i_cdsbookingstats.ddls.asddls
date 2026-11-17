@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Bookings per travel (round 2)'
define view entity ZRT_I_CdsBookingStats
  as select from zrt_booking
{
  key parent_uuid           as TravelUUID,
  key currency_code         as CurrencyCode,
      count(*)              as Bookings,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      sum( flight_price )   as TotalFlightPrice,
      max( flight_date )    as LastFlightDate
}
group by
  parent_uuid,
  currency_code
having
  count(*) > 0
