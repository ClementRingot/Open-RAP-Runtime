@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Travel'
@Metadata.allowExtensions: true
@Search.searchable: true
define root view entity ZRT_C_Travel
  provider contract transactional_query
  as projection on ZRT_R_Travel
{
  key TravelUUID,
      @Search.defaultSearchElement: true
      TravelID,
      AgencyID,
      CustomerID,
      BeginDate,
      EndDate,
      BookingFee,
      TotalPrice,
      CurrencyCode,
      @Search.defaultSearchElement: true
      Description,
      OverallStatus,
      CreatedBy,
      CreatedAt,
      LastChangedBy,
      LastChangedAt,
      LocalLastChangedAt,

      _Booking : redirected to composition child ZRT_C_Booking
}
