# rap-transpiler

**Develop, test and deploy your SAP RAP business objects without an SAP system.**

`rapt` compiles the sources of a RAP business object in abapGit format — tables, CDS views,
metadata extensions, behavior definitions, ABAP behavior pools, service definition and binding —
into a standalone Node.js application: an OData V4 service, the RAP managed runtime running your
ABAP code, PostgreSQL and an OpenUI5 (Fiori-like) UI. The same sources are imported into SAP with
abapGit.

```sh
npm install -g rap-transpiler        # or: npx rap-transpiler <command>
rapt new my-project Travel --prefix ZRT
rapt dev my-project                  # http://localhost:8080/, rebuilt on every save
rapt check my-project                # diagnostics file:line:column (--json for tools)
rapt build my-project --out dist     # the deployable application
rapt agent .                         # MCP server (stdio) of rapt for AI coding agents
```

Node.js 22 or later. The package contains everything `rapt dev` needs (OpenUI5, an embedded
PostgreSQL); no SAP library, only permissive open source licenses.

For AI agents (Claude Code, Cursor…): `claude mcp add rapt -- rapt agent .` gives the agent the
tools `rapt_check`, `rapt_generate`, `rapt_new_business_object`, `rapt_floorplan`,
`rapt_abapgit`, `rapt_docs_search` and `rapt_docs_read`. In VS Code, the RAP Transpiler extension
contains rapt and registers this server by itself.

Documentation and VS Code extension: https://clementringot.github.io/RAP-Transpiler/

MIT license. Not affiliated with SAP SE; SAP, ABAP and Fiori are trademarks of SAP SE.
