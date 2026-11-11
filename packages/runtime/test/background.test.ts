/**
 * Background processing and e-mails in a behavior pool (D41): an action starts three bgPF
 * processes (a controlled operation whose EML changes are saved at its end, an uncontrolled one
 * that commits itself, one that fails) and another sends a mail, kept in rapt_mail without
 * MAIL_SMTP_URL, sent through an SMTP server with it. Both run after the commit of the request.
 */

import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatedVariant, SERVICE, T1, T2, writableApp, type TestApp } from "./helpers.js";
import { backgroundVariant } from "./background/variant.js";

const NS = "com.sap.gateway.srvd.zrt_ui_travel.v0001";
const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8;IEEE754Compatible=true", accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true", "if-match": "*" };

let app: TestApp;

beforeAll(async () => {
  app = await writableApp(generatedVariant(backgroundVariant()));
});
afterAll(async () => app.close());

async function action(travel: string, name: string): Promise<{ status: number; description: string; body: unknown }> {
  const response = await app.app.inject({ method: "POST", url: `${SERVICE}Travel(${travel})/${NS}.${name}`, headers: JSON_HEADERS, payload: "{}" });
  const body = response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>);
  return { status: response.statusCode, description: String(body["Description"] ?? ""), body };
}

async function description(travel: string): Promise<string> {
  const response = await app.app.inject({ method: "GET", url: `${SERVICE}Travel(${travel})?$select=Description`, headers: JSON_HEADERS });
  return String((JSON.parse(response.body) as Record<string, unknown>)["Description"]);
}

async function rows<T>(query: string): Promise<T[]> {
  return (await app.pglite.query<T>(query)).rows;
}

/** A minimal SMTP server: accepts every mail, keeps the DATA. */
function smtpServer(received: string[]): Promise<{ server: Server; port: number }> {
  const server = createServer((socket: Socket) => {
    let data = false;
    let message = "";
    let buffer = "";
    socket.write("220 test ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data) {
          if (line === ".") {
            data = false;
            received.push(message);
            message = "";
            socket.write("250 queued\r\n");
          } else {
            message += `${line}\r\n`;
          }
        } else if (/^(EHLO|HELO)/i.test(line)) {
          socket.write("250 test\r\n");
        } else if (/^DATA/i.test(line)) {
          data = true;
          socket.write("354 go on\r\n");
        } else if (/^QUIT/i.test(line)) {
          socket.end("221 bye\r\n");
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port })));
}

describe("background processing (bgPF)", () => {
  it("runs the processes after the commit, each in its own LUW", async () => {
    const result = await action(T1, "startJobs");
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    // the monitor, read in the LUW that saved the processes
    expect(result.description).toBe("NEW");
    await expect.poll(async () => (await rows<{ n: number }>("SELECT count(*)::int AS n FROM rapt_background_process WHERE state = 'NEW'"))[0]?.n, { timeout: 20_000 }).toBe(0);
    const processes = await rows<{ process_name: string; state: string; error_text: string }>("SELECT process_name, state, error_text FROM rapt_background_process ORDER BY process_name");
    expect(processes).toEqual([
      { process_name: "controlled", state: "SUCCESSFUL", error_text: "" },
      { process_name: "failing", state: "ERRONEOUS", error_text: "CX_BGMC_OPERATION: An exception was raised" },
      { process_name: "uncontrolled", state: "SUCCESSFUL", error_text: "" },
    ]);
    expect(await description(T1)).toBe("set in the background (controlled)");
    const fee = await app.app.inject({ method: "GET", url: `${SERVICE}Travel(${T1})?$select=BookingFee`, headers: JSON_HEADERS });
    expect((JSON.parse(fee.body) as Record<string, unknown>)["BookingFee"]).toBe("77.00");
  });
});

describe("e-mail (cl_bcs_mail_message)", () => {
  it("keeps the mail in rapt_mail without an SMTP server", async () => {
    delete process.env["MAIL_SMTP_URL"];
    const result = await action(T2, "sendMail");
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.description).toBe("W 2 bob@example.com");
    await expect.poll(async () => (await rows<{ state: string }>("SELECT state FROM rapt_mail"))[0]?.state, { timeout: 20_000 }).toBe("STORED");
    const [mail] = await rows<{ sender: string; recipients: string; subject: string; raw_message: string }>("SELECT sender, recipients, subject, raw_message FROM rapt_mail");
    expect(mail).toMatchObject({ sender: "travel@example.com", recipients: "alice@example.com, bob@example.com", subject: "Travel 00000002" });
    expect(mail?.raw_message).toContain("Cc: bob@example.com");
    expect(mail?.raw_message).toContain("text/html");
    expect(mail?.raw_message).toContain('filename=notes.txt');
    expect(mail?.raw_message).toContain("yv66vg=="); // CAFEBABE in base64
  });

  it("sends the mail through the SMTP server of MAIL_SMTP_URL", async () => {
    const received: string[] = [];
    const { server, port } = await smtpServer(received);
    process.env["MAIL_SMTP_URL"] = `smtp://127.0.0.1:${port}`;
    try {
      await app.pglite.exec("DELETE FROM rapt_mail");
      expect((await action(T1, "sendMail")).status).toBe(200);
      await expect.poll(async () => (await rows<{ state: string; error_text: string }>("SELECT state, error_text FROM rapt_mail"))[0], { timeout: 20_000 }).toEqual({ state: "SENT", error_text: "" });
      expect(received).toHaveLength(1);
      expect(received[0]).toContain("Subject: Travel 00000001");
    } finally {
      delete process.env["MAIL_SMTP_URL"];
      server.close();
    }
  });

  it("sends nothing when the LUW is rolled back", async () => {
    await app.pglite.exec("DELETE FROM rapt_mail");
    // the validation of the dates fails on save: the request is rolled back
    await app.pglite.exec("UPDATE zrt_travel SET description = 'ROLLBACK' WHERE travel_id = '00000002'");
    const result = await action(T2, "sendMail");
    expect(result.status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await rows("SELECT * FROM rapt_mail")).toEqual([]);
  });
});
