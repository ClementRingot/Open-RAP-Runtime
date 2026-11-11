# Feuille de route

Ce qui est prévu, avec les éléments de conception déjà connus. Les fonctionnalités disponibles sont
dans [FEATURES.md](FEATURES.md), les écarts assumés dans [KNOWN_GAPS.md](../KNOWN_GAPS.md).

## Draft (`with draft`)

Le plus gros chantier restant : c'est la manière standard d'éditer dans Fiori Elements.

- **BDEF** : `with draft;`, `draft table`, `total etag`, `draft action Edit / Activate optimized /
  Discard / Resume`, `draft determine action Prepare`, `with additional save` combiné.
- **Base** : une table de brouillon par entité (colonnes de l'entité + `%admin` : utilisateur,
  dates, `DraftUUID`), générée comme les tables persistantes.
- **OData** : clé `IsActiveEntity`, propriétés `HasActiveEntity`, `HasDraftEntity`, navigations
  `DraftAdministrativeData`, `SiblingEntity`, actions `draftEdit`, `draftActivate`,
  `draftPrepare`, `draftDiscard` ; annotations `Common.DraftRoot` / `DraftNode`.
- **Runtime RAP** : buffer persistant entre les requêtes (le brouillon), verrou exclusif du maître
  pendant l'édition, déterminations et validations à `Prepare` / `Activate`, messages d'état
  (`%state_area`), compteur d'ETag total.
- **UI** : mode brouillon dans l'Object Page (sauvegarde automatique des champs, « Brouillon
  enregistré »), filtre « État d'édition » dans le List Report.

## Table entities (`define table entity`)

Les CDS table entities (ABAP Cloud récent) réunissent table et entité. abaplint 2.120 les analyse
déjà (`CDSDefineTableEntity`, vérifié). Conception retenue :

- une table interne par table entity (colonnes = éléments, client retiré comme pour les tables) ;
- l'entité devient une view entity sur cette table, mêmes éléments ;
- dans la BDEF, la table entity est sa propre persistance : `persistent table` implicite et
  mapping `corresponding` automatique ;
- `rapt abapgit` écrit son XML (DDLS de type table entity) ; `rapt generate table-entity`.

## Autres floorplans que List Report / Object Page

- **Worklist** : une liste sans barre de filtres, avec onglets par variante (`UI.selectionVariant`
  qualifiés) — réutilise le List Report.
- **Analytical List Page, Overview Page** : demandent l'agrégation (`$apply`, `@Aggregation`) dans
  le runtime OData et des graphiques (`sap.viz` n'existe que dans SAPUI5 : à remplacer par une
  bibliothèque libre).
- **Form entry object page** (création seule).

## Vues standards supplémentaires

`I_Region`, `I_CalendarDate` (calendrier généré), `I_Timezone`, `I_BusinessUserBasic` (relié aux
utilisateurs de l'IdP), `I_ExchangeRate` (taux d'une source configurable) ; textes dans d'autres
langues que l'anglais ([D44](DECISIONS.md)).

## Autres pistes

- Value helps : `additionalBinding`, listes déroulantes (`ValueListWithFixedValues`).
- Variantes partagées entre utilisateurs, ordre des colonnes.
- Personnalisation du launchpad par l'utilisateur, notifications.
- MCP : transport stdio, ressources (le `$metadata`, la documentation), autorisation OAuth du
  protocole.
- Late numbering (`adjust_numbers`), events RAP (`RAISE ENTITY EVENT`), change documents.
