import { matchAccount } from "./accounts.js";
import { usGaapIntroChart } from "./charts/usGaapIntro.js";
import type { Diagnostic, DiagnosticCode } from "./diagnostics.js";
import { formatAmount, formatEntry } from "./format.js";
import type { EntryContext } from "./format.js";
import { looksLikeAmount, parseAmount } from "./parse/amount.js";
import { inferYear, isoDate, isRealDate, readDateMark } from "./parse/date.js";
import { parse } from "./parse/parse.js";
import { normalizeSpaces } from "./parse/text.js";
import { defaultSettings } from "./settings.js";
import type { EntrypadSettings } from "./settings.js";
import type { Account, Book, Entry, Line, Side, SourceRange } from "./types.js";

/** What a column of pasted rows can hold. */
export type RowField = "date" | "ref" | "account" | "memo" | "debit" | "credit" | "amount" | "side";

/** Which column (zero-based) holds each field. A field that is absent isn't in the rows. */
export type RowMapping = Partial<Record<RowField, number>>;

export type RowDelimiter = "\t" | "," | ";";

export type RowGrouping = "ref" | "blank-rows" | "date-and-memo";

/** Something about the columns that the person importing should confirm before the rows go in. */
export interface RowAmbiguity {
  kind: "no-header" | "unknown-column" | "duplicate-field" | "missing-field" | "conflicting-fields";
  /** Zero-based columns involved, if any. */
  columns: number[];
  field?: RowField;
  /** Shown to the user. */
  message: string;
}

export interface RowImport {
  /** The rows as Entrypad shorthand: from here on, this text is the book. */
  text: string;
  book: Book;
  /** Rows that couldn't be read, located in the text that was given. */
  diagnostics: Diagnostic[];
  delimiter: RowDelimiter;
  /** Every row's cells as read, header and blank rows included, for a preview. */
  rows: string[][];
  /** Index into `rows` of the header row, if one was found. */
  headerRow?: number;
  /** The header text of each column, or "" when there is none. */
  columns: string[];
  mapping: RowMapping;
  /** Empty when the mapping is clear; otherwise worth showing before importing. */
  ambiguous: RowAmbiguity[];
  grouping: RowGrouping;
}

export interface RowImportOptions {
  /** Use these columns instead of detecting them from the header. */
  mapping?: RowMapping;
  /** Whether the first row is a header. Detected when left out. */
  header?: boolean;
  chart?: readonly Account[];
  /** The period of the book the rows go into, for dates written without a year. */
  period?: { start: string; end: string };
  today?: Date;
}

/** Header names, after `headerKey`, and the field each one means. American spellings: people type these. */
const HEADER_NAMES: Record<string, RowField> = {};
const names = (field: RowField, list: string[]) => list.forEach((n) => (HEADER_NAMES[n] = field));
names("date", ["date", "entry date", "posting date", "post date", "transaction date", "trans date", "txn date", "journal date", "gl date", "effective date"]);
names("ref", [
  "ref", "ref no", "reference", "reference no", "reference number", "entry", "entry no", "entry number", "entry id",
  "je", "je no", "je number", "je id", "journal entry", "journal entry no", "journal entry number", "journal no",
  "journal number", "transaction no", "transaction number", "transaction id", "txn no", "txn id", "voucher", "voucher no",
  "no", "number", "id",
]);
names("account", ["account", "accounts", "account name", "account title", "account titles", "acct", "acct name", "gl account", "gl account name", "ledger account"]);
names("memo", ["memo", "description", "desc", "explanation", "narration", "narrative", "details", "line memo", "line description", "comment", "comments", "note", "notes"]);
names("debit", ["debit", "debits", "dr", "debit amount", "debit amt", "dr amount"]);
names("credit", ["credit", "credits", "cr", "credit amount", "credit amt", "cr amount"]);
names("amount", ["amount", "amt", "value", "net amount"]);
names("side", ["dr cr", "cr dr", "debit credit", "credit debit", "debit or credit", "dr or cr", "drcr", "dc", "d c", "side"]);

const FIELD_NAMES: Record<RowField, string> = {
  date: "Date",
  ref: "Ref",
  account: "Account",
  memo: "Memo",
  debit: "Debit",
  credit: "Credit",
  amount: "Amount",
  side: "Dr/Cr",
};

/** Case and punctuation don't matter, `#` reads as "no", and a trailing USD is dropped: `JE #` is `je no`. */
export function headerKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/#/g, " no ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/ usd$/, "");
}

interface Cell {
  text: string;
  from: number;
  to: number;
}

interface RawRow {
  cells: Cell[];
  from: number;
  to: number;
  unclosedQuote?: boolean;
}

const BOM = "﻿";

/** Picks the delimiter from the first line that has one: a tab, then whichever of `;` and `,` is more common. */
function detectDelimiter(text: string, start: number): RowDelimiter {
  let quoted = false;
  const counts = { "\t": 0, ",": 0, ";": 0 };
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\t" || ch === "," || ch === ";")) counts[ch]++;
    else if (!quoted && ch === "\n") {
      if (counts["\t"] || counts[","] || counts[";"]) break;
    }
  }
  if (counts["\t"]) return "\t";
  return counts[";"] > counts[","] ? ";" : ",";
}

/**
 * Reads delimited text as RFC 4180 describes: a field in double quotes can
 * hold the delimiter, line breaks and doubled quotes. Spaces before an
 * opening quote are allowed, as people type them by hand.
 */
function readRows(text: string, delimiter: RowDelimiter, start: number): RawRow[] {
  const rows: RawRow[] = [];
  const n = text.length;
  if (start >= n) return rows;
  const endOfField = (i: number) => i >= n || text[i] === delimiter || text[i] === "\n" || text[i] === "\r";
  let i = start;
  let row: RawRow = { cells: [], from: i, to: i };
  for (;;) {
    const from = i;
    let value = "";
    let j = i;
    while (text[j] === " ") j++;
    if (text[j] === '"') {
      i = j + 1;
      let closed = false;
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        value += text[i++];
      }
      if (!closed) row.unclosedQuote = true;
      while (!endOfField(i)) value += text[i++];
    } else {
      while (!endOfField(i)) value += text[i++];
    }
    row.cells.push({ text: value, from, to: i });
    if (i < n && text[i] === delimiter) {
      i++;
      continue;
    }
    row.to = i;
    rows.push(row);
    if (text[i] === "\r") i++;
    if (text[i] === "\n") i++;
    if (i >= n) break;
    row = { cells: [], from: i, to: i };
  }
  return rows;
}

const clean = (text: string) => normalizeSpaces(text).replace(/\s+/g, " ").trim();

type CellAmount = { kind: "empty" } | { kind: "ok"; cents: number; negative: boolean } | { kind: "bad"; problem: string };

/** Reads an amount cell such as `$10,000`, `(450)`, `10,000.00` or `-450`. A lone `-`, as Excel shows zero, is empty. */
function readAmountCell(text: string, settings: EntrypadSettings): CellAmount {
  const t = text.replace(/\s+/g, "").replace(/^USD|USD$/i, "");
  if (t === "" || /^\(?\$?-+\)?$/.test(t)) return { kind: "empty" };
  const read = parseAmount(t, settings);
  if (!read.ok) return { kind: "bad", problem: read.problem };
  return { kind: "ok", cents: read.cents, negative: read.negative };
}

const looksLikeAmountCell = (text: string) => looksLikeAmount(text.replace(/\s+/g, "").replace(/^USD|USD$/i, ""));

function readSideCell(text: string): Side | undefined {
  const t = text.toLowerCase().replace(/[^a-z]/g, "");
  if (["dr", "debit", "debits", "d"].includes(t)) return "dr";
  if (["cr", "credit", "credits", "c"].includes(t)) return "cr";
  return undefined;
}

const isDateCell = (text: string, settings: EntrypadSettings) => {
  const mark = readDateMark(text, settings);
  return !!mark && mark.kind === "date" && mark.length === text.length;
};

/** A header row has a known column name and no cell that reads as a date or an amount. */
function isHeaderRow(cells: string[], settings: EntrypadSettings): boolean {
  return (
    cells.some((c) => HEADER_NAMES[headerKey(c)] !== undefined) &&
    !cells.some((c) => c && (looksLikeAmountCell(c) || isDateCell(c, settings)))
  );
}

const isBlank = (cells: string[]) => cells.every((c) => c === "");

/** Rows above the header are read as titles; it is looked for among the first few rows only. */
const HEADER_SEARCH = 10;

function mappingFromHeader(header: string[], data: string[][], ambiguous: RowAmbiguity[], label: (c: number) => string): RowMapping {
  const mapping: RowMapping = {};
  header.forEach((name, c) => {
    const field = HEADER_NAMES[headerKey(name)];
    if (field === undefined) {
      if (name || data.some((r) => r[c])) {
        ambiguous.push({ kind: "unknown-column", columns: [c], message: `${label(c)} isn't a column Entrypad knows, so it was left out` });
      }
      return;
    }
    const first = mapping[field];
    if (first === undefined) mapping[field] = c;
    else {
      ambiguous.push({
        kind: "duplicate-field",
        columns: [first, c],
        field,
        message: `${label(first)} and ${label(c)} both look like the ${FIELD_NAMES[field]} column, so only the first was used`,
      });
    }
  });
  return mapping;
}

/** Without a header, columns are guessed from what they hold. */
function mappingFromContents(data: string[][], width: number, chart: readonly Account[], settings: EntrypadSettings): RowMapping {
  type Kind = "empty" | "date" | "number" | "integer" | "side" | "text";
  const kinds: Kind[] = [];
  for (let c = 0; c < width; c++) {
    const values = data.map((r) => r[c] ?? "").filter(Boolean);
    let kind: Kind = "text";
    if (!values.length) kind = "empty";
    else if (values.every((v) => isDateCell(v, settings))) kind = "date";
    else if (values.every((v) => /^[0-9]+$/.test(v))) kind = "integer";
    else if (values.every((v) => looksLikeAmountCell(v) || readAmountCell(v, settings).kind === "empty")) kind = "number";
    else if (values.every((v) => readSideCell(v))) kind = "side";
    kinds.push(kind);
  }
  const mapping: RowMapping = {};
  const columnsOf = (kind: Kind) => kinds.flatMap((k, c) => (k === kind ? [c] : []));
  const dates = columnsOf("date");
  if (dates.length) mapping.date = dates[0]!;
  const sides = columnsOf("side");
  if (sides.length) mapping.side = sides[0]!;

  const texts = columnsOf("text");
  const matches = (c: number) => data.filter((r) => r[c] && matchAccount(r[c]!, chart, settings)).length;
  let account: number | undefined;
  for (const c of texts) if (account === undefined || matches(c) > matches(account)) account = c;
  if (account !== undefined) mapping.account = account;
  const memo = texts.find((c) => c !== account);
  if (memo !== undefined) mapping.memo = memo;

  // A column of whole numbers before the account is a reference; after it, an amount.
  const numbers: number[] = [];
  for (const c of kinds.flatMap((k, c) => (k === "integer" || k === "number" ? [c] : []))) {
    if (kinds[c] === "integer" && mapping.ref === undefined && (account === undefined || c < account)) mapping.ref = c;
    else numbers.push(c);
  }
  if (numbers.length === 1 || (numbers.length && mapping.side !== undefined)) mapping.amount = numbers[0]!;
  else if (numbers.length >= 2) [mapping.debit, mapping.credit] = [numbers[0]!, numbers[1]!];
  return mapping;
}

/** Checks that a mapping can be read, and drops what can't be used together. */
function checkMapping(mapping: RowMapping, ambiguous: RowAmbiguity[], label: (c: number) => string) {
  const missing = (field: RowField, message: string) => ambiguous.push({ kind: "missing-field", columns: [], field, message });
  if (mapping.account === undefined) missing("account", "There is no Account column");
  const pair = mapping.debit !== undefined || mapping.credit !== undefined;
  if (pair) {
    if (mapping.debit === undefined) missing("debit", "There is a Credit column but no Debit column");
    if (mapping.credit === undefined) missing("credit", "There is a Debit column but no Credit column");
    for (const field of ["amount", "side"] as const) {
      const c = mapping[field];
      if (c === undefined) continue;
      ambiguous.push({
        kind: "conflicting-fields",
        columns: [c],
        field,
        message: `${label(c)} was left out, because the Debit and Credit columns give the amounts`,
      });
      delete mapping[field];
    }
  } else if (mapping.amount === undefined) {
    missing("amount", "There is no Debit, Credit or Amount column");
  }
}

interface Finding {
  code: DiagnosticCode;
  message: string;
  source: SourceRange;
}

/** A row once its cells have been read. */
interface ReadRow {
  number: number;
  source: SourceRange;
  date?: string;
  /** The date as compared for grouping: the ISO date, or the text when it couldn't be read. */
  dateKey: string;
  ref: string;
  memo: string;
  line?: Line;
  /** False when the line has no amount and nothing said which side it is on. */
  sideKnown: boolean;
}

/**
 * Reads the shorthand back as a book. Dates were written for a book with the
 * given period, so they are read inside one, with ranges into `shorthand`.
 */
function readBack(shorthand: string, settings: EntrypadSettings, chart: readonly Account[], options: RowImportOptions): Book {
  const prefix = options.period ? `book "" period ${options.period.start}..${options.period.end}\n` : "";
  const book = parse(prefix + shorthand, settings, { chart, ...(options.today && { today: options.today }) }).book;
  if (!prefix) return book;
  delete book.name;
  const shift = (r: SourceRange): SourceRange => ({ from: r.from - prefix.length, to: r.to - prefix.length });
  book.entries = book.entries.map((e) => ({
    ...e,
    ...(e.source && { source: shift(e.source) }),
    lines: e.lines.map((l) =>
      l.source
        ? { ...l, source: { line: shift(l.source.line), account: shift(l.source.account), ...(l.source.amount && { amount: shift(l.source.amount) }) } }
        : l,
    ),
  }));
  return book;
}

/**
 * Turns rows pasted from a spreadsheet, or read from a `.csv` or `.tsv`
 * file, into Entrypad shorthand. Columns are found by their header names,
 * rows are grouped into entries (`spreadsheet.groupRows`), and the entries
 * are written by the formatter. Never throws: a row that can't be read is
 * reported and left out, and the rest are imported.
 */
export function importRows(text: string, settings: EntrypadSettings = defaultSettings(), options: RowImportOptions = {}): RowImport {
  const chart = options.chart ?? usGaapIntroChart;
  const findings: Finding[] = [];
  const ambiguous: RowAmbiguity[] = [];
  const start = text.startsWith(BOM) ? 1 : 0;
  const delimiter = detectDelimiter(text, start);
  const raw = readRows(text, delimiter, start);
  const rows = raw.map((r) => r.cells.map((c) => clean(c.text)));
  const width = Math.max(0, ...rows.map((r) => r.length));

  /** Row numbers with a finding already. */
  const reported = new Set<number>();
  for (const [i, r] of raw.entries()) {
    if (r.unclosedQuote) {
      reported.add(i + 1);
      findings.push({ code: "unreadable-line", message: `Row ${i + 1} has a quote that isn't closed, so the rest of the text was read as one cell`, source: { from: r.from, to: r.to } });
    }
  }

  // The header, if there is one.
  let headerRow: number | undefined;
  const firstFilled = rows.findIndex((r) => !isBlank(r));
  if (options.header === true) {
    if (firstFilled >= 0) headerRow = firstFilled;
  } else if (options.header === undefined) {
    let seen = 0;
    for (let i = 0; i < rows.length && seen < HEADER_SEARCH; i++) {
      if (isBlank(rows[i]!)) continue;
      seen++;
      if (isHeaderRow(rows[i]!, settings)) {
        headerRow = i;
        break;
      }
    }
  }
  const header = headerRow === undefined ? [] : rows[headerRow]!;
  const columns = Array.from({ length: width }, (_, c) => header[c] ?? "");
  const label = (c: number) => (columns[c] ? `The "${columns[c]}" column` : `Column ${c + 1}`);
  const firstData = headerRow === undefined ? 0 : headerRow + 1;
  const data = rows.slice(firstData);

  let mapping: RowMapping;
  if (options.mapping) {
    mapping = {};
    for (const [field, c] of Object.entries(options.mapping) as [RowField, number | undefined][]) {
      if (c !== undefined && Number.isInteger(c) && c >= 0) mapping[field] = c;
    }
  } else if (headerRow !== undefined) {
    mapping = mappingFromHeader(columns, data, ambiguous, label);
  } else {
    mapping = mappingFromContents(data, width, chart, settings);
    if (data.some((r) => !isBlank(r))) {
      ambiguous.push({ kind: "no-header", columns: [], message: "The rows have no header, so the columns were guessed from what they hold" });
    }
  }
  checkMapping(mapping, ambiguous, label);

  // Read each row.
  const read: (ReadRow | "blank")[] = [];
  let previousDate: { iso?: string; key: string } | undefined;
  let previousYear: number | undefined;
  const currentYear = (options.today ?? new Date()).getFullYear();
  for (let i = firstData; i < raw.length; i++) {
    const cells = rows[i]!;
    if (isBlank(cells)) {
      read.push("blank");
      continue;
    }
    const number = i + 1;
    const rawRow = raw[i]!;
    const cell = (field: RowField) => (mapping[field] === undefined ? "" : (cells[mapping[field]!] ?? ""));
    const at = (field: RowField): SourceRange => {
      const c = mapping[field] === undefined ? undefined : rawRow.cells[mapping[field]!];
      return c ? { from: c.from, to: c.to } : { from: rawRow.from, to: rawRow.to };
    };
    const report = (code: DiagnosticCode, message: string, source: SourceRange = { from: rawRow.from, to: rawRow.to }) => {
      findings.push({ code, message: `Row ${number}${message}`, source });
      reported.add(number);
    };

    // A blank date cell means the same date as the row above.
    const dateText = cell("date");
    let date = previousDate;
    if (dateText && dateText !== "-") {
      const mark = readDateMark(dateText, settings);
      if (!mark || mark.kind !== "date" || mark.length !== dateText.length) {
        report("invalid-date", `: "${dateText}" isn't a date`, at("date"));
        date = { key: dateText };
      } else {
        const year = mark.year ?? inferYear(mark.month, mark.day, { ...(options.period && { period: options.period }), ...(previousYear !== undefined && { previousYear }), currentYear }, settings);
        if (isRealDate(year, mark.month, mark.day)) {
          date = { iso: isoDate(year, mark.month, mark.day), key: isoDate(year, mark.month, mark.day) };
          previousYear = year;
        } else {
          report("invalid-date", `: "${dateText}" isn't a real date`, at("date"));
          date = { key: dateText };
        }
      }
    }
    previousDate = date;

    const row: ReadRow = {
      number,
      source: { from: rawRow.from, to: rawRow.to },
      ...(date?.iso && { date: date.iso }),
      dateKey: date?.key ?? "",
      ref: cell("ref"),
      memo: cell("memo"),
      sideKnown: true,
    };

    // The amount and its side.
    let side: Side | undefined;
    let amount: number | undefined;
    const take = (field: RowField, value: CellAmount, onSide: Side | undefined): void => {
      if (value.kind === "empty") return;
      if (value.kind === "bad") {
        report("invalid-amount", `: "${cell(field)}" ${value.problem}`, at(field));
        side = onSide;
        return;
      }
      if (value.negative && onSide) {
        const rule = settings.parsing.negativeAmounts;
        if (rule === "invalid") {
          report("invalid-amount", `: "${cell(field)}" is negative`, at(field));
          side = onSide;
          return;
        }
        side = rule === "same-side" ? onSide : onSide === "dr" ? "cr" : "dr";
        report("negative-amount", `: "${cell(field)}" is negative, so it was read as ${formatAmount(value.cents)} on the ${side === "dr" ? "debit" : "credit"} side`, at(field));
      } else if (onSide) {
        side = onSide;
      } else {
        const negativeSide: Side = settings.spreadsheet.amountSigns === "negative-credit" ? "cr" : "dr";
        side = value.negative ? negativeSide : negativeSide === "cr" ? "dr" : "cr";
      }
      amount = value.cents;
    };

    if (mapping.debit !== undefined || mapping.credit !== undefined) {
      const debit = readAmountCell(cell("debit"), settings);
      const credit = readAmountCell(cell("credit"), settings);
      const zero = (v: CellAmount) => v.kind === "ok" && v.cents === 0;
      const used = (v: CellAmount) => v.kind !== "empty";
      if (used(debit) && used(credit) && !zero(debit) && !zero(credit)) {
        report("unreadable-line", " has both a debit and a credit, so it was left out");
        read.push(row);
        continue;
      }
      if (used(debit) && !(zero(debit) && used(credit))) take("debit", debit, "dr");
      else take("credit", credit, "cr");
    } else if (mapping.amount !== undefined) {
      const sideText = cell("side");
      let onSide: Side | undefined;
      if (sideText) {
        onSide = readSideCell(sideText);
        if (!onSide) report("unreadable-line", `: "${sideText}" isn't Dr or Cr, so the amount's sign was used`, at("side"));
      }
      take("amount", readAmountCell(cell("amount"), settings), onSide);
    }

    const account = cell("account");
    if (account) {
      const matched = matchAccount(account, chart, settings);
      const line: Line = { account: matched?.id ?? account, side: side ?? "dr", amount: amount ?? 0 };
      if (amount === undefined) line.blank = true;
      row.line = line;
      row.sideKnown = side !== undefined;
    } else if (amount !== undefined) {
      report("unreadable-line", " has an amount but no account, so it was left out");
    }
    read.push(row);
  }

  // Group the rows into entries.
  const filled = read.filter((r): r is ReadRow => r !== "blank");
  const choice = settings.spreadsheet.groupRows;
  const firstRow = read.findIndex((r) => r !== "blank");
  let lastRow = read.length - 1;
  while (lastRow >= 0 && read[lastRow] === "blank") lastRow--;
  const hasBlankRows = read.some((r, i) => r === "blank" && i > firstRow && i < lastRow);
  const grouping: RowGrouping =
    choice === "auto" && mapping.ref !== undefined && filled.some((r) => r.ref)
      ? "ref"
      : choice !== "date-and-memo" && hasBlankRows
        ? "blank-rows"
        : "date-and-memo";

  const groups: ReadRow[][] = [];
  let current: ReadRow[] | undefined;
  const byRef = new Map<string, ReadRow[]>();
  for (const r of read) {
    if (r === "blank") {
      if (grouping === "blank-rows") current = undefined;
      continue;
    }
    if (grouping === "ref" && r.ref) {
      current = byRef.get(r.ref);
      if (!current) groups.push((current = []));
      byRef.set(r.ref, current);
    } else if (grouping === "date-and-memo" && current) {
      const memo = current.find((x) => x.memo)?.memo;
      if (r.dateKey !== current[0]!.dateKey || (r.memo && memo && r.memo !== memo)) current = undefined;
    }
    if (!current) groups.push((current = []));
    current.push(r);
  }

  // Write each entry.
  const ctx: EntryContext = { chart, settings, ...(options.period && { period: options.period }) };
  const comment = settings.parsing.hashComments ? "#" : settings.parsing.semicolonComments ? ";" : undefined;
  const blocks: string[] = [];
  let count = 0;
  for (const group of groups) {
    const lined = group.filter((r) => r.line);
    if (!lined.length) {
      for (const r of group.filter((r) => !reported.has(r.number))) {
        findings.push({ code: "unreadable-line", message: `Row ${r.number} has no account or amount, so it was left out`, source: r.source });
      }
      continue;
    }
    const memos = [...new Set(group.map((r) => r.memo).filter(Boolean))];
    const entry: Entry = { id: `e${++count}`, lines: lined.map((r) => r.line!) };
    const date = group.find((r) => r.date)?.date;
    if (date) entry.date = date;
    if (memos[0]) entry.memo = memos[0];

    // A line with no amount and no side takes the side that balances the entry.
    const unsided = lined.filter((r) => !r.sideKnown);
    if (unsided.length === 1) {
      let net = 0;
      for (const l of entry.lines) if (!l.blank) net += l.side === "dr" ? l.amount : -l.amount;
      unsided[0]!.line!.side = net > 0 ? "cr" : "dr";
    }

    // Memos of later rows have no place in the shorthand, so they are kept as comments.
    const notes = comment ? memos.slice(1).map((m) => `${comment} ${m}`) : [];
    blocks.push([...notes, formatEntry(entry, ctx)].join("\n"));
    if (entry.date) ctx.previousYear = +entry.date.slice(0, 4);
  }

  const shorthand = blocks.join("\n\n") + (blocks.length ? "\n" : "");
  const book = readBack(shorthand, settings, chart, options);
  const diagnostics: Diagnostic[] = [];
  findings.sort((a, b) => a.source.from - b.source.from);
  for (const f of findings) {
    const severity = settings.diagnostics[f.code];
    if (severity !== "off") diagnostics.push({ severity, code: f.code, message: f.message, target: { source: f.source } });
  }
  return {
    text: shorthand,
    book,
    diagnostics,
    delimiter,
    rows,
    ...(headerRow !== undefined && { headerRow }),
    columns,
    mapping,
    ambiguous,
    grouping,
  };
}
