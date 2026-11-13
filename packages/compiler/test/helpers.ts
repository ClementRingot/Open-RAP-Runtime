import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_DIR = fileURLToPath(new URL("../../../fixtures/travel", import.meta.url));

export function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, "src", name), "utf8");
}

/**
 * A copy of the Travel fixture in a temporary folder, with some files changed:
 * `changes` maps a file name of `src/` to its new content (or null to delete it).
 */
export function fixtureVariant(changes: Record<string, string | null | ((content: string) => string)>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "rapt-fixture-"));
  mkdirSync(path.join(dir, "src"));
  copyFileSync(path.join(FIXTURE_DIR, ".abapgit.xml"), path.join(dir, ".abapgit.xml"));
  for (const file of readdirSync(path.join(FIXTURE_DIR, "src"))) {
    copyFileSync(path.join(FIXTURE_DIR, "src", file), path.join(dir, "src", file));
  }
  // the roles next to the sources (rapt/authorizations.json)
  if (existsSync(path.join(FIXTURE_DIR, "rapt"))) {
    cpSync(path.join(FIXTURE_DIR, "rapt"), path.join(dir, "rapt"), { recursive: true });
  }
  for (const [file, change] of Object.entries(changes)) {
    const target = path.join(dir, "src", file);
    if (change === null) {
      rmSync(target);
    } else if (typeof change === "function") {
      writeFileSync(target, change(readFileSync(target, "utf8")));
    } else {
      writeFileSync(target, change);
    }
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The content with LF line endings (the checkout may have CRLF ones). */
export const lf = (content: string): string => content.replace(/\r\n/g, "\n");

/** Calculated elements (D67) in the Travel view and its projection. */
export const CALCULATED_CHANGES: Record<string, (content: string) => string> = {
  "zrt_r_travel.ddls.asddls": (c) =>
    lf(c).replace(
      "      _Booking\n",
      [
        "      @Semantics.amount.currencyCode: 'CurrencyCode'",
        "      booking_fee + total_price as TotalWithFee,",
        "      case overall_status when 'A' then 'Accepted' when 'X' then 'Cancelled' else 'Open' end as StatusText,",
        "      concat_with_space( description, cast( agency_id as abap.char( 6 ) ), 1 ) as Label,",
        "      dats_days_between( begin_date, end_date ) as Duration,",
        "      division( total_price, 3, 2 ) as Third,",
        "      cast( case when total_price >= 1000 and $projection.Duration > 3 then 'X' else '' end as abap_boolean ) as IsExpensive,",
        "      _Booking",
        "",
      ].join("\n"),
    ),
  "zrt_c_travel.ddls.asddls": (c) =>
    lf(c).replace(
      "      _Booking : redirected",
      ["      TotalWithFee,", "      StatusText,", "      Label,", "      Duration,", "      Third,", "      IsExpensive,", "      Duration * 2 as DoubleDuration,", "      upper( Description ) as DescriptionUpper,", "      _Booking : redirected"].join("\n"),
    ),
};

/**
 * Ports no other process listens on, given by the system: random ports collided with the servers
 * of the other test files running at the same time (EADDRINUSE).
 */
export async function freePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise<ReturnType<typeof createServer>>((resolve) => {
          const server = createServer();
          server.listen(0, "127.0.0.1", () => resolve(server));
        }),
    ),
  );
  const ports = servers.map((s) => (s.address() as { port: number }).port);
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  return ports;
}

/** One free port (freePorts). */
export async function freePort(): Promise<number> {
  return (await freePorts(1))[0] as number;
}
