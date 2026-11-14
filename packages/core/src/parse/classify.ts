import type { EntrypadSettings } from "../settings.js";
import { readDateMark } from "./date.js";
import type { DateMark } from "./date.js";
import { indentOf, isSpace, normalizeSpaces, trimEnd } from "./text.js";
import type { SourceLine } from "./text.js";

export type LineKind = "blank" | "comment" | "directive" | "header" | "posting";

export const DIRECTIVES = ["book", "open", "account", "show", "set"] as const;
export type DirectiveKeyword = (typeof DIRECTIVES)[number];

export interface ClassifiedLine extends SourceLine {
  kind: LineKind;
  /** The line with non-breaking spaces made ordinary (when that setting is on). Same length as the original. */
  text: string;
  /** Display column of the first non-space character, with tabs expanded. */
  column: number;
  /** Offset within the line of the first non-space character. */
  start: number;
  /** Offset within the line just past the content: trailing spaces and any end-of-line comment excluded. */
  end: number;
  keyword?: DirectiveKeyword;
  date?: DateMark;
}

type ReadSettings = Pick<EntrypadSettings, "parsing">;

function isCommentMark(ch: string | undefined, s: ReadSettings["parsing"]): boolean {
  return (ch === "#" && s.hashComments) || (ch === ";" && s.semicolonComments);
}

/**
 * Where content ends when end-of-line comments are on: at the first comment
 * mark that follows a space and sits outside double quotes.
 */
function contentEnd(text: string, start: number, s: ReadSettings["parsing"]): number {
  if (!s.endOfLineComments) return trimEnd(text);
  let quoted = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && isCommentMark(ch, s) && isSpace(text[i - 1])) return trimEnd(text, i);
  }
  return trimEnd(text);
}

/** Decides what kind of line this is, following the table in docs/shorthand.md. */
export function classifyLine(line: SourceLine, settings: ReadSettings): ClassifiedLine {
  const s = settings.parsing;
  const text = s.normalizeSpaces ? normalizeSpaces(line.text) : line.text;
  const { column, start } = indentOf(text, s.tabWidth);
  const base = { ...line, text, column, start, end: text.length };

  if (start === text.length) return { ...base, kind: "blank", end: start };
  if (isCommentMark(text[start], s)) return { ...base, kind: "comment" };

  const end = contentEnd(text, start, s);
  if (end <= start) return { ...base, kind: "comment" };

  if (start === 0) {
    const word = /^[A-Za-z]+(?=[ \t])/.exec(text)?.[0].toLowerCase();
    const keyword = DIRECTIVES.find((d) => d === word);
    if (keyword) return { ...base, end, kind: "directive", keyword };
    const date = readDateMark(text.slice(0, end), settings);
    if (date) return { ...base, end, kind: "header", date };
  }
  return { ...base, end, kind: "posting" };
}
