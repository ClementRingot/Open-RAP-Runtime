import { describe, expect, it } from "vitest";
import { parseExpand, parseFilter, parseKeyPredicate, parseOrderby, parseQueryString, parseResourcePath, parseSelect } from "../src/odata/uri/parser.js";

describe("$filter grammar", () => {
  it("respects precedence: not > comparison > and > or", () => {
    expect(parseFilter("A eq 1 or B eq 2 and not C eq 3")).toEqual({
      kind: "binary",
      op: "or",
      left: { kind: "binary", op: "eq", left: { kind: "member", path: ["A"] }, right: { kind: "literal", literal: { type: "int", value: "1" } } },
      right: {
        kind: "binary",
        op: "and",
        left: { kind: "binary", op: "eq", left: { kind: "member", path: ["B"] }, right: { kind: "literal", literal: { type: "int", value: "2" } } },
        right: { kind: "not", operand: { kind: "binary", op: "eq", left: { kind: "member", path: ["C"] }, right: { kind: "literal", literal: { type: "int", value: "3" } } } },
      },
    });
  });

  it.each([
    ["'O''Neil'", { type: "string", value: "O'Neil" }],
    ["2026-01-31", { type: "date", value: "2026-01-31" }],
    ["2026-01-31T10:00:00.1234567Z", { type: "datetime", value: "2026-01-31T10:00:00.1234567Z" }],
    ["2026-01-31T10:00:00+02:00", { type: "datetime", value: "2026-01-31T10:00:00+02:00" }],
    ["3f2504e0-4f89-11d3-9a0c-0305e82c3301", { type: "guid", value: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" }],
    ["12:30:00", { type: "time", value: "12:30:00" }],
    ["-12.5", { type: "decimal", value: "-12.5" }],
    ["42", { type: "int", value: "42" }],
    ["true", { type: "bool", value: true }],
    ["null", { type: "null", value: null }],
  ])("literal %s", (text, literal) => {
    expect(parseFilter(`X eq ${text}`)).toMatchObject({ right: { kind: "literal", literal } });
  });

  it("parses functions, in and navigation paths", () => {
    expect(parseFilter("contains(Description,'a') and _Travel/Status in ('A','B')")).toMatchObject({
      op: "and",
      left: { kind: "call", name: "contains", args: [{ kind: "member", path: ["Description"] }, { kind: "literal" }] },
      right: { kind: "in", operand: { kind: "member", path: ["_Travel", "Status"] }, list: [{ kind: "literal" }, { kind: "literal" }] },
    });
  });

  it("reports syntax errors with the position", () => {
    expect(() => parseFilter("A eq 'x' and")).toThrow(/syntax error at end/);
    expect(() => parseFilter("A eq #")).toThrow(/unexpected character at position 6/);
  });
});

describe("other system query options", () => {
  it("parses $orderby, $select and $expand with nested options", () => {
    expect(parseOrderby("BeginDate desc,TravelID asc,_Travel/TravelID")).toEqual([
      { path: ["BeginDate"], descending: true },
      { path: ["TravelID"], descending: false },
      { path: ["_Travel", "TravelID"], descending: false },
    ]);
    expect(parseSelect("TravelID,*,com.sap.gateway.srvd.x.v0001.acceptTravel")).toEqual([["TravelID"], ["*"], ["com.sap.gateway.srvd.x.v0001.acceptTravel"]]);
    expect(parseExpand("_Booking($select=BookingID;$orderby=BookingID desc;$top=5;$skip=1;$count=true;$filter=FlightPrice gt 10),_Travel")).toEqual([
      {
        path: ["_Booking"],
        options: {
          select: [["BookingID"]],
          orderby: [{ path: ["BookingID"], descending: true }],
          top: 5,
          skip: 1,
          count: true,
          filter: { kind: "binary", op: "gt", left: { kind: "member", path: ["FlightPrice"] }, right: { kind: "literal", literal: { type: "int", value: "10" } } },
        },
      },
      { path: ["_Travel"], options: {} },
    ]);
  });

  it("splits query strings without turning + into a space", () => {
    expect([...parseQueryString("$filter=A%20eq%20'a+b'&sap-client=100&$top=5")]).toEqual([
      ["$filter", "A eq 'a+b'"],
      ["sap-client", "100"],
      ["$top", "5"],
    ]);
    expect(() => parseQueryString("$top=1&$top=2")).toThrow(/given twice/);
  });
});

describe("resource paths", () => {
  const sets = (name: string) => ["Travel", "Booking"].includes(name);
  const ns = "com.sap.gateway.srvd.zrt_ui_travel.v0001";

  it("parses keys, navigations, $count and bound operations", () => {
    expect(parseResourcePath("Travel(3f2504e0-4f89-11d3-9a0c-0305e82c3301)/_Booking/$count", sets, ns)).toEqual([
      { kind: "entitySet", name: "Travel", key: { kind: "single", value: { kind: "literal", literal: { type: "guid", value: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" } } } },
      { kind: "navigation", name: "_Booking" },
      { kind: "count" },
    ]);
    expect(parseResourcePath(`Travel(TravelUUID=3f2504e0-4f89-11d3-9a0c-0305e82c3301)/${ns}.acceptTravel`, sets, ns)).toMatchObject([
      { kind: "entitySet", key: { kind: "named", values: [{ name: "TravelUUID" }] } },
      { kind: "operation", namespace: ns, name: "acceptTravel" },
    ]);
    expect(parseKeyPredicate("(A='x/y',B=2)")).toMatchObject({ kind: "named", values: [{ name: "A", value: { literal: { value: "x/y" } } }, { name: "B" }] });
    expect(parseResourcePath("Travel('a%2Fb')", (n) => n === "Travel", ns)).toMatchObject([{ key: { value: { literal: { value: "a/b" } } } }]);
  });

  it("rejects unknown entity sets and namespaces", () => {
    expect(() => parseResourcePath("Nope", sets, ns)).toThrow(/Unknown entity set Nope/);
    expect(() => parseResourcePath("Travel(1)/other.ns.action", sets, ns)).toThrow(/Unknown namespace other.ns/);
  });
});
