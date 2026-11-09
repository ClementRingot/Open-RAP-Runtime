/** ABAP dictionary of the project: tables, data elements and domains, with type resolution. */

import { sqlName, type AbapType, type ColumnModel, type TableModel } from "@rap-transpiler/model";
import { catalogDataElement, ddicTypeKind } from "../ddic/catalog.js";
import { readDomaXml, readDtelXml, readTablXml, type DomaXml, type DtelXml, type TablXml } from "../ddic/xml.js";
import type { Diagnostics } from "../diagnostics.js";
import { filesOfType, type Project, type SourceFile } from "../input/project.js";

export interface DataElementInfo {
  type: AbapType;
  /** Field labels of a data element defined in the sources. */
  label?: string;
}

export class Dictionary {
  private readonly tables = new Map<string, { xml: TablXml; file: SourceFile }>();
  private readonly dataElements = new Map<string, { xml: DtelXml; file: SourceFile }>();
  private readonly domains = new Map<string, { xml: DomaXml; file: SourceFile }>();
  private readonly built = new Map<string, TableModel | undefined>();

  public constructor(
    project: Project,
    private readonly diagnostics: Diagnostics,
  ) {
    for (const file of filesOfType(project, "TABL").filter((f) => f.extension === "xml")) {
      const xml = readTablXml(file.content);
      if (xml === undefined) {
        diagnostics.error("DDIC010", "the table definition (DD02V) could not be read", { file: file.path, line: 1 });
      } else {
        this.tables.set(xml.name.toUpperCase(), { xml, file });
      }
    }
    for (const file of filesOfType(project, "DTEL").filter((f) => f.extension === "xml")) {
      const xml = readDtelXml(file.content);
      if (xml !== undefined) {
        this.dataElements.set(xml.name.toUpperCase(), { xml, file });
      }
    }
    for (const file of filesOfType(project, "DOMA").filter((f) => f.extension === "xml")) {
      const xml = readDomaXml(file.content);
      if (xml !== undefined) {
        this.domains.set(xml.name.toUpperCase(), { xml, file });
      }
    }
  }

  public hasTable(name: string): boolean {
    return this.tables.has(name.toUpperCase());
  }

  public tableFile(name: string): SourceFile | undefined {
    return this.tables.get(name.toUpperCase())?.file;
  }

  public builtTables(): TableModel[] {
    return [...this.built.values()].filter((t): t is TableModel => t !== undefined);
  }

  /** The type of a data element: from the sources, else from the catalog of standard ones. */
  public dataElement(name: string): DataElementInfo | undefined {
    const upper = name.toUpperCase();
    const local = this.dataElements.get(upper);
    if (local !== undefined) {
      const { xml } = local;
      let kindSource = xml.dataType;
      let length = xml.length;
      let decimals = xml.decimals;
      if (xml.domain !== undefined) {
        const domain = this.domains.get(xml.domain.toUpperCase());
        const standard = catalogDataElement(xml.domain);
        if (domain !== undefined) {
          kindSource = domain.xml.dataType;
          length = domain.xml.length;
          decimals = domain.xml.decimals;
        } else if (standard !== undefined) {
          return withLabel({ ...standard, dataElement: upper }, xml);
        }
      }
      const kind = kindSource === undefined ? undefined : ddicTypeKind(kindSource);
      if (kind === undefined) {
        return undefined;
      }
      const type: AbapType = { kind, dataElement: upper };
      if (length !== undefined && length > 0) {
        type.length = length;
      }
      if (decimals !== undefined && decimals > 0) {
        type.decimals = decimals;
      }
      // a local data element on a standard time stamp or boolean domain keeps its semantics
      const semantic = xml.domain === undefined ? undefined : catalogDataElement(xml.domain);
      if (semantic !== undefined && ["timestamp", "timestampl", "bool", "utclong"].includes(semantic.kind)) {
        type.kind = semantic.kind;
      }
      return withLabel(type, xml);
    }
    const standard = catalogDataElement(upper);
    return standard === undefined ? undefined : { type: standard };
  }

  /** The table model of a dictionary table, with diagnostics on the TABL file; cached. */
  public table(name: string): TableModel | undefined {
    const upper = name.toUpperCase();
    if (this.built.has(upper)) {
      return this.built.get(upper);
    }
    const entry = this.tables.get(upper);
    if (entry === undefined) {
      this.built.set(upper, undefined);
      return undefined;
    }
    const { xml, file } = entry;
    const columns: ColumnModel[] = [];
    xml.fields.forEach((field, index) => {
      const location = { file: file.path, line: lineOf(file.content, field.fieldName, index) };
      if (field.include !== undefined || field.fieldName.startsWith(".")) {
        this.diagnostics.error("DDIC003", `${xml.name}: include structures (${field.fieldName} ${field.include ?? ""}) are not supported`, location);
        return;
      }
      let type: AbapType | undefined;
      if (field.rollName !== undefined && field.rollName !== "") {
        type = this.dataElement(field.rollName)?.type;
        if (type === undefined) {
          this.diagnostics.error(
            "DDIC001",
            `${xml.name}-${field.fieldName}: unknown data element ${field.rollName} (add its DTEL to the sources)`,
            location,
          );
          return;
        }
      } else if (field.dataType !== undefined) {
        const kind = ddicTypeKind(field.dataType);
        if (kind === undefined) {
          this.diagnostics.error("DDIC002", `${xml.name}-${field.fieldName}: unsupported data type ${field.dataType}`, location);
          return;
        }
        type = { kind };
        if (field.length !== undefined && field.length > 0) {
          type.length = field.length;
        }
        if (field.decimals !== undefined && field.decimals > 0) {
          type.decimals = field.decimals;
        }
      } else {
        this.diagnostics.error("DDIC002", `${xml.name}-${field.fieldName}: no type`, location);
        return;
      }
      const column: ColumnModel = {
        name: field.fieldName.toLowerCase(),
        type,
        key: field.key,
        notNull: field.notNull || field.key,
        client: type.kind === "clnt",
      };
      if (field.refTable !== undefined && field.refField !== undefined) {
        column.reference = { table: field.refTable.toLowerCase(), field: field.refField.toLowerCase() };
      }
      columns.push(column);
    });
    if (xml.tableClass !== "TRANSP") {
      this.diagnostics.warning("DDIC004", `${xml.name}: table class ${xml.tableClass} handled as a transparent table`, { file: file.path, line: 1 });
    }
    const table: TableModel = { name: sqlName(xml.name), columns, src: { file: file.path, line: 1, column: 1 } };
    if (xml.description !== undefined) {
      table.description = xml.description;
    }
    this.built.set(upper, table);
    return table;
  }
}

function withLabel(type: AbapType, xml: DtelXml): DataElementInfo {
  const label = xml.labels.medium ?? xml.labels.long ?? xml.labels.short ?? xml.labels.description;
  return label === undefined ? { type } : { type, label };
}

function lineOf(content: string, fieldName: string, fallbackIndex: number): number {
  const lines = content.split("\n");
  const index = lines.findIndex((l) => l.includes(`<FIELDNAME>${fieldName}</FIELDNAME>`));
  return index >= 0 ? index + 1 : fallbackIndex + 1;
}
