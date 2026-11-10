/**
 * The managed RAP runtime of a generated application: the transpiled behavior pools, the EML
 * kernel and the LUWs.
 *
 * ABAP runs one LUW at a time (decision D11: the runtime of @abaplint/runtime has a global state,
 * sy-* and static attributes); the calls made by a LUW's own handlers are re-entrant because they
 * run inside it (AsyncLocalStorage carries the LUW).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Kysely } from "kysely";
import { ABAP_SQL_SCHEMA, type Model } from "@rap-transpiler/model";
import { AbapBridge, loadAbap, setSystemFields } from "../abap/bridge.js";
import { abapGlobal } from "../abap/convert.js";
import { AbapSqlClient } from "../abap/sql.js";
import { Authorizations } from "../auth/authorizations.js";
import type { User } from "../auth/user.js";
import { BoModel } from "./bo.js";
import { installKernel } from "./kernel.js";
import { Transaction } from "./transaction.js";
import { Responses, type AccessMode } from "./types.js";

/** An EML statement being executed (between ZRAP_EML=>begin and =>end). */
export interface Statement {
  bdef: string;
  mode: AccessMode;
  responses: Responses;
}

export interface LuwContext {
  tx: Transaction;
  user: User;
  language: string;
  statements: Statement[];
}

export class RapRuntime {
  public readonly bo: BoModel;
  public readonly bridge: AbapBridge;
  /** The authorizations of the users: AUTHORITY-CHECK (D34); the roles of the model by default. */
  public authorizations: Authorizations;
  private readonly storage = new AsyncLocalStorage<LuwContext>();
  private tail: Promise<unknown> = Promise.resolve();
  private lastMicros = 0n;

  private constructor(public readonly model: Model) {
    this.bo = new BoModel(model);
    this.bridge = new AbapBridge(this.bo, model.messageClasses);
    this.authorizations = new Authorizations(model.authorizations);
  }

  /**
   * Loads the transpiled behavior pools of the model (`abap/` folder), installs the kernel and the
   * database of the ABAP SQL (decision D26) and the texts of the message classes (MESSAGE … INTO).
   */
  public static async load(model: Model, abapDir: string): Promise<RapRuntime> {
    await loadAbap(abapDir, model.abap?.modules[0] ?? "init.mjs");
    const runtime = new RapRuntime(model);
    installKernel(runtime);
    const abap = abapGlobal();
    abap.dbo.schemaPrefix = ABAP_SQL_SCHEMA;
    abap.context.databaseConnections["DEFAULT"] = new AbapSqlClient(() => {
      const context = runtime.storage.getStore();
      if (context === undefined) {
        throw new Error("ABAP SQL outside of a RAP transaction");
      }
      return { db: context.tx.db, writable: context.tx.inSaver };
    });
    abap.MSAG = model.messageClasses;
    return runtime;
  }

  /** The LUW of the running ABAP code. */
  public context(): LuwContext {
    const context = this.storage.getStore();
    if (context === undefined) {
      throw new Error("EML outside of a RAP transaction");
    }
    return context;
  }

  /** Time stamps of the administrative fields: ISO UTC with microseconds, strictly increasing. */
  public now(): string {
    let micros = BigInt(Date.now()) * 1000n;
    if (micros <= this.lastMicros) {
      micros = this.lastMicros + 1n;
    }
    this.lastMicros = micros;
    const iso = new Date(Number(micros / 1000n)).toISOString();
    return `${iso.slice(0, 23)}${String(micros % 1000n).padStart(3, "0")}Z`;
  }

  /**
   * Runs `fn` in a new LUW: one database transaction (committed when `fn` returns, rolled back when
   * it throws), ABAP serialized with the other LUWs.
   */
  public async transaction<T>(db: Kysely<unknown>, user: User, language: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> =>
      db.transaction().execute(async (trx) => {
        const tx = new Transaction({ bo: this.bo, bridge: this.bridge, now: () => this.now() }, trx as unknown as Kysely<unknown>, user);
        return this.storage.run({ tx, user, language, statements: [] }, async () => {
          setSystemFields(user, language);
          return fn(tx);
        });
      });
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
