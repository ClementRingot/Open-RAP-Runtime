/**
 * Collaborative draft (D59): the Travel fixture `with collaborative draft`: a second user joins
 * the draft of an instance (Edit), Share invites other users, every user of the draft changes,
 * reads and activates it; the others are refused.
 */

import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { PGliteDialect } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { chromium, id, ROWS, type Browser } from "./browser.js";
import { createDatabase, PGLITE_PARSERS, type Database } from "../src/db/database.js";
import { RapRuntime } from "../src/rap/runtime.js";
import { DRAFT_CHANGES, edit, generatedVariant, SEED, SERVICE, T1, type GeneratedFixture } from "./helpers.js";

const NS = "com.sap.gateway.srvd.zrt_ui_travel.v0001";
const RUNTIME_DIR = fileURLToPath(new URL("..", import.meta.url));
const browserType = chromium();
let fixture: GeneratedFixture;
let db: Database;
const apps: Record<string, FastifyInstance> = {};

export const COLLABORATIVE_CHANGES: Record<string, (content: string) => string> = {
  "zrt_r_travel.bdef.asbdef": (c) => edit(DRAFT_CHANGES["zrt_r_travel.bdef.asbdef"]?.(c) ?? c, [["with draft;", "with collaborative draft;"], ["  draft action Resume;", "  draft action Resume;\n  draft action Share;"]]),
  "zrt_c_travel.bdef.asbdef": (c) => edit(DRAFT_CHANGES["zrt_c_travel.bdef.asbdef"]?.(c) ?? c, [["  use action Resume;", "  use action Resume;\n  use action Share;"]]),
};

beforeAll(async () => {
  fixture = await generatedVariant(COLLABORATIVE_CHANGES);
  const pglite = await PGlite.create({ parsers: PGLITE_PARSERS });
  await pglite.exec("SET TIME ZONE 'UTC'");
  await pglite.exec(fixture.schema);
  await pglite.exec(SEED);
  db = createDatabase(new PGliteDialect({ pglite }));
  const rap = await RapRuntime.load(fixture.model, fixture.abapDir);
  for (const user of ["ALICE", "BOB", "CAROL", "DAVE"]) {
    apps[user] = await createApp({ model: fixture.model, metadata: fixture.metadata, db, rap, auth: { mode: "none", user } });
  }
  apps["ERIN"] = await createApp({ model: fixture.model, metadata: fixture.metadata, db, rap, auth: { mode: "none", user: "ERIN" }, ui: { dir: path.join(fixture.dir, "ui"), resourcesFrom: RUNTIME_DIR } });
}, 180_000);

afterAll(async () => {
  for (const app of Object.values(apps)) await app.close();
  await db?.destroy();
});

const HEADERS = { "content-type": "application/json", accept: "application/json", "if-match": "*" };
type Response = { status: number; body: Record<string, unknown> };

async function call(user: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<Response> {
  const response = await (apps[user] as FastifyInstance).inject({ method, url: `${SERVICE}${url}`, headers: HEADERS, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

const travel = (active: boolean): string => `Travel(TravelUUID=${T1},IsActiveEntity=${active})`;

describe("collaborative draft", () => {
  it("is described in the $metadata: the Share action and the users of the draft", () => {
    expect(fixture.metadata).toContain(`<PropertyValue Property="ShareAction" String="${NS}.Share"/>`);
    expect(fixture.metadata).toMatch(/<Action Name="Share" IsBound="true">[\s\S]*?<Parameter Name="Users" Type="Collection\(SAP__self.DraftAdministrativeUserInput\)" Nullable="false"\/>/);
    expect(fixture.metadata).toContain('<NavigationProperty Name="DraftAdministrativeUser" Type="Collection(SAP__self.DraftAdministrativeUserType)"');
  });

  it("lets a second user join the draft, invite a third one, and activate it together", async () => {
    expect((await call("ALICE", "POST", `${travel(true)}/${NS}.Edit`, { PreserveChanges: true })).status).toBe(200);
    // the active instance points to its draft: locked by ALICE
    const active = await call("BOB", "GET", `${travel(true)}?$select=HasDraftEntity&$expand=DraftAdministrativeData($select=InProcessByUser)`);
    expect(active.body).toMatchObject({ HasDraftEntity: true, DraftAdministrativeData: { InProcessByUser: "ALICE" } });
    // BOB joins the draft by Edit, and changes it
    expect((await call("BOB", "POST", `${travel(true)}/${NS}.Edit`, { PreserveChanges: true })).status).toBe(200);
    expect((await call("BOB", "PATCH", travel(false), { Description: "Edited by Bob" })).status).toBe(200);
    expect((await call("ALICE", "GET", travel(false))).body["Description"]).toBe("Edited by Bob");
    // DAVE is not a user of the draft: he cannot change it, nor read it
    expect((await call("DAVE", "PATCH", travel(false), { Description: "Dave" })).status).toBe(409);
    expect((await call("DAVE", "GET", travel(false))).status).toBe(404);
    // ALICE invites CAROL
    expect((await call("ALICE", "POST", `${travel(false)}/${NS}.Share`, { Users: [{ UserID: "carol", UserAccessRole: "E" }], ShareAll: false })).status).toBe(204);
    const draftUuid = (await call("CAROL", "GET", `${travel(false)}?$select=DraftUUID`)).body["DraftUUID"] as string;
    const users = await call("CAROL", "GET", `DraftAdministrativeUser?$filter=DraftUUID eq ${draftUuid}&$orderby=UserID`);
    expect(users.status, JSON.stringify(users.body)).toBe(200);
    expect((users.body["value"] as Array<Record<string, unknown>>).map((u) => [u["UserID"], u["UserAccessRole"]])).toEqual([
      ["ALICE", "O"],
      ["BOB", "E"],
      ["CAROL", "E"],
    ]);
    expect((await call("CAROL", "PATCH", travel(false), { BookingFee: 42 })).status).toBe(200);
    // BOB activates the draft of the three users
    const activated = await call("BOB", "POST", `${travel(false)}/${NS}.Activate`, {});
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    expect((await call("DAVE", "GET", travel(true))).body).toMatchObject({ Description: "Edited by Bob", BookingFee: 42, HasDraftEntity: false });
    const left = await db.selectFrom("rapt_draft_user" as never).selectAll().execute();
    expect(left).toEqual([]);
  });

  it.skipIf(browserType === undefined)("shows the users of the draft and invites one in the UI", async () => {
    const app = apps["ERIN"] as FastifyInstance;
    await app.listen({ port: 0, host: "127.0.0.1" });
    const browser: Browser = await (browserType as { launch(): Promise<Browser> }).launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.goto(`http://127.0.0.1:${(app.server.address() as { port: number }).port}/`);
      await page.locator(ROWS, { hasText: "70002" }).first().waitFor({ timeout: 60_000 });
      await page.locator(ROWS, { hasText: "70002" }).first().click();
      await page.locator(id("TravelObject", "edit")).click();
      await page.waitForFunction("location.hash.includes('IsActiveEntity=false')", undefined, { timeout: 30_000 });
      await page.locator(id("TravelObject", "invite")).click();
      await page.locator(".sapMDialog input").first().fill("frank");
      await page.locator(".sapMDialog button", { hasText: "Invite" }).first().click();
      await page.getByText("FRANK can now edit the draft").first().waitFor({ timeout: 30_000 });
      await expect.poll(async () => page.locator(`${id("TravelObject", "collabUsers")} .sapFAvatar`).count(), { timeout: 15_000 }).toBe(2);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("needs the draft action Share", async () => {
    await expect(generatedVariant({ ...COLLABORATIVE_CHANGES, "zrt_r_travel.bdef.asbdef": (c) => edit(COLLABORATIVE_CHANGES["zrt_r_travel.bdef.asbdef"]?.(c) ?? c, [["  draft action Share;\n", ""]]) })).rejects.toThrow(/BDEF029/);
  });
});
