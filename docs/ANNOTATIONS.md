# Supported CDS annotations

What rap-transpiler does with each annotation: ✅ `$metadata` and generated UI, 🟡 partial (see
the note), 📄 `$metadata` only (Fiori Elements interprets it, the generated OpenUI5 UI does not),
❌ ignored. An ignored annotation does not cause an error: the source stays activatable on SAP.

Decisions: [D10](DECISIONS.md) (UI), [D44](DECISIONS.md), [D56](DECISIONS.md) (value helps),
[D53](DECISIONS.md) (floorplans), [D57](DECISIONS.md) (display annotations).

## Entity header

| Annotation | Status | Effect |
|---|---|---|
| `@EndUserText.label` | ✅ | Label of the entity, of the elements (`Common.Label`), of CDS types and data elements |
| `@EndUserText.quickInfo` | 📄 | `Common.QuickInfo` |
| `@AccessControl.authorizationCheck` | 🟡 | Informative: a DCL role applies if it exists (D35) |
| `@Metadata.allowExtensions`, `@Metadata.layer`, `@Metadata.ignorePropagatedAnnotations` | ✅ | Merge of the metadata extensions by layer, propagation of the annotations |
| `@Search.searchable`, `@Search.defaultSearchElement` | ✅ | `$search`, search field of the List Report |
| `@ObjectModel.semanticKey` | 📄 | `Common.SemanticKey` |
| `@ObjectModel.query.implementedBy` | ✅ | Custom entity (D43) |
| `@ObjectModel.dataCategory: #TEXT` | ✅ | Text view of a value help |
| `@ObjectModel.resultSet.sizeCategory: #XS` | ✅ | Value help as a drop-down list (D56) |
| `@ObjectModel.usageType`, `@ObjectModel.modelingPattern`, `@ObjectModel.supportedCapabilities` | ❌ | Classification, no effect at runtime |
| `@ClientHandling.type`, `@AbapCatalog.*` | ❌ | No client (D9) nor catalog |
| `@UI.headerInfo` (`typeName`, `typeNamePlural`, `title`, `description`, `imageUrl`) | ✅ | Title, subtitle of the Object Page, title of the list; `imageUrl`: 📄 |
| `@UI.presentationVariant` (`sortOrder`) | ✅ | Default sorting |
| `@UI.presentationVariant` (`groupBy`, `visualizations`, `maxItems`) | ❌ | |
| `@UI.selectionVariant` (qualified) | ✅ | Tabs of the Worklist (D53) |
| `@UI.chart` | ✅ | Analytical List Page, cards of the Overview Page (D53) |
| `@UI.selectionPresentationVariant`, `@UI.kpi` | ❌ | |

## Elements

| Annotation | Status | Effect |
|---|---|---|
| `@UI.lineItem`: `position`, `label`, `importance`, `hidden` | ✅ | Columns of the List Report and of the tables |
| `@UI.lineItem`: `type: #FOR_ACTION` (`dataAction`, `invocationGrouping`) | ✅ | Buttons of the table |
| `@UI.lineItem`: `type: #WITH_URL` (`url`) | ✅ | Link (D57) |
| `@UI.lineItem`: `type: #AS_DATAPOINT` | 🟡 | `UI.DataFieldForAnnotation`; the UI shows the value with its criticality |
| `@UI.lineItem`: `criticality` | ✅ | Color of the value (D57) |
| `@UI.lineItem`: `#WITH_INTENT_BASED_NAVIGATION`, `#FOR_INTENT_BASED_NAVIGATION`, `#WITH_NAVIGATION_PATH`, `criticalityRepresentation` | ❌ | |
| `@UI.identification` (fields, `criticality`, actions) | ✅ | Form and header actions of the Object Page |
| `@UI.fieldGroup` (qualified) | ✅ | Form sections, header (D57) |
| `@UI.facet`: `#COLLECTION`, `#IDENTIFICATION_REFERENCE`, `#FIELDGROUP_REFERENCE`, `#LINEITEM_REFERENCE` (`targetElement`) | ✅ | Sections, subsections, tables of the compositions |
| `@UI.facet` purpose `#HEADER`: `#DATAPOINT_REFERENCE`, `#FIELDGROUP_REFERENCE`, `#IDENTIFICATION_REFERENCE` | ✅ | Header of the Object Page (D57) |
| `@UI.facet`: `#PRESENTATIONVARIANT_REFERENCE`, `#CHART_REFERENCE`, `#ADDRESS_REFERENCE`, `#CONTACT_REFERENCE`, purpose `#QUICK_VIEW` | ❌ | |
| `@UI.dataPoint` (`title`, `description`, `targetValue`, `criticality`, `visualization: #PROGRESS / #RATING`) | ✅ | `UI.DataPoint`, progress bar, rating, number (D57) |
| `@UI.selectionField` | ✅ | Filter bar |
| `@UI.hidden` | ✅ | `UI.Hidden`, absent from the UI |
| `@UI.multiLineText` | ✅ | `UI.MultiLineText`, text area (D57) |
| `@UI.textArrangement` + `@ObjectModel.text.element` | ✅ | `Common.Text`, "Text (ID)", "ID (Text)", text only (D57) |
| `@UI.masked`, `@UI.placeholder`, `@UI.inputMask` | ❌ | |
| `@Consumption.valueHelpDefinition` (`entity`, `additionalBinding`, `useForValidation`) | ✅ | `Common.ValueList`, dialog or drop-down list (D44, D56) |
| `@Consumption.valueHelpDefinition` (`qualifier`, `distinctValues`, `presentationVariantQualifier`) | ❌ | One value help per element |
| `@Consumption.filter.defaultValue` | ✅ | `Common.FilterDefaultValue`, initial filter of the List Report (D57) |
| `@Consumption.filter.mandatory` | ✅ | `Capabilities.FilterRestrictions/RequiredProperties`, mandatory filter (D57) |
| `@Consumption.filter.selectionType`, `multipleSelections` | 🟡 | `FilterExpressionRestrictions`; the UI limits to one value (`#SINGLE`, `multipleSelections: false`) |
| `@Consumption.hidden` | ✅ | Element not exposed (except a key or an element of an association) (D57) |
| `@Semantics.amount.currencyCode`, `@Semantics.quantity.unitOfMeasure` | ✅ | `Measures.ISOCurrency` / `Measures.Unit`, amount and currency |
| `@Semantics.currencyCode`, `@Semantics.unitOfMeasure` | 📄 | `Common.IsCurrency`, `Common.IsUnit` (derived from the type) |
| `@Semantics.user.*`, `@Semantics.systemDateTime.*` | ✅ | Administrative fields filled by the managed runtime |
| `@Semantics.email.address`, `@Semantics.telephone.type` | ✅ | `Communication.IsEmailAddress` / `IsPhoneNumber`, `mailto:` / `tel:` links (D57) |
| `@Semantics.text`, `@Semantics.language` | ✅ | Text views of the value helps |
| `@Semantics.largeObject`, `@Semantics.mimeType` | ❌ | No `Edm.Stream` (attachments) |
| `@ObjectModel.virtualElement`, `@ObjectModel.virtualElementCalculatedBy` | ❌ | No virtual elements |
| `@ObjectModel.foreignKey.association` | ❌ | |
| `@Aggregation.default` | ✅ | Aggregation of the measures of the charts (D53) |
| `@EndUserText.heading` | ❌ | |

## Outside CDS

The annotations derived from the BDEF are always produced: `Core.Computed`, `Core.Immutable`,
`Common.FieldControl` (static and instance), `Core.OperationAvailable`,
`Capabilities.InsertRestrictions` / `UpdateRestrictions` / `DeleteRestrictions` (feature control
and authorizations), `Common.SideEffects`, `Common.DraftRoot` / `DraftNode`,
`Core.OptimisticConcurrency`.
