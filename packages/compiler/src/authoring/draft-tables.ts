/**
 * The draft tables of a draft BO for an SAP system (D99). Open RAP Runtime creates its draft tables
 * itself (D54), so a project names them in its BDEF (`draft table zrt_d_travel`) without defining
 * them; SAP needs them as DDIC tables. As the ABAP keyword documentation asks: a client field
 * first, a field for each field of the CDS entity, named as its element and of the same type, and
 * the draft admin include `SYCH_BDL_DRAFT_ADMIN_INC`.
 */

import { getAnnotation, type AbapType, type EntityModel, type Model } from "@open-rap/model";
import { parseTableSource, tableSourceToXml } from "../ddic/table-source.js";

/** The draft tables the BDEFs name and the project does not define: abapGit file name and XML. */
export function draftTableFiles(model: Model, defined: Set<string>): Array<{ name: string; fileName: string; content: string; errors: string[] }> {
  const result: Array<{ name: string; fileName: string; content: string; errors: string[] }> = [];
  for (const behavior of model.behaviors.filter((b) => b.draft === true)) {
    for (const entity of behavior.entities) {
      const table = entity.draftTable?.toLowerCase();
      if (table === undefined || defined.has(table.toUpperCase()) || result.some((r) => r.name === table.toUpperCase())) {
        continue;
      }
      const cds = model.entities.find((e) => e.name.toUpperCase() === entity.entity.toUpperCase());
      if (cds === undefined) {
        continue;
      }
      const source = draftTableSource(table, cds);
      const parsed = parseTableSource(source);
      const errors = parsed.issues.filter((i) => i.severity === "error").map((i) => `${table}: ${i.message} (line ${i.line})`);
      const xml = parsed.table === undefined ? "" : withAdminGroup(tableSourceToXml(parsed.table));
      result.push({ name: table.toUpperCase(), fileName: `${table}.tabl.xml`, content: xml, errors });
    }
  }
  return result;
}

/** The source of the draft table of an entity, in the syntax of `define table`. */
export function draftTableSource(table: string, entity: EntityModel): string {
  const fields = entity.fields.filter((f) => f.draft !== true);
  const width = Math.max(6, ...fields.map((f) => f.name.length)) + 4;
  const lines = [
    `@EndUserText.label : '${`Draft of ${entity.name}`.slice(0, 60)}'`,
    "@AbapCatalog.enhancement.category : #EXTENSIBLE_ANY",
    "@AbapCatalog.tableCategory : #TRANSPARENT",
    "@AbapCatalog.deliveryClass : #A",
    "@AbapCatalog.dataMaintenance : #RESTRICTED",
    `define table ${table} {`,
    `  ${"key client".padEnd(width)} : abap.clnt not null;`,
  ];
  for (const field of fields) {
    const name = field.name.toLowerCase();
    const reference = refOf(entity, field.annotations);
    if (reference !== undefined) {
      lines.push(`  @Semantics.${field.type.kind === "quan" ? "quantity.unitOfMeasure" : "amount.currencyCode"} : '${table}.${reference.toLowerCase()}'`);
    }
    lines.push(`  ${`${field.key ? "key " : ""}${name}`.padEnd(width)} : ${typeText(field.type)}${field.key ? " not null" : ""};`);
  }
  // the admin include (its group %ADMIN is added to the XML: the table source has no named include)
  lines.push("  include sych_bdl_draft_admin_inc;", "}");
  return `${lines.join("\n")}\n`;
}

/** The currency or unit element of an amount or quantity. */
function refOf(entity: EntityModel, annotations: EntityModel["fields"][number]["annotations"]): string | undefined {
  const value = getAnnotation(annotations, "Semantics.amount.currencyCode") ?? getAnnotation(annotations, "Semantics.quantity.unitOfMeasure");
  if (typeof value !== "string") {
    return undefined;
  }
  return entity.fields.find((f) => f.name.toUpperCase() === value.toUpperCase())?.name ?? value;
}

/** The type of a field of the draft table: its data element, else the built-in DDIC type. */
function typeText(t: AbapType): string {
  if (t.dataElement !== undefined && t.enumType === undefined) {
    return t.dataElement.toLowerCase();
  }
  const n = t.length ?? 1;
  const d = t.decimals ?? 0;
  switch (t.kind) {
    case "char":
      return `abap.char(${n})`;
    case "numc":
      return `abap.numc(${n})`;
    case "string":
      return "abap.string(0)";
    case "sstring":
      return `abap.sstring(${n})`;
    case "dec":
    case "curr":
    case "quan":
      return `abap.${t.kind}(${n},${d})`;
    case "int1":
    case "int2":
    case "int4":
    case "int8":
    case "fltp":
    case "dats":
    case "tims":
    case "utclong":
    case "lang":
    case "clnt":
      return `abap.${t.kind}`;
    case "decfloat16":
      return "abap.d16n";
    case "decfloat34":
      return "abap.d34n";
    case "timestamp":
      return "timestamp";
    case "timestampl":
      return "timestampl";
    case "raw":
      return `abap.raw(${n})`;
    case "rawstring":
      return "abap.rawstring(0)";
    case "cuky":
      return "abap.cuky";
    case "unit":
      return `abap.unit(${n})`;
    case "bool":
      return "abap_boolean";
  }
}

/** The include of the draft admin data is the group %ADMIN, as ADT writes it. */
function withAdminGroup(xml: string): string {
  return xml.replace(/(<PRECFIELD>SYCH_BDL_DRAFT_ADMIN_INC<\/PRECFIELD>)/, "$1\n     <GROUPNAME>%ADMIN</GROUPNAME>");
}
