/** Abstract syntax tree of a behavior definition (BDEF), as built by the Chevrotain parser. */

/** 1-based position in the BDEF source. */
export interface Loc {
  line: number;
  column: number;
}

export interface Name {
  text: string;
  loc: Loc;
}

export interface Cardinality {
  min: number;
  max: number | "*";
}

export type ImplementationKind = "managed" | "unmanaged" | "abstract" | "projection" | "interface";

export type HeaderItemAst =
  | { kind: "implementation"; type: ImplementationKind; className?: Name; unique: boolean; saving?: { variant: "additional" | "unmanaged"; fullData: boolean }; loc: Loc }
  | { kind: "strict"; version: number; loc: Loc }
  | { kind: "withDraft"; collaborative?: true; loc: Loc }
  | { kind: "privilegedMode"; disabling?: Name; loc: Loc }
  | { kind: "use"; what: string; loc: Loc }
  | { kind: "foreignEntity"; name: Name; loc: Loc }
  | { kind: "unknown"; text: string; loc: Loc };

export type EntityOptionAst =
  | { kind: "persistentTable"; table: Name; loc: Loc }
  | { kind: "draftTable"; table: Name; loc: Loc }
  | { kind: "lockMaster"; unmanaged: boolean; loc: Loc }
  | { kind: "lockDependent"; by?: Name; loc: Loc }
  | { kind: "authorizationMaster"; values: string[]; loc: Loc }
  | { kind: "authorizationDependent"; by?: Name; loc: Loc }
  | { kind: "etagMaster"; field: Name; loc: Loc }
  | { kind: "etagDependent"; by?: Name; loc: Loc }
  | { kind: "totalEtag"; field: Name; loc: Loc }
  | { kind: "earlyNumbering"; loc: Loc }
  | { kind: "lateNumbering"; inPlace: boolean; loc: Loc }
  | { kind: "implementationInClass"; className: Name; unique: boolean; loc: Loc }
  | { kind: "withSave"; variant: "additional" | "unmanaged"; fullData: boolean; loc: Loc }
  | { kind: "useEtag"; loc: Loc }
  | { kind: "unknown"; text: string; loc: Loc };

export interface OperationOptionAst {
  name: string;
  value?: string;
  loc: Loc;
}

export interface TriggerAst {
  create: boolean;
  update: boolean;
  delete: boolean;
  fields: Name[];
}

export interface ResultAst {
  selective: boolean;
  cardinality: Cardinality;
  /** `$self`, or the name of an entity. */
  entity: Name;
  /** `result [1] entity X` (entity result) rather than a structure. */
  entityKeyword: boolean;
}

export interface SideEffectAst {
  trigger: { kind: "field" | "action" | "determineAction"; name: Name };
  targets: Array<{ kind: "field" | "entity" | "messages" | "permissions" | "unknown"; path: string }>;
  loc: Loc;
}

export type BodyItemAst =
  | { kind: "operation"; op: "create" | "update" | "delete"; internal: boolean; options: OperationOptionAst[]; loc: Loc }
  | { kind: "useOperation"; op: "create" | "update" | "delete"; options: OperationOptionAst[]; loc: Loc }
  | {
      kind: "association";
      name: Name;
      internal: boolean;
      abbreviation?: Name;
      create?: { internal: boolean; options: OperationOptionAst[] };
      withDraft: boolean;
      loc: Loc;
    }
  | { kind: "useAssociation"; name: Name; create: boolean; withDraft: boolean; loc: Loc }
  | { kind: "field"; characteristics: Array<{ text: string; loc: Loc }>; fields: Name[]; loc: Loc }
  | { kind: "determination"; name: Name; on: "modify" | "save"; internal: boolean; triggers: TriggerAst; loc: Loc }
  | { kind: "validation"; name: Name; on: "save"; triggers: TriggerAst; loc: Loc }
  | {
      kind: "action";
      actionKind: "action" | "function";
      name: Name;
      internal: boolean;
      static: boolean;
      factory: boolean;
      options: OperationOptionAst[];
      external?: string;
      parameter?: Name;
      result?: ResultAst;
      factoryCardinality?: Cardinality;
      loc: Loc;
    }
  | { kind: "useAction"; actionKind: "action" | "function"; name: Name; alias?: Name; loc: Loc }
  | { kind: "mapping"; table: Name; corresponding: boolean; pairs: Array<{ field: Name; column: Name }>; loc: Loc }
  | { kind: "sideEffects"; items: SideEffectAst[]; loc: Loc }
  | { kind: "unsupported"; what: string; text: string; loc: Loc }
  | { kind: "unknown"; text: string; loc: Loc };

export interface BehaviorAst {
  root: boolean;
  entity: Name;
  alias?: Name;
  options: EntityOptionAst[];
  items: BodyItemAst[];
  loc: Loc;
}

export interface BdefAst {
  headers: HeaderItemAst[];
  behaviors: BehaviorAst[];
  /** Top-level statements other than headers and `define behavior for` (e.g. authorization contexts). */
  others: Array<{ text: string; loc: Loc }>;
}
