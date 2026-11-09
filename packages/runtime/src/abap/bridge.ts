/**
 * The bridge between the managed runtime (canonical rows, JavaScript responses) and the
 * transpiled behavior pool (ABAP data objects of the derived types, handler methods).
 */

import { pathToFileURL } from "node:url";
import path from "node:path";
import { abapName, type HandlerRef, type FieldModel } from "@rap-transpiler/model";
import type { User } from "../auth/user.js";
import type { BoEntity, BoModel } from "../rap/bo.js";
import { FAIL_CAUSES, Responses, type FailedOperation, type Message, type ReportedEntry, type Row, type Severity } from "../rap/types.js";
import { abapGlobal, abapString, appendRow, component, getAbapValue, isFlagOn, rowsOf, setAbapValue, setFlag, type AbapData } from "./convert.js";

/** Imports the transpiled modules (`abap/init.mjs` sets the global `abap` object). */
export async function loadAbap(abapDir: string, entry = "init.mjs"): Promise<void> {
  await import(pathToFileURL(path.resolve(abapDir, entry)).href);
  abapGlobal();
}

const LANGUAGES: Record<string, string> = { en: "E", de: "D", fr: "F", es: "S", it: "I", pt: "P", nl: "N", ja: "J", zh: "1", ru: "R", pl: "L", cs: "C", da: "K", fi: "U", sv: "V", tr: "T", ko: "3" };

/** Sets the system fields the ABAP code reads (sy-uname, sy-datum, sy-uzeit, sy-langu). */
export function setSystemFields(user: User, language: string, now = new Date()): void {
  const sy = abapGlobal().builtin.sy.get();
  sy.uname.set(user.abapName);
  const iso = now.toISOString();
  sy.datum.set(iso.slice(0, 10).replace(/-/g, ""));
  sy.uzeit.set(iso.slice(11, 19).replace(/:/g, ""));
  sy.langu.set(LANGUAGES[language.slice(0, 2).toLowerCase()] ?? "E");
}

export function setSubrc(value: number): void {
  abapGlobal().builtin.sy.get().subrc.set(value);
}

export type MessageTexts = Record<string, Record<string, string>>;

/** T100 text with its placeholders (`&1`…`&4`, `&`) replaced. */
export function formatT100(texts: MessageTexts, id: string, number: string, vars: string[]): string {
  const text = texts[id.toUpperCase()]?.[number.padStart(3, "0")];
  if (text === undefined) {
    return `${id} ${number}${vars.some((v) => v !== "") ? ` ${vars.join(" ")}`.trimEnd() : ""}`;
  }
  let next = 0;
  return text.replace(/&(\d)|&/g, (_match, n: string | undefined) => {
    const value = n === undefined ? vars[next++] : vars[Number(n) - 1];
    return value ?? "";
  });
}

export class AbapBridge {
  public constructor(
    private readonly bo: BoModel,
    private readonly texts: MessageTexts,
  ) {}

  public iface(bo: BoEntity): AbapData {
    const iface = abapGlobal().Classes[bo.iface];
    if (iface === undefined) {
      throw new Error(`derived types ${bo.iface} not loaded`);
    }
    return iface;
  }

  /** A new data object of a derived type (`tt_e1_keys`…). */
  public data(bo: BoEntity, typeName: string): AbapData {
    const type = this.iface(bo)[typeName];
    if (type === undefined) {
      throw new Error(`derived type ${bo.iface}=>${typeName} not found`);
    }
    return type.clone();
  }

  // -------------------------------------------------------------------------------------------
  // rows

  /** Sets the fields of `row` (all, or the given ones) in an ABAP structure that has them. */
  public fillRow(target: AbapData, bo: BoEntity, row: Row, fields?: Iterable<string>): void {
    const names = fields === undefined ? bo.fields.map((f) => f.name) : [...fields];
    for (const name of names) {
      const field = this.bo.field(bo, name);
      const data = field === undefined ? undefined : component(target, field.name);
      if (field !== undefined && data !== undefined && name in row) {
        setAbapValue(data, field.type, row[field.name]);
      }
    }
  }

  public fillKey(target: AbapData, bo: BoEntity, key: Row): void {
    this.fillRow(target, bo, key, bo.keys.map((k) => k.name));
  }

  public readRow(source: AbapData, bo: BoEntity, fields?: Iterable<string>): Row {
    const row: Row = {};
    const list: FieldModel[] = fields === undefined ? bo.fields : [...fields].map((n) => this.bo.field(bo, n)).filter((f): f is FieldModel => f !== undefined);
    for (const field of list) {
      const data = component(source, field.name);
      if (data !== undefined) {
        row[field.name] = getAbapValue(data, field.type);
      }
    }
    return row;
  }

  public readKey(source: AbapData, bo: BoEntity): Row {
    return this.readRow(source, bo, bo.keys.map((k) => k.name));
  }

  /** Fields flagged in the `%control` component of a row; undefined when the row has none. */
  public readControl(source: AbapData, bo: BoEntity): Set<string> | undefined {
    const control = component(source, "%control");
    if (control === undefined) {
      return undefined;
    }
    const fields = new Set<string>();
    for (const field of bo.fields) {
      if (isFlagOn(component(control, field.name))) {
        fields.add(field.name);
      }
    }
    return fields;
  }

  public fillControl(target: AbapData, bo: BoEntity, fields: Iterable<string>): void {
    const control = component(target, "%control");
    if (control === undefined) {
      return;
    }
    for (const name of fields) {
      setFlag(component(control, name), true);
    }
  }

  public readText(source: AbapData, name: string): string {
    return abapString(component(source, name));
  }

  /** The fields of a parameter structure (`%param`) of an abstract entity. */
  public readParameter(source: AbapData, fields: FieldModel[]): Row {
    const param = component(source, "%param");
    const row: Row = {};
    if (param === undefined) {
      return row;
    }
    for (const field of fields) {
      const data = component(param, field.name);
      if (data !== undefined) {
        row[field.name] = getAbapValue(data, field.type);
      }
    }
    return row;
  }

  public fillParameter(target: AbapData, fields: FieldModel[], values: Row): void {
    const param = component(target, "%param");
    if (param === undefined) {
      return;
    }
    for (const field of fields) {
      const data = component(param, field.name);
      if (data !== undefined && field.name in values) {
        setAbapValue(data, field.type, values[field.name]);
      }
    }
  }

  /** A table of keys (`tt_eN_keys` or another table with the key fields) from canonical keys. */
  public keysTable(bo: BoEntity, keys: Row[], typeName = `tt_e${bo.index}_keys`): AbapData {
    const table = this.data(bo, typeName);
    for (const key of keys) {
      appendRow(table, (row) => this.fillKey(row, bo, key));
    }
    return table;
  }

  // -------------------------------------------------------------------------------------------
  // responses

  /** `ts_failed_early`, `ts_reported_late`… of the BDEF of `bo`. */
  public response(bo: BoEntity, kind: "failed" | "reported" | "mapped", late = false): AbapData {
    return this.data(bo, `ts_${kind}_${late ? "late" : "early"}`);
  }

  private entitiesOf(bo: BoEntity): BoEntity[] {
    return this.bo.entities.filter((e) => e.bdef === bo.bdef);
  }

  /** Reads the ABAP responses of a handler or of an EML statement. */
  public async readResponses(bo: BoEntity, failed?: AbapData, reported?: AbapData, mapped?: AbapData): Promise<Responses> {
    const responses = new Responses();
    for (const entity of this.entitiesOf(bo)) {
      const alias = abapName(entity.behavior.alias);
      for (const row of rowsOf(failed === undefined ? undefined : component(failed, alias))) {
        const fail = component(row, "%fail");
        const cause = FAIL_CAUSES[parseInt(String(fail === undefined ? "0" : component(fail, "cause")?.get() ?? "0"), 16)] ?? "unspecific";
        const entry: Responses["failed"][number] = { entity: entity.entity.name, key: this.readKey(row, entity), cause };
        const cid = this.readText(row, "%cid");
        if (cid !== "") {
          entry.cid = cid;
        }
        const operation = this.failedOperation(row, entity);
        if (operation !== undefined) {
          entry.operation = operation;
        }
        responses.failed.push(entry);
      }
      for (const row of rowsOf(reported === undefined ? undefined : component(reported, alias))) {
        const message = await this.message(component(row, "%msg"));
        if (message === undefined) {
          continue;
        }
        const elements: string[] = [];
        const element = component(row, "%element");
        if (element !== undefined) {
          for (const name of Object.keys(element.get())) {
            if (isFlagOn(component(element, name))) {
              elements.push(entity.fields.find((f) => abapName(f.name) === name)?.name ?? entity.associations.find((a) => abapName(a.name) === name)?.name ?? name);
            }
          }
        }
        const key = this.readKey(row, entity);
        const hasKey = Object.values(key).some((v) => v !== null && v !== "" && v !== false && !/^0+$/.test(String(v)));
        const entry: ReportedEntry = { entity: entity.entity.name, message, elements, global: isFlagOn(component(row, "%global")) };
        if (hasKey) {
          entry.key = key;
        }
        const cid = this.readText(row, "%cid");
        if (cid !== "") {
          entry.cid = cid;
        }
        const stateArea = this.readText(row, "%state_area");
        if (stateArea !== "") {
          entry.stateArea = stateArea;
        }
        responses.reported.push(entry);
      }
      for (const row of rowsOf(mapped === undefined ? undefined : component(mapped, alias))) {
        responses.mapped.push({ entity: entity.entity.name, cid: this.readText(row, "%cid"), key: this.readKey(row, entity) });
      }
    }
    for (const ref of rowsOf(reported === undefined ? undefined : component(reported, "%other"))) {
      const message = await this.message(ref);
      if (message !== undefined) {
        responses.reported.push({ message, elements: [], global: true });
      }
    }
    return responses;
  }

  private failedOperation(row: AbapData, bo: BoEntity): FailedOperation | undefined {
    for (const kind of ["create", "update", "delete"] as const) {
      if (isFlagOn(component(row, `%${kind}`))) {
        return { kind };
      }
    }
    const action = component(row, "%action");
    for (const a of bo.behavior.actions) {
      if (action !== undefined && isFlagOn(component(action, a.name))) {
        return { kind: "action", name: a.name };
      }
    }
    const assoc = component(row, "%assoc");
    for (const a of bo.associations) {
      if (assoc !== undefined && isFlagOn(component(assoc, a.name))) {
        return { kind: "association", name: a.name };
      }
    }
    return undefined;
  }

  /** Text and severity of a message object (`%msg`, an ABAP reference). */
  public async message(ref: AbapData | undefined): Promise<Message | undefined> {
    const object = ref?.get?.();
    if (object === undefined || object === null) {
      return undefined;
    }
    const severity = (abapString(object["if_abap_behv_message$m_severity"]) || "E") as Severity;
    let text = "";
    for (const method of ["if_message$get_text", "if_abap_behv_message$get_text", "get_text"]) {
      if (typeof object[method] === "function") {
        text = abapString(await object[method]({}));
        break;
      }
    }
    const message: Message = { severity, text };
    const key = this.t100Key(object);
    if (key !== undefined) {
      message.msgid = key.msgid;
      message.msgno = key.msgno;
    }
    return message;
  }

  /** A message object for the ABAP code (`%msg` of the responses the kernel writes). */
  public async messageObject(message: Message): Promise<AbapData> {
    const abap = abapGlobal();
    const MessageClass = abap.Classes["ZRAP_CL_MESSAGE"];
    const object = await new MessageClass().constructor_({
      severity: new abap.types.Character(1).set(message.severity),
      text: new abap.types.String().set(message.text),
    });
    const ref = new abap.types.ABAPObject();
    ref.set(object);
    return ref;
  }

  /** Writes responses into the ABAP response structures of an EML statement (cleared first). */
  public async writeResponses(bo: BoEntity, responses: Responses, failed?: AbapData, reported?: AbapData, mapped?: AbapData): Promise<void> {
    failed?.clear();
    reported?.clear();
    mapped?.clear();
    const entities = this.entitiesOf(bo);
    const entityOf = (name: string | undefined): BoEntity | undefined => entities.find((e) => e.entity.name === name);
    for (const entry of responses.failed) {
      const entity = entityOf(entry.entity);
      const table = entity === undefined || failed === undefined ? undefined : component(failed, abapName(entity.behavior.alias));
      if (entity === undefined || table === undefined) {
        continue;
      }
      appendRow(table, (row) => {
        if (entry.key !== undefined) {
          this.fillKey(row, entity, entry.key);
        }
        component(row, "%cid")?.set(entry.cid ?? "");
        const fail = component(row, "%fail");
        component(fail, "cause")?.set(`0${FAIL_CAUSES.indexOf(entry.cause)}`);
        const operation = entry.operation;
        if (operation?.kind === "create" || operation?.kind === "update" || operation?.kind === "delete") {
          setFlag(component(row, `%${operation.kind}`), true);
        } else if (operation?.kind === "action") {
          const action = component(row, "%action");
          setFlag(action === undefined ? undefined : component(action, operation.name), true);
        } else if (operation?.kind === "association") {
          const assoc = component(row, "%assoc");
          setFlag(assoc === undefined ? undefined : component(assoc, operation.name), true);
        }
      });
    }
    for (const entry of responses.reported) {
      const entity = entityOf(entry.entity);
      const msg = await this.messageObject(entry.message);
      if (entity === undefined) {
        const other = reported === undefined ? undefined : component(reported, "%other");
        if (other !== undefined) {
          other.append(msg);
        }
        continue;
      }
      const table = reported === undefined ? undefined : component(reported, abapName(entity.behavior.alias));
      if (table === undefined) {
        continue;
      }
      appendRow(table, (row) => {
        if (entry.key !== undefined) {
          this.fillKey(row, entity, entry.key);
        }
        component(row, "%cid")?.set(entry.cid ?? "");
        component(row, "%msg")?.set(msg);
        const element = component(row, "%element");
        for (const name of entry.elements) {
          setFlag(element === undefined ? undefined : component(element, name), true);
        }
        setFlag(component(row, "%global"), entry.global);
      });
    }
    for (const entry of responses.mapped) {
      const entity = entityOf(entry.entity);
      const table = entity === undefined || mapped === undefined ? undefined : component(mapped, abapName(entity.behavior.alias));
      if (entity === undefined || table === undefined) {
        continue;
      }
      appendRow(table, (row) => {
        this.fillKey(row, entity, entry.key);
        component(row, "%cid")?.set(entry.cid);
      });
    }
  }

  // -------------------------------------------------------------------------------------------
  // handlers

  /** Calls a handler method of a local class of the behavior pool. */
  public async call(ref: HandlerRef, params: Record<string, AbapData>): Promise<void> {
    const Class = abapGlobal().Classes[ref.classKey];
    if (Class === undefined) {
      throw new Error(`handler class ${ref.classKey} is not loaded`);
    }
    const instance = await new Class().constructor_();
    const friends = instance.FRIENDS_ACCESS_INSTANCE as Record<string, (input: unknown) => Promise<unknown>> | undefined;
    const method = friends?.[ref.method] ?? (typeof instance[ref.method] === "function" ? instance[ref.method].bind(instance) : undefined);
    if (method === undefined) {
      throw new Error(`handler method ${ref.className}->${ref.method} not found`);
    }
    await method(params);
  }

  public t100(id: string, number: string, vars: string[]): string {
    return formatT100(this.texts, id, number, vars);
  }

  /** The T100 message key of a message object (`if_t100_message~t100key`), if it has one. */
  public t100Key(object: AbapData): { msgid: string; msgno: string; attributes: string[] } | undefined {
    const key = object?.["if_t100_message$t100key"];
    if (key === undefined) {
      return undefined;
    }
    const msgid = abapString(component(key, "msgid"));
    if (msgid === "") {
      return undefined;
    }
    return { msgid, msgno: abapString(component(key, "msgno")), attributes: [1, 2, 3, 4].map((n) => abapString(component(key, `attr${n}`))) };
  }

  /** Text of an exception: its T100 message with the attributes named by attr1…attr4. */
  public exceptionText(object: AbapData): string {
    const key = this.t100Key(object);
    if (key === undefined) {
      return "An exception was raised";
    }
    const vars = key.attributes.map((name) => {
      if (name === "") {
        return "";
      }
      const attribute = object[name.toLowerCase().replace(/~/g, "$")];
      return attribute === undefined ? name : abapString(attribute);
    });
    return this.t100(key.msgid, key.msgno, vars);
  }
}
