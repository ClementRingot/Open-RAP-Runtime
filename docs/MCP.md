# Serveur MCP : le service pour les agents IA

Le Model Context Protocol (MCP) permet à un agent IA (Claude, un assistant d'IDE, un agent
maison…) d'appeler des « outils ». rap-transpiler transforme le service OData d'un BO RAP en
serveur MCP : chaque opération devient un outil, exécuté par le service lui-même, avec les
autorisations, les contrôles d'accès, les validations et les messages du BO ([D47](DECISIONS.md)).

## 1. Décrire les outils : `rapt mcp`

```sh
rapt mcp mon-projet          # ou, dans VS Code : « RAP : Générer le serveur MCP du service »
```

La commande écrit `rapt/mcp.json`, à versionner avec les sources :

```json
{
  "server": {
    "name": "zrt_ui_travel",
    "instructions": "Agence de voyages. Lire avec _list et _get avant de modifier ; le BO contrôle chaque modification."
  },
  "tools": {
    "Travel_list": "Liste les voyages. Filtrer par AgencyID, OverallStatus (O ouvert, A accepté, X refusé)…",
    "Travel_acceptTravel": "Accepte un voyage : son statut passe à A. Refusé si le voyage est déjà accepté.",
    "Booking_delete": false
  }
}
```

- Une **description** par outil : ce qu'il fait, quand s'en servir, la signification des codes.
  C'est ce que l'agent lit pour choisir l'outil ; une bonne description vaut mieux qu'un long
  prompt.
- `false` retire l'outil (une suppression que l'agent ne doit pas faire, par exemple).
- `server.instructions` : le contexte général donné à l'agent à la connexion.
- Relancer `rapt mcp` après une modification du service : les descriptions écrites sont gardées,
  les nouveaux outils ajoutés avec une description par défaut, ceux qui n'existent plus retirés.

## 2. Les outils

| Outil | Requête OData | Arguments |
|---|---|---|
| `<Set>_list` | `GET <Set>` | `filter` (`$filter` OData), `search`, `select`, `orderby`, `top` (50 par défaut, 1000 au plus), `skip` |
| `<Set>_get` | `GET <Set>(clé)` | les clés |
| `<Set>_create` | `POST <Set>` | les champs modifiables (obligatoires : `required` du schéma) |
| `<Set>_update` | `PATCH <Set>(clé)` | les clés et les champs à changer |
| `<Set>_delete` | `DELETE <Set>(clé)` | les clés |
| `<Set>_create<_Composition>` | `POST <Set>(clé)/<_Composition>` | les clés du parent et les champs de l'enfant |
| `<Set>_<action>` | `POST <Set>(clé)/<espace>.<action>` | les clés (sauf action statique) et les paramètres |
| `<Set>_<fonction>` | `GET …/<espace>.<fonction>(…)` | idem |

Les schémas d'entrée (JSON Schema) viennent des types OData : `format: uuid`, `date`,
`date-time`, longueurs maximales, suites de chiffres. Les outils de lecture sont marqués
`readOnlyHint`, les suppressions `destructiveHint`.

Le résultat est le JSON du service sans ses informations de contrôle OData ; une erreur du BO
(validation, autorisation, verrou) revient en texte avec ses messages et `isError: true`, pour que
l'agent puisse corriger sa demande.

## 3. Lancer et connecter

L'application construite avec `rapt/mcp.json` sert les outils sur `/mcp` (transport HTTP
« Streamable HTTP » du protocole, réponses JSON). Avec `rapt dev`, la tuile *MCP server* du
launchpad de développement le rappelle.

```sh
rapt dev mon-projet                                          # http://localhost:8080/mcp
claude mcp add --transport http travel http://localhost:8080/mcp   # Claude Code
```

Pour un client qui se configure par fichier (par exemple `.mcp.json`) :

```json
{ "mcpServers": { "travel": { "type": "http", "url": "http://localhost:8080/mcp" } } }
```

## 4. Sécurité

- En développement (`AUTH_MODE=none`), l'agent agit comme l'utilisateur de développement
  (`DEV_USER`, `DEV_ROLES`).
- En production (`AUTH_MODE=oidc`), chaque requête MCP porte un jeton de l'IdP
  (`Authorization: Bearer …`) : l'agent n'a que les autorisations de cet utilisateur. Le cookie de
  session du navigateur n'est jamais accepté sur `/mcp`.
- `MCP=off` désactive le serveur MCP d'une application construite avec `rapt/mcp.json`.

Limites : [KNOWN_GAPS.md](../KNOWN_GAPS.md#mcp-d47).
