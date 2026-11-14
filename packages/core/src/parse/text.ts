/** One line of the source, without its line ending. Offsets index the original text. */
export interface SourceLine {
  /** Zero-based line number. */
  index: number;
  text: string;
  from: number;
  to: number;
}

/** Splits text into lines, accepting LF and CRLF endings. */
export function splitLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let from = 0;
  let index = 0;
  while (from <= text.length) {
    const nl = text.indexOf("\n", from);
    const end = nl === -1 ? text.length : nl;
    const to = end > from && text[end - 1] === "\r" ? end - 1 : end;
    lines.push({ index: index++, text: text.slice(from, to), from, to });
    if (nl === -1) break;
    from = nl + 1;
  }
  return lines;
}

/** Non-breaking and figure spaces, common in text pasted from Word or the web. */
const NBSP = /[   ]/g;

/**
 * Replaces non-breaking spaces with ordinary ones. Each is one character
 * replaced by one, so offsets into the line stay valid.
 */
export function normalizeSpaces(text: string): string {
  return text.replace(NBSP, " ");
}

export const isSpace = (ch: string | undefined) => ch === " " || ch === "\t";

/**
 * The display column where a line's text begins, with tabs advancing to the
 * next multiple of `tabWidth`, and the offset of that first character.
 */
export function indentOf(text: string, tabWidth: number): { column: number; start: number } {
  let column = 0;
  let start = 0;
  while (start < text.length && isSpace(text[start])) {
    column = text[start] === "\t" ? (Math.floor(column / tabWidth) + 1) * tabWidth : column + 1;
    start++;
  }
  return { column, start };
}

/** Offset just past the last non-space character at or before `end`. */
export function trimEnd(text: string, end = text.length): number {
  while (end > 0 && isSpace(text[end - 1])) end--;
  return end;
}
