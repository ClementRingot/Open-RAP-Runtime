# Feuille de route

Ce qui est prévu, avec les éléments de conception déjà connus. Les fonctionnalités disponibles sont
dans [FEATURES.md](FEATURES.md), les écarts assumés dans [KNOWN_GAPS.md](../KNOWN_GAPS.md).

## Draft : compléments

- Déterminations et validations pendant l'édition (`Prepare`, `on modify` sur le brouillon),
  messages d'état (`%state_area`), actions de l'application sur un brouillon, `SiblingEntity`.

## Floorplans : compléments

- Analytical List Page : filtres visuels, plusieurs graphiques, `@Aggregation`.
- Overview Page décrite par annotations (`@UI.dataPoint`, `@UI.kpi`) plutôt que par
  `rapt/config.json`.

## Types CDS et table entities : compléments

- Expressions CDS : `CAST` vers un type CDS ou un type énuméré, constantes `Type.#CONST` dans les
  vues.

## Autres pistes

- Value helps : `additionalBinding`, listes déroulantes (`ValueListWithFixedValues`, valeurs fixes
  des domaines).
- Vues standards : textes dans d'autres langues que l'anglais, taux de change d'une source
  configurable.
- Variantes partagées entre utilisateurs, ordre des colonnes.
- Personnalisation du launchpad par l'utilisateur, notifications.
- MCP : transport stdio, ressources (le `$metadata`, la documentation), autorisation OAuth du
  protocole.
- Late numbering (`adjust_numbers`), events RAP (`RAISE ENTITY EVENT`), change documents.
