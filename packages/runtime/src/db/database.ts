/**
 * Database access: Kysely over node-postgres, or over PGlite (tests, local development).
 * Dates, time stamps, numerics and INT8 are read as strings so that no precision is lost
 * (decision D16); the session time zone is UTC.
 */

import { Kysely, PostgresDialect, sql, type Dialect } from "kysely";
import pg from "pg";

export type Database = Kysely<Record<string, Record<string, unknown>>>;

const DATE = 1082;
const TIME = 1083;
const TIMESTAMP = 1114;
const TIMESTAMPTZ = 1184;
const NUMERIC = 1700;
const INT8 = 20;

const asString = (value: string): string => value;

/** PGlite parsers keeping the PostgreSQL text form (pass as `parsers` to `new PGlite`). */
export const PGLITE_PARSERS: Record<number, (value: string) => unknown> = {
  [DATE]: asString,
  [TIME]: asString,
  [TIMESTAMP]: asString,
  [TIMESTAMPTZ]: asString,
  [NUMERIC]: asString,
  [INT8]: asString,
};

export function createPostgresDatabase(connectionString: string, options: { max?: number } = {}): Database {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    options: "-c TimeZone=UTC",
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") => {
        if (oid === DATE || oid === TIME || oid === TIMESTAMP || oid === TIMESTAMPTZ || oid === NUMERIC || oid === INT8) {
          return asString;
        }
        return format === undefined ? pg.types.getTypeParser(oid) : pg.types.getTypeParser(oid, format);
      }) as typeof pg.types.getTypeParser,
    },
  });
  return new Kysely({ dialect: new PostgresDialect({ pool }) });
}

export function createDatabase(dialect: Dialect): Database {
  return new Kysely({ dialect });
}

let savepoints = 0;

/**
 * Runs `fn` in a savepoint of the transaction `db`: when it fails (a lock that is not available,
 * a SELECT of the ABAP code), PostgreSQL would otherwise refuse every further statement of the
 * transaction. Rolled back to the savepoint, the transaction goes on.
 */
export async function withSavepoint<T, DB>(db: Kysely<DB>, fn: () => Promise<T>): Promise<T> {
  const name = `rapt_${++savepoints}`;
  await sql.raw(`SAVEPOINT ${name}`).execute(db);
  let result: T;
  try {
    result = await fn();
  } catch (error) {
    await sql.raw(`ROLLBACK TO SAVEPOINT ${name}`).execute(db);
    throw error;
  }
  await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(db);
  return result;
}

/** Applies the generated schema (idempotent) in one transaction. */
export async function applySchema(db: Database, schema: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await sql.raw("SET LOCAL TIME ZONE 'UTC'").execute(trx);
    await sql.raw(schema).execute(trx);
  });
}
