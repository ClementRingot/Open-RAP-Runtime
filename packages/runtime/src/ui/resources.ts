/**
 * The OpenUI5 resources of the generated UI, served from the npm packages of OpenUI5
 * (`@openui5/*`, Apache-2.0) without a UI5 build: the sources of the libraries, and the theme
 * CSS compiled on first request with less-openui5 (Apache-2.0), then cached.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

export const OPENUI5_LIBRARIES = [
  "@openui5/sap.ui.core",
  "@openui5/sap.m",
  "@openui5/sap.f",
  "@openui5/sap.uxap",
  "@openui5/sap.ui.layout",
  "@openui5/sap.ui.unified",
  "@openui5/themelib_sap_horizon",
];

const TYPES: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".properties": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
};

export interface Resource {
  body: Buffer | string;
  type: string;
}

interface ThemeBuild {
  css: string;
  rtl: string;
  parameters: string;
}

interface LessBuilder {
  build(options: { lessInputPath: string; rootPaths: string[]; library?: { name: string } }): Promise<{ css: string; cssRtl: string; variables: Record<string, string> }>;
}

export class Ui5Resources {
  private readonly roots: string[];
  private readonly themes = new Map<string, Promise<ThemeBuild>>();
  private builder: LessBuilder | undefined;
  private readonly require: NodeJS.Require;

  /** `from`: a directory whose node_modules hold the OpenUI5 packages (the application). */
  public constructor(from: string, libraries = OPENUI5_LIBRARIES) {
    this.require = createRequire(path.join(path.resolve(from), "package.json"));
    this.roots = libraries.map((name) => path.join(path.dirname(this.require.resolve(`${name}/package.json`)), "src"));
  }

  /** A resource by its path below `resources/` (`sap/m/Button.js`). */
  public async get(resource: string): Promise<Resource | undefined> {
    const clean = path.posix.normalize(resource).replace(/^(\.\.(\/|$))+/, "");
    if (clean.startsWith("/") || clean.includes("\0")) {
      return undefined;
    }
    const theme = /^(.+\/themes\/[^/]+)\/(library\.css|library-RTL\.css|library-parameters\.json)$/.exec(clean);
    if (theme !== null) {
      const build = await this.theme(theme[1] as string);
      if (build !== undefined) {
        const file = theme[2];
        return file === "library.css" ? { body: build.css, type: TYPES[".css"] as string } : file === "library-RTL.css" ? { body: build.rtl, type: TYPES[".css"] as string } : { body: build.parameters, type: TYPES[".json"] as string };
      }
    }
    for (const root of this.roots) {
      try {
        const body = await readFile(path.join(root, clean));
        return { body, type: TYPES[path.extname(clean)] ?? "application/octet-stream" };
      } catch {
        // next package
      }
    }
    return undefined;
  }

  /** Compiles `<lib>/themes/<theme>/library.source.less` with all the packages as roots. */
  private theme(folder: string): Promise<ThemeBuild | undefined> {
    const source = `${folder}/library.source.less`;
    let build = this.themes.get(source);
    if (build === undefined) {
      const builder = (this.builder ??= new (this.require("less-openui5") as { Builder: new () => LessBuilder }).Builder());
      build = (async () => {
        // the library name gives its private parameters (_sap_m_…) and the inline parameters
        const library = folder.slice(0, folder.indexOf("/themes/")).replace(/\//g, ".");
        const result = await builder.build({ lessInputPath: source, rootPaths: this.roots, library: { name: library } });
        return { css: result.css, rtl: result.cssRtl, parameters: JSON.stringify(result.variables) };
      })();
      build.catch(() => this.themes.delete(source));
      this.themes.set(source, build);
    }
    return build.catch(() => undefined);
  }
}
