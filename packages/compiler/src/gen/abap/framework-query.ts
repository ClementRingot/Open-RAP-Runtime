/**
 * Unmanaged query of custom entities (decision D43): the interfaces of ABAP Cloud a query class
 * implements (`if_rap_query_provider`) and uses (`if_rap_query_request`, `if_rap_query_paging`,
 * `if_rap_query_filter`, `if_rap_query_response`), written for the project from the public
 * signatures documented by SAP; no SAP code is copied. The request, paging and filter objects are
 * filled by the runtime before `select`; the response hands its data to the runtime through the
 * kernel (`zrap_eml=>query_data`, `zrap_eml=>query_total`).
 */

import type { FrameworkSource } from "./framework.js";

const IF_RAP_QUERY_PROVIDER = `"! Implemented by the query class of a custom entity (@ObjectModel.query.implementedBy).
"! Open RAP Runtime: the runtime calls select with zrap_cl_query_request and zrap_cl_query_response.
INTERFACE if_rap_query_provider PUBLIC.
  METHODS select
    IMPORTING io_request  TYPE REF TO if_rap_query_request
              io_response TYPE REF TO if_rap_query_response
    RAISING   cx_rap_query_provider.
ENDINTERFACE.
`;

const IF_RAP_QUERY_PAGING = `INTERFACE if_rap_query_paging PUBLIC.
  CONSTANTS page_size_unlimited TYPE int8 VALUE -1.
  METHODS get_offset RETURNING VALUE(rv_offset) TYPE int8.
  METHODS get_page_size RETURNING VALUE(rv_page_size) TYPE int8.
ENDINTERFACE.
`;

const IF_RAP_QUERY_FILTER = `INTERFACE if_rap_query_filter PUBLIC.
  TYPES: BEGIN OF ty_range_option,
           sign   TYPE c LENGTH 1,
           option TYPE c LENGTH 2,
           low    TYPE string,
           high   TYPE string,
         END OF ty_range_option.
  TYPES tt_range_option TYPE STANDARD TABLE OF ty_range_option WITH EMPTY KEY.
  TYPES: BEGIN OF ty_name_range_pairs,
           name  TYPE string,
           range TYPE tt_range_option,
         END OF ty_name_range_pairs.
  TYPES tt_name_range_pairs TYPE STANDARD TABLE OF ty_name_range_pairs WITH EMPTY KEY.
  METHODS get_as_ranges
    IMPORTING iv_drop_null_comparisons TYPE abap_bool DEFAULT abap_false
    RETURNING VALUE(rt_ranges) TYPE tt_name_range_pairs
    RAISING   cx_rap_query_filter_no_range.
  METHODS get_as_sql_string RETURNING VALUE(rv_string) TYPE string.
ENDINTERFACE.
`;

const IF_RAP_QUERY_REQUEST = `INTERFACE if_rap_query_request PUBLIC.
  TYPES tt_requested_elements TYPE STANDARD TABLE OF string WITH EMPTY KEY.
  TYPES: BEGIN OF ty_sort_element,
           element_name TYPE string,
           descending   TYPE abap_bool,
         END OF ty_sort_element.
  TYPES tt_sort_elements TYPE STANDARD TABLE OF ty_sort_element WITH EMPTY KEY.
  TYPES: BEGIN OF ty_parameter,
           parameter_name TYPE string,
           value          TYPE string,
         END OF ty_parameter.
  TYPES tt_parameters TYPE STANDARD TABLE OF ty_parameter WITH EMPTY KEY.
  METHODS get_entity_id RETURNING VALUE(rv_entity_id) TYPE string.
  METHODS get_filter RETURNING VALUE(ro_filter) TYPE REF TO if_rap_query_filter.
  METHODS get_paging RETURNING VALUE(ro_paging) TYPE REF TO if_rap_query_paging.
  METHODS get_sort_elements RETURNING VALUE(rt_sort_elements) TYPE tt_sort_elements.
  METHODS get_requested_elements RETURNING VALUE(rt_requested_elements) TYPE tt_requested_elements.
  METHODS get_parameters RETURNING VALUE(rt_parameters) TYPE tt_parameters.
  METHODS get_search_expression RETURNING VALUE(rv_search_expression) TYPE string.
  METHODS is_data_requested RETURNING VALUE(rv_is_requested) TYPE abap_bool.
  METHODS is_total_numb_of_rec_requested RETURNING VALUE(rv_is_requested) TYPE abap_bool.
ENDINTERFACE.
`;

const IF_RAP_QUERY_RESPONSE = `INTERFACE if_rap_query_response PUBLIC.
  METHODS set_total_number_of_records IMPORTING iv_total_number_of_records TYPE int8.
  METHODS set_data IMPORTING it_data TYPE STANDARD TABLE.
ENDINTERFACE.
`;

const ZRAP_CL_QUERY_PAGING = `CLASS zrap_cl_query_paging DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_rap_query_paging.
    DATA offset TYPE int8.
    DATA page_size TYPE int8 VALUE -1.
ENDCLASS.

CLASS zrap_cl_query_paging IMPLEMENTATION.
  METHOD if_rap_query_paging~get_offset.
    rv_offset = offset.
  ENDMETHOD.

  METHOD if_rap_query_paging~get_page_size.
    rv_page_size = page_size.
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_QUERY_FILTER = `CLASS zrap_cl_query_filter DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_rap_query_filter.
    DATA sql TYPE string.
    DATA ranges TYPE if_rap_query_filter=>tt_name_range_pairs.
    DATA no_range TYPE abap_bool.
ENDCLASS.

CLASS zrap_cl_query_filter IMPLEMENTATION.
  METHOD if_rap_query_filter~get_as_ranges.
    IF no_range = abap_true.
      RAISE EXCEPTION NEW cx_rap_query_filter_no_range( zrap_text = |The filter cannot be expressed as ranges: { sql }| ).
    ENDIF.
    rt_ranges = ranges.
  ENDMETHOD.

  METHOD if_rap_query_filter~get_as_sql_string.
    rv_string = sql.
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_QUERY_REQUEST = `CLASS zrap_cl_query_request DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_rap_query_request.
    DATA entity_id TYPE string.
    DATA filter TYPE REF TO zrap_cl_query_filter.
    DATA paging TYPE REF TO zrap_cl_query_paging.
    DATA sort_elements TYPE if_rap_query_request=>tt_sort_elements.
    DATA requested_elements TYPE if_rap_query_request=>tt_requested_elements.
    DATA parameters TYPE if_rap_query_request=>tt_parameters.
    DATA search_expression TYPE string.
    DATA data_requested TYPE abap_bool VALUE abap_true.
    DATA count_requested TYPE abap_bool.
    METHODS constructor.
ENDCLASS.

CLASS zrap_cl_query_request IMPLEMENTATION.
  METHOD constructor.
    filter = NEW #( ).
    paging = NEW #( ).
  ENDMETHOD.

  METHOD if_rap_query_request~get_entity_id.
    rv_entity_id = entity_id.
  ENDMETHOD.

  METHOD if_rap_query_request~get_filter.
    ro_filter = filter.
  ENDMETHOD.

  METHOD if_rap_query_request~get_paging.
    ro_paging = paging.
  ENDMETHOD.

  METHOD if_rap_query_request~get_sort_elements.
    rt_sort_elements = sort_elements.
  ENDMETHOD.

  METHOD if_rap_query_request~get_requested_elements.
    rt_requested_elements = requested_elements.
  ENDMETHOD.

  METHOD if_rap_query_request~get_parameters.
    rt_parameters = parameters.
  ENDMETHOD.

  METHOD if_rap_query_request~get_search_expression.
    rv_search_expression = search_expression.
  ENDMETHOD.

  METHOD if_rap_query_request~is_data_requested.
    rv_is_requested = data_requested.
  ENDMETHOD.

  METHOD if_rap_query_request~is_total_numb_of_rec_requested.
    rv_is_requested = count_requested.
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_QUERY_RESPONSE = `CLASS zrap_cl_query_response DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_rap_query_response.
ENDCLASS.

CLASS zrap_cl_query_response IMPLEMENTATION.
  METHOD if_rap_query_response~set_total_number_of_records.
    zrap_eml=>query_total( iv_total_number_of_records ).
  ENDMETHOD.

  METHOD if_rap_query_response~set_data.
    zrap_eml=>query_data( it_data ).
  ENDMETHOD.
ENDCLASS.
`;

const exception = (name: string, superclass: string, own: boolean): FrameworkSource => ({
  fileName: `${name}.clas.abap`,
  source: `CLASS ${name} DEFINITION PUBLIC INHERITING FROM ${superclass} CREATE PUBLIC.
  PUBLIC SECTION.
${own ? "    DATA zrap_text TYPE string READ-ONLY.\n" : ""}    METHODS constructor
      IMPORTING textid    LIKE textid OPTIONAL
                previous  LIKE previous OPTIONAL
                zrap_text TYPE string OPTIONAL.
ENDCLASS.

CLASS ${name} IMPLEMENTATION.
  METHOD constructor.
${own ? "    super->constructor( textid = textid previous = previous ).\n    me->zrap_text = zrap_text." : "    super->constructor( textid = textid previous = previous zrap_text = zrap_text )."}
  ENDMETHOD.
ENDCLASS.
`,
});

/** Kernel methods of ZRAP_EML for the query response (replaced at run time). */
export const QUERY_KERNEL_DEFINITIONS = `    "! the data and the number of records of the current unmanaged query (D43)
    CLASS-METHODS query_data IMPORTING data TYPE ANY TABLE.
    CLASS-METHODS query_total IMPORTING total TYPE int8.
`;

export const QUERY_KERNEL_IMPLEMENTATIONS = `  METHOD query_data.
  ENDMETHOD.

  METHOD query_total.
  ENDMETHOD.
`;

/** Given to the transpiler when the project has custom entities. */
export const QUERY_FRAMEWORK_SOURCES: FrameworkSource[] = [
  exception("cx_rap_query_provider", "cx_static_check", true),
  exception("cx_rap_query_filter_no_range", "cx_rap_query_provider", false),
  { fileName: "if_rap_query_paging.intf.abap", source: IF_RAP_QUERY_PAGING },
  { fileName: "if_rap_query_filter.intf.abap", source: IF_RAP_QUERY_FILTER },
  { fileName: "if_rap_query_request.intf.abap", source: IF_RAP_QUERY_REQUEST },
  { fileName: "if_rap_query_response.intf.abap", source: IF_RAP_QUERY_RESPONSE },
  { fileName: "if_rap_query_provider.intf.abap", source: IF_RAP_QUERY_PROVIDER },
  { fileName: "zrap_cl_query_paging.clas.abap", source: ZRAP_CL_QUERY_PAGING },
  { fileName: "zrap_cl_query_filter.clas.abap", source: ZRAP_CL_QUERY_FILTER },
  { fileName: "zrap_cl_query_request.clas.abap", source: ZRAP_CL_QUERY_REQUEST },
  { fileName: "zrap_cl_query_response.clas.abap", source: ZRAP_CL_QUERY_RESPONSE },
];
