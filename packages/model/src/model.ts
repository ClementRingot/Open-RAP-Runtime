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

export interface Model {
  formatVersion: typeof MODEL_FORMAT_VERSION;
  generator: { name: string; version: string };
  service: ServiceModel;
  tables: TableModel[];
  entities: EntityModel[];
  behaviors: BehaviorModel[];
  /** Filled by the ABAP generator (behavior pool transpilation). */
  abap?: AbapModel;
  /** Texts of the message classes (MSAG) found in the sources: class → number → text. */
  messageClasses: Record<string, Record<string, string>>;
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
  entitySets: EntitySetModel[];
  annotations: Annotations;
}

export interface EntitySetModel {
  /** Entity set name: the alias of the `expose` statement, or the entity name. */
  name: string;
  /** Exposed CDS entity (usually a projection view). */
  entity: string;
}

// ---------------------------------------------------------------------------------------------
// Dictionary

export interface TableModel {
  /** Table name, lower case. */
  name: string;
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
  semantics?: AdminSemantics;
  /** Name of the currency code element (`@Semantics.amount.currencyCode`). */
  currencyCode?: string;
  /** Name of the unit element (`@Semantics.quantity.unitOfMeasure`). */
  unitOfMeasure?: string;
  /** Merged element annotations (view, propagated, metadata extensions). */
  annotations: Annotations;
  src?: SourceRef;
}

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

export type EntityKind = "view" | "projection" | "abstract";

export interface EntityModel {
  /** CDS entity name as written: ZR_Travel. */
  name: string;
  kind: EntityKind;
  root: boolean;
  /** View entities: the source table (lower case). Projections: the projected entity. */
  source?: string;
  providerContract?: string;
  /** Name of the generated SQL view (lower case); abstract entities have none. */
  sqlView?: string;
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
  entities: EntityBehaviorModel[];
  src?: SourceRef;
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
