@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Travel'
define root view entity ZRT_R_Travel
  as select from zrt_travel
  composition [0..*] of ZRT_R_Booking as _Booking
{
      @EndUserText.label: 'Travel UUID'
  key travel_uuid           as TravelUUID,
      @EndUserText.label: 'Travel ID'
      travel_id             as TravelID,
      @EndUserText.label: 'Agency ID'
      agency_id             as AgencyID,
      @EndUserText.label: 'Customer ID'
      customer_id           as CustomerID,
      @EndUserText.label: 'Begin Date'
      begin_date            as BeginDate,
      @EndUserText.label: 'End Date'
      end_date              as EndDate,
      @EndUserText.label: 'Booking Fee'
      @Semantics.amount.currencyCode: 'CurrencyCode'
      booking_fee           as BookingFee,
      @EndUserText.label: 'Total Price'
      @Semantics.amount.currencyCode: 'CurrencyCode'
      total_price           as TotalPrice,
      @EndUserText.label: 'Currency'
      currency_code         as CurrencyCode,
      @EndUserText.label: 'Description'
      description           as Description,
      @EndUserText.label: 'Status'
      overall_status        as OverallStatus,
      @EndUserText.label: 'Created By'
      @Semantics.user.createdBy: true
      created_by            as CreatedBy,
      @EndUserText.label: 'Created At'
      @Semantics.systemDateTime.createdAt: true
      created_at            as CreatedAt,
      @EndUserText.label: 'Changed By'
      @Semantics.user.lastChangedBy: true
      last_changed_by       as LastChangedBy,
      @EndUserText.label: 'Changed At'
      @Semantics.systemDateTime.lastChangedAt: true
      last_changed_at       as LastChangedAt,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      local_last_changed_at as LocalLastChangedAt,

      _Booking
}
