/**
 * Clean-room ABAP framework objects the behavior pools need (PLAN.md §6.3): written from the
 * public signatures documented by SAP, no SAP code is copied. ZRAP_EML is the entry of the EML
 * kernel: its methods are replaced at run time by the managed RAP runtime.
 */

import { HTTP_FRAMEWORK_SOURCES, HTTP_KERNEL_DEFINITIONS, HTTP_KERNEL_IMPLEMENTATIONS } from "./framework-http.js";

export interface FrameworkSource {
  fileName: string;
  source: string;
}

const IF_ABAP_BEHV = `INTERFACE if_abap_behv PUBLIC.
  TYPES t_xflag TYPE x LENGTH 1.
  TYPES t_fail_cause TYPE x LENGTH 1.
  CONSTANTS:
    BEGIN OF mk,
      on  TYPE t_xflag VALUE '01',
      off TYPE t_xflag VALUE '00',
    END OF mk.
  CONSTANTS:
    BEGIN OF auth,
      allowed      TYPE t_xflag VALUE '00',
      unauthorized TYPE t_xflag VALUE '01',
    END OF auth.
  CONSTANTS:
    BEGIN OF fc,
      BEGIN OF o,
        enabled  TYPE t_xflag VALUE '00',
        disabled TYPE t_xflag VALUE '01',
      END OF o,
      BEGIN OF f,
        unrestricted            TYPE t_xflag VALUE '00',
        read_only               TYPE t_xflag VALUE '01',
        mandatory               TYPE t_xflag VALUE '02',
        mandatory_and_read_only TYPE t_xflag VALUE '03',
        all                     TYPE t_xflag VALUE '04',
      END OF f,
    END OF fc.
  CONSTANTS:
    BEGIN OF cause,
      unspecific   TYPE t_fail_cause VALUE '00',
      unauthorized TYPE t_fail_cause VALUE '01',
      not_found    TYPE t_fail_cause VALUE '02',
      locked       TYPE t_fail_cause VALUE '03',
      conflict     TYPE t_fail_cause VALUE '04',
      readonly     TYPE t_fail_cause VALUE '05',
      disabled     TYPE t_fail_cause VALUE '06',
      dependency   TYPE t_fail_cause VALUE '07',
    END OF cause.
ENDINTERFACE.
`;

const IF_MESSAGE = `INTERFACE if_message PUBLIC.
  METHODS get_text RETURNING VALUE(result) TYPE string.
  METHODS get_longtext
    IMPORTING preserve_newlines TYPE abap_bool OPTIONAL
    RETURNING VALUE(result)     TYPE string.
ENDINTERFACE.
`;

const IF_T100_MESSAGE = `INTERFACE if_t100_message PUBLIC.
  INTERFACES if_message.
  DATA t100key TYPE scx_t100key.
  CONSTANTS:
    BEGIN OF default_textid,
      msgid TYPE symsgid VALUE 'SY',
      msgno TYPE symsgno VALUE '530',
      attr1 TYPE scx_attrname VALUE '',
      attr2 TYPE scx_attrname VALUE '',
      attr3 TYPE scx_attrname VALUE '',
      attr4 TYPE scx_attrname VALUE '',
    END OF default_textid.
ENDINTERFACE.
`;

const IF_T100_DYN_MSG = `INTERFACE if_t100_dyn_msg PUBLIC.
  INTERFACES if_t100_message.
  DATA msgty TYPE symsgty.
  DATA msgv1 TYPE symsgv.
  DATA msgv2 TYPE symsgv.
  DATA msgv3 TYPE symsgv.
  DATA msgv4 TYPE symsgv.
ENDINTERFACE.
`;

const IF_ABAP_BEHV_MESSAGE = `INTERFACE if_abap_behv_message PUBLIC.
  INTERFACES if_t100_dyn_msg.
  TYPES t_severity TYPE c LENGTH 1.
  CONSTANTS:
    BEGIN OF severity,
      error       TYPE t_severity VALUE 'E',
      warning     TYPE t_severity VALUE 'W',
      information TYPE t_severity VALUE 'I',
      success     TYPE t_severity VALUE 'S',
      none        TYPE t_severity VALUE ' ',
    END OF severity.
  DATA m_severity TYPE t_severity.
ENDINTERFACE.
`;

/** Root of the exception classes; the transpiler makes a class named CX_ROOT extend Error. */
const CX_ROOT = `CLASS cx_root DEFINITION PUBLIC ABSTRACT CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_message.
    ALIASES get_text FOR if_message~get_text.
    ALIASES get_longtext FOR if_message~get_longtext.
    DATA textid TYPE sotr_conc READ-ONLY.
    DATA previous TYPE REF TO cx_root READ-ONLY.
    DATA is_resumable TYPE abap_bool READ-ONLY.
    METHODS constructor
      IMPORTING textid   LIKE textid OPTIONAL
                previous LIKE previous OPTIONAL.
ENDCLASS.

CLASS cx_root IMPLEMENTATION.
  METHOD constructor.
    me->textid = textid.
    me->previous = previous.
  ENDMETHOD.

  METHOD if_message~get_text.
    result = zrap_eml=>exception_text( me ).
  ENDMETHOD.

  METHOD if_message~get_longtext.
    result = if_message~get_text( ).
  ENDMETHOD.
ENDCLASS.
`;

const exceptionClass = (name: string, superclass: string, abstract = false): string => `CLASS ${name} DEFINITION PUBLIC${abstract ? " ABSTRACT" : ""} INHERITING FROM ${superclass} CREATE PUBLIC.
ENDCLASS.

CLASS ${name} IMPLEMENTATION.
ENDCLASS.
`;

/** Exception classes of the ABAP runtime errors the transpiled code raises, and their parents. */
const EXCEPTIONS: Array<[string, string, boolean]> = [
  ["cx_static_check", "cx_root", true],
  ["cx_dynamic_check", "cx_root", true],
  ["cx_no_check", "cx_root", true],
  ["cx_sy_arithmetic_error", "cx_dynamic_check", false],
  ["cx_sy_zerodivide", "cx_sy_arithmetic_error", false],
  ["cx_sy_arithmetic_overflow", "cx_sy_arithmetic_error", false],
  ["cx_sy_conversion_error", "cx_dynamic_check", false],
  ["cx_sy_conversion_no_number", "cx_sy_conversion_error", false],
  ["cx_sy_conversion_overflow", "cx_sy_conversion_error", false],
  ["cx_sy_itab_line_not_found", "cx_dynamic_check", false],
  ["cx_sy_move_cast_error", "cx_dynamic_check", false],
  ["cx_sy_ref_is_initial", "cx_dynamic_check", false],
  ["cx_sy_range_out_of_bounds", "cx_dynamic_check", false],
  ["cx_uuid_error", "cx_static_check", false],
];

const CL_SYSTEM_UUID = `CLASS cl_system_uuid DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS create_uuid_x16_static RETURNING VALUE(uuid) TYPE sysuuid_x16 RAISING cx_uuid_error.
    CLASS-METHODS create_uuid_c32_static RETURNING VALUE(uuid) TYPE sysuuid_c32 RAISING cx_uuid_error.
    CLASS-METHODS create_uuid_c36_static RETURNING VALUE(uuid) TYPE sysuuid_c36 RAISING cx_uuid_error.
ENDCLASS.

CLASS cl_system_uuid IMPLEMENTATION.
  METHOD create_uuid_x16_static.
    uuid = zrap_eml=>uuid( ).
  ENDMETHOD.

  METHOD create_uuid_c32_static.
    DATA raw TYPE sysuuid_x16.
    raw = zrap_eml=>uuid( ).
    uuid = raw.
  ENDMETHOD.

  METHOD create_uuid_c36_static.
    DATA raw TYPE sysuuid_x16.
    DATA hex TYPE c LENGTH 32.
    raw = zrap_eml=>uuid( ).
    hex = raw.
    uuid = |{ hex(8) }-{ hex+8(4) }-{ hex+12(4) }-{ hex+16(4) }-{ hex+20(12) }|.
    TRANSLATE uuid TO LOWER CASE.
  ENDMETHOD.
ENDCLASS.
`;

const ZRAP_CL_MESSAGE = `CLASS zrap_cl_message DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_abap_behv_message.
    DATA text TYPE string READ-ONLY.
    DATA msgid TYPE string READ-ONLY.
    DATA msgno TYPE string READ-ONLY.
    DATA msgv1 TYPE string READ-ONLY.
    DATA msgv2 TYPE string READ-ONLY.
    DATA msgv3 TYPE string READ-ONLY.
    DATA msgv4 TYPE string READ-ONLY.
    METHODS constructor
      IMPORTING severity TYPE if_abap_behv_message=>t_severity
                text     TYPE string OPTIONAL
                msgid    TYPE string OPTIONAL
                msgno    TYPE string OPTIONAL
                msgv1    TYPE string OPTIONAL
                msgv2    TYPE string OPTIONAL
                msgv3    TYPE string OPTIONAL
                msgv4    TYPE string OPTIONAL.
ENDCLASS.

CLASS zrap_cl_message IMPLEMENTATION.
  METHOD constructor.
    if_abap_behv_message~m_severity = severity.
    me->text = text.
    me->msgid = msgid.
    me->msgno = msgno.
    me->msgv1 = msgv1.
    me->msgv2 = msgv2.
    me->msgv3 = msgv3.
    me->msgv4 = msgv4.
    if_t100_message~t100key-msgid = msgid.
    if_t100_message~t100key-msgno = msgno.
    if_t100_dyn_msg~msgty = severity.
    if_t100_dyn_msg~msgv1 = msgv1.
    if_t100_dyn_msg~msgv2 = msgv2.
    if_t100_dyn_msg~msgv3 = msgv3.
    if_t100_dyn_msg~msgv4 = msgv4.
  ENDMETHOD.

  METHOD if_message~get_text.
    IF text IS NOT INITIAL OR msgid IS INITIAL.
      result = text.
      RETURN.
    ENDIF.
    result = zrap_eml=>message_text( id = msgid number = msgno v1 = msgv1 v2 = msgv2 v3 = msgv3 v4 = msgv4 ).
  ENDMETHOD.

  METHOD if_message~get_longtext.
    result = if_message~get_text( ).
  ENDMETHOD.
ENDCLASS.
`;

/** Base of the handler and saver classes: the messages of the RAP responses. */
const CL_ABAP_BEHV = `CLASS cl_abap_behv DEFINITION PUBLIC ABSTRACT.
  PUBLIC SECTION.
  PROTECTED SECTION.
    METHODS new_message
      IMPORTING id            TYPE csequence
                number        TYPE csequence
                severity      TYPE if_abap_behv_message=>t_severity
                v1            TYPE simple OPTIONAL
                v2            TYPE simple OPTIONAL
                v3            TYPE simple OPTIONAL
                v4            TYPE simple OPTIONAL
      RETURNING VALUE(obj)    TYPE REF TO if_abap_behv_message.
    METHODS new_message_with_text
      IMPORTING severity      TYPE if_abap_behv_message=>t_severity DEFAULT if_abap_behv_message=>severity-error
                text          TYPE csequence OPTIONAL
      RETURNING VALUE(obj)    TYPE REF TO if_abap_behv_message.
ENDCLASS.

CLASS cl_abap_behv IMPLEMENTATION.
  METHOD new_message.
    DATA t1 TYPE string.
    DATA t2 TYPE string.
    DATA t3 TYPE string.
    DATA t4 TYPE string.
    IF v1 IS SUPPLIED.
      t1 = |{ v1 }|.
    ENDIF.
    IF v2 IS SUPPLIED.
      t2 = |{ v2 }|.
    ENDIF.
    IF v3 IS SUPPLIED.
      t3 = |{ v3 }|.
    ENDIF.
    IF v4 IS SUPPLIED.
      t4 = |{ v4 }|.
    ENDIF.
    obj = NEW zrap_cl_message( severity = severity msgid = |{ id }| msgno = |{ number }| msgv1 = t1 msgv2 = t2 msgv3 = t3 msgv4 = t4 ).
  ENDMETHOD.

  METHOD new_message_with_text.
    obj = NEW zrap_cl_message( severity = severity text = |{ text }| ).
  ENDMETHOD.
ENDCLASS.
`;

const CL_ABAP_CONTEXT_INFO = `CLASS cl_abap_context_info DEFINITION PUBLIC FINAL CREATE PRIVATE.
  PUBLIC SECTION.
    CLASS-METHODS get_system_date RETURNING VALUE(rv_date) TYPE d.
    CLASS-METHODS get_system_time RETURNING VALUE(rv_time) TYPE t.
    CLASS-METHODS get_user_technical_name RETURNING VALUE(rv_name) TYPE string.
    CLASS-METHODS get_user_alias RETURNING VALUE(rv_alias) TYPE string.
    CLASS-METHODS get_user_formatted_name RETURNING VALUE(rv_name) TYPE string.
    CLASS-METHODS get_user_language_abap_format RETURNING VALUE(rv_language) TYPE string.
ENDCLASS.

CLASS cl_abap_context_info IMPLEMENTATION.
  METHOD get_system_date.
    rv_date = sy-datum.
  ENDMETHOD.

  METHOD get_system_time.
    rv_time = sy-uzeit.
  ENDMETHOD.

  METHOD get_user_technical_name.
    rv_name = sy-uname.
  ENDMETHOD.

  METHOD get_user_alias.
    rv_alias = sy-uname.
  ENDMETHOD.

  METHOD get_user_formatted_name.
    rv_name = sy-uname.
  ENDMETHOD.

  METHOD get_user_language_abap_format.
    rv_language = sy-langu.
  ENDMETHOD.
ENDCLASS.
`;

/** Base class of the handler classes (`lhc_…`). */
const CL_ABAP_BEHAVIOR_HANDLER = `CLASS cl_abap_behavior_handler DEFINITION PUBLIC ABSTRACT INHERITING FROM cl_abap_behv.
  PUBLIC SECTION.
ENDCLASS.

CLASS cl_abap_behavior_handler IMPLEMENTATION.
ENDCLASS.
`;

/**
 * Base classes of the saver of a managed BO with additional or unmanaged save. The saver methods
 * are declared by the rewrite pass with their parameters (save_modified), so the base classes
 * declare none.
 */
const CL_ABAP_BEHAVIOR_SAVER = `CLASS cl_abap_behavior_saver DEFINITION PUBLIC ABSTRACT INHERITING FROM cl_abap_behv.
  PUBLIC SECTION.
ENDCLASS.

CLASS cl_abap_behavior_saver IMPLEMENTATION.
ENDCLASS.
`;

const CL_ABAP_BEHAVIOR_SAVER_FAILED = `CLASS cl_abap_behavior_saver_failed DEFINITION PUBLIC ABSTRACT INHERITING FROM cl_abap_behavior_saver.
  PUBLIC SECTION.
ENDCLASS.

CLASS cl_abap_behavior_saver_failed IMPLEMENTATION.
ENDCLASS.
`;

/** The kernel entry; every method body is replaced at run time. */
const ZRAP_EML = `CLASS zrap_eml DEFINITION PUBLIC ABSTRACT FINAL.
  PUBLIC SECTION.
    CLASS-METHODS begin
      IMPORTING bdef       TYPE string
                local      TYPE abap_bool DEFAULT abap_false
                privileged TYPE abap_bool DEFAULT abap_false.
    CLASS-METHODS end
      CHANGING mapped   TYPE any OPTIONAL
               failed   TYPE any OPTIONAL
               reported TYPE any OPTIONAL.
    CLASS-METHODS read
      IMPORTING bdef   TYPE string
                entity TYPE string
                fields TYPE string OPTIONAL
                keys   TYPE ANY TABLE
      CHANGING  result TYPE ANY TABLE OPTIONAL.
    CLASS-METHODS read_by_association
      IMPORTING bdef        TYPE string
                entity      TYPE string
                association TYPE string
                fields      TYPE string OPTIONAL
                keys        TYPE ANY TABLE
      CHANGING  result      TYPE ANY TABLE OPTIONAL
                link        TYPE ANY TABLE OPTIONAL.
    CLASS-METHODS modify
      IMPORTING bdef          TYPE string
                entity        TYPE string
                operation     TYPE string
                fields        TYPE string OPTIONAL
                set_fields    TYPE abap_bool DEFAULT abap_false
                auto_fill_cid TYPE abap_bool DEFAULT abap_false
                rows          TYPE ANY TABLE.
    CLASS-METHODS create_by_association
      IMPORTING bdef          TYPE string
                entity        TYPE string
                association   TYPE string
                fields        TYPE string OPTIONAL
                set_fields    TYPE abap_bool DEFAULT abap_false
                auto_fill_cid TYPE abap_bool DEFAULT abap_false
                rows          TYPE ANY TABLE.
    CLASS-METHODS execute
      IMPORTING bdef          TYPE string
                entity        TYPE string
                action        TYPE string
                auto_fill_cid TYPE abap_bool DEFAULT abap_false
                rows          TYPE ANY TABLE
      CHANGING  result        TYPE ANY TABLE OPTIONAL.
    CLASS-METHODS commit
      IMPORTING simulation TYPE abap_bool DEFAULT abap_false.
    CLASS-METHODS commit_response
      IMPORTING bdef     TYPE string
      CHANGING  failed   TYPE any OPTIONAL
                reported TYPE any OPTIONAL.
    CLASS-METHODS rollback.
    CLASS-METHODS message_text
      IMPORTING id          TYPE string
                number      TYPE string
                v1          TYPE string OPTIONAL
                v2          TYPE string OPTIONAL
                v3          TYPE string OPTIONAL
                v4          TYPE string OPTIONAL
      RETURNING VALUE(text) TYPE string.
    "! Text of an exception object: its T100 message (if_t100_message), attributes resolved.
    CLASS-METHODS exception_text
      IMPORTING exception   TYPE REF TO object
      RETURNING VALUE(text) TYPE string.
    CLASS-METHODS uuid
      RETURNING VALUE(uuid) TYPE sysuuid_x16.
    "! INSERT|UPDATE|MODIFY|DELETE dbtab FROM [TABLE] @source MAPPING FROM ENTITY (saver only).
    CLASS-METHODS sql_write
      IMPORTING operation  TYPE string
                table      TYPE string
                rows       TYPE ANY TABLE OPTIONAL
                row        TYPE any OPTIONAL
                indicators TYPE abap_bool DEFAULT abap_false.
${HTTP_KERNEL_DEFINITIONS}ENDCLASS.

CLASS zrap_eml IMPLEMENTATION.
  METHOD begin.
  ENDMETHOD.

  METHOD end.
  ENDMETHOD.

  METHOD read.
  ENDMETHOD.

  METHOD read_by_association.
  ENDMETHOD.

  METHOD modify.
  ENDMETHOD.

  METHOD create_by_association.
  ENDMETHOD.

  METHOD execute.
  ENDMETHOD.

  METHOD commit.
  ENDMETHOD.

  METHOD commit_response.
  ENDMETHOD.

  METHOD rollback.
  ENDMETHOD.

  METHOD message_text.
    text = |{ id } { number }|.
  ENDMETHOD.

  METHOD exception_text.
  ENDMETHOD.

  METHOD uuid.
  ENDMETHOD.

  METHOD sql_write.
  ENDMETHOD.

${HTTP_KERNEL_IMPLEMENTATIONS}ENDCLASS.
`;

export const FRAMEWORK_SOURCES: FrameworkSource[] = [
  { fileName: "if_abap_behv.intf.abap", source: IF_ABAP_BEHV },
  { fileName: "if_message.intf.abap", source: IF_MESSAGE },
  { fileName: "if_t100_message.intf.abap", source: IF_T100_MESSAGE },
  { fileName: "if_t100_dyn_msg.intf.abap", source: IF_T100_DYN_MSG },
  { fileName: "if_abap_behv_message.intf.abap", source: IF_ABAP_BEHV_MESSAGE },
  { fileName: "cx_root.clas.abap", source: CX_ROOT },
  ...EXCEPTIONS.map(([name, superclass, abstract]) => ({ fileName: `${name}.clas.abap`, source: exceptionClass(name, superclass, abstract) })),
  { fileName: "cl_system_uuid.clas.abap", source: CL_SYSTEM_UUID },
  { fileName: "zrap_cl_message.clas.abap", source: ZRAP_CL_MESSAGE },
  { fileName: "cl_abap_behv.clas.abap", source: CL_ABAP_BEHV },
  { fileName: "cl_abap_behavior_handler.clas.abap", source: CL_ABAP_BEHAVIOR_HANDLER },
  { fileName: "cl_abap_behavior_saver.clas.abap", source: CL_ABAP_BEHAVIOR_SAVER },
  { fileName: "cl_abap_behavior_saver_failed.clas.abap", source: CL_ABAP_BEHAVIOR_SAVER_FAILED },
  { fileName: "cl_abap_context_info.clas.abap", source: CL_ABAP_CONTEXT_INFO },
  { fileName: "zrap_eml.clas.abap", source: ZRAP_EML },
  ...HTTP_FRAMEWORK_SOURCES,
];

/** Name of the ABAP class of the EML kernel entry. */
export const KERNEL_CLASS = "ZRAP_EML";
