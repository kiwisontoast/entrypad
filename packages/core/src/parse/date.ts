import type { EntrypadSettings } from "../settings.js";

/** A date as written, before its year is worked out and before it is checked. */
export interface WrittenDate {
  year?: number;
  month: number;
  day: number;
}

export type DateMark =
  | ({ kind: "date"; length: number } & WrittenDate)
  /** `-`: an entry whose date doesn't matter. */
  | { kind: "dash"; length: number };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_NAMES = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

// Each form must be followed by a space or the end of the text.
const ISO = /^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?=\s|$)/;
const SLASH = /^([0-9]{1,2})\/([0-9]{1,2})(?:\/([0-9]{4}))?(?=\s|$)/;
const NAMED = new RegExp(`^(${MONTH_NAMES})\\s+([0-9]{1,2})(?:,\\s*([0-9]{4}))?(?=\\s|,|$)`, "i");

/**
 * Reads the date (or `-`) at the start of a header line. Returns undefined
 * when the text doesn't start with something shaped like a date. A shape
 * that matches but names no real day, such as `Feb 30`, is still returned;
 * check it with `isRealDate` once its year is known.
 */
export function readDateMark(text: string, settings: Pick<EntrypadSettings, "parsing">): DateMark | undefined {
  if (text[0] === "-" && (text.length === 1 || /\s/.test(text[1]!))) return { kind: "dash", length: 1 };

  let m = ISO.exec(text);
  if (m) return { kind: "date", length: m[0].length, year: +m[1]!, month: +m[2]!, day: +m[3]! };

  m = SLASH.exec(text);
  if (m) {
    const [a, b] = [+m[1]!, +m[2]!];
    const monthFirst = settings.parsing.dateOrder === "month-first";
    return {
      kind: "date",
      length: m[0].length,
      month: monthFirst ? a : b,
      day: monthFirst ? b : a,
      ...(m[3] !== undefined && { year: +m[3] }),
    };
  }

  m = NAMED.exec(text);
  if (m) {
    return {
      kind: "date",
      length: m[0].length,
      month: MONTHS[m[1]!.toLowerCase()]!,
      day: +m[2]!,
      ...(m[3] !== undefined && { year: +m[3] }),
    };
  }
  return undefined;
}

/**
 * Reads a whole piece of text as a complete date with a year, as the `book`
 * line's period needs. Returns undefined if it isn't one.
 */
export function readFullDate(text: string, settings: Pick<EntrypadSettings, "parsing">): Required<WrittenDate> | undefined {
  const t = text.trim();
  const mark = readDateMark(t, settings);
  if (!mark || mark.kind !== "date" || mark.length !== t.length || mark.year === undefined) return undefined;
  return { year: mark.year, month: mark.month, day: mark.day };
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function daysInMonth(year: number, month: number): number {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

/** True for a day that exists: not month 13, not 30 February. */
export function isRealDate(year: number, month: number, day: number): boolean {
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export function isoDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export interface YearContext {
  period?: { start: string; end: string };
  /** The year of the nearest dated entry above, if there is one. */
  previousYear?: number;
  /** Used when nothing else applies. */
  currentYear: number;
}

/**
 * Picks the year for a date written without one, following the
 * `parsing.yearFrom*` settings: the year that puts it inside the book's
 * period, otherwise the year of the entry above, otherwise the period's
 * first year, otherwise the current year.
 */
export function inferYear(
  month: number,
  day: number,
  context: YearContext,
  settings: Pick<EntrypadSettings, "parsing">,
): number {
  const { period, previousYear, currentYear } = context;
  if (period && settings.parsing.yearFromPeriod) {
    const first = +period.start.slice(0, 4);
    const last = +period.end.slice(0, 4);
    for (let y = first; y <= last; y++) {
      if (!isRealDate(y, month, day)) continue;
      const iso = isoDate(y, month, day);
      if (iso >= period.start && iso <= period.end) return y;
    }
  }
  if (previousYear !== undefined && settings.parsing.yearFromPreviousEntry) return previousYear;
  if (period && settings.parsing.yearFromPeriod) return +period.start.slice(0, 4);
  return currentYear;
}
