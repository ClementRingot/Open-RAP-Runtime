/**
 * The HTTP client of the behavior pools (decision D31): the kernel side of the clean-room
 * cl_http_destination_provider / cl_web_http_client_manager / if_web_http_client.
 *
 * Destinations come from the environment of the application, one set of variables per
 * destination: `DESTINATION_<NAME>_URL` (required), `DESTINATION_<NAME>_USER` and `_PASSWORD`
 * (basic authentication), `DESTINATION_<NAME>_TOKEN` (bearer), `DESTINATION_<NAME>_HEADERS` (a
 * JSON object of further headers, an API key for example). `<NAME>` is the name of
 * create_by_cloud_destination, or the communication scenario of create_by_comm_arrangement
 * (`<SCENARIO>_<SERVICE_ID>` first when a service ID is given), in upper case, other characters
 * than letters and digits as `_`. The credentials stay in the kernel: the ABAP code only sees the
 * URL.
 */

import { destinationKeys } from "@open-rap-runtime/model";
import { abapGlobal, abapString, appendRow, component, rowsOf, type AbapData } from "./convert.js";

export { destinationKeys };

type Input = Record<string, AbapData> | undefined;

export interface Destination {
  url: string;
  headers: Record<string, string>;
}

export function resolveDestination(name: string, env: NodeJS.ProcessEnv = process.env): Destination | undefined {
  for (const key of destinationKeys(name)) {
    const url = env[`DESTINATION_${key}_URL`];
    if (url === undefined || url === "") {
      continue;
    }
    const headers: Record<string, string> = {};
    const user = env[`DESTINATION_${key}_USER`];
    if (user !== undefined && user !== "") {
      headers["authorization"] = `Basic ${Buffer.from(`${user}:${env[`DESTINATION_${key}_PASSWORD`] ?? ""}`).toString("base64")}`;
    }
    const token = env[`DESTINATION_${key}_TOKEN`];
    if (token !== undefined && token !== "") {
      headers["authorization"] = `Bearer ${token}`;
    }
    const extra = env[`DESTINATION_${key}_HEADERS`];
    if (extra !== undefined && extra !== "") {
      for (const [header, value] of Object.entries(JSON.parse(extra) as Record<string, unknown>)) {
        headers[header.toLowerCase()] = String(value);
      }
    }
    return { url, headers };
  }
  return undefined;
}

/** Raises an ABAP exception of the framework with a text (`zrap_text`) and further attributes. */
export async function raise(name: string, text: string, extra: Record<string, AbapData> = {}): Promise<never> {
  const abap = abapGlobal();
  const Class = abap.Classes[name.toUpperCase()];
  if (Class === undefined) {
    throw new Error(`${name}: ${text}`);
  }
  throw await new Class().constructor_({ zrap_text: new abap.types.String().set(text), ...extra });
}

/** URL of a request: the destination, then the path (absolute or relative to it), then the query. */
export function requestUrl(base: string, path: string, query: string): string {
  let url = /^[a-z][a-z0-9+.-]*:\/\//i.test(path) ? path : `${base.replace(/\/+$/, "")}${path === "" ? "" : path.startsWith("/") ? path : `/${path}`}`;
  const q = query.replace(/^\?/, "");
  if (q !== "") {
    url += `${url.includes("?") ? "&" : "?"}${q}`;
  }
  return url;
}

export interface Exchange {
  status: number;
  reason: string;
  headers: Headers;
  body: Buffer;
}

/** One HTTP request; a failure of the connection is an Error with the cause. */
export async function exchange(method: string, url: string, headers: Record<string, string>, body?: string | Buffer, timeoutSeconds = 0): Promise<Exchange> {
  const init: RequestInit = { method, headers, redirect: "follow", signal: AbortSignal.timeout((timeoutSeconds > 0 ? timeoutSeconds : 60) * 1000) };
  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    init.body = typeof body === "string" ? body : new Uint8Array(body);
  }
  const response = await fetch(url, init);
  return { status: response.status, reason: response.statusText, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
}

function headerTable(table: AbapData): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rowsOf(table)) {
    const name = abapString(component(row, "name")).toLowerCase();
    if (name !== "") {
      result[name] = abapString(component(row, "value"));
    }
  }
  return result;
}

export function installHttp(kernel: AbapData): void {
  const abap = abapGlobal();

  kernel.destination = async (input: Input): Promise<AbapData> => {
    const name = abapString(input?.["name"]);
    const destination = resolveDestination(name);
    if (destination === undefined) {
      return raise("CX_HTTP_DEST_PROVIDER_ERROR", `the destination ${name} is not configured: set ${destinationKeys(name).map((k) => `DESTINATION_${k}_URL`).join(" or ")}`);
    }
    return new abap.types.String().set(destination.url);
  };

  kernel.base64_encode = async (input: Input): Promise<AbapData> => new abap.types.String().set(Buffer.from(abapString(input?.["text"]), "utf8").toString("base64"));

  kernel.http_execute = async (input: Input): Promise<void> => {
    const method = (abapString(input?.["method"]) || "GET").toUpperCase();
    const url = requestUrl(abapString(input?.["base"]), abapString(input?.["path"]), abapString(input?.["query"]));
    const own = headerTable(input?.["headers"]);
    const name = abapString(input?.["destination"]);
    const destination = name === "" ? undefined : resolveDestination(name);
    const headers: Record<string, string> = { ...(destination?.headers ?? {}), ...own };
    const binary = abapString(input?.["binary"]);
    const text = String(input?.["body"]?.get?.() ?? "");
    const form = rowsOf(input?.["form"]);
    let body: string | Buffer | undefined;
    if (binary !== "") {
      body = Buffer.from(binary, "hex");
    } else if (text !== "") {
      body = text;
    } else if (form.length > 0) {
      body = new URLSearchParams(form.map((row): [string, string] => [abapString(component(row, "name")), abapString(component(row, "value"))])).toString();
      headers["content-type"] ??= "application/x-www-form-urlencoded";
    }
    let response: Exchange;
    try {
      response = await exchange(method, url, headers, body, Number(input?.["timeout"]?.get?.() ?? 0));
    } catch (error) {
      const cause = (error as { cause?: { message?: string } }).cause?.message;
      return raise("CX_WEB_HTTP_CLIENT_ERROR", `${method} ${url}: ${cause ?? (error as Error).message}`);
    }
    input?.["status"]?.set(response.status);
    input?.["reason"]?.set(response.reason);
    const responseHeaders = input?.["response_headers"];
    responseHeaders?.clear();
    response.headers.forEach((value, header) => {
      appendRow(responseHeaders, (row) => {
        component(row, "name")?.set(header.toLowerCase());
        component(row, "value")?.set(value);
      });
    });
    input?.["response_body"]?.set(response.body.toString("utf8"));
    input?.["response_binary"]?.set(response.body.toString("hex").toUpperCase());
  };
}
