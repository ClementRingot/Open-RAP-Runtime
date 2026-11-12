# @rap-transpiler/compiler

Le compilateur de [rap-transpiler](https://github.com/ClementRingot/RAP-Transpiler) : parsers
CDS, BDEF, SRVD et DCL, représentation intermédiaire, générateurs (SQL, `$metadata` OData V4,
ABAP transpilé, UI OpenUI5) et la commande `rapt`.

Pour la ligne de commande complète (avec le runtime, OpenUI5 et PGlite qu'utilisent `rapt dev` et
`rapt build`), installer plutôt le paquet [`rap-transpiler`](https://www.npmjs.com/package/rap-transpiler) :

```sh
npm install -g rap-transpiler
```

Ce paquet seul suffit à `rapt check`, `rapt ir`, `rapt new`, `rapt generate`, `rapt abapgit`, ou
à un usage en bibliothèque :

```js
import { buildModel, loadProject } from "@rap-transpiler/compiler";
const { model, diagnostics } = buildModel(loadProject("mon-projet"));
```

Licence MIT.
