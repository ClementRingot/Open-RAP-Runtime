/**
 * Naming conventions shared by the compiler (which generates the artifacts) and the runtime
 * (which addresses them).
 */

/** FNV-1a hash, 8 hex characters: stable short names for long or namespaced identifiers. */
export function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const ABAP_NAME_MAX = 30;

/** Name of the generated ABAP interface holding the derived types of a BDEF. */
export function derivedTypesInterfaceName(bdefName: string): string {
  const upper = bdefName.toUpperCase();
  const plain = `ZRAP_DT_${upper}`;
  if (plain.length <= ABAP_NAME_MAX && /^[A-Z0-9_]+$/.test(upper)) {
    return plain;
  }
  return `ZRAP_DT_${shortHash(upper).toUpperCase()}`;
}

/**
 * Names of the derived types inside the generated interface. Entities, associations and actions
 * are numbered from 1 in BDEF order, which keeps every name within the 30 characters of ABAP.
 */
export const derivedType = {
  key: (e: number) => `ts_e${e}_key`,
  pky: (e: number) => `ts_e${e}_pky`,
  tky: (e: number) => `ts_e${e}_tky`,
  data: (e: number) => `ts_e${e}_data`,
  control: (e: number) => `ts_e${e}_ctl`,
  element: (e: number) => `ts_e${e}_elem`,
  fieldControl: (e: number) => `ts_e${e}_fc`,
  path: (e: number) => `ts_e${e}_path`,
  create: (e: number) => `tt_e${e}_cre`,
  createRow: (e: number) => `ts_e${e}_cre`,
  update: (e: number) => `tt_e${e}_upd`,
  updateRow: (e: number) => `ts_e${e}_upd`,
  delete: (e: number) => `tt_e${e}_del`,
  change: (e: number) => `tt_e${e}_chg`,
  changeRow: (e: number) => `ts_e${e}_chg`,
  readImport: (e: number) => `tt_e${e}_rimp`,
  readResult: (e: number) => `tt_e${e}_rres`,
  readResultRow: (e: number) => `ts_e${e}_rres`,
  keys: (e: number) => `tt_e${e}_keys`,
  lock: (e: number) => `tt_e${e}_lock`,
  assocCreate: (e: number, b: number) => `tt_e${e}_b${b}_cre`,
  assocTarget: (e: number, b: number) => `tt_e${e}_b${b}_tgt`,
  assocReadImport: (e: number, b: number) => `tt_e${e}_b${b}_rimp`,
  assocReadResult: (e: number, b: number) => `tt_e${e}_b${b}_rres`,
  assocLink: (e: number, b: number) => `tt_e${e}_b${b}_link`,
  actionImport: (e: number, a: number) => `tt_e${e}_a${a}_imp`,
  actionResult: (e: number, a: number) => `tt_e${e}_a${a}_res`,
  actionParam: (e: number, a: number) => `ts_e${e}_a${a}_par`,
  globalAuthRequest: (e: number) => `ts_e${e}_gauth_req`,
  globalAuthResult: (e: number) => `ts_e${e}_gauth_res`,
  instanceAuthRequest: (e: number) => `ts_e${e}_iauth_req`,
  instanceAuthResult: (e: number) => `tt_e${e}_iauth_res`,
  globalFeaturesRequest: (e: number) => `ts_e${e}_gfeat_req`,
  globalFeaturesResult: (e: number) => `ts_e${e}_gfeat_res`,
  instanceFeaturesRequest: (e: number) => `ts_e${e}_ifeat_req`,
  instanceFeaturesResult: (e: number) => `tt_e${e}_ifeat_res`,
  numbering: (e: number) => `tt_e${e}_num`,
  failedRows: (e: number) => `tt_e${e}_failed`,
  reportedRows: (e: number) => `tt_e${e}_reported`,
  mappedRows: (e: number) => `tt_e${e}_mapped`,
  failedEarly: "ts_failed_early",
  failedLate: "ts_failed_late",
  reportedEarly: "ts_reported_early",
  reportedLate: "ts_reported_late",
  mappedEarly: "ts_mapped_early",
  mappedLate: "ts_mapped_late",
  requestChange: "ts_request_change",
  requestDelete: "ts_request_delete",
} as const;

/** ABAP component name of a CDS element or alias: ABAP is case-insensitive, the runtime uses lower case. */
export function abapName(name: string): string {
  return name.toLowerCase();
}

/** SQL name (lower case) of a dictionary table or CDS entity. */
export function sqlName(name: string): string {
  return name.toLowerCase();
}

/**
 * Schema of the views that give the ABAP SQL of the behavior pools the tables and CDS entities with
 * their values in ABAP form (decision D26): dates `YYYYMMDD`, UUIDs as 32 hexadecimal digits,
 * booleans `X`, time stamps as packed numbers.
 */
export const ABAP_SQL_SCHEMA = "rapt_abap";

/** Default service path, the one of an OData V4 RAP service binding. */
export function defaultServicePath(binding: string, serviceDefinition: string, version: string): string {
  return `/sap/opu/odata4/sap/${binding.toLowerCase()}/srvd/sap/${serviceDefinition.toLowerCase()}/${version}/`;
}

/** Namespace of the OData schema of a RAP service: com.sap.gateway.srvd.<srvd>.v<version>. */
export function serviceNamespace(serviceDefinition: string, version: string): string {
  return `com.sap.gateway.srvd.${serviceDefinition.toLowerCase().replace(/\//g, "")}.v${version}`;
}

/**
 * The environment variables of a destination of the behavior pools (D31), without their
 * `DESTINATION_` prefix and `_URL` suffix: the name of create_by_cloud_destination, or the
 * communication scenario of create_by_comm_arrangement (`SCENARIO.SERVICE`: the service first,
 * then the scenario), in upper case, other characters than letters and digits as `_`.
 */
export function destinationKeys(name: string): string[] {
  const variable = (text: string): string => text.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const [first = "", ...rest] = name.split(".");
  return rest.length === 0 ? [variable(first)] : [variable(`${first}_${rest.join("_")}`), variable(first)];
}

/** The claims of the token that the values of the roles read: `{claim:agency}` → agency (D34). */
export function authorizationClaims(authorizations: { roles: Array<{ authorizations: Array<{ fields: Record<string, Array<string | { from: string; to: string }>> }> }> } | undefined): string[] {
  const names = new Set<string>();
  for (const role of authorizations?.roles ?? []) {
    for (const authorization of role.authorizations) {
      for (const values of Object.values(authorization.fields)) {
        for (const value of values) {
          const claim = typeof value === "string" ? /^\{claim:([^}]+)\}$/.exec(value)?.[1] : undefined;
          if (claim !== undefined) {
            names.add(claim);
          }
        }
      }
    }
  }
  return [...names];
}
