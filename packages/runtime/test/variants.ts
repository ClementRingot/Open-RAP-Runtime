/**
 * Variants of the reference BO shared by several test files.
 */

import { edit } from "./helpers.js";

const ABP = "zbp_rt_r_travel.clas.locals_imp.abap";

const TRAVEL_DEFINITIONS = `
    METHODS earlynumbering_create FOR NUMBERING
      IMPORTING entities FOR CREATE Travel.

    METHODS get_global_features FOR GLOBAL FEATURES
      IMPORTING REQUEST requested_features FOR Travel RESULT result.

    METHODS listBookings FOR MODIFY
      IMPORTING keys FOR ACTION Travel~listBookings RESULT result.

    METHODS mostExpensive FOR READ
      IMPORTING keys FOR FUNCTION Travel~mostExpensive RESULT result.

    METHODS markChanged FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Travel~markChanged.
ENDCLASS.`;

const TRAVEL_IMPLEMENTATIONS = `
  METHOD earlynumbering_create.
    " the key of a new travel comes from its travel ID: deterministic for the test
    LOOP AT entities INTO DATA(entity).
      APPEND VALUE #( %cid       = entity-%cid
                      TravelUUID = |000000000000000000000000{ entity-TravelID }| ) TO mapped-travel.
    ENDLOOP.
  ENDMETHOD.

  METHOD get_global_features.
    " travels are not deleted, copies are switched off
    IF requested_features-%delete = if_abap_behv=>mk-on.
      result-%delete = if_abap_behv=>fc-o-disabled.
    ENDIF.
    IF requested_features-%action-copyTravel = if_abap_behv=>mk-on.
      result-%action-copyTravel = if_abap_behv=>fc-o-disabled.
    ENDIF.
  ENDMETHOD.

  METHOD listBookings.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel BY \\_Booking
        ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(bookings).

    result = VALUE #( FOR booking IN bookings ( %tky-TravelUUID = booking-TravelUUID %param = CORRESPONDING #( booking ) ) ).
  ENDMETHOD.

  METHOD mostExpensive.
    SELECT FROM zrt_travel FIELDS travel_uuid ORDER BY total_price DESCENDING INTO TABLE @DATA(uuids) UP TO 1 ROWS.

    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        ALL FIELDS WITH VALUE #( FOR u IN uuids ( TravelUUID = u-travel_uuid ) )
      RESULT DATA(travels).

    result = VALUE #( FOR travel IN travels ( %cid = keys[ 1 ]-%cid %param = CORRESPONDING #( travel ) ) ).
  ENDMETHOD.

  METHOD markChanged.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( Description ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    DELETE travels WHERE Description CP '*(changed)'.
    CHECK travels IS NOT INITIAL.

    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( Description )
        WITH VALUE #( FOR travel IN travels ( %tky = travel-%tky Description = |{ travel-Description } (changed)| ) ).
  ENDMETHOD.

ENDCLASS.

CLASS lhc_booking DEFINITION`;

const INSTANCE_FEATURES: [string, string] = [
  `                        %action-acceptTravel = COND #( WHEN travel-OverallStatus = travel_status-accepted
                                                       THEN if_abap_behv=>fc-o-disabled
                                                       ELSE if_abap_behv=>fc-o-enabled ) ) ).`,
  `                        %action-acceptTravel = COND #( WHEN travel-OverallStatus = travel_status-accepted
                                                       THEN if_abap_behv=>fc-o-disabled
                                                       ELSE if_abap_behv=>fc-o-enabled )
                        %field-Description   = COND #( WHEN travel-OverallStatus = travel_status-accepted
                                                       THEN if_abap_behv=>fc-f-read_only
                                                       ELSE if_abap_behv=>fc-f-unrestricted ) ) ).`,
];

const BOOKING: [string, string] = [
  `    METHODS calculateTotalPrice FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Booking~calculateTotalPrice.
ENDCLASS.`,
  `    METHODS calculateTotalPrice FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Booking~calculateTotalPrice.

    METHODS recalcOnDelete FOR DETERMINE ON MODIFY
      IMPORTING keys FOR Booking~recalcOnDelete.
ENDCLASS.`,
];

const BOOKING_IMPLEMENTATION = `
  METHOD recalcOnDelete.
    " a deleted booking is in the database until the save: its travel is found there
    SELECT FROM zrt_booking FIELDS parent_uuid
      FOR ALL ENTRIES IN @keys WHERE booking_uuid = @keys-BookingUUID
      INTO TABLE @DATA(parents).

    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        EXECUTE reCalcTotalPrice
        FROM VALUE #( FOR parent IN parents ( TravelUUID = parent-parent_uuid ) ).
  ENDMETHOD.

ENDCLASS.`;

/**
 * Features of a managed BO that the reference fixture does not use: early numbering with a
 * `FOR NUMBERING` handler, global feature control of delete and of copyTravel, instance feature
 * control of Description (read-only once accepted), an action with an entity result [0..*], a
 * static function, determinations triggered by an update and by a deletion, side effects.
 */
export function featuresVariant(): Record<string, string | ((content: string) => string)> {
  return {
    "zrt_r_travel.bdef.asbdef": (c) =>
      edit(c, [
        ["persistent table zrt_travel\nlock master", "persistent table zrt_travel\nearly numbering\nlock master"],
        ["  delete;\n  association _Booking { create; }", "  delete ( features : global );\n  association _Booking { create; }"],
        ["  field ( numbering : managed, readonly ) TravelUUID;", "  field ( readonly ) TravelUUID;\n  field ( features : instance ) Description;"],
        ["  factory action copyTravel [1];", "  factory action ( features : global ) copyTravel [1];\n  action listBookings result [0..*] entity ZRT_R_Booking;\n  static function mostExpensive result [1] $self;"],
        ["  determination setStatusOpen on modify { create; }", "  determination setStatusOpen on modify { create; }\n  determination markChanged on modify { update; }"],
        ["  validation validateDates on save { create; field BeginDate, EndDate; }", "  validation validateDates on save { create; field BeginDate, EndDate; }\n\n  side effects\n  {\n    field BookingFee affects field TotalPrice;\n  }"],
        ["  determination calculateTotalPrice on modify { create; field FlightPrice, CurrencyCode; }", "  determination calculateTotalPrice on modify { create; field FlightPrice, CurrencyCode; }\n  determination recalcOnDelete on modify { delete; }"],
      ]),
    "zrt_c_travel.bdef.asbdef": (c) => edit(c, [["  use action copyTravel;", "  use action copyTravel;\n  use action listBookings;\n  use function mostExpensive;"]]),
    [ABP]: (c) => {
      const first = c.indexOf("ENDCLASS.");
      const withDefinitions = `${c.slice(0, first)}${TRAVEL_DEFINITIONS.trimStart()}${c.slice(first + "ENDCLASS.".length)}`;
      const last = withDefinitions.lastIndexOf("ENDCLASS.");
      const withBooking = `${withDefinitions.slice(0, last)}${BOOKING_IMPLEMENTATION.trimStart()}${withDefinitions.slice(last + "ENDCLASS.".length)}`;
      return edit(withBooking, [["ENDCLASS.\n\nCLASS lhc_booking DEFINITION", TRAVEL_IMPLEMENTATIONS.trimStart()], INSTANCE_FEATURES, BOOKING]);
    },
  };
}
