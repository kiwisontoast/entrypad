import { matchAccount } from "../accounts.js";
import { usGaapIntroChart } from "../charts/usGaapIntro.js";
import type { Diagnostic, DiagnosticCode } from "../diagnostics.js";
import { defaultSettings, parseSettingText, setSetting, settingSpec } from "../settings.js";
import type { EntrypadSettings, SettingValue } from "../settings.js";
import type { Account, AccountType, Book, Entry, EntryTag, Line, Side, SourceRange } from "../types.js";
import { looksLikeAmount, parseAmount } from "./amount.js";
import { classifyLine } from "./classify.js";
import type { ClassifiedLine } from "./classify.js";
import { inferYear, isoDate, isRealDate, readFullDate } from "./date.js";
import { splitLines } from "./text.js";
import { backSpaces, lastWord, readAccountAndAmount, readName, skipSpaces, tokenize } from "./tokens.js";
import type { Span } from "./tokens.js";

/** A `show` line: which visual a slide displays, with its options as written. */
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

/** The visuals a `show` line can name. */
export const visuals = [
  "entry-cards",
  "t-accounts",
  "equation",
  "statement-flow",
  "cash-flow",
  "trial-balance",
  "schedule",
] as const;

export const entryTags: readonly EntryTag[] = ["adjusting", "closing", "operating", "investing", "financing"];

/** The id of the entry that `open` lines form. */
export const OPENING_ENTRY_ID = "opening";

/** A finding before its severity is looked up in the settings. */
interface Finding {
  code: DiagnosticCode;
  message: string;
  target: Diagnostic["target"];
}
type Report = (f: Finding) => void;

const abs = (line: ClassifiedLine, span: Span): SourceRange => ({ from: line.from + span.from, to: line.from + span.to });
const content = (line: ClassifiedLine): Span => ({ from: line.start, to: line.end });
const sideName = (side: Side) => (side === "dr" ? "debit" : "credit");

/**
 * Reads `set` lines first, because they apply to the whole file wherever
 * they sit. Only file settings can be set; personal ones are flagged.
 */
function readSetLines(lines: ClassifiedLine[], base: EntrypadSettings, report: Report) {
  let settings = base;
  const own: Record<string, SettingValue> = {};
  for (const line of lines) {
    if (line.kind !== "directive" || line.keyword !== "set") continue;
    const source = abs(line, content(line));
    const words = line.text.slice(line.start, line.end).split(/[ \t]+/).slice(1);
    const [key, value, ...extra] = words;
    const spec = key === undefined ? undefined : settingSpec(key);
    if (!key || value === undefined || extra.length) {
      report({ code: "unknown-setting", message: "Write a setting as: set <setting> <value>", target: { source } });
    } else if (!spec) {
      report({ code: "unknown-setting", message: `"${key}" isn't a setting`, target: { source } });
    } else if (spec.scope !== "file") {
      report({ code: "unknown-setting", message: `${key} is a personal setting, so it can't be set in a book`, target: { source } });
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

/** Reads the `book` line, or the one that counts when there are several. */
function readBookLines(lines: ClassifiedLine[], book: Book, settings: EntrypadSettings, report: Report) {
  const bookLines = lines.filter((l) => l.kind === "directive" && l.keyword === "book");
  if (!bookLines.length) return;
  const firstWins = settings.parsing.duplicateBook === "first-wins";
  const counted = firstWins ? bookLines[0]! : bookLines[bookLines.length - 1]!;
  for (const line of bookLines) {
    if (line === counted) continue;
    report({
      code: "duplicate-book",
      message: `This file has more than one book line, and the ${firstWins ? "first" : "last"} one counts`,
      target: { source: abs(line, content(line)) },
    });
  }

  const line = counted;
  const m = BOOK_LINE.exec(line.text.slice(0, line.end));
  if (!m) {
    report({
      code: "unreadable-line",
      message: 'Write the book line as: book "Name" period 2026-01-01..2026-01-31',
      target: { source: abs(line, content(line)) },
    });
    return;
  }
  book.name = m[1]!;
  if (m[2] === undefined) return;
  const start = readFullDate(m[2], settings);
  const end = readFullDate(m[3]!, settings);
  const periodRange = abs(line, { from: line.text.indexOf(m[2], 4), to: line.end });
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

const ACCOUNT_TYPES: readonly AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];
const ACCOUNT_FORM = 'Write it as: account "Name" asset, optionally followed by contra "Account", alias "Name" or normal debit';

export function accountId(name: string, chart: readonly Account[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "account";
  const taken = new Set(chart.map((a) => a.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * Reads every `account` line before any posting, since postings above an
 * `account` line can use the account. The chart is rebuilt as a new array
 * on each change, because account lookups cache an index per chart array.
 */
function readAccountLines(lines: ClassifiedLine[], book: Book, settings: EntrypadSettings, report: Report) {
  const contras: { account: Account; name: string; line: ClassifiedLine; span: Span; explicitNormal: boolean }[] = [];
  const namesOnly = { accounts: { ...settings.accounts, matchAliases: false, matchIds: false } };

  for (const line of lines) {
    if (line.kind !== "directive" || line.keyword !== "account") continue;
    const source = abs(line, content(line));
    const tokens = tokenize(line.text, { from: line.start + "account".length, to: line.end });
    const fail = () => report({ code: "unreadable-line", message: ACCOUNT_FORM, target: { source } });
    if (!tokens || tokens.length < 2 || !tokens[0]!.quoted || !tokens[0]!.text.trim()) {
      fail();
      continue;
    }
    const name = tokens[0]!.text.trim();
    const type = tokens[1]!.text.toLowerCase() as AccountType;
    if (tokens[1]!.quoted || !ACCOUNT_TYPES.includes(type)) {
      fail();
      continue;
    }
    const aliases: string[] = [];
    let normal: Account["normal"] | undefined;
    let contra: Span | undefined;
    let contraName: string | undefined;
    let ok = true;
    for (let i = 2; i < tokens.length; i += 2) {
      const option = tokens[i]!.text.toLowerCase();
      const value = tokens[i + 1];
      if (!value || tokens[i]!.quoted) ok = false;
      else if (option === "alias") aliases.push(value.text);
      else if (option === "contra") [contraName, contra] = [value.text, value.span];
      else if (option === "normal" && /^(debit|credit)$/i.test(value.text)) normal = value.text.toLowerCase() as Account["normal"];
      else ok = false;
    }
    if (!ok) {
      fail();
      continue;
    }

    const existing = matchAccount(name, book.chart, namesOnly);
    const account: Account = {
      id: existing?.id ?? accountId(name, book.chart),
      name,
      type,
      normal: normal ?? (type === "asset" || type === "expense" ? "debit" : "credit"),
      ...(existing?.group !== undefined && { group: existing.group }),
      ...(aliases.length && { aliases }),
    };
    book.chart = existing ? book.chart.map((a) => (a === existing ? account : a)) : [...book.chart, account];
    if (contraName !== undefined) contras.push({ account, name: contraName, line, span: contra!, explicitNormal: !!normal });
  }

  // Contra accounts can name an account declared further down.
  for (const c of contras) {
    const base = matchAccount(c.name, book.chart, settings);
    if (!base) {
      report({ code: "unknown-account", message: `"${c.name}" isn't in the chart`, target: { account: c.name, source: abs(c.line, c.span) } });
      continue;
    }
    const current = book.chart.find((a) => a.id === c.account.id)!;
    const updated: Account = {
      ...current,
      contraOf: base.id,
      ...(!c.explicitNormal && { normal: base.normal === "debit" ? "credit" : "debit" }),
    };
    book.chart = book.chart.map((a) => (a === current ? updated : a));
  }
}

/** An entry being read, with what the next posting line needs to know. */
interface Building {
  entry: Entry;
  /** Display column of the first posting line: lines further right are credits. */
  referenceColumn?: number;
  /** Absolute offset just past the entry's last content. */
  end: number;
}

/**
 * Reads a whole `.entrypad` file. Never throws: anything it can't read is
 * kept as a diagnostic with the exact range of text involved, and the rest
 * of the file is read as usual.
 */
export function parse(text: string, settings: EntrypadSettings = defaultSettings(), options: ParseOptions = {}): ParseResult {
  const findings: Finding[] = [];
  const report: Report = (f) => findings.push(f);

  // Set lines are recognisable before any setting applies: they start at
  // the first column with "set", which no comment or header can.
  const raw = splitLines(text);
  const { settings: s, own } = readSetLines(raw.map((l) => classifyLine(l, settings)), settings, report);
  const lines = raw.map((l) => classifyLine(l, s));

  const book: Book = {
    chart: [...(options.chart ?? usGaapIntroChart)],
    entries: [],
    settings: { standard: "us-gaap", currency: "USD", decimals: s.book.decimals },
  };
  const shows: Show[] = [];

  readBookLines(lines, book, s, report);
  readAccountLines(lines, book, s, report);

  const currentYear = (options.today ?? new Date()).getFullYear();
  let previousYear: number | undefined;
  let current: Building | undefined;
  const opening: Line[] = [];
  let openingSource: SourceRange | undefined;

  /** Reads an amount onto a line, applying `parsing.negativeAmounts`. */
  const readAmount = (line: ClassifiedLine, span: Span | undefined, l: Line, target: Diagnostic["target"]) => {
    if (!span) {
      l.blank = true;
      return;
    }
    const word = line.text.slice(span.from, span.to);
    const source = abs(line, span);
    const result = parseAmount(word, s);
    if (!result.ok) {
      report({ code: "invalid-amount", message: `"${word}" ${result.problem}`, target: { ...target, source } });
      l.blank = true;
      return;
    }
    if (result.negative) {
      const mode = s.parsing.negativeAmounts;
      if (mode === "invalid") {
        report({
          code: "invalid-amount",
          message: `"${word}" is negative. Amounts are always positive; indentation or dr and cr set the side.`,
          target: { ...target, source },
        });
        l.blank = true;
        return;
      }
      if (mode === "other-side") l.side = l.side === "dr" ? "cr" : "dr";
      report({
        code: "negative-amount",
        message: `Amounts are always positive, so "${word}" is read as ${word.replace(/[-()$]/g, "")} on the ${sideName(l.side)} side`,
        target: { ...target, source },
      });
    }
    l.amount = result.cents;
  };

  /** Turns `<account> [<amount>]` into a line on the given side. */
  const makeLine = (line: ClassifiedLine, span: Span, side: Side, entry: Entry): Line | undefined => {
    const read = readAccountAndAmount(line.text, span);
    if (!read.ok) {
      report({ code: "unreadable-line", message: read.problem, target: { entry: entry.id, source: abs(line, span) } });
      return undefined;
    }
    const { name, nameSpan, amount } = read.value;
    const account = matchAccount(name, book.chart, s);
    const l: Line = {
      account: account?.id ?? name,
      side,
      amount: 0,
      source: { line: abs(line, span), account: abs(line, nameSpan), ...(amount && { amount: abs(line, amount) }) },
    };
    readAmount(line, amount, l, { entry: entry.id, line: entry.lines.length });
    return l;
  };

  const finish = () => {
    if (!current) return;
    current.entry.source = { from: current.entry.source!.from, to: current.end };
    inferBlank(current.entry, s);
    current = undefined;
  };

  /** Reads the tags at the end of a span; returns the span without them. */
  const readTags = (line: ClassifiedLine, span: Span, entry: Entry): Span => {
    // Groups are read from the right, so each one goes in front of those after it.
    let tags: EntryTag[] = [];
    let to = backSpaces(line.text, span.to, span.from);
    while (to > span.from && line.text[to - 1] === "]") {
      const open = line.text.lastIndexOf("[", to - 1);
      if (open < span.from || (open > span.from && line.text[open - 1] !== " " && line.text[open - 1] !== "\t")) break;
      let at = open + 1;
      const group: EntryTag[] = [];
      for (const part of line.text.slice(open + 1, to - 1).split(",")) {
        const tag = part.trim().toLowerCase();
        const from = at + part.length - part.trimStart().length;
        const range = abs(line, { from, to: from + Math.max(1, part.trim().length) });
        if (entryTags.includes(tag as EntryTag)) {
          group.push(tag as EntryTag);
        } else {
          report({
            code: "unknown-tag",
            message: `"${part.trim()}" isn't a tag. The tags are adjusting, closing, operating, investing and financing.`,
            target: { entry: entry.id, source: range },
          });
        }
        at += part.length + 1;
      }
      tags = [...group, ...tags];
      to = backSpaces(line.text, open, span.from);
    }
    tags = tags.filter((t, i) => tags.indexOf(t) === i);
    if (tags.length) entry.tags = tags;
    return { from: span.from, to };
  };

  /** Splits one side of a one-line entry into postings. */
  const readSideItems = (line: ClassifiedLine, span: Span, side: Side, entry: Entry) => {
    const from = skipSpaces(line.text, span.from, span.to);
    const to = backSpaces(line.text, span.to, from);
    if (from >= to) {
      report({
        code: "unreadable-line",
        message: `This one-line entry has no ${sideName(side)}s ${side === "dr" ? "before" : "after"} the slash.`,
        target: { entry: entry.id, source: abs(line, { from: Math.min(span.from, to), to: Math.max(span.to, from) }) },
      });
      return;
    }
    const always = s.parsing.oneLineCommas === "always";
    const items: Span[] = [];
    let start = from;
    let quoted = false;
    for (let i = from; i < to; i++) {
      const ch = line.text[i];
      if (ch === '"') quoted = !quoted;
      if (ch !== "," || quoted || (line.text[i + 1] !== " " && line.text[i + 1] !== "\t")) continue;
      let w = i;
      while (w > start && line.text[w - 1] !== " " && line.text[w - 1] !== "\t") w--;
      if (!always && !looksLikeAmount(line.text.slice(w, i))) continue;
      items.push({ from: start, to: backSpaces(line.text, i, start) });
      start = skipSpaces(line.text, i + 1, to);
    }
    items.push({ from: start, to });
    for (const item of items) {
      const l = makeLine(line, item, side, entry);
      if (l) entry.lines.push(l);
    }
  };

  const readHeader = (line: ClassifiedLine) => {
    const entry: Entry = { id: `e${book.entries.length + 1}`, lines: [], source: abs(line, { from: 0, to: line.end }) };
    const mark = line.date!;
    if (mark.kind === "date") {
      const year =
        mark.year ??
        inferYear(
          mark.month,
          mark.day,
          { ...(book.period && { period: book.period }), ...(previousYear !== undefined && { previousYear }), currentYear },
          s,
        );
      if (isRealDate(year, mark.month, mark.day)) {
        entry.date = isoDate(year, mark.month, mark.day);
        previousYear = year;
      } else {
        report({
          code: "invalid-date",
          message: `"${line.text.slice(0, mark.length)}" isn't a real date`,
          target: { entry: entry.id, source: abs(line, { from: 0, to: mark.length }) },
        });
      }
    }

    let bodyFrom = skipSpaces(line.text, mark.length, line.end);
    if (line.text[bodyFrom] === ",") bodyFrom = skipSpaces(line.text, bodyFrom + 1, line.end);
    const body: Span = { from: bodyFrom, to: line.end };

    // The one-line form: "<memo> [tags]: <debits> / <credits>".
    const bodyText = line.text.slice(0, line.end);
    const slash = /[ \t]\/(?=[ \t]|$)/g;
    slash.lastIndex = body.from;
    const slashMatch = slash.exec(bodyText);
    let colon = -1;
    if (slashMatch) {
      for (let i = slashMatch.index; i >= body.from; i--) {
        if (line.text[i] === ":" && (line.text[i + 1] === " " || line.text[i + 1] === "\t")) {
          colon = i;
          break;
        }
      }
    }
    const head = readTags(line, colon >= 0 ? { from: body.from, to: colon } : body, entry);
    const memo = line.text.slice(head.from, head.to).trim();
    if (memo) entry.memo = memo;

    if (colon >= 0 && slashMatch) {
      const slashAt = slashMatch.index + 1;
      readSideItems(line, { from: colon + 1, to: slashAt }, "dr", entry);
      readSideItems(line, { from: slashAt + 1, to: line.end }, "cr", entry);
    }
    book.entries.push(entry);
    current = { entry, end: line.from + line.end };
  };

  const readPosting = (line: ClassifiedLine, b: Building) => {
    let span = content(line);
    const explicit = /^(dr|cr)[ \t]+/i.exec(line.text.slice(span.from, span.to));
    b.referenceColumn ??= line.column;
    const side: Side = explicit
      ? (explicit[1]!.toLowerCase() as Side)
      : line.column > b.referenceColumn
        ? "cr"
        : "dr";
    if (explicit) span = { from: span.from + explicit[0].length, to: span.to };
    const l = makeLine(line, span, side, b.entry);
    if (l) {
      l.source!.line = abs(line, content(line));
      b.entry.lines.push(l);
    }
    b.end = line.from + line.end;
  };

  const readOpen = (line: ClassifiedLine) => {
    const span = { from: skipSpaces(line.text, line.start + "open".length, line.end), to: line.end };
    const form = "Write an opening balance as: open <Account> <amount>, with dr or cr before the amount for an abnormal balance";
    const split = lastWord(line.text, span);
    if (!split || !looksLikeAmount(line.text.slice(split.word.from, split.word.to))) {
      report({ code: "unreadable-line", message: form, target: { entry: OPENING_ENTRY_ID, source: abs(line, content(line)) } });
      return;
    }
    let nameSpan = split.rest;
    let side: Side | undefined;
    const sideWord = lastWord(line.text, nameSpan);
    if (sideWord && /^(dr|cr)$/i.test(line.text.slice(sideWord.word.from, sideWord.word.to))) {
      side = line.text.slice(sideWord.word.from, sideWord.word.to).toLowerCase() as Side;
      nameSpan = sideWord.rest;
    }
    const name = readName(line.text, nameSpan);
    if (!name.ok) {
      report({ code: "unreadable-line", message: form, target: { entry: OPENING_ENTRY_ID, source: abs(line, content(line)) } });
      return;
    }
    const account = matchAccount(name.name, book.chart, s);
    const l: Line = {
      account: account?.id ?? name.name,
      side: side ?? (account?.normal === "credit" ? "cr" : "dr"),
      amount: 0,
      source: { line: abs(line, content(line)), account: abs(line, nameSpan), amount: abs(line, split.word) },
    };
    readAmount(line, split.word, l, { entry: OPENING_ENTRY_ID, line: opening.length });
    opening.push(l);
    const range = abs(line, content(line));
    openingSource = openingSource ? { from: openingSource.from, to: range.to } : range;
  };

  const readShow = (line: ClassifiedLine) => {
    const after = line.start + "show".length;
    const colonAt = line.text.indexOf(":", after);
    const colon = colonAt >= 0 && colonAt < line.end ? colonAt : -1;
    const visualFrom = skipSpaces(line.text, after, line.end);
    const visualSpan = { from: visualFrom, to: backSpaces(line.text, colon >= 0 ? colon : line.end, visualFrom) };
    const visual = line.text.slice(visualSpan.from, visualSpan.to);
    const known = visuals.find((v) => v === visual.toLowerCase());
    const source = abs(line, content(line));
    let options = colon >= 0 ? line.text.slice(colon + 1, line.end).split(",").map((o) => o.trim()) : [];
    if (options.length === 1 && options[0] === "") options = [];
    // Rejoin account names that contain a comma, e.g. "Accumulated Depreciation, Equipment".
    const merged: string[] = [];
    for (let i = 0; i < options.length; i++) {
      const joined = `${options[i]}, ${options[i + 1]}`;
      if (i + 1 < options.length && !matchAccount(options[i]!, book.chart, s) && matchAccount(joined, book.chart, s)) {
        merged.push(joined);
        i++;
      } else merged.push(options[i]!);
    }
    if (!known) {
      report({
        code: "unknown-visual",
        message: `"${visual}" isn't a visual. The visuals are ${visuals.join(", ")}.`,
        target: { source: abs(line, visualSpan.from < visualSpan.to ? visualSpan : content(line)) },
      });
    }
    shows.push({ visual: known ?? visual, options: merged.filter(Boolean), source });
  };

  for (const line of lines) {
    switch (line.kind) {
      case "blank":
        if (s.parsing.blankLineEndsEntry) finish();
        break;
      case "comment":
        break;
      case "directive":
        finish();
        if (line.keyword === "open") readOpen(line);
        else if (line.keyword === "show") readShow(line);
        break;
      case "header":
        finish();
        readHeader(line);
        break;
      case "posting":
        if (current) readPosting(line, current);
        else {
          report({
            code: "unreadable-line",
            message: 'This line isn\'t part of an entry. Start an entry with a date or "-".',
            target: { source: abs(line, content(line)) },
          });
        }
        break;
    }
  }
  finish();

  if (opening.length) {
    const entry: Entry = {
      id: OPENING_ENTRY_ID,
      ...(book.period && { date: book.period.start }),
      memo: "Opening balances",
      lines: opening,
      source: openingSource!,
    };
    inferBlank(entry, s);
    book.entries.unshift(entry);
  }

  const diagnostics: Diagnostic[] = [];
  for (const f of findings) {
    const severity = s.diagnostics[f.code];
    if (severity !== "off") diagnostics.push({ severity, ...f });
  }
  return { book, diagnostics, shows, settings: own, resolved: s };
}

/**
 * Fills in the one blank amount that balances an entry, when
 * `autofix.inferBlankAmount` is on. With two or more blanks, or when the
 * balancing amount would be zero or negative, nothing is filled in and the
 * book rules flag the entry.
 */
function inferBlank(entry: Entry, settings: EntrypadSettings) {
  const blanks = entry.lines.filter((l) => l.blank);
  if (blanks.length !== 1 || !settings.autofix.inferBlankAmount) return;
  let net = 0;
  for (const l of entry.lines) if (!l.blank) net += l.side === "dr" ? l.amount : -l.amount;
  const blank = blanks[0]!;
  const needed = blank.side === "dr" ? -net : net;
  if (needed > 0) {
    blank.amount = needed;
    blank.inferred = true;
  }
}
