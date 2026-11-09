/**
 * A variant of the reference BO with what real behavior pools often contain: an exception class
 * for T100 messages (the /DMO/CM_FLIGHT_MESSAGES pattern), a refusing authorization handler,
 * cl_system_uuid, cl_abap_context_info and TRY … CATCH.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatedVariant, SERVICE, T2, writableApp, type TestApp } from "./helpers.js";

const ABP = "zbp_rt_r_travel.clas.locals_imp.abap";

const EXCEPTION_CLASS = `CLASS zcx_rt_travel DEFINITION PUBLIC INHERITING FROM cx_static_check FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_abap_behv_message.

    CONSTANTS:
      BEGIN OF agency_unknown,
        msgid TYPE symsgid VALUE 'ZRT_TRAVEL',
        msgno TYPE symsgno VALUE '003',
        attr1 TYPE scx_attrname VALUE 'AGENCY_ID',
        attr2 TYPE scx_attrname VALUE '',
        attr3 TYPE scx_attrname VALUE '',
        attr4 TYPE scx_attrname VALUE '',
      END OF agency_unknown.

    DATA agency_id TYPE n LENGTH 6 READ-ONLY.

    METHODS constructor
      IMPORTING textid    LIKE if_t100_message=>t100key OPTIONAL
                previous  LIKE previous OPTIONAL
                severity  TYPE if_abap_behv_message=>t_severity DEFAULT if_abap_behv_message=>severity-error
                agency_id TYPE n OPTIONAL.
ENDCLASS.

CLASS zcx_rt_travel IMPLEMENTATION.
  METHOD constructor ##ADT_SUPPRESS_GENERATION.
    super->constructor( previous = previous ).
    CLEAR me->textid.
    IF textid IS INITIAL.
      if_t100_message~t100key = if_t100_message=>default_textid.
    ELSE.
      if_t100_message~t100key = textid.
    ENDIF.
    if_abap_behv_message~m_severity = severity.
    me->agency_id = agency_id.
  ENDMETHOD.
ENDCLASS.
`;

const EXCEPTION_XML = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <VSEOCLASS>
    <CLSNAME>ZCX_RT_TRAVEL</CLSNAME>
    <LANGU>E</LANGU>
    <DESCRIPT>Messages of the Travel BO</DESCRIPT>
    <CATEGORY>40</CATEGORY>
    <STATE>1</STATE>
    <CLSCCINCL>X</CLSCCINCL>
    <FIXPT>X</FIXPT>
    <UNICODE>X</UNICODE>
   </VSEOCLASS>
  </asx:values>
 </asx:abap>
</abapGit>
`;

let t: TestApp;

beforeAll(async () => {
  t = await writableApp(
    generatedVariant({
      "zcx_rt_travel.clas.abap": EXCEPTION_CLASS,
      "zcx_rt_travel.clas.xml": EXCEPTION_XML,
      "zrt_travel.msag.xml": (c) =>
        c.replace(
          "   </T100>\n  </asx:values>",
          "    <T100>\n     <SPRSL>E</SPRSL>\n     <ARBGB>ZRT_TRAVEL</ARBGB>\n     <MSGNR>003</MSGNR>\n     <TEXT>Agency &amp;1 is unknown</TEXT>\n    </T100>\n   </T100>\n  </asx:values>",
        ),
      "zrt_r_travel.bdef.asbdef": (c) => c.replace("  validation validateDates on save { create; field BeginDate, EndDate; }", "  validation validateDates on save { create; field BeginDate, EndDate; }\n  validation validateAgency on save { create; field AgencyID; }"),
      [ABP]: (c) =>
        c
          .replace(
            "    METHODS validateDates FOR VALIDATE ON SAVE\n      IMPORTING keys FOR Travel~validateDates.",
            "    METHODS validateDates FOR VALIDATE ON SAVE\n      IMPORTING keys FOR Travel~validateDates.\n\n    METHODS validateAgency FOR VALIDATE ON SAVE\n      IMPORTING keys FOR Travel~validateAgency.",
          )
          .replace(
            "    IF requested_authorizations-%delete = if_abap_behv=>mk-on.\n      result-%delete = if_abap_behv=>auth-allowed.\n    ENDIF.",
            "    IF requested_authorizations-%delete = if_abap_behv=>mk-on.\n      result-%delete = if_abap_behv=>auth-unauthorized.\n    ENDIF.",
          )
          .replace(
            `  METHOD setStatusOpen.
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
  ENDMETHOD.`,
            `  METHOD setStatusOpen.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( OverallStatus Description ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    DELETE travels WHERE OverallStatus IS NOT INITIAL.
    CHECK travels IS NOT INITIAL.

    DATA marker TYPE sysuuid_c36.
    TRY.
        marker = cl_system_uuid=>create_uuid_c36_static( ).
      CATCH cx_uuid_error.
        CLEAR marker.
    ENDTRY.
    DATA(user) = cl_abap_context_info=>get_user_technical_name( ).

    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( OverallStatus Description )
        WITH VALUE #( FOR travel IN travels
                      ( %tky          = travel-%tky
                        OverallStatus = travel_status-open
                        Description   = COND #( WHEN travel-Description IS INITIAL
                                                THEN |Created by { user } ({ strlen( marker ) })|
                                                ELSE travel-Description ) ) ).
  ENDMETHOD.

  METHOD validateAgency.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( AgencyID ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    LOOP AT travels INTO DATA(travel) WHERE AgencyID = '999999'.
      APPEND VALUE #( %tky = travel-%tky ) TO failed-travel.
      APPEND VALUE #( %tky              = travel-%tky
                      %msg              = NEW zcx_rt_travel( textid    = zcx_rt_travel=>agency_unknown
                                                             agency_id = travel-AgencyID )
                      %element-AgencyID = if_abap_behv=>mk-on ) TO reported-travel.
    ENDLOOP.
  ENDMETHOD.`,
          ),
    }),
  );
}, 180_000);

afterAll(async () => {
  await t?.close();
});

const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8;IEEE754Compatible=true", accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true" };

const travel = { TravelID: "00000200", AgencyID: "070001", CustomerID: "000042", BeginDate: "2027-03-01", EndDate: "2027-03-10", BookingFee: "5.00", CurrencyCode: "EUR" };

async function post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await t.app.inject({ method: "POST", url: `${SERVICE}${path}`, headers: JSON_HEADERS, payload: JSON.stringify(body) });
  return { status: response.statusCode, body: JSON.parse(response.body) as Record<string, unknown> };
}

describe("behavior pool with an exception class, authorizations and system classes", () => {
  it("uses cl_system_uuid, cl_abap_context_info and TRY … CATCH in a determination", async () => {
    const response = await post("Travel", travel);
    expect(response.status).toBe(201);
    expect(response.body["Description"]).toBe("Created by DEVELOPER (36)");
  });

  it("reports the T100 message of an exception object, with its attribute", async () => {
    const response = await post("Travel", { ...travel, AgencyID: "999999" });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: "ZRT_TRAVEL/003", message: "Agency 999999 is unknown", target: "AgencyID" } });
  });

  it("refuses an operation the global authorization handler does not allow", async () => {
    const response = await t.app.inject({ method: "DELETE", url: `${SERVICE}Travel(${T2})`, headers: { ...JSON_HEADERS, "if-match": "*" } });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toMatchObject({ error: { message: `You are not authorized to perform the delete on Travel(${T2})` } });
  });
});
