/** ABAP dictionary of the project: tables, data elements and domains, with type resolution. */

import { sqlName, type AbapType, type ColumnModel, type EnumTypeModel, type TableModel } from "@open-rap/model";
import { catalogDataElement, ddicTypeKind, parseBuiltInType } from "../ddic/catalog.js";
import { parseCdsTypeSource, type CdsTypeSource } from "../ddic/cds-types.js";
import { readDomaXml, readDtelXml, readTablXml, type DomaXml, type DtelXml, type TablXml } from "../ddic/xml.js";
import type { Diagnostics } from "../diagnostics.js";
import { filesOfType, type Project, type SourceFile } from "../input/project.js";

export interface DataElementInfo {
  type: AbapType;
  /** Field labels of a data element defined in the sources. */
  label?: string;
  /** A CDS enumerated type (D55). */
  enum?: EnumTypeModel;
}

/** Base types of the CDS enumerated types (D55): INT1, INT2, INT4, CHAR(1..8), NUMC(1..8). */
const ENUM_BASES = new Set(["int1", "int2", "int4", "char", "numc"]);

export class Dictionary {
  private readonly tables = new Map<string, { xml: TablXml; file: SourceFile }>();
  /** CDS simple and enumerated types (D55), and their resolution (undefined: not resolvable). */
  private readonly cdsTypes = new Map<string, { source: CdsTypeSource; file: SourceFile }>();
  private readonly resolvedTypes = new Map<string, DataElementInfo | undefined>();
  /** Tables of the CDS table entities (D55). */
  private readonly entityTables = new Set<string>();
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
    for (const file of filesOfType(project, "DRTY").filter((f) => f.extension === "acds" || f.extension === "asdrty")) {
      const parsed = parseCdsTypeSource(file.content);
      for (const issue of parsed.issues) {
        diagnostics.add(issue.severity, issue.code, issue.message, { file: file.path, line: issue.line, column: issue.column });
      }
      if (parsed.type === undefined) {
        continue;
      }
      if (parsed.type.name.toUpperCase() !== file.name) {
        diagnostics.error("TYPE001", `the file defines ${parsed.type.name}, its name says ${file.name}`, { file: file.path, line: parsed.type.line, column: parsed.type.column });
      }
      this.cdsTypes.set(file.name, { source: parsed.type, file });
    }
  }

  public hasTable(name: string): boolean {
    return this.tables.has(name.toUpperCase()) || this.entityTables.has(name.toUpperCase());
  }

  /** The table of a CDS table entity (D55), known from then on like a dictionary table. */
  public registerEntityTable(table: TableModel): void {
    this.entityTables.add(table.name.toUpperCase());
    this.built.set(table.name.toUpperCase(), table);
  }

  public isEntityTable(name: string): boolean {
    return this.entityTables.has(name.toUpperCase());
  }

  /** Whether the name is a CDS simple or enumerated type of the sources (D55). */
  public isCdsType(name: string): boolean {
    return this.cdsTypes.has(name.toUpperCase());
  }

  /** The CDS types of the sources (D55): name, file and the resolved type, for the ABAP shadow types. */
  public cdsTypeEntries(): Array<{ name: string; info: DataElementInfo }> {
    const result: Array<{ name: string; info: DataElementInfo }> = [];
    for (const [name, entry] of this.cdsTypes) {
      const info = this.dataElement(name);
      if (info !== undefined) {
        result.push({ name: entry.source.name, info });
      }
    }
    return result;
  }

  /** The CDS enumerated types resolved so far (D55). */
  public enumTypes(): EnumTypeModel[] {
    return [...this.resolvedTypes.values()].flatMap((i) => (i?.enum === undefined ? [] : [i.enum])).filter((e, i, all) => all.findIndex((x) => x.name === e.name) === i);
  }

  /**
   * A CDS simple or enumerated type (D55): its base type, resolved through built-in types, data
   * elements and other CDS types; the constants of an enumerated type are checked here.
   */
  private cdsType(upper: string): DataElementInfo | undefined {
    if (this.resolvedTypes.has(upper)) {
      return this.resolvedTypes.get(upper);
    }
    const entry = this.cdsTypes.get(upper);
    if (entry === undefined) {
      return undefined;
    }
    this.resolvedTypes.set(upper, undefined); // cycles
    const { source, file } = entry;
    const at = { file: file.path, line: source.line, column: source.column };
    const baseUpper = source.base.toUpperCase();
    const base = parseBuiltInType(source.base) ?? (baseUpper === upper ? undefined : this.dataElement(baseUpper));
    if (base === undefined) {
      this.diagnostics.error("TYPE002", `${source.name}: unknown type ${source.base}`, at);
      return undefined;
    }
    const baseType = "type" in base ? base.type : base;
    const type: AbapType = { ...baseType, dataElement: upper };
    delete type.enumType;
    const info: DataElementInfo = { type };
    const label = source.label ?? ("label" in base ? base.label : undefined);
    if (label !== undefined) {
      info.label = label;
    }
    const stacked = "enum" in base ? base.enum : undefined;
    if (source.enum !== undefined) {
      const enumType = this.enumOf(source, at);
      if (enumType === undefined) {
        return undefined;
      }
      info.enum = enumType;
    } else if (stacked !== undefined) {
      // a type typed with an enumerated type is an enumerated type with the same constants
      info.enum = { ...stacked, name: source.name, ...(source.label === undefined ? {} : { label: source.label }), src: { ...at } };
    }
    if (info.enum !== undefined) {
      type.enumType = info.enum.name.toUpperCase();
    }
    this.resolvedTypes.set(upper, info);
    return info;
  }

  private enumOf(source: CdsTypeSource, at: { file: string; line: number; column: number }): EnumTypeModel | undefined {
    const constants = source.enum ?? [];
    const builtIn = parseBuiltInType(source.base);
    const length = builtIn?.length ?? 1;
    if (builtIn === undefined || !ENUM_BASES.has(builtIn.kind) || ((builtIn.kind === "char" || builtIn.kind === "numc") && (length < 1 || length > 8))) {
      this.diagnostics.error("TYPE003", `${source.name}: the base type of an enumerated type is abap.int1, abap.int2, abap.int4, abap.char(1..8) or abap.numc(1..8), not ${source.base}`, at);
      return undefined;
    }
    let ok = true;
    const initials = constants.filter((c) => c.value === "initial");
    if (initials.length !== 1) {
      this.diagnostics.error("TYPE003", `${source.name}: exactly one constant has the value initial (${initials.length} found)`, at);
      ok = false;
    }
    const enumType: EnumTypeModel = { name: source.name, base: { ...builtIn }, values: [], src: { ...at } };
    if (source.label !== undefined) {
      enumType.label = source.label;
    }
    const names = new Set<string>();
    const values = new Set<string>();
    const range: Partial<Record<AbapType["kind"], [number, number]>> = { int1: [0, 255], int2: [-32768, 32767], int4: [-2147483648, 2147483647] };
    for (const constant of constants) {
      const where = { file: at.file, line: constant.line, column: constant.column };
      let value: string | number;
      if (constant.value === "initial") {
        value = builtIn.kind === "char" ? "" : builtIn.kind === "numc" ? "0".repeat(length) : 0;
      } else if (builtIn.kind === "char" || builtIn.kind === "numc") {
        const text = String(constant.value);
        if (typeof constant.value !== "string" || text.length > length || (builtIn.kind === "numc" && !/^\d+$/.test(text))) {
          this.diagnostics.error("TYPE003", `${source.name}-${constant.name}: ${constant.literal} does not fit the base type ${source.base}`, where);
          ok = false;
          continue;
        }
        value = builtIn.kind === "numc" ? text.padStart(length, "0") : text.replace(/\s+$/, "");
      } else {
        const limits = range[builtIn.kind] ?? [0, 0];
        if (typeof constant.value !== "number" || !Number.isInteger(constant.value) || constant.value < limits[0] || constant.value > limits[1]) {
          this.diagnostics.error("TYPE003", `${source.name}-${constant.name}: ${constant.literal} does not fit the base type ${source.base}`, where);
          ok = false;
          continue;
        }
        value = constant.value;
      }
      if (names.has(constant.name.toUpperCase()) || values.has(String(value))) {
        this.diagnostics.error("TYPE003", `${source.name}-${constant.name}: constants and values are unique in an enumerated type`, where);
        ok = false;
        continue;
      }
      names.add(constant.name.toUpperCase());
      values.add(String(value));
      enumType.values.push({ name: constant.name, value, ...(constant.label === undefined ? {} : { label: constant.label }), ...(constant.value === "initial" ? { initial: true as const } : {}) });
    }
    return ok ? enumType : undefined;
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
    if (this.cdsTypes.has(upper)) {
      return this.cdsType(upper);
    }
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

  /** Names of the transparent tables of the project (not the structures). */
  public transparentTableNames(): string[] {
    return [...this.tables.values()].filter((t) => t.xml.tableClass === "TRANSP").map((t) => t.xml.name);
  }

  /**
   * The table model of a dictionary table, with diagnostics on the TABL file (or on `sink`);
   * cached.
   */
  public table(name: string, sink: Diagnostics = this.diagnostics): TableModel | undefined {
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
      const location = { file: file.path, line: file.fieldLines?.[field.fieldName] ?? lineOf(file.content, field.fieldName, index) };
      if (field.include !== undefined || field.fieldName.startsWith(".")) {
        sink.error("DDIC003", `${xml.name}: include structures (${field.fieldName} ${field.include ?? ""}) are not supported`, location);
        return;
      }
      let type: AbapType | undefined;
      if (field.rollName !== undefined && field.rollName !== "") {
        type = this.dataElement(field.rollName)?.type;
        if (type === undefined) {
          sink.error(
            "DDIC001",
            `${xml.name}-${field.fieldName}: unknown data element ${field.rollName} (add its DTEL to the sources)`,
            location,
          );
          return;
        }
      } else if (field.dataType !== undefined) {
        const kind = ddicTypeKind(field.dataType);
        if (kind === undefined) {
          sink.error("DDIC002", `${xml.name}-${field.fieldName}: unsupported data type ${field.dataType}`, location);
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
        sink.error("DDIC002", `${xml.name}-${field.fieldName}: no type`, location);
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
      sink.warning("DDIC004", `${xml.name}: table class ${xml.tableClass} handled as a transparent table`, { file: file.path, line: 1 });
    }
    const table: TableModel = { name: sqlName(xml.name), columns, src: { file: file.path, line: 1, column: 1 } };
    if (file.standard === true) {
      table.standard = true;
    }
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
