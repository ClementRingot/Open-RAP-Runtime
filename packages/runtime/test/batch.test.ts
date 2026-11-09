import { describe, expect, it } from "vitest";
import { parseBatch, serializeBatch } from "../src/odata/batch.js";

describe("$batch multipart", () => {
  it("parses requests and change sets, with LF or CRLF line ends", () => {
    for (const eol of ["\r\n", "\n"]) {
      const body = [
        "--b1",
        "Content-Type: application/http",
        "Content-Transfer-Encoding: binary",
        "",
        "GET Travel?$top=1 HTTP/1.1",
        "Accept: application/json",
        "",
        "",
        "--b1",
        "Content-Type: multipart/mixed; boundary=c1",
        "",
        "--c1",
        "Content-Type: application/http",
        "Content-Transfer-Encoding: binary",
        "Content-ID: 1",
        "",
        "POST Travel HTTP/1.1",
        "Content-Type: application/json",
        "",
        '{"TravelID":"1"}',
        "--c1",
        "Content-Type: application/http",
        "Content-ID: 2",
        "",
        "POST $1/_Booking HTTP/1.1",
        "",
        "{}",
        "--c1--",
        "--b1--",
        "",
      ].join(eol);
      const items = parseBatch(body, 'multipart/mixed; boundary="b1"');
      expect(items).toEqual([
        { kind: "request", request: { method: "GET", url: "Travel?$top=1", headers: { accept: "application/json" }, body: "" } },
        {
          kind: "changeset",
          requests: [
            { method: "POST", url: "Travel", headers: { "content-type": "application/json" }, body: '{"TravelID":"1"}', contentId: "1" },
            { method: "POST", url: "$1/_Booking", headers: {}, body: "{}", contentId: "2" },
          ],
        },
      ]);
    }
  });

  it("rejects GET in a change set and bodies without boundary", () => {
    expect(() => parseBatch("--b\r\nContent-Type: multipart/mixed; boundary=c\r\n\r\n--c\r\nContent-Type: application/http\r\n\r\nGET Travel HTTP/1.1\r\n\r\n\r\n--c--\r\n--b--", "multipart/mixed;boundary=b")).toThrow(/cannot contain GET/);
    expect(() => parseBatch("x", "multipart/mixed")).toThrow(/no multipart boundary/);
  });

  it("serializes responses and change set responses", () => {
    const { contentType, body } = serializeBatch([
      { kind: "response", response: { status: 200, headers: { "Content-Type": "application/json" }, body: "{}" } },
      { kind: "changeset", responses: [{ status: 201, headers: {}, body: "{}", contentId: "1" }] },
    ]);
    const boundary = /boundary=(\S+)/.exec(contentType)?.[1] ?? "";
    expect(body.startsWith(`--${boundary}\r\nContent-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}`)).toBe(true);
    expect(body).toContain("Content-ID: 1\r\n\r\nHTTP/1.1 201 Created");
    expect(body.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });
});
