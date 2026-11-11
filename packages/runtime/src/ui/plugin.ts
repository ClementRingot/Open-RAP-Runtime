/**
 * Serves the generated UI: the application (`ui/` of the generated folder) at `/ui/`, and the
 * OpenUI5 resources at `/resources/` (npm packages of OpenUI5, see resources.ts).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { Ui5Resources } from "./resources.js";

export interface UiOptions {
  /** The `ui/` folder of the generated application. */
  dir: string;
  /** A folder whose node_modules hold the OpenUI5 packages (default: the parent of `dir`). */
  resourcesFrom?: string;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".properties": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

export async function registerUi(app: FastifyInstance, options: UiOptions): Promise<void> {
  const root = path.resolve(options.dir);
  const resources = new Ui5Resources(options.resourcesFrom ?? path.dirname(root));

  app.get("/resources/*", async (request, reply) => {
    const resource = await resources.get((request.params as { "*": string })["*"]);
    if (resource === undefined) {
      return reply.status(404).type("text/plain").send("Not found");
    }
    return reply.header("Cache-Control", "public, max-age=3600").type(resource.type).send(resource.body);
  });

  app.get("/ui/*", async (request, reply) => {
    const relative = path.posix.normalize((request.params as { "*": string })["*"] || "index.html").replace(/^(\.\.(\/|$))+/, "");
    const file = path.join(root, relative);
    if (!file.startsWith(root)) {
      return reply.status(404).send("Not found");
    }
    try {
      const body = await readFile(file);
      return reply.header("Cache-Control", "no-cache").type(TYPES[path.extname(file)] ?? "application/octet-stream").send(body);
    } catch {
      return reply.status(404).type("text/plain").send("Not found");
    }
  });

  app.get("/ui", async (_request, reply) => reply.redirect("/ui/index.html"));
  app.get("/", async (_request, reply) => reply.redirect("/ui/index.html"));
}
