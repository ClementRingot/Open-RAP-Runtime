/**
 * The environment of the cloud platform (decision D50). On Cloud Foundry (SAP BTP), the platform
 * gives the URL of the application (`VCAP_APPLICATION`) and the credentials of the bound services
 * (`VCAP_SERVICES`): a PostgreSQL service gives `DATABASE_URL` (and `DATABASE_CA`), the first route
 * `PUBLIC_URL`. A variable set explicitly always wins.
 */

export type Environment = Record<string, string | undefined>;

interface BoundService {
  label?: string;
  name?: string;
  tags?: string[];
  credentials?: Record<string, unknown>;
}

function json<T>(text: string | undefined): T | undefined {
  if (text === undefined || text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** The connection of a PostgreSQL service bound to the application: its URI and certificate. */
export function boundPostgres(vcapServices: string | undefined): { url: string; ca?: string } | undefined {
  const services = json<Record<string, BoundService[]>>(vcapServices);
  if (services === undefined) {
    return undefined;
  }
  const all = Object.entries(services).flatMap(([label, list]) => (Array.isArray(list) ? list.map((s) => ({ ...s, label: s.label ?? label })) : []));
  const postgres = all.find((s) => [s.label ?? "", ...(s.tags ?? [])].some((t) => /postgres/i.test(t)));
  const c = postgres?.credentials;
  if (c === undefined) {
    return undefined;
  }
  const text = (key: string): string | undefined => (typeof c[key] === "string" || typeof c[key] === "number" ? String(c[key]) : undefined);
  let url = text("uri") ?? text("url");
  if (url === undefined) {
    const host = text("hostname") ?? text("host");
    const database = text("dbname") ?? text("database");
    if (host === undefined || database === undefined) {
      return undefined;
    }
    const user = encodeURIComponent(text("username") ?? text("user") ?? "");
    const password = encodeURIComponent(text("password") ?? "");
    url = `postgres://${user}:${password}@${host}:${text("port") ?? "5432"}/${database}`;
  }
  const ca = text("sslrootcert") ?? text("sslcert");
  return ca === undefined ? { url } : { url, ca };
}

/** The environment of the application, completed with what the platform gives. */
export function platformEnvironment(env: Environment): Environment {
  const result: Environment = { ...env };
  if ((result["PUBLIC_URL"] ?? "") === "") {
    const application = json<{ application_uris?: string[]; uris?: string[] }>(env["VCAP_APPLICATION"]);
    const route = application?.application_uris?.[0] ?? application?.uris?.[0];
    if (route !== undefined) {
      result["PUBLIC_URL"] = `https://${route.replace(/\/+$/, "")}/`;
    }
  }
  if ((result["DATABASE_URL"] ?? "") === "") {
    const postgres = boundPostgres(env["VCAP_SERVICES"]);
    if (postgres !== undefined) {
      result["DATABASE_URL"] = postgres.url;
      if (postgres.ca !== undefined && (result["DATABASE_CA"] ?? "") === "") {
        result["DATABASE_CA"] = postgres.ca;
      }
    }
  }
  return result;
}
