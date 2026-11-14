import { describe, expect, it } from "vitest";
import { usGaapIntroChart } from "./charts/usGaapIntro.js";
import { editEntry, entryChanges } from "./edit.js";
import { format, formatAmount, quoteName } from "./format.js";
import { accountId, parse } from "./parse/parse.js";
import { defaultSettings, setSetting } from "./settings.js";
import type { Account, Book, Entry, EntryTag, Line } from "./types.js";

const today = new Date(2026, 5, 1);
const read = (text: string) => parse(text, undefined, { today });

const bakery = `# Sunrise Bakery, January
book "Sunrise Bakery" period 2026-01-01..2026-01-31

Jan 1  Owner invests cash
  Cash                    10,000
      Common Stock                 10,000

Jan 3  Buy oven, half cash, half note   [investing]
  Equipment                8,000
      Cash                          4,000
      Notes Payable                 4,000

Jan 9  Pay January rent: Rent Expense 1,200 / Cash 1,200

Jan 15 Bill a catering client
  Accounts Receivable      3,000
      Service Revenue

Jan 31 Record depreciation   [adjusting]
  Depreciation Expense       200
      Accumulated Depreciation, Equipment   200

show t-accounts: Cash, Equipment, Notes Payable
show equation
`;

describe("formatAmount", () => {
  it("writes cents exactly, with decimals only when there are cents", () => {
    expect(formatAmount(1_000_000)).toBe("10,000");
    expect(formatAmount(120_050)).toBe("1,200.50");
    expect(formatAmount(5)).toBe("0.05");
    expect(formatAmount(0)).toBe("0");
  });
});

describe("quoteName", () => {
  it("quotes names that would otherwise be misread", () => {
    expect(quoteName("Cash")).toBe("Cash");
    expect(quoteName("Accumulated Depreciation, Equipment")).toBe("Accumulated Depreciation, Equipment");
    expect(quoteName("Series 2027")).toBe('"Series 2027"');
    expect(quoteName("Cr Union Loan")).toBe('"Cr Union Loan"');
    expect(quoteName("#1 Supplies")).toBe('"#1 Supplies"');
    expect(quoteName("Loan cr", { sideWordLast: true })).toBe('"Loan cr"');
  });
});

describe("format", () => {
  it("writes the spec's example as canonical shorthand", () => {
    const r = read(bakery);
    expect(format(r.book, { shows: r.shows })).toBe(`book "Sunrise Bakery" period 2026-01-01..2026-01-31

Jan 1  Owner invests cash
  Cash              10,000
      Common Stock          10,000

Jan 3  Buy oven, half cash, half note   [investing]
  Equipment          8,000
      Cash                  4,000
      Notes Payable         4,000

Jan 9  Pay January rent
  Rent Expense  1,200
      Cash             1,200

Jan 15 Bill a catering client
  Accounts Receivable  3,000
      Service Revenue

Jan 31 Record depreciation   [adjusting]
  Depreciation Expense                     200
      Accumulated Depreciation, Equipment       200

show t-accounts: Cash, Equipment, Notes Payable
show equation
`);
  });

  it("writes opening balances, custom accounts and file settings", () => {
    const text = `book "B" period 2026-01-01..2026-01-31
set autofix.inferBlankAmount off
account "Delivery Vans" asset alias "Vans"
account "Accumulated Depreciation, Vans" asset contra "Delivery Vans"
account "Cash" asset alias "Bank"
open Cash 5,000
open Accounts Payable dr 100
open Common Stock 5,100
`;
    const r = read(text);
    expect(format(r.book, { settings: r.resolved })).toBe(`book "B" period 2026-01-01..2026-01-31
set autofix.inferBlankAmount off
account "Cash" asset alias "Bank"
account "Delivery Vans" asset alias "Vans"
account "Accumulated Depreciation, Vans" asset contra "Delivery Vans"

open Cash 5,000
open Accounts Payable dr 100
open Common Stock 5,100
`);
  });

  it("spells out every side when an entry starts with a credit", () => {
    const book = read("Jan 1 x\ncr Common Stock 100\ndr Cash 100\n").book;
    const text = format(book);
    expect(text).toContain("  cr Common Stock  100\n  dr Cash          100");
    expect(read(text).book.entries[0]!.lines.map((l) => l.side)).toEqual(["cr", "dr"]);
  });

  it("writes the year only when a reader couldn't infer it", () => {
    const book = read("Mar 1, 2026 a\n\nMar 2 b\n\nJan 5, 2027 c\n\n- d\n\nFeb 1 e\n").book;
    expect(format(book).split("\n").filter((l) => /^\S/.test(l))).toEqual([
      "Mar 1, 2026 a",
      "Mar 2  b",
      "Jan 5, 2027 c",
      "-      d",
      "Feb 1  e",
    ]);
  });

  it("uses CRLF when asked", () => {
    expect(format(read("Jan 1 x\n  Cash 1\n    Common Stock 1\n").book, { newline: "\r\n" })).toContain("\r\n  Cash");
  });
});

/** A small seeded generator, so a failure always reproduces. */
function random(seed: number) {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  return {
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
  };
}

const WORDS = ["Pay", "rent", "Buy", "oven", "Bill", "client", "Owner", "invests", "cash", "January", "supplies", "on", "account", "half", "note"];
const CUSTOM = ["Series 2027 Notes", "Cr Union Loan", "Delivery Vans", "#2 Oven", "Loan dr"];
const TAGS: EntryTag[] = ["adjusting", "closing", "operating", "investing", "financing"];

function randomBook(seed: number): Book {
  const r = random(seed);
  let chart: Account[] = [...usGaapIntroChart];
  for (const name of CUSTOM) {
    if (r.chance(0.3)) chart = [...chart, { id: accountId(name, chart), name, type: r.pick(["asset", "liability", "expense"] as const), normal: "debit" }];
  }
  chart = chart.map((a) => (a.type === "liability" && !usGaapIntroChart.includes(a) ? { ...a, normal: "credit" } : a));
  const period = r.pick([undefined, { start: "2026-01-01", end: "2026-12-31" }, { start: "2025-07-01", end: "2026-06-30" }]);
  const year = () => (period ? +r.pick([period.start, period.end]).slice(0, 4) : r.int(2024, 2027));
  const line = (blank: boolean): Line => ({
    account: r.pick(chart).id,
    side: r.pick(["dr", "cr"] as const),
    amount: blank ? 0 : r.chance(0.3) ? r.int(1, 99_999_999) : r.int(1, 50_000) * 100,
    ...(blank && { blank: true }),
  });
  const entries: Entry[] = [];
  if (r.chance(0.3)) {
    entries.push({ id: "opening", ...(period && { date: period.start }), memo: "Opening balances", lines: Array.from({ length: r.int(1, 3) }, () => line(false)) });
  }
  for (let n = r.int(0, 8), i = 1; i <= n; i++) {
    const blankAt = r.chance(0.2) ? r.int(0, 3) : -1;
    const lines = Array.from({ length: r.int(0, 4) }, (_, k) => line(k === blankAt));
    const memo = Array.from({ length: r.int(0, 4) }, () => r.pick(WORDS)).join(" ");
    const tags = TAGS.filter(() => r.chance(0.15));
    const dated = r.chance(0.9);
    const month = r.int(1, 12);
    const day = r.int(1, 28);
    entries.push({
      id: `e${i}`,
      ...(dated && { date: `${year()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` }),
      ...(memo && { memo }),
      ...(tags.length && { tags }),
      lines,
    });
  }
  return { name: "Generated", chart, entries, ...(period && { period }), settings: { standard: "us-gaap", currency: "USD", decimals: 0 } };
}

const meaning = (book: Book) =>
  book.entries.map((e) => ({
    id: e.id,
    date: e.date,
    memo: e.memo,
    tags: e.tags,
    lines: e.lines.map((l) => ({ account: l.account, side: l.side, amount: l.blank ? null : l.amount })),
  }));

describe("parse after format", () => {
  it("gives back the same book, and formatting it again gives the same text", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const book = randomBook(seed);
      const text = format(book);
      const back = read(text);
      expect(back.diagnostics, `seed ${seed}\n${text}`).toEqual([]);
      expect(meaning(back.book), `seed ${seed}\n${text}`).toEqual(meaning(book));
      expect(back.book.chart).toEqual(book.chart);
      expect(format(back.book), `seed ${seed}`).toBe(text);
    }
  });

  it("is stable for the spec's example", () => {
    const once = format(read(bakery).book);
    expect(format(read(once).book)).toBe(once);
  });
});

describe("editEntry", () => {
  const text = `# Notes at the top
book "B" period 2026-01-01..2026-01-31

Jan 1   Owner invests:   Cash 10000 / Common Stock 10000

# a comment between entries
Jan 3 Buy oven [investing]
  Equipment 8,000
        Cash 4,000
        Notes Payable 4,000

Jan 9 Pay rent: Rent Expense 1200 / Cash 1200
`;

  it("rewrites only the entry it is given", () => {
    const e2 = read(text).book.entries[1]!;
    const moved: Entry = { ...e2, lines: e2.lines.map((l) => (l.account === "notes-payable" ? { ...l, account: "accounts-payable" } : l)) };
    const out = editEntry(text, "e2", moved, undefined, { today });
    const [before, after] = [text.indexOf("Jan 3"), text.indexOf("\n\nJan 9")];
    expect(out.slice(0, before)).toBe(text.slice(0, before));
    expect(out.slice(out.indexOf("\n\nJan 9"))).toBe(text.slice(after));
    expect(out).toContain("Jan 3 Buy oven [investing]\n  Equipment             8,000\n      Cash                     4,000\n      Accounts Payable         4,000\n");
    expect(read(out).book.entries[1]!.lines.map((l) => l.account)).toEqual(["equipment", "cash", "accounts-payable"]);
  });

  it("rewrites the header only when its date, memo or tags change", () => {
    const src = "Jan 3   Buy oven, finally  [investing]\n  Equipment 8,000\n        Cash 8,000\n";
    const e1 = read(src).book.entries[0]!;
    expect(editEntry(src, "e1", e1).split("\n")[0]).toBe("Jan 3   Buy oven, finally  [investing]");
    expect(editEntry(src, "e1", { ...e1, memo: "Buy oven" }).split("\n")[0]).toBe("Jan 3, 2026 Buy oven   [investing]");
    const oneLine = "Jan 9 Pay rent: Rent Expense 1200 / Cash 1200\n";
    const e = read(oneLine).book.entries[0]!;
    expect(read(editEntry(oneLine, "e1", e)).book.entries[0]!.lines).toHaveLength(2);
  });

  it("returns a single change covering the entry, ready for an editor", () => {
    const e1 = read(text).book.entries[0]!;
    const changes = entryChanges(text, "e1", { ...e1, memo: "Owner invests more" });
    expect(changes).toHaveLength(1);
    expect(text.slice(changes[0]!.from, changes[0]!.to)).toBe("Jan 1   Owner invests:   Cash 10000 / Common Stock 10000");
  });

  it("deletes an entry with the blank line after it", () => {
    const out = editEntry(text, "e2", null);
    expect(out).toBe(text.replace("Jan 3 Buy oven [investing]\n  Equipment 8,000\n        Cash 4,000\n        Notes Payable 4,000\n\n", ""));
  });

  it("adds an entry it doesn't find at the end", () => {
    const entry: Entry = { id: "new", date: "2026-01-20", memo: "Buy supplies", lines: [
      { account: "supplies", side: "dr", amount: 30_000 },
      { account: "cash", side: "cr", amount: 30_000 },
    ] };
    const out = editEntry(text, "new", entry);
    expect(out.startsWith(text)).toBe(true);
    expect(out.slice(text.length)).toBe("\nJan 20 Buy supplies\n  Supplies  300\n      Cash       300\n");
    expect(read(out).book.entries).toHaveLength(4);
  });

  it("rewrites scattered open lines where the first one was", () => {
    const src = "open Cash 5,000\n\nJan 1 x\n  Cash 1\n    Common Stock 1\n\nopen Common Stock 5,000\n";
    const opening = read(src).book.entries[0]!;
    const out = editEntry(src, "opening", { ...opening, lines: opening.lines.map((l) => ({ ...l, amount: 600_000 })) });
    expect(out).toBe("open Cash 6,000\nopen Common Stock 6,000\n\nJan 1 x\n  Cash 1\n    Common Stock 1\n\n");
  });

  it("adds opening balances before the first entry when there are none", () => {
    const src = 'book "B"\n\nJan 1 x\n  Cash 1\n    Common Stock 1\n';
    const out = editEntry(src, "opening", { id: "opening", lines: [{ account: "cash", side: "dr", amount: 100 }] });
    expect(out).toBe('book "B"\n\nopen Cash 1\n\nJan 1 x\n  Cash 1\n    Common Stock 1\n');
  });

  it("keeps CRLF line endings", () => {
    const crlf = text.replace(/\n/g, "\r\n");
    const e2 = read(crlf).book.entries[1]!;
    const out = editEntry(crlf, "e2", e2);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("reads the file with its own settings", () => {
    const src = "set parsing.dateOrder day-first\n\n3/1 x\n  Cash 1\n    Common Stock 1\n";
    const e1 = read(src).book.entries[0]!;
    expect(e1.date).toBe("2026-01-03");
    const out = editEntry(src, "e1", e1, setSetting(defaultSettings(), "parsing.tabWidth", 2), { today });
    expect(read(out).book.entries[0]!.date).toBe("2026-01-03");
  });
});
