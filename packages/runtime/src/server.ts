/**
 * Start-up of a generated application (`node server.mjs`), configured by the environment:
 *
 * - `PORT` (8080), `HOST` (0.0.0.0), `PUBLIC_URL` (http://localhost:<PORT>/), `LOG_LEVEL` (info);
 * - `DATABASE_URL` (PostgreSQL), or `PGLITE_DIR` for an embedded PGlite database (development);
 *   `SCHEMA=skip` to leave the database schema alone (default: applied at start-up, idempotent);
 *   `SEED=auto` to load db/seed.json and db/seed.sql when the tables are empty (D42);
 * - `AUTH_MODE` = `none` (development user `DEV_USER`, its roles `DEV_ROLES` — default: all —
 *   and claims `DEV_ATTRIBUTES`) or `oidc`: `OIDC_ISSUER`, `OIDC_DISCOVERY_URL`, `OIDC_AUDIENCE`,
 *   `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REQUIRED_ROLE`, `OIDC_ROLES_CLAIM`,
 *   `OIDC_USER_CLAIM`, `SESSION_SECRET`;
 * - `AUTHORIZATIONS_FILE`: roles replacing those of rapt/authorizations.json (D34);
 * - `DEV_OAUTH=on` (development mode only): the development OAuth 2.0 server under /oauth,
 *   clients `DEV_OAUTH_CLIENTS` (JSON, default rapt-client / rapt-secret and rapt-pkce) (D60).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { PGliteDialect, sql } from "kysely";
import type { LaunchpadModel, McpToolsModel, Model } from "@open-rap-runtime/model";
import { registerDevLaunchpad } from "./launchpad/dev.js";
import { platformEnvironment } from "./platform.js";
import { createApp } from "./app.js";
import type { DevOAuthClient } from "./auth/dev-oauth.js";
import { authFromEnvironment } from "./auth/environment.js";
import { Authorizations, rolesFromJson } from "./auth/authorizations.js";
import { applySchema, createDatabase, createPostgresDatabase, PGLITE_PARSERS, type Database } from "./db/database.js";
import { applySeed } from "./db/seed.js";
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

async function databaseFromEnvironment(env: Record<string, string | undefined>): Promise<Database> {
  const url = env["DATABASE_URL"];
  if (url !== undefined && url !== "") {
    return createPostgresDatabase(url, env["DATABASE_CA"] === undefined ? {} : { ca: env["DATABASE_CA"] });
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
  // on Cloud Foundry: the route and the bound PostgreSQL service (D50)
  const env = platformEnvironment(options.env ?? process.env);
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
  if (env["SEED"] === "auto") {
    const rows = await applySeed(db, model, dir);
    if (rows !== undefined) {
      process.stderr.write(`seed data loaded (${rows} rows)\n`);
    }
  }
  const rap = model.abap === undefined ? undefined : await RapRuntime.load(model, path.join(dir, "abap"));
  if (rap !== undefined) {
    rap.authorizations = authorizations;
  }
  const uiDir = path.join(dir, "ui");
  // the MCP server (D47): mcp/tools.json, written when the sources have rapt/mcp.json
  // the development launchpad of rapt dev (D49): home/launchpad.json of the development build
  const devFile = path.join(dir, "home", "launchpad.json");
  const devLaunchpad = existsSync(devFile) && env["DEV_LAUNCHPAD"] !== "off" ? (JSON.parse(readFileSync(devFile, "utf8")) as LaunchpadModel) : undefined;
  const mcpFile = path.join(dir, "mcp", "tools.json");
  const mcp = existsSync(mcpFile) && env["MCP"] !== "off" ? (JSON.parse(readFileSync(mcpFile, "utf8")) as McpToolsModel) : undefined;
  const devClients = env["DEV_OAUTH_CLIENTS"];
  const devOAuth = env["DEV_OAUTH"] === "on" && auth.mode === "none" ? (devClients === undefined || devClients === "" ? true : (JSON.parse(devClients) as DevOAuthClient[])) : undefined;
  const app = await createApp({
    model,
    metadata,
    db,
    auth,
    ...(devOAuth === undefined ? {} : { devOAuth }),
    logger: { level: env["LOG_LEVEL"] ?? "info" },
    ...(rap === undefined ? {} : { rap }),
    authorizations,
    ...(env["SESSION_SECRET"] === undefined ? {} : { csrfSecret: env["SESSION_SECRET"] }),
    ...(existsSync(uiDir) && env["UI"] !== "off" ? { ui: { dir: uiDir, resourcesFrom: dir, ...(devLaunchpad === undefined ? {} : { home: "/home/index.html" }) } } : {}),
    ...(devLaunchpad === undefined ? {} : { extend: (instance, services) => registerDevLaunchpad(instance, { dir, config: devLaunchpad, authenticator: services.authenticator }) }),
    ...(mcp === undefined ? {} : { mcp }),
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
