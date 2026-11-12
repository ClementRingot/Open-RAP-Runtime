# @rap-transpiler/compiler

The compiler of [rap-transpiler](https://clementringot.github.io/RAP-Transpiler/): CDS, BDEF,
SRVD and DCL parsers, intermediate representation, generators (SQL, OData V4 `$metadata`,
transpiled ABAP, OpenUI5 UI) and the command line.

For the complete `rapt` command (with the runtime, OpenUI5 and PGlite that `rapt dev` and
`rapt build` use), install the [`rap-transpiler`](https://www.npmjs.com/package/rap-transpiler)
package instead:

```sh
npm install -g rap-transpiler
```

As a library:

```js
import { buildModel, loadProject } from "@rap-transpiler/compiler";
const { model, diagnostics } = buildModel(loadProject("my-project"));
```

MIT license.
