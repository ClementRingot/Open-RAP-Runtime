/**
 * CSRF tokens in the SAP Gateway style: a client fetches a token with `X-CSRF-Token: Fetch` on a
 * GET or HEAD request, and sends it back on modifying requests. Only requests authenticated by a
 * session cookie need it: bearer tokens and the development mode carry no ambient credentials.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { User } from "../auth/user.js";

export class CsrfTokens {
  private readonly secret: Buffer;

  public constructor(secret?: string) {
    this.secret = secret === undefined ? randomBytes(32) : Buffer.from(secret);
  }

  public token(user: User, session = ""): string {
    return createHmac("sha256", this.secret).update(`${user.id}\u0000${session}`).digest("base64url");
  }

  public valid(user: User, token: string | undefined, session = ""): boolean {
    if (token === undefined) {
      return false;
    }
    const expected = Buffer.from(this.token(user, session));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  public required(user: User, method: string): boolean {
    return user.authenticatedBy === "session" && !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  }
}
