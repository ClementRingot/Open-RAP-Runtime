/**
 * Token helpers of the ABAP rewrite pass: positions, adjacency (no blank between two tokens),
 * and source edits that keep the line numbers of the original file.
 */

import type * as abaplint from "@abaplint/core";

export interface Tok {
  str: string;
  upper: string;
  row: number;
  col: number;
  endRow: number;
  endCol: number;
}

export function toks(tokens: readonly abaplint.Token[]): Tok[] {
  return tokens.map((t) => ({
    str: t.getStr(),
    upper: t.getStr().toUpperCase(),
    row: t.getStart().getRow(),
    col: t.getStart().getCol(),
    endRow: t.getEnd().getRow(),
    endCol: t.getEnd().getCol(),
  }));
}

/** No blank between the two tokens. */
export function adjacent(a: Tok, b: Tok): boolean {
  return a.endRow === b.row && a.endCol === b.col;
}

/** Source text of tokens: one blank where the original has blanks, line breaks or comments. */
export function joinTokens(tokens: readonly Tok[], replace?: Map<Tok, string>): string {
  let text = "";
  tokens.forEach((t, i) => {
    const previous = tokens[i - 1];
    if (previous !== undefined && !adjacent(previous, t)) {
      text += " ";
    }
    text += replace?.get(t) ?? t.str;
  });
  return text;
}

const OPEN = new Set(["(", "["]);
const CLOSE = new Set([")", "]"]);

/** Nesting depth change of a token: `(` opens, `)` closes. */
export function depthDelta(t: Tok): number {
  if (OPEN.has(t.str) || (t.str.endsWith("(") && t.str.length > 1 && !t.str.startsWith("'") && !t.str.startsWith("|") && !t.str.startsWith("`"))) {
    return 1;
  }
  if (CLOSE.has(t.str) || (t.str.startsWith(")") && t.str.length > 1)) {
    return -1;
  }
  return 0;
}

/** Edits of a source file; each replacement keeps the number of lines of the text it replaces. */
export class SourceEdits {
  private readonly edits: Array<{ start: number; end: number; text: string }> = [];
  private readonly lineStarts: number[] = [0];

  public constructor(private readonly source: string) {
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") {
        this.lineStarts.push(i + 1);
      }
    }
  }

  /** Offset of a 1-based row/column position. */
  public offset(row: number, col: number): number {
    return (this.lineStarts[row - 1] ?? this.source.length) + col - 1;
  }

  /** Replaces the text from the start of `first` to the end of `last` (both included). */
  public replace(first: Tok, last: Tok, text: string): void {
    this.edits.push({ start: this.offset(first.row, first.col), end: this.offset(last.endRow, last.endCol), text });
  }

  public get size(): number {
    return this.edits.length;
  }

  public apply(): string {
    const sorted = [...this.edits].sort((a, b) => a.start - b.start);
    let result = "";
    let position = 0;
    for (const edit of sorted) {
      if (edit.start < position) {
        throw new Error(`overlapping ABAP edits at offset ${edit.start}`);
      }
      const replaced = this.source.slice(edit.start, edit.end);
      const lines = (replaced.match(/\n/g) ?? []).length;
      const own = (edit.text.match(/\n/g) ?? []).length;
      // a longer replacement is written on one line, so that the following lines keep their number
      const flat = own > lines;
      const text = flat ? edit.text.replace(/\n\s*/g, " ") : edit.text;
      result += this.source.slice(position, edit.start) + text + "\n".repeat(lines - (flat ? 0 : own));
      position = edit.end;
    }
    return result + this.source.slice(position);
  }
}
