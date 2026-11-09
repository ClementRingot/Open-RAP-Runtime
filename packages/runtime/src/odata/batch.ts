/** OData $batch in multipart/mixed format: parsing of requests and serialization of responses. */

import { randomUUID } from "node:crypto";
import { badRequest } from "./errors.js";

export interface BatchRequestPart {
  method: string;
  /** URL as written in the part, relative to the service root (or absolute). */
  url: string;
  headers: Record<string, string>;
  body: string;
  contentId?: string;
}

export type BatchItem = { kind: "request"; request: BatchRequestPart } | { kind: "changeset"; requests: BatchRequestPart[] };

export interface BatchResponsePart {
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  body?: string;
  contentId?: string;
}

export type BatchResponseItem = { kind: "response"; response: BatchResponsePart } | { kind: "changeset"; responses: BatchResponsePart[] };

export function boundaryOf(contentType: string | undefined): string {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? "");
  const boundary = match?.[1] ?? match?.[2];
  if (boundary === undefined) {
    throw badRequest("The $batch request has no multipart boundary");
  }
  return boundary;
}

function splitParts(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`;
  const parts: string[] = [];
  let index = body.indexOf(delimiter);
  if (index < 0) {
    throw badRequest("The $batch body does not contain its boundary");
  }
  while (index >= 0) {
    const start = index + delimiter.length;
    if (body.startsWith("--", start)) {
      break; // close delimiter
    }
    const next = body.indexOf(`\n${delimiter}`, start);
    const end = next < 0 ? body.length : next;
    parts.push(body.slice(start, end).replace(/^[ \t]*\r?\n/, "").replace(/\r$/, ""));
    index = next < 0 ? -1 : next + 1;
  }
  return parts;
}

function splitHead(text: string): { head: string[]; rest: string } {
  const match = /\r?\n\r?\n/.exec(text);
  if (match === null) {
    return { head: text.split(/\r?\n/).filter((l) => l !== ""), rest: "" };
  }
  return { head: text.slice(0, match.index).split(/\r?\n/), rest: text.slice(match.index + match[0].length) };
}

function headersOf(lines: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
  }
  return headers;
}

function parseRequest(part: string, mimeHeaders: Record<string, string>): BatchRequestPart {
  const { head, rest } = splitHead(part);
  const requestLine = head[0] ?? "";
  const match = /^(GET|POST|PATCH|PUT|DELETE|HEAD)\s+(\S+)(?:\s+HTTP\/1\.1)?$/i.exec(requestLine.trim());
  if (match === null) {
    throw badRequest(`Invalid request line in $batch: ${requestLine}`);
  }
  const request: BatchRequestPart = {
    method: (match[1] as string).toUpperCase(),
    url: match[2] as string,
    headers: headersOf(head.slice(1)),
    body: rest.replace(/\r?\n$/, ""),
  };
  const contentId = mimeHeaders["content-id"];
  if (contentId !== undefined) {
    request.contentId = contentId;
  }
  return request;
}

export function parseBatch(body: string, contentType: string | undefined): BatchItem[] {
  const boundary = boundaryOf(contentType);
  const items: BatchItem[] = [];
  for (const part of splitParts(body, boundary)) {
    const { head, rest } = splitHead(part);
    const headers = headersOf(head);
    const type = headers["content-type"] ?? "";
    if (/^multipart\/mixed/i.test(type)) {
      const inner = boundaryOf(type);
      const requests = splitParts(rest, inner).map((p) => {
        const split = splitHead(p);
        return parseRequest(split.rest, headersOf(split.head));
      });
      for (const r of requests) {
        if (r.method === "GET") {
          throw badRequest("A change set cannot contain GET requests");
        }
      }
      items.push({ kind: "changeset", requests });
    } else if (/^application\/http/i.test(type)) {
      items.push({ kind: "request", request: parseRequest(rest, headers) });
    } else {
      throw badRequest(`Unexpected $batch part of type ${type || "(none)"}`);
    }
  }
  return items;
}

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  409: "Conflict",
  412: "Precondition Failed",
  415: "Unsupported Media Type",
  423: "Locked",
  428: "Precondition Required",
  500: "Internal Server Error",
  501: "Not Implemented",
};

function serializeResponse(response: BatchResponsePart): string {
  const lines = ["Content-Type: application/http", "Content-Transfer-Encoding: binary"];
  if (response.contentId !== undefined) {
    lines.push(`Content-ID: ${response.contentId}`);
  }
  lines.push("", `HTTP/1.1 ${response.status} ${response.statusText ?? STATUS_TEXT[response.status] ?? ""}`.trimEnd());
  for (const [name, value] of Object.entries(response.headers)) {
    lines.push(`${name}: ${value}`);
  }
  lines.push("", response.body ?? "");
  return lines.join("\r\n");
}

export function serializeBatch(items: BatchResponseItem[]): { contentType: string; body: string } {
  const boundary = `batchresponse_${randomUUID()}`;
  const chunks: string[] = [];
  for (const item of items) {
    chunks.push(`--${boundary}`);
    if (item.kind === "response") {
      chunks.push(serializeResponse(item.response));
    } else {
      const inner = `changesetresponse_${randomUUID()}`;
      chunks.push(`Content-Type: multipart/mixed; boundary=${inner}`, "");
      for (const response of item.responses) {
        chunks.push(`--${inner}`, serializeResponse(response));
      }
      chunks.push(`--${inner}--`);
    }
  }
  chunks.push(`--${boundary}--`, "");
  return { contentType: `multipart/mixed; boundary=${boundary}`, body: chunks.join("\r\n") };
}
