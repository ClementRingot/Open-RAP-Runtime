import { describe, expect, it } from "vitest";
import { parseSrvd } from "../src/srvd/parser.js";
import { readFixture } from "./helpers.js";

describe("SRVD parser", () => {
  it("parses the service definition of the fixture", () => {
    const { ast, errors } = parseSrvd(readFixture("zrt_ui_travel.srvd.srvdsrv"));
    expect(errors).toEqual([]);
    expect(ast?.name).toBe("ZRT_UI_TRAVEL");
    expect(ast?.annotations).toEqual({ endusertext: { label: "Travel service" } });
    expect(ast?.exposes.map((e) => [e.entity, e.alias])).toEqual([
      ["ZRT_C_Travel", "Travel"],
      ["ZRT_C_Booking", "Booking"],
    ]);
  });

  it("parses annotations, namespaces, exposes without alias and provider contracts", () => {
    const source = `@EndUserText.label: 'It''s a service'
@ObjectModel.leadingEntity.name: '/DMO/C_Travel'
@Some.object: { a: 1, b: [ #X, true ], c.d: 'e' }
define service /DMO/UI_TRAVEL provider contracts odata_v4_ui {
  @Some.flag
  expose /DMO/C_Travel as Travel;
  expose /DMO/I_Agency;
}`;
    const { ast, errors } = parseSrvd(source);
    expect(errors).toEqual([]);
    expect(ast?.name).toBe("/DMO/UI_TRAVEL");
    expect(ast?.annotations).toEqual({
      endusertext: { label: "It's a service" },
      objectmodel: { leadingentity: { name: "/DMO/C_Travel" } },
      some: { object: { a: 1, b: ["#X", true], c: { d: "e" } } },
    });
    expect(ast?.exposes).toMatchObject([
      { entity: "/DMO/C_Travel", alias: "Travel", annotations: { some: { flag: true } } },
      { entity: "/DMO/I_Agency" },
    ]);
    expect(ast?.exposes[1]?.alias).toBeUndefined();
  });

  it("reports errors with positions", () => {
    expect(parseSrvd("define service Z {\n  expose ;\n}").errors[0]).toMatchObject({ line: 2, column: 10 });
    expect(parseSrvd("define view Z {\n  expose X;\n}").errors[0]?.message).toContain("define service");
  });
});
