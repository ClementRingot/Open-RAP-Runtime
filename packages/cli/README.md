# rap-transpiler

`rapt`, la ligne de commande de [rap-transpiler](https://github.com/ClementRingot/RAP-Transpiler) :
compile les sources d'un business object SAP RAP (format abapGit : CDS, BDEF, behavior pool ABAP,
service) en application Node.js autonome — service OData V4, runtime RAP managed, PostgreSQL,
interface OpenUI5. Sans système SAP.

Ce paquet installe le compilateur, le runtime et ce que `rapt dev` sert (OpenUI5, PGlite,
less-openui5) : rien d'autre à installer. Node.js 22 ou plus.

```sh
npm install -g rap-transpiler
rapt new mon-projet Travel --prefix ZRT    # un BO managed complet, avec des données
rapt dev mon-projet                         # http://localhost:8080/ — rechargé à chaque enregistrement
rapt check mon-projet                       # diagnostics fichier:ligne:colonne
rapt build mon-projet --out out/travel      # l'application déployable (Docker, Cloud Foundry…)
```

Sans installation : `npx rap-transpiler check mon-projet`.

Documentation : [guide](https://github.com/ClementRingot/RAP-Transpiler/blob/main/docs/GUIDE.md),
[référence de la CLI](https://github.com/ClementRingot/RAP-Transpiler/blob/main/docs/GUIDE.md#11-référence-de-la-cli).
Licence MIT ; OpenUI5 sous licence Apache-2.0.
