/**
 * PostgreSQL DDL from the IR (decisions D4, D8, D9): the persistent tables, then one view per
 * CDS entity (view entities first, projections on top of them). Reads of the OData service go
 * through the views; the managed runtime writes the tables. Last, the schema of the ABAP SQL of
 * the behavior pools (decision D26): the same tables and entities with their values in ABAP form.
 */

import {
  ABAP_SQL_SCHEMA,
  baseEntityOf,
  findEntityBehavior,
  isUuid,
  same,
  type AbapType,
  type ColumnModel,
  type EntityModel,
  type Model,
  type TableModel,
} from "@rap-transpiler/model";

export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** PostgreSQL column type of an ABAP type. */
export function sqlType(t: AbapType): string {
  switch (t.kind) {
    case "char":
    case "numc":
    case "sstring":
    case "cuky":
    case "unit":
    case "lang":
    case "clnt":
      return `varchar(${t.length ?? 1})`;
    case "string":
      return "text";
    case "bool":
      return "boolean";
    case "int1":
    case "int2":
      return "smallint";
    case "int4":
      return "integer";
    case "int8":
      return "bigint";
    case "dec":
    case "curr":
    case "quan":
      return `numeric(${t.length ?? 16},${t.decimals ?? 0})`;
    case "decfloat16":
    case "decfloat34":
      return "numeric";
    case "fltp":
      return "double precision";
    case "dats":
      return "date";
    case "tims":
      return "time(0)";
    case "timestamp":
      return "timestamptz(0)";
    case "timestampl":
    case "utclong":
      return "timestamptz(6)";
    case "raw":
      return isUuid(t) ? "uuid" : "bytea";
    case "rawstring":
      return "bytea";
  }
}

/**
 * ABAP has no NULL: character-like and numeric columns are NOT NULL with their initial value as
 * default. Dates, times, time stamps, UUIDs and binaries store their initial value as NULL.
 */
export function sqlDefault(t: AbapType): string | undefined {
  switch (t.kind) {
    case "numc":
      return `'${"0".repeat(t.length ?? 1)}'`;
    case "char":
    case "string":
    case "sstring":
    case "cuky":
    case "unit":
    case "lang":
    case "clnt":
      return "''";
    case "bool":
      return "false";
    case "int1":
    case "int2":
    case "int4":
    case "int8":
    case "dec":
    case "curr":
    case "quan":
    case "decfloat16":
    case "decfloat34":
    case "fltp":
      return "0";
    default:
      return undefined;
  }
}

function columnDefinition(column: ColumnModel): string {
  const parts = [quoteIdentifier(column.name), sqlType(column.type)];
  const initial = sqlDefault(column.type);
  if (column.key || initial !== undefined) {
    parts.push("NOT NULL");
  }
  if (!column.key && initial !== undefined) {
    parts.push(`DEFAULT ${initial}`);
  }
  return parts.join(" ");
}

function createTable(table: TableModel): string {
  const columns = table.columns.filter((c) => !c.client);
  const keys = columns.filter((c) => c.key).map((c) => quoteIdentifier(c.name));
  const lines = columns.map((c) => `  ${columnDefinition(c)}`);
  if (keys.length > 0) {
    lines.push(`  PRIMARY KEY (${keys.join(", ")})`);
  }
  const comment = table.description === undefined ? "" : `COMMENT ON TABLE ${quoteIdentifier(table.name)} IS '${table.description.replace(/'/g, "''")}';\n`;
  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table.name)} (\n${lines.join(",\n")}\n);\n${comment}`;
}

/** Column of the persistent table an element of a managed entity is stored in. */
export function persistedColumn(model: Model, entity: EntityModel, field: string): string | undefined {
  const lookup = findEntityBehavior(model, entity.name);
  const mapped = lookup?.entity.mapping?.fields[field];
  if (mapped !== undefined) {
    return mapped;
  }
  const f = entity.fields.find((x) => same(x.name, field));
  if (f?.column !== undefined) {
    return f.column;
  }
  return lookup?.entity.mapping?.corresponding ? field.toLowerCase() : undefined;
}

/** Foreign keys child → parent derived from the to-parent associations of managed entities. */
function foreignKeys(model: Model): string[] {
  const statements: string[] = [];
  for (const behavior of model.behaviors.filter((b) => b.implementationType === "managed")) {
    for (const child of behavior.entities) {
      const entity = model.entities.find((e) => same(e.name, child.entity));
      const toParent = entity?.associations.find((a) => a.kind === "toParent");
      const parent = toParent === undefined ? undefined : behavior.entities.find((e) => same(e.entity, toParent.target));
      const parentEntity = parent === undefined ? undefined : model.entities.find((e) => same(e.name, parent.entity));
      if (entity === undefined || toParent === undefined || parent === undefined || parentEntity === undefined) {
        continue;
      }
      if (child.persistentTable === undefined || parent.persistentTable === undefined) {
        continue;
      }
      const parentTable = model.tables.find((t) => t.name === parent.persistentTable);
      const parentKeys = parentTable?.columns.filter((c) => c.key && !c.client).map((c) => c.name) ?? [];
      const pairs = toParent.on.map((p) => ({ child: persistedColumn(model, entity, p.source), parent: persistedColumn(model, parentEntity, p.target) }));
      if (pairs.some((p) => p.child === undefined || p.parent === undefined)) {
        continue;
      }
      const referenced = pairs.map((p) => p.parent as string);
      // only a reference to the whole primary key of the parent can be a foreign key
      if (referenced.length !== parentKeys.length || !parentKeys.every((k) => referenced.includes(k))) {
        continue;
      }
      const name = `${child.persistentTable}_${toParent.name.replace(/^_/, "")}_fk`.toLowerCase().slice(0, 63);
      const childColumns = pairs.map((p) => quoteIdentifier(p.child as string)).join(", ");
      const parentColumns = pairs.map((p) => quoteIdentifier(p.parent as string)).join(", ");
      statements.push(
        `DO $$ BEGIN\n  ALTER TABLE ${quoteIdentifier(child.persistentTable)} ADD CONSTRAINT ${quoteIdentifier(name)}\n` +
          `    FOREIGN KEY (${childColumns}) REFERENCES ${quoteIdentifier(parent.persistentTable)} (${parentColumns})\n` +
          `    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;\nEXCEPTION WHEN duplicate_object THEN NULL; END $$;\n` +
          `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${name.slice(0, 59)}_idx`)} ON ${quoteIdentifier(child.persistentTable)} (${childColumns});\n`,
      );
    }
  }
  return statements;
}

/** Views in dependency order: a view entity before the projections on top of it. */
function orderedViews(model: Model): EntityModel[] {
  const result: EntityModel[] = [];
  const visit = (entity: EntityModel, stack: Set<string>): void => {
    if (result.includes(entity) || stack.has(entity.name) || entity.sqlView === undefined) {
      return;
    }
    stack.add(entity.name);
    const source = entity.source === undefined ? undefined : model.entities.find((e) => same(e.name, entity.source as string));
    if (source !== undefined) {
      visit(source, stack);
    }
    result.push(entity);
  };
  for (const entity of model.entities) {
    visit(entity, new Set());
  }
  return result;
}

function createView(model: Model, entity: EntityModel): string {
  const source = entity.source ?? "";
  const sourceEntity = model.entities.find((e) => same(e.name, source));
  const from = sourceEntity?.sqlView ?? source.toLowerCase();
  const columns = entity.fields.map((field) => {
    const expression = sourceEntity === undefined ? field.column ?? field.name.toLowerCase() : field.baseField ?? field.name;
    return `  ${quoteIdentifier(expression)} AS ${quoteIdentifier(field.name)}`;
  });
  return `CREATE VIEW ${quoteIdentifier(entity.sqlView ?? "")} AS SELECT\n${columns.join(",\n")}\nFROM ${quoteIdentifier(from)};\n`;
}

/**
 * A column in ABAP form, as the ABAP SQL generated by @abaplint/transpiler expects it (the
 * transpiler's own schemas store every value in its ABAP character or packed form). Fixed-length
 * character types become `bpchar`, whose comparisons ignore trailing blanks like ABAP; the
 * initial values that the tables store as NULL (dates, times, time stamps, UUIDs, binaries)
 * become the ABAP initial values.
 */
export function abapSqlColumn(expression: string, t: AbapType): string {
  switch (t.kind) {
    case "char":
    case "numc":
    case "cuky":
    case "unit":
    case "lang":
    case "clnt":
      return `${expression}::bpchar`;
    case "string":
    case "sstring":
      return expression;
    case "bool":
      return `(CASE WHEN ${expression} THEN 'X' ELSE '' END)::bpchar`;
    case "int1":
    case "int2":
    case "int4":
    case "int8":
    case "dec":
    case "curr":
    case "quan":
    case "decfloat16":
    case "decfloat34":
    case "fltp":
      return expression;
    case "dats":
      return `coalesce(to_char(${expression}, 'YYYYMMDD'), '00000000')::bpchar`;
    case "tims":
      return `coalesce(to_char(${expression}, 'HH24MISS'), '000000')::bpchar`;
    case "timestamp":
      return `coalesce(to_char(${expression} AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS')::numeric(15,0), 0)`;
    case "timestampl":
      return `coalesce(to_char(${expression} AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS.US')::numeric(21,7), 0)`;
    case "utclong":
      return `coalesce(to_char(${expression} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '')`;
    case "raw":
      return isUuid(t)
        ? `coalesce(upper(replace(${expression}::text, '-', '')), '${"0".repeat(32)}')::bpchar`
        : `coalesce(upper(encode(${expression}, 'hex')), '${"0".repeat(2 * (t.length ?? 1))}')::bpchar`;
    case "rawstring":
      return `coalesce(upper(encode(${expression}, 'hex')), '')`;
  }
}

/** Name of the view of a table or CDS entity in the ABAP SQL schema (`abap.buildDbTableName`). */
export function abapSqlView(name: string): string {
  return `${quoteIdentifier(ABAP_SQL_SCHEMA)}.${quoteIdentifier(name.toLowerCase())}`;
}

function abapSqlViewStatement(name: string, columns: Array<{ expression: string; type: AbapType; name: string }>, from: string): string {
  const list = columns.map((c) => `  ${abapSqlColumn(c.expression, c.type)} AS ${quoteIdentifier(c.name.toLowerCase())}`);
  return `CREATE VIEW ${abapSqlView(name)} AS SELECT\n${list.join(",\n")}\nFROM ${quoteIdentifier(from)};\n`;
}

/** Functions from the ABAP form back to the column types, for the writes of the savers. */
const ABAP_SQL_FUNCTIONS = (schema: string): string => `CREATE FUNCTION ${schema}."to_date"(v text) RETURNS date LANGUAGE sql IMMUTABLE AS
  $f$ SELECT CASE WHEN coalesce(btrim(v), '') IN ('', '00000000') THEN NULL ELSE to_date(v, 'YYYYMMDD') END $f$;
CREATE FUNCTION ${schema}."to_time"(v text) RETURNS time LANGUAGE sql IMMUTABLE AS
  $f$ SELECT CASE WHEN coalesce(btrim(v), '') = '' THEN NULL ELSE to_timestamp(v, 'HH24MISS')::time END $f$;
CREATE FUNCTION ${schema}."to_timestamp"(v numeric) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
  $f$ SELECT CASE WHEN coalesce(v, 0) = 0 THEN NULL ELSE make_timestamptz(
    substr(lpad(trunc(v)::text, 14, '0'), 1, 4)::int, substr(lpad(trunc(v)::text, 14, '0'), 5, 2)::int,
    substr(lpad(trunc(v)::text, 14, '0'), 7, 2)::int, substr(lpad(trunc(v)::text, 14, '0'), 9, 2)::int,
    substr(lpad(trunc(v)::text, 14, '0'), 11, 2)::int, (substr(lpad(trunc(v)::text, 14, '0'), 13, 2)::numeric + (v - trunc(v)))::double precision,
    'UTC') END $f$;
CREATE FUNCTION ${schema}."to_utclong"(v text) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
  $f$ SELECT CASE WHEN coalesce(btrim(v), '') = '' THEN NULL ELSE (v || 'Z')::timestamptz END $f$;
CREATE FUNCTION ${schema}."to_uuid"(v text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $f$ SELECT CASE WHEN coalesce(btrim(v), '') = '' OR btrim(v) ~ '^0+$' THEN NULL ELSE btrim(v)::uuid END $f$;
CREATE FUNCTION ${schema}."to_bytea"(v text) RETURNS bytea LANGUAGE sql IMMUTABLE AS
  $f$ SELECT CASE WHEN coalesce(btrim(v), '') = '' OR btrim(v) ~ '^0+$' THEN NULL ELSE decode(btrim(v), 'hex') END $f$;
`;

/** A value in ABAP form (a column of the ABAP SQL views) as the value of the table column. */
export function nativeSqlValue(expression: string, t: AbapType): string {
  const schema = quoteIdentifier(ABAP_SQL_SCHEMA);
  switch (t.kind) {
    case "char":
    case "sstring":
    case "cuky":
    case "unit":
    case "lang":
    case "clnt":
      return `coalesce(${expression}::text, '')`;
    case "numc":
      return `coalesce(nullif(btrim(${expression}::text), ''), '${"0".repeat(t.length ?? 1)}')`;
    case "string":
      return `coalesce(${expression}::text, '')`;
    case "bool":
      return `(coalesce(btrim(${expression}::text), '') <> '')`;
    case "int1":
    case "int2":
    case "int4":
    case "int8":
    case "dec":
    case "curr":
    case "quan":
    case "decfloat16":
    case "decfloat34":
    case "fltp":
      return `coalesce(${expression}, 0)`;
    case "dats":
      return `${schema}."to_date"(${expression}::text)`;
    case "tims":
      return `${schema}."to_time"(${expression}::text)`;
    case "timestamp":
    case "timestampl":
      return `${schema}."to_timestamp"(${expression}::numeric)`;
    case "utclong":
      return `${schema}."to_utclong"(${expression}::text)`;
    case "raw":
      return isUuid(t) ? `${schema}."to_uuid"(${expression}::text)` : `${schema}."to_bytea"(${expression}::text)`;
    case "rawstring":
      return `${schema}."to_bytea"(${expression}::text)`;
  }
}

/**
 * The view of a table takes the writes of the savers (INSERT, UPDATE, DELETE of the ABAP SQL):
 * an INSTEAD OF trigger writes the table, the values converted back from their ABAP form.
 */
function abapSqlWriteTrigger(table: TableModel): string {
  const schema = quoteIdentifier(ABAP_SQL_SCHEMA);
  const columns = table.columns.filter((c) => !c.client);
  const keys = columns.filter((c) => c.key);
  const name = quoteIdentifier(`${table.name.toLowerCase()}$write`);
  const value = (row: "NEW" | "OLD", c: (typeof columns)[number]): string => nativeSqlValue(`${row}.${quoteIdentifier(c.name.toLowerCase())}`, c.type);
  const where = keys.map((k) => `${quoteIdentifier(k.name)} = ${value("OLD", k)}`).join(" AND ");
  const target = quoteIdentifier(table.name);
  return [
    `CREATE FUNCTION ${schema}.${name}() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $f$`,
    "BEGIN",
    "  IF TG_OP = 'INSERT' THEN",
    `    INSERT INTO ${target} (${columns.map((c) => quoteIdentifier(c.name)).join(", ")})`,
    `      VALUES (${columns.map((c) => value("NEW", c)).join(", ")});`,
    "    RETURN NEW;",
    "  ELSIF TG_OP = 'UPDATE' THEN",
    `    UPDATE ${target} SET ${columns.map((c) => `${quoteIdentifier(c.name)} = ${value("NEW", c)}`).join(", ")}`,
    `      WHERE ${where};`,
    "    RETURN NEW;",
    "  END IF;",
    `  DELETE FROM ${target} WHERE ${where};`,
    "  RETURN OLD;",
    "END $f$;",
    `CREATE TRIGGER ${name} INSTEAD OF INSERT OR UPDATE OR DELETE ON ${abapSqlView(table.name)} FOR EACH ROW EXECUTE FUNCTION ${schema}.${name}();`,
    "",
  ].join("\n");
}

/**
 * The schema of the ABAP SQL of the behavior pools: one view per table (without the client
 * column, decision D9), with a trigger that takes the writes of the savers, and one view per CDS
 * entity, column names in lower case. Recreated with the schema.
 */
function abapSqlSchema(model: Model, views: EntityModel[]): string[] {
  const statements = [`DROP SCHEMA IF EXISTS ${quoteIdentifier(ABAP_SQL_SCHEMA)} CASCADE;\nCREATE SCHEMA ${quoteIdentifier(ABAP_SQL_SCHEMA)};\n`, ABAP_SQL_FUNCTIONS(quoteIdentifier(ABAP_SQL_SCHEMA))];
  for (const table of model.tables) {
    const columns = table.columns.filter((c) => !c.client).map((c) => ({ expression: quoteIdentifier(c.name), type: c.type, name: c.name }));
    statements.push(abapSqlViewStatement(table.name, columns, table.name));
    if (table.columns.some((c) => c.key && !c.client)) {
      statements.push(abapSqlWriteTrigger(table));
    }
  }
  const tables = new Set(model.tables.map((t) => t.name.toLowerCase()));
  for (const entity of views) {
    if (tables.has(entity.name.toLowerCase())) {
      continue;
    }
    const columns = entity.fields.map((f) => ({ expression: quoteIdentifier(f.name), type: f.type, name: f.name }));
    statements.push(abapSqlViewStatement(entity.name, columns, entity.sqlView ?? ""));
  }
  return statements;
}

export interface SqlOutput {
  /** The whole idempotent script: tables, foreign keys, views, the ABAP SQL schema. */
  schema: string;
  tables: string[];
  views: string[];
}

export function generateSql(model: Model): SqlOutput {
  const header = [
    "-- Generated by rap-transpiler: do not edit.",
    `-- Service ${model.service.name}. Applying this script twice is harmless.`,
    "",
  ].join("\n");
  const tables = model.tables.map(createTable);
  const views = orderedViews(model);
  const drop = views.length === 0 ? "" : `DROP VIEW IF EXISTS ${[...views].reverse().map((v) => quoteIdentifier(v.sqlView ?? "")).join(", ")} CASCADE;\n`;
  const viewStatements = views.map((v) => createView(model, v));
  const abapSql = abapSqlSchema(model, views);
  const schema = [header, "-- tables", ...tables, "-- compositions", ...foreignKeys(model), "-- CDS views", drop, ...viewStatements, "-- ABAP SQL of the behavior pools (values in ABAP form)", ...abapSql].join("\n");
  return { schema, tables: model.tables.map((t) => t.name), views: views.map((v) => v.sqlView ?? "") };
}

/** The view of the base (view) entity behind a projection: the one the RAP runtime reads. */
export function baseViewOf(model: Model, entity: EntityModel): string | undefined {
  return baseEntityOf(model, entity).sqlView;
}
