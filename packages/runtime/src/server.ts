/**
 * Start-up of a generated application (`node server.mjs`), configured by the environment:
 *
 * - `PORT` (8080), `HOST` (0.0.0.0), `PUBLIC_URL` (http://localhost:<PORT>/), `LOG_LEVEL` (info);
 * - `DATABASE_URL` (PostgreSQL), or `PGLITE_DIR` for an embedded PGlite database (development);
 *   `SCHEMA=skip` to leave the database schema alone (default: applied at start-up, idempotent);
 * - `AUTH_MODE` = `none` (development user `DEV_USER`, its roles `DEV_ROLES` — default: all —
 *   and claims `DEV_ATTRIBUTES`) or `oidc`: `OIDC_ISSUER`, `OIDC_DISCOVERY_URL`, `OIDC_AUDIENCE`,
 *   `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REQUIRED_ROLE`, `OIDC_ROLES_CLAIM`,
 *   `OIDC_USER_CLAIM`, `SESSION_SECRET`;
 * - `AUTHORIZATIONS_FILE`: roles replacing those of rapt/authorizations.json (D34).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { PGliteDialect, sql } from "kysely";
import type { Model } from "@rap-transpiler/model";
import { createApp } from "./app.js";
import type { AuthOptions } from "./auth/auth.js";
import { Authorizations, rolesFromJson } from "./auth/authorizations.js";
import { applySchema, createDatabase, createPostgresDatabase, PGLITE_PARSERS, type Database } from "./db/database.js";
import { RapRuntime } from "./rap/runtime.js";

export interface StartOptions {
  /** The generated application folder (model/, db/, odata/, abap/, ui/). */
  dir: string;
  /** Environment (default: process.env). */
  env?: Record<string, string | undefined>;
  /** A database to use instead of the environment's (tests). */
  db?: Database;
  /** Listen (default true); false gives the application without opening a port. */
  listen?: boolean;
}

export interface RunningServer {
  app: FastifyInstance;
  /** The URL the server listens on. */
  url: string;
  close(): Promise<void>;
}

function authFromEnvironment(env: Record<string, string | undefined>, publicUrl: string, attributeClaims: string[]): AuthOptions {
  if ((env["AUTH_MODE"] ?? "none") === "none") {
    const auth: AuthOptions = { mode: "none" };
    if (env["DEV_USER"] !== undefined) {
      auth.user = env["DEV_USER"];
    }
    // the roles of the development user (default: all), its claims as JSON ({"agency":["070001"]})
    if (env["DEV_ROLES"] !== undefined) {
      auth.roles = env["DEV_ROLES"].split(",").map((r) => r.trim()).filter((r) => r !== "");
    }
    if (env["DEV_ATTRIBUTES"] !== undefined && env["DEV_ATTRIBUTES"] !== "") {
      const attributes = JSON.parse(env["DEV_ATTRIBUTES"]) as Record<string, unknown>;
      auth.attributes = Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k, (Array.isArray(v) ? v : [v]).map(String)]));
    }
    return auth;
  }
  const issuer = env["OIDC_ISSUER"];
  if (issuer === undefined) {
    throw new Error("AUTH_MODE=oidc needs OIDC_ISSUER");
  }
  const auth: AuthOptions = { mode: "oidc", issuer };
  if (attributeClaims.length > 0) {
    auth.attributeClaims = attributeClaims;
  }
  const optional: Array<[keyof typeof auth, string]> = [
    ["discoveryUrl", "OIDC_DISCOVERY_URL"],
    ["audience", "OIDC_AUDIENCE"],
    ["requiredRole", "OIDC_REQUIRED_ROLE"],
    ["rolesClaim", "OIDC_ROLES_CLAIM"],
    ["userClaim", "OIDC_USER_CLAIM"],
  ];
  for (const [key, name] of optional) {
    const value = env[name];
    if (value !== undefined && value !== "") {
      (auth as unknown as Record<string, string>)[key] = value;
    }
  }
  const clientId = env["OIDC_CLIENT_ID"];
  if (clientId !== undefined && clientId !== "") {
    const secret = env["SESSION_SECRET"];
    if (secret === undefined || secret.length < 32) {
      throw new Error("browser sessions (OIDC_CLIENT_ID) need SESSION_SECRET, 32 characters or more");
    }
    auth.session = { clientId, baseUrl: publicUrl, secret };
    const clientSecret = env["OIDC_CLIENT_SECRET"];
    if (clientSecret !== undefined && clientSecret !== "") {
      auth.session.clientSecret = clientSecret;
    }
  }
  return auth;
}

async function databaseFromEnvironment(env: Record<string, string | undefined>): Promise<Database> {
  const url = env["DATABASE_URL"];
  if (url !== undefined && url !== "") {
    return createPostgresDatabase(url);
  }
  const dir = env["PGLITE_DIR"];
  if (dir !== undefined && dir !== "") {
    // embedded PostgreSQL for development: an optional dependency of the application
    const { PGlite } = (await import("@electric-sql/pglite" as string)) as { PGlite: { create(dir: string, options: unknown): Promise<unknown> } };
    const pglite = await PGlite.create(path.resolve(dir), { parsers: PGLITE_PARSERS });
    const db = createDatabase(new PGliteDialect({ pglite: pglite as ConstructorParameters<typeof PGliteDialect>[0]["pglite"] }));
    await sql.raw("SET TIME ZONE 'UTC'").execute(db);
    return db;
  }
  throw new Error("set DATABASE_URL (PostgreSQL) or PGLITE_DIR (embedded database for development)");
}

export async function start(options: StartOptions): Promise<RunningServer> {
  const env = options.env ?? process.env;
  const dir = path.resolve(options.dir);
  const port = Number(env["PORT"] ?? 8080);
  const host = env["HOST"] ?? "0.0.0.0";
  const publicUrl = env["PUBLIC_URL"] ?? `http://localhost:${port}/`;
  const model = JSON.parse(readFileSync(path.join(dir, "model", "model.json"), "utf8")) as Model;
  const metadata = readFileSync(path.join(dir, "odata", "metadata.xml"), "utf8");
  // the roles of rapt/authorizations.json, or of the file AUTHORIZATIONS_FILE (D34)
  const file = env["AUTHORIZATIONS_FILE"];
  const authorizations =
    file === undefined || file === ""
      ? new Authorizations(model.authorizations)
      : new Authorizations({ objects: model.authorizations?.objects ?? [], roles: rolesFromJson(JSON.parse(readFileSync(path.resolve(file), "utf8"))) });
  const auth = authFromEnvironment(env, publicUrl, authorizations.claims());
  const db = options.db ?? (await databaseFromEnvironment(env));
  if ((env["SCHEMA"] ?? "apply") !== "skip") {
    await applySchema(db, readFileSync(path.join(dir, "db", "schema.sql"), "utf8"));
  }
  const rap = model.abap === undefined ? undefined : await RapRuntime.load(model, path.join(dir, "abap"));
  if (rap !== undefined) {
    rap.authorizations = authorizations;
  }
  const uiDir = path.join(dir, "ui");
  const app = await createApp({
    model,
    metadata,
    db,
    auth,
    logger: { level: env["LOG_LEVEL"] ?? "info" },
    ...(rap === undefined ? {} : { rap }),
    authorizations,
    ...(env["SESSION_SECRET"] === undefined ? {} : { csrfSecret: env["SESSION_SECRET"] }),
    ...(existsSync(uiDir) && env["UI"] !== "off" ? { ui: { dir: uiDir, resourcesFrom: dir } } : {}),
  });
  let url = publicUrl;
  if (options.listen !== false) {
    const address = await app.listen({ port, host });
    url = address.replace("0.0.0.0", "localhost");
  } else {
    await app.ready();
  }
  return {
    app,
    url,
    close: async () => {
      await app.close();
      if (options.db === undefined) {
        await db.destroy();
      }
    },
  };
}
