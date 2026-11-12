# @rap-transpiler/runtime

Le runtime générique des applications produites par [rap-transpiler](https://github.com/ClementRingot/RAP-Transpiler) :
serveur Fastify, OData V4 (`$batch`, draft, ETags), runtime RAP managed, exécution du behavior
pool transpilé, authentification OIDC, launchpad et serveur MCP.

Une application générée par `rapt build` l'embarque dans `vendor/` ; `rapt dev` l'utilise
directement. Installé avec la ligne de commande :

```sh
npm install -g rap-transpiler
```

Licence MIT.
