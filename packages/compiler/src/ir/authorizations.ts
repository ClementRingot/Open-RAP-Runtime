/**
 * Authorizations of the application (decision D34): the authorization objects of the sources
 * (SUSO objects of abapGit) and the roles of `rapt/authorizations.json`, next to the abapGit
 * sources — the counterpart of the IAM apps, business catalogs and business roles of the ABAP
 * environment: each role of the identity provider gives authorizations, instances of
 * authorization objects with field values, that AUTHORITY-CHECK and the access controls read.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as abaplint from "@abaplint/core";
import { XMLParser } from "fast-xml-parser";
import type { AuthorizationObjectModel, AuthorizationsModel, AuthorizationValue, RoleModel } from "@open-rap-runtime/model";
import type { Diagnostics } from "../diagnostics.js";
import { filesOfType, type Project } from "../input/project.js";

/** The file of the roles, relative to the root of the abapGit project. */
export const AUTHORIZATIONS_FILE = "rapt/authorizations.json";

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true, isArray: (name) => name === "TACTZ" || name === "TOBJT" });

/** An authorization object from its abapGit serialization (TOBJ: FIEL1…FIEL0, TACTZ: activities). */
export function readSusoXml(xml: string): AuthorizationObjectModel | undefined {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const values = ((doc["abapGit"] as Record<string, unknown> | undefined)?.["asx:abap"] as Record<string, unknown> | undefined)?.["asx:values"] as Record<string, unknown> | undefined;
  const tobj = values?.["TOBJ"] as Record<string, unknown> | undefined;
  const name = typeof tobj?.["OBJCT"] === "string" ? tobj["OBJCT"].toUpperCase() : undefined;
  if (tobj === undefined || name === undefined) {
    return undefined;
  }
  const fields = ["FIEL1", "FIEL2", "FIEL3", "FIEL4", "FIEL5", "FIEL6", "FIEL7", "FIEL8", "FIEL9", "FIEL0"].map((f) => tobj[f]).filter((f): f is string => typeof f === "string" && f !== "").map((f) => f.toUpperCase());
  const object: AuthorizationObjectModel = { name, fields };
  // TACTZ is a table of rows (TACTZ inside TACTZ in the serialization)
  const activities = ((values?.["TACTZ"] as unknown[] | undefined) ?? [])
    .flatMap((t) => (Array.isArray((t as Record<string, unknown>)["TACTZ"]) ? ((t as Record<string, unknown>)["TACTZ"] as unknown[]) : [t]))
    .map((row) => (row as Record<string, unknown>)["ACTVT"])
    .filter((a): a is string => typeof a === "string");
  if (activities.length > 0) {
    object.activities = activities;
  }
  const text = ((values?.["TOBJT"] as Array<Record<string, unknown>> | undefined) ?? []).find((t) => typeof t["TTEXT"] === "string")?.["TTEXT"];
  if (typeof text === "string") {
    object.description = text;
  }
  return object;
}

const isValue = (v: unknown): v is AuthorizationValue =>
  typeof v === "string" || (typeof v === "object" && v !== null && typeof (v as { from?: unknown }).from === "string" && typeof (v as { to?: unknown }).to === "string");

/**
 * The authorization objects of the sources and the roles of rapt/authorizations.json, checked
 * against each other; undefined when the project has neither.
 */
export function loadAuthorizations(project: Project, diagnostics: Diagnostics): AuthorizationsModel | undefined {
  const objects = new Map<string, AuthorizationObjectModel>();
  for (const file of filesOfType(project, "SUSO").filter((f) => f.extension === "xml")) {
    const object = readSusoXml(file.content);
    if (object === undefined) {
      diagnostics.error("AUTH001", "unreadable authorization object", { file: file.path, line: 1 });
      continue;
    }
    objects.set(object.name, object);
  }
  const file = path.join(project.root, AUTHORIZATIONS_FILE);
  if (!existsSync(file)) {
    return objects.size === 0 ? undefined : { objects: [...objects.values()], roles: [] };
  }
  const at = { file: AUTHORIZATIONS_FILE, line: 1 };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    diagnostics.error("AUTH001", `${AUTHORIZATIONS_FILE} is not valid JSON: ${(error as Error).message}`, at);
    return undefined;
  }
  const root = json as { objects?: unknown; roles?: unknown };
  // objects declared in the file (authorization objects that are not in the sources)
  for (const [name, value] of Object.entries((root.objects ?? {}) as Record<string, unknown>)) {
    const fields = (value as { fields?: unknown })?.fields;
    if (!Array.isArray(fields) || !fields.every((f) => typeof f === "string")) {
      diagnostics.error("AUTH001", `objects.${name}: "fields" must be a list of field names`, at);
      continue;
    }
    if (!objects.has(name.toUpperCase())) {
      const object: AuthorizationObjectModel = { name: name.toUpperCase(), fields: (fields as string[]).map((f) => f.toUpperCase()) };
      const activities = (value as { activities?: unknown }).activities;
      if (Array.isArray(activities)) {
        object.activities = activities.map(String);
      }
      objects.set(object.name, object);
    }
  }
  if (typeof root.roles !== "object" || root.roles === null || Array.isArray(root.roles)) {
    diagnostics.error("AUTH001", `${AUTHORIZATIONS_FILE}: "roles" must be an object (role name → authorizations)`, at);
    return undefined;
  }
  const roles: RoleModel[] = [];
  for (const [name, value] of Object.entries(root.roles as Record<string, unknown>)) {
    const definition = value as { description?: unknown; authorizations?: unknown };
    if (!Array.isArray(definition?.authorizations)) {
      diagnostics.error("AUTH001", `roles.${name}: "authorizations" must be a list`, at);
      continue;
    }
    const role: RoleModel = { name, authorizations: [] };
    if (typeof definition.description === "string") {
      role.description = definition.description;
    }
    for (const [i, entry] of (definition.authorizations as unknown[]).entries()) {
      const where = `roles.${name}.authorizations[${i}]`;
      const authorization = entry as { object?: unknown; fields?: unknown };
      if (typeof authorization?.object !== "string" || typeof authorization.fields !== "object" || authorization.fields === null) {
        diagnostics.error("AUTH001", `${where}: an authorization has an "object" and "fields"`, at);
        continue;
      }
      const objectName = authorization.object.toUpperCase();
      const object = objects.get(objectName);
      if (object === undefined) {
        diagnostics.warning("AUTH002", `${where}: the authorization object ${objectName} is neither in the sources (SUSO) nor in "objects"; its fields are not checked`, at);
      }
      const fields: Record<string, AuthorizationValue[]> = {};
      for (const [field, raw] of Object.entries(authorization.fields as Record<string, unknown>)) {
        const values = Array.isArray(raw) ? raw : [raw];
        if (!values.every(isValue)) {
          diagnostics.error("AUTH001", `${where}.fields.${field}: a value is a string ("02", "07*", "*", "{claim:agency}") or a range {"from", "to"}`, at);
          continue;
        }
        const upper = field.toUpperCase();
        if (object !== undefined && !object.fields.includes(upper)) {
          diagnostics.error("AUTH003", `${where}: ${objectName} has no field ${upper} (fields: ${object.fields.join(", ")})`, at);
          continue;
        }
        if (upper === "ACTVT" && object?.activities !== undefined) {
          const unknown = values.filter((v): v is string => typeof v === "string" && !v.includes("*") && !v.startsWith("{") && !object.activities?.includes(v));
          if (unknown.length > 0) {
            diagnostics.warning("AUTH004", `${where}: ${objectName} does not permit the activities ${unknown.join(", ")}`, at);
          }
        }
        fields[upper] = values;
      }
      role.authorizations.push({ object: objectName, fields });
    }
    roles.push(role);
  }
  return { objects: [...objects.values()], roles };
}

/**
 * The AUTHORITY-CHECK statements of the ABAP code: an authorization object of the sources must
 * have the fields the statement checks (ABP010), and an unknown object is reported (ABP011).
 */
export function checkAuthorityChecks(registry: abaplint.IRegistry, project: Project, authorizations: AuthorizationsModel | undefined, diagnostics: Diagnostics): void {
  const objects = new Map((authorizations?.objects ?? []).map((o) => [o.name, o]));
  for (const object of registry.getObjects()) {
    if (!(object instanceof abaplint.ABAPObject)) {
      continue;
    }
    for (const file of object.getABAPFiles()) {
      const source = project.files.find((f) => f.fileName === file.getFilename());
      if (source === undefined) {
        continue;
      }
      for (const statement of file.getStatements()) {
        if (!(statement.get() instanceof abaplint.Statements.AuthorityCheck)) {
          continue;
        }
        const text = statement.concatTokens();
        const at = { file: source.path, line: statement.getStart().getRow(), column: statement.getStart().getCol() };
        const name = /\bOBJECT\s+'([^']+)'/i.exec(text)?.[1]?.toUpperCase();
        if (name === undefined) {
          continue;
        }
        const known = objects.get(name);
        if (known === undefined) {
          diagnostics.warning("ABP011", `AUTHORITY-CHECK OBJECT '${name}': the authorization object is neither in the sources (SUSO) nor in ${AUTHORIZATIONS_FILE}; no role grants it, the check fails`, at);
          continue;
        }
        for (const id of [...text.matchAll(/\bID\s+'([^']+)'/gi)].map((m) => (m[1] ?? "").toUpperCase())) {
          if (!known.fields.includes(id)) {
            diagnostics.error("ABP010", `AUTHORITY-CHECK OBJECT '${name}': the object has no field ${id} (fields: ${known.fields.join(", ")})`, at);
          }
        }
      }
    }
  }
}
