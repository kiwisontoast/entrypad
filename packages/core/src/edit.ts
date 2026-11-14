import { formatEntry, formatOpening } from "./format.js";
import type { EntryContext } from "./format.js";
import { OPENING_ENTRY_ID, parse } from "./parse/parse.js";
import type { ParseOptions } from "./parse/parse.js";
import { defaultSettings } from "./settings.js";
import type { EntrypadSettings } from "./settings.js";
import type { Entry } from "./types.js";

/** Replace `text.slice(from, to)` with `insert`. The same shape CodeMirror uses. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** Applies non-overlapping changes, given in any order. */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
  let out = text;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

const lineStart = (text: string, at: number) => text.lastIndexOf("\n", at - 1) + 1;
/** Offset of the start of the next line, or the end of the text. */
const nextLineStart = (text: string, at: number) => {
  const nl = text.indexOf("\n", at);
  return nl === -1 ? text.length : nl + 1;
};
const isBlankLine = (text: string, from: number) => /^[ \t]*(\r?\n|$)/.test(text.slice(from, nextLineStart(text, from)));

/**
 * The changes that rewrite one entry in the text and touch nothing else, so
 * a drag in a visual never reformats the rest of the user's file.
 *
 * - An entry that exists is replaced in place, within its source range. Its
 *   header line is kept exactly as written if the date, memo and tags are
 *   unchanged.
 * - `null` deletes the entry, with one blank line after it.
 * - An id that isn't in the text adds the entry at the end.
 * - The opening balances (`open` lines, which can be scattered) are written
 *   where the first `open` line was, and the other `open` lines removed.
 *
 * Changing an entry's year can change the year inferred for undated-year
 * entries below it; the visuals never change dates, so this rarely matters.
 */
export function entryChanges(
  text: string,
  entryId: string,
  entry: Entry | null,
  settings: EntrypadSettings = defaultSettings(),
  options: ParseOptions = {},
): TextChange[] {
  const { book, resolved } = parse(text, settings, options);
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const index = book.entries.findIndex((e) => e.id === entryId);
  const existing = book.entries[index];

  if (entryId === OPENING_ENTRY_ID) {
    const block = entry?.lines.length ? formatOpening(entry, book.chart, nl) : "";
    const lines = existing?.lines.flatMap((l) => (l.source ? [l.source.line] : [])) ?? [];
    if (!lines.length) {
      if (!block) return [];
      const first = book.entries.find((e) => e.id !== OPENING_ENTRY_ID && e.source);
      const at = first ? lineStart(text, first.source!.from) : text.length;
      const before = at === text.length && text.length && !text.endsWith("\n") ? nl : "";
      return [{ from: at, to: at, insert: before + block + nl + (first ? nl : "") }];
    }
    const [head, ...rest] = lines;
    const changes: TextChange[] = rest.map((r) => ({ from: lineStart(text, r.from), to: nextLineStart(text, r.to), insert: "" }));
    if (block) changes.push({ from: lineStart(text, head!.from), to: head!.to, insert: block });
    else changes.push({ from: lineStart(text, head!.from), to: nextLineStart(text, head!.to), insert: "" });
    return changes;
  }

  const above = (index === -1 ? book.entries : book.entries.slice(0, index)).filter((e) => e.id !== OPENING_ENTRY_ID && e.date);
  const ctx: EntryContext = {
    chart: book.chart,
    settings: resolved,
    ...(book.period && { period: book.period }),
    ...(above.length && { previousYear: +above[above.length - 1]!.date!.slice(0, 4) }),
  };

  if (!existing?.source) {
    if (!entry) return [];
    const gap = !text.length ? "" : text.endsWith(nl + nl) || text === nl ? "" : text.endsWith("\n") ? nl : nl + nl;
    return [{ from: text.length, to: text.length, insert: gap + formatEntry(entry, ctx, nl) + nl }];
  }

  const { from, to } = existing.source;
  if (entry) {
    const formatted = formatEntry(entry, ctx, nl);
    // Keep the header as the user wrote it when its date, memo and tags are
    // unchanged, unless it holds postings itself (the one-line form).
    const nlAt = text.indexOf("\n", from);
    let headerEnd = nlAt === -1 || nlAt > to ? to : nlAt;
    if (text[headerEnd - 1] === "\r") headerEnd--;
    const sameHeader =
      existing.date === entry.date &&
      existing.memo === entry.memo &&
      (existing.tags ?? []).join() === (entry.tags ?? []).join() &&
      !existing.lines.some((l) => l.source && l.source.line.from < headerEnd);
    if (!sameHeader) return [{ from, to, insert: formatted }];
    const body = formatted.indexOf(nl);
    return [{ from, to, insert: text.slice(from, headerEnd) + (body === -1 ? "" : formatted.slice(body)) }];
  }

  let end = nextLineStart(text, to);
  if (end < text.length && isBlankLine(text, end)) end = nextLineStart(text, end);
  return [{ from: lineStart(text, from), to: end, insert: "" }];
}

/** Returns the text with one entry rewritten, added or deleted. See `entryChanges`. */
export function editEntry(
  text: string,
  entryId: string,
  entry: Entry | null,
  settings: EntrypadSettings = defaultSettings(),
  options: ParseOptions = {},
): string {
  return applyChanges(text, entryChanges(text, entryId, entry, settings, options));
}
