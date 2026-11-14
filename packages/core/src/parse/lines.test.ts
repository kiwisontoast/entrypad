import { describe, expect, it } from "vitest";
import { defaultSettings, setSetting } from "../settings.js";
import type { SettingValue } from "../settings.js";
import { looksLikeAmount, parseAmount } from "./amount.js";
import { classifyLine } from "./classify.js";
import { inferYear, readDateMark, readFullDate } from "./date.js";
import { parse } from "./parse.js";
import { indentOf, splitLines } from "./text.js";

const s = (key?: string, value?: SettingValue) =>
  key === undefined ? defaultSettings() : setSetting(defaultSettings(), key, value!);
const today = new Date(2030, 5, 1);

describe("splitLines", () => {
  it("accepts LF and CRLF endings and keeps offsets into the original text", () => {
    const text = "a\r\nbc\n\nd";
    const lines = splitLines(text);
    expect(lines.map((l) => l.text)).toEqual(["a", "bc", "", "d"]);
    for (const l of lines) expect(text.slice(l.from, l.to)).toBe(l.text);
  });

  it("gives an empty file one blank line", () => {
    expect(splitLines("")).toEqual([{ index: 0, text: "", from: 0, to: 0 }]);
  });
});

describe("indentOf", () => {
  it("advances a tab to the next multiple of the tab width", () => {
    expect(indentOf("\tCash", 4)).toEqual({ column: 4, start: 1 });
    expect(indentOf("  \tCash", 4)).toEqual({ column: 4, start: 3 });
    expect(indentOf("    \tCash", 4)).toEqual({ column: 8, start: 5 });
    expect(indentOf("\tCash", 2)).toEqual({ column: 2, start: 1 });
    expect(indentOf("Cash", 4)).toEqual({ column: 0, start: 0 });
  });
});

describe("classifyLine", () => {
  const kind = (text: string, settings = s()) => classifyLine({ index: 0, text, from: 0, to: text.length }, settings).kind;

  it("recognises each kind of line in the spec's table", () => {
    expect(kind("")).toBe("blank");
    expect(kind(" \t ")).toBe("blank");
    expect(kind("# Sunrise Bakery")).toBe("comment");
    expect(kind("   ; hledger style")).toBe("comment");
    expect(kind("Jan 1  Owner invests cash")).toBe("header");
    expect(kind("2026-01-03 Buy oven")).toBe("header");
    expect(kind("1/3 Buy oven")).toBe("header");
    expect(kind("- Undated entry")).toBe("header");
    expect(kind("-")).toBe("header");
    expect(kind('book "Sunrise Bakery"')).toBe("directive");
    expect(kind("open Cash 5,000")).toBe("directive");
    expect(kind('account "Delivery Vans" asset')).toBe("directive");
    expect(kind("show equation")).toBe("directive");
    expect(kind("set parsing.tabWidth 2")).toBe("directive");
    expect(kind("  Cash   10,000")).toBe("posting");
    expect(kind("Cash 10,000")).toBe("posting");
  });

  it("needs headers and directives to start at the first column", () => {
    expect(kind("  Jan 1 Owner invests")).toBe("posting");
    expect(kind("  show equation")).toBe("posting");
  });

  it("needs a space after a directive word or a dash", () => {
    expect(kind("Openings 100")).toBe("posting");
    expect(kind("-5 Cash")).toBe("posting");
    expect(kind("show")).toBe("posting");
  });

  it("treats a date-shaped header that names no real day as a header", () => {
    expect(kind("Feb 30 Pay rent")).toBe("header");
    expect(kind("13/45 Pay rent")).toBe("header");
  });

  it("honours the comment settings", () => {
    expect(kind("# note", s("parsing.hashComments", false))).toBe("posting");
    expect(kind("; note", s("parsing.semicolonComments", false))).toBe("posting");
  });

  it("strips end-of-line comments only when they are turned on", () => {
    const line = (text: string, settings: ReturnType<typeof s>) =>
      classifyLine({ index: 0, text, from: 0, to: text.length }, settings);
    const text = "Jan 1 Invoice #12";
    expect(line(text, s()).end).toBe(text.length);
    const on = s("parsing.endOfLineComments", true);
    expect(line(text, on).end).toBe("Jan 1 Invoice".length);
    expect(line('  "Cash #2" 100 ; note', on).end).toBe('  "Cash #2" 100'.length);
    expect(line("  # all comment", on).kind).toBe("comment");
  });

  it("reads non-breaking spaces as spaces unless that is turned off", () => {
    const text = "  Cash 100";
    const on = classifyLine({ index: 0, text, from: 0, to: text.length }, s());
    expect(on.column).toBe(2);
    expect(on.text).toBe("  Cash 100");
    const off = classifyLine({ index: 0, text, from: 0, to: text.length }, s("parsing.normalizeSpaces", false));
    expect(off.column).toBe(0);
  });
});

describe("parseAmount", () => {
  const cents = (word: string, settings = s()) => {
    const r = parseAmount(word, settings);
    return r.ok ? r.cents : r.problem;
  };

  it("reads every form in the spec's amounts table", () => {
    expect(cents("10000")).toBe(1_000_000);
    expect(cents("10,000")).toBe(1_000_000);
    expect(cents("$10,000")).toBe(1_000_000);
    expect(cents("1,200.50")).toBe(120_050);
    expect(cents("10k")).toBe(1_000_000);
    expect(cents("2.5k")).toBe(250_000);
    expect(cents("2.5K")).toBe(250_000);
  });

  it("reads cents exactly, with no floating-point rounding", () => {
    expect(cents("0.29")).toBe(29);
    expect(cents("1.1")).toBe(110);
    expect(cents("1234567.89")).toBe(123_456_789);
    expect(cents("1.23456k")).toBe(123_456);
  });

  it("rejects more than two decimal places, also after multiplying by 1,000", () => {
    expect(cents("12.345")).toBe("has more than two decimal places");
    expect(cents("1.234567k")).toBe("has more than two decimal places once multiplied by 1,000");
  });

  it("rejects misplaced commas", () => {
    expect(cents("1,00,0")).toBe("has misplaced commas");
    expect(cents("10,00")).toBe("has misplaced commas");
    expect(cents(",100")).toBe("isn't a number");
  });

  it("reports negative and parenthesised amounts with their size", () => {
    expect(parseAmount("-500", s())).toEqual({ ok: true, cents: 50_000, negative: true });
    expect(parseAmount("(500)", s())).toEqual({ ok: true, cents: 50_000, negative: true });
    expect(parseAmount("$-500", s())).toEqual({ ok: true, cents: 50_000, negative: true });
    expect(parseAmount("-$500", s())).toEqual({ ok: true, cents: 50_000, negative: true });
    expect(cents("(500")).toBe("has an unmatched parenthesis");
  });

  it("refuses k when parsing.thousandsSuffix is off", () => {
    expect(cents("10k", s("parsing.thousandsSuffix", false))).toBe("uses k for thousands, which is turned off");
  });

  it("refuses amounts too large to hold exactly", () => {
    expect(cents("999999999999999999")).toBe("is too large");
  });

  it("tells amounts from words", () => {
    for (const w of ["100", "$1,000", "1,00,0", "12.345", "10k", "(5)", "-3"]) expect(looksLikeAmount(w), w).toBe(true);
    for (const w of ["Cash", "Notes", "k", "$", "-", "2027a", "A/R"]) expect(looksLikeAmount(w), w).toBe(false);
  });
});

describe("readDateMark", () => {
  const read = (text: string, settings = s()) => readDateMark(text, settings);

  it("reads month names, slashes and ISO dates", () => {
    expect(read("Jan 3 Buy oven")).toMatchObject({ month: 1, day: 3, length: 5 });
    expect(read("january 3")).toMatchObject({ month: 1, day: 3 });
    expect(read("Sept 30 x")).toMatchObject({ month: 9, day: 30 });
    expect(read("Jan 3, 2026 Buy oven")).toMatchObject({ year: 2026, month: 1, day: 3, length: 11 });
    expect(read("1/3 Buy oven")).toMatchObject({ month: 1, day: 3 });
    expect(read("1/3/2026")).toMatchObject({ year: 2026, month: 1, day: 3 });
    expect(read("2026-01-03 x")).toMatchObject({ year: 2026, month: 1, day: 3, length: 10 });
    expect(read("- x")).toEqual({ kind: "dash", length: 1 });
  });

  it("reads 1/3 month first by default and day first when set", () => {
    expect(read("1/3", s("parsing.dateOrder", "day-first"))).toMatchObject({ month: 3, day: 1 });
  });

  it("ignores text that only starts like a date", () => {
    expect(read("Janitor 3")).toBeUndefined();
    expect(read("1/3x")).toBeUndefined();
    expect(read("Cash 100")).toBeUndefined();
  });

  it("reads a complete date only when it has a year and nothing else", () => {
    expect(readFullDate("2026-01-31", s())).toEqual({ year: 2026, month: 1, day: 31 });
    expect(readFullDate("Jan 31, 2026", s())).toEqual({ year: 2026, month: 1, day: 31 });
    expect(readFullDate("Jan 31", s())).toBeUndefined();
    expect(readFullDate("2026-01-31 x", s())).toBeUndefined();
  });
});

describe("inferYear", () => {
  const fiscal = { start: "2025-07-01", end: "2026-06-30" };

  it("takes the year that puts the date inside the period", () => {
    expect(inferYear(8, 1, { period: fiscal, currentYear: 2030 }, s())).toBe(2025);
    expect(inferYear(3, 1, { period: fiscal, currentYear: 2030 }, s())).toBe(2026);
  });

  it("otherwise takes the year of the entry above, then the period's first year, then the current year", () => {
    const jan = { start: "2026-01-01", end: "2026-01-31" };
    expect(inferYear(3, 1, { period: jan, previousYear: 2027, currentYear: 2030 }, s())).toBe(2027);
    expect(inferYear(3, 1, { period: jan, currentYear: 2030 }, s())).toBe(2026);
    expect(inferYear(3, 1, { previousYear: 2027, currentYear: 2030 }, s())).toBe(2027);
    expect(inferYear(3, 1, { currentYear: 2030 }, s())).toBe(2030);
  });

  it("honours the yearFrom settings", () => {
    const ctx = { period: fiscal, previousYear: 2020, currentYear: 2030 };
    expect(inferYear(8, 1, ctx, s("parsing.yearFromPeriod", false))).toBe(2020);
    const neither = setSetting(s("parsing.yearFromPeriod", false), "parsing.yearFromPreviousEntry", false);
    expect(inferYear(8, 1, ctx, neither)).toBe(2030);
  });
});

describe("parse, line level", () => {
  const codes = (text: string, settings = s()) => parse(text, settings, { today }).diagnostics.map((d) => d.code);

  it("reads headers into dated entries with memos", () => {
    const { book } = parse(
      'book "Sunrise Bakery" period 2026-01-01..2026-01-31\n\nJan 1  Owner invests cash\n\n2026-01-03 Buy oven\n\n- Undated\n',
      s(),
      { today },
    );
    expect(book.name).toBe("Sunrise Bakery");
    expect(book.period).toEqual({ start: "2026-01-01", end: "2026-01-31" });
    expect(book.entries.map((e) => [e.date, e.memo])).toEqual([
      ["2026-01-01", "Owner invests cash"],
      ["2026-01-03", "Buy oven"],
      [undefined, "Undated"],
    ]);
  });

  it("reads the period even when the book line comes after the entries", () => {
    const { book } = parse('Aug 1 x\n\nbook "Fiscal" period 2025-07-01..2026-06-30\n', s(), { today });
    expect(book.entries[0]!.date).toBe("2025-08-01");
  });

  it("takes a missing year from the entry above, then the current year", () => {
    const { book } = parse("Mar 1 x\n\nJan 5, 2027 y\n\nFeb 2 z\n", s(), { today });
    expect(book.entries.map((e) => e.date)).toEqual(["2030-03-01", "2027-01-05", "2027-02-02"]);
  });

  it("flags Feb 30 as invalid-date and keeps the entry, undated", () => {
    const text = "Feb 30 Pay rent\n";
    const r = parse(text, s(), { today });
    expect(r.book.entries).toHaveLength(1);
    expect(r.book.entries[0]!.date).toBeUndefined();
    expect(r.book.entries[0]!.memo).toBe("Pay rent");
    const d = r.diagnostics[0]!;
    expect(d.code).toBe("invalid-date");
    expect(d.severity).toBe("error");
    expect(text.slice(d.target.source!.from, d.target.source!.to)).toBe("Feb 30");
  });

  it("checks leap years once the year is known", () => {
    expect(codes('book "B" period 2028-01-01..2028-12-31\nFeb 29 x\n')).toEqual([]);
    expect(codes('book "B" period 2026-01-01..2026-12-31\nFeb 29 x\n')).toEqual(["invalid-date"]);
  });

  it("flags a posting line before the first entry as unreadable", () => {
    const text = "# notes\n  Cash 100\n";
    const r = parse(text, s(), { today });
    expect(r.diagnostics.map((d) => d.code)).toEqual(["unreadable-line"]);
    const src = r.diagnostics[0]!.target.source!;
    expect(text.slice(src.from, src.to)).toBe("Cash 100");
  });

  it("reads set lines wherever they sit and applies them to the whole file", () => {
    const r = parse("1/3 x\n\nset parsing.dateOrder day-first\n", s(), { today });
    expect(r.settings).toEqual({ "parsing.dateOrder": "day-first" });
    expect(r.resolved.parsing.dateOrder).toBe("day-first");
    expect(r.book.entries[0]!.date).toBe("2030-03-01");
  });

  it("lets a set line turn a check off", () => {
    expect(codes("set diagnostics.invalid-date off\nFeb 30 x\n")).toEqual([]);
    const r = parse("set diagnostics.invalid-date warning\nFeb 30 x\n", s(), { today });
    expect(r.diagnostics[0]!.severity).toBe("warning");
  });

  it("flags unknown settings, bad values and personal settings", () => {
    expect(codes("set parsing.nonsense on\n")).toEqual(["unknown-setting"]);
    expect(codes("set parsing.tabWidth 99\n")).toEqual(["unknown-setting"]);
    expect(codes("set display.touchScroll off\n")).toEqual(["unknown-setting"]);
    expect(codes("set parsing.tabWidth\n")).toEqual(["unknown-setting"]);
  });

  it("flags duplicate book lines and keeps the last by default", () => {
    const text = 'book "One"\nbook "Two"\n';
    const r = parse(text, s(), { today });
    expect(r.book.name).toBe("Two");
    expect(r.diagnostics.map((d) => d.code)).toEqual(["duplicate-book"]);
    expect(parse(text, s("parsing.duplicateBook", "first-wins"), { today }).book.name).toBe("One");
  });

  it("flags a period that can't be read or runs backwards", () => {
    expect(codes('book "B" period 2026-01-01..Jan 31\n')).toEqual(["invalid-date"]);
    expect(codes('book "B" period 2026-02-30..2026-03-31\n')).toEqual(["invalid-date"]);
    expect(codes('book "B" period 2026-02-01..2026-01-01\n')).toEqual(["invalid-date"]);
    expect(codes('book "B" period Jan 1, 2026..Jan 31, 2026\n')).toEqual([]);
  });

  it("uses book.decimals for the book's display settings", () => {
    expect(parse("set book.decimals 2\n").book.settings.decimals).toBe(2);
  });

  it("never throws, whatever the input", () => {
    const junk = ["\u0000", "book", 'book "', "set", "Feb", "-\t-", "\r\r\n", "((((", "Jan 99999999", "set  x  y z"];
    for (const text of junk) expect(() => parse(text)).not.toThrow();
  });
});
