/**
 * ABAP SQL in a behavior pool (decision D26): a variant of the reference BO that numbers its
 * travels on save with `SELECT MAX( … )` (the pattern of the RAP100 tutorial), checks the travel
 * ID is not used with an existence check and a T100 text (`MESSAGE … INTO`), and an action that
 * reads tables and CDS entities with the usual forms of SELECT.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { batchBody, edit, generatedVariant, SERVICE, T1, writableApp, type TestApp } from "./helpers.js";

const ABP = "zbp_rt_r_travel.clas.locals_imp.abap";
const NS = "com.sap.gateway.srvd.zrt_ui_travel.v0001";

const DEFINITIONS = `
    METHODS inspect FOR MODIFY
      IMPORTING keys FOR ACTION Travel~inspect RESULT result.

    METHODS setTravelId FOR DETERMINE ON SAVE
      IMPORTING keys FOR Travel~setTravelId.

    METHODS validateTravelId FOR VALIDATE ON SAVE
      IMPORTING keys FOR Travel~validateTravelId.
ENDCLASS.`;

const IMPLEMENTATIONS = `
  METHOD inspect.
    DATA begin_dates TYPE RANGE OF zrt_travel-begin_date.
    DATA count_2026 TYPE int8.
    TYPES: BEGIN OF ty_currency,
             currency_code TYPE zrt_booking-currency_code,
             bookings      TYPE int8,
           END OF ty_currency.
    DATA per_currency TYPE STANDARD TABLE OF ty_currency WITH EMPTY KEY.
    DATA travel_ids TYPE STANDARD TABLE OF zrt_travel-travel_id WITH EMPTY KEY.
    DATA with_bookings TYPE int8.
    DATA looped TYPE i.
    DATA ids TYPE string.

    begin_dates = VALUE #( ( sign = 'I' option = 'BT' low = '20260101' high = '20261231' ) ).
    SELECT COUNT(*) FROM zrt_travel WHERE begin_date IN @begin_dates INTO @count_2026.

    SELECT SINGLE FROM zrt_travel FIELDS MAX( booking_fee ) INTO @DATA(max_fee).

    SELECT FROM zrt_r_travel FIELDS TravelUUID, TravelID
      FOR ALL ENTRIES IN @keys WHERE TravelUUID = @keys-TravelUUID
      INTO TABLE @DATA(own).

    SELECT currency_code, COUNT(*) AS bookings FROM zrt_booking
      GROUP BY currency_code HAVING COUNT(*) > 1 ORDER BY currency_code
      INTO CORRESPONDING FIELDS OF TABLE @per_currency.
    DATA(currencies) = REDUCE string( INIT text = \`\` FOR c IN per_currency NEXT text = |{ text }{ c-currency_code }:{ c-bookings }| ).

    SELECT COUNT(*) FROM zrt_travel
      WHERE EXISTS ( SELECT booking_uuid FROM zrt_booking WHERE parent_uuid = zrt_travel~travel_uuid )
      INTO @with_bookings.

    SELECT travel_id FROM zrt_travel WHERE travel_id BETWEEN '00000001' AND '00000001' INTO TABLE @travel_ids.
    SELECT travel_id FROM zrt_travel WHERE description LIKE '%Berlin%' APPENDING TABLE @travel_ids.
    DATA(appended) = concat_lines_of( table = travel_ids sep = \`,\` ).

    LOOP AT keys INTO DATA(key).
      CLEAR: ids, looped.
      SELECT FROM zrt_r_booking FIELDS BookingID, FlightPrice, FlightDate
        WHERE TravelUUID = @key-TravelUUID AND FlightPrice GT 0
        ORDER BY FlightDate DESCENDING
        INTO TABLE @DATA(bookings) UP TO 2 ROWS.
      LOOP AT bookings INTO DATA(booking).
        ids = COND #( WHEN ids IS INITIAL THEN booking-BookingID ELSE |{ ids },{ booking-BookingID }| ).
      ENDLOOP.

      SELECT * FROM zrt_booking WHERE parent_uuid = @key-TravelUUID INTO @DATA(booking_row).
        IF booking_row-booking_id IS NOT INITIAL.
          looped = looped + 1.
        ENDIF.
      ENDSELECT.

      SELECT FROM zrt_r_travel AS t INNER JOIN zrt_r_booking AS b ON b~TravelUUID = t~TravelUUID
        FIELDS t~TravelID, b~BookingID
        WHERE t~TravelUUID = @key-TravelUUID
        INTO TABLE @DATA(joined).

      SELECT SINGLE created_at FROM zrt_travel WHERE travel_uuid = @key-TravelUUID INTO @DATA(created_at).
      SELECT SINGLE @abap_true FROM zrt_travel WHERE travel_id = '00000002' INTO @DATA(found).

      READ TABLE own INTO DATA(travel) WITH KEY TravelUUID = key-TravelUUID.
      MESSAGE e002(zrt_travel) WITH travel-TravelID INTO DATA(text).

      MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
        ENTITY Travel
          UPDATE FIELDS ( Description )
          WITH VALUE #( ( %tky        = key-%tky
                          Description = |{ count_2026 };{ max_fee };{ ids };{ looped };{ created_at };{ found };{ text };| &&
                                        |{ lines( joined ) };{ currencies };{ with_bookings };{ appended }| ) ).
    ENDLOOP.

    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(travels).
    result = VALUE #( FOR t IN travels ( %tky = t-%tky %param = t ) ).
  ENDMETHOD.

  METHOD setTravelId.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( TravelID ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    DELETE travels WHERE TravelID IS NOT INITIAL.
    CHECK travels IS NOT INITIAL.

    SELECT SINGLE FROM zrt_travel FIELDS MAX( travel_id ) INTO @DATA(max_travel_id).

    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        UPDATE FIELDS ( TravelID )
        WITH VALUE #( FOR travel IN travels INDEX INTO i
                      ( %tky     = travel-%tky
                        TravelID = max_travel_id + i ) ).
  ENDMETHOD.

  METHOD validateTravelId.
    READ ENTITIES OF zrt_r_travel IN LOCAL MODE
      ENTITY Travel
        FIELDS ( TravelID ) WITH CORRESPONDING #( keys )
      RESULT DATA(travels).

    LOOP AT travels INTO DATA(travel).
      SELECT SINGLE @abap_true FROM zrt_travel
        WHERE travel_id = @travel-TravelID AND travel_uuid <> @travel-TravelUUID
        INTO @DATA(used).
      IF used = abap_true.
        MESSAGE e003(zrt_travel) WITH travel-TravelID INTO DATA(text).
        APPEND VALUE #( %tky = travel-%tky ) TO failed-travel.
        APPEND VALUE #( %tky              = travel-%tky
                        %msg              = new_message_with_text( text = text )
                        %element-TravelID = if_abap_behv=>mk-on ) TO reported-travel.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.

CLASS lhc_booking DEFINITION`;

const MESSAGE_003 = `    <T100>
     <SPRSL>E</SPRSL>
     <ARBGB>ZRT_TRAVEL</ARBGB>
     <MSGNR>003</MSGNR>
     <TEXT>Travel ID &amp;1 is already used</TEXT>
    </T100>
   </T100>
  </asx:values>`;

let t: TestApp;

beforeAll(async () => {
  t = await writableApp(
    generatedVariant({
      "zrt_r_travel.bdef.asbdef": (c) =>
        edit(c, [
          ["  field ( mandatory ) TravelID, AgencyID,", "  field ( mandatory ) AgencyID,"],
          ["  internal action reCalcTotalPrice;", "  internal action reCalcTotalPrice;\n  action inspect result [1] $self;"],
          ["  validation validateDates on save { create; field BeginDate, EndDate; }", "  determination setTravelId on save { create; }\n  validation validateDates on save { create; field BeginDate, EndDate; }\n  validation validateTravelId on save { create; field TravelID; }"],
        ]),
      "zrt_c_travel.bdef.asbdef": (c) => edit(c, [["  use action copyTravel;", "  use action copyTravel;\n  use action inspect;"]]),
      "zrt_travel.msag.xml": (c) => edit(c, [["   </T100>\n  </asx:values>", MESSAGE_003]]),
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

const TRAVEL = { AgencyID: "070001", CustomerID: "000001", BeginDate: "2027-05-01", EndDate: "2027-05-08", BookingFee: "40.00", CurrencyCode: "EUR" };

describe("ABAP SQL in a behavior pool", () => {
  it("reads tables and CDS entities with the usual forms of SELECT", async () => {
    const response = await call("POST", `Travel(${T1})/${NS}.inspect`, {});
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(String(response.body["Description"]).split(";")).toEqual(["2", "20.00", "0002,0001", "3", "20260110080000.0000000", "X", "Travel 00000001 accepted", "3", "EUR:3", "2", "00000001,00000002"]);
  });

  it("numbers on save with SELECT MAX, also several creations of one change set", async () => {
    const created = await call("POST", "Travel", TRAVEL);
    expect(created.status).toBe(201);
    expect(created.body["TravelID"]).toBe("00000004");
    const boundary = "batch_sql";
    const body = batchBody(boundary, [
      { method: "POST", url: "Travel", body: { ...TRAVEL, Description: "first" }, contentId: "1" },
      { method: "POST", url: "Travel", body: { ...TRAVEL, Description: "second" }, contentId: "2" },
    ], true);
    const batch = await t.app.inject({ method: "POST", url: `${SERVICE}$batch`, headers: { "content-type": `multipart/mixed;boundary=${boundary}` }, payload: body });
    expect(batch.statusCode).toBe(200);
    const ids = [...batch.body.matchAll(/"TravelID":"(\d+)"/g)].map((m) => m[1]);
    expect(ids.sort()).toEqual(["00000005", "00000006"]);
  });

  it("rejects a travel ID in use with the T100 text of the message class", async () => {
    const response = await call("POST", "Travel", { ...TRAVEL, TravelID: "00000002" });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { message: "Travel ID 00000002 is already used", target: "TravelID" } });
    const update = await call("PATCH", `Travel(${T1})`, { TravelID: "00000003" });
    expect(update.status).toBe(400);
    expect(update.body).toMatchObject({ error: { message: "Travel ID 00000003 is already used" } });
  });

  it("reads the database, not the transactional buffer (as in RAP)", async () => {
    // both creations pass the check: the other one is not in the database yet
    const boundary = "batch_buffer";
    const body = batchBody(boundary, [
      { method: "POST", url: "Travel", body: { ...TRAVEL, TravelID: "00000777" }, contentId: "1" },
      { method: "POST", url: "Travel", body: { ...TRAVEL, TravelID: "00000777" }, contentId: "2" },
    ], true);
    const batch = await t.app.inject({ method: "POST", url: `${SERVICE}$batch`, headers: { "content-type": `multipart/mixed;boundary=${boundary}` }, payload: body });
    expect(batch.body.match(/HTTP\/1\.1 201/g)).toHaveLength(2);
    // once saved, the ID is in use
    expect((await call("POST", "Travel", { ...TRAVEL, TravelID: "00000777" })).status).toBe(400);
  });
});
