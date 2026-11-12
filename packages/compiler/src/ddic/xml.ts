/** Readers of the abapGit XML serializations: TABL, DTEL, DOMA, MSAG, SRVB. */

import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ["DD03P", "item", "T100", "DD07V"].includes(name),
});

type XmlObject = Record<string, unknown>;

function values(xml: string): XmlObject | undefined {
  const doc = parser.parse(xml) as XmlObject;
  const root = (doc["abapGit"] ?? doc) as XmlObject;
  const abap = root["asx:abap"] as XmlObject | undefined;
  return abap?.["asx:values"] as XmlObject | undefined;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const int = (v: unknown): number | undefined => {
  const s = str(v);
  return s === undefined || s === "" ? undefined : Number.parseInt(s, 10);
};

export interface Dd03pField {
  fieldName: string;
  key: boolean;
  notNull: boolean;
  rollName?: string;
  dataType?: string;
  length?: number;
  decimals?: number;
  refTable?: string;
  refField?: string;
  compType?: string;
  /** The line is an `.INCLUDE` of a structure. */
  include?: string;
}

export interface TablXml {
  name: string;
  description?: string;
  tableClass: string;
  fields: Dd03pField[];
}

export function readTablXml(xml: string): TablXml | undefined {
  const v = values(xml);
  const dd02v = v?.["DD02V"] as XmlObject | undefined;
  if (dd02v === undefined) {
    return undefined;
  }
  const lines = ((v?.["DD03P_TABLE"] as XmlObject | undefined)?.["DD03P"] as XmlObject[] | undefined) ?? [];
  const fields: Dd03pField[] = lines.map((line) => {
    const fieldName = str(line["FIELDNAME"]) ?? "";
    const field: Dd03pField = { fieldName, key: str(line["KEYFLAG"]) === "X", notNull: str(line["NOTNULL"]) === "X" };
    const set = <K extends keyof Dd03pField>(k: K, value: Dd03pField[K] | undefined): void => {
      if (value !== undefined) {
        field[k] = value;
      }
    };
    set("rollName", str(line["ROLLNAME"]));
    set("dataType", str(line["DATATYPE"]));
    set("length", int(line["LENG"]));
    set("decimals", int(line["DECIMALS"]));
    set("refTable", str(line["REFTABLE"]));
    set("refField", str(line["REFFIELD"]));
    set("compType", str(line["COMPTYPE"]));
    if (fieldName.startsWith(".INCLU")) {
      set("include", str(line["PRECFIELD"]) ?? str(line["ROLLNAME"]));
    }
    return field;
  });
  const result: TablXml = { name: str(dd02v["TABNAME"]) ?? "", tableClass: str(dd02v["TABCLASS"]) ?? "TRANSP", fields };
  const description = str(dd02v["DDTEXT"]);
  if (description !== undefined) {
    result.description = description;
  }
  return result;
}

export interface DtelXml {
  name: string;
  domain?: string;
  dataType?: string;
  length?: number;
  decimals?: number;
  labels: { short?: string; medium?: string; long?: string; heading?: string; description?: string };
}

export function readDtelXml(xml: string): DtelXml | undefined {
  const dd04v = values(xml)?.["DD04V"] as XmlObject | undefined;
  if (dd04v === undefined) {
    return undefined;
  }
  const result: DtelXml = { name: str(dd04v["ROLLNAME"]) ?? "", labels: {} };
  const domain = str(dd04v["DOMNAME"]);
  if (domain !== undefined && domain !== "") {
    result.domain = domain;
  }
  const dataType = str(dd04v["DATATYPE"]);
  if (dataType !== undefined) {
    result.dataType = dataType;
  }
  const length = int(dd04v["LENG"]);
  if (length !== undefined) {
    result.length = length;
  }
  const decimals = int(dd04v["DECIMALS"]);
  if (decimals !== undefined) {
    result.decimals = decimals;
  }
  const label = (k: string): string | undefined => str(dd04v[k]);
  const labels: DtelXml["labels"] = {};
  const short = label("SCRTEXT_S");
  const medium = label("SCRTEXT_M");
  const long = label("SCRTEXT_L");
  const heading = label("REPTEXT");
  const description = label("DDTEXT");
  if (short !== undefined) labels.short = short;
  if (medium !== undefined) labels.medium = medium;
  if (long !== undefined) labels.long = long;
  if (heading !== undefined) labels.heading = heading;
  if (description !== undefined) labels.description = description;
  result.labels = labels;
  return result;
}

export interface DomaXml {
  name: string;
  dataType: string;
  length?: number;
  decimals?: number;
  conversionExit?: string;
  fixedValues: Array<{ low: string; text?: string }>;
}

export function readDomaXml(xml: string): DomaXml | undefined {
  const v = values(xml);
  const dd01v = v?.["DD01V"] as XmlObject | undefined;
  if (dd01v === undefined) {
    return undefined;
  }
  const result: DomaXml = { name: str(dd01v["DOMNAME"]) ?? "", dataType: str(dd01v["DATATYPE"]) ?? "CHAR", fixedValues: [] };
  const length = int(dd01v["LENG"]);
  if (length !== undefined) {
    result.length = length;
  }
  const decimals = int(dd01v["DECIMALS"]);
  if (decimals !== undefined) {
    result.decimals = decimals;
  }
  const exit = str(dd01v["CONVEXIT"]);
  if (exit !== undefined && exit !== "") {
    result.conversionExit = exit;
  }
  const fixed = ((v?.["DD07V_TAB"] as XmlObject | undefined)?.["DD07V"] as XmlObject[] | undefined) ?? [];
  for (const f of fixed) {
    const low = str(f["DOMVALUE_L"]);
    if (low !== undefined) {
      const entry: { low: string; text?: string } = { low };
      const text = str(f["DDTEXT"]);
      if (text !== undefined) {
        entry.text = text;
      }
      result.fixedValues.push(entry);
    }
  }
  return result;
}

/** Message class texts: number → text (`&1`…`&4` placeholders kept). */
export function readMsagXml(xml: string): { name: string; texts: Record<string, string> } | undefined {
  const v = values(xml);
  const header = v?.["T100A"] as XmlObject | undefined;
  const lines = ((v?.["T100"] as XmlObject[] | undefined)?.[0]?.["T100"] as XmlObject[] | undefined) ?? [];
  if (header === undefined) {
    return undefined;
  }
  const texts: Record<string, string> = {};
  const master = str(header["MASTERLANG"]) ?? "E";
  for (const line of lines) {
    const language = str(line["SPRSL"]) ?? master;
    const number = str(line["MSGNR"]);
    const text = str(line["TEXT"]);
    if (number !== undefined && text !== undefined && (language === master || texts[number] === undefined)) {
      texts[number] = text;
    }
  }
  return { name: str(header["ARBGB"]) ?? "", texts };
}

export interface SrvbXml {
  name?: string;
  serviceDefinition?: string;
  version?: string;
  bindingType?: string;
  bindingVersion?: string;
  /** BINDING_TYPE_CATEGORY: 0 UI, 1 Web API (D60). */
  bindingCategory?: string;
}

/** Tolerant reader: looks for the binding facts wherever the serialization puts them. */
export function readSrvbXml(xml: string): SrvbXml {
  const result: SrvbXml = {};
  const find = (o: unknown, key: string): string | undefined => {
    if (o === null || typeof o !== "object") {
      return undefined;
    }
    for (const [k, value] of Object.entries(o as XmlObject)) {
      if (k === key && str(value) !== undefined) {
        return str(value);
      }
    }
    for (const value of Object.values(o as XmlObject)) {
      const found = find(value, key);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  };
  const doc = parser.parse(xml) as XmlObject;
  const name = find(doc, "NAME");
  if (name !== undefined) result.name = name;
  const srvd = find(doc, "SERVICE_DEFINITION");
  if (srvd !== undefined) result.serviceDefinition = srvd;
  const version = find(doc, "SERVICE_VERSION");
  if (version !== undefined) result.version = version.padStart(4, "0");
  const bindingType = find(doc, "BINDING_TYPE");
  if (bindingType !== undefined) result.bindingType = bindingType;
  const bindingVersion = find(doc, "BINDING_TYPE_VERSION");
  if (bindingVersion !== undefined) result.bindingVersion = bindingVersion;
  const bindingCategory = find(doc, "BINDING_TYPE_CATEGORY");
  if (bindingCategory !== undefined) result.bindingCategory = bindingCategory;
  // ADT serializations: srvb:version="0001", adtcore:name="ZUI_X" in the service definition reference
  if (result.version === undefined) {
    const m = /srvb:version="(\d{1,4})"/.exec(xml);
    if (m?.[1] !== undefined) result.version = m[1].padStart(4, "0");
  }
  if (result.serviceDefinition === undefined) {
    const m = /<srvb:serviceDefinition[^>]*adtcore:name="([^"]+)"/.exec(xml);
    if (m?.[1] !== undefined) result.serviceDefinition = m[1];
  }
  return result;
}
