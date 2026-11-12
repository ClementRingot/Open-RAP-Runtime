import { readFileSync } from "node:fs";

/** The version of the @rap-transpiler/compiler package (set from the release tag, D65). */
export const COMPILER_VERSION: string = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
