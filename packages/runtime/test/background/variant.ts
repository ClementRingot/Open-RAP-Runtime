/** A BO whose actions start background processes (bgPF) and send a mail (D41). */

import { readFileSync } from "node:fs";

const read = (name: string): string => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

const ABP = "zbp_rt_r_travel.clas.locals_imp.abap";

export function backgroundVariant(): Record<string, string | ((content: string) => string)> {
  return {
    "zrt_r_travel.bdef.asbdef": (c) => c.replace("  internal action reCalcTotalPrice;", "  internal action reCalcTotalPrice;\n  action startJobs result [1] $self;\n  action sendMail result [1] $self;"),
    "zrt_c_travel.bdef.asbdef": (c) => c.replace("  use action copyTravel;", "  use action copyTravel;\n  use action startJobs;\n  use action sendMail;"),
    [ABP]: (c) => {
      const first = c.indexOf("ENDCLASS.");
      const withDefinitions = `${read("jobs.abap")}${c.slice(0, first)}${read("definitions.abap").trimStart()}${c.slice(first + "ENDCLASS.".length)}`;
      return withDefinitions.replace("ENDCLASS.\n\nCLASS lhc_booking DEFINITION", `${read("implementations.abap")}ENDCLASS.\n\nCLASS lhc_booking DEFINITION`);
    },
  };
}
