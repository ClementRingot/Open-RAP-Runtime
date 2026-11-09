/**
 * "Shadow" dictionary objects given to the transpiler (decision D19): the tables of the model,
 * with built-in types only, so that neither the standard data elements of SAP (ABP_*,
 * SYSUUID_X16…) nor CDS associations are needed to type the ABAP code.
 */

import type { AbapType, TableModel } from "@rap-transpiler/model";
import { catalogDataElements } from "../../ddic/catalog.js";

export interface ShadowFile {
  fileName: string;
  content: string;
}

/** DDIC built-in type of an ABAP type: DATATYPE, LENG, DECIMALS. */
function ddicType(t: AbapType): { datatype: string; length?: number; decimals?: number } {
  switch (t.kind) {
    case "char":
      return { datatype: "CHAR", length: t.length ?? 1 };
    case "numc":
      return { datatype: "NUMC", length: t.length ?? 1 };
    case "string":
      return { datatype: "STRING" };
    case "sstring":
      return { datatype: "SSTRING", length: t.length ?? 255 };
    case "dec":
      return { datatype: "DEC", length: t.length ?? 16, decimals: t.decimals ?? 0 };
    case "curr":
      return { datatype: "CURR", length: t.length ?? 16, decimals: t.decimals ?? 2 };
    case "quan":
      return { datatype: "QUAN", length: t.length ?? 13, decimals: t.decimals ?? 3 };
    case "cuky":
      return { datatype: "CUKY", length: 5 };
    case "unit":
      return { datatype: "UNIT", length: t.length ?? 3 };
    case "lang":
      return { datatype: "LANG", length: 1 };
    case "clnt":
      return { datatype: "CLNT", length: 3 };
    case "bool":
      return { datatype: "CHAR", length: 1 };
    case "int1":
      return { datatype: "INT1" };
    case "int2":
      return { datatype: "INT2" };
    case "int4":
      return { datatype: "INT4" };
    case "int8":
      return { datatype: "INT8" };
    case "fltp":
      return { datatype: "FLTP" };
    case "decfloat16":
      return { datatype: "D16D" };
    case "decfloat34":
      return { datatype: "D34D" };
    case "dats":
      return { datatype: "DATS" };
    case "tims":
      return { datatype: "TIMS" };
    case "timestamp":
      return { datatype: "DEC", length: 15, decimals: 0 };
    case "timestampl":
      return { datatype: "DEC", length: 21, decimals: 7 };
    case "utclong":
      return { datatype: "UTCLONG" };
    case "raw":
      return { datatype: "RAW", length: t.length ?? 1 };
    case "rawstring":
      return { datatype: "RAWSTRING" };
  }
}

const pad = (n: number): string => String(n).padStart(6, "0");

const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const encode = (name: string): string => name.toLowerCase().replace(/\//g, "#");

/** A data element with a predefined type. */
export function shadowDataElement(name: string, type: AbapType, text = name): ShadowFile {
  const t = ddicType(type);
  const content = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DTEL" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD04V>
    <ROLLNAME>${escape(name.toUpperCase())}</ROLLNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <DDTEXT>${escape(text)}</DDTEXT>
    <DATATYPE>${t.datatype}</DATATYPE>
${t.length === undefined ? "" : `    <LENG>${pad(t.length)}</LENG>\n`}${t.decimals === undefined ? "" : `    <DECIMALS>${pad(t.decimals)}</DECIMALS>\n`}   </DD04V>
  </asx:values>
 </asx:abap>
</abapGit>
`;
  return { fileName: `${encode(name)}.dtel.xml`, content };
}

/** Message types of the T100 framework (if_t100_message), with predefined types. */
const MESSAGE_ELEMENTS: Array<[string, AbapType, string]> = [
  ["SYMSGID", { kind: "char", length: 20 }, "Message class"],
  ["SYMSGNO", { kind: "numc", length: 3 }, "Message number"],
  ["SYMSGV", { kind: "char", length: 50 }, "Message variable"],
  ["SYMSGTY", { kind: "char", length: 1 }, "Message type"],
  ["SCX_ATTRNAME", { kind: "char", length: 30 }, "Attribute name of an exception"],
  ["SOTR_CONC", { kind: "char", length: 32 }, "Text key of an exception"],
];

/**
 * The dictionary of the clean-room framework: the standard data elements of the catalog and the
 * types of the T100 messages. Objects of the project with the same name take precedence.
 */
export function frameworkDictionary(projectObjects: Set<string>): ShadowFile[] {
  const files: ShadowFile[] = [];
  const add = (key: string, file: ShadowFile): void => {
    if (!projectObjects.has(key)) {
      files.push(file);
    }
  };
  for (const [name, type] of catalogDataElements()) {
    if (name !== "STRING") {
      add(`DTEL:${name}`, shadowDataElement(name, type));
    }
  }
  for (const [name, type, text] of MESSAGE_ELEMENTS) {
    add(`DTEL:${name}`, shadowDataElement(name, type, text));
  }
  add(
    "TABL:SCX_T100KEY",
    shadowTable({
      name: "scx_t100key",
      description: "Key of a T100 message of an exception",
      structure: true,
      columns: [
        { name: "msgid", type: { kind: "char", length: 20 }, key: false, notNull: false, client: false },
        { name: "msgno", type: { kind: "numc", length: 3 }, key: false, notNull: false, client: false },
        ...[1, 2, 3, 4].map((n) => ({ name: `attr${n}`, type: { kind: "char" as const, length: 30 }, key: false, notNull: false, client: false })),
      ],
    }),
  );
  return files;
}

export function shadowTable(table: TableModel & { structure?: boolean }): ShadowFile {
  const fields = table.columns.map((column) => {
    const t = ddicType(column.type);
    return [
      "    <DD03P>",
      `     <FIELDNAME>${escape(column.name.toUpperCase())}</FIELDNAME>`,
      column.key ? "     <KEYFLAG>X</KEYFLAG>" : "",
      `     <DATATYPE>${t.datatype}</DATATYPE>`,
      t.length === undefined ? "" : `     <LENG>${pad(t.length)}</LENG>`,
      t.decimals === undefined ? "" : `     <DECIMALS>${pad(t.decimals)}</DECIMALS>`,
      column.notNull ? "     <NOTNULL>X</NOTNULL>" : "",
      "    </DD03P>",
    ]
      .filter((l) => l !== "")
      .join("\n");
  });
  const content = `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_TABL" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD02V>
    <TABNAME>${escape(table.name.toUpperCase())}</TABNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <TABCLASS>${table.structure === true ? "INTTAB" : "TRANSP"}</TABCLASS>
    <DDTEXT>${escape(table.description ?? table.name)}</DDTEXT>
    <CONTFLAG>A</CONTFLAG>
   </DD02V>
   <DD03P_TABLE>
${fields.join("\n")}
   </DD03P_TABLE>
  </asx:values>
 </asx:abap>
</abapGit>
`;
  return { fileName: `${encode(table.name)}.tabl.xml`, content };
}
