/**
 * The users of I_BusinessUserBasic (D44): on SAP, the business users of the system; here, the
 * users of the identity provider who used the application, recorded at their first request (and
 * their name and e-mail updated once per process).
 */

import { sql } from "kysely";
import type { Database } from "../db/database.js";
import type { User } from "./user.js";

export const BUSINESS_USER_TABLE = "rapt_bususer";

export class BusinessUsers {
  private readonly seen = new Set<string>();

  public constructor(private readonly db: () => Database) {}

  /** Records the user (fire and forget: a failure never fails the request). */
  public record(user: User): void {
    if (this.seen.has(user.abapName)) {
      return;
    }
    this.seen.add(user.abapName);
    const full = user.name ?? user.abapName;
    const parts = full.trim().split(/\s+/);
    const first = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";
    const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : full;
    void sql`INSERT INTO rapt_bususer (userid, partner, fullname, firstname, lastname, email)
      SELECT ${user.abapName}, lpad((coalesce(max(CASE WHEN partner ~ '^[0-9]+$' THEN partner::bigint END), 0) + 1)::text, 10, '0'),
        ${full.slice(0, 80)}, ${first.slice(0, 40)}, ${last.slice(0, 40)}, ${(user.email ?? "").slice(0, 241)}
      FROM rapt_bususer
      ON CONFLICT (userid) DO UPDATE SET fullname = EXCLUDED.fullname, firstname = EXCLUDED.firstname, lastname = EXCLUDED.lastname,
        email = CASE WHEN EXCLUDED.email = '' THEN rapt_bususer.email ELSE EXCLUDED.email END`
      .execute(this.db())
      .catch(() => {
        this.seen.delete(user.abapName);
      });
  }
}
