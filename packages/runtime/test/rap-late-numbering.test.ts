/**
 * Late numbering (D109): a managed BO (order, items) whose keys are given by adjust_numbers of the
 * saver class in the late save phase. The instances have preliminary keys until then; the OData
 * responses, the Location header and a changeset (content IDs) end with the final keys.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { batchBody, generatedVariant, SERVICE, writableApp, type TestApp } from "./helpers.js";

const lf = (content: string): string => content.replace(/\r\n/g, "\n");

const tableEntity = (name: string, label: string, fields: string): string => `@ClientHandling.type: #CLIENT_DEPENDENT
@AbapCatalog.deliveryClass: #APPLICATION_DATA
@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: '${label}'
define table entity ${name}
{
${fields}
}
`;

const ORDER = `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Order (late numbering)'
define root view entity ZRT_R_LOrder
  as select from ZRT_LORD
  composition [0..*] of ZRT_R_LItem as _Item
{
  key OrderNo,
      Description,
      _Item
}
`;

const ITEM = `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Item (late numbering)'
define view entity ZRT_R_LItem
  as select from ZRT_LITEM
  association to parent ZRT_R_LOrder as _Order on $projection.OrderNo = _Order.OrderNo
{
  key OrderNo,
  key ItemNo,
      Product,
      _Order
}
`;

const BDEF = `managed implementation in class zbp_rt_lorder unique;
strict ( 2 );

define behavior for ZRT_R_LOrder alias LOrder
persistent table zrt_lord
late numbering
lock master
authorization master ( global )
{
  create;
  update;
  delete;
  field ( readonly ) OrderNo;
  association _Item { create; }
}

define behavior for ZRT_R_LItem alias LItem
persistent table zrt_litem
late numbering
lock dependent by _Order
authorization dependent by _Order
{
  update;
  delete;
  field ( readonly ) OrderNo, ItemNo;
  association _Order;
}
`;

const POOL = `"! <p class="shorttext synchronized">Behavior pool of ZRT_R_LORDER</p>
CLASS zbp_rt_lorder DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zrt_r_lorder.
ENDCLASS.



CLASS zbp_rt_lorder IMPLEMENTATION.
ENDCLASS.
`;

const POOL_XML = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <VSEOCLASS>
    <CLSNAME>ZBP_RT_LORDER</CLSNAME>
    <LANGU>E</LANGU>
    <DESCRIPT>Behavior pool of ZRT_R_LORDER</DESCRIPT>
    <STATE>1</STATE>
    <CLSCCINCL>X</CLSCCINCL>
    <FIXPT>X</FIXPT>
    <UNICODE>X</UNICODE>
    <ABSTRACT>X</ABSTRACT>
   </VSEOCLASS>
  </asx:values>
 </asx:abap>
</abapGit>
`;

const LOCALS = `CLASS lhc_lorder DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR LOrder RESULT result.
ENDCLASS.

CLASS lhc_lorder IMPLEMENTATION.
  METHOD get_global_authorizations.
    result-%create = if_abap_behv=>auth-allowed.
    result-%update = if_abap_behv=>auth-allowed.
    result-%delete = if_abap_behv=>auth-allowed.
  ENDMETHOD.
ENDCLASS.

CLASS lsc_zrt_r_lorder DEFINITION INHERITING FROM cl_abap_behavior_saver.
  PROTECTED SECTION.
    METHODS adjust_numbers REDEFINITION.
ENDCLASS.

CLASS lsc_zrt_r_lorder IMPLEMENTATION.
  METHOD adjust_numbers.
    " the orders: the next numbers after the highest one
    SELECT MAX( orderno ) FROM zrt_lord INTO @DATA(last_order).
    DATA next_order TYPE n LENGTH 8.
    next_order = last_order.
    LOOP AT mapped-lorder ASSIGNING FIELD-SYMBOL(<order>).
      next_order = next_order + 1.
      <order>-OrderNo = next_order.
    ENDLOOP.
    " the items: the final number of their order (new or not), then the next item numbers
    SELECT MAX( itemno ) FROM zrt_litem INTO @DATA(last_item).
    DATA next_item TYPE n LENGTH 4.
    next_item = last_item.
    LOOP AT mapped-litem ASSIGNING FIELD-SYMBOL(<item>).
      <item>-OrderNo = <item>-%tmp-OrderNo.
      LOOP AT mapped-lorder ASSIGNING <order> WHERE %tmp-OrderNo = <item>-%tmp-OrderNo.
        <item>-OrderNo = <order>-OrderNo.
      ENDLOOP.
      next_item = next_item + 1.
      <item>-ItemNo = next_item.
    ENDLOOP.
  ENDMETHOD.
ENDCLASS.
`;

let test: TestApp;
const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };

beforeAll(async () => {
  test = await writableApp(
    generatedVariant({
      "zrt_lord.ddls.asddls": tableEntity("ZRT_LORD", "Orders", "  key OrderNo     : abap.numc(8);\n      Description : abap.char(40);"),
      "zrt_litem.ddls.asddls": tableEntity("ZRT_LITEM", "Items", "  key OrderNo : abap.numc(8);\n  key ItemNo  : abap.numc(4);\n      Product : abap.char(20);"),
      "zrt_r_lorder.ddls.asddls": ORDER,
      "zrt_r_litem.ddls.asddls": ITEM,
      "zrt_r_lorder.bdef.asbdef": BDEF,
      "zbp_rt_lorder.clas.abap": POOL,
      "zbp_rt_lorder.clas.xml": POOL_XML,
      "zbp_rt_lorder.clas.locals_imp.abap": LOCALS,
      "zrt_ui_travel.srvd.srvdsrv": (c) => lf(c).replace("  expose ZRT_C_Booking as Booking;", "  expose ZRT_C_Booking as Booking;\n  expose ZRT_R_LOrder as LOrder;\n  expose ZRT_R_LItem as LItem;"),
    }),
  );
}, 180_000);

afterAll(async () => {
  await test?.close();
});

async function request(method: string, path: string, payload?: unknown): Promise<{ status: number; headers: Record<string, unknown>; body: Record<string, unknown> }> {
  const response = await test.app.inject({ method: method as "GET", url: `${SERVICE}${path}`, headers: JSON_HEADERS, ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }) });
  return { status: response.statusCode, headers: response.headers, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

describe("late numbering (D109)", () => {
  it("gives the final keys of adjust_numbers to a deep create, in the response and the Location", async () => {
    const created = await request("POST", "LOrder", { Description: "First", _Item: [{ Product: "P1" }, { Product: "P2" }] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ OrderNo: "00000001", Description: "First" });
    expect(String(created.headers["location"])).toMatch(/LOrder\('00000001'\)$/);
    const items = await request("GET", "LOrder('00000001')/_Item?$orderby=ItemNo");
    expect((items.body["value"] as Array<Record<string, unknown>>).map((i) => [i["OrderNo"], i["ItemNo"], i["Product"]])).toEqual([
      ["00000001", "0001", "P1"],
      ["00000001", "0002", "P2"],
    ]);
    const second = await request("POST", "LOrder", { Description: "Second" });
    expect(second.body).toMatchObject({ OrderNo: "00000002" });
    // a new item of an existing order keeps the number of its order
    const item = await request("POST", "LOrder('00000001')/_Item", { Product: "P3" });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    expect(item.body).toMatchObject({ OrderNo: "00000001", ItemNo: "0003", Product: "P3" });
    const rows = await test.pglite.query<{ orderno: string }>("SELECT orderno FROM zrt_lord ORDER BY orderno");
    expect(rows.rows.map((r) => r.orderno)).toEqual(["00000001", "00000002"]);
  });

  it("numbers the instances of a changeset, which refer to each other by content ID before", async () => {
    const boundary = "batch_late";
    const body = batchBody(
      boundary,
      [
        { method: "POST", url: "LOrder", body: { Description: "Batch" }, contentId: "1" },
        { method: "POST", url: "$1/_Item", body: { Product: "B1" }, contentId: "2" },
      ],
      true,
    );
    const response = await test.app.inject({ method: "POST", url: `${SERVICE}$batch`, headers: { "content-type": `multipart/mixed;boundary=${boundary}` }, payload: body });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).toContain('"OrderNo":"00000003"');
    expect(response.body).toMatch(/Location: .*LOrder\('00000003'\)/);
    expect(response.body).toContain('"ItemNo":"0004"');
    const items = await request("GET", "LOrder('00000003')/_Item");
    expect((items.body["value"] as Array<Record<string, unknown>>).map((i) => i["Product"])).toEqual(["B1"]);
  });
});
