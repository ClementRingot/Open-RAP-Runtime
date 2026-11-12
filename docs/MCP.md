# MCP server: the service for AI agents

The Model Context Protocol (MCP) lets an AI agent (Claude, an IDE assistant, an in-house agent…)
call "tools". Open RAP Runtime turns the OData service of a RAP BO into an MCP server: each
operation becomes a tool, run by the service itself, with the authorizations, the access
controls, the validations and the messages of the BO ([D47](DECISIONS.md)).

## 1. Describing the tools: `rapt mcp`

```sh
rapt mcp my-project          # or, in VS Code: "RAP: Generate the MCP server of the service"
```

The command writes `rapt/mcp.json`, to version with the sources:

```json
{
  "server": {
    "name": "zrt_ui_travel",
    "instructions": "Travel agency. Read with _list and _get before changing; the BO checks each change."
  },
  "tools": {
    "Travel_list": "Lists the travels. Filter by AgencyID, OverallStatus (O open, A accepted, X rejected)…",
    "Travel_acceptTravel": "Accepts a travel: its status becomes A. Refused when the travel is already accepted.",
    "Booking_delete": false
  }
}
```

- One **description** per tool: what it does, when to use it, the meaning of the codes. It is
  what the agent reads to choose the tool; a good description is better than a long prompt.
- `false` removes the tool (a deletion the agent must not do, for example).
- `server.instructions`: the general context given to the agent on connection.
- Run `rapt mcp` again after a change of the service: the written descriptions are kept, the new
  tools are added with a default description, those that no longer exist are removed.

## 2. The tools

| Tool | OData request | Arguments |
|---|---|---|
| `<Set>_list` | `GET <Set>` | `filter` (OData `$filter`), `search`, `select`, `orderby`, `top` (50 by default, 1000 at most), `skip` |
| `<Set>_get` | `GET <Set>(key)` | the keys |
| `<Set>_create` | `POST <Set>` | the editable fields (mandatory ones: `required` of the schema) |
| `<Set>_update` | `PATCH <Set>(key)` | the keys and the fields to change |
| `<Set>_delete` | `DELETE <Set>(key)` | the keys |
| `<Set>_create<_Composition>` | `POST <Set>(key)/<_Composition>` | the keys of the parent and the fields of the child |
| `<Set>_<action>` | `POST <Set>(key)/<namespace>.<action>` | the keys (except for a static action) and the parameters |
| `<Set>_<function>` | `GET …/<namespace>.<function>(…)` | same |

The input schemas (JSON Schema) come from the OData types: `format: uuid`, `date`, `date-time`,
maximum lengths, strings of digits. The read tools are marked `readOnlyHint`, the deletions
`destructiveHint`.

The result is the JSON of the service without its OData control information; an error of the BO
(validation, authorization, lock) comes back as text with its messages and `isError: true`, so
that the agent can correct its request.

## 3. Running and connecting

The application built with `rapt/mcp.json` serves the tools on `/mcp` ("Streamable HTTP"
transport of the protocol, JSON responses). With `rapt dev`, the *MCP server* tile of the
development launchpad points to it.

```sh
rapt dev my-project                                          # http://localhost:8080/mcp
claude mcp add --transport http travel http://localhost:8080/mcp   # Claude Code
```

For a client configured by a file (for example `.mcp.json`):

```json
{ "mcpServers": { "travel": { "type": "http", "url": "http://localhost:8080/mcp" } } }
```

## 4. Security

- In development (`AUTH_MODE=none`), the agent acts as the development user (`DEV_USER`,
  `DEV_ROLES`).
- In production (`AUTH_MODE=oidc`), each MCP request carries a token of the IdP
  (`Authorization: Bearer …`): the agent only has the authorizations of that user. The session
  cookie of the browser is never accepted on `/mcp`.
- `MCP=off` disables the MCP server of an application built with `rapt/mcp.json`.

Limits: [KNOWN_GAPS.md](../KNOWN_GAPS.md#mcp-d47).
