/**
 * Deployment files of a generated application or launchpad (decision D50): a Cloud Foundry
 * manifest (SAP BTP), next to the Dockerfile. The runtime reads the route and the bound
 * PostgreSQL service of Cloud Foundry by itself (VCAP_APPLICATION, VCAP_SERVICES).
 */

export function cloudFoundryManifest(name: string, options: { database: boolean; memory?: string }): string {
  return `# Cloud Foundry (SAP BTP, Cloud Foundry runtime): cf push
# The runtime reads its route (PUBLIC_URL) and the bound PostgreSQL service (DATABASE_URL) by itself.
# Secrets never go in this file: cf set-env ${name} SESSION_SECRET <random>, OIDC_CLIENT_SECRET <secret>.
applications:
  - name: ${name}
    memory: ${options.memory ?? "512M"}
    disk_quota: 1G
    instances: 1
    buildpacks:
      - nodejs_buildpack
    command: npm start
    health-check-type: http
    health-check-http-endpoint: /health
    env:
      NODE_ENV: production
      # an OpenID Connect identity provider: SAP Cloud Identity Services, Keycloak, Microsoft Entra ID…
      AUTH_MODE: oidc
      OIDC_ISSUER: https://<tenant>.accounts.ondemand.com
      OIDC_CLIENT_ID: <client id>
${options.database ? `    services:
      # cf create-service postgresql-db <plan> ${name}-db
      - ${name}-db
` : ""}`;
}

export const CFIGNORE = `node_modules
data
.env
*.log
`;

/** The section "Deploy" of the README of a generated application or launchpad. */
export function deploySection(name: string, kind: "application" | "launchpad"): string {
  return `
## Deploy

The ${kind} runs anywhere Node.js 22 or a container runs. Outside \`localhost\`, set at least
\`PUBLIC_URL\` (the address users see, for the OIDC redirects), \`AUTH_MODE=oidc\` with an identity
provider, a random \`SESSION_SECRET\`${kind === "application" ? " and a PostgreSQL database (`DATABASE_URL`, `DATABASE_CA` for its certificate)" : ""}.

- **Docker** (any VM, Kubernetes, Azure Container Apps, Google Cloud Run…): \`docker build -t ${name} .\`
  then run the image with the variables of \`.env.example\`.
- **SAP BTP, Cloud Foundry**: ${kind === "application" ? `\`cf create-service postgresql-db <plan> ${name}-db\`, ` : ""}fill the
  identity provider in \`manifest.yml\`, \`cf set-env ${name} SESSION_SECRET <random>\`, then \`cf push\`.
  The route and the bound database are read from \`VCAP_APPLICATION\` and \`VCAP_SERVICES\`.
- **A machine of your network**: \`npm install && npm start\` (\`HOST=0.0.0.0\` by default).
`;
}
