@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Booking'
define view entity ZRT_R_Booking
  as select from zrt_booking
  association to parent ZRT_R_Travel as _Travel on $projection.TravelUUID = _Travel.TravelUUID
{
      @EndUserText.label: 'Booking UUID'
  key booking_uuid          as BookingUUID,
      @EndUserText.label: 'Travel UUID'
      parent_uuid           as TravelUUID,
      @EndUserText.label: 'Booking ID'
      booking_id            as BookingID,
      @EndUserText.label: 'Booking Date'
      booking_date          as BookingDate,
      @EndUserText.label: 'Airline'
      carrier_id            as CarrierID,
      @EndUserText.label: 'Flight Number'
      connection_id         as ConnectionID,
      @EndUserText.label: 'Flight Date'
      flight_date           as FlightDate,
      @EndUserText.label: 'Flight Price'
      @Semantics.amount.currencyCode: 'CurrencyCode'
      flight_price          as FlightPrice,
      @EndUserText.label: 'Currency'
      currency_code         as CurrencyCode,
      @EndUserText.label: 'Booking Status'
      booking_status        as BookingStatus,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      local_last_changed_at as LocalLastChangedAt,

      _Travel
}
