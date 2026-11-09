/** OData errors and their JSON representation (OData V4 JSON format, with the SAP extensions UI5 reads). */

export type Severity = "error" | "warning" | "info" | "success";

export interface ODataMessage {
  code: string;
  message: string;
  target?: string;
  severity: Severity;
  /** The message is not about the request resource (e.g. another instance). */
  transition?: boolean;
}

/** `@Common.numericSeverity`: 1 success, 2 info, 3 warning, 4 error. */
export const NUMERIC_SEVERITY: Record<Severity, number> = { success: 1, info: 2, warning: 3, error: 4 };

export class ODataError extends Error {
  public readonly details: ODataMessage[];

  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly target?: string,
    details: ODataMessage[] = [],
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.details = details;
  }

  public toJSON(): { error: Record<string, unknown> } {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.target !== undefined) {
      error["target"] = this.target;
    }
    error["@Common.numericSeverity"] = NUMERIC_SEVERITY.error;
    if (this.details.length > 0) {
      error["details"] = this.details.map((d) => {
        const detail: Record<string, unknown> = { code: d.code, message: d.message };
        if (d.target !== undefined) {
          detail["target"] = d.target;
        }
        detail["@Common.numericSeverity"] = NUMERIC_SEVERITY[d.severity];
        return detail;
      });
    }
    return { error };
  }
}

export const notFound = (what: string): ODataError => new ODataError(404, "NOT_FOUND", `${what} not found`);
export const badRequest = (message: string, target?: string): ODataError => new ODataError(400, "BAD_REQUEST", message, target);
export const notImplemented = (what: string): ODataError => new ODataError(501, "NOT_IMPLEMENTED", `${what} is not supported`);
export const methodNotAllowed = (message: string): ODataError => new ODataError(405, "METHOD_NOT_ALLOWED", message);
