/** Service definition (SRVD) and binding (SRVB) → IR service. */

import { defaultServicePath, serviceNamespace, type ServiceModel } from "@open-rap-runtime/model";
import { readSrvbXml } from "../ddic/xml.js";
import type { Diagnostics } from "../diagnostics.js";
import { filesOfType, type Project, type SourceFile } from "../input/project.js";
import { parseSrvd, type SrvdAst } from "../srvd/parser.js";

export interface ServiceOptions {
  /** Service definition to build; required when the sources contain several. */
  service?: string;
  /** Service binding name; default: the SRVB of the service, else <SRVD>_O4. */
  binding?: string;
  /** Service root path; default: the RAP OData V4 path of the binding (decision D6). */
  path?: string;
  /** Binding type: ui or webapi, overriding the BINDING_TYPE_CATEGORY of the SRVB (D60). */
  bindingType?: string;
}

export interface ServiceSelection {
  service: ServiceModel;
  ast: SrvdAst;
  file: SourceFile;
}

export function selectService(project: Project, options: ServiceOptions, diagnostics: Diagnostics): ServiceSelection | undefined {
  const parsed: Array<{ ast: SrvdAst; file: SourceFile }> = [];
  for (const file of filesOfType(project, "SRVD").filter((f) => f.extension === "srvdsrv")) {
    const result = parseSrvd(file.content);
    if (result.ast === undefined) {
      for (const e of result.errors) {
        diagnostics.error("SRVD001", e.message, { file: file.path, line: e.line, column: e.column });
      }
      continue;
    }
    parsed.push({ ast: result.ast, file });
  }
  let chosen: { ast: SrvdAst; file: SourceFile } | undefined;
  if (options.service !== undefined) {
    chosen = parsed.find((p) => p.ast.name.toUpperCase() === options.service?.toUpperCase());
    if (chosen === undefined) {
      diagnostics.error("PRJ002", `service definition ${options.service} not found`);
      return undefined;
    }
  } else if (parsed.length === 1) {
    chosen = parsed[0];
  } else if (parsed.length === 0) {
    diagnostics.error("PRJ001", "no service definition (SRVD) in the sources");
    return undefined;
  } else {
    // the service definitions of service consumption models (SCM) have no binding: the one
    // with a service binding is the service of the application
    const bound = parsed.filter((p) => bindingsOf(project, p.ast.name).length > 0);
    if (bound.length !== 1 || bound[0] === undefined) {
      diagnostics.error("PRJ001", `several service definitions, choose one with --service: ${parsed.map((p) => p.ast.name).join(", ")}`);
      return undefined;
    }
    chosen = bound[0];
    const others = parsed.filter((p) => p !== chosen).map((p) => p.ast.name);
    diagnostics.info("SRVD007", `several service definitions: ${chosen.ast.name} has a service binding and is built (not built: ${others.join(", ")})`, { file: chosen.file.path, line: chosen.ast.line });
  }
  if (chosen === undefined) {
    return undefined;
  }
  const name = chosen.ast.name.toUpperCase();
  const bindings = bindingsOf(project, name);
  const binding = bindings[0];
  if (bindings.length > 1 && options.binding === undefined) {
    diagnostics.warning("SRVD002", `several service bindings for ${name}, using ${binding?.file.name ?? ""}`);
  }
  if (binding !== undefined && binding.xml.bindingVersion !== undefined && binding.xml.bindingVersion.toUpperCase() !== "V4") {
    diagnostics.warning("SRVD003", `${binding.file.name} is an OData ${binding.xml.bindingVersion} binding; the generated service is OData V4`, { file: binding.file.path, line: 1 });
  }
  const bindingName = (options.binding ?? binding?.xml.name ?? binding?.file.name ?? `${name}_O4`).toUpperCase();
  const version = binding?.xml.version ?? "0001";
  const service: ServiceModel = {
    name,
    binding: bindingName,
    version,
    namespace: serviceNamespace(name, version),
    path: normalizePath(options.path ?? defaultServicePath(bindingName, name, version)),
    entitySets: chosen.ast.exposes.map((e) => ({ name: e.alias ?? e.entity, entity: e.entity })),
    annotations: chosen.ast.annotations,
  };
  // OData V4 - Web API (D60): no UI information in the service
  const bindingType = options.bindingType?.toLowerCase();
  if (bindingType !== undefined && bindingType !== "ui" && bindingType !== "webapi") {
    diagnostics.error("SRVD008", `--binding-type ${options.bindingType ?? ""}: ui or webapi`);
  } else if (bindingType === "webapi" || (bindingType === undefined && binding?.xml.bindingCategory === "1")) {
    service.webApi = true;
  }
  const names = new Set<string>();
  for (const set of service.entitySets) {
    if (names.has(set.name.toUpperCase())) {
      diagnostics.error("SRVD004", `entity set ${set.name} is exposed twice`, { file: chosen.file.path, line: chosen.ast.line });
    }
    names.add(set.name.toUpperCase());
  }
  return { service, ast: chosen.ast, file: chosen.file };
}

/** The service bindings (SRVB) of a service definition. */
function bindingsOf(project: Project, service: string): Array<{ file: SourceFile; xml: ReturnType<typeof readSrvbXml> }> {
  return filesOfType(project, "SRVB")
    .filter((f) => f.extension === "xml")
    .map((f) => ({ file: f, xml: readSrvbXml(f.content) }))
    .filter((b) => (b.xml.serviceDefinition ?? "").toUpperCase() === service.toUpperCase());
}

function normalizePath(path: string): string {
  const withLeading = path.startsWith("/") ? path : `/${path}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}
