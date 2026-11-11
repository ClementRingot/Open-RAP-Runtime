/**
 * PostgreSQL DDL from the IR (decisions D4, D8, D9): the persistent tables, then one view per
 * CDS entity (view entities first, projections on top of them). Reads of the OData service go
 * through the views; the managed runtime writes the tables. Last, the schema of the ABAP SQL of
 * the behavior pools (decision D26): the same tables and entities with their values in ABAP form.
 */

import {
  ABAP_SQL_SCHEMA,
  baseEntityOf,
  baseFieldOf,
  findEntityBehavior,
  isUuid,
  same,
  type AbapType,
  type ColumnModel,
  type EntityModel,
  type FieldModel,
  type Model,
  type TableModel,
} from "@rap-transpiler/model";
import { standardRows, standardSql } from "../standard/index.js";

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
    if (result.includes(entity) || stack.has(entity.name) || entity.sqlView === undefined || (entity.draft !== undefined && "admin" in entity.draft)) {
      return;
    }
    stack.add(entity.name);
    const source = sourceEntityOf(model, entity);
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

/**
 * The entity a view reads, undefined when it reads a table: a table entity (D55) has the name of
 * its table, a view entity on it reads the table.
 */
function sourceEntityOf(model: Model, entity: EntityModel): EntityModel | undefined {
  const source = entity.source;
  if (source === undefined || (entity.kind === "view" && model.tables.some((t) => same(t.name, source)))) {
    return undefined;
  }
  return model.entities.find((e) => same(e.name, source));
}

function createView(model: Model, entity: EntityModel): string {
  const source = entity.source ?? "";
  const sourceEntity = sourceEntityOf(model, entity);
  const from = sourceEntity?.sqlView ?? source.toLowerCase();
  const columns = entity.fields.filter((field) => field.draft !== true).map((field) => {
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
    const columns = entity.fields.filter((f) => f.draft !== true).map((f) => ({ expression: quoteIdentifier(f.name), type: f.type, name: f.name }));
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
  const schema = [header, "-- tables", ...tables, ...standardData(model), "-- compositions", ...foreignKeys(model), ...[frameworkTables(model)].filter((t) => t !== ""), ...draftTables(model), "-- CDS views", drop, ...viewStatements, ...draftViews(model), "-- ABAP SQL of the behavior pools (values in ABAP form)", ...abapSql].join("\n");
  return { schema, tables: model.tables.map((t) => t.name), views: views.map((v) => v.sqlView ?? "") };
}

/**
 * Draft (D54): one table per entity of a draft BO (its elements, named as in the base view, and the
 * draft columns), and the administrative data of the drafts.
 */
function draftTables(model: Model): string[] {
  const statements: string[] = [];
  const done = new Set<string>();
  for (const behavior of model.behaviors.filter((b) => b.implementationType === "managed" && b.draft === true)) {
    for (const entityBehavior of behavior.entities) {
      const entity = model.entities.find((e) => same(e.name, entityBehavior.entity));
      if (entity === undefined || entityBehavior.draftTable === undefined || done.has(entityBehavior.draftTable)) {
        continue;
      }
      done.add(entityBehavior.draftTable);
      const lines = entity.fields
        .filter((f) => f.draft !== true)
        .map((f) => `  ${columnDefinition({ name: f.name, type: f.type, key: f.key, notNull: f.key, client: false })}`);
      lines.push('  "DraftUUID" uuid NOT NULL', '  "HasActiveEntity" boolean NOT NULL DEFAULT false', '  "DraftEntityCreationDateTime" timestamptz(6) NOT NULL DEFAULT now()', '  "DraftEntityLastChangeDateTime" timestamptz(6) NOT NULL DEFAULT now()');
      lines.push(`  PRIMARY KEY (${entity.fields.filter((f) => f.key && f.draft !== true).map((f) => quoteIdentifier(f.name)).join(", ")})`);
      statements.push(`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(entityBehavior.draftTable)} (\n${lines.join(",\n")}\n);\nCREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${entityBehavior.draftTable}_draft_idx`)} ON ${quoteIdentifier(entityBehavior.draftTable)} ("DraftUUID");\n`);
    }
  }
  if (statements.length > 0) {
    statements.unshift("-- drafts (D54)");
    statements.push(`CREATE TABLE IF NOT EXISTS "rapt_draft_admin" (
  "DraftUUID" uuid PRIMARY KEY,
  "CreationDateTime" timestamptz(6) NOT NULL DEFAULT now(),
  "CreatedByUser" varchar(12) NOT NULL DEFAULT '',
  "LastChangeDateTime" timestamptz(6) NOT NULL DEFAULT now(),
  "LastChangedByUser" varchar(12) NOT NULL DEFAULT '',
  "InProcessByUser" varchar(12) NOT NULL DEFAULT '',
  "RootEntity" text NOT NULL DEFAULT ''
);
`);
  }
  return statements;
}

/**
 * Draft (D54): the view an exposed entity of a draft BO is read from, its active instances
 * (IsActiveEntity true, HasDraftEntity when a draft exists) and its drafts (IsActiveEntity false).
 */
function draftViews(model: Model): string[] {
  const statements: string[] = [];
  for (const entity of model.entities) {
    const draft = entity.draft;
    if (draft === undefined || "admin" in draft) {
      continue;
    }
    const fields = entity.fields.filter((f) => f.draft !== true);
    const baseName = (f: FieldModel): string => baseFieldOf(model, entity, f)?.name ?? f.name;
    const keys = fields.filter((f) => f.key);
    const exists = keys.map((k) => `d.${quoteIdentifier(baseName(k))} = a.${quoteIdentifier(k.name)}`).join(" AND ");
    statements.push(`CREATE VIEW ${quoteIdentifier(draft.view)} AS
SELECT ${fields.map((f) => `a.${quoteIdentifier(f.name)}`).join(", ")}, TRUE AS "IsActiveEntity", FALSE AS "HasActiveEntity",
  EXISTS (SELECT 1 FROM ${quoteIdentifier(draft.table)} d WHERE ${exists}) AS "HasDraftEntity", NULL::uuid AS "DraftUUID"
FROM ${quoteIdentifier(entity.sqlView ?? "")} a
UNION ALL
SELECT ${fields.map((f) => `d.${quoteIdentifier(baseName(f))} AS ${quoteIdentifier(f.name)}`).join(", ")}, FALSE, d."HasActiveEntity", FALSE, d."DraftUUID"
FROM ${quoteIdentifier(draft.table)} d;
`);
  }
  return statements.length === 0 ? [] : ["-- active instances and drafts of the exposed entities (D54)", ...statements];
}

/**
 * The reference data of the standard views (I_Currency…, D44), as SAP delivers it: inserted when
 * missing, never changed (rows added or changed by the application stay).
 */
function standardData(model: Model): string[] {
  const statements: string[] = [];
  for (const table of model.tables.filter((t) => t.standard === true)) {
    const computed = standardSql(table.name);
    if (computed !== undefined) {
      statements.push(`-- reference data of ${table.name} (standard views, D44)\n${computed}`);
      continue;
    }
    const data = standardRows(table.name);
    if (data.length === 0) {
      continue;
    }
    const columns = Object.keys(data[0] ?? {});
    const keys = table.columns.filter((c) => c.key && !c.client).map((c) => quoteIdentifier(c.name));
    const value = (v: string | number): string => (typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);
    statements.push(
      `-- reference data of ${table.name} (standard views, D44)\nINSERT INTO ${quoteIdentifier(table.name)} (${columns.map(quoteIdentifier).join(", ")}) VALUES\n${data
        .map((row) => `  (${columns.map((c) => value(row[c] ?? "")).join(", ")})`)
        .join(",\n")}\nON CONFLICT (${keys.join(", ")}) DO NOTHING;`,
    );
  }
  return statements;
}

/**
 * The tables of the services of the clean-room framework (D40): the number ranges of
 * cl_numberrange_runtime (and the intervals of rapt/number-ranges.json) and the application log
 * of cl_bali_*. A configured interval keeps its current number when its bounds change.
 */
function frameworkTables(model: Model): string {
  const numberRanges = model.services?.numberRanges === true || (model.numberRanges ?? []).length > 0;
  const applicationLog = model.services?.applicationLog === true;
  const background = model.services?.background === true;
  const mail = model.services?.mail === true;
  if (!numberRanges && !applicationLog && !background && !mail) {
    return "";
  }
  const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;
  const intervals = (model.numberRanges ?? []).map(
    (i) =>
      `INSERT INTO rapt_number_range (nr_object, nr_subobject, nr_interval, nr_toyear, from_number, to_number) VALUES (${literal(i.object)}, ${literal(i.subobject ?? "")}, ${literal(i.interval)}, ${literal(i.toyear ?? "")}, ${i.from}, ${i.to})\n  ON CONFLICT (nr_object, nr_subobject, nr_interval, nr_toyear) DO UPDATE SET from_number = excluded.from_number, to_number = excluded.to_number;`,
  );
  const parts = ["-- number ranges, application log, background processes and mails of the behavior pools (D40, D41)"];
  if (numberRanges) {
    parts.push(`CREATE TABLE IF NOT EXISTS "rapt_number_range" (
  "nr_object" text NOT NULL,
  "nr_subobject" text NOT NULL DEFAULT '',
  "nr_interval" text NOT NULL,
  "nr_toyear" text NOT NULL DEFAULT '',
  "from_number" numeric(20) NOT NULL,
  "to_number" numeric(20) NOT NULL,
  "current_number" numeric(20),
  PRIMARY KEY ("nr_object", "nr_subobject", "nr_interval", "nr_toyear")
);`, ...intervals);
  }
  if (applicationLog) {
    parts.push(`CREATE TABLE IF NOT EXISTS "rapt_application_log" (
  "log_handle" text PRIMARY KEY,
  "log_object" text NOT NULL,
  "log_subobject" text NOT NULL DEFAULT '',
  "external_id" text NOT NULL DEFAULT '',
  "log_user" text NOT NULL DEFAULT '',
  "log_timestamp" timestamptz NOT NULL DEFAULT now(),
  "expiry_date" date
);
CREATE INDEX IF NOT EXISTS "rapt_application_log_object_idx" ON "rapt_application_log" ("log_object", "log_subobject", "external_id");
CREATE TABLE IF NOT EXISTS "rapt_application_log_item" (
  "log_handle" text NOT NULL REFERENCES "rapt_application_log" ON DELETE CASCADE,
  "item_number" integer NOT NULL,
  "severity" text NOT NULL DEFAULT '',
  "category" text NOT NULL DEFAULT '',
  "message_text" text NOT NULL DEFAULT '',
  "msgid" text NOT NULL DEFAULT '',
  "msgno" text NOT NULL DEFAULT '',
  "msgv1" text NOT NULL DEFAULT '',
  "msgv2" text NOT NULL DEFAULT '',
  "msgv3" text NOT NULL DEFAULT '',
  "msgv4" text NOT NULL DEFAULT '',
  "item_timestamp" numeric(21,7),
  PRIMARY KEY ("log_handle", "item_number")
);`);
  }
  if (background) {
    parts.push(`CREATE TABLE IF NOT EXISTS "rapt_background_process" (
  "process_id" text PRIMARY KEY,
  "process_name" text NOT NULL DEFAULT '',
  "state" text NOT NULL,
  "error_text" text NOT NULL DEFAULT '',
  "process_user" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz
);`);
  }
  if (mail) {
    parts.push(`CREATE TABLE IF NOT EXISTS "rapt_mail" (
  "mail_id" text PRIMARY KEY,
  "sender" text NOT NULL,
  "recipients" text NOT NULL,
  "subject" text NOT NULL DEFAULT '',
  "raw_message" text NOT NULL,
  "state" text NOT NULL,
  "error_text" text NOT NULL DEFAULT '',
  "mail_user" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "sent_at" timestamptz
);`);
  }
  return `${parts.join("\n")}\n`;
}

/** The view of the base (view) entity behind a projection: the one the RAP runtime reads. */
export function baseViewOf(model: Model, entity: EntityModel): string | undefined {
  return baseEntityOf(model, entity).sqlView;
}
