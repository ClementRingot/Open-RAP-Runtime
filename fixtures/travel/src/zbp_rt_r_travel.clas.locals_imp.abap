CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    CONSTANTS:
      BEGIN OF travel_status,
        open     TYPE c LENGTH 1 VALUE 'O',
        accepted TYPE c LENGTH 1 VALUE 'A',
      END OF travel_status.

    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR Travel RESULT result.

    METHODS get_instance_features FOR INSTANCE FEATURES
      IMPORTING keys REQUEST requested_features FOR Travel RESULT result.

    METHODS acceptTravel FOR MODIFY
      IMPORTING keys FOR ACTION Travel~acceptTravel RESULT result.

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
    " The reference fixture allows every operation.
    IF requested_authorizations-%create = if_abap_behv=>mk-on.
      result-%create = if_abap_behv=>auth-allowed.
    ENDIF.
    IF requested_authorizations-%update = if_abap_behv=>mk-on.
      result-%update = if_abap_behv=>auth-allowed.
    ENDIF.
    IF requested_authorizations-%delete = if_abap_behv=>mk-on.
      result-%delete = if_abap_behv=>auth-allowed.
    ENDIF.
    IF requested_authorizations-%action-acceptTravel = if_abap_behv=>mk-on.
      result-%action-acceptTravel = if_abap_behv=>auth-allowed.
    ENDIF.
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
