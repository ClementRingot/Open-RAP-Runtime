/**
 * The development launchpad of `rapt dev` (decision D49): at `/`, a launchpad with the application
 * and the development tools (documentation, $metadata, MCP tools), served by the application
 * itself. Its configuration is `home/launchpad.json` of the development build; `/launchpad/config`
 * gives the application and the documentation app the shell bar of the launchpad.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { LaunchpadModel } from "@open-rap-runtime/model";
import type { Authenticator } from "../auth/auth.js";
import { launchpadView } from "./server.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Serves the files of `dir` at `/<mount>/`. */
function serveFolder(app: FastifyInstance, mount: string, dir: string): void {
  const root = path.resolve(dir);
  app.get(`/${mount}/*`, async (request, reply) => {
    const relative = path.posix.normalize((request.params as { "*": string })["*"] || "index.html").replace(/^(\.\.(\/|$))+/, "");
    const file = path.join(root, relative);
    if (!file.startsWith(root)) {
      return reply.status(404).send("Not found");
    }
    try {
      return reply.header("Cache-Control", "no-cache").type(TYPES[path.extname(file)] ?? "application/octet-stream").send(await readFile(file));
    } catch {
      return reply.status(404).type("text/plain").send("Not found");
    }
  });
  app.get(`/${mount}`, async (_request, reply) => reply.redirect(`/${mount}/index.html`));
}

export function registerDevLaunchpad(app: FastifyInstance, options: { dir: string; config: LaunchpadModel; authenticator: Authenticator }): void {
  serveFolder(app, "home", path.join(options.dir, "home"));
  serveFolder(app, "docs", path.join(options.dir, "docs"));
  app.get("/launchpad/config", async (request, reply) => {
    const user = request.user ?? (await options.authenticator.fromAuthorization(request.headers.authorization).catch(() => undefined));
    if (user === undefined) {
      return reply.status(401).send({ error: "authentication required" });
    }
    const view = launchpadView(options.config, user, undefined);
    return reply.header("Cache-Control", "no-store").send({ ...view, home: "/", logo: "/home/logo.svg" });
  });
}
