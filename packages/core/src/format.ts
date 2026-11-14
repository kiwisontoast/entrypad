import { usGaapIntroChart } from "./charts/usGaapIntro.js";
import { looksLikeAmount } from "./parse/amount.js";
import { inferYear } from "./parse/date.js";
import { OPENING_ENTRY_ID } from "./parse/parse.js";
import type { Show } from "./parse/parse.js";
import { defaultSettings, fileSettingLines } from "./settings.js";
import type { EntrypadSettings } from "./settings.js";
import type { Account, Book, Entry, Line, Side } from "./types.js";

export interface FormatOptions {
  /** Written as `set` lines where they differ from the defaults, and used to decide when a year can be left out. */
  settings?: EntrypadSettings;
  /** `show` lines, written at the end. */
  shows?: readonly Show[];
  /** The chart the book started from; only accounts that differ from it get `account` lines. Defaults to the US GAAP intro chart. */
  baseChart?: readonly Account[];
  newline?: "\n" | "\r\n";
}

/** Context for writing one entry: what a reader will know when they reach it. */
export interface EntryContext {
  chart: readonly Account[];
  settings: EntrypadSettings;
  period?: { start: string; end: string };
  /** The year of the nearest dated entry above. */
  previousYear?: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEBIT_INDENT = "  ";
const CREDIT_INDENT = "      ";

/** Writes integer cents exactly: 1,200 or 1,200.50. */
export function formatAmount(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = abs % 100;
  return (cents < 0 ? "-" : "") + (frac ? `${whole}.${String(frac).padStart(2, "0")}` : whole);
}

/** Quotes a name that would otherwise be misread, e.g. one ending in a number. */
export function quoteName(name: string, { sideWordLast = false } = {}): string {
  const words = name.split(/\s+/);
  const last = words[words.length - 1] ?? "";
  const risky =
    looksLikeAmount(last) ||
    /^(dr|cr)\s/i.test(name) ||
    (sideWordLast && words.length > 1 && /^(dr|cr)$/i.test(last)) ||
    /^[#;"]/.test(name) ||
    name !== name.trim();
  return risky && !name.includes('"') ? `"${name}"` : name;
}

const nameOf = (account: string, chart: readonly Account[]) => chart.find((a) => a.id === account)?.name ?? account;

/** A line with a negative amount is the same posting on the other side. */
function normalised(line: Line): { side: Side; amount: number } {
  return line.amount < 0
    ? { side: line.side === "dr" ? "cr" : "dr", amount: -line.amount }
    : { side: line.side, amount: line.amount };
}

/** Writes a date, leaving the year out when a reader would infer the same one. */
export function formatDate(iso: string, ctx: EntryContext): string {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  const short = `${MONTHS[month - 1]} ${day}`;
  // The current year is no use: the file would mean something else next year.
  const NONE = -1;
  const inferred = inferYear(
    month,
    day,
    { ...(ctx.period && { period: ctx.period }), ...(ctx.previousYear !== undefined && { previousYear: ctx.previousYear }), currentYear: NONE },
    ctx.settings,
  );
  return inferred === year ? short : `${short}, ${year}`;
}

/** Writes one entry (not the opening balances) as canonical shorthand. */
export function formatEntry(entry: Entry, ctx: EntryContext, newline = "\n"): string {
  const date = entry.date ? formatDate(entry.date, ctx) : "-";
  let header = date.padEnd(6) + " " + (entry.memo ?? "");
  if (entry.tags?.length) header += `${entry.memo ? "   " : ""}[${entry.tags.join(", ")}]`;
  const out = [header.trimEnd()];

  const lines = entry.lines.map((l) => ({ ...normalised(l), name: quoteName(nameOf(l.account, ctx.chart)), blank: !!l.blank }));
  // The first posting sets the reference column, so an entry that starts
  // with a credit spells out every side.
  const explicit = lines[0]?.side === "cr";
  const lead = (side: Side) => (explicit ? `${DEBIT_INDENT}${side} ` : side === "dr" ? DEBIT_INDENT : CREDIT_INDENT);
  const amounts = lines.map((l) => (l.blank ? "" : formatAmount(l.amount)));
  const width = Math.max(...lines.map((l) => lead(l.side).length + l.name.length), 0) + 2;
  const amountWidth = Math.max(...amounts.map((a) => a.length), 0);
  lines.forEach((l, i) => {
    const start = (lead(l.side) + l.name).padEnd(width);
    const column = l.side === "dr" || explicit ? 0 : amountWidth + 2;
    out.push(amounts[i] ? start + " ".repeat(column) + amounts[i]!.padStart(amountWidth) : (lead(l.side) + l.name));
  });
  return out.join(newline);
}

/** Writes the opening balances as `open` lines, naming a side only when it isn't the account's normal one. */
export function formatOpening(entry: Entry, chart: readonly Account[], newline = "\n"): string {
  return entry.lines
    .map((l) => {
      const { side, amount } = normalised(l);
      const account = chart.find((a) => a.id === l.account);
      const normal: Side = account?.normal === "credit" ? "cr" : "dr";
      const name = quoteName(nameOf(l.account, chart), { sideWordLast: true });
      const shown = l.blank && !l.inferred ? 0 : amount;
      return `open ${name}${side === normal ? "" : ` ${side}`} ${formatAmount(shown)}`;
    })
    .join(newline);
}

function accountLine(account: Account, chart: readonly Account[]): string {
  let line = `account "${account.name}" ${account.type}`;
  const base = account.contraOf ? chart.find((a) => a.id === account.contraOf) : undefined;
  if (base) line += ` contra "${base.name}"`;
  for (const alias of account.aliases ?? []) line += ` alias "${alias}"`;
  const implied = base
    ? base.normal === "debit"
      ? "credit"
      : "debit"
    : account.type === "asset" || account.type === "expense"
      ? "debit"
      : "credit";
  if (account.normal !== implied) line += ` normal ${account.normal}`;
  return line;
}

const same = (a: Account, b: Account) => JSON.stringify(a) === JSON.stringify(b);

export function formatShow(show: Show): string {
  return `show ${show.visual}${show.options.length ? `: ${show.options.join(", ")}` : ""}`;
}

/**
 * Writes a whole book as canonical shorthand. Reading the result gives the
 * same book back, and formatting that again gives the same text.
 */
export function format(book: Book, options: FormatOptions = {}): string {
  const nl = options.newline ?? "\n";
  const settings = options.settings ?? defaultSettings();
  const baseChart = options.baseChart ?? usGaapIntroChart;
  const sections: string[] = [];

  const head: string[] = [];
  if (book.name !== undefined || book.period) {
    head.push(`book "${book.name ?? ""}"${book.period ? ` period ${book.period.start}..${book.period.end}` : ""}`);
  }
  head.push(...fileSettingLines(settings));
  for (const account of book.chart) {
    const base = baseChart.find((a) => a.id === account.id);
    if (!base || !same(base, account)) head.push(accountLine(account, book.chart));
  }
  if (head.length) sections.push(head.join(nl));

  const ctx: EntryContext = { chart: book.chart, settings, ...(book.period && { period: book.period }) };
  for (const entry of book.entries) {
    if (entry.id === OPENING_ENTRY_ID) {
      if (entry.lines.length) sections.push(formatOpening(entry, book.chart, nl));
      continue;
    }
    sections.push(formatEntry(entry, ctx, nl));
    if (entry.date) ctx.previousYear = +entry.date.slice(0, 4);
  }

  if (options.shows?.length) sections.push(options.shows.map(formatShow).join(nl));
  return sections.join(nl + nl) + nl;
}
