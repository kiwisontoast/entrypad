import { usGaapIntroChart } from "../charts/usGaapIntro.js";
import type { Diagnostic, DiagnosticCode } from "../diagnostics.js";
import { defaultSettings, parseSettingText, setSetting, settingSpec } from "../settings.js";
import type { EntrypadSettings, SettingValue } from "../settings.js";
import type { Account, Book, Entry, SourceRange } from "../types.js";
import { classifyLine } from "./classify.js";
import type { ClassifiedLine } from "./classify.js";
import { inferYear, isoDate, isRealDate, readFullDate } from "./date.js";
import { splitLines } from "./text.js";

/** A `show` line: which visual a slide displays, with its options. */
export interface Show {
  visual: string;
  options: string[];
  source: SourceRange;
}

export interface ParseResult {
  book: Book;
  diagnostics: Diagnostic[];
  shows: Show[];
  /** The file's own settings, from its `set` lines, by dotted key. */
  settings: Record<string, SettingValue>;
  /** The settings the book was read with: the reader's own, overridden by the file's. */
  resolved: EntrypadSettings;
}

export interface ParseOptions {
  /** The starting chart of accounts. Defaults to the US GAAP intro chart. */
  chart?: readonly Account[];
  /** Today's date, for the year of a date when nothing else gives one. */
  today?: Date;
}

/** A finding before its severity is looked up in the settings. */
interface Finding {
  code: DiagnosticCode;
  message: string;
  target: Diagnostic["target"];
}

const rangeOf = (line: ClassifiedLine, from = line.start, to = line.end): SourceRange => ({
  from: line.from + from,
  to: line.from + to,
});

/**
 * Reads `set` lines first, because they apply to the whole file wherever
 * they sit. Only file settings can be set; personal ones are flagged.
 */
function readSetLines(
  lines: ClassifiedLine[],
  base: EntrypadSettings,
  report: (f: Finding) => void,
): { settings: EntrypadSettings; own: Record<string, SettingValue> } {
  let settings = base;
  const own: Record<string, SettingValue> = {};
  for (const line of lines) {
    if (line.kind !== "directive" || line.keyword !== "set") continue;
    const source = rangeOf(line);
    const words = line.text.slice(line.start, line.end).split(/[ \t]+/).slice(1);
    const [key, value, ...extra] = words;
    const spec = key === undefined ? undefined : settingSpec(key);
    if (!key || value === undefined || extra.length) {
      report({ code: "unknown-setting", message: "Write a setting as: set <setting> <value>", target: { source } });
    } else if (!spec) {
      report({ code: "unknown-setting", message: `"${key}" isn't a setting`, target: { source } });
    } else if (spec.scope !== "file") {
      report({
        code: "unknown-setting",
        message: `${key} is a personal setting, so it can't be set in a book`,
        target: { source },
      });
    } else {
      const parsed = parseSettingText(spec, value);
      if (parsed === undefined) {
        report({ code: "unknown-setting", message: `"${value}" isn't a valid value for ${key}`, target: { source } });
      } else {
        settings = setSetting(settings, key, parsed);
        own[key] = parsed;
      }
    }
  }
  return { settings, own };
}

const BOOK_LINE = /^book[ \t]+"([^"]*)"(?:[ \t]+period[ \t]+(.+?)[ \t]*\.\.[ \t]*(.+?))?[ \t]*$/i;

/**
 * Reads a whole `.entrypad` file. Never throws: anything it can't read is
 * kept as a diagnostic with the exact range of text involved.
 */
export function parse(text: string, settings: EntrypadSettings = defaultSettings(), options: ParseOptions = {}): ParseResult {
  const findings: Finding[] = [];
  const report = (f: Finding) => findings.push(f);

  // Set lines are recognisable before any setting applies: they start at
  // the first column with "set", which no comment or header can.
  const raw = splitLines(text);
  const pre = raw.map((l) => classifyLine(l, settings));
  const { settings: resolved, own } = readSetLines(pre, settings, report);
  const lines = raw.map((l) => classifyLine(l, resolved));

  const book: Book = {
    chart: [...(options.chart ?? usGaapIntroChart)],
    entries: [],
    settings: { standard: "us-gaap", currency: "USD", decimals: resolved.book.decimals },
  };
  const shows: Show[] = [];

  readBookLines(lines, book, resolved, report);

  const currentYear = (options.today ?? new Date()).getFullYear();
  let previousYear: number | undefined;
  let entry: Entry | undefined;

  for (const line of lines) {
    switch (line.kind) {
      case "blank":
        if (resolved.parsing.blankLineEndsEntry) entry = undefined;
        break;
      case "comment":
        break;
      case "directive":
        entry = undefined;
        break;
      case "header": {
        entry = { id: `e${book.entries.length + 1}`, lines: [], source: rangeOf(line) };
        const mark = line.date!;
        if (mark.kind === "date") {
          const written = line.text.slice(0, mark.length);
          const year =
            mark.year ??
            inferYear(mark.month, mark.day, { ...(book.period && { period: book.period }), ...(previousYear !== undefined && { previousYear }), currentYear }, resolved);
          if (isRealDate(year, mark.month, mark.day)) {
            entry.date = isoDate(year, mark.month, mark.day);
            previousYear = year;
          } else {
            report({
              code: "invalid-date",
              message: `"${written}" isn't a real date`,
              target: { entry: entry.id, source: rangeOf(line, 0, mark.length) },
            });
          }
        }
        const memo = line.text.slice(mark.length, line.end).replace(/^[ \t]*,?[ \t]*/, "");
        if (memo) entry.memo = memo;
        book.entries.push(entry);
        break;
      }
      case "posting":
        if (!entry) {
          report({
            code: "unreadable-line",
            message: 'This line isn\'t part of an entry. Start an entry with a date or "-".',
            target: { source: rangeOf(line) },
          });
        }
        break;
    }
  }

  const diagnostics: Diagnostic[] = [];
  for (const f of findings) {
    const severity = resolved.diagnostics[f.code];
    if (severity !== "off") diagnostics.push({ severity, ...f });
  }
  return { book, diagnostics, shows, settings: own, resolved };
}

/** Reads the `book` line, or the one that counts when there are several. */
function readBookLines(lines: ClassifiedLine[], book: Book, settings: EntrypadSettings, report: (f: Finding) => void) {
  const bookLines = lines.filter((l) => l.kind === "directive" && l.keyword === "book");
  if (!bookLines.length) return;
  const firstWins = settings.parsing.duplicateBook === "first-wins";
  const counted = firstWins ? bookLines[0]! : bookLines[bookLines.length - 1]!;
  for (const line of bookLines) {
    if (line === counted) continue;
    report({
      code: "duplicate-book",
      message: `This file has more than one book line, and the ${firstWins ? "first" : "last"} one counts`,
      target: { source: rangeOf(line) },
    });
  }

  const line = counted;
  const m = BOOK_LINE.exec(line.text.slice(0, line.end));
  if (!m) {
    report({
      code: "unreadable-line",
      message: 'Write the book line as: book "Name" period 2026-01-01..2026-01-31',
      target: { source: rangeOf(line) },
    });
    return;
  }
  book.name = m[1]!;
  if (m[2] === undefined) return;
  const start = readFullDate(m[2], settings);
  const end = readFullDate(m[3]!, settings);
  const periodFrom = line.text.indexOf(m[2], 4);
  const periodRange = rangeOf(line, periodFrom, line.end);
  if (!start || !end || !isRealDate(start.year, start.month, start.day) || !isRealDate(end.year, end.month, end.day)) {
    report({
      code: "invalid-date",
      message: "The period needs two real dates with years, e.g. 2026-01-01..2026-01-31",
      target: { source: periodRange },
    });
    return;
  }
  const period = { start: isoDate(start.year, start.month, start.day), end: isoDate(end.year, end.month, end.day) };
  if (period.end < period.start) {
    report({ code: "invalid-date", message: "The period ends before it starts", target: { source: periodRange } });
    return;
  }
  book.period = period;
}
