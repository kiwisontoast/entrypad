import { matchAccount } from "./accounts.js";
import { usGaapIntroChart } from "./charts/usGaapIntro.js";
import type { Diagnostic, DiagnosticCode } from "./diagnostics.js";
import { formatAmount, formatEntry } from "./format.js";
import type { EntryContext } from "./format.js";
import { parseAmount } from "./parse/amount.js";
import { isoDate, isRealDate } from "./parse/date.js";
import { entryTags, OPENING_ENTRY_ID, parse } from "./parse/parse.js";
import { splitLines } from "./parse/text.js";
import type { SourceLine } from "./parse/text.js";
import { defaultSettings } from "./settings.js";
import type { EntrypadSettings } from "./settings.js";
import type { Account, AccountType, Book, Entry, EntryTag, Line, SourceRange } from "./types.js";

/** hledger's top-level account names, and the types they hold. */
const TOP_LEVEL: Record<string, AccountType> = {
  assets: "asset",
  asset: "asset",
  liabilities: "liability",
  liability: "liability",
  equity: "equity",
  revenues: "revenue",
  revenue: "revenue",
  income: "revenue",
  expenses: "expense",
  expense: "expense",
};
const PREFIX: Record<AccountType, string> = {
  asset: "assets",
  liability: "liabilities",
  equity: "equity",
  revenue: "revenues",
  expense: "expenses",
};

export interface HledgerImport {
  /** The journal as Entrypad shorthand: from here on, this text is the book. */
  text: string;
  book: Book;
  /** What the import noticed, located in the journal it was given. */
  diagnostics: Diagnostic[];
}

export interface HledgerOptions {
  chart?: readonly Account[];
  today?: Date;
}

interface Finding {
  code: DiagnosticCode;
  message: string;
  source: SourceRange;
}

const wholeWords = (haystack: string, needle: string) =>
  new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(haystack);

/**
 * Finds the chart account an hledger name means. By the last part first
 * (`assets:cash` is Cash). Failing that, the one account of the right type
 * whose name contains that part, so `liabilities:notes` is Notes Payable.
 */
export function matchHledgerAccount(name: string, chart: readonly Account[], settings: EntrypadSettings): Account | undefined {
  if (settings.hledger.importMatch === "full-name") return matchAccount(name, chart, settings);
  const parts = name.split(":");
  const last = parts[parts.length - 1]!.trim();
  const direct = matchAccount(last, chart, settings);
  if (direct || parts.length < 2) return direct;
  const type = TOP_LEVEL[parts[0]!.trim().toLowerCase()];
  const needle = last.toLowerCase().replace(/\s+/g, " ");
  const candidates = chart.filter((a) => (!type || a.type === type) && wholeWords(a.name.toLowerCase(), needle));
  return candidates.length === 1 ? candidates[0] : undefined;
}

const HEADER_DATE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|^(\d{1,2})[-/](\d{1,2})(?=[\s=*!(]|$)/;

/** Reads an hledger amount such as `$8,000`, `$-4,000.50`, `-$12` or `100 USD` into signed cents. */
function readHledgerAmount(text: string, settings: EntrypadSettings): { ok: true; cents: number } | { ok: false; problem: string } {
  let t = text.replace(/\s+/g, "");
  t = t.replace(/^USD|USD$/i, "");
  let negative = false;
  if (t.startsWith("-")) [negative, t] = [true, t.slice(1)];
  if (t.startsWith("$")) t = t.slice(1);
  if (t.startsWith("-")) [negative, t] = [!negative, t.slice(1)];
  if (t.startsWith("+")) t = t.slice(1);
  if (!/^[0-9.,]+$/.test(t)) return { ok: false, problem: "isn't an amount in dollars" };
  const read = parseAmount(t, { parsing: { ...settings.parsing, thousandsSuffix: false } });
  if (!read.ok) return read;
  return { ok: true, cents: negative ? -read.cents : read.cents };
}

/**
 * Reads an hledger or ledger journal into Entrypad shorthand. Positive
 * amounts are debits and negative ones credits. Directives Entrypad doesn't
 * use are kept as comments (`hledger.keepUnsupportedAsComments`) and hinted.
 */
export function importHledger(
  journal: string,
  settings: EntrypadSettings = defaultSettings(),
  options: HledgerOptions = {},
): HledgerImport {
  const chart = options.chart ?? usGaapIntroChart;
  const findings: Finding[] = [];
  const keep = settings.hledger.keepUnsupportedAsComments;
  const blocks: string[] = [];
  let comments: string[] = [];
  let entry: Entry | undefined;
  let mode: "none" | "entry" | "unsupported" | "comment-block" = "none";
  let previousYear: number | undefined;
  let count = 0;
  const currentYear = (options.today ?? new Date()).getFullYear();
  const ctx: EntryContext = { chart, settings };
  const at = (line: SourceLine, from = 0, to = line.text.length): SourceRange => ({ from: line.from + from, to: line.from + to });

  const flushComments = () => {
    if (comments.length) blocks.push(comments.join("\n"));
    comments = [];
  };
  const finish = () => {
    if (entry) {
      // hledger's blank amount has no side of its own: it takes whatever
      // balances the transaction. A shorthand blank needs one, so pick it.
      const blanks = entry.lines.filter((l) => l.blank);
      if (blanks.length === 1) {
        let net = 0;
        for (const l of entry.lines) if (!l.blank) net += l.side === "dr" ? l.amount : -l.amount;
        blanks[0]!.side = net > 0 ? "cr" : "dr";
      }
      // Comments just above a transaction, or inside it, stay with it.
      blocks.push([...comments, formatEntry(entry, ctx)].join("\n"));
      comments = [];
      if (entry.date) ctx.previousYear = +entry.date.slice(0, 4);
    }
    entry = undefined;
  };
  const unsupported = (line: SourceLine, what: string) => {
    findings.push({
      code: "unsupported-directive",
      message: `${what} isn't used by Entrypad${keep ? ", so it was kept as a comment" : " and was left out"}`,
      source: at(line, line.text.search(/\S/), line.text.trimEnd().length),
    });
    if (keep) comments.push(`# ${line.text.trim()}`);
  };

  for (const line of splitLines(journal)) {
    const text = line.text;
    const trimmed = text.trim();

    if (mode === "comment-block") {
      if (/^end\s+comment\b/i.test(trimmed)) mode = "none";
      else comments.push(trimmed ? `# ${trimmed}` : "#");
      continue;
    }
    if (!trimmed) {
      finish();
      if (mode !== "none") mode = "none";
      flushComments();
      continue;
    }

    const indented = /^[ \t]/.test(text);
    if (!indented) {
      finish();
      mode = "none";
      if (/^[;#*%|]/.test(text)) {
        comments.push(`# ${text.slice(1).trim()}`.trimEnd());
        continue;
      }
      if (/^comment\s*$/i.test(trimmed)) {
        mode = "comment-block";
        continue;
      }
      const date = HEADER_DATE.exec(text);
      if (date) {
        readHeader(line, date);
        continue;
      }
      if (/^[~=]/.test(text)) unsupported(line, text[0] === "~" ? "A periodic transaction" : "An automated transaction");
      else unsupported(line, `The ${trimmed.split(/\s/)[0]} directive`);
      mode = "unsupported";
      continue;
    }

    // Indented lines belong to whatever started above them.
    if (mode === "unsupported") {
      if (keep) comments.push(`# ${trimmed}`);
      continue;
    }
    if (!entry) {
      findings.push({ code: "unreadable-line", message: "This indented line isn't part of a transaction", source: at(line, text.search(/\S/), text.trimEnd().length) });
      continue;
    }
    if (trimmed.startsWith(";") || trimmed.startsWith("#")) {
      comments.push(`# ${trimmed.slice(1).trim()}`.trimEnd());
      continue;
    }
    readPosting(line);
  }
  finish();
  flushComments();

  function readHeader(line: SourceLine, m: RegExpExecArray) {
    count++;
    entry = { id: `e${count}`, lines: [] };
    mode = "entry";
    const [year, month, day] = m[1] ? [+m[1], +m[2]!, +m[3]!] : [previousYear ?? currentYear, +m[4]!, +m[5]!];
    if (isRealDate(year, month, day)) {
      entry.date = isoDate(year, month, day);
      previousYear = year;
    } else {
      findings.push({ code: "invalid-date", message: `"${m[0]}" isn't a real date`, source: at(line, 0, m[0].length) });
    }
    let rest = line.text.slice(m[0].length);
    rest = rest.replace(/^=\S+/, ""); // a secondary date
    const semicolon = rest.indexOf(";");
    const comment = semicolon >= 0 ? rest.slice(semicolon + 1) : "";
    if (semicolon >= 0) rest = rest.slice(0, semicolon);
    rest = rest.trim().replace(/^[*!]\s*/, "").replace(/^\([^)]*\)\s*/, "");
    if (rest) entry.memo = rest.trim();
    const tags = [...comment.matchAll(/([A-Za-z][\w-]*):/g)].map((t) => t[1]!.toLowerCase()).filter((t): t is EntryTag => entryTags.includes(t as EntryTag));
    if (tags.length) entry.tags = [...new Set(tags)];
  }

  function readPosting(line: SourceLine) {
    const text = line.text;
    const start = text.search(/\S/);
    let body = text.slice(start);
    const semicolon = body.indexOf(";");
    if (semicolon >= 0) body = body.slice(0, semicolon);
    body = body.trimEnd().replace(/^[*!]\s+/, "");
    const gap = /\t| {2,}/.exec(body);
    const name = (gap ? body.slice(0, gap.index) : body).trim();
    let amountText = gap ? body.slice(gap.index).trim() : "";
    if (/^[([]/.test(name)) {
      unsupported(line, "A virtual posting");
      return;
    }
    for (const mark of ["=", "@"]) {
      const i = amountText.indexOf(mark);
      if (i >= 0) {
        unsupported(line, mark === "=" ? "A balance assertion" : "A price");
        amountText = amountText.slice(0, i).trim();
      }
    }
    const account = matchHledgerAccount(name, chart, settings);
    const written = settings.hledger.importMatch === "full-name" ? name : name.split(":").pop()!.trim();
    const posting: Line = { account: account?.id ?? written, side: "dr", amount: 0 };
    if (!amountText) posting.blank = true;
    else {
      const amount = readHledgerAmount(amountText, settings);
      if (amount.ok) {
        posting.side = amount.cents < 0 ? "cr" : "dr";
        posting.amount = Math.abs(amount.cents);
      } else {
        const from = start + text.slice(start).indexOf(amountText);
        findings.push({ code: "invalid-amount", message: `"${amountText}" ${amount.problem}`, source: at(line, from, from + amountText.length) });
        posting.blank = true;
      }
    }
    entry!.lines.push(posting);
  }

  const shorthand = blocks.join("\n\n") + (blocks.length ? "\n" : "");
  const book = parse(shorthand, settings, { chart, ...(options.today && { today: options.today }) }).book;
  const diagnostics: Diagnostic[] = [];
  for (const f of findings) {
    const severity = settings.diagnostics[f.code];
    if (severity !== "off") diagnostics.push({ severity, code: f.code, message: f.message, target: { source: f.source } });
  }
  return { text: shorthand, book, diagnostics };
}

/** The name an exported posting uses, following `hledger.exportAccountNames`. */
function exportName(accountId: string, chart: readonly Account[], settings: EntrypadSettings): string {
  const account = chart.find((a) => a.id === accountId);
  if (!account) return accountId;
  return settings.hledger.exportAccountNames === "plain" ? account.name : `${PREFIX[account.type]}:${account.name.toLowerCase()}`;
}

function exportAmount(cents: number, settings: EntrypadSettings): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  // Two decimal places always, so 8,000.00 can't be mistaken for 8.000.
  const text = formatAmount(abs).includes(".") ? formatAmount(abs) : `${formatAmount(abs)}.00`;
  return settings.hledger.exportCurrencySymbol ? `$${sign}${text}` : `${sign}${text}`;
}

const today = (d: Date) => isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());

/**
 * Writes a book as an hledger journal, which ledger also reads. Debits are
 * positive and credits negative. Every transaction needs a date, so an
 * undated entry takes the date of the nearest dated entry above it, then
 * the period start, then today, with a comment saying so.
 */
export function exportHledger(book: Book, settings: EntrypadSettings = defaultSettings(), options: { today?: Date } = {}): string {
  const out: string[] = [];
  if (book.name) out.push(`; ${book.name}`);
  if (book.period) out.push(`; Period ${book.period.start} to ${book.period.end}`);
  if (out.length) out.push("");

  let previous: string | undefined;
  for (const entry of book.entries) {
    let date = entry.date;
    let note = "";
    if (!date) {
      date = previous ?? book.period?.start ?? today(options.today ?? new Date());
      note = "undated in Entrypad";
    }
    if (entry.date) previous = entry.date;
    const memo = entry.memo ?? (entry.id === OPENING_ENTRY_ID ? "Opening balances" : "");
    const comment = [note, ...(entry.tags ?? []).map((t) => `${t}:`)].filter(Boolean).join(", ");
    out.push(`${date}${memo ? ` ${memo}` : ""}${comment ? `  ; ${comment}` : ""}`);

    const names = entry.lines.map((l) => exportName(l.account, book.chart, settings));
    const width = Math.max(...names.map((n) => n.length), 0) + 2;
    entry.lines.forEach((l, i) => {
      const unfilled = l.blank && !l.inferred;
      const signed = l.side === "dr" ? l.amount : -l.amount;
      out.push(unfilled ? `    ${names[i]}` : `    ${names[i]!.padEnd(width)}${exportAmount(signed, settings)}`);
    });
    out.push("");
  }
  return out.join("\n");
}
