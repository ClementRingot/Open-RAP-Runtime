/**
 * The realm of the Keycloak of a generated docker-compose (application D15, launchpad D37): the
 * OIDC client, the roles (rapt/authorizations.json, D34) given to the user alice, and for each
 * claim the roles read (`{claim:x}`) a user attribute (declared in the user profile, set by the
 * administrator) mapped into the tokens.
 */

export interface RealmOptions {
  clientId: string;
  clientName: string;
  secret: string;
  /** Public URL of the client (`http://localhost:8080`): redirect URI, web origin, logout. */
  url: string;
  roles: Array<{ name: string; description?: string }>;
  claims: string[];
}

/** The default attributes of the Keycloak user profile (declarative user profile, Keycloak 24+). */
const PROFILE_ATTRIBUTES = [
  { name: "username", displayName: "${username}", validations: { length: { min: 3, max: 255 }, "username-prohibited-characters": {}, "up-username-not-idn-homograph": {} }, permissions: { view: ["admin", "user"], edit: ["admin", "user"] }, multivalued: false },
  { name: "email", displayName: "${email}", validations: { email: {}, length: { max: 255 } }, required: { roles: ["user"] }, permissions: { view: ["admin", "user"], edit: ["admin", "user"] }, multivalued: false },
  { name: "firstName", displayName: "${firstName}", validations: { length: { max: 255 }, "person-name-prohibited-characters": {} }, required: { roles: ["user"] }, permissions: { view: ["admin", "user"], edit: ["admin", "user"] }, multivalued: false },
  { name: "lastName", displayName: "${lastName}", validations: { length: { max: 255 }, "person-name-prohibited-characters": {} }, required: { roles: ["user"] }, permissions: { view: ["admin", "user"], edit: ["admin", "user"] }, multivalued: false },
];

/** The user attribute holding a claim (Keycloak attribute names: letters, digits, `_` and `-`). */
export const claimAttribute = (claim: string): string => claim.replace(/[^A-Za-z0-9_-]/g, "_");

export function keycloakRealm(options: RealmOptions): Record<string, unknown> {
  const { roles, claims } = options;
  const result: Record<string, unknown> = {
    realm: "rapt",
    enabled: true,
    roles: { realm: [{ name: "rapt_user", description: "User of the generated application" }, ...roles.filter((r) => r.name !== "rapt_user").map((r) => ({ name: r.name, ...(r.description === undefined ? {} : { description: r.description }) }))] },
    clients: [
      {
        clientId: options.clientId,
        name: options.clientName,
        enabled: true,
        protocol: "openid-connect",
        publicClient: false,
        secret: options.secret,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        redirectUris: [`${options.url}/auth/callback`],
        webOrigins: [options.url],
        attributes: { "pkce.code.challenge.method": "S256", "post.logout.redirect.uris": `${options.url}/*` },
        ...(claims.length === 0
          ? {}
          : {
              protocolMappers: claims.map((claim) => ({
                name: claim,
                protocol: "openid-connect",
                protocolMapper: "oidc-usermodel-attribute-mapper",
                consentRequired: false,
                config: {
                  "user.attribute": claimAttribute(claim),
                  "claim.name": claim,
                  "jsonType.label": "String",
                  multivalued: "true",
                  "id.token.claim": "true",
                  "access.token.claim": "true",
                  "userinfo.token.claim": "true",
                  "introspection.token.claim": "true",
                },
              })),
            }),
      },
    ],
    users: [
      {
        username: "alice",
        enabled: true,
        firstName: "Alice",
        lastName: "Example",
        email: "alice@example.org",
        emailVerified: true,
        credentials: [{ type: "password", value: "alice", temporary: false }],
        realmRoles: ["rapt_user", ...roles.filter((r) => r.name !== "rapt_user").map((r) => r.name)],
      },
    ],
  };
  if (claims.length > 0) {
    result["components"] = {
      "org.keycloak.userprofile.UserProfileProvider": [
        {
          providerId: "declarative-user-profile",
          subComponents: {},
          config: {
            "kc.user.profile.config": [
              JSON.stringify({
                attributes: [...PROFILE_ATTRIBUTES, ...claims.map((claim) => ({ name: claimAttribute(claim), displayName: claim, permissions: { view: ["admin"], edit: ["admin"] }, multivalued: true }))],
                groups: [{ name: "user-metadata", displayHeader: "User metadata", displayDescription: "Attributes, which refer to user metadata" }],
              }),
            ],
          },
        },
      ],
    };
  }
  return result;
}
