/**
 * The launchpad of applications (decision D37): the configuration `rapt launchpad` resolves from
 * a `launchpad.json` and the generated applications, read by the launchpad server of the runtime.
 * As the SAP Fiori launchpad: tiles in groups, shown to the users whose roles are assigned to
 * them (the business catalogs), navigation by intent (semantic object and action), dynamic tiles
 * whose number is an OData `$count`.
 */

/** An application behind the launchpad: its UI at `/apps/<id>/`, its services at their paths. */
export interface LaunchpadApp {
  id: string;
  title: string;
  /** Where the launchpad server reaches the application (internal URL); `APP_<ID>_URL` overrides it. */
  url: string;
  /** The service roots of the application (`/sap/opu/odata4/…/`), forwarded to it unchanged. */
  servicePaths: string[];
}

export interface LaunchpadTile {
  id: string;
  title: string;
  subtitle?: string;
  /** Footer of the tile. */
  info?: string;
  /** An icon of the OpenUI5 icon font (`sap-icon://flight`) or an image URL. */
  icon?: string;
  /** Semantic object and action (`Travel-manage`): `/#Travel-manage`, `/go/Travel-manage`. */
  intent?: string;
  /** The application of the tile, when it is one behind the launchpad. */
  app?: string;
  /** Where the tile navigates: a path of the launchpad (`/apps/travel/ui/index.html`) or an external URL. */
  target: string;
  /** An external URL, opened in a new window. */
  external: boolean;
  /** Path of the launchpad answering the number of the tile (the `$count` of an entity set of an application). */
  count?: string;
  /** Roles of the identity provider the tile is assigned to; none: every user. */
  roles: string[];
}

export interface LaunchpadGroup {
  title: string;
  tiles: LaunchpadTile[];
}

/** A page of a space: sections of tiles (D48). */
export interface LaunchpadPage {
  id: string;
  title: string;
  sections: LaunchpadGroup[];
}

/**
 * A space (D48), as in the SAP Fiori launchpad: a tab of the shell with its pages, assigned to
 * roles (none: every user). A launchpad.json with groups only has one space of one page.
 */
export interface LaunchpadSpace {
  id: string;
  title: string;
  roles: string[];
  pages: LaunchpadPage[];
}

export interface LaunchpadModel {
  title: string;
  apps: LaunchpadApp[];
  /** Every section of every page (the groups of a launchpad.json without spaces). */
  groups: LaunchpadGroup[];
  /** The spaces and pages (D48); absent: one space with the groups. */
  spaces?: LaunchpadSpace[];
  /** Claims kept in the sessions: those the authorizations of the applications read (`{claim:x}`). */
  claims: string[];
  /** The roles of the applications (rapt/authorizations.json) and of the tiles. */
  roles: Array<{ name: string; description?: string }>;
}

/** Whether a user with these roles sees the tile (`*`: the development user with every role). */
export function tileVisible(tile: Pick<LaunchpadTile, "roles">, roles: string[]): boolean {
  return tile.roles.length === 0 || roles.includes("*") || tile.roles.some((r) => roles.includes(r));
}

/** The environment variable giving the internal URL of an application: `APP_<ID>_URL`. */
export function appUrlVariable(id: string): string {
  return `APP_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_URL`;
}

/** Paths of the launchpad itself: a service path of an application may not start with them. */
export const LAUNCHPAD_RESERVED_PATHS = ["/ui", "/resources", "/apps", "/auth", "/launchpad", "/go", "/health"];
