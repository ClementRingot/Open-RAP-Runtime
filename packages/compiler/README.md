# @open-rap/compiler

The compiler of [Open RAP Runtime](https://clementringot.github.io/Open-Rap-Runtime/): CDS, BDEF,
SRVD and DCL parsers, intermediate representation, generators (SQL, OData V4 `$metadata`,
transpiled ABAP, OpenUI5 UI) and the command line.

For the complete `rapt` command (with the runtime, OpenUI5 and PGlite that `rapt dev` and
`rapt build` use), install the [`open-rap-runtime`](https://www.npmjs.com/package/open-rap-runtime)
package instead:

```sh
npm install -g open-rap-runtime
```

As a library:

```js
import { buildModel, loadProject } from "@open-rap/compiler";
const { model, diagnostics } = buildModel(loadProject("my-project"));
```

MIT license.
