@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Travels of a status (round 2)'
define view entity ZRT_I_CdsTravelByStatus
  with parameters
    p_status : abap.char(1)
  as select from zrt_travel
{
  key travel_uuid    as TravelUUID,
      travel_id      as TravelID,
      overall_status as OverallStatus
}
where
  overall_status = $parameters.p_status
