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

// ---------------------------------------------------------------------------------------------
// savers

/** The saver of the unmanaged save: the travels through MAPPING FROM ENTITY, the bookings in plain ABAP SQL. */
const UNMANAGED_SAVER = `
CLASS lsc_zrt_r_travel DEFINITION INHERITING FROM cl_abap_behavior_saver.
  PROTECTED SECTION.
    METHODS save_modified REDEFINITION.
    METHODS cleanup REDEFINITION.
ENDCLASS.

CLASS lsc_zrt_r_travel IMPLEMENTATION.
  METHOD save_modified.
    IF create-travel IS NOT INITIAL.
      INSERT zrt_travel FROM TABLE @create-travel MAPPING FROM ENTITY.
    ENDIF.
    IF update-travel IS NOT INITIAL.
      UPDATE zrt_travel FROM TABLE @update-travel INDICATORS SET STRUCTURE %control MAPPING FROM ENTITY.
    ENDIF.
    IF delete-travel IS NOT INITIAL.
      DELETE zrt_travel FROM TABLE @delete-travel MAPPING FROM ENTITY.
    ENDIF.

    " the bookings in plain ABAP SQL, the mapping written by hand
    DATA bookings TYPE STANDARD TABLE OF zrt_booking WITH EMPTY KEY.
    bookings = VALUE #( FOR b IN create-booking ( booking_uuid   = b-BookingUUID
                                                  parent_uuid    = b-TravelUUID
                                                  booking_id     = b-BookingID
                                                  booking_date   = b-BookingDate
                                                  carrier_id     = b-CarrierID
                                                  connection_id  = b-ConnectionID
                                                  flight_date    = b-FlightDate
                                                  flight_price   = b-FlightPrice
                                                  currency_code  = b-CurrencyCode
                                                  booking_status = b-BookingStatus ) ).
    IF bookings IS NOT INITIAL.
      INSERT zrt_booking FROM TABLE @bookings.
    ENDIF.
    LOOP AT update-booking INTO DATA(changed) WHERE %control-FlightPrice = if_abap_behv=>mk-on.
      UPDATE zrt_booking SET flight_price = @changed-FlightPrice WHERE booking_uuid = @changed-BookingUUID.
    ENDLOOP.
    LOOP AT delete-booking INTO DATA(deleted).
      DELETE FROM zrt_booking WHERE booking_uuid = @deleted-BookingUUID.
    ENDLOOP.

    APPEND new_message_with_text( severity = if_abap_behv_message=>severity-success
                                  text     = |Saved by save_modified| ) TO reported-%other.
  ENDMETHOD.

  METHOD cleanup.
  ENDMETHOD.
ENDCLASS.
`;

/**
 * Unmanaged save: no persistent tables, save_modified writes the travels (MAPPING FROM ENTITY,
 * INDICATORS) and the bookings (plain INSERT, UPDATE, DELETE).
 */
export function unmanagedSaveVariant(): Record<string, string | ((content: string) => string)> {
  return {
    "zrt_r_travel.bdef.asbdef": (c) =>
      edit(c, [
        ["managed implementation in class zbp_rt_r_travel unique;", "managed with unmanaged save implementation in class zbp_rt_r_travel unique;"],
        ["persistent table zrt_travel\n", ""],
        ["persistent table zrt_booking\n", ""],
      ]),
    [ABP]: (c) => `${c.trimEnd()}\n${UNMANAGED_SAVER}`,
  };
}

const TRAVEL_LOG_TABLE = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_TABL" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD02V>
    <TABNAME>ZRT_TRAVEL_LOG</TABNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <TABCLASS>TRANSP</TABCLASS>
    <DDTEXT>Changes of the travels</DDTEXT>
    <CONTFLAG>A</CONTFLAG>
   </DD02V>
   <DD03P_TABLE>
    <DD03P>
     <FIELDNAME>LOG_UUID</FIELDNAME>
     <KEYFLAG>X</KEYFLAG>
     <ROLLNAME>SYSUUID_X16</ROLLNAME>
     <NOTNULL>X</NOTNULL>
     <COMPTYPE>E</COMPTYPE>
    </DD03P>
    <DD03P>
     <FIELDNAME>TRAVEL_UUID</FIELDNAME>
     <ROLLNAME>SYSUUID_X16</ROLLNAME>
     <COMPTYPE>E</COMPTYPE>
    </DD03P>
    <DD03P>
     <FIELDNAME>OPERATION</FIELDNAME>
     <INTTYPE>C</INTTYPE>
     <INTLEN>000002</INTLEN>
     <DATATYPE>CHAR</DATATYPE>
     <LENG>000001</LENG>
     <MASK>  CHAR</MASK>
    </DD03P>
    <DD03P>
     <FIELDNAME>DESCRIPTION</FIELDNAME>
     <INTTYPE>C</INTTYPE>
     <INTLEN>000512</INTLEN>
     <DATATYPE>CHAR</DATATYPE>
     <LENG>000256</LENG>
     <MASK>  CHAR</MASK>
    </DD03P>
    <DD03P>
     <FIELDNAME>LOGGED_BY</FIELDNAME>
     <INTTYPE>C</INTTYPE>
     <INTLEN>000024</INTLEN>
     <DATATYPE>CHAR</DATATYPE>
     <LENG>000012</LENG>
     <MASK>  CHAR</MASK>
    </DD03P>
    <DD03P>
     <FIELDNAME>LOGGED_ON</FIELDNAME>
     <INTTYPE>D</INTTYPE>
     <INTLEN>000016</INTLEN>
     <DATATYPE>DATS</DATATYPE>
     <LENG>000008</LENG>
     <MASK>  DATS</MASK>
    </DD03P>
   </DD03P_TABLE>
  </asx:values>
 </asx:abap>
</abapGit>
`;

/**
 * The saver of the additional save: one log row per changed travel, in plain ABAP SQL; as a
 * cl_abap_behavior_saver_failed, it refuses one description (failed rolls the LUW back).
 */
const ADDITIONAL_SAVER = `
CLASS lsc_zrt_r_travel DEFINITION INHERITING FROM cl_abap_behavior_saver_failed.
  PROTECTED SECTION.
    METHODS save_modified REDEFINITION.
ENDCLASS.

CLASS lsc_zrt_r_travel IMPLEMENTATION.
  METHOD save_modified.
    DATA log TYPE STANDARD TABLE OF zrt_travel_log WITH EMPTY KEY.
    DATA entry TYPE zrt_travel_log.

    entry-logged_by = sy-uname.
    entry-logged_on = cl_abap_context_info=>get_system_date( ).
    TRY.
        LOOP AT create-travel INTO DATA(created).
          entry-log_uuid = cl_system_uuid=>create_uuid_x16_static( ).
          entry-travel_uuid = created-TravelUUID.
          entry-operation = 'C'.
          entry-description = created-Description.
          APPEND entry TO log.
        ENDLOOP.
        LOOP AT update-travel INTO DATA(updated).
          IF updated-Description = 'Refused by the saver'.
            APPEND VALUE #( %tky = updated-%tky ) TO failed-travel.
            APPEND VALUE #( %tky = updated-%tky
                            %msg = new_message_with_text( text = 'The saver refuses this description' ) ) TO reported-travel.
            RETURN.
          ENDIF.
          entry-log_uuid = cl_system_uuid=>create_uuid_x16_static( ).
          entry-travel_uuid = updated-TravelUUID.
          entry-operation = 'U'.
          entry-description = COND #( WHEN updated-%control-Description = if_abap_behv=>mk-on THEN updated-Description ).
          APPEND entry TO log.
        ENDLOOP.
        LOOP AT delete-travel INTO DATA(deleted).
          entry-log_uuid = cl_system_uuid=>create_uuid_x16_static( ).
          entry-travel_uuid = deleted-TravelUUID.
          entry-operation = 'D'.
          CLEAR entry-description.
          APPEND entry TO log.
        ENDLOOP.
      CATCH cx_uuid_error.
        RETURN.
    ENDTRY.

    IF log IS NOT INITIAL.
      INSERT zrt_travel_log FROM TABLE @log.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
`;

/** Additional save: the RAP runtime writes the BO, save_modified writes a log table. */
export function additionalSaveVariant(): Record<string, string | ((content: string) => string)> {
  return {
    "zrt_travel_log.tabl.xml": TRAVEL_LOG_TABLE,
    "zrt_r_travel.bdef.asbdef": (c) => edit(c, [["managed implementation in class zbp_rt_r_travel unique;", "managed with additional save implementation in class zbp_rt_r_travel unique;"]]),
    [ABP]: (c) => `${c.trimEnd()}\n${ADDITIONAL_SAVER}`,
  };
}
