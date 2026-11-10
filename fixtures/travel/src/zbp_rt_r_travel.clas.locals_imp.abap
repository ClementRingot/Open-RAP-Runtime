CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    CONSTANTS:
      BEGIN OF travel_status,
        open     TYPE c LENGTH 1 VALUE 'O',
        accepted TYPE c LENGTH 1 VALUE 'A',
      END OF travel_status.

    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR Travel RESULT result.

    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR Travel RESULT result.

    METHODS get_instance_features FOR INSTANCE FEATURES
      IMPORTING keys REQUEST requested_features FOR Travel RESULT result.

    METHODS acceptTravel FOR MODIFY
      IMPORTING keys FOR ACTION Travel~acceptTravel RESULT result.

    METHODS deductDiscount FOR MODIFY
      IMPORTING keys FOR ACTION Travel~deductDiscount RESULT result.

    METHODS copyTravel FOR MODIFY
      IMPORTING keys FOR ACTION Travel~copyTravel.

    METHODS reCalcTotalPrice FOR MODIFY
      IMPORTING keys FOR ACTION Travel~reCalcTotalPrice.

    METHODS setStatusOpen FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Travel~setStatusOpen.

    METHODS calculateTotalPrice FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Travel~calculateTotalPrice.

    METHODS validateDates FOR VALIDATE ON SAVE
      IMPORTING keys FOR Travel~validateDates.
ENDCLASS.

CLASS lhc_travel IMPLEMENTATION.

  METHOD get_global_authorizations.
    " the activities of ZAO_TRAVL, whatever the agency (checked per instance)
    IF requested_authorizations-%create = if_abap_behv=>mk-on.
      AUTHORITY-CHECK OBJECT 'ZAO_TRAVL' ID 'ACTVT' FIELD '01' ID 'ZAGENCY' DUMMY.
      result-%create = COND #( WHEN sy-subrc = 0 THEN if_abap_behv=>auth-allowed ELSE if_abap_behv=>auth-unauthorized ).
      result-%action-copyTravel = result-%create.
    ENDIF.
    IF requested_authorizations-%update = if_abap_behv=>mk-on OR requested_authorizations-%action-acceptTravel = if_abap_behv=>mk-on
       OR requested_authorizations-%action-deductDiscount = if_abap_behv=>mk-on.
      AUTHORITY-CHECK OBJECT 'ZAO_TRAVL' ID 'ACTVT' FIELD '02' ID 'ZAGENCY' DUMMY.
      result-%update = COND #( WHEN sy-subrc = 0 THEN if_abap_behv=>auth-allowed ELSE if_abap_behv=>auth-unauthorized ).
      result-%action-acceptTravel = result-%update.
      result-%action-deductDiscount = result-%update.
    ENDIF.
    IF requested_authorizations-%delete = if_abap_behv=>mk-on.
      AUTHORITY-CHECK OBJECT 'ZAO_TRAVL' ID 'ACTVT' FIELD '06' ID 'ZAGENCY' DUMMY.
      result-%delete = COND #( WHEN sy-subrc = 0 THEN if_abap_behv=>auth-allowed ELSE if_abap_behv=>auth-unauthorized ).
    ENDIF.
    IF requested_authorizations-%action-copyTravel = if_abap_behv=>mk-on.
      AUTHORITY-CHECK OBJECT 'ZAO_TRAVL' ID 'ACTVT' FIELD '01' ID 'ZAGENCY' DUMMY.
      result-%action-copyTravel = COND #( WHEN sy-subrc = 0 THEN if_abap_behv=>auth-allowed ELSE if_abap_behv=>auth-unauthorized ).
    ENDIF.
  ENDMETHOD.

  METHOD get_instance_authorizations.
    " the agency of each travel
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( AgencyID ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels)
      FAILED failed.

    LOOP AT travels INTO DATA(travel).
      AUTHORITY-CHECK OBJECT 'ZAO_TRAVL' ID 'ACTVT' FIELD '02' ID 'ZAGENCY' FIELD travel-AgencyID.
      DATA(update) = COND #( WHEN sy-subrc = 0 THEN if_abap_behv=>auth-allowed ELSE if_abap_behv=>auth-unauthorized ).
      AUTHORITY-CHECK OBJECT 'ZAO_TRAVL' ID 'ACTVT' FIELD '06' ID 'ZAGENCY' FIELD travel-AgencyID.
      DATA(delete) = COND #( WHEN sy-subrc = 0 THEN if_abap_behv=>auth-allowed ELSE if_abap_behv=>auth-unauthorized ).
      APPEND VALUE #( %tky                    = travel-%tky
                      %update                 = update
                      %delete                 = delete
                      %action-acceptTravel    = update
                      %action-deductDiscount  = update ) TO result.
    ENDLOOP.
  ENDMETHOD.

  METHOD get_instance_features.
    " A travel that is already accepted cannot be accepted again.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( OverallStatus ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels)
      FAILED failed.

    result = VALUE #( FOR travel IN travels
                      ( %tky                 = travel-%tky
                        %action-acceptTravel = COND #( WHEN travel-OverallStatus = travel_status-accepted
                                                       THEN if_abap_behv=>fc-o-disabled
                                                       ELSE if_abap_behv=>fc-o-enabled ) ) ).
  ENDMETHOD.

  METHOD acceptTravel.
    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( OverallStatus )
        WITH VALUE #( FOR key IN keys
                      ( %tky          = key-%tky
                        OverallStatus = travel_status-accepted ) ).

    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    result = VALUE #( FOR travel IN travels
                      ( %tky   = travel-%tky
                        %param = travel ) ).

    reported-travel = VALUE #( FOR travel IN travels
                               ( %tky = travel-%tky
                                 %msg = new_message( id       = 'ZRT_TRAVEL'
                                                     number   = '002'
                                                     severity = if_abap_behv_message=>severity-success
                                                     v1       = travel-TravelID ) ) ).
  ENDMETHOD.

  METHOD deductDiscount.
    " Reduces the booking fee by the percentage given as parameter.
    DATA travels_for_update TYPE TABLE FOR UPDATE zrt_r_travel\\Travel.

    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( BookingFee ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    LOOP AT keys INTO DATA(key).
      IF key-%param-DiscountPercent < 1 OR key-%param-DiscountPercent > 100.
        APPEND VALUE #( %tky = key-%tky ) TO failed-travel.
        APPEND VALUE #( %tky = key-%tky
                        %msg = new_message( id       = 'ZRT_TRAVEL'
                                            number   = '001'
                                            severity = if_abap_behv_message=>severity-error
                                            v1       = key-%param-DiscountPercent ) ) TO reported-travel.
        CONTINUE.
      ENDIF.
      READ TABLE travels INTO DATA(travel) WITH KEY TravelUUID = key-TravelUUID.
      IF sy-subrc = 0.
        APPEND VALUE #( %tky       = travel-%tky
                        BookingFee = travel-BookingFee * ( 100 - key-%param-DiscountPercent ) / 100 ) TO travels_for_update.
      ENDIF.
    ENDLOOP.

    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( BookingFee )
        WITH travels_for_update.

    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        ALL FIELDS WITH CORRESPONDING #( travels_for_update )
      RESULT DATA(updated).

    result = VALUE #( FOR u IN updated
                      ( %tky   = u-%tky
                        %param = u ) ).
  ENDMETHOD.

  METHOD copyTravel.
    " The copy is a new open travel with the same data and without bookings.
    DATA copies TYPE TABLE FOR CREATE zrt_r_travel\\Travel.

    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    LOOP AT keys INTO DATA(key).
      READ TABLE travels INTO DATA(travel) WITH KEY TravelUUID = key-TravelUUID.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      APPEND VALUE #( %cid         = key-%cid
                      TravelID     = travel-TravelID
                      AgencyID     = travel-AgencyID
                      CustomerID   = travel-CustomerID
                      BeginDate    = travel-BeginDate
                      EndDate      = travel-EndDate
                      BookingFee   = travel-BookingFee
                      CurrencyCode = travel-CurrencyCode
                      Description  = |Copy of { travel-Description }| ) TO copies.
    ENDLOOP.

    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        CREATE FIELDS ( TravelID AgencyID CustomerID BeginDate EndDate BookingFee CurrencyCode Description )
        WITH copies
      MAPPED DATA(created).

    mapped-travel = created-travel.
  ENDMETHOD.

  METHOD reCalcTotalPrice.
    " Total price = booking fee + flight prices of the bookings in the travel currency.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( BookingFee CurrencyCode ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel BY \_Booking
        FIELDS ( TravelUUID FlightPrice CurrencyCode ) WITH CORRESPONDING #( travels )
      RESULT DATA(bookings).

    LOOP AT travels ASSIGNING FIELD-SYMBOL(<travel>).
      <travel>-TotalPrice = <travel>-BookingFee.
      " Bookings in another currency are not converted by the reference fixture.
      LOOP AT bookings INTO DATA(booking)
           WHERE TravelUUID = <travel>-TravelUUID AND CurrencyCode = <travel>-CurrencyCode.
        <travel>-TotalPrice = <travel>-TotalPrice + booking-FlightPrice.
      ENDLOOP.
    ENDLOOP.

    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( TotalPrice )
        WITH CORRESPONDING #( travels ).
  ENDMETHOD.

  METHOD setStatusOpen.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( OverallStatus ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    DELETE travels WHERE OverallStatus IS NOT INITIAL.
    CHECK travels IS NOT INITIAL.

    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( OverallStatus )
        WITH VALUE #( FOR travel IN travels
                      ( %tky          = travel-%tky
                        OverallStatus = travel_status-open ) ).
  ENDMETHOD.

  METHOD calculateTotalPrice.
    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        EXECUTE reCalcTotalPrice
        FROM CORRESPONDING #( keys ).
  ENDMETHOD.

  METHOD validateDates.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( BeginDate EndDate ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    LOOP AT travels INTO DATA(travel).
      IF travel-BeginDate IS INITIAL OR travel-EndDate IS INITIAL.
        APPEND VALUE #( %tky = travel-%tky ) TO failed-travel.
        APPEND VALUE #( %tky               = travel-%tky
                        %msg               = new_message_with_text(
                                               severity = if_abap_behv_message=>severity-error
                                               text     = 'Begin date and end date are required' )
                        %element-BeginDate = if_abap_behv=>mk-on
                        %element-EndDate   = if_abap_behv=>mk-on ) TO reported-travel.
      ELSEIF travel-EndDate < travel-BeginDate.
        APPEND VALUE #( %tky = travel-%tky ) TO failed-travel.
        APPEND VALUE #( %tky             = travel-%tky
                        %msg             = new_message_with_text(
                                             severity = if_abap_behv_message=>severity-error
                                             text     = 'End date must not be before begin date' )
                        %element-EndDate = if_abap_behv=>mk-on ) TO reported-travel.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.

CLASS lhc_booking DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS calculateTotalPrice FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Booking~calculateTotalPrice.
ENDCLASS.

CLASS lhc_booking IMPLEMENTATION.

  METHOD calculateTotalPrice.
    " A new or changed flight price changes the total price of the travel.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Booking BY \_Travel
        FIELDS ( TravelUUID ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        EXECUTE reCalcTotalPrice
        FROM CORRESPONDING #( travels ).
  ENDMETHOD.

ENDCLASS.
