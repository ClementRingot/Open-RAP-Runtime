import { describe, expect, it } from "vitest";
import { classifyMethodDefinition } from "../src/ir/handlers.js";

describe("classification of RAP handler method definitions", () => {
  it.each([
    ["METHODS v FOR VALIDATE ON SAVE IMPORTING keys FOR Travel~validateDates.", { kind: "validation", alias: "Travel", name: "validateDates" }, { keys: "keys" }],
    ["METHODS d FOR DETERMINE ON MODIFY IMPORTING k FOR Travel~setStatus.", { kind: "determination", alias: "Travel", name: "setStatus" }, { keys: "k" }],
    ["METHODS d FOR DETERMINE ON SAVE IMPORTING keys FOR Booking~calc.", { kind: "determination", alias: "Booking", name: "calc" }, { keys: "keys" }],
    ["METHODS a FOR MODIFY IMPORTING keys FOR ACTION Travel~acceptTravel RESULT result.", { kind: "action", alias: "Travel", name: "acceptTravel" }, { keys: "keys", result: "result" }],
    ["METHODS a FOR MODIFY IMPORTING keys FOR ACTION Travel~recalc.", { kind: "action", alias: "Travel", name: "recalc" }, { keys: "keys" }],
    ["METHODS f FOR READ IMPORTING keys FOR FUNCTION Travel~getTotal RESULT res.", { kind: "function", alias: "Travel", name: "getTotal" }, { keys: "keys", result: "res" }],
    ["METHODS g FOR GLOBAL AUTHORIZATION IMPORTING REQUEST req FOR Travel RESULT result.", { kind: "globalAuthorization", alias: "Travel" }, { requested: "req", result: "result" }],
    ["METHODS i FOR INSTANCE AUTHORIZATION IMPORTING keys REQUEST req FOR Travel RESULT result.", { kind: "instanceAuthorization", alias: "Travel" }, { keys: "keys", requested: "req", result: "result" }],
    ["METHODS i FOR AUTHORIZATION IMPORTING keys REQUEST req FOR Travel RESULT result.", { kind: "instanceAuthorization", alias: "Travel" }, { keys: "keys", requested: "req", result: "result" }],
    ["METHODS g FOR GLOBAL FEATURES IMPORTING REQUEST req FOR Travel RESULT result.", { kind: "globalFeatures", alias: "Travel" }, { requested: "req", result: "result" }],
    ["METHODS i FOR INSTANCE FEATURES IMPORTING keys REQUEST req FOR Travel RESULT result.", { kind: "instanceFeatures", alias: "Travel" }, { keys: "keys", requested: "req", result: "result" }],
    ["METHODS n FOR NUMBERING IMPORTING entities FOR CREATE Travel.", { kind: "numbering", alias: "Travel" }, { entities: "entities" }],
    ["METHODS p FOR PRECHECK IMPORTING entities FOR UPDATE Travel.", { kind: "precheck", alias: "Travel", operation: "update" }, { entities: "entities" }],
    ["METHODS p FOR PRECHECK IMPORTING entities FOR CREATE Travel\\_Booking.", { kind: "precheck", alias: "Travel", operation: "create:_Booking" }, { entities: "entities" }],
    ["METHODS p FOR PRECHECK IMPORTING keys FOR ACTION Travel~accept.", { kind: "precheck", alias: "Travel", operation: "action:accept" }, { entities: "keys" }],
  ])("%s", (statement, kind, params) => {
    const classified = classifyMethodDefinition(statement);
    expect(classified?.kind).toEqual(kind);
    expect(classified?.params).toEqual(params);
  });

  it("ignores ordinary methods and keeps unknown RAP forms", () => {
    expect(classifyMethodDefinition("METHODS do_something IMPORTING iv_x TYPE i.")).toBeUndefined();
    expect(classifyMethodDefinition("METHODS lock FOR LOCK IMPORTING keys FOR LOCK Travel.")?.kind).toEqual({ kind: "other", text: "LOCK IMPORTING keys FOR LOCK Travel" });
  });
});
