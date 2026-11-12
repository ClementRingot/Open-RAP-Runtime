# RAP Transpiler for VS Code

Check, generate and run a RAP business object with
[rap-transpiler](https://clementringot.github.io/RAP-Transpiler/), without an SAP system. The
extension compiles nothing itself: it calls the `rapt` CLI (`--json`) and shows its results.

## Features

- **Syntax highlighting** of ABAP (`.abap`, grammar of
  [larshp/vscode-abap](https://github.com/larshp/vscode-abap), MIT), of the CDS sources
  (`.asddls`, `.asddlxs`, `.asdcls`, `.srvdsrv`, tables `.astabl`, types `.acds`) and of the
  behavior definitions (`.asbdef`).
- **Problems**: the diagnostics of `rapt check` (BDEF, CDS, behavior pool…) on each save,
  underlined in the code.
- **RAP Objects** view: the objects of the project grouped as in the project explorer of ADT
  (dictionary, data definitions, behavior definitions, services…).
- **RAP: New RAP object (wizard)…**: the object types of `rapt generate` by category, as in the
  *New ABAP Repository Object* wizard of ADT, with the objects of the project to derive from.
- **RAP: Choose the floorplan of the application**: List Report, Worklist, Analytical List Page
  or Form Entry, with what each one is for.
- **RAP: Start rapt dev**: the application runs with a PGlite database and is rebuilt on each
  save. The status bar shows the state (building, ready, errors) and opens the application in one
  click.
- **RAP: Build the application**: `rapt build` into the folder of your choice.
- **RAP: New business object**: `rapt new` asks for the name of the entity, the prefix and the
  description, writes a complete managed BO (table as a `.tabl.astabl` source, CDS, BDEF,
  behavior pool, service, initial data `rapt/seed.json`) with its abapGit files, then offers to
  start `rapt dev`.
- **RAP: Generate the abapGit files**: `rapt abapgit` writes the missing XML files (including
  those of the tables written as source) to import the repository into an SAP system with
  abapGit.
- Every other command of the CLI: project mode (standard / enhanced), MCP server, intermediate
  representation, launchpad.
- Context menus of the explorer (project folder, `.abapgit.xml`) and buttons in the title bar of
  the RAP sources.

A project is an abapGit folder: the folder that contains `.abapgit.xml` (otherwise, the parent of
a `src` folder).

## Installation

Nothing else to install: the `.vsix` contains rapt (compiler and runtime), OpenUI5 and PGlite,
and rapt runs on the Node.js of VS Code (1.101 or later, Node.js 22).

```sh
code --install-extension rap-transpiler-vscode.vsix
```

The `.vsix` is downloaded from the [project website](https://clementringot.github.io/RAP-Transpiler/),
attached to each GitHub release (tag `v*`) and produced by the CI on each commit (artifact
`rap-transpiler-vscode`).

To use another version of rapt (a clone under development, for example): setting
`rapt.cliPath`. Without a bundled version (extension built without `pnpm run stage`), the
extension takes a rap-transpiler clone or the `node_modules` of a folder of the workspace, then
the `rapt` command of the PATH.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `rapt.cliPath` | empty | `cli.js` of rapt or folder of a clone (empty: bundled rapt) |
| `rapt.nodePath` | empty | Node.js 22+ that runs rapt (empty: the one of VS Code) |
| `rapt.checkOnSave` | `true` | check on each save |
| `rapt.dev.port` | `8080` | port of the application |
| `rapt.dev.openUi` | `true` | open the browser when rapt dev starts |
| `rapt.new.prefix` | `Z` | prefix proposed for a new business object |

## Publishing a version

Push a `v1.2.3` tag: the `release.yml` workflow builds the `.vsix` (version 1.2.3) and attaches
it to the GitHub release of the tag. It also publishes it on the Visual Studio Marketplace when
the `VSCE_PAT` secret is set (publisher `clementringot` to create on the Marketplace), and on
Open VSX (VSCodium, Cursor…) when the `OVSX_PAT` secret is set.

```sh
git tag v0.1.0 && git push origin v0.1.0
```

## Building the extension

```sh
pnpm install && pnpm build
cd packages/vscode && pnpm run package    # rap-transpiler-vscode.vsix (~31 MB)
```

`pnpm run package` compiles the extension (esbuild), prepares `rapt/`
(`scripts/stage-rapt.mjs`: packages of the repository and dependencies installed from the npm
registry, useless files removed), then calls `vsce package`.
