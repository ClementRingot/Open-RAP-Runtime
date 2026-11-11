/**
 * `rapt abapgit` (decision D42): writes the abapGit metadata (`.xml` files, `.abapgit.xml`,
 * `package.devc.xml`) the sources lack, so that a project written only as source code can be
 * pulled into an SAP system with abapGit.
 *
 * - tables written as source (`.tabl.astabl`): their XML is (re)generated from the source, and
 *   `.abapgit.xml` ignores the `.astabl` files (abapGit does not know them);
 * - CDS entities, metadata extensions, access controls, behavior definitions, service
 *   definitions, classes and interfaces: the XML is created when missing (description from
 *   `@EndUserText.label` or the ABAP Doc short text, CDS source type from the source); an existing
 *   XML file is never changed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { abapGitXml, xmlElement } from "../ddic/table-source.js";
import { loadProject, type Project, type ProjectIssue, type SourceFile } from "../input/project.js";

export interface AbapGitOptions {
  /** Only report what would be written (exit code 1 when something is missing). */
  check?: boolean;
  /** Description of the package (package.devc.xml), default: the folder name. */
  packageDescription?: string;
}

export interface AbapGitResult {
  /** Files written (or to write, with `check`), relative to the project root. */
  written: string[];
  /** Objects whose XML cannot be derived from a source. */
  skipped: { file: string; reason: string }[];
  issues: ProjectIssue[];
}

const DESCRIPTION_LIMIT = 60;
const ASTABL_IGNORE = "*.astabl";

const DEFAULT_DOT_ABAPGIT = `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
 <asx:values>
  <DATA>
   <MASTER_LANGUAGE>E</MASTER_LANGUAGE>
   <STARTING_FOLDER>/src/</STARTING_FOLDER>
   <FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>
   <IGNORE>
    <item>/.gitignore</item>
    <item>/LICENSE</item>
    <item>/README.md</item>
   </IGNORE>
  </DATA>
 </asx:values>
</asx:abap>
`;

const truncate = (text: string): string => (text.length > DESCRIPTION_LIMIT ? text.slice(0, DESCRIPTION_LIMIT) : text);

/** `@EndUserText.label: '…'` before the definition. */
export function cdsLabel(source: string): string | undefined {
  const header = source.split(/\bdefine\b|\bannotate\b|\bextend\b/i)[0] ?? source;
  return /@EndUserText\.label\s*:\s*'((?:[^']|'')*)'/i.exec(header)?.[1]?.replace(/''/g, "'");
}

/** Source type of a CDS DDL source (DDLS-SOURCE_TYPE). */
export function ddlSourceType(source: string): string | undefined {
  const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (/\bdefine\s+(?:root\s+)?view\s+entity\s+\S+(?:\s+provider\s+contract\s+\w+)?\s+as\s+projection\s+on\b/i.test(code)) return "P";
  if (/\bdefine\s+(?:root\s+)?view\s+entity\b/i.test(code)) return "W";
  if (/\bdefine\s+(?:root\s+)?abstract\s+entity\b/i.test(code)) return "A";
  if (/\bdefine\s+(?:root\s+)?custom\s+entity\b/i.test(code)) return "Q";
  if (/\bdefine\s+(?:root\s+)?table\s+entity\b/i.test(code)) return "T";
  if (/\bdefine\s+table\s+function\b/i.test(code)) return "F";
  if (/\bdefine\s+(?:root\s+)?hierarchy\b/i.test(code)) return "H";
  if (/\bdefine\s+(?:root\s+)?view\b/i.test(code)) return "V";
  return undefined;
}

/** The ABAP Doc short text of a class or interface: `"! <p class="shorttext synchronized">…</p>`. */
export function abapDocShortText(source: string): string | undefined {
  return /"!\s*<p\s+class="shorttext[^"]*"[^>]*>([^<]*)<\/p>/i.exec(source)?.[1]?.trim();
}

function ddlsXml(name: string, source: string, type: string): string {
  return abapGitXml(
    "DDLS",
    xmlElement(
      "DDLS",
      [
        ["DDLNAME", name],
        ["DDLANGUAGE", "E"],
        ["DDTEXT", truncate(cdsLabel(source) ?? name)],
        ["SOURCE_TYPE", type],
      ],
      3,
    ),
  );
}

function adtObjectXml(serializer: string, type: string, name: string, description: string, extra: [string, string][] = []): string {
  return abapGitXml(
    serializer,
    xmlElement(
      serializer,
      [
        ["NAME", name],
        ["TYPE", type],
        ["DESCRIPTION", truncate(description)],
        ["DESCRIPTION_TEXT_LIMIT", String(DESCRIPTION_LIMIT)],
        ["LANGUAGE", "EN"],
        ...extra,
      ],
      3,
    ),
  );
}

function classXml(name: string, files: SourceFile[]): string {
  const main = files.find((f) => f.extension === "abap")?.content ?? "";
  const behavior = /\bfor\s+behavior\s+of\s+(\S+?)\s*[.\s]/i.exec(main)?.[1];
  const description = abapDocShortText(main) ?? (behavior === undefined ? name : `Behavior pool of ${behavior.toUpperCase()}`);
  const definition = /\bclass\s+\S+\s+definition\b([\s\S]*?)\./i.exec(main)?.[1] ?? "";
  const exception = /\binheriting\s+from\s+c[xy]_/i.test(definition);
  return abapGitXml(
    "CLAS",
    xmlElement(
      "VSEOCLASS",
      [
        ["CLSNAME", name],
        ["LANGU", "E"],
        ["DESCRIPT", truncate(description)],
        ["CATEGORY", exception ? "40" : undefined],
        ["STATE", "1"],
        ["CLSCCINCL", "X"],
        ["FIXPT", "X"],
        ["UNICODE", "X"],
        ["WITH_UNIT_TESTS", files.some((f) => f.extension === "testclasses.abap") ? "X" : undefined],
        ["ABSTRACT", /\babstract\b/i.test(definition) || behavior !== undefined ? "X" : undefined],
      ],
      3,
    ),
  );
}

function interfaceXml(name: string, source: string): string {
  return abapGitXml(
    "INTF",
    xmlElement(
      "VSEOINTERF",
      [
        ["CLSNAME", name],
        ["LANGU", "E"],
        ["DESCRIPT", truncate(abapDocShortText(source) ?? name)],
        ["EXPOSURE", "2"],
        ["STATE", "1"],
        ["UNICODE", "X"],
      ],
      3,
    ),
  );
}

/** The XML of one object, from its source files; undefined when it cannot be derived. */
function objectXml(type: string, name: string, files: SourceFile[]): string | { reason: string } {
  const source = (extension: string): string | undefined => files.find((f) => f.extension === extension)?.content;
  switch (type) {
    case "DDLS": {
      const ddl = source("asddls") ?? "";
      const sourceType = ddlSourceType(ddl);
      return sourceType === undefined ? { reason: "unknown kind of CDS definition (view entity, projection, abstract, custom or table entity expected)" } : ddlsXml(name, ddl, sourceType);
    }
    case "DDLX": {
      const ddlx = source("asddlxs") ?? "";
      const target = /\bannotate\s+(?:entity|view)\s+(\S+)/i.exec(ddlx)?.[1];
      return adtObjectXml("DDLX", "DDLX/EX", name, cdsLabel(ddlx) ?? `Metadata extension of ${target?.toUpperCase() ?? name}`);
    }
    case "DCLS": {
      const dcl = source("asdcls") ?? "";
      return abapGitXml(
        "DCLS",
        xmlElement(
          "DCLS",
          [
            ["DCLNAME", name],
            ["DDLANGUAGE", "E"],
            ["DDTEXT", truncate(cdsLabel(dcl) ?? `Access control ${name}`)],
          ],
          3,
        ),
      );
    }
    case "BDEF":
      return adtObjectXml("BDEF", "BDEF/BDO", name, `Behavior of ${name}`);
    case "SRVD": {
      const srvd = source("srvdsrv") ?? "";
      return adtObjectXml("SRVD", "SRVD/SRV", name, cdsLabel(srvd) ?? `Service ${name}`, [["SOURCE_TYPE", "S"]]);
    }
    case "CLAS":
      return classXml(name, files);
    case "INTF":
      return interfaceXml(name, source("abap") ?? "");
    default:
      return { reason: `the XML of a ${type} object cannot be derived from a source: write it in ADT or with "rapt new"` };
  }
}

/** Adds `*.astabl` to the ignored files of `.abapgit.xml`. */
function ignoreTableSources(xml: string): string {
  if (xml.includes(ASTABL_IGNORE)) {
    return xml;
  }
  const folder = /<STARTING_FOLDER>([^<]*)<\/STARTING_FOLDER>/.exec(xml)?.[1] ?? "/src/";
  const item = `<item>${folder}${ASTABL_IGNORE}</item>`;
  if (/<IGNORE\s*\/>/.test(xml)) {
    return xml.replace(/<IGNORE\s*\/>/, `<IGNORE>\n    ${item}\n   </IGNORE>`);
  }
  if (xml.includes("</IGNORE>")) {
    return xml.replace(/(\n?)(\s*)<\/IGNORE>/, `\n    ${item}$1$2</IGNORE>`);
  }
  return xml.replace(/(\s*)<\/DATA>/, `\n   <IGNORE>\n    ${item}\n   </IGNORE>$1</DATA>`);
}

export function generateAbapGitFiles(dir: string, options: AbapGitOptions = {}): AbapGitResult {
  const root = path.resolve(dir);
  const result: AbapGitResult = { written: [], skipped: [], issues: [] };
  const write = (file: string, content: string): void => {
    const absolute = path.join(root, file);
    if (existsSync(absolute) && readFileSync(absolute, "utf8") === content) {
      return;
    }
    result.written.push(file.split(path.sep).join("/"));
    if (options.check !== true) {
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
  };

  // .abapgit.xml, first: it gives the folder of the sources
  const dotAbapGit = path.join(root, ".abapgit.xml");
  const hadDotAbapGit = existsSync(dotAbapGit);
  const existing = hadDotAbapGit ? readFileSync(dotAbapGit, "utf8") : DEFAULT_DOT_ABAPGIT;
  let project: Project = loadProject(root);
  const hasTableSources = project.files.some((f) => f.generatedFrom === "astabl" && f.standard !== true);
  write(".abapgit.xml", hasTableSources ? ignoreTableSources(existing) : existing);
  if (!hadDotAbapGit && options.check !== true) {
    project = loadProject(root);
  }
  result.issues.push(...project.issues);

  const relative = (absolute: string): string => path.relative(root, absolute);
  const sourceRoot = hadDotAbapGit || options.check !== true ? project.sourceRoot : path.join(root, "src");
  const packageFile = path.join(sourceRoot, "package.devc.xml");
  if (!existsSync(packageFile)) {
    const description = options.packageDescription ?? path.basename(root);
    write(relative(packageFile), abapGitXml("DEVC", xmlElement("DEVC", [["CTEXT", truncate(description)]], 3)));
  }

  // objects: type:name → files
  const objects = new Map<string, SourceFile[]>();
  for (const file of project.files) {
    if (file.standard === true) {
      continue; // a standard object of SAP (D44), not a file of the project
    }
    const key = `${file.type}:${file.name}`;
    objects.set(key, [...(objects.get(key) ?? []), file]);
  }
  for (const [key, files] of objects) {
    const [type = "", name = ""] = key.split(":");
    const generated = files.find((f) => f.generatedFrom === "astabl");
    if (generated !== undefined) {
      write(relative(path.join(path.dirname(generated.absolute), generated.fileName)), generated.content);
      continue;
    }
    if (files.some((f) => f.extension === "xml")) {
      continue;
    }
    const main = files[0];
    if (main === undefined) {
      continue;
    }
    const xml = objectXml(type, name, files);
    if (typeof xml !== "string") {
      result.skipped.push({ file: main.path, reason: xml.reason });
      continue;
    }
    const baseName = main.fileName.split(".")[0] ?? name.toLowerCase();
    write(relative(path.join(path.dirname(main.absolute), `${baseName}.${type.toLowerCase()}.xml`)), xml);
  }
  return result;
}
