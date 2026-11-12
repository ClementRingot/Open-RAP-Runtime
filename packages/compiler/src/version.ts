import { readFileSync } from "node:fs";

/** The version of the compiler: the one of its package.json (set from the tag on release). */
export const COMPILER_VERSION: string = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
