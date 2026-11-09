/** Types shared by the managed RAP runtime, the EML kernel and the OData write handler. */

import type { CanonicalValue } from "../values.js";

/** An entity instance: CDS field name → canonical value (D16). */
export type Row = Record<string, CanonicalValue>;

export type FailCause = "unspecific" | "unauthorized" | "not_found" | "locked" | "conflict" | "readonly" | "disabled" | "dependency";

/** ABAP values of `if_abap_behv=>cause` (hex), in this order. */
export const FAIL_CAUSES: FailCause[] = ["unspecific", "unauthorized", "not_found", "locked", "conflict", "readonly", "disabled", "dependency"];

export type Severity = "E" | "W" | "I" | "S" | " ";

export interface Message {
  severity: Severity;
  text: string;
  /** T100 message, when the message comes from a message class. */
  msgid?: string;
  msgno?: string;
}

/** The operation a failure is about (`%create`, `%update`, `%action-x`…). */
export type FailedOperation = { kind: "create" | "update" | "delete" } | { kind: "action"; name: string } | { kind: "association"; name: string };

export interface FailedEntry {
  /** Base entity (CDS name) of the instance. */
  entity: string;
  key?: Row;
  cid?: string;
  cause: FailCause;
  operation?: FailedOperation;
}

export interface ReportedEntry {
  entity?: string;
  key?: Row;
  cid?: string;
  message: Message;
  /** Fields (`%element`) and associations the message is about. */
  elements: string[];
  /** `%global`, or a message without instance (`%other`). */
  global: boolean;
  stateArea?: string;
}

export interface MappedEntry {
  entity: string;
  cid: string;
  key: Row;
}

/** RAP responses of an operation or of a whole request. */
export class Responses {
  public failed: FailedEntry[] = [];
  public reported: ReportedEntry[] = [];
  public mapped: MappedEntry[] = [];

  public add(other: Responses): this {
    this.failed.push(...other.failed);
    this.reported.push(...other.reported);
    this.mapped.push(...other.mapped);
    return this;
  }

  public get hasFailed(): boolean {
    return this.failed.length > 0;
  }
}

/** The mode of an EML statement or of an OData request. */
export interface AccessMode {
  /** IN LOCAL MODE: no authorization and feature control checks, read-only fields writable. */
  local: boolean;
  /** PRIVILEGED: no authorization checks. */
  privileged: boolean;
  /** The request comes from outside the BO (OData): ETags, read-only fields and internal operations are checked. */
  external: boolean;
}

export const LOCAL_MODE: AccessMode = { local: true, privileged: false, external: false };
export const EML_MODE: AccessMode = { local: false, privileged: false, external: false };
export const ODATA_MODE: AccessMode = { local: false, privileged: false, external: true };

/** An error of the RAP runtime that ends the request (an ABAP short dump on a system). */
export class RapRuntimeError extends Error {}
