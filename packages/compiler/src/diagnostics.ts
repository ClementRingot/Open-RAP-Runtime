/** Diagnostics reported by the compiler, with their position in the sources. */

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: Severity;
  /** Stable code, e.g. BDEF001 (see docs/DIAGNOSTICS.md). */
  code: string;
  message: string;
  file?: string;
  /** 1-based. */
  line?: number;
  /** 1-based. */
  column?: number;
}

export interface Location {
  file?: string;
  line?: number;
  column?: number;
}

export class Diagnostics {
  public readonly items: Diagnostic[] = [];

  public add(severity: Severity, code: string, message: string, location?: Location): void {
    const diagnostic: Diagnostic = { severity, code, message };
    if (location?.file !== undefined) {
      diagnostic.file = location.file;
    }
    if (location?.line !== undefined) {
      diagnostic.line = location.line;
    }
    if (location?.column !== undefined) {
      diagnostic.column = location.column;
    }
    this.items.push(diagnostic);
  }

  public error(code: string, message: string, location?: Location): void {
    this.add("error", code, message, location);
  }

  public warning(code: string, message: string, location?: Location): void {
    this.add("warning", code, message, location);
  }

  public info(code: string, message: string, location?: Location): void {
    this.add("info", code, message, location);
  }

  public addAll(other: Diagnostics | readonly Diagnostic[]): void {
    const list = other instanceof Diagnostics ? other.items : other;
    this.items.push(...list);
  }

  public hasErrors(): boolean {
    return this.items.some((d) => d.severity === "error");
  }

  public errors(): Diagnostic[] {
    return this.items.filter((d) => d.severity === "error");
  }

  public sorted(): Diagnostic[] {
    return [...this.items].sort(
      (a, b) =>
        (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0),
    );
  }
}

/** `file:line:column: severity CODE message`, the format of `rapt check`. */
export function formatDiagnostic(d: Diagnostic): string {
  const position = d.file === undefined ? "" : `${d.file}${d.line === undefined ? "" : `:${d.line}`}${d.column === undefined ? "" : `:${d.column}`}: `;
  return `${position}${d.severity} ${d.code} ${d.message}`;
}
