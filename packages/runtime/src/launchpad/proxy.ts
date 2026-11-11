/**
 * Forwarding of the requests of the launchpad to its applications (decision D37): the launchpad
 * is the only origin the browser sees, as the front-end server of the SAP Fiori launchpad. The UI
 * of an application is mounted at `/apps/<id>/` (the prefix is removed), its services keep their
 * paths. The cookies go with the request: the application reads the session the launchpad opened.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

/** Headers of one connection (RFC 9110 §7.6.1), not forwarded. */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length"]);

export interface ForwardOptions {
  /** The mount path of the application (`/apps/travel`): its redirections are rewritten below it. */
  prefix?: string;
  /** Timeout of the request (ms). */
  timeout: number;
  /** Name of the application, for the error message. */
  app: string;
  /** The answer is an OData error when the application cannot be reached (service paths). */
  odata: boolean;
}

/**
 * A redirection of the application, for the browser of the launchpad: `/ui/index.html` becomes
 * `/apps/<id>/ui/index.html`; a login (`/auth/login?returnTo=/ui/…`) goes to the login of the
 * launchpad, back to the page of the application. Other URLs are kept.
 */
export function rewriteLocation(location: string, prefix: string): string {
  if (!location.startsWith("/") || location.startsWith("//")) {
    return location;
  }
  if (location === "/auth" || location.startsWith("/auth/") || location.startsWith("/auth?")) {
    const url = new URL(location, "http://launchpad.invalid");
    const returnTo = url.searchParams.get("returnTo");
    if (returnTo !== null && returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.startsWith(`${prefix}/`)) {
      url.searchParams.set("returnTo", `${prefix}${returnTo}`);
    }
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return `${prefix}${location}`;
}

/**
 * The URL of a path of the application (`/ui/index.html?x=1`): below the URL of the application,
 * whatever the path holds (`/http://other.host/` stays a path: no request to another host).
 */
export function targetUrl(base: URL, pathAndQuery: string): URL {
  const target = new URL(base.href);
  const question = pathAndQuery.indexOf("?");
  const pathname = question < 0 ? pathAndQuery : pathAndQuery.slice(0, question);
  target.pathname = `${base.pathname.replace(/\/$/, "")}/${pathname.replace(/^\/+/, "")}`;
  target.search = question < 0 ? "" : pathAndQuery.slice(question);
  target.hash = "";
  return target;
}

function forwardedHeaders(request: FastifyRequest, prefix: string | undefined): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    // the body is sent decoded: no compression negotiated with the application
    if (value === undefined || HOP_BY_HOP.has(lower) || lower === "accept-encoding") {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(lower, item);
    }
  }
  const forwardedFor = request.headers["x-forwarded-for"];
  headers.set("x-forwarded-for", forwardedFor === undefined ? request.ip : `${String(forwardedFor)}, ${request.ip}`);
  headers.set("x-forwarded-host", request.headers.host ?? "");
  headers.set("x-forwarded-proto", request.protocol);
  if (prefix !== undefined) {
    headers.set("x-forwarded-prefix", prefix);
  }
  return headers;
}

/** Sends the request to `target` (the URL of the application with the path and the query) and its answer back. */
export async function forward(request: FastifyRequest, reply: FastifyReply, target: URL, options: ForwardOptions): Promise<FastifyReply> {
  const init: RequestInit = {
    method: request.method,
    headers: forwardedHeaders(request, options.prefix),
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeout),
  };
  if (request.method !== "GET" && request.method !== "HEAD" && Buffer.isBuffer(request.body)) {
    init.body = request.body;
  }
  let response: Response;
  try {
    response = await fetch(target, init);
  } catch (error) {
    request.log.warn({ err: error, app: options.app }, "application not reachable");
    const message = `The application ${options.app} is not reachable`;
    reply.status(502);
    return options.odata ? reply.type("application/json").send({ error: { code: "BAD_GATEWAY", message } }) : reply.type("text/plain").send(message);
  }
  reply.status(response.status);
  response.headers.forEach((value, name) => {
    // fetch has decoded the body; the cookies are set one by one below
    if (HOP_BY_HOP.has(name) || name === "content-encoding" || name === "set-cookie") {
      return;
    }
    reply.header(name, name === "location" && options.prefix !== undefined ? rewriteLocation(value, options.prefix) : value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) {
    reply.header("set-cookie", cookies);
  }
  const body = request.method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer());
  return reply.send(body);
}
