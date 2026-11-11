/**
 * E-mails (cl_bcs_mail_message, decision D41): send( ) composes the mail (MIME, attachments) and
 * keeps it in the table rapt_mail of the LUW (state WAITING); once the LUW is committed, the mail
 * is sent through the SMTP server of MAIL_SMTP_URL (SENT, or ERROR with the reason). Without
 * MAIL_SMTP_URL the mail stays in rapt_mail (STORED), to be read in development. A rolled back
 * LUW sends nothing.
 */

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { createTransport } from "nodemailer";
import type { RapRuntime } from "../rap/runtime.js";
import { abapGlobal, abapString, rowsOf, type AbapData } from "./convert.js";
import { raise } from "./http.js";

type Input = Record<string, AbapData> | undefined;

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+$/;

export function installMail(kernel: AbapData, runtime: RapRuntime): void {
  const abap = abapGlobal();

  kernel.mail_send = async (input: Input): Promise<AbapData> => {
    const context = runtime.context();
    const env = process.env;
    const sender = abapString(input?.["sender"]) || env["MAIL_FROM"] || "";
    const recipients = rowsOf(input?.["recipients"]).map((row) => ({ address: abapString(row.get()["address"]), kind: abapString(row.get()["kind"]) || "T" }));
    if (recipients.length === 0) {
      return raise("cx_bcs_mail", "the mail has no recipient (add_recipient)");
    }
    for (const address of [sender, ...recipients.map((r) => r.address)]) {
      if (!ADDRESS.test(address)) {
        return raise("cx_bcs_mail", address === "" ? "the mail has no sender: set_sender, or MAIL_FROM" : `${address} is not a mail address`);
      }
    }
    const parts = rowsOf(input?.["parts"]).map((row) => {
      const c = row.get();
      const binary = abapString(c["is_binary"]) !== "";
      return {
        main: abapString(c["main"]) !== "",
        contentType: abapString(c["content_type"]) || "text/plain",
        filename: abapString(c["filename"]),
        content: binary ? Buffer.from(String(c["binary"].get()), "hex") : String(c["text"].get()),
      };
    });
    const main = parts.find((p) => p.main);
    const subject = abapString(input?.["subject"]);
    const replyTo = abapString(input?.["reply_to"]);
    const to = (kind: string): string[] => recipients.filter((r) => r.kind === kind).map((r) => r.address);
    // the MIME message, composed now (as it will be sent)
    const composed = await createTransport({ streamTransport: true, buffer: true }).sendMail({
      from: sender,
      to: to("T"),
      cc: to("C"),
      bcc: to("B"),
      subject,
      ...(replyTo === "" ? {} : { replyTo }),
      ...(main === undefined ? {} : /html/i.test(main.contentType) ? { html: main.content } : { text: main.content }),
      attachments: parts.filter((p) => !p.main).map((p) => ({ content: p.content, contentType: p.contentType, ...(p.filename === "" ? {} : { filename: p.filename }) })),
    });
    const raw = Buffer.isBuffer(composed.message) ? composed.message : Buffer.from(String(composed.message));
    const id = randomUUID().replace(/-/g, "").toUpperCase();
    await sql`INSERT INTO rapt_mail (mail_id, sender, recipients, subject, raw_message, state, mail_user, created_at)
      VALUES (${id}, ${sender}, ${recipients.map((r) => r.address).join(", ")}, ${subject}, ${raw.toString("utf8")}, 'WAITING', ${context.user.abapName}, now())`.execute(context.tx.db);
    context.afterCommit.push(async (luw) => {
      const url = env["MAIL_SMTP_URL"];
      let state = "STORED";
      let error = "";
      if (url !== undefined && url !== "") {
        try {
          await createTransport(url).sendMail({ envelope: { from: sender, to: recipients.map((r) => r.address) }, raw });
          state = "SENT";
        } catch (e) {
          state = "ERROR";
          error = (e as Error).message;
          process.stderr.write(`rap-transpiler: the mail "${subject}" was not sent: ${error}\n`);
        }
      } else {
        process.stdout.write(`rap-transpiler: mail "${subject}" to ${recipients.map((r) => r.address).join(", ")} kept in rapt_mail (MAIL_SMTP_URL is not set)\n`);
      }
      await runtime.transaction(luw.db, luw.user, luw.language, async (tx) => {
        await sql`UPDATE rapt_mail SET state = ${state}, error_text = ${error}, sent_at = now() WHERE mail_id = ${id}`.execute(tx.db);
      });
    });
    return new abap.types.String().set(id);
  };
}
