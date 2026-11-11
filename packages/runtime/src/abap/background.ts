/**
 * Background processing (bgPF, decision D41): cl_bgmc_process_factory saves a process in the LUW
 * of the request (table rapt_background_process, state NEW); once that LUW is committed, the
 * operation runs in a LUW of its own, as the same user, after the request. A controlled operation
 * (if_bgmc_op_single) writes the database after cl_abap_tx=>save( ) and its EML changes are saved
 * at its end; an uncontrolled one (if_bgmc_op_single_tx_uncontr) writes when it wants and saves
 * its EML changes with COMMIT ENTITIES. The process then ends SUCCESSFUL or ERRONEOUS.
 *
 * The operation object stays in memory: a process that has not run when the application stops
 * is not run again (see KNOWN_GAPS.md).
 */

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { same } from "@rap-transpiler/model";
import type { AfterCommit, RapRuntime } from "../rap/runtime.js";
import { RapRuntimeError } from "../rap/types.js";
import { setSubrc } from "./bridge.js";
import { abapGlobal, abapString, type AbapData } from "./convert.js";

type Input = Record<string, AbapData> | undefined;

class RolledBack extends Error {}

const flag = (value: AbapData | undefined): boolean => value !== undefined && abapString(value) !== "";

export function installBackground(kernel: AbapData, runtime: RapRuntime): void {
  const abap = abapGlobal();

  const errorText = (error: unknown): string => {
    const name = (error as { constructor?: { INTERNAL_NAME?: string } })?.constructor?.INTERNAL_NAME;
    if (name !== undefined) {
      return `${name}: ${runtime.bridge.exceptionText(error)}`;
    }
    return error instanceof Error ? error.message : String(error);
  };

  const finish = async (luw: Parameters<AfterCommit>[0], id: string, state: string, error: string): Promise<void> => {
    await runtime.transaction(luw.db, luw.user, luw.language, async (tx) => {
      await sql`UPDATE rapt_background_process SET state = ${state}, error_text = ${error}, finished_at = now() WHERE process_id = ${id}`.execute(tx.db);
    });
  };

  kernel.bgmc_save = async (input: Input): Promise<AbapData> => {
    const context = runtime.context();
    const id = randomUUID().replace(/-/g, "").toUpperCase();
    const name = abapString(input?.["name"]);
    const controlled = flag(input?.["controlled"]);
    // the reference of the operation, kept until the process runs
    const operation = new abap.types.ABAPObject().set(input?.["operation"]);
    if (operation.get() === undefined) {
      throw new RapRuntimeError("save_for_execution: the process has no operation (set_operation or set_operation_tx_uncontrolled)");
    }
    await sql`INSERT INTO rapt_background_process (process_id, process_name, state, process_user, created_at)
      VALUES (${id}, ${name}, 'NEW', ${context.user.abapName}, now())`.execute(context.tx.db);
    context.afterCommit.push(async (luw) => {
      const background = { controlled, committed: false, rolledBack: false };
      let state = "SUCCESSFUL";
      let error = "";
      try {
        await runtime.transaction(
          luw.db,
          luw.user,
          luw.language,
          async (tx) => {
            await abap.Classes["ZRAP_CL_BGMC_PROCESS"].zrap_run({ operation, controlled: new abap.types.Character(1).set(controlled ? "X" : "") });
            if (background.rolledBack) {
              throw new RolledBack();
            }
            if (!background.committed) {
              // the changes of the operation's EML are saved at its end, as by the RAP framework
              const responses = await tx.save();
              if (responses.hasFailed) {
                throw new Error(`the save sequence failed: ${responses.reported.map((r) => r.message.text).join("; ") || "failed instances"}`);
              }
            }
          },
          { background },
        );
      } catch (e) {
        if (!(e instanceof RolledBack)) {
          state = "ERRONEOUS";
          error = errorText(e);
          process.stderr.write(`rap-transpiler: background process ${name || id} failed: ${error}\n`);
        }
      }
      await finish(luw, id, state, error);
    });
    return new abap.types.String().set(id);
  };

  kernel.bgmc_state = async (input: Input): Promise<AbapData> => {
    const { rows } = await sql<{ state: string }>`SELECT state FROM rapt_background_process WHERE process_id = ${abapString(input?.["id"])}`.execute(runtime.context().tx.db);
    return new abap.types.String().set(rows[0]?.state ?? "");
  };

  // cl_abap_tx=>modify( ) / save( ): the transactional phase of a controlled operation
  kernel.tx_phase = async (input: Input): Promise<void> => {
    const context = runtime.context();
    if (context.background?.controlled === true) {
      context.tx.inSaver = abapString(input?.["phase"]) === "save";
    }
  };

  // COMMIT ENTITIES and ROLLBACK ENTITIES: only in a background operation
  const forbidden = (): never => {
    throw new RapRuntimeError("COMMIT ENTITIES and ROLLBACK ENTITIES are not allowed in a behavior implementation");
  };
  kernel.commit = async (input: Input): Promise<void> => {
    const context = runtime.context();
    const background = context.background;
    if (background === undefined) {
      forbidden();
      return;
    }
    if (background.committed) {
      throw new RapRuntimeError("COMMIT ENTITIES: a background operation commits once");
    }
    const responses = await context.tx.save();
    background.responses = responses;
    if (!flag(input?.["simulation"]) && !responses.hasFailed) {
      background.committed = true;
    }
    setSubrc(responses.hasFailed ? 4 : 0);
  };
  kernel.commit_response = async (input: Input): Promise<void> => {
    const background = runtime.context().background;
    if (background === undefined) {
      forbidden();
      return;
    }
    const bdef = abapString(input?.["bdef"]);
    const bo = runtime.bo.entities.find((e) => same(e.bdef.name, bdef));
    if (bo !== undefined && background.responses !== undefined) {
      await runtime.bridge.writeResponses(bo, background.responses, input?.["failed"], input?.["reported"]);
    }
  };
  kernel.rollback = async (): Promise<void> => {
    const background = runtime.context().background;
    if (background === undefined) {
      forbidden();
      return;
    }
    background.rolledBack = true;
  };
}
