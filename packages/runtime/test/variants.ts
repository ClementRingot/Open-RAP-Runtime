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

// ---------------------------------------------------------------------------------------------
// consumption of remote APIs (D31)

/** The consumption model class of a service consumption model (SCM2) for the travel service (V4). */
const CONSUMPTION_MODEL_CLASS = `"! <p class="shorttext synchronized">Consumption model for client proxy - generated</p>
"! This class has been generated based on the metadata with namespace
"! <em>com.sap.gateway.srvd.zrt_ui_travel.v0001</em>
CLASS zscm_rt_travel DEFINITION
  PUBLIC
  INHERITING FROM /iwbep/cl_v4_abs_pm_model_prov
  CREATE PUBLIC.

  PUBLIC SECTION.

    TYPES:
      "! <p class="shorttext synchronized">Value Control Structure of TRAVEL_TYPE</p>
      BEGIN OF tys_value_controls_1,
        "! BEGIN_DATE
        begin_date            TYPE /iwbep/v4_value_control,
        "! END_DATE
        end_date              TYPE /iwbep/v4_value_control,
        "! LOCAL_LAST_CHANGED_AT
        local_last_changed_at TYPE /iwbep/v4_value_control,
      END OF tys_value_controls_1.

    TYPES:
      "! <p class="shorttext synchronized">Travel</p>
      BEGIN OF tys_travel_type,
        "! <em>Value Control Structure</em>
        value_controls        TYPE tys_value_controls_1,
        "! <em>Key property</em> TravelUUID
        travel_uuid           TYPE sysuuid_x16,
        "! TravelID
        travel_id             TYPE c LENGTH 8,
        "! AgencyID
        agency_id             TYPE c LENGTH 6,
        "! CustomerID
        customer_id           TYPE c LENGTH 6,
        "! BeginDate
        begin_date            TYPE datn,
        "! EndDate
        end_date              TYPE datn,
        "! BookingFee
        booking_fee           TYPE p LENGTH 9 DECIMALS 2,
        "! TotalPrice
        total_price           TYPE p LENGTH 9 DECIMALS 2,
        "! CurrencyCode
        currency_code         TYPE c LENGTH 5,
        "! Description
        description           TYPE c LENGTH 256,
        "! OverallStatus
        overall_status        TYPE c LENGTH 1,
        "! LocalLastChangedAt
        local_last_changed_at TYPE timestampl,
        "! odata.etag
        etag                  TYPE string,
      END OF tys_travel_type,
      "! <p class="shorttext synchronized">List of Travel</p>
      tyt_travel_type TYPE STANDARD TABLE OF tys_travel_type WITH DEFAULT KEY.

    CONSTANTS:
      "! <p class="shorttext synchronized">Internal Names of the entity sets</p>
      BEGIN OF gcs_entity_set,
        "! Travel
        "! <br/> Collection of type 'Travel'
        travel TYPE /iwbep/if_cp_runtime_types=>ty_entity_set_name VALUE 'TRAVEL',
      END OF gcs_entity_set .

    CONSTANTS:
      "! <p class="shorttext synchronized">Internal names for entity types</p>
      BEGIN OF gcs_entity_type,
        "! <p class="shorttext synchronized">Internal names for TRAVEL_TYPE</p>
        "! See also structure type {@link ..tys_travel_type}
        BEGIN OF travel_type,
          "! <p class="shorttext synchronized">Navigation properties</p>
          BEGIN OF navigation,
            "! Dummy field - Structure must not be empty
            dummy TYPE int1 VALUE 0,
          END OF navigation,
        END OF travel_type,
      END OF gcs_entity_type.

    METHODS /iwbep/if_v4_mp_basic_pm~define REDEFINITION.

  PRIVATE SECTION.

    "! <p class="shorttext synchronized">Model</p>
    DATA mo_model TYPE REF TO /iwbep/if_v4_pm_model.

    "! <p class="shorttext synchronized">Define TRAVEL_TYPE</p>
    "! @raising /iwbep/cx_gateway | <p class="shorttext synchronized">Gateway Exception</p>
    METHODS def_travel_type RAISING /iwbep/cx_gateway.

ENDCLASS.


CLASS zscm_rt_travel IMPLEMENTATION.

  METHOD /iwbep/if_v4_mp_basic_pm~define.
    mo_model = io_model.
    mo_model->set_schema_namespace( 'com.sap.gateway.srvd.zrt_ui_travel.v0001' ) ##NO_TEXT.
    def_travel_type( ).
  ENDMETHOD.


  METHOD def_travel_type.
    DATA lo_entity_type        TYPE REF TO /iwbep/if_v4_pm_entity_type.
    DATA lo_entity_set         TYPE REF TO /iwbep/if_v4_pm_entity_set.
    DATA lo_primitive_property TYPE REF TO /iwbep/if_v4_pm_prim_prop.

    lo_entity_type = mo_model->create_entity_type_by_struct(
                                    iv_entity_type_name       = 'TRAVEL_TYPE'
                                    is_structure              = VALUE tys_travel_type( )
                                    iv_do_gen_prim_props         = abap_true
                                    iv_do_gen_prim_prop_colls    = abap_true
                                    iv_do_add_conv_to_prim_props = abap_true ).

    lo_entity_type->set_edm_name( 'Travel' ) ##NO_TEXT.

    lo_entity_set = lo_entity_type->create_entity_set( 'TRAVEL' ).
    lo_entity_set->set_edm_name( 'Travel' ) ##NO_TEXT.

    lo_primitive_property = lo_entity_type->get_primitive_property( 'TRAVEL_UUID' ).
    lo_primitive_property->set_edm_name( 'TravelUUID' ) ##NO_TEXT.
    lo_primitive_property->set_edm_type( 'Guid' ) ##NO_TEXT.
    lo_primitive_property->set_is_key( ).
  ENDMETHOD.

ENDCLASS.
`;

const CONSUMPTION_MODEL_XML = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <VSEOCLASS>
    <CLSNAME>ZSCM_RT_TRAVEL</CLSNAME>
    <LANGU>E</LANGU>
    <DESCRIPT>Consumption model for client proxy - generated</DESCRIPT>
    <STATE>1</STATE>
    <CLSCCINCL>X</CLSCCINCL>
    <FIXPT>X</FIXPT>
    <UNICODE>X</UNICODE>
   </VSEOCLASS>
  </asx:values>
 </asx:abap>
</abapGit>
`;

/** The abstract entity of a service consumption model (SCM, OData V2), with value controls. */
const LEGACY_ABSTRACT_ENTITY = `/********** GENERATED on 11/10/2026 at 10:00:00 by CB9980000000**************/
 @OData.entitySet.name: 'LegacyTravelSet'
 @OData.entityType.name: 'LegacyTravel'
 define root abstract entity ZRT_A_LEGACY_TRAVEL {
 key TravelID : abap.char( 8 ) ;
 @Odata.property.valueControl: 'Description_vc'
 Description : abap.char( 80 ) ;
 Description_vc : RAP_CP_ODATA_VALUE_CONTROL ;
 @Semantics.amount.currencyCode: 'CurrencyCode'
 Price : abap.curr( 16, 2 ) ;
 CurrencyCode : abap.cuky( 5 ) ;
 StartDate : RAP_CP_ODATA_V2_EDM_DATETIME ;
 ChangedAt : tzntstmpl ;
 Confirmed : abap_boolean ;
 Nights : abap.int4 ;

 }
`;

const LEGACY_ABSTRACT_ENTITY_XML = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DDLS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DDLS>
    <DDLNAME>ZRT_A_LEGACY_TRAVEL</DDLNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <DDTEXT>Travels of the legacy system</DDTEXT>
    <SOURCE_TYPE>A</SOURCE_TYPE>
   </DDLS>
  </asx:values>
 </asx:abap>
</abapGit>
`;

const REMOTE_DEFINITIONS = `
    METHODS rateTravel FOR MODIFY
      IMPORTING keys FOR ACTION Travel~rateTravel.

    METHODS importRemote FOR MODIFY
      IMPORTING keys FOR ACTION Travel~importRemote RESULT result.

    METHODS exportRemote FOR MODIFY
      IMPORTING keys FOR ACTION Travel~exportRemote.

    METHODS importLegacy FOR MODIFY
      IMPORTING keys FOR ACTION Travel~importLegacy.
ENDCLASS.`;

const REMOTE_IMPLEMENTATIONS = `
  METHOD rateTravel.
    " a REST API: the HTTP client of ABAP Cloud, a destination with basic authentication
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( TravelID Description ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    LOOP AT travels INTO DATA(travel).
      TRY.
          DATA(client) = cl_web_http_client_manager=>create_by_http_destination(
                           cl_http_destination_provider=>create_by_cloud_destination( i_name       = 'RATINGS'
                                                                                      i_authn_mode = if_a4c_cp_service=>service_specific ) ).
          DATA(request) = client->get_http_request( ).
          request->set_uri_path( |/api/ratings/{ travel-TravelID }| ).
          request->set_query( 'scale=5' ).
          request->set_header_fields( VALUE #( ( name = if_web_http_header=>accept value = if_web_http_header=>accept_application_json )
                                               ( name = 'X-Travel' value = |{ travel-TravelID }| ) ) ).
          request->set_content_type( 'application/json' ).
          request->set_text( |\\{"travel":"{ travel-TravelID }"\\}| ).
          DATA(response) = client->execute( if_web_http_client=>post ).
          DATA(status) = response->get_status( ).
          IF status-code <> 200.
            APPEND VALUE #( %tky = travel-%tky ) TO failed-travel.
            APPEND VALUE #( %tky = travel-%tky
                            %msg = new_message_with_text( text = |Rating service: { status-code } { status-reason }| ) ) TO reported-travel.
            CONTINUE.
          ENDIF.
          DATA(rating) = response->get_text( ).
          DATA(source) = response->get_header_field( 'X-Source' ).
          client->close( ).

          MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
            ENTITY Travel
              UPDATE FIELDS ( Description )
              WITH VALUE #( ( %tky = travel-%tky Description = |{ travel-Description } ({ rating } stars, { source })| ) ).
        CATCH cx_http_dest_provider_error cx_web_http_client_error cx_web_message_error INTO DATA(error).
          APPEND VALUE #( %tky = travel-%tky ) TO failed-travel.
          APPEND VALUE #( %tky = travel-%tky
                          %msg = new_message_with_text( text = error->get_text( ) ) ) TO reported-travel.
      ENDTRY.
    ENDLOOP.
  ENDMETHOD.

  METHOD importRemote.
    " an OData V4 service: the client proxy with the consumption model class of an SCM2
    DATA remote_travels TYPE zscm_rt_travel=>tyt_travel_type.
    DATA remote_travel TYPE zscm_rt_travel=>tys_travel_type.
    DATA travel_ids TYPE RANGE OF zscm_rt_travel=>tys_travel_type-travel_id.
    DATA updates TYPE TABLE FOR UPDATE zrt_r_travel\\\\Travel.

    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( TravelID ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    LOOP AT travels INTO DATA(travel).
      APPEND VALUE #( sign = 'I' option = 'EQ' low = travel-TravelID ) TO travel_ids.
    ENDLOOP.

    TRY.
        DATA(destination) = cl_http_destination_provider=>create_by_comm_arrangement(
                              comm_scenario  = 'ZRT_TRAVEL_REMOTE'
                              comm_system_id = 'TRAVEL_SYSTEM'
                              service_id     = 'ZRT_TRAVEL_REMOTE_REST' ).
        DATA(http_client) = cl_web_http_client_manager=>create_by_http_destination( destination ).
        DATA(proxy) = /iwbep/cl_cp_factory_remote=>create_v4_remote_proxy(
                        is_proxy_model_key       = VALUE #( repository_id       = 'DEFAULT'
                                                            proxy_model_id      = 'ZSCM_RT_TRAVEL'
                                                            proxy_model_version = '0001' )
                        io_http_client           = http_client
                        iv_relative_service_root = '/sap/opu/odata4/sap/zrt_ui_travel_o4/srvd/sap/zrt_ui_travel/0001/' ).

        DATA(read_request) = proxy->create_resource_for_entity_set( zscm_rt_travel=>gcs_entity_set-travel )->create_request_for_read( ).
        DATA(filter_factory) = read_request->create_filter_factory( ).
        read_request->set_filter( filter_factory->create_by_range( iv_property_path = 'TRAVEL_ID' it_range = travel_ids ) ).
        read_request->set_select_properties( VALUE #( ( \`TRAVEL_UUID\` ) ( \`TRAVEL_ID\` ) ( \`DESCRIPTION\` ) ( \`BOOKING_FEE\` ) ( \`BEGIN_DATE\` ) ( \`LOCAL_LAST_CHANGED_AT\` ) ) ).
        read_request->set_orderby( VALUE #( ( property_path = 'TRAVEL_ID' descending = abap_true ) ) ).
        read_request->set_top( 10 ).
        read_request->request_count( ).
        DATA(read_response) = read_request->execute( ).
        read_response->get_business_data( IMPORTING et_business_data = remote_travels ).
        DATA(count) = read_response->get_count( ).

        " one instance by its key
        IF remote_travels IS NOT INITIAL.
          DATA(single_request) = proxy->create_resource_for_entity_set( zscm_rt_travel=>gcs_entity_set-travel
                                   )->navigate_with_key( VALUE zscm_rt_travel=>tys_travel_type( travel_uuid = remote_travels[ 1 ]-travel_uuid )
                                   )->create_request_for_read( ).
          DATA(single_response) = single_request->execute( ).
          single_response->get_business_data( IMPORTING es_business_data = remote_travel ).
        ENDIF.

      CATCH /iwbep/cx_cp_remote INTO DATA(remote_error).
        LOOP AT keys INTO DATA(failed_key).
          APPEND VALUE #( %tky = failed_key-%tky ) TO failed-travel.
          APPEND VALUE #( %tky = failed_key-%tky
                          %msg = new_message_with_text( text = |Remote service ({ remote_error->http_status_code }): { remote_error->get_text( ) }| ) ) TO reported-travel.
        ENDLOOP.
        RETURN.
      CATCH /iwbep/cx_gateway cx_web_http_client_error cx_http_dest_provider_error INTO DATA(error).
        LOOP AT keys INTO failed_key.
          APPEND VALUE #( %tky = failed_key-%tky ) TO failed-travel.
          APPEND VALUE #( %tky = failed_key-%tky
                          %msg = new_message_with_text( text = error->get_text( ) ) ) TO reported-travel.
        ENDLOOP.
        RETURN.
    ENDTRY.

    LOOP AT travels INTO travel.
      READ TABLE remote_travels INTO DATA(remote) WITH KEY travel_id = travel-TravelID.
      IF sy-subrc = 0.
        APPEND VALUE #( %tky = travel-%tky Description = remote-description BookingFee = remote-booking_fee ) TO updates.
      ENDIF.
    ENDLOOP.

    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( Description BookingFee ) WITH updates.

    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(imported).

    result = VALUE #( FOR i IN imported ( %tky = i-%tky %param = i ) ).

    DATA changed_at TYPE string.
    changed_at = remote_travel-local_last_changed_at.
    CONDENSE changed_at.
    LOOP AT imported INTO DATA(entry).
      APPEND VALUE #( %tky = entry-%tky
                      %msg = new_message_with_text( severity = if_abap_behv_message=>severity-information
                                                    text     = |{ count } remote travel(s); { remote_travel-travel_id } begins on { remote_travel-begin_date }, changed at { changed_at }, ETag { remote_travel-etag }| ) ) TO reported-travel.
    ENDLOOP.
  ENDMETHOD.

  METHOD exportRemote.
    " OData V4 writes: create, update with the ETag, delete (CSRF token fetched by the proxy)
    DATA archived TYPE zscm_rt_travel=>tys_travel_type.

    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    LOOP AT travels INTO DATA(travel).
      TRY.
          DATA(proxy) = cl_web_odata_client_factory=>create_v4_remote_proxy(
                          iv_service_definition_name = 'ZSC_RT_ARCHIVE'
                          io_http_client             = cl_web_http_client_manager=>create_by_http_destination(
                                                         cl_http_destination_provider=>create_by_cloud_destination(
                                                           i_name       = 'ARCHIVE'
                                                           i_authn_mode = if_a4c_cp_service=>service_specific ) )
                          iv_relative_service_root   = '/odata/v4/archive/' ).

          DATA(create_request) = proxy->create_resource_for_entity_set( zscm_rt_travel=>gcs_entity_set-travel )->create_request_for_create( ).
          create_request->set_business_data(
            is_business_data     = VALUE zscm_rt_travel=>tys_travel_type( travel_uuid           = travel-TravelUUID
                                                                         travel_id             = travel-TravelID
                                                                         begin_date            = travel-BeginDate
                                                                         booking_fee           = travel-BookingFee
                                                                         currency_code         = travel-CurrencyCode
                                                                         description           = travel-Description
                                                                         local_last_changed_at = travel-LocalLastChangedAt )
            it_provided_property = VALUE #( ( \`TRAVEL_UUID\` ) ( \`TRAVEL_ID\` ) ( \`BEGIN_DATE\` ) ( \`BOOKING_FEE\` )
                                            ( \`CURRENCY_CODE\` ) ( \`DESCRIPTION\` ) ( \`LOCAL_LAST_CHANGED_AT\` ) ) ).
          DATA(create_response) = create_request->execute( ).
          create_response->get_business_data( IMPORTING es_business_data = archived ).

          DATA(archive_entry) = proxy->create_resource_for_entity_set( zscm_rt_travel=>gcs_entity_set-travel
                                  )->navigate_with_key( VALUE zscm_rt_travel=>tys_travel_type( travel_uuid = archived-travel_uuid ) ).
          DATA(update_request) = archive_entry->create_request_for_update( /iwbep/if_cp_request_update=>gcs_update_semantic-patch ).
          update_request->set_business_data( is_business_data     = VALUE zscm_rt_travel=>tys_travel_type( description = |{ archived-description } (archived)| )
                                             it_provided_property = VALUE #( ( \`DESCRIPTION\` ) ) ).
          update_request->set_if_match( archived-etag ).
          DATA(update_response) = update_request->execute( ).
          update_response->get_business_data( IMPORTING es_business_data = archived ).

          DATA(delete_request) = archive_entry->create_request_for_delete( ).
          delete_request->set_if_match( archived-etag ).
          delete_request->execute( ).

          APPEND VALUE #( %tky = travel-%tky
                          %msg = new_message_with_text( severity = if_abap_behv_message=>severity-success
                                                        text     = |Archived: { archived-description } ({ archived-etag })| ) ) TO reported-travel.
        CATCH /iwbep/cx_cp_remote INTO DATA(remote_error).
          APPEND VALUE #( %tky = travel-%tky ) TO failed-travel.
          APPEND VALUE #( %tky = travel-%tky
                          %msg = new_message_with_text( text = |Archive refused ({ remote_error->http_status_code }): { remote_error->get_text( ) }| ) ) TO reported-travel.
        CATCH /iwbep/cx_gateway cx_web_http_client_error cx_http_dest_provider_error INTO DATA(error).
          APPEND VALUE #( %tky = travel-%tky ) TO failed-travel.
          APPEND VALUE #( %tky = travel-%tky %msg = new_message_with_text( text = error->get_text( ) ) ) TO reported-travel.
      ENDTRY.
    ENDLOOP.
  ENDMETHOD.

  METHOD importLegacy.
    " an OData V2 service: the client proxy with the abstract entity of a service consumption model
    DATA legacy TYPE STANDARD TABLE OF zrt_a_legacy_travel WITH EMPTY KEY.
    DATA travel_ids TYPE RANGE OF zrt_a_legacy_travel-travelid.
    DATA nights TYPE RANGE OF i.
    DATA updates TYPE TABLE FOR UPDATE zrt_r_travel\\\\Travel.

    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( TravelID ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    travel_ids = VALUE #( FOR t IN travels ( sign = 'I' option = 'EQ' low = t-TravelID ) ).
    nights = VALUE #( ( sign = 'I' option = 'BT' low = 1 high = 30 ) ).

    TRY.
        DATA(proxy) = cl_web_odata_client_factory=>create_v2_remote_proxy(
                        iv_service_definition_name = 'ZSC_RT_LEGACY'
                        io_http_client             = cl_web_http_client_manager=>create_by_http_destination(
                                                       cl_http_destination_provider=>create_by_comm_arrangement( comm_scenario = 'ZRT_LEGACY' ) )
                        iv_relative_service_root   = '/sap/opu/odata/sap/ZLEGACY_SRV/' ).
        DATA(request) = proxy->create_resource_for_entity_set( 'LEGACYTRAVELSET' )->create_request_for_read( ).
        DATA(filter_factory) = request->create_filter_factory( ).
        DATA(id_filter) = filter_factory->create_by_range( iv_property_path = 'TRAVELID' it_range = travel_ids ).
        DATA(nights_filter) = filter_factory->create_by_range( iv_property_path = 'NIGHTS' it_range = nights ).
        request->set_filter( id_filter->and( nights_filter ) ).
        request->set_top( 5 ).
        request->request_count( ).
        DATA(response) = request->execute( ).
        response->get_business_data( IMPORTING et_business_data = legacy ).
        DATA(count) = response->get_count( ).
      CATCH /iwbep/cx_gateway cx_web_http_client_error cx_http_dest_provider_error INTO DATA(error).
        LOOP AT keys INTO DATA(failed_key).
          APPEND VALUE #( %tky = failed_key-%tky ) TO failed-travel.
          APPEND VALUE #( %tky = failed_key-%tky %msg = new_message_with_text( text = error->get_text( ) ) ) TO reported-travel.
        ENDLOOP.
        RETURN.
    ENDTRY.

    LOOP AT travels INTO DATA(travel).
      READ TABLE legacy INTO DATA(entry) WITH KEY travelid = travel-TravelID.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.
      APPEND VALUE #( %tky = travel-%tky Description = entry-description ) TO updates.
      DATA(changed) = CONV string( entry-changedat ).
      CONDENSE changed.
      APPEND VALUE #( %tky = travel-%tky
                      %msg = new_message_with_text( severity = if_abap_behv_message=>severity-information
                                                    text     = |{ count } legacy travel(s): { entry-price } { entry-currencycode }, starts { entry-startdate DIV 1000000 }, { entry-nights } nights, confirmed { entry-confirmed }, changed { changed }| ) ) TO reported-travel.
    ENDLOOP.

    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( Description ) WITH updates.
  ENDMETHOD.

ENDCLASS.

CLASS lhc_booking DEFINITION`;

/**
 * A BO that consumes remote APIs in its actions: a REST API with the HTTP client (rateTravel),
 * an OData V4 service with the consumption model class of an SCM2 (importRemote reads,
 * exportRemote writes), an OData V2 service with the abstract entity of an SCM (importLegacy).
 */
export function remoteVariant(): Record<string, string | ((content: string) => string)> {
  return {
    "zscm_rt_travel.clas.abap": CONSUMPTION_MODEL_CLASS,
    "zscm_rt_travel.clas.xml": CONSUMPTION_MODEL_XML,
    "zrt_a_legacy_travel.ddls.asddls": LEGACY_ABSTRACT_ENTITY,
    "zrt_a_legacy_travel.ddls.xml": LEGACY_ABSTRACT_ENTITY_XML,
    "zrt_r_travel.bdef.asbdef": (c) =>
      edit(c, [["  internal action reCalcTotalPrice;", "  internal action reCalcTotalPrice;\n  action rateTravel;\n  action importRemote result [1] $self;\n  action exportRemote;\n  action importLegacy;"]]),
    "zrt_c_travel.bdef.asbdef": (c) =>
      edit(c, [["  use action copyTravel;", "  use action copyTravel;\n  use action rateTravel;\n  use action importRemote;\n  use action exportRemote;\n  use action importLegacy;"]]),
    [ABP]: (c) => {
      const first = c.indexOf("ENDCLASS.");
      const withDefinitions = `${c.slice(0, first)}${REMOTE_DEFINITIONS.trimStart()}${c.slice(first + "ENDCLASS.".length)}`;
      return edit(withDefinitions, [["ENDCLASS.\n\nCLASS lhc_booking DEFINITION", REMOTE_IMPLEMENTATIONS.trimStart()]]);
    },
  };
}
