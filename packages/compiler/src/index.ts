export { parseBdef, type BdefParseResult } from "./bdef/parser.js";
export type * from "./bdef/ast.js";
export { parseCds } from "./cds/adapter.js";
export { Diagnostics, formatDiagnostic, type Diagnostic, type Severity } from "./diagnostics.js";
export { loadProject, type Project, type SourceFile } from "./input/project.js";
export { buildModel, type BuildOptions, type BuildResult } from "./ir/builder.js";
export { classifyMethodDefinition } from "./ir/handlers.js";
export { parseSrvd } from "./srvd/parser.js";
export { COMPILER_VERSION } from "./version.js";
