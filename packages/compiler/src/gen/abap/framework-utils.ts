/**
 * Clean-room ABAP utilities of ABAP Cloud for the behavior pools (decision D40), written from the
 * public signatures documented by SAP: JSON (/ui2/cl_json, xco_cp_json), encodings
 * (cl_web_http_utility, cl_abap_conv_codepage, cl_abap_gzip, xco_cp=>string / xstring), text
 * (cl_abap_char_utilities, cl_abap_string_utilities), number ranges (cl_numberrange_runtime),
 * date and time (cl_abap_tstmp, cl_abap_utclong, xco_cp=>sy, xco_cp_time), the application log
 * (cl_bali_*), hashes (cl_abap_message_digest, cl_abap_hmac), random numbers (cl_abap_random*),
 * regular expressions (cl_abap_regex, cl_abap_matcher) and the RTTS (cl_abap_typedescr and its
 * subclasses). The ABAP keeps the objects; the kernel (ZRAP_EML) does what ABAP cannot: parse
 * and write JSON, convert code pages, hash, compress, persist, inspect data objects.
 *
 * Only the objects a project uses are given to the transpiler (frameworkClosure).
 */

import type { FrameworkSource } from "./framework.js";

// ------------------------------------------------------------------------------ DDIC types

const ddicHeader = (serializer: string): string => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="${serializer}" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
`;
const DDIC_FOOTER = `  </asx:values>
 </asx:abap>
</abapGit>
`;

interface Field {
  name: string;
  type?: "INT4" | "CHAR" | "STRG" | "NUMC";
  length?: number;
  table?: string;
}

const structure = (name: string, text: string, fields: Field[]): FrameworkSource => ({
  fileName: `${name.toLowerCase()}.tabl.xml`,
  source: `${ddicHeader("LCL_OBJECT_TABL")}   <DD02V>
    <TABNAME>${name}</TABNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <TABCLASS>INTTAB</TABCLASS>
    <DDTEXT>${text}</DDTEXT>
   </DD02V>
   <DD03P_TABLE>
${fields
  .map((f) =>
    f.table !== undefined
      ? `    <DD03P>\n     <FIELDNAME>${f.name}</FIELDNAME>\n     <ROLLNAME>${f.table}</ROLLNAME>\n     <COMPTYPE>L</COMPTYPE>\n    </DD03P>`
      : `    <DD03P>\n     <FIELDNAME>${f.name}</FIELDNAME>\n     <DATATYPE>${f.type}</DATATYPE>\n     <LENG>${String(f.length ?? 10).padStart(6, "0")}</LENG>\n    </DD03P>`,
  )
  .join("\n")}
   </DD03P_TABLE>
${DDIC_FOOTER}`,
});

const tableType = (name: string, text: string, row: { structure: string } | { datatype: "STRG" | "RSTR" }): FrameworkSource => ({
  fileName: `${name.toLowerCase()}.ttyp.xml`,
  source: `${ddicHeader("LCL_OBJECT_TTYP")}   <DD40V>
    <TYPENAME>${name}</TYPENAME>
    <DDLANGUAGE>E</DDLANGUAGE>
${"structure" in row ? `    <ROWTYPE>${row.structure}</ROWTYPE>\n    <ROWKIND>S</ROWKIND>\n    <DATATYPE>STRU</DATATYPE>` : `    <DATATYPE>${row.datatype}</DATATYPE>`}
    <ACCESSMODE>T</ACCESSMODE>
    <KEYDEF>D</KEYDEF>
    <KEYKIND>N</KEYKIND>
    <DDTEXT>${text}</DDTEXT>
   </DD40V>
${DDIC_FOOTER}`,
});

const DDIC: FrameworkSource[] = [
  tableType("STRING_TABLE", "Table of strings", { datatype: "STRG" }),
  tableType("XSTRING_TABLE", "Table of byte strings", { datatype: "RSTR" }),
  structure("SUBMATCH_RESULT", "Submatch of a regular expression", [
    { name: "OFFSET", type: "INT4" },
    { name: "LENGTH", type: "INT4" },
  ]),
  tableType("SUBMATCH_RESULT_TAB", "Submatches of a regular expression", { structure: "SUBMATCH_RESULT" }),
  structure("MATCH_RESULT", "Match of a regular expression", [
    { name: "LINE", type: "INT4" },
    { name: "OFFSET", type: "INT4" },
    { name: "LENGTH", type: "INT4" },
    { name: "SUBMATCHES", table: "SUBMATCH_RESULT_TAB" },
  ]),
  tableType("MATCH_RESULT_TAB", "Matches of a regular expression", { structure: "MATCH_RESULT" }),
];

/** The types of the type pool ABAP used by the RTTS (abap_compdescr_tab, abap_component_tab). */
const TYPE_POOL_ABAP = `TYPE-POOL abap.
TYPES abap_compname TYPE c LENGTH 30.
TYPES abap_typekind TYPE c LENGTH 1.
TYPES abap_abstypename TYPE c LENGTH 200.
TYPES: BEGIN OF abap_compdescr,
         length    TYPE i,
         decimals  TYPE i,
         type_kind TYPE abap_typekind,
         name      TYPE abap_compname,
       END OF abap_compdescr.
TYPES abap_compdescr_tab TYPE STANDARD TABLE OF abap_compdescr WITH DEFAULT KEY.
TYPES: BEGIN OF abap_componentdescr,
         name       TYPE string,
         type       TYPE REF TO cl_abap_datadescr,
         as_include TYPE abap_bool,
         suffix     TYPE string,
       END OF abap_componentdescr.
TYPES abap_component_tab TYPE STANDARD TABLE OF abap_componentdescr WITH DEFAULT KEY.
`;

// ------------------------------------------------------------------------------ exceptions

/** An exception with a text of its own (`zrap_text`, from cx_static_check / the http framework). */
const exception = (name: string, superclass: string): FrameworkSource => ({
  fileName: `${name}.clas.abap`,
  source: `CLASS ${name} DEFINITION PUBLIC INHERITING FROM ${superclass} CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS constructor
      IMPORTING textid    LIKE textid OPTIONAL
                previous  LIKE previous OPTIONAL
                zrap_text TYPE string OPTIONAL.
ENDCLASS.

CLASS ${name} IMPLEMENTATION.
  METHOD constructor.
    super->constructor( textid = textid previous = previous zrap_text = zrap_text ).
  ENDMETHOD.
ENDCLASS.
`,
});

/** Roots under cx_dynamic_check / cx_no_check with a text (cx_static_check has zrap_text already). */
const textRoot = (name: string, superclass: string): FrameworkSource => ({
  fileName: `${name}.clas.abap`,
  source: `CLASS ${name} DEFINITION PUBLIC INHERITING FROM ${superclass} CREATE PUBLIC.
  PUBLIC SECTION.
    DATA zrap_text TYPE string READ-ONLY.
    METHODS constructor
      IMPORTING textid    LIKE textid OPTIONAL
                previous  LIKE previous OPTIONAL
                zrap_text TYPE string OPTIONAL.
ENDCLASS.

CLASS ${name} IMPLEMENTATION.
  METHOD constructor.
    super->constructor( textid = textid previous = previous ).
    me->zrap_text = zrap_text.
  ENDMETHOD.
ENDCLASS.
`,
});

const EXCEPTIONS: FrameworkSource[] = [
  textRoot("cx_sy_conversion_codepage", "cx_sy_conversion_error"),
  textRoot("cx_sy_compression_error", "cx_dynamic_check"),
  textRoot("cx_sy_regex", "cx_dynamic_check"),
  textRoot("cx_abap_random", "cx_dynamic_check"),
  textRoot("cx_sy_rtti_type_not_released", "cx_dynamic_check"),
  textRoot("cx_parameter_invalid_range", "cx_dynamic_check"),
  textRoot("cx_abap_utclong_invalid", "cx_dynamic_check"),
  textRoot("cx_abap_message_digest", "cx_static_check"),
  textRoot("cx_number_ranges", "cx_static_check"),
  exception("cx_nr_object_not_found", "cx_number_ranges"),
  exception("cx_nr_subobject", "cx_number_ranges"),
  textRoot("cx_bali_runtime", "cx_static_check"),
  exception("cx_bali_not_possible", "cx_bali_runtime"),
  exception("cx_bali_invalid_parameter", "cx_bali_runtime"),
];

// ------------------------------------------------------------------------------ JSON

const UI2_CL_JSON = `CLASS /ui2/cl_json DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES json TYPE string.
    TYPES bool TYPE c LENGTH 1.
    TYPES pretty_name_mode TYPE c LENGTH 1.
    TYPES: BEGIN OF name_mapping,
             abap TYPE abap_compname,
             json TYPE string,
           END OF name_mapping.
    TYPES name_mappings TYPE HASHED TABLE OF name_mapping WITH UNIQUE KEY abap.
    CONSTANTS:
      BEGIN OF pretty_mode,
        none          TYPE pretty_name_mode VALUE ' ',
        low_case      TYPE pretty_name_mode VALUE 'L',
        camel_case    TYPE pretty_name_mode VALUE 'X',
        extended      TYPE pretty_name_mode VALUE 'Y',
        user          TYPE pretty_name_mode VALUE 'U',
        user_low_case TYPE pretty_name_mode VALUE 'C',
      END OF pretty_mode.
    CONSTANTS:
      BEGIN OF c_bool,
        true  TYPE bool VALUE 'X',
        false TYPE bool VALUE ' ',
      END OF c_bool.
    CLASS-METHODS serialize
      IMPORTING data             TYPE data
                compress         TYPE bool DEFAULT c_bool-false
                name             TYPE string OPTIONAL
                pretty_name      TYPE pretty_name_mode DEFAULT pretty_mode-none
                assoc_arrays     TYPE bool DEFAULT c_bool-false
                ts_as_iso8601    TYPE bool DEFAULT c_bool-false
                expand_includes  TYPE bool DEFAULT c_bool-true
                assoc_arrays_opt TYPE bool DEFAULT c_bool-false
                numc_as_string   TYPE bool DEFAULT c_bool-false
                name_mappings    TYPE name_mappings OPTIONAL
                conversion_exits TYPE bool DEFAULT c_bool-false
                format_output    TYPE bool DEFAULT c_bool-false
                hex_as_base64    TYPE bool DEFAULT c_bool-true
      RETURNING VALUE(r_json)    TYPE json.
    CLASS-METHODS deserialize
      IMPORTING json             TYPE json OPTIONAL
                jsonx            TYPE xstring OPTIONAL
                pretty_name      TYPE pretty_name_mode DEFAULT pretty_mode-none
                assoc_arrays     TYPE bool DEFAULT c_bool-false
                assoc_arrays_opt TYPE bool DEFAULT c_bool-false
                name_mappings    TYPE name_mappings OPTIONAL
                conversion_exits TYPE bool DEFAULT c_bool-false
                hex_as_base64    TYPE bool DEFAULT c_bool-true
      CHANGING  data             TYPE data.
  PRIVATE SECTION.
    CLASS-METHODS mappings_text
      IMPORTING name_mappings TYPE name_mappings
      RETURNING VALUE(text)   TYPE string.
ENDCLASS.

CLASS /ui2/cl_json IMPLEMENTATION.
  METHOD mappings_text.
    DATA mapping TYPE name_mapping.
    LOOP AT name_mappings INTO mapping.
      text = text && mapping-abap && |\\t| && mapping-json && |\\n|.
    ENDLOOP.
  ENDMETHOD.

  METHOD serialize.
    r_json = zrap_eml=>json_serialize( data           = data
                                       mode           = |{ pretty_name }|
                                       compress       = compress
                                       numc_as_string = numc_as_string
                                       ts_as_iso8601  = ts_as_iso8601
                                       hex_as_base64  = hex_as_base64
                                       format_output  = format_output
                                       booleans       = abap_true
                                       mappings       = mappings_text( name_mappings ) ).
    IF name IS NOT INITIAL.
      r_json = |\\{"{ name }":{ r_json }\\}|.
    ENDIF.
  ENDMETHOD.

  METHOD deserialize.
    DATA text TYPE string.
    text = json.
    IF text IS INITIAL AND jsonx IS NOT INITIAL.
      text = zrap_eml=>codepage_in( codepage = \`UTF-8\` source = jsonx ).
    ENDIF.
    IF text IS INITIAL.
      RETURN.
    ENDIF.
    zrap_eml=>json_deserialize( EXPORTING json          = text
                                          mode          = |{ pretty_name }|
                                          hex_as_base64 = hex_as_base64
                                          mappings      = mappings_text( name_mappings )
                                CHANGING  data          = data ).
  ENDMETHOD.
ENDCLASS.
`;

const IF_XCO_CP_JSON_TRANSFORMATION = `INTERFACE if_xco_cp_json_transformation PUBLIC.
  DATA kind TYPE string READ-ONLY.
ENDINTERFACE.
`;

const ZRAP_CL_XCO_JSON_TRANSFORMATION = `CLASS zrap_cl_xco_json_trafo DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_xco_cp_json_transformation.
    METHODS constructor IMPORTING kind TYPE string.
ENDCLASS.

CLASS zrap_cl_xco_json_trafo IMPLEMENTATION.
  METHOD constructor.
    if_xco_cp_json_transformation~kind = kind.
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_JSON_TRAFOS = `CLASS zrap_cl_xco_json_trafos DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA camel_case_to_underscore TYPE REF TO if_xco_cp_json_transformation READ-ONLY.
    DATA underscore_to_camel_case TYPE REF TO if_xco_cp_json_transformation READ-ONLY.
    DATA pascal_case_to_underscore TYPE REF TO if_xco_cp_json_transformation READ-ONLY.
    DATA underscore_to_pascal_case TYPE REF TO if_xco_cp_json_transformation READ-ONLY.
    DATA boolean_to_abap_bool TYPE REF TO if_xco_cp_json_transformation READ-ONLY.
    DATA abap_bool_to_boolean TYPE REF TO if_xco_cp_json_transformation READ-ONLY.
    METHODS constructor.
ENDCLASS.

CLASS zrap_cl_xco_json_trafos IMPLEMENTATION.
  METHOD constructor.
    camel_case_to_underscore = NEW zrap_cl_xco_json_trafo( \`camel_case_to_underscore\` ).
    underscore_to_camel_case = NEW zrap_cl_xco_json_trafo( \`underscore_to_camel_case\` ).
    pascal_case_to_underscore = NEW zrap_cl_xco_json_trafo( \`pascal_case_to_underscore\` ).
    underscore_to_pascal_case = NEW zrap_cl_xco_json_trafo( \`underscore_to_pascal_case\` ).
    boolean_to_abap_bool = NEW zrap_cl_xco_json_trafo( \`boolean_to_abap_bool\` ).
    abap_bool_to_boolean = NEW zrap_cl_xco_json_trafo( \`abap_bool_to_boolean\` ).
  ENDMETHOD.
ENDCLASS.
`;

const IF_XCO_CP_JSON_DATA = `INTERFACE if_xco_cp_json_data PUBLIC.
  TYPES tt_transformations TYPE STANDARD TABLE OF REF TO if_xco_cp_json_transformation WITH EMPTY KEY.
  METHODS apply
    IMPORTING it_transformations TYPE tt_transformations
    RETURNING VALUE(ro_json_data) TYPE REF TO if_xco_cp_json_data.
  METHODS to_string
    RETURNING VALUE(rv_string) TYPE string.
  METHODS write_to
    IMPORTING ia_data TYPE REF TO data.
ENDINTERFACE.
`;

const ZRAP_CL_XCO_JSON_DATA = `CLASS zrap_cl_xco_json_data DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_xco_cp_json_data.
    METHODS constructor IMPORTING json TYPE string.
  PRIVATE SECTION.
    DATA json TYPE string.
ENDCLASS.

CLASS zrap_cl_xco_json_data IMPLEMENTATION.
  METHOD constructor.
    me->json = json.
  ENDMETHOD.

  METHOD if_xco_cp_json_data~apply.
    DATA kinds TYPE string.
    DATA transformation TYPE REF TO if_xco_cp_json_transformation.
    LOOP AT it_transformations INTO transformation.
      kinds = kinds && transformation->kind && \` \`.
    ENDLOOP.
    ro_json_data = NEW zrap_cl_xco_json_data( zrap_eml=>json_transform( json = json kinds = kinds ) ).
  ENDMETHOD.

  METHOD if_xco_cp_json_data~to_string.
    rv_string = json.
  ENDMETHOD.

  METHOD if_xco_cp_json_data~write_to.
    FIELD-SYMBOLS <data> TYPE any.
    ASSIGN ia_data->* TO <data>.
    zrap_eml=>json_deserialize( EXPORTING json = json mode = \`xco\` CHANGING data = <data> ).
  ENDMETHOD.
ENDCLASS.
`;

const IF_XCO_CP_JSON_DATA_BUILDER = `INTERFACE if_xco_cp_json_data_builder PUBLIC.
  METHODS begin_object RETURNING VALUE(ro_builder) TYPE REF TO if_xco_cp_json_data_builder.
  METHODS end_object RETURNING VALUE(ro_builder) TYPE REF TO if_xco_cp_json_data_builder.
  METHODS begin_array RETURNING VALUE(ro_builder) TYPE REF TO if_xco_cp_json_data_builder.
  METHODS end_array RETURNING VALUE(ro_builder) TYPE REF TO if_xco_cp_json_data_builder.
  METHODS add_member
    IMPORTING iv_name TYPE csequence
    RETURNING VALUE(ro_builder) TYPE REF TO if_xco_cp_json_data_builder.
  METHODS add_string
    IMPORTING iv_value TYPE csequence
    RETURNING VALUE(ro_builder) TYPE REF TO if_xco_cp_json_data_builder.
  METHODS add_number
    IMPORTING iv_value TYPE simple
    RETURNING VALUE(ro_builder) TYPE REF TO if_xco_cp_json_data_builder.
  METHODS add_boolean
    IMPORTING iv_value TYPE abap_bool
    RETURNING VALUE(ro_builder) TYPE REF TO if_xco_cp_json_data_builder.
  METHODS add_null RETURNING VALUE(ro_builder) TYPE REF TO if_xco_cp_json_data_builder.
  METHODS get_data RETURNING VALUE(ro_json_data) TYPE REF TO if_xco_cp_json_data.
ENDINTERFACE.
`;

const ZRAP_CL_XCO_JSON_BUILDER = `CLASS zrap_cl_xco_json_builder DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_xco_cp_json_data_builder.
  PRIVATE SECTION.
    DATA json TYPE string.
    "! One flag per open object or array: a value was written (a comma comes before the next).
    DATA filled TYPE STANDARD TABLE OF abap_bool WITH EMPTY KEY.
    DATA after_member TYPE abap_bool.
    METHODS value IMPORTING text TYPE string.
    METHODS open IMPORTING text TYPE string.
    METHODS close IMPORTING text TYPE string.
ENDCLASS.

CLASS zrap_cl_xco_json_builder IMPLEMENTATION.
  METHOD value.
    DATA count TYPE i.
    count = lines( filled ).
    IF after_member = abap_false AND count > 0.
      IF filled[ count ] = abap_true.
        json = json && \`,\`.
      ENDIF.
      MODIFY filled FROM abap_true INDEX count.
    ENDIF.
    after_member = abap_false.
    json = json && text.
  ENDMETHOD.

  METHOD open.
    value( text ).
    APPEND abap_false TO filled.
  ENDMETHOD.

  METHOD close.
    DELETE filled INDEX lines( filled ).
    json = json && text.
  ENDMETHOD.

  METHOD if_xco_cp_json_data_builder~begin_object.
    open( \`{\` ).
    ro_builder = me.
  ENDMETHOD.

  METHOD if_xco_cp_json_data_builder~end_object.
    close( \`}\` ).
    ro_builder = me.
  ENDMETHOD.

  METHOD if_xco_cp_json_data_builder~begin_array.
    open( \`[\` ).
    ro_builder = me.
  ENDMETHOD.

  METHOD if_xco_cp_json_data_builder~end_array.
    close( \`]\` ).
    ro_builder = me.
  ENDMETHOD.

  METHOD if_xco_cp_json_data_builder~add_member.
    value( zrap_eml=>json_quote( |{ iv_name }| ) && \`:\` ).
    after_member = abap_true.
    ro_builder = me.
  ENDMETHOD.

  METHOD if_xco_cp_json_data_builder~add_string.
    value( zrap_eml=>json_quote( |{ iv_value }| ) ).
    ro_builder = me.
  ENDMETHOD.

  METHOD if_xco_cp_json_data_builder~add_number.
    DATA text TYPE string.
    text = |{ iv_value }|.
    CONDENSE text NO-GAPS.
    value( text ).
    ro_builder = me.
  ENDMETHOD.

  METHOD if_xco_cp_json_data_builder~add_boolean.
    IF iv_value = abap_true.
      value( \`true\` ).
    ELSE.
      value( \`false\` ).
    ENDIF.
    ro_builder = me.
  ENDMETHOD.

  METHOD if_xco_cp_json_data_builder~add_null.
    value( \`null\` ).
    ro_builder = me.
  ENDMETHOD.

  METHOD if_xco_cp_json_data_builder~get_data.
    ro_json_data = NEW zrap_cl_xco_json_data( json ).
  ENDMETHOD.
ENDCLASS.
`;

const IF_XCO_CP_JSON_DATA_FACTORY = `INTERFACE if_xco_cp_json_data_factory PUBLIC.
  METHODS from_string
    IMPORTING iv_string TYPE string
    RETURNING VALUE(ro_json_data) TYPE REF TO if_xco_cp_json_data.
  METHODS from_abap
    IMPORTING ia_abap TYPE any
    RETURNING VALUE(ro_json_data) TYPE REF TO if_xco_cp_json_data.
  METHODS builder
    RETURNING VALUE(ro_builder) TYPE REF TO if_xco_cp_json_data_builder.
ENDINTERFACE.
`;

const ZRAP_CL_XCO_JSON_FACTORY = `CLASS zrap_cl_xco_json_factory DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_xco_cp_json_data_factory.
ENDCLASS.

CLASS zrap_cl_xco_json_factory IMPLEMENTATION.
  METHOD if_xco_cp_json_data_factory~from_string.
    ro_json_data = NEW zrap_cl_xco_json_data( iv_string ).
  ENDMETHOD.

  METHOD if_xco_cp_json_data_factory~from_abap.
    ro_json_data = NEW zrap_cl_xco_json_data( zrap_eml=>json_serialize( data = ia_abap mode = \`xco\` numc_as_string = abap_true ) ).
  ENDMETHOD.

  METHOD if_xco_cp_json_data_factory~builder.
    ro_builder = NEW zrap_cl_xco_json_builder( ).
  ENDMETHOD.
ENDCLASS.
`;

const XCO_CP_JSON = `CLASS xco_cp_json DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-DATA data TYPE REF TO if_xco_cp_json_data_factory READ-ONLY.
    CLASS-DATA transformation TYPE REF TO zrap_cl_xco_json_trafos READ-ONLY.
    CLASS-METHODS class_constructor.
ENDCLASS.

CLASS xco_cp_json IMPLEMENTATION.
  METHOD class_constructor.
    data = NEW zrap_cl_xco_json_factory( ).
    transformation = NEW zrap_cl_xco_json_trafos( ).
  ENDMETHOD.
ENDCLASS.
`;

// ------------------------------------------------------------------------------ encodings and text

const CL_WEB_HTTP_UTILITY = `CLASS cl_web_http_utility DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS encode_base64
      IMPORTING unencoded      TYPE string
      RETURNING VALUE(encoded) TYPE string.
    CLASS-METHODS decode_base64
      IMPORTING encoded        TYPE string
      RETURNING VALUE(decoded) TYPE string.
    CLASS-METHODS encode_x_base64
      IMPORTING unencoded      TYPE xstring
      RETURNING VALUE(encoded) TYPE string.
    CLASS-METHODS decode_x_base64
      IMPORTING encoded        TYPE string
      RETURNING VALUE(decoded) TYPE xstring.
    CLASS-METHODS encode_utf8
      IMPORTING unencoded      TYPE string
      RETURNING VALUE(encoded) TYPE xstring.
    CLASS-METHODS decode_utf8
      IMPORTING encoded        TYPE xstring
      RETURNING VALUE(decoded) TYPE string.
    CLASS-METHODS escape_url
      IMPORTING unescaped      TYPE string
      RETURNING VALUE(escaped) TYPE string.
    CLASS-METHODS unescape_url
      IMPORTING escaped          TYPE string
      RETURNING VALUE(unescaped) TYPE string.
    CLASS-METHODS escape_html
      IMPORTING unescaped      TYPE string
      RETURNING VALUE(escaped) TYPE string.
ENDCLASS.

CLASS cl_web_http_utility IMPLEMENTATION.
  METHOD encode_base64.
    encoded = zrap_eml=>base64_encode( unencoded ).
  ENDMETHOD.

  METHOD decode_base64.
    decoded = zrap_eml=>codepage_in( codepage = \`UTF-8\` source = zrap_eml=>base64_decode( encoded ) ).
  ENDMETHOD.

  METHOD encode_x_base64.
    encoded = zrap_eml=>base64_encode_x( unencoded ).
  ENDMETHOD.

  METHOD decode_x_base64.
    decoded = zrap_eml=>base64_decode( encoded ).
  ENDMETHOD.

  METHOD encode_utf8.
    encoded = zrap_eml=>codepage_out( codepage = \`UTF-8\` source = unencoded ).
  ENDMETHOD.

  METHOD decode_utf8.
    decoded = zrap_eml=>codepage_in( codepage = \`UTF-8\` source = encoded ).
  ENDMETHOD.

  METHOD escape_url.
    escaped = zrap_eml=>text_escape( format = \`url\` text = unescaped ).
  ENDMETHOD.

  METHOD unescape_url.
    unescaped = zrap_eml=>text_escape( format = \`url_unescape\` text = escaped ).
  ENDMETHOD.

  METHOD escape_html.
    escaped = zrap_eml=>text_escape( format = \`html\` text = unescaped ).
  ENDMETHOD.
ENDCLASS.
`;

const IF_ABAP_CONV_OUT = `INTERFACE if_abap_conv_out PUBLIC.
  METHODS convert
    IMPORTING source        TYPE csequence
    RETURNING VALUE(result) TYPE xstring
    RAISING   cx_sy_conversion_codepage.
ENDINTERFACE.
`;

const IF_ABAP_CONV_IN = `INTERFACE if_abap_conv_in PUBLIC.
  METHODS convert
    IMPORTING source        TYPE xsequence
    RETURNING VALUE(result) TYPE string
    RAISING   cx_sy_conversion_codepage.
ENDINTERFACE.
`;

const CL_ABAP_CONV_CODEPAGE = `CLASS cl_abap_conv_codepage DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    INTERFACES if_abap_conv_out.
    INTERFACES if_abap_conv_in.
    CLASS-METHODS create_out
      IMPORTING codepage        TYPE string DEFAULT \`UTF-8\`
                replacement     TYPE string OPTIONAL
                ignore_cerr     TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(instance) TYPE REF TO if_abap_conv_out
      RAISING   cx_parameter_invalid_range.
    CLASS-METHODS create_in
      IMPORTING codepage        TYPE string DEFAULT \`UTF-8\`
                replacement     TYPE string OPTIONAL
                ignore_cerr     TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(instance) TYPE REF TO if_abap_conv_in
      RAISING   cx_parameter_invalid_range.
    METHODS constructor IMPORTING codepage TYPE string.
  PRIVATE SECTION.
    DATA codepage TYPE string.
ENDCLASS.

CLASS cl_abap_conv_codepage IMPLEMENTATION.
  METHOD constructor.
    me->codepage = codepage.
  ENDMETHOD.

  METHOD create_out.
    zrap_eml=>codepage_check( codepage ).
    instance = NEW cl_abap_conv_codepage( codepage ).
  ENDMETHOD.

  METHOD create_in.
    zrap_eml=>codepage_check( codepage ).
    instance = NEW cl_abap_conv_codepage( codepage ).
  ENDMETHOD.

  METHOD if_abap_conv_out~convert.
    result = zrap_eml=>codepage_out( codepage = codepage source = |{ source }| ).
  ENDMETHOD.

  METHOD if_abap_conv_in~convert.
    DATA bytes TYPE xstring.
    bytes = source.
    result = zrap_eml=>codepage_in( codepage = codepage source = bytes ).
  ENDMETHOD.
ENDCLASS.
`;

const CL_ABAP_GZIP = `CLASS cl_abap_gzip DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS compress_binary
      IMPORTING raw_in   TYPE xsequence
      EXPORTING gzip_out TYPE xstring
                gzip_out_len TYPE i
      RAISING   cx_sy_compression_error.
    CLASS-METHODS decompress_binary
      IMPORTING gzip_in TYPE xsequence
      EXPORTING raw_out TYPE xstring
                raw_out_len TYPE i
      RAISING   cx_sy_compression_error.
    CLASS-METHODS compress_text
      IMPORTING text_in  TYPE csequence
      EXPORTING gzip_out TYPE xstring
                gzip_out_len TYPE i
      RAISING   cx_sy_compression_error.
    CLASS-METHODS decompress_text
      IMPORTING gzip_in  TYPE xsequence
      EXPORTING text_out TYPE string
                text_out_len TYPE i
      RAISING   cx_sy_compression_error.
ENDCLASS.

CLASS cl_abap_gzip IMPLEMENTATION.
  METHOD compress_binary.
    DATA bytes TYPE xstring.
    bytes = raw_in.
    gzip_out = zrap_eml=>gzip( operation = \`compress\` source = bytes ).
    gzip_out_len = xstrlen( gzip_out ).
  ENDMETHOD.

  METHOD decompress_binary.
    DATA bytes TYPE xstring.
    bytes = gzip_in.
    raw_out = zrap_eml=>gzip( operation = \`decompress\` source = bytes ).
    raw_out_len = xstrlen( raw_out ).
  ENDMETHOD.

  METHOD compress_text.
    gzip_out = zrap_eml=>gzip( operation = \`compress\` source = zrap_eml=>codepage_out( codepage = \`UTF-8\` source = |{ text_in }| ) ).
    gzip_out_len = xstrlen( gzip_out ).
  ENDMETHOD.

  METHOD decompress_text.
    DATA bytes TYPE xstring.
    bytes = gzip_in.
    text_out = zrap_eml=>codepage_in( codepage = \`UTF-8\` source = zrap_eml=>gzip( operation = \`decompress\` source = bytes ) ).
    text_out_len = strlen( text_out ).
  ENDMETHOD.
ENDCLASS.
`;

const CL_ABAP_CHAR_UTILITIES = `CLASS cl_abap_char_utilities DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-DATA newline TYPE c LENGTH 1 READ-ONLY.
    CLASS-DATA cr_lf TYPE c LENGTH 2 READ-ONLY.
    CLASS-DATA horizontal_tab TYPE c LENGTH 1 READ-ONLY.
    CLASS-DATA vertical_tab TYPE c LENGTH 1 READ-ONLY.
    CLASS-DATA form_feed TYPE c LENGTH 1 READ-ONLY.
    CLASS-DATA backspace TYPE c LENGTH 1 READ-ONLY.
    CLASS-DATA maxchar TYPE c LENGTH 1 READ-ONLY.
    CLASS-DATA byte_order_mark_utf8 TYPE x LENGTH 3 READ-ONLY.
    CONSTANTS charsize TYPE i VALUE 2.
    CONSTANTS endian TYPE c LENGTH 1 VALUE 'L'.
    CLASS-METHODS class_constructor.
ENDCLASS.

CLASS cl_abap_char_utilities IMPLEMENTATION.
  METHOD class_constructor.
    newline = |\\n|.
    cr_lf = |\\r\\n|.
    horizontal_tab = |\\t|.
    " the class constructor runs when the module loads, before the kernel: the characters are literals
    vertical_tab = \`\v\`.
    form_feed = \`\f\`.
    backspace = \`\b\`.
    maxchar = \`\uFFFD\`.
    byte_order_mark_utf8 = 'EFBBBF'.
  ENDMETHOD.
ENDCLASS.
`;

const CL_ABAP_STRING_UTILITIES = `CLASS cl_abap_string_utilities DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS del_trailing_blanks
      CHANGING str TYPE string.
    CLASS-METHODS c2str_preserving_blanks
      IMPORTING source TYPE c
      EXPORTING dest   TYPE string.
ENDCLASS.

CLASS cl_abap_string_utilities IMPLEMENTATION.
  METHOD del_trailing_blanks.
    str = zrap_eml=>text_escape( format = \`rtrim\` text = str ).
  ENDMETHOD.

  METHOD c2str_preserving_blanks.
    dest = zrap_eml=>chars_raw( source ).
  ENDMETHOD.
ENDCLASS.
`;

// ------------------------------------------------------------------------------ XCO: strings, time, sy

const ZRAP_CL_XCO_ENCODING = `CLASS zrap_cl_xco_encoding DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! UTF-8, UTF-16 … (code page) or base64 (text encoding of binary data).
    DATA value TYPE string READ-ONLY.
    METHODS constructor IMPORTING value TYPE string.
ENDCLASS.

CLASS zrap_cl_xco_encoding IMPLEMENTATION.
  METHOD constructor.
    me->value = value.
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_CODE_PAGES = `CLASS zrap_cl_xco_code_pages DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA utf_8 TYPE REF TO zrap_cl_xco_encoding READ-ONLY.
    DATA utf_16 TYPE REF TO zrap_cl_xco_encoding READ-ONLY.
    DATA utf_16le TYPE REF TO zrap_cl_xco_encoding READ-ONLY.
    DATA utf_16be TYPE REF TO zrap_cl_xco_encoding READ-ONLY.
    DATA iso_8859_1 TYPE REF TO zrap_cl_xco_encoding READ-ONLY.
    DATA us_ascii TYPE REF TO zrap_cl_xco_encoding READ-ONLY.
    METHODS constructor.
ENDCLASS.

CLASS zrap_cl_xco_code_pages IMPLEMENTATION.
  METHOD constructor.
    utf_8 = NEW zrap_cl_xco_encoding( \`UTF-8\` ).
    utf_16 = NEW zrap_cl_xco_encoding( \`UTF-16\` ).
    utf_16le = NEW zrap_cl_xco_encoding( \`UTF-16LE\` ).
    utf_16be = NEW zrap_cl_xco_encoding( \`UTF-16BE\` ).
    iso_8859_1 = NEW zrap_cl_xco_encoding( \`ISO-8859-1\` ).
    us_ascii = NEW zrap_cl_xco_encoding( \`US-ASCII\` ).
  ENDMETHOD.
ENDCLASS.
`;

const XCO_CP_CHARACTER = `CLASS xco_cp_character DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-DATA code_page TYPE REF TO zrap_cl_xco_code_pages READ-ONLY.
    CLASS-METHODS class_constructor.
ENDCLASS.

CLASS xco_cp_character IMPLEMENTATION.
  METHOD class_constructor.
    code_page = NEW zrap_cl_xco_code_pages( ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_TEXT_ENCODINGS = `CLASS zrap_cl_xco_text_encodings DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA base64 TYPE REF TO zrap_cl_xco_encoding READ-ONLY.
    METHODS constructor.
ENDCLASS.

CLASS zrap_cl_xco_text_encodings IMPLEMENTATION.
  METHOD constructor.
    base64 = NEW zrap_cl_xco_encoding( \`BASE64\` ).
  ENDMETHOD.
ENDCLASS.
`;

const XCO_CP_BINARY = `CLASS xco_cp_binary DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-DATA text_encoding TYPE REF TO zrap_cl_xco_text_encodings READ-ONLY.
    CLASS-METHODS class_constructor.
ENDCLASS.

CLASS xco_cp_binary IMPLEMENTATION.
  METHOD class_constructor.
    text_encoding = NEW zrap_cl_xco_text_encodings( ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_STRING = `CLASS zrap_cl_xco_string DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA value TYPE string READ-ONLY.
    METHODS constructor IMPORTING value TYPE string.
    METHODS as_xstring
      IMPORTING io_encoding TYPE REF TO zrap_cl_xco_encoding
      RETURNING VALUE(ro_xstring) TYPE REF TO zrap_cl_xco_xstring.
    METHODS to_upper_case RETURNING VALUE(ro_string) TYPE REF TO zrap_cl_xco_string.
    METHODS to_lower_case RETURNING VALUE(ro_string) TYPE REF TO zrap_cl_xco_string.
    METHODS append
      IMPORTING iv_string TYPE csequence
      RETURNING VALUE(ro_string) TYPE REF TO zrap_cl_xco_string.
    METHODS prepend
      IMPORTING iv_string TYPE csequence
      RETURNING VALUE(ro_string) TYPE REF TO zrap_cl_xco_string.
    METHODS split
      IMPORTING iv_delimiter TYPE csequence
      RETURNING VALUE(ro_strings) TYPE REF TO zrap_cl_xco_strings.
    METHODS starts_with
      IMPORTING iv_value TYPE csequence
      RETURNING VALUE(rv_starts_with) TYPE abap_bool.
    METHODS ends_with
      IMPORTING iv_value TYPE csequence
      RETURNING VALUE(rv_ends_with) TYPE abap_bool.
    METHODS get_length RETURNING VALUE(rv_length) TYPE i.
ENDCLASS.

CLASS zrap_cl_xco_string IMPLEMENTATION.
  METHOD constructor.
    me->value = value.
  ENDMETHOD.

  METHOD as_xstring.
    IF io_encoding->value = \`BASE64\`.
      ro_xstring = NEW zrap_cl_xco_xstring( zrap_eml=>base64_decode( value ) ).
    ELSE.
      ro_xstring = NEW zrap_cl_xco_xstring( zrap_eml=>codepage_out( codepage = io_encoding->value source = value ) ).
    ENDIF.
  ENDMETHOD.

  METHOD to_upper_case.
    ro_string = NEW zrap_cl_xco_string( to_upper( value ) ).
  ENDMETHOD.

  METHOD to_lower_case.
    ro_string = NEW zrap_cl_xco_string( to_lower( value ) ).
  ENDMETHOD.

  METHOD append.
    ro_string = NEW zrap_cl_xco_string( value && iv_string ).
  ENDMETHOD.

  METHOD prepend.
    ro_string = NEW zrap_cl_xco_string( iv_string && value ).
  ENDMETHOD.

  METHOD split.
    DATA parts TYPE string_table.
    DATA delimiter TYPE string.
    delimiter = iv_delimiter.
    SPLIT value AT delimiter INTO TABLE parts.
    ro_strings = NEW zrap_cl_xco_strings( parts ).
  ENDMETHOD.

  METHOD starts_with.
    DATA prefix TYPE string.
    prefix = iv_value.
    rv_starts_with = xsdbool( strlen( value ) >= strlen( prefix ) AND substring( val = value len = strlen( prefix ) ) = prefix ).
  ENDMETHOD.

  METHOD ends_with.
    DATA suffix TYPE string.
    suffix = iv_value.
    rv_ends_with = xsdbool( strlen( value ) >= strlen( suffix ) AND substring( val = value off = strlen( value ) - strlen( suffix ) ) = suffix ).
  ENDMETHOD.

  METHOD get_length.
    rv_length = strlen( value ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_STRINGS = `CLASS zrap_cl_xco_strings DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA value TYPE string_table READ-ONLY.
    METHODS constructor IMPORTING value TYPE string_table.
    METHODS join
      IMPORTING iv_delimiter TYPE csequence DEFAULT \`\`
      RETURNING VALUE(ro_string) TYPE REF TO zrap_cl_xco_string.
ENDCLASS.

CLASS zrap_cl_xco_strings IMPLEMENTATION.
  METHOD constructor.
    me->value = value.
  ENDMETHOD.

  METHOD join.
    DATA delimiter TYPE string.
    delimiter = iv_delimiter.
    ro_string = NEW zrap_cl_xco_string( concat_lines_of( table = value sep = delimiter ) ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_XSTRING = `CLASS zrap_cl_xco_xstring DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA value TYPE xstring READ-ONLY.
    METHODS constructor IMPORTING value TYPE xstring.
    METHODS as_string
      IMPORTING io_encoding TYPE REF TO zrap_cl_xco_encoding
      RETURNING VALUE(ro_string) TYPE REF TO zrap_cl_xco_string.
ENDCLASS.

CLASS zrap_cl_xco_xstring IMPLEMENTATION.
  METHOD constructor.
    me->value = value.
  ENDMETHOD.

  METHOD as_string.
    IF io_encoding->value = \`BASE64\`.
      ro_string = NEW zrap_cl_xco_string( zrap_eml=>base64_encode_x( value ) ).
    ELSE.
      ro_string = NEW zrap_cl_xco_string( zrap_eml=>codepage_in( codepage = io_encoding->value source = value ) ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_TIME_FORMAT = `CLASS zrap_cl_xco_time_format DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! abap, iso_8601_basic or iso_8601_extended.
    DATA value TYPE string READ-ONLY.
    METHODS constructor IMPORTING value TYPE string.
ENDCLASS.

CLASS zrap_cl_xco_time_format IMPLEMENTATION.
  METHOD constructor.
    me->value = value.
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_TIME_FORMATS = `CLASS zrap_cl_xco_time_formats DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA abap TYPE REF TO zrap_cl_xco_time_format READ-ONLY.
    DATA iso_8601_basic TYPE REF TO zrap_cl_xco_time_format READ-ONLY.
    DATA iso_8601_extended TYPE REF TO zrap_cl_xco_time_format READ-ONLY.
    METHODS constructor.
ENDCLASS.

CLASS zrap_cl_xco_time_formats IMPLEMENTATION.
  METHOD constructor.
    abap = NEW zrap_cl_xco_time_format( \`abap\` ).
    iso_8601_basic = NEW zrap_cl_xco_time_format( \`iso_8601_basic\` ).
    iso_8601_extended = NEW zrap_cl_xco_time_format( \`iso_8601_extended\` ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_TIME_ZONE = `CLASS zrap_cl_xco_time_zone DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! The time zone: UTC (the applications run in UTC, the user time zone is UTC).
    DATA value TYPE string READ-ONLY.
    METHODS constructor IMPORTING value TYPE string.
ENDCLASS.

CLASS zrap_cl_xco_time_zone IMPLEMENTATION.
  METHOD constructor.
    me->value = value.
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_TIME_ZONES = `CLASS zrap_cl_xco_time_zones DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA user TYPE REF TO zrap_cl_xco_time_zone READ-ONLY.
    DATA utc TYPE REF TO zrap_cl_xco_time_zone READ-ONLY.
    METHODS constructor.
ENDCLASS.

CLASS zrap_cl_xco_time_zones IMPLEMENTATION.
  METHOD constructor.
    user = NEW zrap_cl_xco_time_zone( \`UTC\` ).
    utc = NEW zrap_cl_xco_time_zone( \`UTC\` ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_DATE = `CLASS zrap_cl_xco_date DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA value TYPE d READ-ONLY.
    DATA year TYPE n LENGTH 4 READ-ONLY.
    DATA month TYPE n LENGTH 2 READ-ONLY.
    DATA day TYPE n LENGTH 2 READ-ONLY.
    METHODS constructor IMPORTING value TYPE d.
    METHODS as
      IMPORTING io_format TYPE REF TO zrap_cl_xco_time_format
      RETURNING VALUE(ro_string) TYPE REF TO zrap_cl_xco_string.
    METHODS add
      IMPORTING iv_year  TYPE i DEFAULT 0
                iv_month TYPE i DEFAULT 0
                iv_day   TYPE i DEFAULT 0
      RETURNING VALUE(ro_date) TYPE REF TO zrap_cl_xco_date.
    METHODS subtract
      IMPORTING iv_year  TYPE i DEFAULT 0
                iv_month TYPE i DEFAULT 0
                iv_day   TYPE i DEFAULT 0
      RETURNING VALUE(ro_date) TYPE REF TO zrap_cl_xco_date.
ENDCLASS.

CLASS zrap_cl_xco_date IMPLEMENTATION.
  METHOD constructor.
    me->value = value.
    year = value(4).
    month = value+4(2).
    day = value+6(2).
  ENDMETHOD.

  METHOD as.
    CASE io_format->value.
      WHEN \`iso_8601_extended\`.
        ro_string = NEW zrap_cl_xco_string( |{ year }-{ month }-{ day }| ).
      WHEN OTHERS.
        ro_string = NEW zrap_cl_xco_string( |{ value }| ).
    ENDCASE.
  ENDMETHOD.

  METHOD add.
    ro_date = NEW zrap_cl_xco_date( zrap_eml=>date_add( date = value years = iv_year months = iv_month days = iv_day ) ).
  ENDMETHOD.

  METHOD subtract.
    ro_date = NEW zrap_cl_xco_date( zrap_eml=>date_add( date = value years = 0 - iv_year months = 0 - iv_month days = 0 - iv_day ) ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_TIME = `CLASS zrap_cl_xco_time DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA value TYPE t READ-ONLY.
    DATA hour TYPE n LENGTH 2 READ-ONLY.
    DATA minute TYPE n LENGTH 2 READ-ONLY.
    DATA second TYPE n LENGTH 2 READ-ONLY.
    METHODS constructor IMPORTING value TYPE t.
    METHODS as
      IMPORTING io_format TYPE REF TO zrap_cl_xco_time_format
      RETURNING VALUE(ro_string) TYPE REF TO zrap_cl_xco_string.
    METHODS add
      IMPORTING iv_hour   TYPE i DEFAULT 0
                iv_minute TYPE i DEFAULT 0
                iv_second TYPE i DEFAULT 0
      RETURNING VALUE(ro_time) TYPE REF TO zrap_cl_xco_time.
    METHODS subtract
      IMPORTING iv_hour   TYPE i DEFAULT 0
                iv_minute TYPE i DEFAULT 0
                iv_second TYPE i DEFAULT 0
      RETURNING VALUE(ro_time) TYPE REF TO zrap_cl_xco_time.
ENDCLASS.

CLASS zrap_cl_xco_time IMPLEMENTATION.
  METHOD constructor.
    me->value = value.
    hour = value(2).
    minute = value+2(2).
    second = value+4(2).
  ENDMETHOD.

  METHOD as.
    CASE io_format->value.
      WHEN \`iso_8601_extended\`.
        ro_string = NEW zrap_cl_xco_string( |{ hour }:{ minute }:{ second }| ).
      WHEN OTHERS.
        ro_string = NEW zrap_cl_xco_string( |{ value }| ).
    ENDCASE.
  ENDMETHOD.

  METHOD add.
    DATA result TYPE t.
    result = value + iv_hour * 3600 + iv_minute * 60 + iv_second.
    ro_time = NEW zrap_cl_xco_time( result ).
  ENDMETHOD.

  METHOD subtract.
    DATA result TYPE t.
    result = value - iv_hour * 3600 - iv_minute * 60 - iv_second.
    ro_time = NEW zrap_cl_xco_time( result ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_MOMENT = `CLASS zrap_cl_xco_moment DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! The moment as a time stamp (UTC).
    DATA value TYPE timestamp READ-ONLY.
    DATA year TYPE n LENGTH 4 READ-ONLY.
    DATA month TYPE n LENGTH 2 READ-ONLY.
    DATA day TYPE n LENGTH 2 READ-ONLY.
    DATA hour TYPE n LENGTH 2 READ-ONLY.
    DATA minute TYPE n LENGTH 2 READ-ONLY.
    DATA second TYPE n LENGTH 2 READ-ONLY.
    METHODS constructor IMPORTING value TYPE timestamp.
    METHODS as
      IMPORTING io_format TYPE REF TO zrap_cl_xco_time_format
      RETURNING VALUE(ro_string) TYPE REF TO zrap_cl_xco_string.
    METHODS add
      IMPORTING iv_year   TYPE i DEFAULT 0
                iv_month  TYPE i DEFAULT 0
                iv_day    TYPE i DEFAULT 0
                iv_hour   TYPE i DEFAULT 0
                iv_minute TYPE i DEFAULT 0
                iv_second TYPE i DEFAULT 0
      RETURNING VALUE(ro_moment) TYPE REF TO zrap_cl_xco_moment.
    METHODS subtract
      IMPORTING iv_year   TYPE i DEFAULT 0
                iv_month  TYPE i DEFAULT 0
                iv_day    TYPE i DEFAULT 0
                iv_hour   TYPE i DEFAULT 0
                iv_minute TYPE i DEFAULT 0
                iv_second TYPE i DEFAULT 0
      RETURNING VALUE(ro_moment) TYPE REF TO zrap_cl_xco_moment.
    METHODS get_unix_timestamp RETURNING VALUE(ro_unix_timestamp) TYPE REF TO zrap_cl_xco_unix_timestamp.
    METHODS date RETURNING VALUE(ro_date) TYPE REF TO zrap_cl_xco_date.
    METHODS time RETURNING VALUE(ro_time) TYPE REF TO zrap_cl_xco_time.
  PRIVATE SECTION.
    DATA digits TYPE n LENGTH 14.
ENDCLASS.

CLASS zrap_cl_xco_moment IMPLEMENTATION.
  METHOD constructor.
    me->value = value.
    digits = value.
    year = digits(4).
    month = digits+4(2).
    day = digits+6(2).
    hour = digits+8(2).
    minute = digits+10(2).
    second = digits+12(2).
  ENDMETHOD.

  METHOD as.
    CASE io_format->value.
      WHEN \`iso_8601_extended\`.
        ro_string = NEW zrap_cl_xco_string( |{ year }-{ month }-{ day }T{ hour }:{ minute }:{ second }| ).
      WHEN \`iso_8601_basic\`.
        ro_string = NEW zrap_cl_xco_string( |{ year }{ month }{ day }T{ hour }{ minute }{ second }| ).
      WHEN OTHERS.
        ro_string = NEW zrap_cl_xco_string( |{ digits }| ).
    ENDCASE.
  ENDMETHOD.

  METHOD add.
    ro_moment = NEW zrap_cl_xco_moment( zrap_eml=>moment_add( moment = value years = iv_year months = iv_month days = iv_day
                                                              seconds = iv_hour * 3600 + iv_minute * 60 + iv_second ) ).
  ENDMETHOD.

  METHOD subtract.
    ro_moment = NEW zrap_cl_xco_moment( zrap_eml=>moment_add( moment = value years = 0 - iv_year months = 0 - iv_month days = 0 - iv_day
                                                              seconds = 0 - ( iv_hour * 3600 + iv_minute * 60 + iv_second ) ) ).
  ENDMETHOD.

  METHOD get_unix_timestamp.
    ro_unix_timestamp = NEW zrap_cl_xco_unix_timestamp( zrap_eml=>unix_time( value ) ).
  ENDMETHOD.

  METHOD date.
    DATA result TYPE d.
    result = digits(8).
    ro_date = NEW zrap_cl_xco_date( result ).
  ENDMETHOD.

  METHOD time.
    DATA result TYPE t.
    result = digits+8(6).
    ro_time = NEW zrap_cl_xco_time( result ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_UNIX_TIMESTAMP = `CLASS zrap_cl_xco_unix_timestamp DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Seconds since 1970-01-01 00:00:00 UTC.
    DATA value TYPE int8 READ-ONLY.
    METHODS constructor IMPORTING value TYPE int8.
ENDCLASS.

CLASS zrap_cl_xco_unix_timestamp IMPLEMENTATION.
  METHOD constructor.
    me->value = value.
  ENDMETHOD.
ENDCLASS.
`;

const XCO_CP_TIME = `CLASS xco_cp_time DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-DATA format TYPE REF TO zrap_cl_xco_time_formats READ-ONLY.
    CLASS-DATA time_zone TYPE REF TO zrap_cl_xco_time_zones READ-ONLY.
    CLASS-METHODS class_constructor.
    CLASS-METHODS date
      IMPORTING iv_year  TYPE csequence
                iv_month TYPE csequence
                iv_day   TYPE csequence
      RETURNING VALUE(ro_date) TYPE REF TO zrap_cl_xco_date.
    CLASS-METHODS time
      IMPORTING iv_hour   TYPE csequence
                iv_minute TYPE csequence
                iv_second TYPE csequence
      RETURNING VALUE(ro_time) TYPE REF TO zrap_cl_xco_time.
    CLASS-METHODS moment
      IMPORTING iv_year   TYPE csequence
                iv_month  TYPE csequence
                iv_day    TYPE csequence
                iv_hour   TYPE csequence
                iv_minute TYPE csequence
                iv_second TYPE csequence
      RETURNING VALUE(ro_moment) TYPE REF TO zrap_cl_xco_moment.
ENDCLASS.

CLASS xco_cp_time IMPLEMENTATION.
  METHOD class_constructor.
    format = NEW zrap_cl_xco_time_formats( ).
    time_zone = NEW zrap_cl_xco_time_zones( ).
  ENDMETHOD.

  METHOD date.
    DATA year TYPE n LENGTH 4.
    DATA month TYPE n LENGTH 2.
    DATA day TYPE n LENGTH 2.
    DATA value TYPE d.
    year = iv_year.
    month = iv_month.
    day = iv_day.
    value = |{ year }{ month }{ day }|.
    ro_date = NEW zrap_cl_xco_date( value ).
  ENDMETHOD.

  METHOD time.
    DATA hour TYPE n LENGTH 2.
    DATA minute TYPE n LENGTH 2.
    DATA second TYPE n LENGTH 2.
    DATA value TYPE t.
    hour = iv_hour.
    minute = iv_minute.
    second = iv_second.
    value = |{ hour }{ minute }{ second }|.
    ro_time = NEW zrap_cl_xco_time( value ).
  ENDMETHOD.

  METHOD moment.
    DATA year TYPE n LENGTH 4.
    DATA month TYPE n LENGTH 2.
    DATA day TYPE n LENGTH 2.
    DATA hour TYPE n LENGTH 2.
    DATA minute TYPE n LENGTH 2.
    DATA second TYPE n LENGTH 2.
    DATA digits TYPE n LENGTH 14.
    DATA value TYPE timestamp.
    year = iv_year.
    month = iv_month.
    day = iv_day.
    hour = iv_hour.
    minute = iv_minute.
    second = iv_second.
    digits = |{ year }{ month }{ day }{ hour }{ minute }{ second }|.
    value = digits.
    ro_moment = NEW zrap_cl_xco_moment( value ).
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_USER = `CLASS zrap_cl_xco_user DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA name TYPE syuname READ-ONLY.
    METHODS constructor IMPORTING name TYPE syuname.
ENDCLASS.

CLASS zrap_cl_xco_user IMPLEMENTATION.
  METHOD constructor.
    me->name = name.
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_LANGUAGE = `CLASS zrap_cl_xco_language DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    DATA value TYPE spras READ-ONLY.
    METHODS constructor IMPORTING value TYPE spras.
ENDCLASS.

CLASS zrap_cl_xco_language IMPLEMENTATION.
  METHOD constructor.
    me->value = value.
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_XCO_SY = `CLASS zrap_cl_xco_sy DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS user RETURNING VALUE(ro_user) TYPE REF TO zrap_cl_xco_user.
    METHODS language RETURNING VALUE(ro_language) TYPE REF TO zrap_cl_xco_language.
    METHODS date
      IMPORTING io_time_zone TYPE REF TO zrap_cl_xco_time_zone OPTIONAL
      RETURNING VALUE(ro_date) TYPE REF TO zrap_cl_xco_date.
    METHODS time
      IMPORTING io_time_zone TYPE REF TO zrap_cl_xco_time_zone OPTIONAL
      RETURNING VALUE(ro_time) TYPE REF TO zrap_cl_xco_time.
    METHODS moment
      IMPORTING io_time_zone TYPE REF TO zrap_cl_xco_time_zone OPTIONAL
      RETURNING VALUE(ro_moment) TYPE REF TO zrap_cl_xco_moment.
    METHODS unix_timestamp RETURNING VALUE(ro_unix_timestamp) TYPE REF TO zrap_cl_xco_unix_timestamp.
ENDCLASS.

CLASS zrap_cl_xco_sy IMPLEMENTATION.
  METHOD user.
    ro_user = NEW zrap_cl_xco_user( sy-uname ).
  ENDMETHOD.

  METHOD language.
    ro_language = NEW zrap_cl_xco_language( sy-langu ).
  ENDMETHOD.

  METHOD date.
    ro_date = moment( )->date( ).
  ENDMETHOD.

  METHOD time.
    ro_time = moment( )->time( ).
  ENDMETHOD.

  METHOD moment.
    DATA now TYPE timestamp.
    GET TIME STAMP FIELD now.
    ro_moment = NEW zrap_cl_xco_moment( now ).
  ENDMETHOD.

  METHOD unix_timestamp.
    ro_unix_timestamp = moment( )->get_unix_timestamp( ).
  ENDMETHOD.
ENDCLASS.
`;

const XCO_CP = `CLASS xco_cp DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-DATA sy TYPE REF TO zrap_cl_xco_sy READ-ONLY.
    CLASS-METHODS class_constructor.
    CLASS-METHODS string
      IMPORTING iv_string TYPE csequence
      RETURNING VALUE(ro_string) TYPE REF TO zrap_cl_xco_string.
    CLASS-METHODS strings
      IMPORTING it_strings TYPE string_table
      RETURNING VALUE(ro_strings) TYPE REF TO zrap_cl_xco_strings.
    CLASS-METHODS xstring
      IMPORTING iv_xstring TYPE xsequence
      RETURNING VALUE(ro_xstring) TYPE REF TO zrap_cl_xco_xstring.
ENDCLASS.

CLASS xco_cp IMPLEMENTATION.
  METHOD class_constructor.
    sy = NEW zrap_cl_xco_sy( ).
  ENDMETHOD.

  METHOD string.
    ro_string = NEW zrap_cl_xco_string( |{ iv_string }| ).
  ENDMETHOD.

  METHOD strings.
    ro_strings = NEW zrap_cl_xco_strings( it_strings ).
  ENDMETHOD.

  METHOD xstring.
    DATA bytes TYPE xstring.
    bytes = iv_xstring.
    ro_xstring = NEW zrap_cl_xco_xstring( bytes ).
  ENDMETHOD.
ENDCLASS.
`;

// ------------------------------------------------------------------------------ time stamps

const CL_ABAP_TSTMP = `CLASS cl_abap_tstmp DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS add
      IMPORTING tstmp       TYPE p
                secs        TYPE numeric
      RETURNING VALUE(time) TYPE timestampl.
    CLASS-METHODS subtractsecs
      IMPORTING tstmp       TYPE p
                secs        TYPE numeric
      RETURNING VALUE(time) TYPE timestampl.
    CLASS-METHODS subtract
      IMPORTING tstmp1        TYPE p
                tstmp2        TYPE p
      RETURNING VALUE(r_secs) TYPE tzntstmpl.
    CLASS-METHODS compare
      IMPORTING tstmp1      TYPE p
                tstmp2      TYPE p
      RETURNING VALUE(comp) TYPE i.
    CLASS-METHODS move
      IMPORTING tstmp_src TYPE p
      EXPORTING tstmp_tgt TYPE p.
    CLASS-METHODS move_to_short
      IMPORTING tstmp_src        TYPE timestampl
      RETURNING VALUE(tstmp_out) TYPE timestamp.
    CLASS-METHODS normalize
      IMPORTING tstmp_in         TYPE p
      RETURNING VALUE(tstmp_out) TYPE timestampl.
    CLASS-METHODS tstmp2utclong
      IMPORTING timestamp      TYPE p
      RETURNING VALUE(utclong) TYPE utclong.
    CLASS-METHODS utclong2tstmp
      IMPORTING utclong          TYPE utclong
      RETURNING VALUE(timestamp) TYPE timestampl.
    CLASS-METHODS utclong2tstmp_short
      IMPORTING utclong          TYPE utclong
      RETURNING VALUE(timestamp) TYPE timestamp.
    CLASS-METHODS systemtstmp_syst2utc
      IMPORTING syst_date        TYPE d
                syst_time        TYPE t
      EXPORTING utc_tstmp        TYPE timestamp.
    CLASS-METHODS systemtstmp_utc2syst
      IMPORTING utc_tstmp        TYPE timestamp
      EXPORTING syst_date        TYPE d
                syst_time        TYPE t.
    CLASS-METHODS td_add
      IMPORTING date     TYPE d
                time     TYPE t
                secs     TYPE numeric
      EXPORTING res_date TYPE d
                res_time TYPE t.
    CLASS-METHODS td_subtract
      IMPORTING date1    TYPE d
                time1    TYPE t
                date2    TYPE d
                time2    TYPE t
      EXPORTING res_secs TYPE numeric.
ENDCLASS.

CLASS cl_abap_tstmp IMPLEMENTATION.
  METHOD add.
    DATA seconds TYPE decfloat34.
    seconds = secs.
    time = zrap_eml=>tstmp_add( tstmp = |{ tstmp }| seconds = |{ seconds }| ).
  ENDMETHOD.

  METHOD subtractsecs.
    DATA seconds TYPE decfloat34.
    seconds = 0 - secs.
    time = zrap_eml=>tstmp_add( tstmp = |{ tstmp }| seconds = |{ seconds }| ).
  ENDMETHOD.

  METHOD subtract.
    r_secs = zrap_eml=>tstmp_diff( tstmp1 = |{ tstmp1 }| tstmp2 = |{ tstmp2 }| ).
  ENDMETHOD.

  METHOD compare.
    DATA diff TYPE timestampl.
    diff = zrap_eml=>tstmp_diff( tstmp1 = |{ tstmp1 }| tstmp2 = |{ tstmp2 }| ).
    IF diff > 0.
      comp = 1.
    ELSEIF diff < 0.
      comp = -1.
    ELSE.
      comp = 0.
    ENDIF.
  ENDMETHOD.

  METHOD move.
    tstmp_tgt = tstmp_src.
  ENDMETHOD.

  METHOD move_to_short.
    tstmp_out = trunc( tstmp_src ).
  ENDMETHOD.

  METHOD normalize.
    tstmp_out = zrap_eml=>tstmp_add( tstmp = |{ tstmp_in }| seconds = \`0\` ).
  ENDMETHOD.

  METHOD tstmp2utclong.
    utclong = zrap_eml=>tstmp_to_utclong( |{ timestamp }| ).
  ENDMETHOD.

  METHOD utclong2tstmp.
    timestamp = zrap_eml=>utclong_to_tstmp( utclong ).
  ENDMETHOD.

  METHOD utclong2tstmp_short.
    timestamp = trunc( zrap_eml=>utclong_to_tstmp( utclong ) ).
  ENDMETHOD.

  METHOD systemtstmp_syst2utc.
    utc_tstmp = |{ syst_date }{ syst_time }|.
  ENDMETHOD.

  METHOD systemtstmp_utc2syst.
    DATA digits TYPE n LENGTH 14.
    digits = utc_tstmp.
    syst_date = digits(8).
    syst_time = digits+8(6).
  ENDMETHOD.

  METHOD td_add.
    DATA start TYPE timestamp.
    DATA result TYPE timestamp.
    DATA digits TYPE n LENGTH 14.
    DATA seconds TYPE decfloat34.
    start = |{ date }{ time }|.
    seconds = secs.
    result = trunc( zrap_eml=>tstmp_add( tstmp = |{ start }| seconds = |{ seconds }| ) ).
    digits = result.
    res_date = digits(8).
    res_time = digits+8(6).
  ENDMETHOD.

  METHOD td_subtract.
    DATA first TYPE timestamp.
    DATA second TYPE timestamp.
    first = |{ date1 }{ time1 }|.
    second = |{ date2 }{ time2 }|.
    res_secs = zrap_eml=>tstmp_diff( tstmp1 = |{ first }| tstmp2 = |{ second }| ).
  ENDMETHOD.
ENDCLASS.
`;

const CL_ABAP_UTCLONG = `CLASS cl_abap_utclong DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS diff
      IMPORTING high    TYPE utclong
                low     TYPE utclong
      EXPORTING days    TYPE i
                hours   TYPE i
                minutes TYPE i
                seconds TYPE decfloat34.
    CLASS-METHODS read
      IMPORTING string   TYPE csequence
                timezone TYPE csequence OPTIONAL
      EXPORTING value    TYPE utclong
      RAISING   cx_abap_utclong_invalid.
ENDCLASS.

CLASS cl_abap_utclong IMPLEMENTATION.
  METHOD diff.
    DATA total TYPE decfloat34.
    DATA rest TYPE decfloat34.
    DATA sign TYPE i VALUE 1.
    total = utclong_diff( high = high low = low ).
    IF total < 0.
      sign = -1.
      total = 0 - total.
    ENDIF.
    days = trunc( total / 86400 ).
    rest = total - days * 86400.
    hours = trunc( rest / 3600 ).
    rest = rest - hours * 3600.
    minutes = trunc( rest / 60 ).
    seconds = rest - minutes * 60.
    days = days * sign.
    hours = hours * sign.
    minutes = minutes * sign.
    seconds = seconds * sign.
  ENDMETHOD.

  METHOD read.
    value = zrap_eml=>utclong_read( |{ string }| ).
  ENDMETHOD.
ENDCLASS.
`;

// ------------------------------------------------------------------------------ number ranges

const CL_NUMBERRANGE_RUNTIME = `CLASS cl_numberrange_runtime DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    TYPES nr_number TYPE n LENGTH 20.
    TYPES nr_interval TYPE c LENGTH 2.
    TYPES nr_object TYPE c LENGTH 10.
    TYPES nr_subobject TYPE c LENGTH 20.
    TYPES nr_toyear TYPE n LENGTH 4.
    TYPES nr_returncode TYPE c LENGTH 1.
    TYPES nr_quantity TYPE i.
    CLASS-METHODS number_get
      IMPORTING nr_range_nr       TYPE nr_interval
                object            TYPE nr_object
                quantity          TYPE nr_quantity DEFAULT 1
                subobject         TYPE nr_subobject OPTIONAL
                toyear            TYPE nr_toyear OPTIONAL
                ignore_buffer     TYPE abap_bool OPTIONAL
      EXPORTING number            TYPE nr_number
                returncode        TYPE nr_returncode
                returned_quantity TYPE nr_quantity
      RAISING   cx_nr_object_not_found
                cx_number_ranges.
    CLASS-METHODS number_check
      IMPORTING nr_range_nr TYPE nr_interval
                object      TYPE nr_object
                number      TYPE nr_number
                subobject   TYPE nr_subobject OPTIONAL
                toyear      TYPE nr_toyear OPTIONAL
      EXPORTING returncode  TYPE nr_returncode
      RAISING   cx_nr_object_not_found
                cx_number_ranges.
ENDCLASS.

CLASS cl_numberrange_runtime IMPLEMENTATION.
  METHOD number_get.
    DATA text TYPE string.
    zrap_eml=>number_get( EXPORTING object     = |{ object }|
                                    subobject  = |{ subobject }|
                                    interval   = |{ nr_range_nr }|
                                    toyear     = |{ toyear }|
                                    quantity   = quantity
                          IMPORTING number     = text
                                    returncode = returncode
                                    returned   = returned_quantity ).
    number = text.
  ENDMETHOD.

  METHOD number_check.
    zrap_eml=>number_check( EXPORTING object     = |{ object }|
                                      subobject  = |{ subobject }|
                                      interval   = |{ nr_range_nr }|
                                      toyear     = |{ toyear }|
                                      number     = |{ number }|
                            IMPORTING returncode = returncode ).
  ENDMETHOD.
ENDCLASS.
`;

// ------------------------------------------------------------------------------ application log

const IF_BALI_CONSTANTS = `INTERFACE if_bali_constants PUBLIC.
  TYPES ty_severity TYPE c LENGTH 1.
  TYPES ty_category TYPE c LENGTH 1.
  CONSTANTS c_severity_error TYPE ty_severity VALUE 'E'.
  CONSTANTS c_severity_warning TYPE ty_severity VALUE 'W'.
  CONSTANTS c_severity_information TYPE ty_severity VALUE 'I'.
  CONSTANTS c_severity_status TYPE ty_severity VALUE 'S'.
  CONSTANTS c_severity_abort TYPE ty_severity VALUE 'A'.
  CONSTANTS c_severity_exit TYPE ty_severity VALUE 'X'.
  CONSTANTS c_category_message TYPE ty_category VALUE 'M'.
  CONSTANTS c_category_free_text TYPE ty_category VALUE 'F'.
  CONSTANTS c_category_exception TYPE ty_category VALUE 'X'.
ENDINTERFACE.
`;

const IF_BALI_ITEM_GETTER = `INTERFACE if_bali_item_getter PUBLIC.
  DATA severity TYPE if_bali_constants=>ty_severity READ-ONLY.
  DATA category TYPE if_bali_constants=>ty_category READ-ONLY.
  DATA timestamp TYPE timestampl READ-ONLY.
  DATA message_id TYPE symsgid READ-ONLY.
  DATA message_number TYPE symsgno READ-ONLY.
  DATA variable_1 TYPE symsgv READ-ONLY.
  DATA variable_2 TYPE symsgv READ-ONLY.
  DATA variable_3 TYPE symsgv READ-ONLY.
  DATA variable_4 TYPE symsgv READ-ONLY.
  METHODS get_message_text RETURNING VALUE(message_text) TYPE string.
ENDINTERFACE.
`;

const IF_BALI_ITEM_SETTER = `INTERFACE if_bali_item_setter PUBLIC.
  INTERFACES if_bali_item_getter.
ENDINTERFACE.
`;

const ZRAP_CL_BALI_ITEM = `CLASS zrap_cl_bali_item DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_bali_item_setter.
    METHODS constructor
      IMPORTING severity  TYPE if_bali_constants=>ty_severity
                category  TYPE if_bali_constants=>ty_category
                text      TYPE string OPTIONAL
                id        TYPE symsgid OPTIONAL
                number    TYPE symsgno OPTIONAL
                v1        TYPE symsgv OPTIONAL
                v2        TYPE symsgv OPTIONAL
                v3        TYPE symsgv OPTIONAL
                v4        TYPE symsgv OPTIONAL
                timestamp TYPE timestampl OPTIONAL.
    DATA text TYPE string READ-ONLY.
ENDCLASS.

CLASS zrap_cl_bali_item IMPLEMENTATION.
  METHOD constructor.
    if_bali_item_getter~severity = severity.
    if_bali_item_getter~category = category.
    if_bali_item_getter~message_id = id.
    if_bali_item_getter~message_number = number.
    if_bali_item_getter~variable_1 = v1.
    if_bali_item_getter~variable_2 = v2.
    if_bali_item_getter~variable_3 = v3.
    if_bali_item_getter~variable_4 = v4.
    if_bali_item_getter~timestamp = timestamp.
    IF timestamp IS INITIAL.
      GET TIME STAMP FIELD if_bali_item_getter~timestamp.
    ENDIF.
    me->text = text.
  ENDMETHOD.

  METHOD if_bali_item_getter~get_message_text.
    IF text IS NOT INITIAL OR if_bali_item_getter~message_id IS INITIAL.
      message_text = text.
      RETURN.
    ENDIF.
    message_text = zrap_eml=>message_text( id     = |{ if_bali_item_getter~message_id }|
                                            number = |{ if_bali_item_getter~message_number }|
                                            v1     = |{ if_bali_item_getter~variable_1 }|
                                            v2     = |{ if_bali_item_getter~variable_2 }|
                                            v3     = |{ if_bali_item_getter~variable_3 }|
                                            v4     = |{ if_bali_item_getter~variable_4 }| ).
  ENDMETHOD.
ENDCLASS.
`;

const CL_BALI_FREE_TEXT_SETTER = `CLASS cl_bali_free_text_setter DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS create
      IMPORTING severity        TYPE if_bali_constants=>ty_severity DEFAULT if_bali_constants=>c_severity_status
                text            TYPE csequence
      RETURNING VALUE(free_text) TYPE REF TO if_bali_item_setter.
ENDCLASS.

CLASS cl_bali_free_text_setter IMPLEMENTATION.
  METHOD create.
    free_text = NEW zrap_cl_bali_item( severity = severity category = if_bali_constants=>c_category_free_text text = |{ text }| ).
  ENDMETHOD.
ENDCLASS.
`;

const CL_BALI_MESSAGE_SETTER = `CLASS cl_bali_message_setter DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS create
      IMPORTING severity       TYPE if_bali_constants=>ty_severity DEFAULT if_bali_constants=>c_severity_status
                id             TYPE symsgid
                number         TYPE symsgno
                variable_1     TYPE simple OPTIONAL
                variable_2     TYPE simple OPTIONAL
                variable_3     TYPE simple OPTIONAL
                variable_4     TYPE simple OPTIONAL
      RETURNING VALUE(message) TYPE REF TO if_bali_item_setter.
    CLASS-METHODS create_from_sy
      RETURNING VALUE(message) TYPE REF TO if_bali_item_setter.
    CLASS-METHODS create_from_bapiret2
      IMPORTING message_data   TYPE any
      RETURNING VALUE(message) TYPE REF TO if_bali_item_setter.
ENDCLASS.

CLASS cl_bali_message_setter IMPLEMENTATION.
  METHOD create.
    message = NEW zrap_cl_bali_item( severity = severity
                                     category = if_bali_constants=>c_category_message
                                     id       = id
                                     number   = number
                                     v1       = |{ variable_1 }|
                                     v2       = |{ variable_2 }|
                                     v3       = |{ variable_3 }|
                                     v4       = |{ variable_4 }| ).
  ENDMETHOD.

  METHOD create_from_sy.
    message = NEW zrap_cl_bali_item( severity = sy-msgty
                                     category = if_bali_constants=>c_category_message
                                     id       = sy-msgid
                                     number   = sy-msgno
                                     v1       = sy-msgv1
                                     v2       = sy-msgv2
                                     v3       = sy-msgv3
                                     v4       = sy-msgv4 ).
  ENDMETHOD.

  METHOD create_from_bapiret2.
    FIELD-SYMBOLS <value> TYPE any.
    DATA severity TYPE if_bali_constants=>ty_severity.
    DATA id TYPE symsgid.
    DATA number TYPE symsgno.
    DATA v TYPE STANDARD TABLE OF symsgv WITH EMPTY KEY.
    ASSIGN COMPONENT \`TYPE\` OF STRUCTURE message_data TO <value>.
    IF sy-subrc = 0.
      severity = <value>.
    ENDIF.
    ASSIGN COMPONENT \`ID\` OF STRUCTURE message_data TO <value>.
    IF sy-subrc = 0.
      id = <value>.
    ENDIF.
    ASSIGN COMPONENT \`NUMBER\` OF STRUCTURE message_data TO <value>.
    IF sy-subrc = 0.
      number = <value>.
    ENDIF.
    DO 4 TIMES.
      ASSIGN COMPONENT |MESSAGE_V{ sy-index }| OF STRUCTURE message_data TO <value>.
      IF sy-subrc = 0.
        APPEND <value> TO v.
      ELSE.
        APPEND INITIAL LINE TO v.
      ENDIF.
    ENDDO.
    message = NEW zrap_cl_bali_item( severity = severity
                                     category = if_bali_constants=>c_category_message
                                     id       = id
                                     number   = number
                                     v1       = v[ 1 ]
                                     v2       = v[ 2 ]
                                     v3       = v[ 3 ]
                                     v4       = v[ 4 ] ).
  ENDMETHOD.
ENDCLASS.
`;

const CL_BALI_EXCEPTION_SETTER = `CLASS cl_bali_exception_setter DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS create
      IMPORTING severity         TYPE if_bali_constants=>ty_severity DEFAULT if_bali_constants=>c_severity_error
                exception        TYPE REF TO cx_root
      RETURNING VALUE(exception_item) TYPE REF TO if_bali_item_setter.
ENDCLASS.

CLASS cl_bali_exception_setter IMPLEMENTATION.
  METHOD create.
    exception_item = NEW zrap_cl_bali_item( severity = severity category = if_bali_constants=>c_category_exception text = exception->get_text( ) ).
  ENDMETHOD.
ENDCLASS.
`;

const IF_BALI_HEADER_GETTER = `INTERFACE if_bali_header_getter PUBLIC.
  TYPES ty_object TYPE c LENGTH 20.
  TYPES ty_subobject TYPE c LENGTH 20.
  TYPES ty_external_id TYPE c LENGTH 100.
  DATA object TYPE ty_object READ-ONLY.
  DATA subobject TYPE ty_subobject READ-ONLY.
  DATA external_id TYPE ty_external_id READ-ONLY.
  DATA expiry_date TYPE d READ-ONLY.
  DATA keep_until_expiry TYPE abap_bool READ-ONLY.
  DATA log_user TYPE syuname READ-ONLY.
  DATA log_timestamp TYPE timestampl READ-ONLY.
ENDINTERFACE.
`;

const IF_BALI_HEADER_SETTER = `INTERFACE if_bali_header_setter PUBLIC.
  INTERFACES if_bali_header_getter.
  METHODS set_expiry
    IMPORTING expiry_date       TYPE d
              keep_until_expiry TYPE abap_bool DEFAULT abap_false
    RETURNING VALUE(header)     TYPE REF TO if_bali_header_setter.
  METHODS set_descriptor
    IMPORTING object        TYPE if_bali_header_getter=>ty_object
              subobject     TYPE if_bali_header_getter=>ty_subobject OPTIONAL
              external_id   TYPE if_bali_header_getter=>ty_external_id OPTIONAL
    RETURNING VALUE(header) TYPE REF TO if_bali_header_setter.
ENDINTERFACE.
`;

const CL_BALI_HEADER_SETTER = `CLASS cl_bali_header_setter DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_bali_header_setter.
    TYPES ty_object TYPE if_bali_header_getter=>ty_object.
    TYPES ty_subobject TYPE if_bali_header_getter=>ty_subobject.
    TYPES ty_external_id TYPE if_bali_header_getter=>ty_external_id.
    CLASS-METHODS create
      IMPORTING object        TYPE ty_object
                subobject     TYPE ty_subobject OPTIONAL
                external_id   TYPE ty_external_id OPTIONAL
      RETURNING VALUE(header) TYPE REF TO if_bali_header_setter.
    METHODS zrap_set_creation
      IMPORTING log_user      TYPE syuname
                log_timestamp TYPE timestampl.
ENDCLASS.

CLASS cl_bali_header_setter IMPLEMENTATION.
  METHOD create.
    DATA setter TYPE REF TO cl_bali_header_setter.
    setter = NEW cl_bali_header_setter( ).
    setter->if_bali_header_setter~set_descriptor( object = object subobject = subobject external_id = external_id ).
    header = setter.
  ENDMETHOD.

  METHOD if_bali_header_setter~set_expiry.
    if_bali_header_getter~expiry_date = expiry_date.
    if_bali_header_getter~keep_until_expiry = keep_until_expiry.
    header = me.
  ENDMETHOD.

  METHOD if_bali_header_setter~set_descriptor.
    if_bali_header_getter~object = object.
    if_bali_header_getter~subobject = subobject.
    if_bali_header_getter~external_id = external_id.
    header = me.
  ENDMETHOD.

  METHOD zrap_set_creation.
    if_bali_header_getter~log_user = log_user.
    if_bali_header_getter~log_timestamp = log_timestamp.
  ENDMETHOD.
ENDCLASS.
`;

const IF_BALI_LOG = `INTERFACE if_bali_log PUBLIC.
  TYPES ty_handle TYPE c LENGTH 22.
  TYPES: BEGIN OF ty_item_entry,
           log_item_number TYPE i,
           item            TYPE REF TO if_bali_item_getter,
         END OF ty_item_entry.
  TYPES ty_item_table TYPE STANDARD TABLE OF ty_item_entry WITH EMPTY KEY.
  METHODS set_header
    IMPORTING header TYPE REF TO if_bali_header_setter
    RAISING   cx_bali_runtime.
  METHODS get_header
    RETURNING VALUE(header) TYPE REF TO if_bali_header_getter
    RAISING   cx_bali_runtime.
  METHODS add_item
    IMPORTING item TYPE REF TO if_bali_item_setter
    RAISING   cx_bali_runtime.
  METHODS add_all_items_from_other_log
    IMPORTING source_log TYPE REF TO if_bali_log
    RAISING   cx_bali_runtime.
  METHODS get_all_items
    RETURNING VALUE(item_table) TYPE ty_item_table
    RAISING   cx_bali_runtime.
  METHODS get_handle
    RETURNING VALUE(handle) TYPE ty_handle
    RAISING   cx_bali_runtime.
  METHODS release_memory.
ENDINTERFACE.
`;

const CL_BALI_LOG = `CLASS cl_bali_log DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_bali_log.
    CLASS-METHODS create
      RETURNING VALUE(log) TYPE REF TO if_bali_log
      RAISING   cx_bali_runtime.
    CLASS-METHODS create_with_header
      IMPORTING header     TYPE REF TO if_bali_header_setter
      RETURNING VALUE(log) TYPE REF TO if_bali_log
      RAISING   cx_bali_runtime.
    METHODS constructor
      IMPORTING handle TYPE if_bali_log=>ty_handle OPTIONAL.
    "! Items of the log, as the kernel saves them (zrap_eml=>bali_save).
    TYPES: BEGIN OF zrap_ty_item,
             severity  TYPE c LENGTH 1,
             category  TYPE c LENGTH 1,
             text      TYPE string,
             id        TYPE string,
             number    TYPE string,
             v1        TYPE string,
             v2        TYPE string,
             v3        TYPE string,
             v4        TYPE string,
             timestamp TYPE timestampl,
           END OF zrap_ty_item.
    TYPES zrap_tt_item TYPE STANDARD TABLE OF zrap_ty_item WITH EMPTY KEY.
    METHODS zrap_items RETURNING VALUE(result) TYPE zrap_tt_item.
    METHODS zrap_add
      IMPORTING item TYPE zrap_ty_item.
  PRIVATE SECTION.
    DATA handle TYPE if_bali_log=>ty_handle.
    DATA header TYPE REF TO if_bali_header_setter.
    DATA items TYPE if_bali_log=>ty_item_table.
ENDCLASS.

CLASS cl_bali_log IMPLEMENTATION.
  METHOD create.
    log = NEW cl_bali_log( ).
  ENDMETHOD.

  METHOD create_with_header.
    log = NEW cl_bali_log( ).
    log->set_header( header ).
  ENDMETHOD.

  METHOD constructor.
    DATA uuid TYPE sysuuid_c32.
    IF handle IS INITIAL.
      uuid = cl_system_uuid=>create_uuid_c32_static( ).
      me->handle = uuid(22).
    ELSE.
      me->handle = handle.
    ENDIF.
  ENDMETHOD.

  METHOD if_bali_log~set_header.
    me->header = header.
  ENDMETHOD.

  METHOD if_bali_log~get_header.
    IF me->header IS INITIAL.
      RAISE EXCEPTION NEW cx_bali_not_possible( zrap_text = \`the log has no header\` ).
    ENDIF.
    header = me->header.
  ENDMETHOD.

  METHOD if_bali_log~add_item.
    APPEND VALUE #( log_item_number = lines( items ) + 1 item = item ) TO items.
  ENDMETHOD.

  METHOD if_bali_log~add_all_items_from_other_log.
    DATA entry TYPE if_bali_log=>ty_item_entry.
    LOOP AT source_log->get_all_items( ) INTO entry.
      APPEND VALUE #( log_item_number = lines( items ) + 1 item = entry-item ) TO items.
    ENDLOOP.
  ENDMETHOD.

  METHOD if_bali_log~get_all_items.
    item_table = items.
  ENDMETHOD.

  METHOD if_bali_log~get_handle.
    handle = me->handle.
  ENDMETHOD.

  METHOD if_bali_log~release_memory.
    CLEAR items.
  ENDMETHOD.

  METHOD zrap_items.
    DATA entry TYPE if_bali_log=>ty_item_entry.
    DATA item TYPE zrap_ty_item.
    DATA text TYPE string.
    LOOP AT me->items INTO entry.
      CLEAR item.
      item-severity = entry-item->severity.
      item-category = entry-item->category.
      item-timestamp = entry-item->timestamp.
      item-id = entry-item->message_id.
      item-number = entry-item->message_number.
      item-v1 = entry-item->variable_1.
      item-v2 = entry-item->variable_2.
      item-v3 = entry-item->variable_3.
      item-v4 = entry-item->variable_4.
      item-text = entry-item->get_message_text( ).
      APPEND item TO result.
    ENDLOOP.
  ENDMETHOD.

  METHOD zrap_add.
    DATA id TYPE symsgid.
    DATA number TYPE symsgno.
    id = item-id.
    number = item-number.
    APPEND VALUE #( log_item_number = lines( items ) + 1
                    item = NEW zrap_cl_bali_item( severity  = item-severity
                                                  category  = item-category
                                                  text      = item-text
                                                  id        = id
                                                  number    = number
                                                  v1        = |{ item-v1 }|
                                                  v2        = |{ item-v2 }|
                                                  v3        = |{ item-v3 }|
                                                  v4        = |{ item-v4 }|
                                                  timestamp = item-timestamp ) ) TO me->items.
  ENDMETHOD.
ENDCLASS.
`;

const IF_BALI_LOG_FILTER = `INTERFACE if_bali_log_filter PUBLIC.
  METHODS set_descriptor
    IMPORTING object        TYPE if_bali_header_getter=>ty_object OPTIONAL
              subobject     TYPE if_bali_header_getter=>ty_subobject OPTIONAL
              external_id   TYPE if_bali_header_getter=>ty_external_id OPTIONAL
    RETURNING VALUE(filter) TYPE REF TO if_bali_log_filter.
  METHODS set_create_info
    IMPORTING user          TYPE syuname OPTIONAL
    RETURNING VALUE(filter) TYPE REF TO if_bali_log_filter.
  METHODS set_time_interval
    IMPORTING start_time    TYPE utclong OPTIONAL
              end_time      TYPE utclong OPTIONAL
    RETURNING VALUE(filter) TYPE REF TO if_bali_log_filter.
  METHODS set_maximum_log_number
    IMPORTING max_log_number TYPE i
    RETURNING VALUE(filter)  TYPE REF TO if_bali_log_filter.
  DATA object TYPE if_bali_header_getter=>ty_object READ-ONLY.
  DATA subobject TYPE if_bali_header_getter=>ty_subobject READ-ONLY.
  DATA external_id TYPE if_bali_header_getter=>ty_external_id READ-ONLY.
  DATA user TYPE syuname READ-ONLY.
  DATA start_time TYPE utclong READ-ONLY.
  DATA end_time TYPE utclong READ-ONLY.
  DATA max_log_number TYPE i READ-ONLY.
ENDINTERFACE.
`;

const CL_BALI_LOG_FILTER = `CLASS cl_bali_log_filter DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_bali_log_filter.
    CLASS-METHODS create RETURNING VALUE(filter) TYPE REF TO if_bali_log_filter.
ENDCLASS.

CLASS cl_bali_log_filter IMPLEMENTATION.
  METHOD create.
    filter = NEW cl_bali_log_filter( ).
  ENDMETHOD.

  METHOD if_bali_log_filter~set_descriptor.
    if_bali_log_filter~object = object.
    if_bali_log_filter~subobject = subobject.
    if_bali_log_filter~external_id = external_id.
    filter = me.
  ENDMETHOD.

  METHOD if_bali_log_filter~set_create_info.
    if_bali_log_filter~user = user.
    filter = me.
  ENDMETHOD.

  METHOD if_bali_log_filter~set_time_interval.
    if_bali_log_filter~start_time = start_time.
    if_bali_log_filter~end_time = end_time.
    filter = me.
  ENDMETHOD.

  METHOD if_bali_log_filter~set_maximum_log_number.
    if_bali_log_filter~max_log_number = max_log_number.
    filter = me.
  ENDMETHOD.
ENDCLASS.
`;

const IF_BALI_LOG_DB = `INTERFACE if_bali_log_db PUBLIC.
  TYPES ty_log_table TYPE STANDARD TABLE OF REF TO if_bali_log WITH EMPTY KEY.
  METHODS save_log
    IMPORTING log                        TYPE REF TO if_bali_log
              use_2nd_db_connection      TYPE abap_bool DEFAULT abap_false
              assign_to_current_appl_job TYPE abap_bool DEFAULT abap_false
    RAISING   cx_bali_runtime.
  METHODS load_log
    IMPORTING handle         TYPE if_bali_log=>ty_handle
              read_only_flag TYPE abap_bool DEFAULT abap_true
    RETURNING VALUE(log)     TYPE REF TO if_bali_log
    RAISING   cx_bali_runtime.
  METHODS load_logs_via_filter
    IMPORTING filter         TYPE REF TO if_bali_log_filter
    RETURNING VALUE(log_table) TYPE ty_log_table
    RAISING   cx_bali_runtime.
  METHODS load_logs_w_items_via_filter
    IMPORTING filter         TYPE REF TO if_bali_log_filter
    RETURNING VALUE(log_table) TYPE ty_log_table
    RAISING   cx_bali_runtime.
  METHODS delete_log
    IMPORTING log TYPE REF TO if_bali_log
    RAISING   cx_bali_runtime.
ENDINTERFACE.
`;

const CL_BALI_LOG_DB = `CLASS cl_bali_log_db DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    INTERFACES if_bali_log_db.
    CLASS-METHODS get_instance
      RETURNING VALUE(log_db) TYPE REF TO if_bali_log_db
      RAISING   cx_bali_runtime.
  PRIVATE SECTION.
    CLASS-DATA instance TYPE REF TO cl_bali_log_db.
    METHODS load
      IMPORTING filter           TYPE REF TO if_bali_log_filter OPTIONAL
                handle           TYPE if_bali_log=>ty_handle OPTIONAL
      RETURNING VALUE(log_table) TYPE if_bali_log_db=>ty_log_table.
ENDCLASS.

CLASS cl_bali_log_db IMPLEMENTATION.
  METHOD get_instance.
    IF instance IS INITIAL.
      instance = NEW cl_bali_log_db( ).
    ENDIF.
    log_db = instance.
  ENDMETHOD.

  METHOD if_bali_log_db~save_log.
    DATA header TYPE REF TO if_bali_header_getter.
    DATA impl TYPE REF TO cl_bali_log.
    TRY.
        header = log->get_header( ).
      CATCH cx_bali_runtime.
        RAISE EXCEPTION NEW cx_bali_not_possible( zrap_text = \`the log has no header: set_header before save_log\` ).
    ENDTRY.
    impl ?= log.
    zrap_eml=>bali_save( handle      = |{ log->get_handle( ) }|
                         object      = |{ header->object }|
                         subobject   = |{ header->subobject }|
                         external_id = |{ header->external_id }|
                         expiry_date = header->expiry_date
                         items       = impl->zrap_items( ) ).
  ENDMETHOD.

  METHOD if_bali_log_db~load_log.
    DATA logs TYPE if_bali_log_db=>ty_log_table.
    logs = load( handle = handle ).
    IF lines( logs ) = 0.
      RAISE EXCEPTION NEW cx_bali_not_possible( zrap_text = |no application log { handle }| ).
    ENDIF.
    log = logs[ 1 ].
  ENDMETHOD.

  METHOD if_bali_log_db~load_logs_via_filter.
    log_table = load( filter = filter ).
  ENDMETHOD.

  METHOD if_bali_log_db~load_logs_w_items_via_filter.
    log_table = load( filter = filter ).
  ENDMETHOD.

  METHOD if_bali_log_db~delete_log.
    zrap_eml=>bali_delete( |{ log->get_handle( ) }| ).
  ENDMETHOD.

  METHOD load.
    TYPES: BEGIN OF ty_log,
             handle        TYPE string,
             object        TYPE string,
             subobject     TYPE string,
             external_id   TYPE string,
             expiry_date   TYPE d,
             log_user      TYPE string,
             log_timestamp TYPE timestampl,
           END OF ty_log.
    DATA logs TYPE STANDARD TABLE OF ty_log WITH EMPTY KEY.
    DATA items TYPE cl_bali_log=>zrap_tt_item.
    DATA entry TYPE ty_log.
    DATA item TYPE cl_bali_log=>zrap_ty_item.
    DATA log TYPE REF TO cl_bali_log.
    DATA header TYPE REF TO cl_bali_header_setter.
    DATA log_handle TYPE if_bali_log=>ty_handle.
    DATA user TYPE syuname.
    IF filter IS BOUND.
      zrap_eml=>bali_query( EXPORTING object      = |{ filter->object }|
                                      subobject   = |{ filter->subobject }|
                                      external_id = |{ filter->external_id }|
                                      user        = |{ filter->user }|
                                      start_time  = filter->start_time
                                      end_time    = filter->end_time
                                      max_count   = filter->max_log_number
                            CHANGING  logs        = logs ).
    ELSE.
      zrap_eml=>bali_query( EXPORTING handle = |{ handle }| CHANGING logs = logs ).
    ENDIF.
    LOOP AT logs INTO entry.
      log_handle = entry-handle.
      log = NEW cl_bali_log( log_handle ).
      header = NEW cl_bali_header_setter( ).
      header->if_bali_header_setter~set_descriptor( object      = |{ entry-object }|
                                                    subobject   = |{ entry-subobject }|
                                                    external_id = |{ entry-external_id }| ).
      IF entry-expiry_date IS NOT INITIAL.
        header->if_bali_header_setter~set_expiry( entry-expiry_date ).
      ENDIF.
      user = entry-log_user.
      header->zrap_set_creation( log_user = user log_timestamp = entry-log_timestamp ).
      log->if_bali_log~set_header( header ).
      CLEAR items.
      zrap_eml=>bali_items( EXPORTING handle = entry-handle CHANGING items = items ).
      LOOP AT items INTO item.
        log->zrap_add( item ).
      ENDLOOP.
      APPEND log TO log_table.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
`;

// ------------------------------------------------------------------------------ hashes

const CL_ABAP_MESSAGE_DIGEST = `CLASS cl_abap_message_digest DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS calculate_hash_for_char
      IMPORTING if_algorithm     TYPE string DEFAULT \`SHA1\`
                if_data          TYPE csequence
                if_length        TYPE i DEFAULT 0
                if_offset        TYPE i DEFAULT 0
      EXPORTING ef_hashstring    TYPE string
                ef_hashxstring   TYPE xstring
                ef_hashb64string TYPE string
      RAISING   cx_abap_message_digest.
    CLASS-METHODS calculate_hash_for_raw
      IMPORTING if_algorithm     TYPE string DEFAULT \`SHA1\`
                if_data          TYPE xsequence
                if_length        TYPE i DEFAULT 0
                if_offset        TYPE i DEFAULT 0
      EXPORTING ef_hashstring    TYPE string
                ef_hashxstring   TYPE xstring
                ef_hashb64string TYPE string
      RAISING   cx_abap_message_digest.
    CLASS-METHODS string_to_xstring
      IMPORTING if_input         TYPE csequence
      RETURNING VALUE(er_output) TYPE xstring
      RAISING   cx_abap_message_digest.
ENDCLASS.

CLASS cl_abap_message_digest IMPLEMENTATION.
  METHOD calculate_hash_for_char.
    DATA text TYPE string.
    text = if_data.
    IF if_offset > 0 OR if_length > 0.
      IF if_length > 0.
        text = substring( val = text off = if_offset len = if_length ).
      ELSE.
        text = substring( val = text off = if_offset ).
      ENDIF.
    ENDIF.
    ef_hashxstring = zrap_eml=>digest( algorithm = if_algorithm data = zrap_eml=>codepage_out( codepage = \`UTF-8\` source = text ) ).
    ef_hashstring = ef_hashxstring.
    ef_hashb64string = zrap_eml=>base64_encode_x( ef_hashxstring ).
  ENDMETHOD.

  METHOD calculate_hash_for_raw.
    DATA bytes TYPE xstring.
    bytes = if_data.
    IF if_offset > 0 OR if_length > 0.
      IF if_length > 0.
        bytes = bytes+if_offset(if_length).
      ELSE.
        bytes = bytes+if_offset.
      ENDIF.
    ENDIF.
    ef_hashxstring = zrap_eml=>digest( algorithm = if_algorithm data = bytes ).
    ef_hashstring = ef_hashxstring.
    ef_hashb64string = zrap_eml=>base64_encode_x( ef_hashxstring ).
  ENDMETHOD.

  METHOD string_to_xstring.
    er_output = zrap_eml=>codepage_out( codepage = \`UTF-8\` source = |{ if_input }| ).
  ENDMETHOD.
ENDCLASS.
`;

const CL_ABAP_HMAC = `CLASS cl_abap_hmac DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS calculate_hmac_for_char
      IMPORTING if_algorithm     TYPE string DEFAULT \`SHA1\`
                if_key           TYPE xstring
                if_data          TYPE csequence
                if_length        TYPE i DEFAULT 0
                if_offset        TYPE i DEFAULT 0
      EXPORTING ef_hmacstring    TYPE string
                ef_hmacxstring   TYPE xstring
                ef_hmacb64string TYPE string
      RAISING   cx_abap_message_digest.
    CLASS-METHODS calculate_hmac_for_raw
      IMPORTING if_algorithm     TYPE string DEFAULT \`SHA1\`
                if_key           TYPE xstring
                if_data          TYPE xsequence
                if_length        TYPE i DEFAULT 0
                if_offset        TYPE i DEFAULT 0
      EXPORTING ef_hmacstring    TYPE string
                ef_hmacxstring   TYPE xstring
                ef_hmacb64string TYPE string
      RAISING   cx_abap_message_digest.
    CLASS-METHODS string_to_xstring
      IMPORTING if_input         TYPE csequence
      RETURNING VALUE(er_output) TYPE xstring
      RAISING   cx_abap_message_digest.
ENDCLASS.

CLASS cl_abap_hmac IMPLEMENTATION.
  METHOD calculate_hmac_for_char.
    DATA text TYPE string.
    text = if_data.
    IF if_offset > 0 OR if_length > 0.
      IF if_length > 0.
        text = substring( val = text off = if_offset len = if_length ).
      ELSE.
        text = substring( val = text off = if_offset ).
      ENDIF.
    ENDIF.
    ef_hmacxstring = zrap_eml=>digest( algorithm = if_algorithm key = if_key data = zrap_eml=>codepage_out( codepage = \`UTF-8\` source = text ) ).
    ef_hmacstring = ef_hmacxstring.
    ef_hmacb64string = zrap_eml=>base64_encode_x( ef_hmacxstring ).
  ENDMETHOD.

  METHOD calculate_hmac_for_raw.
    DATA bytes TYPE xstring.
    bytes = if_data.
    IF if_offset > 0 OR if_length > 0.
      IF if_length > 0.
        bytes = bytes+if_offset(if_length).
      ELSE.
        bytes = bytes+if_offset.
      ENDIF.
    ENDIF.
    ef_hmacxstring = zrap_eml=>digest( algorithm = if_algorithm key = if_key data = bytes ).
    ef_hmacstring = ef_hmacxstring.
    ef_hmacb64string = zrap_eml=>base64_encode_x( ef_hmacxstring ).
  ENDMETHOD.

  METHOD string_to_xstring.
    er_output = zrap_eml=>codepage_out( codepage = \`UTF-8\` source = |{ if_input }| ).
  ENDMETHOD.
ENDCLASS.
`;

// ------------------------------------------------------------------------------ random numbers

/** A Park-Miller generator (multiplier 48271, modulus 2^31 - 1), seeded by the kernel. */
const CL_ABAP_RANDOM = `CLASS cl_abap_random DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS seed RETURNING VALUE(seed) TYPE i.
    CLASS-METHODS create
      IMPORTING seed          TYPE i OPTIONAL
      RETURNING VALUE(prng)   TYPE REF TO cl_abap_random.
    METHODS constructor IMPORTING seed TYPE i OPTIONAL.
    "! An integer in [0, 2^31 - 2].
    METHODS int RETURNING VALUE(value) TYPE i.
    METHODS int31 RETURNING VALUE(value) TYPE i.
    METHODS intinrange
      IMPORTING low          TYPE i
                high         TYPE i
      RETURNING VALUE(value) TYPE i.
    "! A float in [0, 1).
    METHODS float RETURNING VALUE(value) TYPE f.
    METHODS decfloat34 RETURNING VALUE(value) TYPE decfloat34.
  PROTECTED SECTION.
    DATA state TYPE int8.
    METHODS next RETURNING VALUE(value) TYPE int8.
ENDCLASS.

CLASS cl_abap_random IMPLEMENTATION.
  METHOD seed.
    seed = zrap_eml=>random_seed( ).
  ENDMETHOD.

  METHOD create.
    IF seed IS SUPPLIED.
      prng = NEW cl_abap_random( seed ).
    ELSE.
      prng = NEW cl_abap_random( ).
    ENDIF.
  ENDMETHOD.

  METHOD constructor.
    IF seed IS SUPPLIED.
      state = seed MOD 2147483647.
    ELSE.
      state = zrap_eml=>random_seed( ) MOD 2147483647.
    ENDIF.
    IF state <= 0.
      state = state + 2147483646.
    ENDIF.
  ENDMETHOD.

  METHOD next.
    state = ( state * 48271 ) MOD 2147483647.
    value = state - 1.
  ENDMETHOD.

  METHOD int.
    value = next( ).
  ENDMETHOD.

  METHOD int31.
    value = next( ).
  ENDMETHOD.

  METHOD intinrange.
    DATA range TYPE int8.
    range = high - low + 1.
    value = low + next( ) MOD range.
  ENDMETHOD.

  METHOD float.
    value = next( ) / 2147483646.
  ENDMETHOD.

  METHOD decfloat34.
    value = next( ) / 2147483646.
  ENDMETHOD.
ENDCLASS.
`;

const randomTyped = (name: string, type: string, range: { min: string; max: string } | undefined, next: string): FrameworkSource => ({
  fileName: `${name}.clas.abap`,
  source: `CLASS ${name} DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS create
      IMPORTING seed          TYPE i OPTIONAL${range === undefined ? "" : `\n                min           TYPE ${type} OPTIONAL\n                max           TYPE ${type} OPTIONAL`}
      RETURNING VALUE(prng)   TYPE REF TO ${name}
      RAISING   cx_abap_random.
    METHODS get_next RETURNING VALUE(value) TYPE ${type}.
  PRIVATE SECTION.
    DATA generator TYPE REF TO cl_abap_random.
    DATA low TYPE ${type}.
    DATA high TYPE ${type}.
ENDCLASS.

CLASS ${name} IMPLEMENTATION.
  METHOD create.
    prng = NEW ${name}( ).
    IF seed IS SUPPLIED.
      prng->generator = cl_abap_random=>create( seed ).
    ELSE.
      prng->generator = cl_abap_random=>create( ).
    ENDIF.${
      range === undefined
        ? ""
        : `
    prng->low = ${range.min}.
    prng->high = ${range.max}.
    IF min IS SUPPLIED.
      prng->low = min.
    ENDIF.
    IF max IS SUPPLIED.
      prng->high = max.
    ENDIF.
    IF prng->low > prng->high.
      RAISE EXCEPTION NEW cx_abap_random( zrap_text = |min { prng->low } is greater than max { prng->high }| ).
    ENDIF.`
    }
  ENDMETHOD.

  METHOD get_next.
${next}
  ENDMETHOD.
ENDCLASS.
`,
});

const RANDOM_TYPED: FrameworkSource[] = [
  randomTyped("cl_abap_random_int", "i", { min: "-2147483647", max: "2147483647" }, `    DATA range TYPE decfloat34.
    range = high - low + 1.
    value = low + trunc( generator->decfloat34( ) * range ).`),
  randomTyped("cl_abap_random_int8", "int8", { min: "0", max: "2147483647" }, `    DATA range TYPE decfloat34.
    range = high - low + 1.
    value = low + trunc( generator->decfloat34( ) * range ).`),
  randomTyped("cl_abap_random_float", "f", undefined, `    value = generator->float( ).`),
  randomTyped("cl_abap_random_decfloat34", "decfloat34", undefined, `    value = generator->decfloat34( ).`),
];

// ------------------------------------------------------------------------------ regular expressions

const CL_ABAP_REGEX = `CLASS cl_abap_regex DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    "! The pattern and its flags (i: ignore case, x: extended, m: multiline, s: dot all, p: PCRE).
    DATA pattern TYPE string READ-ONLY.
    DATA flags TYPE string READ-ONLY.
    METHODS constructor
      IMPORTING pattern       TYPE csequence
                ignore_case   TYPE abap_bool DEFAULT abap_false
                simple_regex  TYPE abap_bool DEFAULT abap_false
                no_submatches TYPE abap_bool DEFAULT abap_false
      RAISING   cx_sy_regex.
    CLASS-METHODS create_pcre
      IMPORTING pattern          TYPE csequence
                ignore_case      TYPE abap_bool DEFAULT abap_false
                extended         TYPE abap_bool DEFAULT abap_true
                enable_multiline TYPE abap_bool DEFAULT abap_false
                dot_all          TYPE abap_bool DEFAULT abap_false
                unicode_handling TYPE string OPTIONAL
      RETURNING VALUE(regex)     TYPE REF TO cl_abap_regex
      RAISING   cx_sy_regex.
    CLASS-METHODS create_posix
      IMPORTING pattern       TYPE csequence
                ignore_case   TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(regex)  TYPE REF TO cl_abap_regex
      RAISING   cx_sy_regex.
    METHODS create_matcher
      IMPORTING text           TYPE clike OPTIONAL
                table          TYPE string_table OPTIONAL
      RETURNING VALUE(matcher) TYPE REF TO cl_abap_matcher
      RAISING   cx_sy_regex.
    METHODS zrap_set_flags IMPORTING flags TYPE string.
ENDCLASS.

CLASS cl_abap_regex IMPLEMENTATION.
  METHOD constructor.
    me->pattern = pattern.
    IF ignore_case = abap_true.
      flags = \`i\`.
    ENDIF.
    zrap_eml=>regex_check( pattern = me->pattern flags = flags ).
  ENDMETHOD.

  METHOD zrap_set_flags.
    me->flags = flags.
    zrap_eml=>regex_check( pattern = pattern flags = flags ).
  ENDMETHOD.

  METHOD create_pcre.
    DATA flags TYPE string VALUE \`p\`.
    IF ignore_case = abap_true.
      flags = flags && \`i\`.
    ENDIF.
    IF extended = abap_true.
      flags = flags && \`x\`.
    ENDIF.
    IF enable_multiline = abap_true.
      flags = flags && \`m\`.
    ENDIF.
    IF dot_all = abap_true.
      flags = flags && \`s\`.
    ENDIF.
    regex = NEW cl_abap_regex( pattern ).
    regex->zrap_set_flags( flags ).
  ENDMETHOD.

  METHOD create_posix.
    regex = NEW cl_abap_regex( pattern = pattern ignore_case = ignore_case ).
  ENDMETHOD.

  METHOD create_matcher.
    DATA content TYPE string.
    IF table IS SUPPLIED.
      content = concat_lines_of( table = table sep = |\\n| ).
    ELSE.
      content = text.
    ENDIF.
    matcher = NEW cl_abap_matcher( regex = me text = content ).
  ENDMETHOD.
ENDCLASS.
`;

const CL_ABAP_MATCHER = `CLASS cl_abap_matcher DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    DATA text TYPE string READ-ONLY.
    DATA regex TYPE REF TO cl_abap_regex READ-ONLY.
    METHODS constructor
      IMPORTING regex TYPE REF TO cl_abap_regex
                text  TYPE string.
    CLASS-METHODS create
      IMPORTING pattern        TYPE csequence
                text           TYPE clike OPTIONAL
                table          TYPE string_table OPTIONAL
                ignore_case    TYPE abap_bool DEFAULT abap_false
                simple_regex   TYPE abap_bool DEFAULT abap_false
                no_submatches  TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(matcher) TYPE REF TO cl_abap_matcher
      RAISING   cx_sy_regex.
    CLASS-METHODS create_pcre
      IMPORTING pattern          TYPE csequence
                text             TYPE clike OPTIONAL
                table            TYPE string_table OPTIONAL
                ignore_case      TYPE abap_bool DEFAULT abap_false
                extended         TYPE abap_bool DEFAULT abap_true
                enable_multiline TYPE abap_bool DEFAULT abap_false
                dot_all          TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(matcher)   TYPE REF TO cl_abap_matcher
      RAISING   cx_sy_regex.
    CLASS-METHODS matches
      IMPORTING pattern        TYPE csequence
                text           TYPE clike
                ignore_case    TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(success) TYPE abap_bool
      RAISING   cx_sy_regex.
    CLASS-METHODS contains
      IMPORTING pattern        TYPE csequence
                text           TYPE clike
                ignore_case    TYPE abap_bool DEFAULT abap_false
      RETURNING VALUE(success) TYPE abap_bool
      RAISING   cx_sy_regex.
    METHODS find_next RETURNING VALUE(success) TYPE abap_bool.
    METHODS find_all RETURNING VALUE(matches) TYPE match_result_tab.
    METHODS match RETURNING VALUE(success) TYPE abap_bool.
    METHODS get_match RETURNING VALUE(match) TYPE match_result.
    METHODS get_offset
      IMPORTING index         TYPE i DEFAULT 0
      RETURNING VALUE(offset) TYPE i.
    METHODS get_length
      IMPORTING index         TYPE i DEFAULT 0
      RETURNING VALUE(length) TYPE i.
    METHODS get_submatch
      IMPORTING index           TYPE i
      RETURNING VALUE(submatch) TYPE string.
    METHODS replace_all
      IMPORTING newtext      TYPE csequence
      RETURNING VALUE(count) TYPE i.
    METHODS replace_found
      IMPORTING newtext        TYPE csequence
      RETURNING VALUE(success) TYPE abap_bool.
    METHODS replace_next
      IMPORTING newtext        TYPE csequence
      RETURNING VALUE(success) TYPE abap_bool.
  PRIVATE SECTION.
    DATA position TYPE i.
    DATA current TYPE match_result.
    DATA found TYPE abap_bool.
    METHODS search
      IMPORTING start        TYPE i
      RETURNING VALUE(match) TYPE match_result.
ENDCLASS.

CLASS cl_abap_matcher IMPLEMENTATION.
  METHOD constructor.
    me->regex = regex.
    me->text = text.
  ENDMETHOD.

  METHOD create.
    DATA regex TYPE REF TO cl_abap_regex.
    regex = NEW cl_abap_regex( pattern = pattern ignore_case = ignore_case ).
    IF table IS SUPPLIED.
      matcher = regex->create_matcher( table = table ).
    ELSE.
      matcher = regex->create_matcher( text = text ).
    ENDIF.
  ENDMETHOD.

  METHOD create_pcre.
    DATA regex TYPE REF TO cl_abap_regex.
    regex = cl_abap_regex=>create_pcre( pattern = pattern ignore_case = ignore_case extended = extended
                                        enable_multiline = enable_multiline dot_all = dot_all ).
    IF table IS SUPPLIED.
      matcher = regex->create_matcher( table = table ).
    ELSE.
      matcher = regex->create_matcher( text = text ).
    ENDIF.
  ENDMETHOD.

  METHOD matches.
    success = create( pattern = pattern text = text ignore_case = ignore_case )->match( ).
  ENDMETHOD.

  METHOD contains.
    success = create( pattern = pattern text = text ignore_case = ignore_case )->find_next( ).
  ENDMETHOD.

  METHOD search.
    DATA submatches TYPE string.
    DATA parts TYPE string_table.
    DATA part TYPE string.
    DATA offset TYPE string.
    DATA length TYPE string.
    DATA found_at TYPE i.
    DATA found_length TYPE i.
    zrap_eml=>regex_find( EXPORTING pattern    = regex->pattern
                                    flags      = regex->flags
                                    text       = text
                                    start      = start
                          IMPORTING offset     = found_at
                                    length     = found_length
                                    submatches = submatches ).
    IF found_at < 0.
      match-offset = -1.
      RETURN.
    ENDIF.
    match-offset = found_at.
    match-length = found_length.
    IF submatches IS NOT INITIAL.
      SPLIT submatches AT \` \` INTO TABLE parts.
      LOOP AT parts INTO part.
        SPLIT part AT \`,\` INTO offset length.
        APPEND VALUE #( offset = offset length = length ) TO match-submatches.
      ENDLOOP.
    ENDIF.
  ENDMETHOD.

  METHOD find_next.
    current = search( position ).
    IF current-offset < 0.
      found = abap_false.
      success = abap_false.
      RETURN.
    ENDIF.
    found = abap_true.
    success = abap_true.
    position = current-offset + current-length.
    IF current-length = 0.
      position = position + 1.
    ENDIF.
  ENDMETHOD.

  METHOD find_all.
    position = 0.
    WHILE find_next( ) = abap_true.
      APPEND current TO matches.
    ENDWHILE.
  ENDMETHOD.

  METHOD match.
    DATA whole TYPE match_result.
    whole = search( 0 ).
    success = xsdbool( whole-offset = 0 AND whole-length = strlen( text ) ).
    IF success = abap_true.
      current = whole.
      found = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD get_match.
    match = current.
  ENDMETHOD.

  METHOD get_offset.
    IF index = 0.
      offset = current-offset.
    ELSE.
      offset = current-submatches[ index ]-offset.
    ENDIF.
  ENDMETHOD.

  METHOD get_length.
    IF index = 0.
      length = current-length.
    ELSE.
      length = current-submatches[ index ]-length.
    ENDIF.
  ENDMETHOD.

  METHOD get_submatch.
    DATA offset TYPE i.
    DATA length TYPE i.
    IF index = 0.
      offset = current-offset.
      length = current-length.
    ELSE.
      offset = current-submatches[ index ]-offset.
      length = current-submatches[ index ]-length.
    ENDIF.
    IF offset >= 0.
      submatch = substring( val = text off = offset len = length ).
    ENDIF.
  ENDMETHOD.

  METHOD replace_all.
    text = zrap_eml=>regex_replace( EXPORTING pattern = regex->pattern
                                              flags   = regex->flags
                                              text    = text
                                              newtext = |{ newtext }|
                                              all     = abap_true
                                    IMPORTING count   = count ).
    position = 0.
    found = abap_false.
  ENDMETHOD.

  METHOD replace_found.
    DATA replacement TYPE string.
    IF found = abap_false.
      RETURN.
    ENDIF.
    replacement = zrap_eml=>regex_replace( pattern = regex->pattern
                                           flags   = regex->flags
                                           text    = substring( val = text off = current-offset len = current-length )
                                           newtext = |{ newtext }| ).
    text = substring( val = text len = current-offset ) && replacement && substring( val = text off = current-offset + current-length ).
    position = current-offset + strlen( replacement ).
    found = abap_false.
    success = abap_true.
  ENDMETHOD.

  METHOD replace_next.
    IF find_next( ) = abap_false.
      RETURN.
    ENDIF.
    success = replace_found( newtext ).
  ENDMETHOD.
ENDCLASS.
`;

// ------------------------------------------------------------------------------ RTTS

const CL_ABAP_TYPEDESCR = `CLASS cl_abap_typedescr DEFINITION PUBLIC ABSTRACT CREATE PUBLIC.
  PUBLIC SECTION.
    CONSTANTS typekind_any TYPE abap_typekind VALUE '~'.
    CONSTANTS typekind_char TYPE abap_typekind VALUE 'C'.
    CONSTANTS typekind_class TYPE abap_typekind VALUE '*'.
    CONSTANTS typekind_clike TYPE abap_typekind VALUE '&'.
    CONSTANTS typekind_csequence TYPE abap_typekind VALUE '?'.
    CONSTANTS typekind_data TYPE abap_typekind VALUE '#'.
    CONSTANTS typekind_date TYPE abap_typekind VALUE 'D'.
    CONSTANTS typekind_decfloat TYPE abap_typekind VALUE '/'.
    CONSTANTS typekind_decfloat16 TYPE abap_typekind VALUE 'a'.
    CONSTANTS typekind_decfloat34 TYPE abap_typekind VALUE 'e'.
    CONSTANTS typekind_dref TYPE abap_typekind VALUE 'l'.
    CONSTANTS typekind_float TYPE abap_typekind VALUE 'F'.
    CONSTANTS typekind_hex TYPE abap_typekind VALUE 'X'.
    CONSTANTS typekind_int TYPE abap_typekind VALUE 'I'.
    CONSTANTS typekind_int1 TYPE abap_typekind VALUE 'b'.
    CONSTANTS typekind_int2 TYPE abap_typekind VALUE 's'.
    CONSTANTS typekind_int8 TYPE abap_typekind VALUE '8'.
    CONSTANTS typekind_intf TYPE abap_typekind VALUE '+'.
    CONSTANTS typekind_iref TYPE abap_typekind VALUE 'm'.
    CONSTANTS typekind_num TYPE abap_typekind VALUE 'N'.
    CONSTANTS typekind_numeric TYPE abap_typekind VALUE '%'.
    CONSTANTS typekind_oref TYPE abap_typekind VALUE 'r'.
    CONSTANTS typekind_packed TYPE abap_typekind VALUE 'P'.
    CONSTANTS typekind_simple TYPE abap_typekind VALUE '$'.
    CONSTANTS typekind_string TYPE abap_typekind VALUE 'g'.
    CONSTANTS typekind_struct1 TYPE abap_typekind VALUE 'u'.
    CONSTANTS typekind_struct2 TYPE abap_typekind VALUE 'v'.
    CONSTANTS typekind_table TYPE abap_typekind VALUE 'h'.
    CONSTANTS typekind_time TYPE abap_typekind VALUE 'T'.
    CONSTANTS typekind_utclong TYPE abap_typekind VALUE 'p'.
    CONSTANTS typekind_w TYPE abap_typekind VALUE 'w'.
    CONSTANTS typekind_xsequence TYPE abap_typekind VALUE '!'.
    CONSTANTS typekind_xstring TYPE abap_typekind VALUE 'y'.
    CONSTANTS kind_elem TYPE c LENGTH 1 VALUE 'E'.
    CONSTANTS kind_struct TYPE c LENGTH 1 VALUE 'S'.
    CONSTANTS kind_table TYPE c LENGTH 1 VALUE 'T'.
    CONSTANTS kind_ref TYPE c LENGTH 1 VALUE 'R'.
    CONSTANTS kind_class TYPE c LENGTH 1 VALUE 'C'.
    CONSTANTS kind_intf TYPE c LENGTH 1 VALUE 'I'.
    DATA absolute_name TYPE abap_abstypename READ-ONLY.
    DATA type_kind TYPE abap_typekind READ-ONLY.
    DATA length TYPE i READ-ONLY.
    DATA decimals TYPE i READ-ONLY.
    DATA kind TYPE c LENGTH 1 READ-ONLY.
    CLASS-METHODS describe_by_data
      IMPORTING p_data             TYPE any
      RETURNING VALUE(p_descr_ref) TYPE REF TO cl_abap_typedescr.
    CLASS-METHODS describe_by_data_ref
      IMPORTING p_data_ref         TYPE REF TO data
      RETURNING VALUE(p_descr_ref) TYPE REF TO cl_abap_typedescr.
    CLASS-METHODS describe_by_object_ref
      IMPORTING p_object_ref       TYPE REF TO object
      RETURNING VALUE(p_descr_ref) TYPE REF TO cl_abap_typedescr.
    CLASS-METHODS describe_by_name
      IMPORTING p_name             TYPE any
      RETURNING VALUE(p_descr_ref) TYPE REF TO cl_abap_typedescr
      RAISING   cx_sy_rtti_type_not_released.
    METHODS get_relative_name RETURNING VALUE(p_relative_name) TYPE string.
    METHODS is_ddic_type RETURNING VALUE(p_abap_bool) TYPE abap_bool.
    METHODS zrap_init
      IMPORTING kind          TYPE csequence
                type_kind     TYPE csequence
                length        TYPE i
                decimals      TYPE i
                absolute_name TYPE csequence.
ENDCLASS.

CLASS cl_abap_typedescr IMPLEMENTATION.
  METHOD describe_by_data.
    DATA lv_kind TYPE string.
    DATA lv_type_kind TYPE string.
    DATA lv_length TYPE i.
    DATA lv_decimals TYPE i.
    DATA lv_name TYPE string.
    DATA lv_components TYPE string.
    DATA parts TYPE string_table.
    DATA part TYPE string.
    DATA structdescr TYPE REF TO cl_abap_structdescr.
    DATA tabledescr TYPE REF TO cl_abap_tabledescr.
    DATA refdescr TYPE REF TO cl_abap_refdescr.
    DATA line TYPE REF TO data.
    FIELD-SYMBOLS <component> TYPE any.
    FIELD-SYMBOLS <table> TYPE ANY TABLE.
    FIELD-SYMBOLS <line> TYPE any.
    zrap_eml=>rtti_describe( EXPORTING data       = p_data
                             IMPORTING kind       = lv_kind
                                       type_kind  = lv_type_kind
                                       length     = lv_length
                                       decimals   = lv_decimals
                                       name       = lv_name
                                       components = lv_components ).
    CASE lv_kind.
      WHEN \`S\`.
        structdescr = NEW cl_abap_structdescr( ).
        SPLIT lv_components AT \` \` INTO TABLE parts.
        LOOP AT parts INTO part.
          ASSIGN COMPONENT part OF STRUCTURE p_data TO <component>.
          IF sy-subrc = 0.
            structdescr->zrap_add_component( name = part type = CAST cl_abap_datadescr( describe_by_data( <component> ) ) ).
          ENDIF.
        ENDLOOP.
        p_descr_ref = structdescr.
      WHEN \`T\`.
        tabledescr = NEW cl_abap_tabledescr( ).
        ASSIGN p_data TO <table>.
        CREATE DATA line LIKE LINE OF <table>.
        ASSIGN line->* TO <line>.
        tabledescr->zrap_set_line( CAST cl_abap_datadescr( describe_by_data( <line> ) ) ).
        p_descr_ref = tabledescr.
      WHEN \`R\`.
        refdescr = NEW cl_abap_refdescr( ).
        p_descr_ref = refdescr.
      WHEN OTHERS.
        p_descr_ref = NEW cl_abap_elemdescr( ).
    ENDCASE.
    p_descr_ref->zrap_init( kind = lv_kind type_kind = lv_type_kind length = lv_length decimals = lv_decimals absolute_name = lv_name ).
  ENDMETHOD.

  METHOD describe_by_data_ref.
    FIELD-SYMBOLS <data> TYPE any.
    ASSIGN p_data_ref->* TO <data>.
    p_descr_ref = describe_by_data( <data> ).
  ENDMETHOD.

  METHOD describe_by_object_ref.
    DATA classdescr TYPE REF TO cl_abap_classdescr.
    classdescr = NEW cl_abap_classdescr( ).
    classdescr->zrap_init( kind = kind_class type_kind = typekind_class length = 0 decimals = 0
                           absolute_name = |\\\\CLASS={ zrap_eml=>class_name( p_object_ref ) }| ).
    p_descr_ref = classdescr.
  ENDMETHOD.

  METHOD describe_by_name.
    RAISE EXCEPTION NEW cx_sy_rtti_type_not_released( zrap_text = |describe_by_name( { p_name } ) is not supported: use describe_by_data| ).
  ENDMETHOD.

  METHOD get_relative_name.
    DATA parts TYPE string_table.
    IF absolute_name CS \`=\`.
      SPLIT absolute_name AT \`=\` INTO TABLE parts.
      p_relative_name = parts[ lines( parts ) ].
    ENDIF.
  ENDMETHOD.

  METHOD is_ddic_type.
    p_abap_bool = xsdbool( absolute_name CP '\\TYPE=*' ).
  ENDMETHOD.

  METHOD zrap_init.
    me->kind = kind.
    me->type_kind = type_kind.
    me->length = length.
    me->decimals = decimals.
    me->absolute_name = absolute_name.
  ENDMETHOD.
ENDCLASS.
`;

const rttsClass = (name: string, superclass: string, body = "", implementation = ""): FrameworkSource => ({
  fileName: `${name}.clas.abap`,
  source: `CLASS ${name} DEFINITION PUBLIC INHERITING FROM ${superclass} CREATE PUBLIC.
  PUBLIC SECTION.
${body}ENDCLASS.

CLASS ${name} IMPLEMENTATION.
${implementation}ENDCLASS.
`,
});

const RTTS: FrameworkSource[] = [
  rttsClass("cl_abap_datadescr", "cl_abap_typedescr"),
  rttsClass(
    "cl_abap_elemdescr",
    "cl_abap_datadescr",
    `    METHODS get_ddic_field RETURNING VALUE(p_flddescr) TYPE string.
    DATA output_length TYPE i READ-ONLY.
`,
    `  METHOD get_ddic_field.
  ENDMETHOD.
`,
  ),
  rttsClass("cl_abap_complexdescr", "cl_abap_datadescr"),
  rttsClass(
    "cl_abap_structdescr",
    "cl_abap_complexdescr",
    `    DATA components TYPE abap_compdescr_tab READ-ONLY.
    DATA struct_kind TYPE c LENGTH 1 READ-ONLY.
    METHODS get_components RETURNING VALUE(p_result) TYPE abap_component_tab.
    METHODS get_component_type
      IMPORTING p_name             TYPE any
      RETURNING VALUE(p_descr_ref) TYPE REF TO cl_abap_datadescr.
    METHODS zrap_add_component
      IMPORTING name TYPE csequence
                type TYPE REF TO cl_abap_datadescr.
  PRIVATE SECTION.
    DATA types TYPE abap_component_tab.
`,
    `  METHOD get_components.
    p_result = types.
  ENDMETHOD.

  METHOD get_component_type.
    DATA component TYPE abap_componentdescr.
    DATA wanted TYPE string.
    wanted = to_upper( |{ p_name }| ).
    READ TABLE types INTO component WITH KEY name = wanted.
    IF sy-subrc = 0.
      p_descr_ref = component-type.
    ENDIF.
  ENDMETHOD.

  METHOD zrap_add_component.
    DATA upper TYPE string.
    upper = to_upper( name ).
    APPEND VALUE #( name = upper type = type ) TO types.
    APPEND VALUE #( name = upper type_kind = type->type_kind length = type->length decimals = type->decimals ) TO components.
  ENDMETHOD.
`,
  ),
  rttsClass(
    "cl_abap_tabledescr",
    "cl_abap_complexdescr",
    `    DATA table_kind TYPE c LENGTH 1 READ-ONLY.
    METHODS get_table_line_type RETURNING VALUE(p_descr_ref) TYPE REF TO cl_abap_datadescr.
    METHODS zrap_set_line IMPORTING line TYPE REF TO cl_abap_datadescr.
  PRIVATE SECTION.
    DATA line TYPE REF TO cl_abap_datadescr.
`,
    `  METHOD get_table_line_type.
    p_descr_ref = line.
  ENDMETHOD.

  METHOD zrap_set_line.
    me->line = line.
    table_kind = 'S'.
  ENDMETHOD.
`,
  ),
  rttsClass("cl_abap_refdescr", "cl_abap_datadescr"),
  rttsClass("cl_abap_objectdescr", "cl_abap_typedescr"),
  rttsClass("cl_abap_classdescr", "cl_abap_objectdescr"),
  rttsClass("cl_abap_intfdescr", "cl_abap_objectdescr"),
];

// ------------------------------------------------------------------------------ the kernel

/** Methods of ZRAP_EML for the utilities; their bodies are replaced at run time. */
export const UTILS_KERNEL_DEFINITIONS = `    "! /ui2/cl_json and xco_cp_json: mode is a pretty_mode of /ui2/cl_json, or xco.
    CLASS-METHODS json_serialize
      IMPORTING data           TYPE data
                mode           TYPE string OPTIONAL
                compress       TYPE abap_bool DEFAULT abap_false
                numc_as_string TYPE abap_bool DEFAULT abap_false
                ts_as_iso8601  TYPE abap_bool DEFAULT abap_false
                hex_as_base64  TYPE abap_bool DEFAULT abap_true
                format_output  TYPE abap_bool DEFAULT abap_false
                booleans       TYPE abap_bool DEFAULT abap_false
                mappings       TYPE string OPTIONAL
      RETURNING VALUE(json)    TYPE string.
    CLASS-METHODS json_deserialize
      IMPORTING json          TYPE string
                mode          TYPE string OPTIONAL
                hex_as_base64 TYPE abap_bool DEFAULT abap_true
                mappings      TYPE string OPTIONAL
      CHANGING  data          TYPE data.
    CLASS-METHODS json_transform
      IMPORTING json          TYPE string
                kinds         TYPE string
      RETURNING VALUE(result) TYPE string.
    CLASS-METHODS json_quote
      IMPORTING text          TYPE string
      RETURNING VALUE(result) TYPE string.
    CLASS-METHODS codepage_check
      IMPORTING codepage TYPE string.
    CLASS-METHODS codepage_out
      IMPORTING codepage      TYPE string
                source        TYPE string
      RETURNING VALUE(result) TYPE xstring.
    CLASS-METHODS codepage_in
      IMPORTING codepage      TYPE string
                source        TYPE xstring
      RETURNING VALUE(result) TYPE string.
    CLASS-METHODS base64_encode_x
      IMPORTING data          TYPE xstring
      RETURNING VALUE(result) TYPE string.
    CLASS-METHODS base64_decode
      IMPORTING text          TYPE string
      RETURNING VALUE(result) TYPE xstring.
    "! url, url_unescape, html or rtrim.
    CLASS-METHODS text_escape
      IMPORTING format        TYPE string
                text          TYPE string
      RETURNING VALUE(result) TYPE string.
    "! The characters of a field with its trailing blanks.
    CLASS-METHODS chars_raw
      IMPORTING value         TYPE c
      RETURNING VALUE(result) TYPE string.
    CLASS-METHODS char_code
      IMPORTING code          TYPE i
      RETURNING VALUE(result) TYPE string.
    CLASS-METHODS gzip
      IMPORTING operation     TYPE string
                source        TYPE xstring
      RETURNING VALUE(result) TYPE xstring.
    CLASS-METHODS digest
      IMPORTING algorithm     TYPE string
                key           TYPE xstring OPTIONAL
                data          TYPE xstring
      RETURNING VALUE(result) TYPE xstring.
    CLASS-METHODS random_seed
      RETURNING VALUE(seed) TYPE i.
    CLASS-METHODS regex_check
      IMPORTING pattern TYPE string
                flags   TYPE string.
    "! The first match from start: offset -1 when none; submatches as "offset,length …".
    CLASS-METHODS regex_find
      IMPORTING pattern    TYPE string
                flags      TYPE string
                text       TYPE string
                start      TYPE i
      EXPORTING offset     TYPE i
                length     TYPE i
                submatches TYPE string.
    CLASS-METHODS regex_replace
      IMPORTING pattern       TYPE string
                flags         TYPE string
                text          TYPE string
                newtext       TYPE string
                all           TYPE abap_bool DEFAULT abap_false
      EXPORTING count         TYPE i
      RETURNING VALUE(result) TYPE string.
    CLASS-METHODS date_add
      IMPORTING date          TYPE d
                years         TYPE i DEFAULT 0
                months        TYPE i DEFAULT 0
                days          TYPE i DEFAULT 0
      RETURNING VALUE(result) TYPE d.
    CLASS-METHODS moment_add
      IMPORTING moment        TYPE timestamp
                years         TYPE i DEFAULT 0
                months        TYPE i DEFAULT 0
                days          TYPE i DEFAULT 0
                seconds       TYPE i DEFAULT 0
      RETURNING VALUE(result) TYPE timestamp.
    CLASS-METHODS unix_time
      IMPORTING moment        TYPE timestamp
      RETURNING VALUE(result) TYPE int8.
    CLASS-METHODS tstmp_add
      IMPORTING tstmp         TYPE string
                seconds       TYPE string
      RETURNING VALUE(result) TYPE timestampl.
    CLASS-METHODS tstmp_diff
      IMPORTING tstmp1        TYPE string
                tstmp2        TYPE string
      RETURNING VALUE(result) TYPE timestampl.
    CLASS-METHODS tstmp_to_utclong
      IMPORTING tstmp         TYPE string
      RETURNING VALUE(result) TYPE utclong.
    CLASS-METHODS utclong_to_tstmp
      IMPORTING value         TYPE utclong
      RETURNING VALUE(result) TYPE timestampl.
    CLASS-METHODS utclong_read
      IMPORTING text          TYPE string
      RETURNING VALUE(result) TYPE utclong.
    CLASS-METHODS number_get
      IMPORTING object     TYPE string
                subobject  TYPE string OPTIONAL
                interval   TYPE string
                toyear     TYPE string OPTIONAL
                quantity   TYPE i DEFAULT 1
      EXPORTING number     TYPE string
                returncode TYPE c
                returned   TYPE i.
    CLASS-METHODS number_check
      IMPORTING object     TYPE string
                subobject  TYPE string OPTIONAL
                interval   TYPE string
                toyear     TYPE string OPTIONAL
                number     TYPE string
      EXPORTING returncode TYPE c.
    CLASS-METHODS bali_save
      IMPORTING handle      TYPE string
                object      TYPE string
                subobject   TYPE string OPTIONAL
                external_id TYPE string OPTIONAL
                expiry_date TYPE d OPTIONAL
                items       TYPE ANY TABLE.
    CLASS-METHODS bali_query
      IMPORTING handle      TYPE string OPTIONAL
                object      TYPE string OPTIONAL
                subobject   TYPE string OPTIONAL
                external_id TYPE string OPTIONAL
                user        TYPE string OPTIONAL
                start_time  TYPE utclong OPTIONAL
                end_time    TYPE utclong OPTIONAL
                max_count   TYPE i DEFAULT 0
      CHANGING  logs        TYPE ANY TABLE.
    CLASS-METHODS bali_items
      IMPORTING handle TYPE string
      CHANGING  items  TYPE ANY TABLE.
    CLASS-METHODS bali_delete
      IMPORTING handle TYPE string.
    "! RTTS: kind (E S T R), type kind, length (bytes), decimals, absolute name, components of a structure.
    CLASS-METHODS rtti_describe
      IMPORTING data       TYPE any
      EXPORTING kind       TYPE string
                type_kind  TYPE string
                length     TYPE i
                decimals   TYPE i
                name       TYPE string
                components TYPE string.
    CLASS-METHODS class_name
      IMPORTING object      TYPE REF TO object
      RETURNING VALUE(name) TYPE string.
`;

export const UTILS_KERNEL_METHODS = [
  "json_serialize",
  "json_deserialize",
  "json_transform",
  "json_quote",
  "codepage_check",
  "codepage_out",
  "codepage_in",
  "base64_encode_x",
  "base64_decode",
  "text_escape",
  "chars_raw",
  "char_code",
  "gzip",
  "digest",
  "random_seed",
  "regex_check",
  "regex_find",
  "regex_replace",
  "date_add",
  "moment_add",
  "unix_time",
  "tstmp_add",
  "tstmp_diff",
  "tstmp_to_utclong",
  "utclong_to_tstmp",
  "utclong_read",
  "number_get",
  "number_check",
  "bali_save",
  "bali_query",
  "bali_items",
  "bali_delete",
  "rtti_describe",
  "class_name",
];

export const UTILS_KERNEL_IMPLEMENTATIONS = UTILS_KERNEL_METHODS.map((m) => `  METHOD ${m}.\n  ENDMETHOD.\n`).join("\n");

const clas = (name: string, source: string): FrameworkSource => ({ fileName: `${name.replace(/\//g, "#")}.clas.abap`, source });
const intf = (name: string, source: string): FrameworkSource => ({ fileName: `${name}.intf.abap`, source });

/** The utilities, given to the transpiler only when a project uses them (frameworkClosure). */
export const UTILS_FRAMEWORK_SOURCES: FrameworkSource[] = [
  ...DDIC,
  { fileName: "abap.type.abap", source: TYPE_POOL_ABAP },
  ...EXCEPTIONS,
  clas("/ui2/cl_json", UI2_CL_JSON),
  intf("if_xco_cp_json_transformation", IF_XCO_CP_JSON_TRANSFORMATION),
  clas("zrap_cl_xco_json_trafo", ZRAP_CL_XCO_JSON_TRANSFORMATION),
  clas("zrap_cl_xco_json_trafos", ZRAP_CL_XCO_JSON_TRAFOS),
  intf("if_xco_cp_json_data", IF_XCO_CP_JSON_DATA),
  clas("zrap_cl_xco_json_data", ZRAP_CL_XCO_JSON_DATA),
  intf("if_xco_cp_json_data_builder", IF_XCO_CP_JSON_DATA_BUILDER),
  clas("zrap_cl_xco_json_builder", ZRAP_CL_XCO_JSON_BUILDER),
  intf("if_xco_cp_json_data_factory", IF_XCO_CP_JSON_DATA_FACTORY),
  clas("zrap_cl_xco_json_factory", ZRAP_CL_XCO_JSON_FACTORY),
  clas("xco_cp_json", XCO_CP_JSON),
  clas("cl_web_http_utility", CL_WEB_HTTP_UTILITY),
  intf("if_abap_conv_out", IF_ABAP_CONV_OUT),
  intf("if_abap_conv_in", IF_ABAP_CONV_IN),
  clas("cl_abap_conv_codepage", CL_ABAP_CONV_CODEPAGE),
  clas("cl_abap_gzip", CL_ABAP_GZIP),
  clas("cl_abap_char_utilities", CL_ABAP_CHAR_UTILITIES),
  clas("cl_abap_string_utilities", CL_ABAP_STRING_UTILITIES),
  clas("zrap_cl_xco_encoding", ZRAP_CL_XCO_ENCODING),
  clas("zrap_cl_xco_code_pages", ZRAP_CL_XCO_CODE_PAGES),
  clas("xco_cp_character", XCO_CP_CHARACTER),
  clas("zrap_cl_xco_text_encodings", ZRAP_CL_XCO_TEXT_ENCODINGS),
  clas("xco_cp_binary", XCO_CP_BINARY),
  clas("zrap_cl_xco_string", ZRAP_CL_XCO_STRING),
  clas("zrap_cl_xco_strings", ZRAP_CL_XCO_STRINGS),
  clas("zrap_cl_xco_xstring", ZRAP_CL_XCO_XSTRING),
  clas("zrap_cl_xco_time_format", ZRAP_CL_XCO_TIME_FORMAT),
  clas("zrap_cl_xco_time_formats", ZRAP_CL_XCO_TIME_FORMATS),
  clas("zrap_cl_xco_time_zone", ZRAP_CL_XCO_TIME_ZONE),
  clas("zrap_cl_xco_time_zones", ZRAP_CL_XCO_TIME_ZONES),
  clas("zrap_cl_xco_date", ZRAP_CL_XCO_DATE),
  clas("zrap_cl_xco_time", ZRAP_CL_XCO_TIME),
  clas("zrap_cl_xco_moment", ZRAP_CL_XCO_MOMENT),
  clas("zrap_cl_xco_unix_timestamp", ZRAP_CL_XCO_UNIX_TIMESTAMP),
  clas("xco_cp_time", XCO_CP_TIME),
  clas("zrap_cl_xco_user", ZRAP_CL_XCO_USER),
  clas("zrap_cl_xco_language", ZRAP_CL_XCO_LANGUAGE),
  clas("zrap_cl_xco_sy", ZRAP_CL_XCO_SY),
  clas("xco_cp", XCO_CP),
  clas("cl_abap_tstmp", CL_ABAP_TSTMP),
  clas("cl_abap_utclong", CL_ABAP_UTCLONG),
  clas("cl_numberrange_runtime", CL_NUMBERRANGE_RUNTIME),
  intf("if_bali_constants", IF_BALI_CONSTANTS),
  intf("if_bali_item_getter", IF_BALI_ITEM_GETTER),
  intf("if_bali_item_setter", IF_BALI_ITEM_SETTER),
  clas("zrap_cl_bali_item", ZRAP_CL_BALI_ITEM),
  clas("cl_bali_free_text_setter", CL_BALI_FREE_TEXT_SETTER),
  clas("cl_bali_message_setter", CL_BALI_MESSAGE_SETTER),
  clas("cl_bali_exception_setter", CL_BALI_EXCEPTION_SETTER),
  intf("if_bali_header_getter", IF_BALI_HEADER_GETTER),
  intf("if_bali_header_setter", IF_BALI_HEADER_SETTER),
  clas("cl_bali_header_setter", CL_BALI_HEADER_SETTER),
  intf("if_bali_log", IF_BALI_LOG),
  clas("cl_bali_log", CL_BALI_LOG),
  intf("if_bali_log_filter", IF_BALI_LOG_FILTER),
  clas("cl_bali_log_filter", CL_BALI_LOG_FILTER),
  intf("if_bali_log_db", IF_BALI_LOG_DB),
  clas("cl_bali_log_db", CL_BALI_LOG_DB),
  clas("cl_abap_message_digest", CL_ABAP_MESSAGE_DIGEST),
  clas("cl_abap_hmac", CL_ABAP_HMAC),
  clas("cl_abap_random", CL_ABAP_RANDOM),
  ...RANDOM_TYPED,
  clas("cl_abap_regex", CL_ABAP_REGEX),
  clas("cl_abap_matcher", CL_ABAP_MATCHER),
  clas("cl_abap_typedescr", CL_ABAP_TYPEDESCR),
  ...RTTS,
];

/** Name of the object of a framework file: `/ui2/cl_json` for `#ui2#cl_json.clas.abap`. */
export function frameworkObjectName(fileName: string): string {
  return (fileName.split(".")[0] ?? "").replace(/#/g, "/").toLowerCase();
}

const WORD = /[a-z_/][a-z0-9_/]*/g;

/**
 * The utilities a project needs: those named in its sources, then those they name, and so on.
 * Words are matched case-insensitively; the type pool ABAP comes with the abap_comp* types.
 */
export function frameworkClosure(sources: ReadonlyArray<{ content: string }>): FrameworkSource[] {
  const byName = new Map<string, FrameworkSource>();
  for (const source of UTILS_FRAMEWORK_SOURCES) {
    byName.set(frameworkObjectName(source.fileName), source);
  }
  const wanted = new Set<FrameworkSource>();
  // the DDIC XML of the utilities names other objects only as row and component types
  const words = (content: string): string[] =>
    content.startsWith("<?xml") ? [...content.matchAll(/<(?:ROLLNAME|ROWTYPE)>([^<]+)</g)].map((m) => (m[1] ?? "").toLowerCase()) : (content.toLowerCase().match(WORD) ?? []);
  const queue: string[] = sources.map((s) => s.content);
  while (queue.length > 0) {
    for (const word of words(queue.pop() ?? "")) {
      const source = word.startsWith("abap_comp") || word === "abap_abstypename" || word === "abap_typekind" ? byName.get("abap") : word === "abap" ? undefined : byName.get(word);
      if (source !== undefined && !wanted.has(source)) {
        wanted.add(source);
        queue.push(source.source);
      }
    }
  }
  return UTILS_FRAMEWORK_SOURCES.filter((s) => wanted.has(s));
}
