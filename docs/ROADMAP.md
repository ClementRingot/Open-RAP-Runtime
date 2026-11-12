# Roadmap

What is planned, with the design elements already known. The available features are in
[FEATURES.md](FEATURES.md), the accepted gaps in [KNOWN_GAPS.md](../KNOWN_GAPS.md).

## Draft: additions

- Determinations and validations during editing (`Prepare`, `on modify` on the draft), state
  messages (`%state_area`), actions of the application on a draft, `SiblingEntity`.
- Real-time collaborative draft (WebSocket), field locks.

## Floorplans: additions

- Analytical List Page: visual filters, several charts, `@Aggregation`.
- Overview Page described by annotations (`@UI.dataPoint`, `@UI.kpi`) rather than by
  `rapt/config.json`.

## CDS types and table entities: additions

- CDS expressions: `CAST` to a CDS type or an enumerated type, `Type.#CONST` constants in the
  views.
- CDS expressions (continuation of D67): to-one association paths (`_Agency.Name`, left join in
  the view), `BETWEEN`, `$session.user` and `$session.system_language` (PostgreSQL session
  parameters set per request).

## Other leads

- Value helps: fixed values of the domains, several qualified value helps per element.
- Standard views: texts in languages other than English, exchange rates from a configurable
  source.
- Variants shared between users, order of the columns.
- Personalization of the launchpad by the user, notifications.
- MCP: stdio transport, resources (the `$metadata`, the documentation), OAuth authorization of
  the protocol.
- Late numbering (`adjust_numbers`), RAP events (`RAISE ENTITY EVENT`), change documents.
