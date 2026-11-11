/**
 * The views (variants) of the list reports, saved per user (`$variants` of the service): the
 * filters, the visible filters and columns, the sort order. Kept in `rapt_ui_variant`, created at
 * the first use (it is not part of the schema of the business objects).
 */

import { sql } from "kysely";
import type { Database } from "../db/database.js";

export interface VariantData {
  defaultKey?: string;
  items: Array<{ key: string; title: string; favorite?: boolean; content: unknown }>;
}

const MAX_SIZE = 256 * 1024;

export class UiVariants {
  private ready: Promise<void> | undefined;

  public constructor(private readonly db: () => Database) {}

  private table(): Promise<void> {
    this.ready ??= sql
      .raw(
        "CREATE TABLE IF NOT EXISTS rapt_ui_variant (user_id text NOT NULL, page text NOT NULL, data text NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, page))",
      )
      .execute(this.db())
      .then(() => undefined)
      .catch((error: unknown) => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }

  public async read(user: string, page: string): Promise<VariantData> {
    await this.table();
    const result = await sql<{ data: string }>`SELECT data FROM rapt_ui_variant WHERE user_id = ${user} AND page = ${page}`.execute(this.db());
    const row = result.rows[0];
    return row === undefined ? { items: [] } : (JSON.parse(row.data) as VariantData);
  }

  public async write(user: string, page: string, body: string): Promise<void> {
    if (body.length > MAX_SIZE) {
      throw new VariantError("the views are too large");
    }
    const data = parse(body);
    await this.table();
    const text = JSON.stringify(data);
    await sql`INSERT INTO rapt_ui_variant (user_id, page, data, changed_at) VALUES (${user}, ${page}, ${text}, now())
      ON CONFLICT (user_id, page) DO UPDATE SET data = EXCLUDED.data, changed_at = EXCLUDED.changed_at`.execute(this.db());
  }
}

export class VariantError extends Error {}

function parse(body: string): VariantData {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new VariantError("the body is not JSON");
  }
  if (typeof value !== "object" || value === null || !Array.isArray((value as VariantData).items)) {
    throw new VariantError("expected { items: [...] }");
  }
  const data = value as VariantData;
  const items = data.items.map((item) => {
    if (typeof item !== "object" || item === null || typeof item.key !== "string" || typeof item.title !== "string") {
      throw new VariantError("each view needs a key and a title");
    }
    return { key: item.key, title: item.title, favorite: item.favorite !== false, content: item.content ?? null };
  });
  const result: VariantData = { items };
  if (typeof data.defaultKey === "string") {
    result.defaultKey = data.defaultKey;
  }
  return result;
}
