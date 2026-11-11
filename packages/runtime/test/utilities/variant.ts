/** A BO whose actions use the utilities of ABAP Cloud (D40): selfTest, drawNumber, writeLog. */

import { readFileSync } from "node:fs";

const read = (name: string): string => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

export const ABP = "zbp_rt_r_travel.clas.locals_imp.abap";

export function utilitiesVariant(numberRanges?: unknown): Record<string, string | ((content: string) => string)> {
  const variant: Record<string, string | ((content: string) => string)> = {
    "zrt_r_travel.bdef.asbdef": (c) =>
      c.replace("  internal action reCalcTotalPrice;", "  internal action reCalcTotalPrice;\n  action selfTest result [1] $self;\n  action drawNumber result [1] $self;\n  action writeLog result [1] $self;"),
    "zrt_c_travel.bdef.asbdef": (c) => c.replace("  use action copyTravel;", "  use action copyTravel;\n  use action selfTest;\n  use action drawNumber;\n  use action writeLog;"),
    [ABP]: (c) => {
      const first = c.indexOf("ENDCLASS.");
      const withDefinitions = `${read("selftest.abap")}${c.slice(0, first)}${read("definitions.abap").trimStart()}${c.slice(first + "ENDCLASS.".length)}`;
      return withDefinitions.replace("ENDCLASS.\n\nCLASS lhc_booking DEFINITION", `${read("implementations.abap")}ENDCLASS.\n\nCLASS lhc_booking DEFINITION`);
    },
  };
  if (numberRanges !== undefined) {
    variant["../rapt/number-ranges.json"] = `${JSON.stringify(numberRanges, null, 2)}\n`;
  }
  return variant;
}
