# Déployer une application ou un launchpad

Une application générée par `rapt build` (ou un launchpad par `rapt launchpad`) est un dossier
autonome : Node.js 22, un `package.json`, un `Dockerfile`, un `manifest.yml` Cloud Foundry. Elle
se déploie partout où Node.js ou un conteneur tourne ([D50](DECISIONS.md)).

## Ce qu'il faut régler hors de `localhost`

| Variable | Pourquoi |
|---|---|
| `PUBLIC_URL` | L'adresse que voient les utilisateurs (`https://travel.example.com/`) : redirections OIDC. Déduite de la route sur Cloud Foundry. |
| `AUTH_MODE=oidc`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Un fournisseur d'identité : SAP Cloud Identity Services (IAS), Keycloak, Microsoft Entra ID, Auth0… Ne jamais exposer `AUTH_MODE=none` sur un réseau. |
| `SESSION_SECRET` | Une valeur aléatoire longue, la même pour le launchpad et ses applications. |
| `DATABASE_URL` (et `DATABASE_CA`) | Un PostgreSQL (14 ou plus) et, si besoin, le certificat de son serveur. Déduits d'un service PostgreSQL lié sur Cloud Foundry. |
| `OIDC_REQUIRED_ROLE` | Facultatif : le rôle sans lequel l'application refuse l'accès. |

Toutes les variables sont dans le `.env.example` généré. Les secrets ne vont jamais dans
`manifest.yml` ni dans le dépôt.

## Docker (VM, Kubernetes, Azure Container Apps, Google Cloud Run…)

```sh
rapt build mon-projet --out out/travel
cd out/travel
docker build -t travel .
docker run -p 8080:8080 --env-file .env travel
```

Le `docker-compose.yml` généré lance l'application avec PostgreSQL (et Keycloak avec
`--profile oidc`) : utile pour un serveur de recette.

## SAP BTP, environnement Cloud Foundry

```sh
rapt build mon-projet --out out/travel && cd out/travel
cf create-service postgresql-db <plan> travel-db       # le nom attendu par manifest.yml
# manifest.yml : renseigner OIDC_ISSUER et OIDC_CLIENT_ID (application IAS en OpenID Connect)
cf push --no-start
cf set-env travel SESSION_SECRET "$(openssl rand -hex 32)"
cf set-env travel OIDC_CLIENT_SECRET <secret>
cf start travel
```

Le runtime lit `VCAP_APPLICATION` (route → `PUBLIC_URL`) et `VCAP_SERVICES` (PostgreSQL lié →
`DATABASE_URL`, `DATABASE_CA`). Le buildpack Node.js installe les dépendances (`vendor/` contient
le runtime de rap-transpiler). Contrôle de santé : `/health`.

Pour un launchpad : pousser chaque application, puis donner leurs routes au launchpad
(`cf set-env launchpad APP_TRAVEL_URL https://travel.cfapps…`) ; le launchpad et ses
applications partagent `SESSION_SECRET` et le même client OIDC.

## Une machine du réseau

```sh
npm install && npm start             # écoute sur 0.0.0.0:8080 (HOST, PORT)
```

Pendant le développement, `rapt dev --host 0.0.0.0` ouvre aussi le serveur de développement au
réseau (collègues, téléphone), toujours sans connexion : à réserver à un réseau de confiance.

## HTTPS

L'application parle HTTP ; le TLS se termine devant elle (routeur de Cloud Foundry, ingress
Kubernetes, reverse proxy nginx ou Caddy, service managé du cloud). `PUBLIC_URL` donne l'adresse
HTTPS.
