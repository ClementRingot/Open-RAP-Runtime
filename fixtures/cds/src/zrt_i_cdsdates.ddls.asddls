@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Dates of travels and bookings (round 2)'
@Metadata.ignorePropagatedAnnotations: true
define view entity ZRT_I_CdsDates
  as select from zrt_travel
{
  key travel_uuid as Id,
      'T'         as Kind,
      begin_date  as EventDate
}
union all select from zrt_booking
{
  key booking_uuid as Id,
      'B'          as Kind,
      flight_date  as EventDate
}
