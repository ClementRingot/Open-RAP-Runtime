/**
 * The launchpad of applications (decision D37), the counterpart of the SAP Fiori launchpad built
 * with OpenUI5: one origin for the browser, one login, and tiles assigned to roles.
 *
 * - `/` and `/ui/`: the launchpad (ShellBar, groups of tiles, dynamic tiles with a `$count`);
 * - `/launchpad/config`: the tiles the user sees (roles of the identity provider), the user;
 * - `/go/<SemanticObject>-<action>`: navigation by intent to the application of a tile;
 * - `/apps/<id>/…`: the UI of an application, forwarded to it; its services keep their paths;
 * - `/auth/…`: the login (OIDC, authorization code with PKCE) whose session the applications read
 *   (same `SESSION_SECRET`): a single sign-on, as the session of the front-end server of SAP.
 *
 * Configuration by the environment, as an application (server.ts): `PORT` (8090), `HOST`,
 * `PUBLIC_URL`, `LOG_LEVEL`, `AUTH_MODE`, `DEV_USER`, `DEV_ROLES`, `OIDC_*`, `SESSION_SECRET`, and
 * `APP_<ID>_URL` for the internal URL of each application.
 */

import { platformEnvironment } from "../platform.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import { appUrlVariable, tileVisible, type LaunchpadApp, type LaunchpadModel, type LaunchpadTile } from "@open-rap-runtime/model";
import { AuthenticationError, Authenticator, type AuthOptions } from "../auth/auth.js";
import { authFromEnvironment } from "../auth/environment.js";
import { OidcSessions } from "../auth/session.js";
import type { User } from "../auth/user.js";
import { registerUi, type UiOptions } from "../ui/plugin.js";
import { forward, targetUrl } from "./proxy.js";

export interface LaunchpadOptions {
  config: LaunchpadModel;
  auth?: AuthOptions;
  /** The `ui/` folder of the generated launchpad and the OpenUI5 resources. */
  ui?: UiOptions;
  /** Internal URLs of the applications, replacing those of the configuration (`APP_<ID>_URL`). */
  appUrls?: Record<string, string>;
  logger?: FastifyServerOptions["logger"];
  /** Timeout of a request forwarded to an application (ms, default 120 s). */
  timeout?: number;
}

/** The tiles of the launchpad for a user, as `/launchpad/config` answers them. */
export interface LaunchpadView {
  title: string;
  /** The home page and the mark of the launchpad, for the shell bar of the applications. */
  home: string;
  logo: string;
  user: { id: string; name: string; initials: string };
  /** The logout of the launchpad (OIDC sessions). */
  logout?: string;
  groups: ViewGroup[];
  /** The spaces and pages of the user (D48): one space of one page when launchpad.json has groups only. */
  spaces: Array<{ id: string; title: string; pages: Array<{ id: string; title: string; groups: ViewGroup[] }> }>;
}

type ViewGroup = { title: string; tiles: Array<Omit<LaunchpadTile, "roles" | "app">> };

function initials(name: string): string {
  const words = name.split(/[\s._@-]+/).filter((w) => w !== "");
  const letters = words.length >= 2 ? `${words[0]?.[0] ?? ""}${words[words.length - 1]?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase();
}

/** The tiles a user sees; the groups without such a tile are left out. */
export function launchpadView(config: LaunchpadModel, user: User, logout: string | undefined): LaunchpadView {
  const name = user.name ?? user.id;
  const view: LaunchpadView = { title: config.title, home: "/", logo: "/ui/logo.svg", user: { id: user.id, name, initials: initials(name) }, groups: [], spaces: [] };
  if (logout !== undefined) {
    view.logout = logout;
  }
  const visibleGroups = (groups: LaunchpadModel["groups"]): ViewGroup[] =>
    groups
      .map((group) => ({ title: group.title, tiles: group.tiles.filter((t) => tileVisible(t, user.roles)).map(({ roles: _roles, app: _app, ...tile }) => tile) }))
      .filter((group) => group.tiles.length > 0);
  const spaces = config.spaces ?? [{ id: "home", title: config.title, roles: [], pages: [{ id: "home", title: config.title, sections: config.groups }] }];
  for (const space of spaces) {
    if (!tileVisible(space, user.roles)) {
      continue;
    }
    const pages = space.pages.map((page) => ({ id: page.id, title: page.title, groups: visibleGroups(page.sections) })).filter((page) => page.groups.length > 0);
    if (pages.length > 0) {
      view.spaces.push({ id: space.id, title: space.title, pages });
      view.groups.push(...pages.flatMap((page) => page.groups));
    }
  }
  return view;
}

const servicePathOf = (pathname: string, apps: Array<{ app: LaunchpadApp; root: string }>): { app: LaunchpadApp; root: string } | undefined =>
  apps.find(({ root }) => pathname === root || pathname.startsWith(`${root}/`));

export async function createLaunchpad(options: LaunchpadOptions): Promise<FastifyInstance> {
  const { config } = options;
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 20 * 1024 * 1024, return503OnClosing: true });
  const auth = options.auth ?? { mode: "none" };
  const authenticator = new Authenticator(auth);
  if (auth.mode === "oidc" && auth.session === undefined) {
    throw new Error("the launchpad needs browser sessions: set OIDC_CLIENT_ID and SESSION_SECRET");
  }
  const sessions = auth.mode === "oidc" && auth.session !== undefined ? new OidcSessions(authenticator, { ...auth, session: auth.session }) : undefined;
  const timeout = options.timeout ?? 120_000;
  const urls = new Map(config.apps.map((a) => [a.id, new URL(options.appUrls?.[a.id] ?? a.url)]));
  const services = config.apps.flatMap((a) => a.servicePaths.map((p) => ({ app: a, root: p.replace(/\/$/, "") })));

  // bodies are forwarded as they came
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.decorateRequest("user", undefined);

  app.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?")[0] ?? "/";
    if (pathname === "/health" || pathname === "/auth" || pathname.startsWith("/auth/") || pathname.startsWith("/resources/")) {
      return;
    }
    const service = servicePathOf(pathname, services) !== undefined;
    const api = service || pathname.startsWith("/launchpad/");
    try {
      // a session of the launchpad, else (API clients) a bearer token; the development user
      const user = (request.headers.authorization === undefined ? sessions?.user(request) : undefined) ?? (sessions === undefined || request.headers.authorization !== undefined ? await authenticator.fromAuthorization(request.headers.authorization) : undefined);
      if (user !== undefined) {
        request.user = user;
        return;
      }
      if (!api && sessions !== undefined && (request.method === "GET" || request.method === "HEAD")) {
        return reply.redirect(sessions.loginUrl(pathname === "/" ? "/ui/index.html" : request.url));
      }
      throw new AuthenticationError("authentication required");
    } catch (error) {
      const status = error instanceof AuthenticationError ? error.status : 401;
      const message = (error as Error).message;
      if (status === 401) {
        reply.header("WWW-Authenticate", 'Bearer realm="open-rap-runtime"');
      }
      return api ? reply.status(status).type("application/json").send({ error: { code: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED", message } }) : reply.status(status).type("text/plain").send(message);
    }
  });

  const logout = sessions === undefined ? undefined : "/auth/logout";
  app.get("/launchpad/config", async (request, reply) => reply.header("Cache-Control", "no-store").send(launchpadView(config, request.user as User, logout)));

  // navigation by intent: the first tile of the user with this semantic object and action
  app.get("/go/:intent", async (request, reply) => {
    const intent = (request.params as { intent: string }).intent;
    const user = request.user as User;
    const tile = config.groups.flatMap((g) => g.tiles).find((t) => t.intent === intent && tileVisible(t, user.roles));
    if (tile === undefined) {
      return reply.status(404).type("text/plain").send(`No application of the launchpad for the intent ${intent}`);
    }
    const question = request.url.indexOf("?");
    const query = question < 0 ? "" : request.url.slice(question + 1);
    const target = query === "" ? tile.target : `${tile.target}${tile.target.includes("?") ? "&" : "?"}${query}`;
    return reply.redirect(target);
  });

  const mounted = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { id } = request.params as { id: string };
    const base = urls.get(id);
    if (base === undefined) {
      return reply.status(404).type("text/plain").send(`No application ${id} in the launchpad`);
    }
    const prefix = `/apps/${id}`;
    const rest = request.url.slice(prefix.length);
    if (rest === "" || rest.startsWith("?")) {
      return reply.redirect(`${prefix}/${rest}`);
    }
    return forward(request, reply, targetUrl(base, rest), { prefix, timeout, app: id, odata: false });
  };
  const methods: Array<"GET" | "HEAD" | "POST" | "PATCH" | "PUT" | "DELETE"> = ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"];
  app.route({ method: methods, url: "/apps/:id", handler: mounted });
  app.route({ method: methods, url: "/apps/:id/*", handler: mounted });

  // the services of the applications, at their own paths (the URIs of their UIs)
  for (const { app: target, root } of services) {
    const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const base = urls.get(target.id) as URL;
      return forward(request, reply, targetUrl(base, request.url), { timeout, app: target.id, odata: true });
    };
    app.route({ method: methods, url: root, handler });
    app.route({ method: methods, url: `${root}/*`, handler });
  }

  app.get("/health", async () => ({ status: "ok" }));
  sessions?.register(app);
  if (options.ui !== undefined) {
    await registerUi(app, options.ui);
  }
  return app;
}

export interface StartLaunchpadOptions {
  /** The generated launchpad folder (launchpad/config.json, ui/). */
  dir: string;
  env?: Record<string, string | undefined>;
  listen?: boolean;
}

export interface RunningLaunchpad {
  app: FastifyInstance;
  url: string;
  close(): Promise<void>;
}

/** Start-up of a generated launchpad (`node server.mjs`), configured by the environment. */
export async function startLaunchpad(options: StartLaunchpadOptions): Promise<RunningLaunchpad> {
  const env = platformEnvironment(options.env ?? process.env);
  const dir = path.resolve(options.dir);
  const port = Number(env["PORT"] ?? 8090);
  const host = env["HOST"] ?? "0.0.0.0";
  const publicUrl = env["PUBLIC_URL"] ?? `http://localhost:${port}/`;
  const config = JSON.parse(readFileSync(path.join(dir, "launchpad", "config.json"), "utf8")) as LaunchpadModel;
  const appUrls: Record<string, string> = {};
  for (const a of config.apps) {
    const url = env[appUrlVariable(a.id)];
    if (url !== undefined && url !== "") {
      appUrls[a.id] = url;
    }
  }
  const app = await createLaunchpad({
    config,
    auth: authFromEnvironment(env, publicUrl, config.claims),
    appUrls,
    logger: { level: env["LOG_LEVEL"] ?? "info" },
    ui: { dir: path.join(dir, "ui"), resourcesFrom: dir },
  });
  let url = publicUrl;
  if (options.listen !== false) {
    url = (await app.listen({ port, host })).replace("0.0.0.0", "localhost");
  } else {
    await app.ready();
  }
  return { app, url, close: () => app.close() };
}
