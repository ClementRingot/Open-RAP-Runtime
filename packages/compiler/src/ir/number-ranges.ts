/**
 * Intervals of the number ranges (decision D40): `rapt/number-ranges.json` next to the abapGit
 * sources, versioned with them, as the number range objects and intervals of the system:
 *
 * ```json
 * { "ZRT_TRAVEL": { "01": { "from": "1", "to": "99999999" } } }
 * ```
 *
 * An interval may also give `subobject` and `toyear`. cl_numberrange_runtime=>number_get draws
 * from the interval in the database of the application; an interval that is not configured
 * starts at 1.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NumberRangeIntervalModel } from "@open-rap/model";
import type { Diagnostics } from "../diagnostics.js";
import type { Project } from "../input/project.js";

export const NUMBER_RANGES_FILE = "rapt/number-ranges.json";

const DIGITS = /^\d{1,20}$/;

export function loadNumberRanges(project: Project, diagnostics: Diagnostics): NumberRangeIntervalModel[] | undefined {
  const file = path.join(project.root, NUMBER_RANGES_FILE);
  if (!existsSync(file)) {
    return undefined;
  }
  const at = { file: NUMBER_RANGES_FILE, line: 1 };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    diagnostics.error("NR001", `${NUMBER_RANGES_FILE} is not valid JSON: ${(error as Error).message}`, at);
    return undefined;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    diagnostics.error("NR001", `${NUMBER_RANGES_FILE} must be an object: number range object → interval → { from, to }`, at);
    return undefined;
  }
  const intervals: NumberRangeIntervalModel[] = [];
  for (const [object, value] of Object.entries(json as Record<string, unknown>)) {
    if (object.length > 10) {
      diagnostics.error("NR001", `${object}: a number range object has at most 10 characters`, at);
      continue;
    }
    for (const [nr, definition] of Object.entries((value ?? {}) as Record<string, unknown>)) {
      const d = (definition ?? {}) as { from?: unknown; to?: unknown; subobject?: unknown; toyear?: unknown };
      const from = String(d.from ?? "1");
      const to = String(d.to ?? "");
      if (nr.length > 2 || !DIGITS.test(from) || !DIGITS.test(to) || BigInt(from) > BigInt(to)) {
        diagnostics.error("NR001", `${object}.${nr}: an interval has a name of 2 characters and "from" ≤ "to", decimal numbers of up to 20 digits`, at);
        continue;
      }
      const interval: NumberRangeIntervalModel = { object: object.toUpperCase(), interval: nr.toUpperCase(), from: BigInt(from).toString(), to: BigInt(to).toString() };
      if (typeof d.subobject === "string" && d.subobject !== "") interval.subobject = d.subobject.toUpperCase();
      if (d.toyear !== undefined && String(d.toyear) !== "") interval.toyear = String(d.toyear);
      intervals.push(interval);
    }
  }
  return intervals;
}

/** The services with tables of their own the ABAP of the project uses (D40, D41). */
export function usedServices(project: Project): { numberRanges?: boolean; applicationLog?: boolean; background?: boolean; mail?: boolean } | undefined {
  const code = project.files
    .filter((f) => (f.type === "CLAS" || f.type === "INTF") && f.extension.endsWith("abap"))
    .map((f) => f.content.toLowerCase())
    .join("\n");
  const services = {
    numberRanges: code.includes("cl_numberrange_runtime"),
    applicationLog: /\bcl_bali_/.test(code),
    background: code.includes("cl_bgmc_process_factory"),
    mail: code.includes("cl_bcs_mail_message"),
  };
  const used = Object.fromEntries(Object.entries(services).filter(([, value]) => value));
  return Object.keys(used).length === 0 ? undefined : used;
}
