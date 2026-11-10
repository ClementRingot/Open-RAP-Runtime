/**
 * Clean-room ABAP for the consumption of remote APIs from a behavior pool (decision D31): the
 * HTTP client of ABAP Cloud (cl_http_destination_provider, cl_web_http_client_manager,
 * if_web_http_client, if_web_http_request, if_web_http_response) and the OData client proxy of
 * the service consumption model (/iwbep/cl_cp_factory_remote, cl_web_odata_client_factory and the
 * /iwbep/if_cp_* requests). The ABAP keeps the state of the objects; the kernel (ZRAP_EML) does
 * the network calls, reads the $metadata of the remote service and converts the values.
 */

import type { FrameworkSource } from "./framework.js";

const ZRAP_IF_HTTP = `INTERFACE zrap_if_http PUBLIC.
  TYPES: BEGIN OF ty_header,
           name  TYPE string,
           value TYPE string,
         END OF ty_header,
         tt_header TYPE STANDARD TABLE OF ty_header WITH EMPTY KEY.
ENDINTERFACE.
`;

/**
 * An exception with a text of its own (the message of the remote side), for get_text( ). The
 * classes under cx_static_check declare `zrap_text`; their subclasses inherit it.
 */
const textException = (name: string, superclass: string, attributes = ""): string => {
  const root = superclass.toLowerCase() === "cx_static_check";
  const http = attributes.includes("http_status_code");
  return `CLASS ${name} DEFINITION PUBLIC INHERITING FROM ${superclass} CREATE PUBLIC.
  PUBLIC SECTION.${root ? "\n    DATA zrap_text TYPE string READ-ONLY." : ""}${attributes === "" ? "" : `\n${attributes}`}
    METHODS constructor
      IMPORTING textid    LIKE textid OPTIONAL
                previous  LIKE previous OPTIONAL
                zrap_text TYPE string OPTIONAL${http ? "\n                http_status_code TYPE i OPTIONAL\n                http_error_body TYPE string OPTIONAL" : ""}.
ENDCLASS.

CLASS ${name} IMPLEMENTATION.
  METHOD constructor.
    super->constructor( textid = textid previous = previous${root ? "" : " zrap_text = zrap_text"} ).${root ? "\n    me->zrap_text = zrap_text." : ""}${http ? "\n    me->http_status_code = http_status_code.\n    me->http_error_body = http_error_body." : ""}
  ENDMETHOD.
ENDCLASS.
`;
};

const IF_HTTP_DESTINATION = `INTERFACE if_http_destination PUBLIC.
ENDINTERFACE.
`;

const ZRAP_CL_HTTP_DESTINATION = `CLASS zrap_cl_http_destination DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_http_destination.
    "! Base URL of the destination.
    DATA url TYPE string READ-ONLY.
    "! Name of the configured destination (credentials), empty for create_by_url.
    DATA name TYPE string READ-ONLY.
    METHODS constructor IMPORTING url TYPE string name TYPE string OPTIONAL.
ENDCLASS.

CLASS zrap_cl_http_destination IMPLEMENTATION.
  METHOD constructor.
    me->url = url.
    me->name = name.
  ENDMETHOD.
ENDCLASS.
`;

const CL_HTTP_DESTINATION_PROVIDER = `CLASS cl_http_destination_provider DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS create_by_url
      IMPORTING i_url                     TYPE csequence
      RETURNING VALUE(r_http_destination) TYPE REF TO if_http_destination
      RAISING   cx_http_dest_provider_error.
    CLASS-METHODS create_by_comm_arrangement
      IMPORTING comm_scenario             TYPE csequence
                comm_system_id            TYPE csequence OPTIONAL
                service_id                TYPE csequence OPTIONAL
      RETURNING VALUE(r_http_destination) TYPE REF TO if_http_destination
      RAISING   cx_http_dest_provider_error.
    CLASS-METHODS create_by_cloud_destination
      IMPORTING i_name                    TYPE csequence
                i_service_instance_name   TYPE csequence OPTIONAL
                i_authn_mode              TYPE any OPTIONAL
      RETURNING VALUE(r_http_destination) TYPE REF TO if_http_destination
      RAISING   cx_http_dest_provider_error.
ENDCLASS.

CLASS cl_http_destination_provider IMPLEMENTATION.
  METHOD create_by_url.
    IF i_url IS INITIAL.
      RAISE EXCEPTION TYPE cx_http_dest_provider_error EXPORTING zrap_text = |create_by_url: no URL|.
    ENDIF.
    r_http_destination = NEW zrap_cl_http_destination( url = |{ i_url }| ).
  ENDMETHOD.

  METHOD create_by_comm_arrangement.
    DATA name TYPE string.
    name = |{ comm_scenario }|.
    IF service_id IS NOT INITIAL.
      name = |{ name }.{ service_id }|.
    ENDIF.
    r_http_destination = NEW zrap_cl_http_destination( url = zrap_eml=>destination( name ) name = name ).
  ENDMETHOD.

  METHOD create_by_cloud_destination.
    DATA name TYPE string.
    name = |{ i_name }|.
    r_http_destination = NEW zrap_cl_http_destination( url = zrap_eml=>destination( name ) name = name ).
  ENDMETHOD.
ENDCLASS.
`;

const IF_WEB_HTTP_REQUEST = `INTERFACE if_web_http_request PUBLIC.
  TYPES: BEGIN OF name_value_pair,
           name  TYPE string,
           value TYPE string,
         END OF name_value_pair,
         name_value_pairs TYPE STANDARD TABLE OF name_value_pair WITH DEFAULT KEY.
  METHODS set_uri_path IMPORTING i_uri_path TYPE csequence RETURNING VALUE(r_value) TYPE REF TO if_web_http_request.
  METHODS get_uri_path RETURNING VALUE(r_value) TYPE string.
  METHODS set_query IMPORTING query TYPE csequence RETURNING VALUE(r_value) TYPE REF TO if_web_http_request.
  METHODS set_header_field IMPORTING i_name TYPE csequence i_value TYPE csequence RETURNING VALUE(r_value) TYPE REF TO if_web_http_request.
  METHODS get_header_field IMPORTING i_name TYPE csequence RETURNING VALUE(r_value) TYPE string.
  METHODS set_header_fields IMPORTING i_fields TYPE name_value_pairs RETURNING VALUE(r_value) TYPE REF TO if_web_http_request.
  METHODS get_header_fields RETURNING VALUE(r_value) TYPE name_value_pairs.
  METHODS delete_header_field IMPORTING i_name TYPE csequence RETURNING VALUE(r_value) TYPE REF TO if_web_http_request.
  METHODS set_content_type IMPORTING content_type TYPE csequence RETURNING VALUE(r_value) TYPE REF TO if_web_http_request.
  METHODS get_content_type RETURNING VALUE(r_value) TYPE string.
  METHODS set_text IMPORTING i_text TYPE csequence RETURNING VALUE(r_value) TYPE REF TO if_web_http_request.
  METHODS get_text RETURNING VALUE(r_value) TYPE string.
  METHODS set_binary IMPORTING i_data TYPE xsequence RETURNING VALUE(r_value) TYPE REF TO if_web_http_request.
  METHODS get_binary RETURNING VALUE(r_value) TYPE xstring.
  METHODS set_form_field IMPORTING i_name TYPE csequence i_value TYPE csequence RETURNING VALUE(r_value) TYPE REF TO if_web_http_request.
  METHODS set_form_fields IMPORTING i_fields TYPE name_value_pairs RETURNING VALUE(r_value) TYPE REF TO if_web_http_request.
  METHODS set_authorization_basic IMPORTING i_username TYPE csequence i_password TYPE csequence RETURNING VALUE(r_value) TYPE REF TO if_web_http_request.
  METHODS set_authorization_bearer IMPORTING i_bearer TYPE csequence RETURNING VALUE(r_value) TYPE REF TO if_web_http_request.
ENDINTERFACE.
`;

const IF_WEB_HTTP_RESPONSE = `INTERFACE if_web_http_response PUBLIC.
  TYPES: BEGIN OF http_status,
           code   TYPE i,
           reason TYPE string,
         END OF http_status.
  METHODS get_status RETURNING VALUE(r_value) TYPE http_status.
  METHODS get_text RETURNING VALUE(r_value) TYPE string RAISING cx_web_message_error.
  METHODS get_binary RETURNING VALUE(r_value) TYPE xstring RAISING cx_web_message_error.
  METHODS get_header_field IMPORTING i_name TYPE csequence RETURNING VALUE(r_value) TYPE string.
  METHODS get_header_fields RETURNING VALUE(r_value) TYPE if_web_http_request=>name_value_pairs.
  METHODS get_content_type RETURNING VALUE(r_value) TYPE string.
ENDINTERFACE.
`;

/** Names and values of common header fields. */
const IF_WEB_HTTP_HEADER = `INTERFACE if_web_http_header PUBLIC.
  CONSTANTS accept TYPE string VALUE 'accept'.
  CONSTANTS accept_language TYPE string VALUE 'accept-language'.
  CONSTANTS authorization TYPE string VALUE 'authorization'.
  CONSTANTS content_type TYPE string VALUE 'content-type'.
  CONSTANTS content_length TYPE string VALUE 'content-length'.
  CONSTANTS cookie TYPE string VALUE 'cookie'.
  CONSTANTS etag TYPE string VALUE 'etag'.
  CONSTANTS if_match TYPE string VALUE 'if-match'.
  CONSTANTS location TYPE string VALUE 'location'.
  CONSTANTS user_agent TYPE string VALUE 'user-agent'.
  CONSTANTS accept_application_json TYPE string VALUE 'application/json'.
  CONSTANTS content_type_json TYPE string VALUE 'application/json'.
  CONSTANTS content_type_xml TYPE string VALUE 'application/xml'.
  CONSTANTS content_type_text_plain TYPE string VALUE 'text/plain'.
ENDINTERFACE.
`;

/** Authentication modes of create_by_cloud_destination (the kernel takes the destination's credentials). */
const IF_A4C_CP_SERVICE = `INTERFACE if_a4c_cp_service PUBLIC.
  TYPES ty_authn_mode TYPE c LENGTH 1.
  CONSTANTS service_specific TYPE ty_authn_mode VALUE 'S'.
  CONSTANTS user_propagation TYPE ty_authn_mode VALUE 'U'.
ENDINTERFACE.
`;

const IF_WEB_HTTP_CLIENT = `INTERFACE if_web_http_client PUBLIC.
  TYPES method TYPE string.
  CONSTANTS get TYPE method VALUE 'GET'.
  CONSTANTS post TYPE method VALUE 'POST'.
  CONSTANTS put TYPE method VALUE 'PUT'.
  CONSTANTS patch TYPE method VALUE 'PATCH'.
  CONSTANTS delete TYPE method VALUE 'DELETE'.
  CONSTANTS head TYPE method VALUE 'HEAD'.
  CONSTANTS options TYPE method VALUE 'OPTIONS'.
  METHODS get_http_request RETURNING VALUE(r_request) TYPE REF TO if_web_http_request.
  METHODS execute
    IMPORTING i_method          TYPE method DEFAULT 'GET'
              i_timeout         TYPE i DEFAULT 0
    PREFERRED PARAMETER i_method
    RETURNING VALUE(r_response) TYPE REF TO if_web_http_response
    RAISING   cx_web_http_client_error.
  METHODS close RAISING cx_web_http_client_error.
ENDINTERFACE.
`;

const ZRAP_CL_HTTP_REQUEST = `CLASS zrap_cl_http_request DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_web_http_request.
    DATA path TYPE string READ-ONLY.
    DATA query TYPE string READ-ONLY.
    DATA headers TYPE zrap_if_http=>tt_header READ-ONLY.
    DATA form TYPE zrap_if_http=>tt_header READ-ONLY.
    DATA body TYPE string READ-ONLY.
    DATA binary TYPE xstring READ-ONLY.
ENDCLASS.

CLASS zrap_cl_http_request IMPLEMENTATION.
  METHOD if_web_http_request~set_uri_path.
    path = i_uri_path.
    r_value = me.
  ENDMETHOD.

  METHOD if_web_http_request~get_uri_path.
    r_value = path.
  ENDMETHOD.

  METHOD if_web_http_request~set_query.
    me->query = query.
    r_value = me.
  ENDMETHOD.

  METHOD if_web_http_request~set_header_field.
    DATA name TYPE string.
    name = to_lower( |{ i_name }| ).
    DELETE headers WHERE name = name.
    APPEND VALUE #( name = name value = |{ i_value }| ) TO headers.
    r_value = me.
  ENDMETHOD.

  METHOD if_web_http_request~get_header_field.
    DATA name TYPE string.
    name = to_lower( |{ i_name }| ).
    READ TABLE headers INTO DATA(header) WITH KEY name = name.
    IF sy-subrc = 0.
      r_value = header-value.
    ENDIF.
  ENDMETHOD.

  METHOD if_web_http_request~set_header_fields.
    LOOP AT i_fields INTO DATA(field).
      if_web_http_request~set_header_field( i_name = field-name i_value = field-value ).
    ENDLOOP.
    r_value = me.
  ENDMETHOD.

  METHOD if_web_http_request~get_header_fields.
    r_value = headers.
  ENDMETHOD.

  METHOD if_web_http_request~delete_header_field.
    DATA name TYPE string.
    name = to_lower( |{ i_name }| ).
    DELETE headers WHERE name = name.
    r_value = me.
  ENDMETHOD.

  METHOD if_web_http_request~set_content_type.
    r_value = if_web_http_request~set_header_field( i_name = 'content-type' i_value = content_type ).
  ENDMETHOD.

  METHOD if_web_http_request~get_content_type.
    r_value = if_web_http_request~get_header_field( 'content-type' ).
  ENDMETHOD.

  METHOD if_web_http_request~set_text.
    body = i_text.
    CLEAR binary.
    r_value = me.
  ENDMETHOD.

  METHOD if_web_http_request~get_text.
    r_value = body.
  ENDMETHOD.

  METHOD if_web_http_request~set_binary.
    binary = i_data.
    CLEAR body.
    r_value = me.
  ENDMETHOD.

  METHOD if_web_http_request~get_binary.
    r_value = binary.
  ENDMETHOD.

  METHOD if_web_http_request~set_form_field.
    APPEND VALUE #( name = |{ i_name }| value = |{ i_value }| ) TO form.
    r_value = me.
  ENDMETHOD.

  METHOD if_web_http_request~set_form_fields.
    LOOP AT i_fields INTO DATA(field).
      if_web_http_request~set_form_field( i_name = field-name i_value = field-value ).
    ENDLOOP.
    r_value = me.
  ENDMETHOD.

  METHOD if_web_http_request~set_authorization_basic.
    DATA token TYPE string.
    token = zrap_eml=>base64_encode( |{ i_username }:{ i_password }| ).
    r_value = if_web_http_request~set_header_field( i_name = 'authorization' i_value = |Basic { token }| ).
  ENDMETHOD.

  METHOD if_web_http_request~set_authorization_bearer.
    r_value = if_web_http_request~set_header_field( i_name = 'authorization' i_value = |Bearer { i_bearer }| ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_HTTP_RESPONSE = `CLASS zrap_cl_http_response DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_web_http_response.
    METHODS constructor
      IMPORTING status  TYPE i
                reason  TYPE string
                headers TYPE zrap_if_http=>tt_header
                body    TYPE string
                binary  TYPE xstring.
  PRIVATE SECTION.
    DATA status TYPE i.
    DATA reason TYPE string.
    DATA headers TYPE zrap_if_http=>tt_header.
    DATA body TYPE string.
    DATA binary TYPE xstring.
ENDCLASS.

CLASS zrap_cl_http_response IMPLEMENTATION.
  METHOD constructor.
    me->status = status.
    me->reason = reason.
    me->headers = headers.
    me->body = body.
    me->binary = binary.
  ENDMETHOD.

  METHOD if_web_http_response~get_status.
    r_value-code = status.
    r_value-reason = reason.
  ENDMETHOD.

  METHOD if_web_http_response~get_text.
    r_value = body.
  ENDMETHOD.

  METHOD if_web_http_response~get_binary.
    r_value = binary.
  ENDMETHOD.

  METHOD if_web_http_response~get_header_field.
    DATA name TYPE string.
    name = to_lower( |{ i_name }| ).
    READ TABLE headers INTO DATA(header) WITH KEY name = name.
    IF sy-subrc = 0.
      r_value = header-value.
    ENDIF.
  ENDMETHOD.

  METHOD if_web_http_response~get_header_fields.
    r_value = headers.
  ENDMETHOD.

  METHOD if_web_http_response~get_content_type.
    r_value = if_web_http_response~get_header_field( 'content-type' ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_HTTP_CLIENT = `CLASS zrap_cl_http_client DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_web_http_client.
    DATA destination TYPE REF TO zrap_cl_http_destination READ-ONLY.
    METHODS constructor IMPORTING destination TYPE REF TO zrap_cl_http_destination.
  PRIVATE SECTION.
    DATA request TYPE REF TO zrap_cl_http_request.
ENDCLASS.

CLASS zrap_cl_http_client IMPLEMENTATION.
  METHOD constructor.
    me->destination = destination.
    request = NEW #( ).
  ENDMETHOD.

  METHOD if_web_http_client~get_http_request.
    r_request = request.
  ENDMETHOD.

  METHOD if_web_http_client~execute.
    DATA status TYPE i.
    DATA reason TYPE string.
    DATA headers TYPE zrap_if_http=>tt_header.
    DATA body TYPE string.
    DATA binary TYPE xstring.
    zrap_eml=>http_execute(
      EXPORTING method           = i_method
                base             = destination->url
                path             = request->path
                query            = request->query
                destination      = destination->name
                headers          = request->headers
                form             = request->form
                body             = request->body
                binary           = request->binary
                timeout          = i_timeout
      IMPORTING status           = status
                reason           = reason
                response_headers = headers
                response_body    = body
                response_binary  = binary ).
    r_response = NEW zrap_cl_http_response( status = status reason = reason headers = headers body = body binary = binary ).
  ENDMETHOD.

  METHOD if_web_http_client~close.
  ENDMETHOD.
ENDCLASS.
`;

const CL_WEB_HTTP_CLIENT_MANAGER = `CLASS cl_web_http_client_manager DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS create_by_http_destination
      IMPORTING i_destination   TYPE REF TO if_http_destination
      RETURNING VALUE(r_client) TYPE REF TO if_web_http_client
      RAISING   cx_web_http_client_error.
ENDCLASS.

CLASS cl_web_http_client_manager IMPLEMENTATION.
  METHOD create_by_http_destination.
    DATA destination TYPE REF TO zrap_cl_http_destination.
    IF i_destination IS NOT BOUND.
      RAISE EXCEPTION TYPE cx_web_http_client_error EXPORTING zrap_text = |create_by_http_destination: no destination|.
    ENDIF.
    destination ?= i_destination.
    r_client = NEW zrap_cl_http_client( destination ).
  ENDMETHOD.
ENDCLASS.
`;

// ---------------------------------------------------------------------------------------------
// OData client proxy

const IWBEP_RUNTIME_TYPES = `INTERFACE /iwbep/if_cp_runtime_types PUBLIC.
  TYPES ty_entity_set_name TYPE c LENGTH 128.
  TYPES ty_entity_type_name TYPE c LENGTH 128.
  TYPES ty_complex_type_name TYPE c LENGTH 128.
  TYPES ty_property_path TYPE string.
  TYPES ty_t_property_path TYPE STANDARD TABLE OF ty_property_path WITH EMPTY KEY.
  TYPES: BEGIN OF ty_s_sort_order,
           property_path TYPE ty_property_path,
           descending    TYPE abap_bool,
         END OF ty_s_sort_order,
         ty_t_sort_order TYPE STANDARD TABLE OF ty_s_sort_order WITH EMPTY KEY.
ENDINTERFACE.
`;

const IWBEP_REGISTRY_TYPES = `INTERFACE /iwbep/if_cp_registry_types PUBLIC.
  TYPES: BEGIN OF ty_s_proxy_model_key,
           repository_id       TYPE c LENGTH 30,
           proxy_model_id      TYPE c LENGTH 30,
           proxy_model_version TYPE n LENGTH 4,
         END OF ty_s_proxy_model_key.
ENDINTERFACE.
`;

/** Base class of the consumption model classes generated by a service consumption model (SCM2). */
const IWBEP_MODEL_PROVIDER = `CLASS /iwbep/cl_v4_abs_pm_model_prov DEFINITION PUBLIC ABSTRACT CREATE PUBLIC.
  PUBLIC SECTION.
ENDCLASS.

CLASS /iwbep/cl_v4_abs_pm_model_prov IMPLEMENTATION.
ENDCLASS.
`;

const IWBEP_INTERFACES = `INTERFACE /iwbep/if_cp_filter_node PUBLIC.
  METHODS and IMPORTING io_filter_node TYPE REF TO /iwbep/if_cp_filter_node RETURNING VALUE(ro_filter_node) TYPE REF TO /iwbep/if_cp_filter_node.
  METHODS or IMPORTING io_filter_node TYPE REF TO /iwbep/if_cp_filter_node RETURNING VALUE(ro_filter_node) TYPE REF TO /iwbep/if_cp_filter_node.
  METHODS not RETURNING VALUE(ro_filter_node) TYPE REF TO /iwbep/if_cp_filter_node.
ENDINTERFACE.
`;

const IWBEP_FILTER_FACTORY = `INTERFACE /iwbep/if_cp_filter_factory PUBLIC.
  METHODS create_by_range
    IMPORTING iv_property_path     TYPE csequence
              it_range             TYPE ANY TABLE
    RETURNING VALUE(ro_filter_node) TYPE REF TO /iwbep/if_cp_filter_node
    RAISING   /iwbep/cx_gateway.
ENDINTERFACE.
`;

const IWBEP_RESPONSES = [
  `INTERFACE /iwbep/if_cp_response_read_lst PUBLIC.
  METHODS get_business_data EXPORTING et_business_data TYPE ANY TABLE RAISING /iwbep/cx_gateway.
  METHODS get_count RETURNING VALUE(rv_count) TYPE int8 RAISING /iwbep/cx_gateway.
ENDINTERFACE.
`,
  `INTERFACE /iwbep/if_cp_response_read PUBLIC.
  METHODS get_business_data EXPORTING es_business_data TYPE data RAISING /iwbep/cx_gateway.
ENDINTERFACE.
`,
  `INTERFACE /iwbep/if_cp_response_create PUBLIC.
  METHODS get_business_data EXPORTING es_business_data TYPE data RAISING /iwbep/cx_gateway.
ENDINTERFACE.
`,
  `INTERFACE /iwbep/if_cp_response_update PUBLIC.
  METHODS get_business_data EXPORTING es_business_data TYPE data RAISING /iwbep/cx_gateway.
ENDINTERFACE.
`,
];

const IWBEP_REQUESTS = [
  `INTERFACE /iwbep/if_cp_request_read_list PUBLIC.
  METHODS set_top IMPORTING iv_top TYPE i RETURNING VALUE(ro_request) TYPE REF TO /iwbep/if_cp_request_read_list.
  METHODS set_skip IMPORTING iv_skip TYPE i RETURNING VALUE(ro_request) TYPE REF TO /iwbep/if_cp_request_read_list.
  METHODS request_count RETURNING VALUE(ro_request) TYPE REF TO /iwbep/if_cp_request_read_list.
  METHODS request_no_business_data RETURNING VALUE(ro_request) TYPE REF TO /iwbep/if_cp_request_read_list.
  METHODS create_filter_factory RETURNING VALUE(ro_filter_factory) TYPE REF TO /iwbep/if_cp_filter_factory.
  METHODS set_filter IMPORTING io_filter_node TYPE REF TO /iwbep/if_cp_filter_node RETURNING VALUE(ro_request) TYPE REF TO /iwbep/if_cp_request_read_list.
  METHODS set_select_properties IMPORTING it_select_property TYPE /iwbep/if_cp_runtime_types=>ty_t_property_path RETURNING VALUE(ro_request) TYPE REF TO /iwbep/if_cp_request_read_list.
  METHODS set_orderby IMPORTING it_orderby_property TYPE /iwbep/if_cp_runtime_types=>ty_t_sort_order RETURNING VALUE(ro_request) TYPE REF TO /iwbep/if_cp_request_read_list.
  METHODS execute RETURNING VALUE(ro_response) TYPE REF TO /iwbep/if_cp_response_read_lst RAISING /iwbep/cx_gateway.
ENDINTERFACE.
`,
  `INTERFACE /iwbep/if_cp_request_read PUBLIC.
  METHODS set_select_properties IMPORTING it_select_property TYPE /iwbep/if_cp_runtime_types=>ty_t_property_path RETURNING VALUE(ro_request) TYPE REF TO /iwbep/if_cp_request_read.
  METHODS execute RETURNING VALUE(ro_response) TYPE REF TO /iwbep/if_cp_response_read RAISING /iwbep/cx_gateway.
ENDINTERFACE.
`,
  `INTERFACE /iwbep/if_cp_request_create PUBLIC.
  METHODS set_business_data
    IMPORTING is_business_data     TYPE data
              it_provided_property TYPE /iwbep/if_cp_runtime_types=>ty_t_property_path OPTIONAL
    RAISING   /iwbep/cx_gateway.
  METHODS execute RETURNING VALUE(ro_response) TYPE REF TO /iwbep/if_cp_response_create RAISING /iwbep/cx_gateway.
ENDINTERFACE.
`,
  `INTERFACE /iwbep/if_cp_request_update PUBLIC.
  CONSTANTS: BEGIN OF gcs_update_semantic,
               patch TYPE c LENGTH 5 VALUE 'PATCH',
               put   TYPE c LENGTH 5 VALUE 'PUT',
             END OF gcs_update_semantic.
  METHODS set_business_data
    IMPORTING is_business_data     TYPE data
              it_provided_property TYPE /iwbep/if_cp_runtime_types=>ty_t_property_path OPTIONAL
    RAISING   /iwbep/cx_gateway.
  METHODS set_if_match IMPORTING iv_if_match TYPE csequence.
  METHODS execute RETURNING VALUE(ro_response) TYPE REF TO /iwbep/if_cp_response_update RAISING /iwbep/cx_gateway.
ENDINTERFACE.
`,
  `INTERFACE /iwbep/if_cp_request_delete PUBLIC.
  METHODS set_if_match IMPORTING iv_if_match TYPE csequence.
  METHODS execute RAISING /iwbep/cx_gateway.
ENDINTERFACE.
`,
];

const IWBEP_RESOURCES = [
  `INTERFACE /iwbep/if_cp_resource_entity PUBLIC.
  METHODS create_request_for_read RETURNING VALUE(ro_request) TYPE REF TO /iwbep/if_cp_request_read RAISING /iwbep/cx_gateway.
  METHODS create_request_for_update
    IMPORTING iv_update_semantic TYPE csequence DEFAULT 'PATCH'
    RETURNING VALUE(ro_request)  TYPE REF TO /iwbep/if_cp_request_update
    RAISING   /iwbep/cx_gateway.
  METHODS create_request_for_delete RETURNING VALUE(ro_request) TYPE REF TO /iwbep/if_cp_request_delete RAISING /iwbep/cx_gateway.
ENDINTERFACE.
`,
  `INTERFACE /iwbep/if_cp_resource_entity_set PUBLIC.
  METHODS create_request_for_read RETURNING VALUE(ro_request) TYPE REF TO /iwbep/if_cp_request_read_list RAISING /iwbep/cx_gateway.
  METHODS create_request_for_create RETURNING VALUE(ro_request) TYPE REF TO /iwbep/if_cp_request_create RAISING /iwbep/cx_gateway.
  METHODS navigate_with_key
    IMPORTING is_key_values     TYPE data
    RETURNING VALUE(ro_resource) TYPE REF TO /iwbep/if_cp_resource_entity
    RAISING   /iwbep/cx_gateway.
ENDINTERFACE.
`,
  `INTERFACE /iwbep/if_cp_client_proxy PUBLIC.
  METHODS create_resource_for_entity_set
    IMPORTING iv_entity_set_name TYPE csequence
    RETURNING VALUE(ro_resource) TYPE REF TO /iwbep/if_cp_resource_entity_set
    RAISING   /iwbep/cx_gateway.
ENDINTERFACE.
`,
];

/** The implementation: each object keeps the handle of the proxy in the kernel and its state. */
const ZRAP_CL_CP = `CLASS zrap_cl_cp_filter_node DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES /iwbep/if_cp_filter_node.
    DATA expression TYPE string READ-ONLY.
    METHODS constructor IMPORTING expression TYPE string.
ENDCLASS.

CLASS zrap_cl_cp_filter_node IMPLEMENTATION.
  METHOD constructor.
    me->expression = expression.
  ENDMETHOD.

  METHOD /iwbep/if_cp_filter_node~and.
    DATA other TYPE REF TO zrap_cl_cp_filter_node.
    other ?= io_filter_node.
    ro_filter_node = NEW zrap_cl_cp_filter_node( |({ expression }) and ({ other->expression })| ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_filter_node~or.
    DATA other TYPE REF TO zrap_cl_cp_filter_node.
    other ?= io_filter_node.
    ro_filter_node = NEW zrap_cl_cp_filter_node( |({ expression }) or ({ other->expression })| ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_filter_node~not.
    ro_filter_node = NEW zrap_cl_cp_filter_node( |not ({ expression })| ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_CP_FILTER_FACTORY = `CLASS zrap_cl_cp_filter_factory DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES /iwbep/if_cp_filter_factory.
    METHODS constructor IMPORTING handle TYPE string set TYPE string.
  PRIVATE SECTION.
    DATA handle TYPE string.
    DATA set TYPE string.
ENDCLASS.

CLASS zrap_cl_cp_filter_factory IMPLEMENTATION.
  METHOD constructor.
    me->handle = handle.
    me->set = set.
  ENDMETHOD.

  METHOD /iwbep/if_cp_filter_factory~create_by_range.
    ro_filter_node = NEW zrap_cl_cp_filter_node( zrap_eml=>odata_filter( handle = handle set = set property = |{ iv_property_path }| range = it_range ) ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_CP_RESPONSE = `CLASS zrap_cl_cp_response DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES /iwbep/if_cp_response_read_lst.
    INTERFACES /iwbep/if_cp_response_read.
    INTERFACES /iwbep/if_cp_response_create.
    INTERFACES /iwbep/if_cp_response_update.
    METHODS constructor IMPORTING handle TYPE string set TYPE string json TYPE string count TYPE int8 OPTIONAL.
  PRIVATE SECTION.
    DATA handle TYPE string.
    DATA set TYPE string.
    DATA json TYPE string.
    DATA count TYPE int8.
ENDCLASS.

CLASS zrap_cl_cp_response IMPLEMENTATION.
  METHOD constructor.
    me->handle = handle.
    me->set = set.
    me->json = json.
    me->count = count.
  ENDMETHOD.

  METHOD /iwbep/if_cp_response_read_lst~get_business_data.
    zrap_eml=>odata_fill( EXPORTING handle = handle set = set json = json CHANGING target = et_business_data ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_response_read_lst~get_count.
    rv_count = count.
  ENDMETHOD.

  METHOD /iwbep/if_cp_response_read~get_business_data.
    zrap_eml=>odata_fill( EXPORTING handle = handle set = set json = json CHANGING target = es_business_data ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_response_create~get_business_data.
    zrap_eml=>odata_fill( EXPORTING handle = handle set = set json = json CHANGING target = es_business_data ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_response_update~get_business_data.
    zrap_eml=>odata_fill( EXPORTING handle = handle set = set json = json CHANGING target = es_business_data ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_CP_REQUEST = `CLASS zrap_cl_cp_request DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES /iwbep/if_cp_request_read_list.
    INTERFACES /iwbep/if_cp_request_read.
    INTERFACES /iwbep/if_cp_request_create.
    INTERFACES /iwbep/if_cp_request_update.
    INTERFACES /iwbep/if_cp_request_delete.
    METHODS constructor IMPORTING handle TYPE string set TYPE string key TYPE string OPTIONAL method TYPE string.
  PRIVATE SECTION.
    DATA handle TYPE string.
    DATA set TYPE string.
    DATA key TYPE string.
    DATA method TYPE string.
    DATA top TYPE i VALUE -1.
    DATA skip TYPE i.
    DATA with_count TYPE abap_bool.
    DATA no_data TYPE abap_bool.
    DATA filter TYPE string.
    DATA select TYPE string.
    DATA orderby TYPE string.
    DATA payload TYPE string.
    DATA if_match TYPE string.
    METHODS send RETURNING VALUE(response) TYPE REF TO zrap_cl_cp_response RAISING /iwbep/cx_gateway.
    METHODS select_list IMPORTING properties TYPE /iwbep/if_cp_runtime_types=>ty_t_property_path.
ENDCLASS.

CLASS zrap_cl_cp_request IMPLEMENTATION.
  METHOD constructor.
    me->handle = handle.
    me->set = set.
    me->key = key.
    me->method = method.
  ENDMETHOD.

  METHOD send.
    DATA json TYPE string.
    DATA count TYPE int8.
    zrap_eml=>odata_request(
      EXPORTING handle   = handle
                method   = method
                set      = set
                key      = key
                top      = top
                skip     = skip
                count    = with_count
                no_data  = no_data
                filter   = filter
                select   = select
                orderby  = orderby
                payload  = payload
                if_match = if_match
      IMPORTING json     = json
                total    = count ).
    response = NEW zrap_cl_cp_response( handle = handle set = set json = json count = count ).
  ENDMETHOD.

  METHOD select_list.
    CLEAR select.
    LOOP AT properties INTO DATA(property).
      select = COND #( WHEN select IS INITIAL THEN property ELSE |{ select },{ property }| ).
    ENDLOOP.
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_read_list~set_top.
    top = iv_top.
    ro_request = me.
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_read_list~set_skip.
    skip = iv_skip.
    ro_request = me.
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_read_list~request_count.
    with_count = abap_true.
    ro_request = me.
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_read_list~request_no_business_data.
    no_data = abap_true.
    ro_request = me.
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_read_list~create_filter_factory.
    ro_filter_factory = NEW zrap_cl_cp_filter_factory( handle = handle set = set ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_read_list~set_filter.
    DATA node TYPE REF TO zrap_cl_cp_filter_node.
    node ?= io_filter_node.
    filter = node->expression.
    ro_request = me.
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_read_list~set_select_properties.
    select_list( it_select_property ).
    ro_request = me.
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_read_list~set_orderby.
    CLEAR orderby.
    LOOP AT it_orderby_property INTO DATA(order).
      DATA(item) = COND string( WHEN order-descending = abap_true THEN |{ order-property_path } desc| ELSE order-property_path ).
      orderby = COND #( WHEN orderby IS INITIAL THEN item ELSE |{ orderby },{ item }| ).
    ENDLOOP.
    ro_request = me.
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_read_list~execute.
    ro_response = send( ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_read~set_select_properties.
    select_list( it_select_property ).
    ro_request = me.
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_read~execute.
    ro_response = send( ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_create~set_business_data.
    payload = zrap_eml=>odata_payload( handle = handle set = set source = is_business_data properties = it_provided_property ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_create~execute.
    ro_response = send( ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_update~set_business_data.
    payload = zrap_eml=>odata_payload( handle = handle set = set source = is_business_data properties = it_provided_property ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_update~set_if_match.
    if_match = iv_if_match.
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_update~execute.
    ro_response = send( ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_delete~set_if_match.
    if_match = iv_if_match.
  ENDMETHOD.

  METHOD /iwbep/if_cp_request_delete~execute.
    send( ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_CP_RESOURCE = `CLASS zrap_cl_cp_resource DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES /iwbep/if_cp_resource_entity_set.
    INTERFACES /iwbep/if_cp_resource_entity.
    METHODS constructor IMPORTING handle TYPE string set TYPE string key TYPE string OPTIONAL.
  PRIVATE SECTION.
    DATA handle TYPE string.
    DATA set TYPE string.
    DATA key TYPE string.
ENDCLASS.

CLASS zrap_cl_cp_resource IMPLEMENTATION.
  METHOD constructor.
    me->handle = handle.
    me->set = set.
    me->key = key.
  ENDMETHOD.

  METHOD /iwbep/if_cp_resource_entity_set~create_request_for_read.
    ro_request = NEW zrap_cl_cp_request( handle = handle set = set method = 'READ_LIST' ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_resource_entity_set~create_request_for_create.
    ro_request = NEW zrap_cl_cp_request( handle = handle set = set method = 'POST' ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_resource_entity_set~navigate_with_key.
    ro_resource = NEW zrap_cl_cp_resource( handle = handle set = set key = zrap_eml=>odata_key( handle = handle set = set source = is_key_values ) ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_resource_entity~create_request_for_read.
    ro_request = NEW zrap_cl_cp_request( handle = handle set = set key = key method = 'GET' ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_resource_entity~create_request_for_update.
    ro_request = NEW zrap_cl_cp_request( handle = handle set = set key = key method = to_upper( |{ iv_update_semantic }| ) ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_resource_entity~create_request_for_delete.
    ro_request = NEW zrap_cl_cp_request( handle = handle set = set key = key method = 'DELETE' ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_CP_CLIENT_PROXY = `CLASS zrap_cl_cp_client_proxy DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES /iwbep/if_cp_client_proxy.
    METHODS constructor
      IMPORTING version TYPE string
                client  TYPE REF TO if_web_http_client
                root    TYPE csequence
                csrf    TYPE abap_bool DEFAULT abap_true
      RAISING   /iwbep/cx_gateway.
  PRIVATE SECTION.
    DATA handle TYPE string.
ENDCLASS.

CLASS zrap_cl_cp_client_proxy IMPLEMENTATION.
  METHOD constructor.
    DATA http TYPE REF TO zrap_cl_http_client.
    IF client IS NOT BOUND.
      RAISE EXCEPTION TYPE /iwbep/cx_gateway EXPORTING zrap_text = |client proxy: no HTTP client|.
    ENDIF.
    http ?= client.
    handle = zrap_eml=>odata_open( version = version base = http->destination->url destination = http->destination->name root = |{ root }| csrf = csrf ).
  ENDMETHOD.

  METHOD /iwbep/if_cp_client_proxy~create_resource_for_entity_set.
    ro_resource = NEW zrap_cl_cp_resource( handle = handle set = |{ iv_entity_set_name }| ).
  ENDMETHOD.
ENDCLASS.
`;

const FACTORIES = `CLASS /iwbep/cl_cp_factory_remote DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS create_v2_remote_proxy
      IMPORTING is_proxy_model_key       TYPE /iwbep/if_cp_registry_types=>ty_s_proxy_model_key OPTIONAL
                io_http_client           TYPE REF TO if_web_http_client
                iv_relative_service_root TYPE csequence
                iv_do_fetch_csrf_token   TYPE abap_bool DEFAULT abap_true
      RETURNING VALUE(ro_client_proxy)   TYPE REF TO /iwbep/if_cp_client_proxy
      RAISING   /iwbep/cx_gateway.
    CLASS-METHODS create_v4_remote_proxy
      IMPORTING is_proxy_model_key       TYPE /iwbep/if_cp_registry_types=>ty_s_proxy_model_key OPTIONAL
                io_http_client           TYPE REF TO if_web_http_client
                iv_relative_service_root TYPE csequence
                iv_do_fetch_csrf_token   TYPE abap_bool DEFAULT abap_true
      RETURNING VALUE(ro_client_proxy)   TYPE REF TO /iwbep/if_cp_client_proxy
      RAISING   /iwbep/cx_gateway.
ENDCLASS.

CLASS /iwbep/cl_cp_factory_remote IMPLEMENTATION.
  METHOD create_v2_remote_proxy.
    ro_client_proxy = NEW zrap_cl_cp_client_proxy( version = '2' client = io_http_client root = iv_relative_service_root csrf = iv_do_fetch_csrf_token ).
  ENDMETHOD.

  METHOD create_v4_remote_proxy.
    ro_client_proxy = NEW zrap_cl_cp_client_proxy( version = '4' client = io_http_client root = iv_relative_service_root csrf = iv_do_fetch_csrf_token ).
  ENDMETHOD.
ENDCLASS.
`;

const CL_WEB_ODATA_CLIENT_FACTORY = `CLASS cl_web_odata_client_factory DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    TYPES ty_service_definition_name TYPE c LENGTH 40.
    CLASS-METHODS create_v2_remote_proxy
      IMPORTING iv_service_definition_name TYPE ty_service_definition_name OPTIONAL
                io_http_client             TYPE REF TO if_web_http_client
                iv_relative_service_root   TYPE csequence
                iv_do_fetch_csrf_token     TYPE abap_bool DEFAULT abap_true
      RETURNING VALUE(ro_client_proxy)     TYPE REF TO /iwbep/if_cp_client_proxy
      RAISING   /iwbep/cx_gateway.
    CLASS-METHODS create_v4_remote_proxy
      IMPORTING iv_service_definition_name TYPE ty_service_definition_name OPTIONAL
                io_http_client             TYPE REF TO if_web_http_client
                iv_relative_service_root   TYPE csequence
                iv_do_fetch_csrf_token     TYPE abap_bool DEFAULT abap_true
      RETURNING VALUE(ro_client_proxy)     TYPE REF TO /iwbep/if_cp_client_proxy
      RAISING   /iwbep/cx_gateway.
ENDCLASS.

CLASS cl_web_odata_client_factory IMPLEMENTATION.
  METHOD create_v2_remote_proxy.
    ro_client_proxy = NEW zrap_cl_cp_client_proxy( version = '2' client = io_http_client root = iv_relative_service_root csrf = iv_do_fetch_csrf_token ).
  ENDMETHOD.

  METHOD create_v4_remote_proxy.
    ro_client_proxy = NEW zrap_cl_cp_client_proxy( version = '4' client = io_http_client root = iv_relative_service_root csrf = iv_do_fetch_csrf_token ).
  ENDMETHOD.
ENDCLASS.
`;

/** abapGit file name of an object (namespaces: `/iwbep/x` → `#iwbep#x`). */
const file = (name: string, type: "clas" | "intf"): string => `${name.toLowerCase().replace(/\//g, "#")}.${type}.abap`;

const interfaceName = (source: string): string => /^INTERFACE (\S+)/i.exec(source)?.[1] ?? "";
const className = (source: string): string => /^CLASS (\S+)/i.exec(source)?.[1] ?? "";

/** The sources, in an order where each object comes after the ones it uses (for reading only). */
export const HTTP_FRAMEWORK_SOURCES: FrameworkSource[] = [
  { fileName: file("zrap_if_http", "intf"), source: ZRAP_IF_HTTP },
  { fileName: file("cx_http_dest_provider_error", "clas"), source: textException("cx_http_dest_provider_error", "cx_static_check") },
  { fileName: file("cx_web_http_client_error", "clas"), source: textException("cx_web_http_client_error", "cx_static_check") },
  { fileName: file("cx_web_message_error", "clas"), source: textException("cx_web_message_error", "cx_static_check") },
  { fileName: file("/iwbep/cx_gateway", "clas"), source: textException("/iwbep/cx_gateway", "cx_static_check") },
  {
    fileName: file("/iwbep/cx_cp_remote", "clas"),
    source: textException("/iwbep/cx_cp_remote", "/iwbep/cx_gateway", "    DATA http_status_code TYPE i READ-ONLY.\n    DATA http_error_body TYPE string READ-ONLY."),
  },
  { fileName: file("if_http_destination", "intf"), source: IF_HTTP_DESTINATION },
  { fileName: file("zrap_cl_http_destination", "clas"), source: ZRAP_CL_HTTP_DESTINATION },
  { fileName: file("cl_http_destination_provider", "clas"), source: CL_HTTP_DESTINATION_PROVIDER },
  { fileName: file("if_web_http_request", "intf"), source: IF_WEB_HTTP_REQUEST },
  { fileName: file("if_web_http_response", "intf"), source: IF_WEB_HTTP_RESPONSE },
  { fileName: file("if_web_http_header", "intf"), source: IF_WEB_HTTP_HEADER },
  { fileName: file("if_a4c_cp_service", "intf"), source: IF_A4C_CP_SERVICE },
  { fileName: file("if_web_http_client", "intf"), source: IF_WEB_HTTP_CLIENT },
  { fileName: file("zrap_cl_http_request", "clas"), source: ZRAP_CL_HTTP_REQUEST },
  { fileName: file("zrap_cl_http_response", "clas"), source: ZRAP_CL_HTTP_RESPONSE },
  { fileName: file("zrap_cl_http_client", "clas"), source: ZRAP_CL_HTTP_CLIENT },
  { fileName: file("cl_web_http_client_manager", "clas"), source: CL_WEB_HTTP_CLIENT_MANAGER },
  { fileName: file("/iwbep/if_cp_runtime_types", "intf"), source: IWBEP_RUNTIME_TYPES },
  { fileName: file("/iwbep/if_cp_registry_types", "intf"), source: IWBEP_REGISTRY_TYPES },
  { fileName: file("/iwbep/cl_v4_abs_pm_model_prov", "clas"), source: IWBEP_MODEL_PROVIDER },
  { fileName: file("/iwbep/if_cp_filter_node", "intf"), source: IWBEP_INTERFACES },
  { fileName: file("/iwbep/if_cp_filter_factory", "intf"), source: IWBEP_FILTER_FACTORY },
  ...IWBEP_RESPONSES.map((source) => ({ fileName: file(interfaceName(source), "intf"), source })),
  ...IWBEP_REQUESTS.map((source) => ({ fileName: file(interfaceName(source), "intf"), source })),
  ...IWBEP_RESOURCES.map((source) => ({ fileName: file(interfaceName(source), "intf"), source })),
  ...[ZRAP_CL_CP, ZRAP_CL_CP_FILTER_FACTORY, ZRAP_CL_CP_RESPONSE, ZRAP_CL_CP_REQUEST, ZRAP_CL_CP_RESOURCE, ZRAP_CL_CP_CLIENT_PROXY, FACTORIES, CL_WEB_ODATA_CLIENT_FACTORY].map((source) => ({
    fileName: file(className(source), "clas"),
    source,
  })),
];

/** The kernel entries of the API consumption, declared in ZRAP_EML (bodies replaced at run time). */
export const HTTP_KERNEL_DEFINITIONS = `    "! URL of a destination of the environment (DESTINATION_<NAME>_URL).
    CLASS-METHODS destination
      IMPORTING name       TYPE string
      RETURNING VALUE(url) TYPE string
      RAISING   cx_http_dest_provider_error.
    CLASS-METHODS base64_encode
      IMPORTING text          TYPE string
      RETURNING VALUE(result) TYPE string.
    CLASS-METHODS http_execute
      IMPORTING method           TYPE string
                base             TYPE string
                path             TYPE string OPTIONAL
                query            TYPE string OPTIONAL
                destination      TYPE string OPTIONAL
                headers          TYPE zrap_if_http=>tt_header OPTIONAL
                form             TYPE zrap_if_http=>tt_header OPTIONAL
                body             TYPE string OPTIONAL
                binary           TYPE xstring OPTIONAL
                timeout          TYPE i DEFAULT 0
      EXPORTING status           TYPE i
                reason           TYPE string
                response_headers TYPE zrap_if_http=>tt_header
                response_body    TYPE string
                response_binary  TYPE xstring
      RAISING   cx_web_http_client_error.
    CLASS-METHODS odata_open
      IMPORTING version       TYPE string
                base          TYPE string
                destination   TYPE string OPTIONAL
                root          TYPE string
                csrf          TYPE abap_bool DEFAULT abap_true
      RETURNING VALUE(handle) TYPE string.
    CLASS-METHODS odata_key
      IMPORTING handle           TYPE string
                set              TYPE string
                source           TYPE data
      RETURNING VALUE(predicate) TYPE string
      RAISING   /iwbep/cx_gateway.
    CLASS-METHODS odata_filter
      IMPORTING handle            TYPE string
                set               TYPE string
                property          TYPE string
                range             TYPE ANY TABLE
      RETURNING VALUE(expression) TYPE string
      RAISING   /iwbep/cx_gateway.
    CLASS-METHODS odata_payload
      IMPORTING handle      TYPE string
                set         TYPE string
                source      TYPE data
                properties  TYPE /iwbep/if_cp_runtime_types=>ty_t_property_path OPTIONAL
      RETURNING VALUE(json) TYPE string
      RAISING   /iwbep/cx_gateway.
    CLASS-METHODS odata_request
      IMPORTING handle   TYPE string
                method   TYPE string
                set      TYPE string
                key      TYPE string OPTIONAL
                top      TYPE i DEFAULT -1
                skip     TYPE i DEFAULT 0
                count    TYPE abap_bool DEFAULT abap_false
                no_data  TYPE abap_bool DEFAULT abap_false
                filter   TYPE string OPTIONAL
                select   TYPE string OPTIONAL
                orderby  TYPE string OPTIONAL
                payload  TYPE string OPTIONAL
                if_match TYPE string OPTIONAL
      EXPORTING json     TYPE string
                total    TYPE int8
      RAISING   /iwbep/cx_gateway.
    CLASS-METHODS odata_fill
      IMPORTING handle TYPE string
                set    TYPE string
                json   TYPE string
      CHANGING  target TYPE data
      RAISING   /iwbep/cx_gateway.
`;

export const HTTP_KERNEL_IMPLEMENTATIONS = ["destination", "base64_encode", "http_execute", "odata_open", "odata_key", "odata_filter", "odata_payload", "odata_request", "odata_fill"]
  .map((m) => `  METHOD ${m}.\n  ENDMETHOD.\n`)
  .join("\n");
