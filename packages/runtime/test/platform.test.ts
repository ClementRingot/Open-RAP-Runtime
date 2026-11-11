/** Cloud Foundry (D50): the route and the bound PostgreSQL service read from the environment. */

import { describe, expect, it } from "vitest";
import { boundPostgres, platformEnvironment } from "../src/platform.js";

describe("platform environment", () => {
  it("reads the route and the PostgreSQL service of Cloud Foundry", () => {
    const env = platformEnvironment({
      VCAP_APPLICATION: JSON.stringify({ application_uris: ["travel.cfapps.eu10.hana.ondemand.com"] }),
      VCAP_SERVICES: JSON.stringify({ "postgresql-db": [{ name: "travel-db", tags: ["postgresql", "relational"], credentials: { hostname: "pg.example", port: "2345", dbname: "app", username: "u", password: "p@ss", sslrootcert: "-----BEGIN CERTIFICATE-----" } }] }),
    });
    expect(env["PUBLIC_URL"]).toBe("https://travel.cfapps.eu10.hana.ondemand.com/");
    expect(env["DATABASE_URL"]).toBe("postgres://u:p%40ss@pg.example:2345/app");
    expect(env["DATABASE_CA"]).toBe("-----BEGIN CERTIFICATE-----");
  });

  it("keeps what is set explicitly, and ignores other services", () => {
    const env = platformEnvironment({ PUBLIC_URL: "https://mine/", DATABASE_URL: "postgres://x", VCAP_APPLICATION: JSON.stringify({ application_uris: ["a"] }) });
    expect(env).toMatchObject({ PUBLIC_URL: "https://mine/", DATABASE_URL: "postgres://x" });
    expect(boundPostgres(JSON.stringify({ redis: [{ credentials: { uri: "redis://x" } }] }))).toBeUndefined();
    expect(boundPostgres(JSON.stringify({ "user-provided": [{ label: "user-provided", tags: ["postgres"], credentials: { uri: "postgres://y" } }] }))).toEqual({ url: "postgres://y" });
    expect(platformEnvironment({})).toEqual({});
  });
});
