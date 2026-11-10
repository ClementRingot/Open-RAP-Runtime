import * as abaplint from "@abaplint/core";
import { describe, expect, it } from "vitest";
import { Diagnostics, type Diagnostic } from "../src/diagnostics.js";
import { parseEml } from "../src/gen/abap/eml.js";
import { abapSources, generateAbap } from "../src/gen/abap/generate.js";
import { toks } from "../src/gen/abap/tokens.js";
import { loadProject } from "../src/input/project.js";
import { buildModel } from "../src/ir/builder.js";
import { FIXTURE_DIR, fixtureVariant, readFixture } from "./helpers.js";

const ABP = "zbp_rt_r_travel.clas.locals_imp.abap";
const I = "zrap_dt_zrt_r_travel";

function generate(changes: Parameters<typeof fixtureVariant>[0] = {}): Promise<{ diagnostics: Diagnostic[]; output: Awaited<ReturnType<typeof generateAbap>>; rewritten: string }> {
  const variant = Object.keys(changes).length === 0 ? undefined : fixtureVariant(changes);
  const project = loadProject(variant?.dir ?? FIXTURE_DIR);
  try {
    const { model, diagnostics } = buildModel(project);
    if (model === undefined) {
      throw new Error("no model");
    }
    const rewritten = abapSources(project, model, new Diagnostics()).find((s) => s.fileName === ABP)?.content ?? "";
    return generateAbap(project, model, diagnostics).then((output) => ({ diagnostics: diagnostics.items, output, rewritten }));
  } finally {
    variant?.cleanup();
  }
}

/** The tokens of one ABAP statement, without its final period. */
function statementTokens(statement: string): ReturnType<typeof toks> {
  const source = `CLASS lcl DEFINITION. PUBLIC SECTION. METHODS m. ENDCLASS.\nCLASS lcl IMPLEMENTATION.\n  METHOD m.\n    ${statement}\n  ENDMETHOD.\nENDCLASS.`;
  const registry = new abaplint.Registry().addFile(new abaplint.MemoryFile("zrapt_probe.prog.abap", source));
  registry.parse();
  const file = (registry.getFirstObject() as abaplint.ABAPObject).getABAPFiles()[0] as abaplint.ABAPFile;
  const found = file.getStatements().find((s) => s.getStart().getRow() === 4);
  return toks(found?.getTokens() ?? []).slice(0, -1);
}

describe("EML parser", () => {
  it("reads the long form with several entities, operations and responses", () => {
    const eml = parseEml(
      statementTokens(
        "READ ENTITIES OF zrt_r_travel IN LOCAL MODE ENTITY Travel ALL FIELDS WITH CORRESPONDING #( keys ) RESULT DATA(travels) BY \\_Booking FIELDS ( BookingID ) WITH VALUE #( ( %tky = x ) ) RESULT DATA(bookings) LINK DATA(links) ENTITY Booking FROM lt_keys RESULT lt_result FAILED DATA(failed_read) REPORTED reported.",
      ),
    );
    expect(eml.kind).toBe("read");
    if (eml.kind !== "read") return;
    expect(eml.mode).toBe("local");
    expect(eml.bdef?.str).toBe("zrt_r_travel");
    expect(eml.groups.map((g) => [g.entity.str, g.operations.map((o) => o.kind)])).toEqual([
      ["Travel", ["read", "readBy"]],
      ["Booking", ["read"]],
    ]);
    expect(eml.failed?.tokens.map((t) => t.str).join("")).toBe("DATA(failed_read)");
    expect(eml.reported?.tokens.map((t) => t.str)).toEqual(["reported"]);
  });

  it("reads forms abaplint does not parse", () => {
    const eml = parseEml(statementTokens("MODIFY ENTITIES OF zrt_r_travel ENTITY Travel CREATE AUTO FILL CID SET FIELDS WITH VALUE #( ( TravelID = '1' ) ) CREATE BY \\_Booking SET FIELDS WITH lt_bookings MAPPED DATA(m)."));
    expect(eml.kind).toBe("modify");
    if (eml.kind !== "modify") return;
    expect(eml.groups[0]?.operations).toMatchObject([
      { kind: "create", autoFillCid: true, fields: { kind: "set" } },
      { kind: "createBy", autoFillCid: false, fields: { kind: "set" } },
    ]);
    expect(eml.mapped).toBeDefined();
  });

  it("reads the short forms, COMMIT and ROLLBACK", () => {
    const short = parseEml(statementTokens("MODIFY ENTITY IN LOCAL MODE zrt_r_travel UPDATE FIELDS ( Description ) WITH lt_update FAILED DATA(f)."));
    expect(short).toMatchObject({ kind: "modify", mode: "local", groups: [{ operations: [{ kind: "update", fields: { kind: "list" } }] }] });
    expect(parseEml(statementTokens("COMMIT ENTITIES RESPONSE OF zrt_r_travel FAILED DATA(cf) REPORTED DATA(cr)."))).toMatchObject({ kind: "commit", simulation: false, responses: [{ bdef: { str: "zrt_r_travel" } }] });
    expect(parseEml(statementTokens("ROLLBACK ENTITIES."))).toEqual({ kind: "rollback" });
  });

  it("keeps a component that looks like a keyword inside an operand", () => {
    const eml = parseEml(statementTokens("READ ENTITIES OF zrt_r_travel ENTITY Travel FROM ls_data-result RESULT DATA(r)."));
    if (eml.kind !== "read") throw new Error("read expected");
    const operation = eml.groups[0]?.operations[0];
    expect(operation?.kind === "read" ? operation.source.tokens.map((t) => t.str).join("") : "").toBe("ls_data-result");
  });

  it("rejects the dynamic form", () => {
    expect(() => parseEml(statementTokens("MODIFY ENTITIES OPERATIONS lt_operations FAILED DATA(f)."))).toThrow(/OPERATIONS/);
  });
});

describe("ABAP generation of the fixture", () => {
  it("rewrites, checks and transpiles the behavior pool", async () => {
    const { diagnostics, output } = await generate();
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(output?.entry).toBe("init.mjs");
    const paths = output?.modules.map((m) => m.path) ?? [];
    expect(paths).toEqual(expect.arrayContaining(["init.mjs", "zbp_rt_r_travel.clas.mjs", "zbp_rt_r_travel.clas.locals.mjs", `${I}.intf.mjs`, "zrap_eml.clas.mjs"]));
    const locals = output?.modules.find((m) => m.path === "zbp_rt_r_travel.clas.locals.mjs")?.content ?? "";
    expect(locals).toContain("abap.Classes['ZRAP_EML'].read_by_association(");
    expect(locals).toContain('abap.Classes[\'CLAS-ZBP_RT_R_TRAVEL-LHC_TRAVEL\']');
  });

  it("keeps the line numbers of the original sources", async () => {
    const { rewritten } = await generate();
    expect(rewritten.split("\n").length).toBe(readFixture(ABP).split("\n").length);
  });

  it("types the handler definitions with the derived types", async () => {
    const { rewritten } = await generate();
    expect(rewritten).toContain(`METHODS validateDates IMPORTING keys TYPE ${I}=>tt_e1_keys CHANGING failed TYPE ${I}=>ts_failed_late reported TYPE ${I}=>ts_reported_late`);
    expect(rewritten).toContain(`METHODS acceptTravel IMPORTING keys TYPE ${I}=>tt_e1_a1_imp CHANGING result TYPE ${I}=>tt_e1_a1_res mapped TYPE ${I}=>ts_mapped_early`);
    expect(rewritten).toContain(`METHODS get_global_authorizations IMPORTING requested_authorizations TYPE ${I}=>ts_e1_gauth_req CHANGING result TYPE ${I}=>ts_e1_gauth_res`);
    expect(rewritten).toContain(`METHODS calculateTotalPrice IMPORTING keys TYPE ${I}=>tt_e2_keys`);
  });

  it("lowers EML to the kernel, with explicit types and hoisted declarations", async () => {
    const { rewritten } = await generate();
    expect(rewritten).toContain(
      `DATA bookings TYPE ${I}=>tt_e1_b1_rres. zrap_eml=>begin( bdef = \`ZRT_R_TRAVEL\` local = abap_true ). zrap_eml=>read_by_association( EXPORTING bdef = \`ZRT_R_TRAVEL\` entity = \`ZRT_R_TRAVEL\` association = \`_BOOKING\` fields = \`TRAVELUUID FLIGHTPRICE CURRENCYCODE\` keys = CORRESPONDING ${I}=>tt_e1_b1_rimp( travels ) CHANGING result = bookings ). zrap_eml=>end( ).`,
    );
    expect(rewritten).toContain(`zrap_eml=>execute( bdef = \`ZRT_R_TRAVEL\` entity = \`ZRT_R_TRAVEL\` action = \`RECALCTOTALPRICE\` rows = CORRESPONDING ${I}=>tt_e1_a4_imp( keys ) ).`);
    expect(rewritten).toContain("zrap_eml=>end( CHANGING failed = failed ).");
  });

  it("accepts EML forms abaplint does not parse", async () => {
    const { diagnostics } = await generate({
      [ABP]: (c) =>
        c.replace(
          "    READ ENTITIES OF zrt_r_travel IN LOCAL MODE\n      ENTITY Travel\n        ALL FIELDS WITH CORRESPONDING #( keys )\n      RESULT DATA(travels).",
          "    MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE\n      ENTITY Travel\n        CREATE BY \\_Booking AUTO FILL CID SET FIELDS WITH VALUE #( FOR k IN keys ( %tky = k-%tky %target = VALUE #( ( BookingID = '0001' ) ) ) )\n      MAPPED DATA(created).\n    READ ENTITIES OF zrt_r_travel IN LOCAL MODE\n      ENTITY Travel\n        ALL FIELDS WITH CORRESPONDING #( keys )\n      RESULT DATA(travels).",
        ),
    });
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("reports unknown EML names on the original position", async () => {
    const { diagnostics } = await generate({ [ABP]: (c) => c.replace("FIELDS ( BeginDate EndDate )", "FIELDS ( BeginDate EndDat )") });
    const line = readFixture(ABP).split("\n").findIndex((l) => l.includes("FIELDS ( BeginDate EndDate )")) + 1;
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "ABP006", message: "Travel has no field EndDat", file: `src/${ABP}`, line }));
  });

  it("reports typing errors of the rewritten code on the original line", async () => {
    const { diagnostics } = await generate({ [ABP]: (c) => c.replace("%element-EndDate = if_abap_behv=>mk-on ) TO reported-travel.\n      ENDIF.", "%element-EndDat = if_abap_behv=>mk-on ) TO reported-travel.\n      ENDIF.") });
    const error = diagnostics.find((d) => d.code === "ABP004");
    expect(error).toMatchObject({ file: `src/${ABP}` });
    expect(readFixture(ABP).split("\n")[(error?.line ?? 0) - 1]).toContain("%element-EndDate");
  });

  it("reports EML on a projection and unsupported statements", async () => {
    const projection = await generate({ [ABP]: (c) => c.replace("MODIFY ENTITIES OF zrt_r_travel IN LOCAL MODE\n      ENTITY Travel\n        EXECUTE reCalcTotalPrice\n        FROM CORRESPONDING #( keys ).", "MODIFY ENTITIES OF zrt_c_travel\n      ENTITY Travel\n        EXECUTE acceptTravel\n        FROM CORRESPONDING #( keys ).") });
    expect(projection.diagnostics).toContainEqual(expect.objectContaining({ code: "ABP007", message: expect.stringContaining("projection ZRT_C_TRAVEL") }));
    const permissions = await generate({ [ABP]: (c) => c.replace("    DELETE travels WHERE OverallStatus IS NOT INITIAL.", "    GET PERMISSIONS ONLY GLOBAL AUTHORIZATION ENTITY zrt_r_travel REQUEST VALUE #( %update = if_abap_behv=>mk-on ) RESULT DATA(p).\n    DELETE travels WHERE OverallStatus IS NOT INITIAL.") });
    expect(permissions.diagnostics).toContainEqual(expect.objectContaining({ code: "ABP007", message: "GET PERMISSIONS is not supported" }));
    const write = await generate({ [ABP]: (c) => c.replace("    DELETE travels WHERE OverallStatus IS NOT INITIAL.", "    UPDATE zrt_travel SET description = 'x' WHERE travel_id = '1'.\n    DELETE travels WHERE OverallStatus IS NOT INITIAL.") });
    expect(write.diagnostics).toContainEqual(expect.objectContaining({ code: "ABP007", message: expect.stringContaining("UPDATE on a database table is only possible in the saver class") }));
    const loop = await generate({ [ABP]: (c) => c.replace("    DELETE travels WHERE OverallStatus IS NOT INITIAL.", "    SELECT travel_id FROM zrt_travel INTO @DATA(one_id).\n    ENDSELECT.\n    DELETE travels WHERE OverallStatus IS NOT INITIAL.") });
    expect(loop.diagnostics).toContainEqual(expect.objectContaining({ code: "ABP007", message: expect.stringContaining("SELECT … ENDSELECT with a field list") }));
  });

  it("accepts ABAP SQL reads of the tables and CDS entities of the project (D26)", async () => {
    const reads = [
      "    SELECT SINGLE travel_id FROM zrt_travel WHERE travel_uuid = @( VALUE sysuuid_x16( ) ) INTO @DATA(first_id).",
      "    SELECT FROM zrt_r_booking FIELDS BookingID, FlightPrice WHERE TravelUUID IS NOT NULL ORDER BY BookingID INTO TABLE @DATA(bookings_db).",
      "    DATA count_db TYPE int8.",
      "    SELECT COUNT(*) FROM zrt_c_travel INTO @count_db.",
      "    DATA ls_travel TYPE zrt_r_travel.",
      "    SELECT SINGLE @abap_true FROM zrt_travel WHERE travel_id = '00000001' INTO @DATA(exists).",
      "    SELECT SINGLE FROM zrt_travel AS t FIELDS MAX( t~travel_id ) AS max_id INTO @FINAL(max_id).",
      "    SELECT MIN( BeginDate ) FROM zrt_r_travel INTO @DATA(first_date).",
      "    IF exists = abap_true AND max_id > first_date. ENDIF.",
      "    SELECT FROM zrt_r_travel AS t INNER JOIN zrt_r_booking AS b ON b~TravelUUID = t~TravelUUID FIELDS t~TravelID, b~BookingID",
      "      FOR ALL ENTRIES IN @keys WHERE t~TravelUUID = @keys-TravelUUID AND b~BookingID <> @ls_travel-TravelID INTO TABLE @DATA(joined).",
    ].join("\n");
    const { diagnostics, rewritten } = await generate({ [ABP]: (c) => c.replace("    DELETE travels WHERE OverallStatus IS NOT INITIAL.", `${reads}\n    DELETE travels WHERE OverallStatus IS NOT INITIAL.`) });
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // the targets abaplint does not type are declared, host components after an alias are expressions
    expect(rewritten).toContain("DATA exists TYPE abap_boolean. SELECT SINGLE @abap_true FROM zrt_travel WHERE travel_id = '00000001' INTO @exists.");
    expect(rewritten).toContain("DATA max_id TYPE zrt_travel-travel_id. SELECT SINGLE FROM zrt_travel AS t FIELDS MAX( t~travel_id ) AS max_id INTO @max_id.");
    expect(rewritten).toContain("WHERE t~TravelUUID = @keys-TravelUUID AND b~BookingID <> @( ls_travel-TravelID ) INTO TABLE @DATA(joined).");
  });

  it("types the saver of an additional or unmanaged save and allows its ABAP SQL writes", async () => {
    const saver = [
      "CLASS lsc_zrt_r_travel DEFINITION INHERITING FROM cl_abap_behavior_saver.",
      "  PROTECTED SECTION.",
      "    METHODS save_modified REDEFINITION.",
      "    METHODS cleanup REDEFINITION.",
      "ENDCLASS.",
      "CLASS lsc_zrt_r_travel IMPLEMENTATION.",
      "  METHOD save_modified.",
      "    INSERT zrt_travel FROM TABLE @create-travel MAPPING FROM ENTITY.",
      "    UPDATE zrt_travel FROM TABLE @update-travel INDICATORS SET STRUCTURE %control MAPPING FROM ENTITY.",
      "    DELETE zrt_booking FROM TABLE @delete-booking MAPPING FROM ENTITY.",
      "    DATA ls_travel TYPE zrt_travel.",
      "    UPDATE zrt_travel SET description = @ls_travel-description WHERE travel_uuid = @ls_travel-travel_uuid.",
      "    APPEND new_message_with_text( text = 'saved' ) TO reported-%other.",
      "  ENDMETHOD.",
      "  METHOD cleanup.",
      "  ENDMETHOD.",
      "ENDCLASS.",
    ].join("\n");
    const additional = (c: string): string => c.replace("managed implementation in class", "managed with additional save implementation in class");
    const { diagnostics, rewritten } = await generate({ "zrt_r_travel.bdef.asbdef": additional, [ABP]: (c) => `${c}\n${saver}\n` });
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(rewritten).toContain("METHODS save_modified IMPORTING create TYPE zrap_dt_zrt_r_travel=>ts_request_change update TYPE zrap_dt_zrt_r_travel=>ts_request_change delete TYPE zrap_dt_zrt_r_travel=>ts_request_delete CHANGING reported TYPE zrap_dt_zrt_r_travel=>ts_reported_late.");
    expect(rewritten).toContain("zrap_eml=>sql_write( operation = `UPDATE` table = `ZRT_TRAVEL` rows = update-travel indicators = abap_true ).");
    // no saver, a saver without save option, DELETE … FROM @wa
    const missing = await generate({ "zrt_r_travel.bdef.asbdef": additional });
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({ code: "ABP002", message: expect.stringContaining("needs a saver class") }));
    const unused = await generate({ [ABP]: (c) => `${c}\n${saver}\n` });
    expect(unused.diagnostics).toContainEqual(expect.objectContaining({ code: "ABP003", message: expect.stringContaining("is not called") }));
    const wa = await generate({ "zrt_r_travel.bdef.asbdef": additional, [ABP]: (c) => `${c}\n${saver.replace("    DATA ls_travel TYPE zrt_travel.", "    DATA ls_travel TYPE zrt_travel.\n    DELETE zrt_travel FROM @ls_travel.")}\n` });
    expect(wa.diagnostics).toContainEqual(expect.objectContaining({ code: "ABP007", message: expect.stringContaining("DELETE dbtab FROM @wa") }));
  });

  it("reports SELECT results that abaplint cannot type and unknown tables", async () => {
    const line = readFixture(ABP).split("\n").findIndex((l) => l === "    DELETE travels WHERE OverallStatus IS NOT INITIAL.") + 1;
    const untyped = await generate({ [ABP]: (c) => c.replace("    DELETE travels WHERE OverallStatus IS NOT INITIAL.", "    SELECT SINGLE FROM zrt_travel FIELDS SUM( booking_fee ) INTO @DATA(fees). DELETE travels WHERE OverallStatus IS NOT INITIAL.") });
    expect(untyped.diagnostics).toContainEqual(expect.objectContaining({ code: "ABP009", message: expect.stringContaining("inline declaration fees"), file: `src/${ABP}`, line }));
    const unknown = await generate({ [ABP]: (c) => c.replace("    DELETE travels WHERE OverallStatus IS NOT INITIAL.", "    SELECT SINGLE carrier_id FROM zrt_carrier INTO @DATA(carrier). DELETE travels WHERE OverallStatus IS NOT INITIAL.") });
    expect(unknown.diagnostics).toContainEqual(expect.objectContaining({ code: "ABP004", file: `src/${ABP}`, line }));
  });
});
