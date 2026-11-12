/**
 * The intermediate representation (IR) produced by the compiler and read by the runtime
 * (`model.json` in a generated application).
 *
 * Names keep the case they are written with in the sources (CDS entity and element names,
 * BDEF aliases). Lookups are case-insensitive: use the helpers of `lookup.ts`.
 */

import type { AbapType } from "./abap-types.js";
import type { Annotations } from "./annotations.js";

export const MODEL_FORMAT_VERSION = 1;

/** Position in a source file, 1-based. */
export interface SourceRef {
  file: string;
  line: number;
  column: number;
}

/**
 * `standard`: as on SAP. `enhanced`: rap-transpiler extensions (D45): managed BO with unmanaged
 * save on a custom entity, mandatory fields checked when saving.
 */
export type ProjectMode = "standard" | "enhanced";

/** Floorplan of the UI of a root entity set (D53). */
export type Floorplan = "listReport" | "worklist" | "analyticalListPage" | "formEntry";

/** A card of the Overview Page (D53). */
export interface OverviewCardModel {
  type: "list" | "table" | "chart" | "kpi";
  entitySet: string;
  title: string;
  subtitle?: string;
  /** OData $filter of the card. */
  filter?: string;
  /** OData $orderby (list, table). */
  orderby?: string;
  /** Rows shown (list, table; default 5). */
  top?: number;
  /** Qualifier of the `@UI.chart` of the entity (chart). */
  chart?: string;
  /** Measure and aggregation (kpi). */
  measure?: string;
  aggregation?: "sum" | "min" | "max" | "average" | "count";
}

/** The UI settings of rapt/config.json (D53). */
export interface UiConfigModel {
  /** Floorplan per root entity set (default: listReport). */
  floorplans?: Record<string, Floorplan>;
  /** An Overview Page as start page. */
  overview?: { title: string; cards: OverviewCardModel[] };
}

/**
 * A CDS enumerated type (D55, `define type X : abap.char(1) enum { … }`): its constants and their
 * values of the base type. Fields of this type carry `type.enumType`.
 */
export interface EnumTypeModel {
  /** Name as written: ZRT_STATUS. */
  name: string;
  base: AbapType;
  values: Array<{ name: string; value: string | number; label?: string; initial?: true }>;
  label?: string;
  src?: SourceRef;
}

export interface Model {
  formatVersion: typeof MODEL_FORMAT_VERSION;
  /** UI settings of rapt/config.json (D53). */
  ui?: UiConfigModel;
  /** Absent: standard (rapt/config.json, D45). */
  mode?: ProjectMode;
  generator: { name: string; version: string };
  service: ServiceModel;
  tables: TableModel[];
  entities: EntityModel[];
  behaviors: BehaviorModel[];
  /** CDS enumerated types of the fields of the entities (D55). */
  enumTypes?: EnumTypeModel[];
  /** Filled by the ABAP generator (behavior pool transpilation). */
  abap?: AbapModel;
  /** Texts of the message classes (MSAG) found in the sources: class → number → text. */
  messageClasses: Record<string, Record<string, string>>;
  /** Authorization objects and roles (D34): `rapt/authorizations.json` next to the sources. */
  authorizations?: AuthorizationsModel;
  /** Access controls (DCL) of the exposed entities (D35). */
  accessControls?: AccessControlModel[];
  /** Intervals of the number ranges (D40): `rapt/number-ranges.json` next to the sources. */
  numberRanges?: NumberRangeIntervalModel[];
  /** Services of the clean-room framework the behavior pools use, with tables of their own (D40). */
  services?: { numberRanges?: boolean; applicationLog?: boolean; background?: boolean; mail?: boolean };
}

// ---------------------------------------------------------------------------------------------
// Authorizations (D34, D35)

/** An authorization object (SUSO): its fields, and the activities it permits (ACTVT). */
export interface AuthorizationObjectModel {
  name: string;
  fields: string[];
  activities?: string[];
  description?: string;
}

/**
 * A value of an authorization field in a role, as in PFCG: a value, a pattern ending with `*`
 * (`*` alone: every value), a range, or the values of a claim of the user's token
 * (`{claim:agency}`).
 */
export type AuthorizationValue = string | { from: string; to: string };

/** One authorization of a role: an instance of an authorization object with its field values. */
export interface RoleAuthorizationModel {
  object: string;
  fields: Record<string, AuthorizationValue[]>;
}

/** A role of the identity provider (a business role) and its authorizations. */
export interface RoleModel {
  name: string;
  description?: string;
  authorizations: RoleAuthorizationModel[];
}

export interface AuthorizationsModel {
  objects: AuthorizationObjectModel[];
  roles: RoleModel[];
}

/** A condition of an access control: a tree of comparisons on the elements of the entity. */
export type AccessCondition =
  | { kind: "and" | "or"; operands: AccessCondition[] }
  | { kind: "not"; operand: AccessCondition }
  | { kind: "compare"; element: string; operator: "=" | "<>" | "<" | "<=" | ">" | ">=" | "like"; value: string }
  | { kind: "null"; element: string; negated: boolean }
  /** `( E1, E2 ) = aspect pfcg_auth( OBJECT, FIELD1, FIELD2, ACTVT = '03' )`; `?=` also grants initial values. */
  | { kind: "pfcg"; elements: string[]; object: string; fields: string[]; filters: Record<string, string>; orInitial: boolean }
  /** `E = aspect user`; `?=` also grants the rows whose element is initial. */
  | { kind: "user"; element: string; orInitial: boolean }
  | { kind: "true" }
  | { kind: "false" };

/** `define role R { grant select on E where …; }`: the rows of E a user may read. */
export interface AccessControlModel {
  role: string;
  entity: string;
  /** One condition per `grant select`; a row is granted when one of them is true. */
  conditions: AccessCondition[];
}

// ---------------------------------------------------------------------------------------------
// Service

export interface ServiceModel {
  /** Service definition name, upper case: ZUI_TRAVEL. */
  name: string;
  /** Service binding name, upper case, when a SRVB is present or given on the command line. */
  binding: string;
  /** Service version, four digits. */
  version: string;
  /** Namespace of the OData schema: com.sap.gateway.srvd.zui_travel.v0001. */
  namespace: string;
  /** Path of the service root, with a trailing slash. */
  path: string;
  /** OData V4 - Web API binding (D60): no UI annotations, value helps, side effects nor feature control in the service; no draft. */
  webApi?: true;
  entitySets: EntitySetModel[];
  annotations: Annotations;
}

export interface EntitySetModel {
  /** Entity set name: the alias of the `expose` statement, or the entity name. */
  name: string;
  /** Exposed CDS entity (usually a projection view). */
  entity: string;
  /**
   * Exposed implicitly as the value help of an element (`@Consumption.valueHelpDefinition`), as
   * RAP does: read-only, without its own pages in the UI.
   */
  valueHelp?: true;
  /** The entity set DraftAdministrativeData of a draft service (D54): read-only, no UI page. */
  draftAdministrativeData?: true;
}

// ---------------------------------------------------------------------------------------------
// Dictionary

export interface TableModel {
  /** Table name, lower case. */
  name: string;
  /** Table of a standard view (I_Currency…, D44): reference data delivered with the application. */
  standard?: true;
  description?: string;
  columns: ColumnModel[];
  src?: SourceRef;
}

export interface ColumnModel {
  /** Column name, lower case. */
  name: string;
  type: AbapType;
  key: boolean;
  notNull: boolean;
  /** Client column (MANDT/CLNT). Dropped from the generated database (decision D9). */
  client: boolean;
  /** Reference table/field of a CURR or QUAN column. */
  reference?: { table: string; field: string };
}

// ---------------------------------------------------------------------------------------------
// CDS entities

export type AdminSemantics =
  | "createdBy"
  | "createdAt"
  | "lastChangedBy"
  | "lastChangedAt"
  | "localInstanceLastChangedAt";

export interface FieldModel {
  /** Element name as written in the CDS view: TravelUUID. */
  name: string;
  type: AbapType;
  key: boolean;
  /** View entities: the column of the source table. */
  column?: string;
  /** Projections: the element of the projected entity. */
  baseField?: string;
  /**
   * A calculated element (D67): the expression of the select list, instead of `column` or
   * `baseField`. Read-only, computed by the SQL view.
   */
  expression?: CdsExpression;
  semantics?: AdminSemantics;
  /** Draft (D54): IsActiveEntity, HasActiveEntity, HasDraftEntity, DraftUUID — no column of the base. */
  draft?: true;
  /** Name of the currency code element (`@Semantics.amount.currencyCode`). */
  currencyCode?: string;
  /** Name of the unit element (`@Semantics.quantity.unitOfMeasure`). */
  unitOfMeasure?: string;
  /** Merged element annotations (view, propagated, metadata extensions). */
  annotations: Annotations;
  src?: SourceRef;
}

/**
 * The expression of a calculated element (D67), resolved and typed: `column` is a column of the
 * source table (lower case) or an element of the source entity, `element` another element of the
 * same entity (`$projection.X`).
 */
export type CdsExpression =
  | { kind: "literal"; value: string | number | null; type: AbapType }
  | { kind: "column"; name: string; type: AbapType }
  | { kind: "element"; name: string; type: AbapType }
  | { kind: "session"; variable: "system_date"; type: AbapType }
  | { kind: "arithmetic"; operator: "+" | "-" | "*" | "/"; left: CdsExpression; right: CdsExpression; type: AbapType }
  | { kind: "negate"; operand: CdsExpression; type: AbapType }
  | { kind: "case"; operand?: CdsExpression; branches: Array<{ when: CdsExpression | CdsCondition; then: CdsExpression }>; else?: CdsExpression; type: AbapType }
  | { kind: "cast"; operand: CdsExpression; type: AbapType }
  | { kind: "function"; name: CdsFunctionName; args: CdsExpression[]; type: AbapType };

export type CdsFunctionName =
  | "concat"
  | "concat_with_space"
  | "substring"
  | "upper"
  | "lower"
  | "length"
  | "left"
  | "right"
  | "ltrim"
  | "rtrim"
  | "replace"
  | "coalesce"
  | "div"
  | "division"
  | "mod"
  | "abs"
  | "round"
  | "ceil"
  | "floor"
  | "dats_days_between"
  | "dats_add_days";

/** A condition of a searched CASE (D67). */
export type CdsCondition =
  | { kind: "compare"; operator: "=" | "<>" | "<" | ">" | "<=" | ">=" | "like"; left: CdsExpression; right: CdsExpression }
  | { kind: "isNull"; operand: CdsExpression; negated: boolean }
  | { kind: "and" | "or"; left: CdsCondition; right: CdsCondition }
  | { kind: "not"; operand: CdsCondition };

export type AssociationKind = "composition" | "toParent" | "association";

export interface AssociationModel {
  /** Association name as written: _Booking. */
  name: string;
  /** Target CDS entity. */
  target: string;
  kind: AssociationKind;
  cardinality: { min: number; max: number | "*" };
  /** Field pairs of the ON condition: `$projection.TravelUUID = _Travel.TravelUUID`. */
  on: Array<{ source: string; target: string }>;
  /** Projections: the association of the projected entity it redirects. */
  baseAssociation?: string;
  src?: SourceRef;
}

/** `custom`: custom entity read by its query class (unmanaged query, D43). */
export type EntityKind = "view" | "projection" | "abstract" | "custom";

export interface EntityModel {
  /** CDS entity name as written: ZR_Travel. */
  name: string;
  kind: EntityKind;
  root: boolean;
  /** View entities: the source table (lower case). Projections: the projected entity. */
  source?: string;
  providerContract?: string;
  /** Name of the generated SQL view (lower case); abstract and custom entities have none. */
  sqlView?: string;
  /** Custom entities: the class of `@ObjectModel.query.implementedBy`, upper case. */
  queryClass?: string;
  /**
   * A CDS table entity (D55, `define table entity`): a view entity on a table of the same name
   * (`source`), whose columns are its elements in lower case.
   */
  tableEntity?: true;
  /**
   * Draft (D54). On an exposed entity of a draft BO: the SQL view of its active instances and drafts
   * (`IsActiveEntity`), the draft table, the base entity. `admin`: the synthetic entity
   * DraftAdministrativeData.
   */
  draft?: { view: string; table: string; base: string; root: boolean; collaborative?: true } | { admin: true };
  fields: FieldModel[];
  associations: AssociationModel[];
  annotations: Annotations;
  src?: SourceRef;
}

// ---------------------------------------------------------------------------------------------
// Behavior

export type ImplementationType = "managed" | "projection";

export interface BehaviorModel {
  /** BDEF name, upper case: ZR_TRAVEL. */
  name: string;
  implementationType: ImplementationType;
  /** Behavior pool of the header (`implementation in class … unique`), upper case. */
  implementationClass?: string;
  strict?: number;
  privilegedMode: boolean;
  /** `managed with additional save` / `managed with unmanaged save` of the header. */
  saving?: SavingModel;
  /** `with draft` (D54). */
  draft?: boolean;
  /** `with collaborative draft` (D59): several users edit a draft, invited by the action Share. */
  collaborativeDraft?: true;
  /** The saver class of the behavior pool (`lsc_…`), for additional and unmanaged save. */
  saver?: SaverModel;
  entities: EntityBehaviorModel[];
  src?: SourceRef;
}

/**
 * Additional save: the managed runtime writes the persistent tables and calls save_modified too.
 * Unmanaged save: save_modified writes; the entity has no persistent table.
 */
export interface SavingModel {
  kind: "additional" | "unmanaged";
  /** `with full data`: the update rows hold every field (they always do here). */
  fullData: boolean;
}

export interface SaverModel {
  /** Runtime class key of the local saver class: `CLAS-ZBP_R_TRAVEL-LSC_ZR_TRAVEL`. */
  classKey: string;
  className: string;
  saveModified?: HandlerRef;
  cleanup?: HandlerRef;
  /** Inherits from cl_abap_behavior_saver_failed: save_modified has a failed parameter. */
  withFailed: boolean;
}

export type FeatureControl = "instance" | "global";

export interface OperationModel {
  kind: "create" | "update" | "delete";
  internal: boolean;
  features?: FeatureControl;
  precheck: boolean;
  /** Projection BDEF: the operation is reused from the base (`use create`). */
  use?: boolean;
}

export interface BehaviorAssociationModel {
  name: string;
  /** `association _X { create; }` */
  create: boolean;
  createInternal: boolean;
  createFeatures?: FeatureControl;
  createPrecheck: boolean;
  internal: boolean;
  /** Projection BDEF: `use association _X`. */
  use?: boolean;
  /** Early numbering of the target: `FOR NUMBERING … FOR CREATE Parent\_X`. */
  earlyNumberingHandler?: HandlerRef;
}

export type FieldCharacteristic =
  | "readonly"
  | "readonlyUpdate"
  | "mandatory"
  | "mandatoryCreate"
  | "numberingManaged"
  | "featuresInstance"
  | "suppress";

export interface TriggerModel {
  create: boolean;
  update: boolean;
  delete: boolean;
  fields: string[];
}

export interface HandlerRef {
  /** Runtime class key of the transpiled local class: `CLAS-ZBP_R_TRAVEL-LHC_TRAVEL`. */
  classKey: string;
  /** Local class name, upper case: LHC_TRAVEL. */
  className: string;
  /** Method name, lower case: validatedates. */
  method: string;
  /** Names of the parameters of the handler method, by role. */
  params: Partial<Record<HandlerParamRole, string>>;
}

export type HandlerParamRole = "keys" | "result" | "requested" | "failed" | "reported" | "mapped" | "entities";

export interface DeterminationModel {
  name: string;
  on: "modify" | "save";
  internal: boolean;
  triggers: TriggerModel;
  handler?: HandlerRef;
  src?: SourceRef;
}

export interface ValidationModel {
  name: string;
  triggers: TriggerModel;
  handler?: HandlerRef;
  src?: SourceRef;
}

export interface CardinalityModel {
  min: number;
  max: number | "*";
}

export interface ActionModel {
  name: string;
  kind: "action" | "function";
  static: boolean;
  factory: boolean;
  internal: boolean;
  features?: FeatureControl;
  precheck: boolean;
  /** Abstract entity (or `$self`) of the parameter. */
  parameter?: string;
  result?: {
    cardinality: CardinalityModel;
    /** `$self`, or the name of a CDS entity. */
    entity: string;
    selective: boolean;
  };
  /** Factory actions: the cardinality written after the name (`factory action copy [1];`). */
  factoryCardinality?: CardinalityModel;
  /** Projection BDEF: `use action`. */
  use?: boolean;
  handler?: HandlerRef;
  src?: SourceRef;
}

export interface MappingModel {
  table: string;
  corresponding: boolean;
  /** Entity field → table column, for the pairs written in the BDEF. */
  fields: Record<string, string>;
}

export interface SideEffectModel {
  trigger: { kind: "field" | "action"; name: string };
  targets: Array<{ kind: "field" | "entity" | "messages" | "permissions"; path: string }>;
}

export interface EntityBehaviorModel {
  /** CDS entity name as written in the BDEF. */
  entity: string;
  /** Alias, or the entity name when there is none. */
  alias: string;
  root: boolean;
  persistentTable?: string;
  implementationClass?: string;
  /** `with additional save` / `with unmanaged save` of the entity (else the header's). */
  saving?: SavingModel;
  lock?: { kind: "master" } | { kind: "dependent"; by: string };
  etag?: { kind: "master"; field: string } | { kind: "dependent"; by: string };
  authorization?: { kind: "master"; global: boolean; instance: boolean } | { kind: "dependent"; by: string };
  /** `early numbering`: keys are drawn by a FOR NUMBERING handler. */
  earlyNumbering: boolean;
  earlyNumberingHandler?: HandlerRef;
  operations: OperationModel[];
  associations: BehaviorAssociationModel[];
  fieldCharacteristics: Record<string, FieldCharacteristic[]>;
  determinations: DeterminationModel[];
  validations: ValidationModel[];
  actions: ActionModel[];
  mapping?: MappingModel;
  sideEffects: SideEffectModel[];
  /** Projection BDEF: `use etag`. */
  useEtag: boolean;
  /** Draft (D54): the table of the drafts of the entity (`draft table`). */
  draftTable?: string;
  /** `draft action Share` (collaborative draft, D59). */
  draftShare?: true;
  /** Handlers of the authorization and feature control methods. */
  globalAuthorizationHandler?: HandlerRef;
  instanceAuthorizationHandler?: HandlerRef;
  globalFeaturesHandler?: HandlerRef;
  instanceFeaturesHandler?: HandlerRef;
  /** Precheck handlers, by operation (`create`, `update`, `delete`, `action:<name>`, `create:<assoc>`). */
  precheckHandlers: Record<string, HandlerRef>;
  src?: SourceRef;
}

// ---------------------------------------------------------------------------------------------
// ABAP artifacts

export interface AbapModel {
  /** Transpiled modules to import at start-up, relative to the `abap/` folder, in order. */
  modules: string[];
  /** BDEF name → name of the generated interface holding its derived types. */
  derivedTypes: Record<string, string>;
}

/** An interval of a number range object (cl_numberrange_runtime, D40). */
export interface NumberRangeIntervalModel {
  object: string;
  /** Two characters, e.g. 01. */
  interval: string;
  subobject?: string;
  toyear?: string;
  /** Decimal digits (up to 20). */
  from: string;
  to: string;
}
