/**
 * "Shadow" dictionary objects given to the transpiler (decision D19): the tables of the model,
 * with built-in types only, so that neither the standard data elements of SAP (ABP_*,
 * SYSUUID_X16…) nor CDS associations are needed to type the ABAP code.
 */

import type { AbapType, TableModel } from "@rap-transpiler/model";

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

export function shadowTable(table: TableModel): ShadowFile {
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
    <TABCLASS>TRANSP</TABCLASS>
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
  return { fileName: `${table.name.toLowerCase().replace(/\//g, "#")}.tabl.xml`, content };
}
