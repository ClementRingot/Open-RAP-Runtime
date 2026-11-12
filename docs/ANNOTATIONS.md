# Annotations CDS prises en charge

Ce que rap-transpiler fait de chaque annotation : ✅ `$metadata` et UI générée, 🟡 partiel (voir la
note), 📄 `$metadata` seulement (Fiori Elements l'interprète, l'UI OpenUI5 générée non), ❌ ignorée.
Une annotation ignorée ne provoque pas d'erreur : la source reste activable sur SAP.

Décisions : [D10](DECISIONS.md) (UI), [D44](DECISIONS.md), [D56](DECISIONS.md) (value helps),
[D53](DECISIONS.md) (floorplans), [D57](DECISIONS.md) (annotations d'affichage).

## En-tête d'entité

| Annotation | Statut | Effet |
|---|---|---|
| `@EndUserText.label` | ✅ | Libellé de l'entité, des éléments (`Common.Label`), des types CDS et éléments de données |
| `@EndUserText.quickInfo` | 📄 | `Common.QuickInfo` |
| `@AccessControl.authorizationCheck` | 🟡 | Informatif : un rôle DCL s'applique s'il existe (D35) |
| `@Metadata.allowExtensions`, `@Metadata.layer`, `@Metadata.ignorePropagatedAnnotations` | ✅ | Fusion des metadata extensions par couche, propagation des annotations |
| `@Search.searchable`, `@Search.defaultSearchElement` | ✅ | `$search`, champ de recherche du List Report |
| `@ObjectModel.semanticKey` | 📄 | `Common.SemanticKey` |
| `@ObjectModel.query.implementedBy` | ✅ | Entité custom (D43) |
| `@ObjectModel.dataCategory: #TEXT` | ✅ | Vue de textes d'un value help |
| `@ObjectModel.resultSet.sizeCategory: #XS` | ✅ | Value help en liste déroulante (D56) |
| `@ObjectModel.usageType`, `@ObjectModel.modelingPattern`, `@ObjectModel.supportedCapabilities` | ❌ | Classification, sans effet à l'exécution |
| `@ClientHandling.type`, `@AbapCatalog.*` | ❌ | Pas de mandant (D9) ni de catalogue |
| `@UI.headerInfo` (`typeName`, `typeNamePlural`, `title`, `description`, `imageUrl`) | ✅ | Titre, sous-titre de l'Object Page, titre de la liste ; `imageUrl` : 📄 |
| `@UI.presentationVariant` (`sortOrder`) | ✅ | Tri par défaut |
| `@UI.presentationVariant` (`groupBy`, `visualizations`, `maxItems`) | ❌ | |
| `@UI.selectionVariant` (qualifiés) | ✅ | Onglets du Worklist (D53) |
| `@UI.chart` | ✅ | Analytical List Page, cartes de l'Overview Page (D53) |
| `@UI.selectionPresentationVariant`, `@UI.kpi` | ❌ | |

## Éléments

| Annotation | Statut | Effet |
|---|---|---|
| `@UI.lineItem` : `position`, `label`, `importance`, `hidden` | ✅ | Colonnes du List Report et des tables |
| `@UI.lineItem` : `type: #FOR_ACTION` (`dataAction`, `invocationGrouping`) | ✅ | Boutons de la table |
| `@UI.lineItem` : `type: #WITH_URL` (`url`) | ✅ | Lien (D57) |
| `@UI.lineItem` : `type: #AS_DATAPOINT` | 🟡 | `UI.DataFieldForAnnotation` ; l'UI affiche la valeur avec sa criticité |
| `@UI.lineItem` : `criticality` | ✅ | Couleur de la valeur (D57) |
| `@UI.lineItem` : `#WITH_INTENT_BASED_NAVIGATION`, `#FOR_INTENT_BASED_NAVIGATION`, `#WITH_NAVIGATION_PATH`, `criticalityRepresentation` | ❌ | |
| `@UI.identification` (champs, `criticality`, actions) | ✅ | Formulaire et actions d'en-tête de l'Object Page |
| `@UI.fieldGroup` (qualifiés) | ✅ | Sections de formulaire, en-tête (D57) |
| `@UI.facet` : `#COLLECTION`, `#IDENTIFICATION_REFERENCE`, `#FIELDGROUP_REFERENCE`, `#LINEITEM_REFERENCE` (`targetElement`) | ✅ | Sections, sous-sections, tables des compositions |
| `@UI.facet` purpose `#HEADER` : `#DATAPOINT_REFERENCE`, `#FIELDGROUP_REFERENCE`, `#IDENTIFICATION_REFERENCE` | ✅ | En-tête de l'Object Page (D57) |
| `@UI.facet` : `#PRESENTATIONVARIANT_REFERENCE`, `#CHART_REFERENCE`, `#ADDRESS_REFERENCE`, `#CONTACT_REFERENCE`, purpose `#QUICK_VIEW` | ❌ | |
| `@UI.dataPoint` (`title`, `description`, `targetValue`, `criticality`, `visualization: #PROGRESS / #RATING`) | ✅ | `UI.DataPoint`, barre de progression, notation, nombre (D57) |
| `@UI.selectionField` | ✅ | Barre de filtres, conditions et dialogue *Search and Select* / *Define Conditions* (D51, D65) |
| `@UI.hidden` | ✅ | `UI.Hidden`, absent de l'UI |
| `@UI.multiLineText` | ✅ | `UI.MultiLineText`, zone de texte (D57) |
| `@UI.textArrangement` + `@ObjectModel.text.element` | ✅ | `Common.Text`, « Texte (ID) », « ID (Texte) », texte seul (D57) |
| `@UI.masked`, `@UI.placeholder`, `@UI.inputMask` | ❌ | |
| `@Consumption.valueHelpDefinition` (`entity`, `additionalBinding`, `useForValidation`) | ✅ | `Common.ValueList`, dialogue ou liste déroulante (D44, D56) ; onglet *Search and Select* du dialogue des filtres (D65) |
| `@Consumption.valueHelpDefinition` (`qualifier`, `distinctValues`, `presentationVariantQualifier`) | ❌ | Un value help par élément |
| `@Consumption.filter.defaultValue` | ✅ | `Common.FilterDefaultValue`, filtre initial du List Report (D57) |
| `@Consumption.filter.mandatory` | ✅ | `Capabilities.FilterRestrictions/RequiredProperties`, filtre obligatoire (D57) |
| `@Consumption.filter.selectionType`, `multipleSelections` | ✅ | `FilterExpressionRestrictions` ; opérateurs du dialogue des filtres : `#SINGLE` égal, `#INTERVAL` comparaisons et intervalles, une condition si `multipleSelections: false` (D57, D65) |
| `@Consumption.hidden` | ✅ | Élément non exposé (sauf clé ou élément d'une association) (D57) |
| `@Semantics.amount.currencyCode`, `@Semantics.quantity.unitOfMeasure` | ✅ | `Measures.ISOCurrency` / `Measures.Unit`, montant et devise |
| `@Semantics.currencyCode`, `@Semantics.unitOfMeasure` | 📄 | `Common.IsCurrency`, `Common.IsUnit` (déduits du type) |
| `@Semantics.user.*`, `@Semantics.systemDateTime.*` | ✅ | Champs administratifs remplis par le runtime managed |
| `@Semantics.email.address`, `@Semantics.telephone.type` | ✅ | `Communication.IsEmailAddress` / `IsPhoneNumber`, liens `mailto:` / `tel:` (D57) |
| `@Semantics.text`, `@Semantics.language` | ✅ | Vues de textes des value helps |
| `@Semantics.largeObject`, `@Semantics.mimeType` | ❌ | Pas de `Edm.Stream` (pièces jointes) |
| `@ObjectModel.virtualElement`, `@ObjectModel.virtualElementCalculatedBy` | ❌ | Pas d'éléments virtuels |
| `@ObjectModel.foreignKey.association` | ❌ | |
| `@Aggregation.default` | ✅ | Agrégation des mesures des graphiques (D53) |
| `@EndUserText.heading` | ❌ | |

## Hors CDS

Les annotations dérivées de la BDEF sont toujours produites : `Core.Computed`, `Core.Immutable`,
`Common.FieldControl` (statique et d'instance), `Core.OperationAvailable`,
`Capabilities.InsertRestrictions` / `UpdateRestrictions` / `DeleteRestrictions` (feature control
et autorisations), `Common.SideEffects`, `Common.DraftRoot` / `DraftNode`, `Core.OptimisticConcurrency`.
