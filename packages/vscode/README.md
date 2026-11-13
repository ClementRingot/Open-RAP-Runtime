# Open RAP Runtime for VS Code

Check, generate and run a RAP business object with
[Open RAP Runtime](https://clementringot.github.io/Open-Rap-Runtime/), without an SAP system. The
extension compiles nothing itself: it calls the `rapt` CLI (`--json`) and shows its results.
Source code, issues and releases: [GitHub](https://github.com/ClementRingot/Open-RAP-Runtime).

## Features

- **Syntax highlighting** of ABAP (`.abap`, grammar of
  [larshp/vscode-abap](https://github.com/larshp/vscode-abap), MIT), of the CDS sources
  (`.asddls`, `.asddlxs`, `.asdcls`, `.srvdsrv`, tables `.astabl`, types `.acds`) and of the
  behavior definitions (`.asbdef`).
- **Problems**: the diagnostics of `rapt check` (BDEF, CDS, behavior pool…) on each save,
  underlined in the code.
- **RAP Objects** view: the objects of the project grouped as in the project explorer of ADT
  (dictionary, data definitions, behavior definitions, services…).
- **RAP: New RAP object…**: create object by object (table, view, projection, BDEF, behavior
  pool, service, binding…) with the wizard: the object types of `rapt generate` by category, as
  in the *New ABAP Repository Object* wizard of ADT, with the objects of the project to derive
  from.
- **RAP: Choose the floorplan of the application**: List Report, Worklist, Analytical List Page
  or Form Entry, with what each one is for.
- **RAP: Start rapt dev**: the application runs with a PGlite database and is rebuilt on each
  save. The status bar shows the state (building, ready, errors) and opens the application in one
  click.
- **RAP: Start the launchpad (rapt dev, all the applications)**: `rapt launchpad dev`, every
  application of `launchpad.json` in development on the port of its URL (8081, 8082…), behind the
  launchpad on `http://localhost:8090/`; each save rebuilds its application. Also in the context
  menu and the title bar of `launchpad.json`. One session at a time: starting the launchpad
  stops *rapt dev* of an application, and the other way round.
- **RAP: Build the application…**: either the **launchpad of the workspace** with every
  application of the workspace (`rapt launchpad`: each project with a service definition joins
  the same launchpad) or the **application alone** (`rapt build`, standalone), into the folder of
  your choice. The floorplan of each root entity (List Report, Worklist, Analytical List Page,
  Form Entry) is asked first when it was not chosen yet, application by application, with the
  name of the application in the prompt; *RAP: Start rapt dev* asks for it too. The missing
  abapGit files of each application (`.abapgit.xml`, the XML of the objects) are written before
  the build, the existing ones are kept.
- **One launchpad per workspace**: `launchpad.json` (titled "Launchpad"), next to the
  `.code-workspace` or in the first folder of the workspace, is created with the first
  application; each complete BO and each choice of floorplan add the application and its tile,
  without touching what is already there. **RAP: Build the launchpad (all the applications)…**
  builds it with its applications (active when it exists).
- **RAP: New complete business object…**: `rapt new` asks for the name of the entity, the prefix
  and the description, writes a complete managed BO (table as a `.tabl.astabl` source, CDS,
  BDEF, behavior pool, service, initial data `rapt/seed.json`) with its abapGit files, then
  offers to start `rapt dev`. Possible in an empty folder.
- **RAP: Generate the abapGit files**: `rapt abapgit` writes the missing XML files (including
  those of the tables written as source) to import the repository into an SAP system with
  abapGit.
- Every other command of the CLI: project mode (standard / enhanced), MCP server, intermediate
  representation, launchpad.
- **`rapt` in the terminal**: the integrated terminals have the `rapt` command of the extension
  (`rapt check .`, `rapt dev .`…), for you and for the AI agents that run commands.
- **AI agents**: the agent mode of VS Code finds the MCP server of rapt (`rapt agent`): check the
  project, create objects, set the floorplan, search the documentation of Open RAP Runtime. For
  Claude Code in the terminal: `claude mcp add rapt -- rapt agent .`.
- **RAP: Report a bug or request a feature…**: the feedback form of the website, with the
  version of the extension and the environment filled in; it opens a pre-filled issue in the
  issues of the repository.
- Context menus of the explorer (project folder, `.abapgit.xml`) in three groups (create,
  project, application), buttons in the title bar of the RAP sources. The commands that are not
  possible yet are greyed out: outside a project, only *New complete business object…* is
  active; *Floorplan*, *rapt dev* and *Build the application* wait for a service definition;
  the launchpad commands wait for an application or a `launchpad.json`; *Open the application*
  waits until the session serves, *Stop rapt dev* until one runs.

A project is an abapGit folder: the folder that contains `.abapgit.xml` (otherwise, the parent of
a `src` folder).

## Installation

Nothing else to install: the `.vsix` contains rapt (compiler and runtime), OpenUI5 and PGlite,
and rapt runs on the Node.js of VS Code (1.101 or later, Node.js 22).

```sh
code --install-extension open-rap-runtime-vscode.vsix
```

The `.vsix` is downloaded from the [project website](https://clementringot.github.io/Open-Rap-Runtime/),
attached to each GitHub release (tag `v*`) and produced by the CI on each commit (artifact
`open-rap-runtime-vscode`).

To use another version of rapt (a clone under development, for example): setting
`rapt.cliPath`. Without a bundled version (extension built without `pnpm run stage`), the
extension takes an Open RAP Runtime clone or the `node_modules` of a folder of the workspace, then
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
| `rapt.terminal.addToPath` | `true` | `rapt` on the PATH of the integrated terminals |
| `rapt.agent.enabled` | `true` | MCP server of rapt for the agent mode of VS Code |
