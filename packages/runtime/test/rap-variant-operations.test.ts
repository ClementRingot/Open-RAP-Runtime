/**
 * A variant of the reference BO with the operations the fixture does not use: static action,
 * function with an abstract result, instance authorization, precheck, determination on save and
 * external numbering of the bookings (mandatory : create, readonly : update).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { B1, edit, generatedVariant, SERVICE, T1, T3, writableApp, type TestApp } from "./helpers.js";

const ABP = "zbp_rt_r_travel.clas.locals_imp.abap";
const NS = "com.sap.gateway.srvd.zrt_ui_travel.v0001";

const DURATION_DDLS = `@EndUserText.label: 'Duration of a travel'
define abstract entity ZRT_A_Duration
{
  Days : abap.int4;
}
`;

const DURATION_XML = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DDLS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DDLS>
    <DDLNAME>ZRT_A_DURATION</DDLNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <DDTEXT>Duration of a travel</DDTEXT>
    <SOURCE_TYPE>A</SOURCE_TYPE>
   </DDLS>
  </asx:values>
 </asx:abap>
</abapGit>
`;

const DEFINITIONS = `
    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR Travel RESULT result.

    METHODS precheck_update FOR PRECHECK
      IMPORTING entities FOR UPDATE Travel.

    METHODS createSample FOR MODIFY
      IMPORTING keys FOR ACTION Travel~createSample RESULT result.

    METHODS calculateDuration FOR READ
      IMPORTING keys FOR FUNCTION Travel~calculateDuration RESULT result.

    METHODS normalizeDescription FOR DETERMINE ON SAVE
      IMPORTING keys FOR Travel~normalizeDescription.
ENDCLASS.`;

const IMPLEMENTATIONS = `
  METHOD get_instance_authorizations.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( OverallStatus ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    result = VALUE #( FOR travel IN travels
                      ( %tky    = travel-%tky
                        %update = COND #( WHEN travel-OverallStatus = 'X'
                                          THEN if_abap_behv=>auth-unauthorized
                                          ELSE if_abap_behv=>auth-allowed ) ) ).
  ENDMETHOD.

  METHOD precheck_update.
    LOOP AT entities INTO DATA(entity) WHERE %control-Description = if_abap_behv=>mk-on.
      IF entity-Description CS 'forbidden'.
        APPEND VALUE #( %tky = entity-%tky ) TO failed-travel.
        APPEND VALUE #( %tky                 = entity-%tky
                        %msg                 = new_message_with_text( text = 'This description is not allowed' )
                        %element-Description = if_abap_behv=>mk-on ) TO reported-travel.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD createSample.
    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        CREATE FIELDS ( TravelID AgencyID CustomerID BeginDate EndDate BookingFee CurrencyCode Description )
        WITH VALUE #( FOR key IN keys
                      ( %cid         = key-%cid
                        TravelID     = '00009999'
                        AgencyID     = '070001'
                        CustomerID   = '000001'
                        BeginDate    = '20270101'
                        EndDate      = '20270108'
                        BookingFee   = '10.00'
                        CurrencyCode = 'EUR'
                        Description  = 'Sample travel' ) )
      MAPPED DATA(created).

    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        ALL FIELDS WITH CORRESPONDING #( created-travel )
      RESULT DATA(travels).

    result = VALUE #( FOR travel IN travels ( %cid = keys[ 1 ]-%cid %param = travel ) ).
    mapped-travel = created-travel.
  ENDMETHOD.

  METHOD calculateDuration.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( BeginDate EndDate ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    result = VALUE #( FOR travel IN travels ( %tky = travel-%tky %param-Days = travel-EndDate - travel-BeginDate ) ).
  ENDMETHOD.

  METHOD normalizeDescription.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( Description ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( Description )
        WITH VALUE #( FOR travel IN travels ( %tky = travel-%tky Description = to_upper( travel-Description ) ) ).
  ENDMETHOD.

ENDCLASS.

CLASS lhc_booking DEFINITION`;

let t: TestApp;

beforeAll(async () => {
  t = await writableApp(
    generatedVariant({
      "zrt_a_duration.ddls.asddls": DURATION_DDLS,
      "zrt_a_duration.ddls.xml": DURATION_XML,
      "zrt_r_travel.bdef.asbdef": (c) =>
        edit(c, [
          ["authorization master ( global )", "authorization master ( global, instance )"],
          ["  update;\n  delete;\n  association _Booking", "  update ( precheck );\n  delete;\n  association _Booking"],
          ["  factory action copyTravel [1];", "  factory action copyTravel [1];\n  static action createSample result [1] $self;\n  function calculateDuration result [1] ZRT_A_Duration;"],
          ["  validation validateDates on save", "  determination normalizeDescription on save { field Description; }\n  validation validateDates on save"],
          ["  field ( mandatory ) BookingID, CarrierID, ConnectionID, FlightDate;", "  field ( mandatory ) CarrierID, ConnectionID, FlightDate;\n  field ( mandatory : create, readonly : update ) BookingID;"],
        ]),
      "zrt_c_travel.bdef.asbdef": (c) => edit(c, [["  use action copyTravel;", "  use action copyTravel;\n  use action createSample;\n  use function calculateDuration;"]]),
      [ABP]: (c) => {
        const first = c.indexOf("ENDCLASS.");
        const withDefinitions = `${c.slice(0, first)}${DEFINITIONS.trimStart()}${c.slice(first + "ENDCLASS.".length)}`;
        return edit(withDefinitions, [["ENDCLASS.\n\nCLASS lhc_booking DEFINITION", IMPLEMENTATIONS.trimStart()]]);
      },
    }),
  );
}, 180_000);

afterAll(async () => {
  await t?.close();
});

const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8;IEEE754Compatible=true", accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true" };

async function call(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await t.app.inject({ method, url: `${SERVICE}${path}`, headers: { ...JSON_HEADERS, "if-match": "*" }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

describe("operations of a managed BO beyond the reference fixture", () => {
  it("checks the instance authorization of an update", async () => {
    expect((await call("PATCH", `Travel(${T3})`, { Description: "x" })).status).toBe(403);
  });

  it("runs the precheck before the update", async () => {
    const response = await call("PATCH", `Travel(${T1})`, { Description: "a forbidden word" });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { message: "This description is not allowed", target: "Description" } });
  });

  it("runs the determinations on save", async () => {
    const response = await call("PATCH", `Travel(${T1})`, { Description: "rome in june" });
    expect(response.status).toBe(200);
    expect(response.body["Description"]).toBe("ROME IN JUNE");
  });

  it("calls a static action returning the created instance", async () => {
    const response = await call("POST", `Travel/${NS}.createSample`, {});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ TravelID: "00009999", Description: "SAMPLE TRAVEL", OverallStatus: "O", TotalPrice: "10.00" });
  });

  it("calls a function with an abstract entity as result", async () => {
    const response = await call("GET", `Travel(${T1})/${NS}.calculateDuration()`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ Days: 14 });
  });

  it("checks external numbering: mandatory on create, read-only on update", async () => {
    const booking = { CarrierID: "LH", ConnectionID: "0401", FlightDate: "2026-06-10", FlightPrice: "10.00", CurrencyCode: "EUR" };
    const missing = await call("POST", `Travel(${T1})/_Booking`, booking);
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ error: { message: "BookingID is required" } });
    expect((await call("POST", `Travel(${T1})/_Booking`, { ...booking, BookingID: "0009" })).status).toBe(201);
    const update = await call("PATCH", `Booking(${B1})`, { BookingID: "0099", FlightPrice: "1.00" });
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ BookingID: "0001", FlightPrice: "1.00" });
  });
});
