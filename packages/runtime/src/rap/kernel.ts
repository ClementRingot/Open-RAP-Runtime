/**
 * The EML kernel: JavaScript implementation of the static methods of the clean-room class
 * ZRAP_EML, which the rewrite pass calls for every EML statement of the behavior pools
 * (decision D2). The methods run in the LUW of the handler that executes the statement.
 */

import { randomUUID } from "node:crypto";
import { same, type ActionModel } from "@open-rap-runtime/model";
import { setSubrc } from "../abap/bridge.js";
import { installHttp } from "../abap/http.js";
import { installODataClient } from "../abap/odata-client.js";
import { installUtilities } from "../abap/utils.js";
import { installBackground } from "../abap/background.js";
import { installMail } from "../abap/mail.js";
import { abapGlobal, abapString, appendRow, component, rowsOf, type AbapData } from "../abap/convert.js";
import { isInitial } from "../values.js";
import { entityOfTable, type BoEntity } from "./bo.js";
import type { RapRuntime, Statement } from "./runtime.js";
import type { CreateRequest } from "./transaction.js";
import { RapRuntimeError, Responses, type Row } from "./types.js";

type Input = Record<string, AbapData> | undefined;

const isTrue = (value: AbapData | undefined): boolean => value !== undefined && String(value.get?.() ?? value).trim() !== "";

export function installKernel(runtime: RapRuntime): void {
  const abap = abapGlobal();
  const kernel = abap.Classes["ZRAP_EML"];
  if (kernel === undefined) {
    throw new Error("the kernel class ZRAP_EML is not loaded");
  }
  const { bo: model, bridge } = runtime;

  const statement = (): Statement => {
    const statements = runtime.context().statements;
    const current = statements[statements.length - 1];
    if (current === undefined) {
      throw new RapRuntimeError("EML operation outside of an EML statement");
    }
    return current;
  };
  const entityOf = (input: Input): BoEntity => {
    const name = abapString(input?.["entity"]);
    const bo = model.find(name);
    if (bo === undefined) {
      throw new RapRuntimeError(`EML: unknown entity ${name}`);
    }
    return bo;
  };
  /** Fields requested by `FIELDS ( … )`, `ALL FIELDS` or the `%control` of a row (`FROM`). */
  const fieldsOf = (input: Input, bo: BoEntity, row: AbapData, values?: Row): Set<string> => {
    const spec = abapString(input?.["fields"]);
    if (spec === "*") {
      return new Set(bo.fields.map((f) => f.name));
    }
    if (spec !== "") {
      return new Set(spec.split(/\s+/).map((n) => bo.fields.find((f) => same(f.name, n))?.name ?? n));
    }
    if (isTrue(input?.["set_fields"]) && values !== undefined) {
      return new Set(bo.fields.filter((f) => !isInitial(f.type, values[f.name])).map((f) => f.name));
    }
    return bridge.readControl(row, bo) ?? new Set();
  };
  const cidOf = (input: Input, row: AbapData, name: "%cid" | "%cid_ref"): string | undefined => {
    const cid = bridge.readText(row, name);
    if (cid !== "") {
      return cid;
    }
    return name === "%cid" && isTrue(input?.["auto_fill_cid"]) ? `%AUTO-${randomUUID()}` : undefined;
  };
  const createRequest = (input: Input, bo: BoEntity, row: AbapData): CreateRequest => {
    const values = bridge.readRow(row, bo);
    const request: CreateRequest = { values, fields: fieldsOf(input, bo, row, values) };
    const cid = cidOf(input, row, "%cid");
    if (cid !== undefined) {
      request.cid = cid;
    }
    return request;
  };
  const actionOf = (bo: BoEntity, input: Input): ActionModel => {
    const name = abapString(input?.["action"]);
    const action = bo.behavior.actions.find((a) => same(a.name, name));
    if (action === undefined) {
      throw new RapRuntimeError(`EML: ${bo.behavior.alias} has no action ${name}`);
    }
    return action;
  };

  kernel.begin = async (input: Input): Promise<void> => {
    runtime.context().statements.push({
      bdef: abapString(input?.["bdef"]),
      mode: { local: isTrue(input?.["local"]), privileged: isTrue(input?.["privileged"]), external: false },
      responses: new Responses(),
    });
  };

  kernel.end = async (input: Input): Promise<void> => {
    const current = runtime.context().statements.pop();
    if (current === undefined) {
      throw new RapRuntimeError("EML: end without begin");
    }
    const any = model.entities.find((e) => same(e.bdef.name, current.bdef));
    if (any !== undefined) {
      await bridge.writeResponses(any, current.responses, input?.["failed"], input?.["reported"], input?.["mapped"]);
    }
    setSubrc(current.responses.failed.length > 0 ? 4 : 0);
  };

  kernel.read = async (input: Input): Promise<void> => {
    const st = statement();
    const bo = entityOf(input);
    const rows = rowsOf(input?.["keys"]);
    const { rows: found, responses } = await runtime.context().tx.read(
      bo,
      rows.map((row) => ({ key: bridge.readKey(row, bo) })),
    );
    st.responses.add(responses);
    const result = input?.["result"];
    if (result === undefined) {
      return;
    }
    result.clear();
    found.forEach((values, i) => {
      if (values !== undefined) {
        const fields = fieldsOf(input, bo, rows[i]);
        appendRow(result, (r) => bridge.fillRow(r, bo, values, [...bo.keys.map((k) => k.name), ...fields]));
      }
    });
  };

  kernel.read_by_association = async (input: Input): Promise<void> => {
    const st = statement();
    const bo = entityOf(input);
    const association = model.association(bo, abapString(input?.["association"]));
    if (association === undefined) {
      throw new RapRuntimeError(`EML: ${bo.behavior.alias} has no association ${abapString(input?.["association"])}`);
    }
    const rows = rowsOf(input?.["keys"]);
    const { results, responses } = await runtime.context().tx.readByAssociation(
      bo,
      association,
      rows.map((row) => bridge.readKey(row, bo)),
    );
    st.responses.add(responses);
    const fields = rows[0] === undefined ? new Set<string>() : fieldsOf(input, association.target, rows[0]);
    const result = input?.["result"];
    const link = input?.["link"];
    result?.clear();
    link?.clear();
    const seen = new Set<string>();
    for (const { source, target } of results) {
      const id = JSON.stringify(association.target.keys.map((k) => target[k.name]));
      if (result !== undefined && !seen.has(id)) {
        seen.add(id);
        appendRow(result, (r) => bridge.fillRow(r, association.target, target, [...association.target.keys.map((k) => k.name), ...fields]));
      }
      if (link !== undefined) {
        appendRow(link, (r) => {
          bridge.fillKey(component(r, "source"), bo, source);
          bridge.fillKey(component(r, "target"), association.target, target);
        });
      }
    }
  };

  kernel.modify = async (input: Input): Promise<void> => {
    const st = statement();
    const bo = entityOf(input);
    const tx = runtime.context().tx;
    const operation = abapString(input?.["operation"]).toUpperCase();
    const rows = rowsOf(input?.["rows"]);
    if (operation === "CREATE") {
      st.responses.add(await tx.create(bo, rows.map((row) => createRequest(input, bo, row)), st.mode));
    } else if (operation === "UPDATE") {
      st.responses.add(
        await tx.update(
          bo,
          rows.map((row) => {
            const values = bridge.readRow(row, bo);
            const fields = fieldsOf(input, bo, row, values);
            for (const k of bo.keys) {
              fields.delete(k.name);
            }
            const cidRef = cidOf(input, row, "%cid_ref");
            return { key: bridge.readKey(row, bo), values, fields, ...(cidRef === undefined ? {} : { cidRef }) };
          }),
          st.mode,
        ),
      );
    } else if (operation === "DELETE") {
      st.responses.add(
        await tx.delete(
          bo,
          rows.map((row) => {
            const cidRef = cidOf(input, row, "%cid_ref");
            return { key: bridge.readKey(row, bo), ...(cidRef === undefined ? {} : { cidRef }) };
          }),
          st.mode,
        ),
      );
    } else {
      throw new RapRuntimeError(`EML: unknown operation ${operation}`);
    }
  };

  kernel.create_by_association = async (input: Input): Promise<void> => {
    const st = statement();
    const bo = entityOf(input);
    const association = model.association(bo, abapString(input?.["association"]));
    if (association === undefined) {
      throw new RapRuntimeError(`EML: ${bo.behavior.alias} has no association ${abapString(input?.["association"])}`);
    }
    const requests = rowsOf(input?.["rows"]).map((row) => {
      const cidRef = cidOf(input, row, "%cid_ref");
      return {
        key: bridge.readKey(row, bo),
        ...(cidRef === undefined ? {} : { cidRef }),
        targets: rowsOf(component(row, "%target")).map((target) => createRequest(input, association.target, target)),
      };
    });
    st.responses.add(await runtime.context().tx.createByAssociation(bo, association, requests, st.mode));
  };

  kernel.execute = async (input: Input): Promise<void> => {
    const st = statement();
    const bo = entityOf(input);
    const action = actionOf(bo, input);
    const parameter = action.parameter === undefined || action.parameter === "$self" ? undefined : model.model.entities.find((e) => same(e.name, action.parameter ?? ""));
    const requests = rowsOf(input?.["rows"]).map((row) => {
      const cid = action.static || action.factory ? cidOf(input, row, "%cid") : undefined;
      const cidRef = action.static ? undefined : cidOf(input, row, "%cid_ref");
      return {
        ...(action.static ? {} : { key: bridge.readKey(row, bo) }),
        ...(cid === undefined ? {} : { cid }),
        ...(cidRef === undefined ? {} : { cidRef }),
        param: parameter === undefined ? {} : bridge.readParameter(row, parameter.fields),
      };
    });
    const { results, responses } = await runtime.context().tx.execute(bo, action, requests, st.mode);
    st.responses.add(responses);
    const result = input?.["result"];
    if (result === undefined) {
      return;
    }
    result.clear();
    const resultBo = action.result === undefined || action.result.entity === "$self" ? bo : model.find(action.result.entity);
    const abstract = action.result !== undefined && resultBo === undefined ? model.model.entities.find((e) => same(e.name, action.result?.entity ?? "")) : undefined;
    for (const entry of results) {
      appendRow(result, (r) => {
        if (entry.key !== undefined) {
          bridge.fillKey(r, bo, entry.key);
        }
        component(r, action.static ? "%cid" : "%cid_ref")?.set((action.static ? entry.cid : entry.cidRef) ?? "");
        const param = component(r, "%param");
        if (param !== undefined && entry.value !== undefined) {
          if (resultBo !== undefined) {
            bridge.fillRow(param, resultBo, entry.value);
          } else if (abstract !== undefined) {
            bridge.fillParameter(r, abstract.fields, entry.value);
          }
        }
      });
    }
  };

  // COMMIT ENTITIES and ROLLBACK ENTITIES: only in a background operation (installBackground)

  kernel.message_text = async (input: Input): Promise<AbapData> => {
    const vars = ["v1", "v2", "v3", "v4"].map((v) => abapString(input?.[v]));
    return new abap.types.String().set(bridge.t100(abapString(input?.["id"]), abapString(input?.["number"]), vars));
  };

  // the T100 text of an exception object (if_t100_message), its attributes resolved by name
  kernel.exception_text = async (input: Input): Promise<AbapData> => {
    const object = input?.["exception"]?.get?.();
    return new abap.types.String().set(object === undefined ? "" : bridge.exceptionText(object));
  };

  kernel.uuid = async (): Promise<AbapData> => new abap.types.Hex({ length: 16 }).set(randomUUID().replace(/-/g, "").toUpperCase());

  // consumption of remote APIs: HTTP client and OData client proxy (D31)
  installHttp(kernel);
  installODataClient(kernel);
  // utilities of ABAP Cloud: JSON, encodings, number ranges, application log, RTTS… (D40)
  installUtilities(kernel, { db: () => runtime.context().tx.db, user: () => runtime.context().user.abapName });
  // background processing (bgPF) and e-mails, after the commit of the LUW (D41)
  installBackground(kernel, runtime);
  installMail(kernel, runtime);

  // AUTHORITY-CHECK: the transpiler calls the kernel class KERNEL_AUTHORITY_CHECK (D34)
  abap.Classes["KERNEL_AUTHORITY_CHECK"] = {
    call: async (input: { object?: AbapData; user?: AbapData; fields?: Array<{ id?: AbapData; field?: AbapData; dummy?: boolean }> }): Promise<void> => {
      const { user } = runtime.context();
      const forUser = input.user === undefined ? undefined : abapString(input.user).trim().toUpperCase();
      if (forUser !== undefined && forUser !== user.abapName) {
        // FOR USER: only the user of the request is known (40: unknown user)
        setSubrc(40);
        return;
      }
      const fields = (input.fields ?? []).map((f) => {
        const id = abapString(f.id).trim().toUpperCase();
        return f.dummy === true ? { id } : { id, value: abapString(f.field).trimEnd() };
      });
      setSubrc(runtime.authorizations.check(user, abapString(input.object).trim().toUpperCase(), fields));
    },
  };

  // INSERT|UPDATE|MODIFY|DELETE dbtab FROM [TABLE] @source … MAPPING FROM ENTITY (save_modified)
  kernel.sql_write = async (input: Input): Promise<void> => {
    const operation = abapString(input?.["operation"]).toUpperCase();
    const table = abapString(input?.["table"]);
    const bo = entityOfTable(model, table);
    if (bo === undefined) {
      throw new RapRuntimeError(`${operation} ${table} … MAPPING FROM ENTITY: no entity of a BDEF is mapped to ${table}`);
    }
    const single = input?.["rows"] === undefined;
    const source = single ? [input?.["row"]] : rowsOf(input?.["rows"]);
    const rows = source.map((row) => ({ values: bridge.readRow(row, bo), control: bridge.readControl(row, bo) }));
    const { subrc, dbcnt } = await runtime.context().tx.writeMapped(bo, operation, rows, single, isTrue(input?.["indicators"]));
    setSubrc(subrc);
    abap.builtin.sy.get().dbcnt.set(dbcnt);
  };
}
