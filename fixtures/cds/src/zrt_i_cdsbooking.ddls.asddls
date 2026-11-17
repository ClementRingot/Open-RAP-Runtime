@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Bookings with conditions (round 2)'
define view entity ZRT_I_CdsBooking
  as select from zrt_booking as b
    inner join   zrt_travel  as t on t.travel_uuid = b.parent_uuid
  association [1..1] to ZRT_R_Travel as _Travel on $projection.TravelUUID = _Travel.TravelUUID
{
  key b.booking_uuid       as BookingUUID,
      b.parent_uuid        as TravelUUID,
      b.booking_id         as BookingID,
      t.travel_id          as TravelID,
      _Travel.Description  as TravelDescription,
      $session.user        as ReadBy,
      $session.system_date as ReadOn,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      b.flight_price       as FlightPrice,
      b.currency_code      as CurrencyCode,
      _Travel
}
where
      b.flight_price between 1 and 100000
  and b.carrier_id   is not initial
