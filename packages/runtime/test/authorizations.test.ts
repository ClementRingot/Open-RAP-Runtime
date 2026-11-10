/** The authorizations of the users (D34) without ABAP: PFCG values, sy-subrc of AUTHORITY-CHECK. */

import { describe, expect, it } from "vitest";
import { Authorizations, rolesFromJson, valueMatches } from "../src/auth/authorizations.js";
import { developmentUser, type User } from "../src/auth/user.js";

const authorizations = new Authorizations({
  objects: [{ name: "ZAO_TRAVL", fields: ["ACTVT", "ZAGENCY"] }],
  roles: rolesFromJson({
    roles: {
      manager: { authorizations: [{ object: "zao_travl", fields: { actvt: ["01", "02", "03"], zagency: "*" } }] },
      agent: { authorizations: [{ object: "ZAO_TRAVL", fields: { ACTVT: ["02", "03"], ZAGENCY: ["{claim:agency}", { from: "079000", to: "079999" }] } }] },
      partial: { authorizations: [{ object: "ZAO_TRAVL", fields: { ACTVT: ["03"] } }] },
    },
  }),
});

const user = (roles: string[], attributes?: Record<string, string[]>): User => ({ id: "u", abapName: "U", roles, authenticatedBy: "bearer", ...(attributes === undefined ? {} : { attributes }) });

describe("authorizations", () => {
  it("matches values, patterns and ranges as PFCG does", () => {
    expect(valueMatches("070001", "*")).toBe(true);
    expect(valueMatches("070001", "07*")).toBe(true);
    expect(valueMatches("080001", "07*")).toBe(false);
    expect(valueMatches("070001", "070001")).toBe(true);
    expect(valueMatches("070005", { from: "070001", to: "070009" })).toBe(true);
    expect(valueMatches("070010", { from: "070001", to: "070009" })).toBe(false);
  });

  it("gives sy-subrc 0, 4 or 12 like AUTHORITY-CHECK", () => {
    const manager = user(["manager"]);
    expect(authorizations.check(manager, "ZAO_TRAVL", [{ id: "ACTVT", value: "02" }, { id: "ZAGENCY", value: "070002" }])).toBe(0);
    expect(authorizations.check(manager, "ZAO_TRAVL", [{ id: "ACTVT", value: "06" }, { id: "ZAGENCY" }])).toBe(4);
    expect(authorizations.check(manager, "ZAO_OTHER", [{ id: "ACTVT", value: "03" }])).toBe(12);
    expect(authorizations.check(user([]), "ZAO_TRAVL", [{ id: "ACTVT", value: "03" }])).toBe(12);
  });

  it("expands the claims of the token and combines the roles", () => {
    const agent = user(["agent"], { agency: ["070001"] });
    expect(authorizations.check(agent, "ZAO_TRAVL", [{ id: "ACTVT", value: "02" }, { id: "ZAGENCY", value: "070001" }])).toBe(0);
    expect(authorizations.check(agent, "ZAO_TRAVL", [{ id: "ACTVT", value: "02" }, { id: "ZAGENCY", value: "079500" }])).toBe(0);
    expect(authorizations.check(agent, "ZAO_TRAVL", [{ id: "ACTVT", value: "02" }, { id: "ZAGENCY", value: "070002" }])).toBe(4);
    expect(authorizations.check(user(["agent"]), "ZAO_TRAVL", [{ id: "ACTVT", value: "02" }, { id: "ZAGENCY", value: "070001" }])).toBe(4);
    // a field without value in the authorization is not granted; DUMMY does not check it
    const partial = user(["partial"]);
    expect(authorizations.check(partial, "ZAO_TRAVL", [{ id: "ACTVT", value: "03" }, { id: "ZAGENCY", value: "070001" }])).toBe(4);
    expect(authorizations.check(partial, "ZAO_TRAVL", [{ id: "ACTVT", value: "03" }, { id: "ZAGENCY" }])).toBe(0);
    expect(authorizations.claims()).toEqual(["agency"]);
  });

  it("gives every role to the development user, unless roles are given", () => {
    expect(authorizations.check(developmentUser(), "ZAO_TRAVL", [{ id: "ACTVT", value: "01" }, { id: "ZAGENCY", value: "123456" }])).toBe(0);
    expect(authorizations.check(developmentUser("DEV", ["partial"]), "ZAO_TRAVL", [{ id: "ACTVT", value: "01" }])).toBe(4);
    // a token's role "*" is a role name like any other
    expect(authorizations.check(user(["*"]), "ZAO_TRAVL", [{ id: "ACTVT", value: "03" }])).toBe(12);
  });

  it("refuses a file without roles", () => {
    expect(() => rolesFromJson({ objects: {} })).toThrow(/"roles"/);
  });
});
