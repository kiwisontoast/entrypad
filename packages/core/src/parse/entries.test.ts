import { describe, expect, it } from "vitest";
import { defaultSettings, setSetting } from "../settings.js";
import type { SettingValue } from "../settings.js";
import type { Line } from "../types.js";
import { parse } from "./parse.js";

const s = (key?: string, value?: SettingValue) =>
  key === undefined ? defaultSettings() : setSetting(defaultSettings(), key, value!);
const today = new Date(2026, 5, 1);
const read = (text: string, settings = s()) => parse(text, settings, { today });
const codes = (text: string, settings = s()) => read(text, settings).diagnostics.map((d) => d.code);
const summary = (lines: Line[]) => lines.map((l) => `${l.side} ${l.account} ${l.amount / 100}`);
const slice = (text: string, r?: { from: number; to: number }) => (r ? text.slice(r.from, r.to) : undefined);

describe("posting lines", () => {
  it("reads flush-left lines as debits and lines indented further as credits", () => {
    const { book, diagnostics } = read("Jan 1 Owner invests\n  Cash   10,000\n      Common Stock   10,000\n");
    expect(diagnostics).toEqual([]);
    expect(summary(book.entries[0]!.lines)).toEqual(["dr cash 10000", "cr common-stock 10000"]);
  });

  it("measures indentation against the first posting line, which can start at the first column", () => {
    const { book } = read("Jan 1 x\nCash 100\n  Common Stock 100\n");
    expect(summary(book.entries[0]!.lines)).toEqual(["dr cash 100", "cr common-stock 100"]);
  });

  it("reads several debits and several credits", () => {
    const { book } = read("Jan 3 x\n  Equipment 8,000\n      Cash 4,000\n      Notes Payable 4,000\n");
    expect(summary(book.entries[0]!.lines)).toEqual(["dr equipment 8000", "cr cash 4000", "cr notes-payable 4000"]);
  });

  it("expands tabs before comparing indentation", () => {
    const { book } = read("Jan 1 x\n  Cash 100\n\tCommon Stock 100\n");
    expect(book.entries[0]!.lines[1]!.side).toBe("cr");
    const narrow = read("Jan 1 x\n  Cash 100\n\tCommon Stock 100\n", s("parsing.tabWidth", 2));
    expect(narrow.book.entries[0]!.lines[1]!.side).toBe("dr");
  });

  it("lets dr and cr override indentation, in any case", () => {
    const { book } = read("Jan 3 Buy oven\ndr Equipment 8,000\ncr Cash 4,000\nCR Notes Payable 4,000\n");
    expect(summary(book.entries[0]!.lines)).toEqual(["dr equipment 8000", "cr cash 4000", "cr notes-payable 4000"]);
  });

  it("keeps an unknown account as written", () => {
    const { book, diagnostics } = read("Jan 1 x\n  Delivery Vans 100\n    Cash 100\n");
    expect(diagnostics).toEqual([]);
    expect(book.entries[0]!.lines[0]!.account).toBe("Delivery Vans");
  });

  it("reads quoted names, so a name can end in a number", () => {
    const { book } = read('Jan 1 x\n  Cash 5,000\n    "Series 2027 Notes" 5,000\n');
    expect(book.entries[0]!.lines[1]).toMatchObject({ account: "Series 2027 Notes", amount: 500_000 });
  });

  it("records separate ranges for the account and the amount", () => {
    const text = "Jan 1 x\n  Cash   10,000\n    cr Common Stock 10k\n";
    const [cash, stock] = read(text).book.entries[0]!.lines;
    expect(slice(text, cash!.source!.line)).toBe("Cash   10,000");
    expect(slice(text, cash!.source!.account)).toBe("Cash");
    expect(slice(text, cash!.source!.amount)).toBe("10,000");
    expect(slice(text, stock!.source!.line)).toBe("cr Common Stock 10k");
    expect(slice(text, stock!.source!.account)).toBe("Common Stock");
  });

  it("gives the entry a range from its header to its last posting", () => {
    const text = "# c\nJan 1 x\n  Cash 100\n    Common Stock 100   \n\n";
    const e = read(text).book.entries[0]!;
    expect(slice(text, e.source)).toBe("Jan 1 x\n  Cash 100\n    Common Stock 100");
  });
});

describe("grouping lines into entries", () => {
  it("ends an entry at a blank line, a header or a directive, but not at a comment", () => {
    const { book } = read(
      "Jan 1 a\n  Cash 1\n  # note\n    Common Stock 1\nJan 2 b\n  Cash 2\n    Common Stock 2\nshow equation\n  Cash 3\n",
    );
    expect(book.entries.map((e) => e.lines.length)).toEqual([2, 2]);
  });

  it("flags lines after a blank line as outside any entry", () => {
    expect(codes("Jan 1 a\n  Cash 1\n\n    Common Stock 1\n")).toEqual(["unreadable-line"]);
  });

  it("lets an entry run past blank lines when parsing.blankLineEndsEntry is off", () => {
    const r = read("Jan 1 a\n  Cash 1\n\n    Common Stock 1\n", s("parsing.blankLineEndsEntry", false));
    expect(r.diagnostics).toEqual([]);
    expect(r.book.entries[0]!.lines).toHaveLength(2);
  });

  it("numbers entries e1, e2 and so on in file order", () => {
    expect(read("Jan 1 a\n\n- b\n\nJan 3 c\n").book.entries.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });
});

describe("tags", () => {
  it("reads one tag per bracket pair or several separated by commas", () => {
    expect(read("Jan 31 Record depreciation   [adjusting]\n").book.entries[0]).toMatchObject({
      memo: "Record depreciation",
      tags: ["adjusting"],
    });
    expect(read("Jan 31 x [adjusting] [Operating]\n").book.entries[0]!.tags).toEqual(["adjusting", "operating"]);
    expect(read("Jan 31 x [adjusting, operating]\n").book.entries[0]!.tags).toEqual(["adjusting", "operating"]);
  });

  it("flags an unknown tag and keeps the others", () => {
    const text = "Jan 31 x [adjusting, quarterly]\n";
    const r = read(text);
    expect(r.book.entries[0]!.tags).toEqual(["adjusting"]);
    expect(r.diagnostics.map((d) => [d.code, slice(text, d.target.source)])).toEqual([["unknown-tag", "quarterly"]]);
  });

  it("leaves brackets in the middle of a memo alone", () => {
    expect(read("Jan 31 Pay [vendor] invoice\n").book.entries[0]).toMatchObject({ memo: "Pay [vendor] invoice" });
  });
});

describe("the one-line form", () => {
  it("reads debits before the slash and credits after it", () => {
    const { book, diagnostics } = read("Jan 1 Owner invests: Cash 10000 / Common Stock 10000\n");
    expect(diagnostics).toEqual([]);
    expect(book.entries[0]!.memo).toBe("Owner invests");
    expect(summary(book.entries[0]!.lines)).toEqual(["dr cash 10000", "cr common-stock 10000"]);
  });

  it("reads tags before the colon and commas between postings", () => {
    const e = read("Jan 3 Buy oven [investing]: Equipment 8000 / Cash 4000, Notes Payable 4000\n").book.entries[0]!;
    expect(e.memo).toBe("Buy oven");
    expect(e.tags).toEqual(["investing"]);
    expect(summary(e.lines)).toEqual(["dr equipment 8000", "cr cash 4000", "cr notes-payable 4000"]);
  });

  it("keeps a comma inside an account name when the word before it isn't an amount", () => {
    const e = read("Jan 31 Depreciation: Depreciation Expense 200 / Accumulated Depreciation, Equipment 200\n").book.entries[0]!;
    expect(summary(e.lines)).toEqual(["dr depreciation-expense 200", "cr accumulated-depreciation-equipment 200"]);
  });

  it("splits at every comma when parsing.oneLineCommas is always", () => {
    const e = read("Jan 3 x: Equipment 8000 / Cash, Notes Payable 4000\n", s("parsing.oneLineCommas", "always")).book.entries[0]!;
    expect(e.lines.map((l) => l.account)).toEqual(["equipment", "cash", "notes-payable"]);
  });

  it("uses the last colon before the slash, so a memo can contain colons", () => {
    const e = read("Jan 9 Rent: January: Rent Expense 1,200 / Cash 1,200\n").book.entries[0]!;
    expect(e.memo).toBe("Rent: January");
    expect(e.lines).toHaveLength(2);
  });

  it("treats a colon without a slash as part of the memo", () => {
    expect(read("Jan 9 Note: call the bank\n").book.entries[0]!.memo).toBe("Note: call the bank");
  });

  it("infers a blank amount on the last posting of a side", () => {
    const e = read("Jan 15 Bill client: Accounts Receivable 3,000 / Service Revenue\n").book.entries[0]!;
    expect(e.lines[1]).toMatchObject({ amount: 300_000, blank: true, inferred: true });
  });

  it("flags an empty side", () => {
    expect(codes("Jan 1 x: Cash 100 / \n")).toContain("unreadable-line");
  });
});

describe("blank amounts", () => {
  it("fills in the one blank amount that balances the entry", () => {
    const text = "Jan 15 Bill a catering client\n  Accounts Receivable      3,000\n      Service Revenue\n";
    const [ar, revenue] = read(text).book.entries[0]!.lines;
    expect(ar).not.toHaveProperty("blank");
    expect(revenue).toMatchObject({ account: "service-revenue", side: "cr", amount: 300_000, blank: true, inferred: true });
    expect(revenue!.source!.amount).toBeUndefined();
  });

  it("fills in a blank debit too", () => {
    const e = read("Jan 3 x\n  Equipment\n      Cash 4,000\n      Notes Payable 4,000.50\n").book.entries[0]!;
    expect(e.lines[0]).toMatchObject({ amount: 800_050, inferred: true });
  });

  it("leaves two blanks unfilled", () => {
    const e = read("Jan 3 x\n  Equipment 8,000\n      Cash\n      Notes Payable\n").book.entries[0]!;
    expect(e.lines.filter((l) => l.inferred)).toEqual([]);
    expect(e.lines.slice(1).map((l) => [l.blank, l.amount])).toEqual([
      [true, 0],
      [true, 0],
    ]);
  });

  it("leaves the line at 0 when balancing would need zero or a negative amount", () => {
    const e = read("Jan 3 x\n  Cash 100\n  Supplies 50\n      Common Stock 200\n      Service Revenue\n").book.entries[0]!;
    expect(e.lines[3]).toMatchObject({ blank: true, amount: 0 });
    expect(e.lines[3]!.inferred).toBeUndefined();
  });

  it("leaves blanks alone when autofix.inferBlankAmount is off", () => {
    const e = read("Jan 15 x\n  Cash 3,000\n      Service Revenue\n", s("autofix.inferBlankAmount", false)).book.entries[0]!;
    expect(e.lines[1]).toMatchObject({ blank: true, amount: 0 });
  });

  it("treats an unreadable amount as blank, so it can still be filled in", () => {
    const text = "Jan 15 x\n  Cash 3,000\n      Service Revenue 3,00,0\n";
    const r = read(text);
    expect(r.book.entries[0]!.lines[1]).toMatchObject({ blank: true, inferred: true, amount: 300_000 });
    expect(r.diagnostics.map((d) => [d.code, slice(text, d.target.source)])).toEqual([["invalid-amount", "3,00,0"]]);
  });
});

describe("negative amounts", () => {
  const text = "Jan 1 x\n  Cash -500\n    Common Stock 500\n";

  it("reads them on the line's own side by default, and flags them", () => {
    const r = read(text);
    expect(r.book.entries[0]!.lines[0]).toMatchObject({ side: "dr", amount: 50_000 });
    expect(r.diagnostics.map((d) => [d.code, d.severity, slice(text, d.target.source)])).toEqual([["negative-amount", "warning", "-500"]]);
  });

  it("can read them on the other side", () => {
    const r = read(text, s("parsing.negativeAmounts", "other-side"));
    expect(r.book.entries[0]!.lines[0]).toMatchObject({ side: "cr", amount: 50_000 });
    expect(r.diagnostics[0]!.message).toContain("credit side");
  });

  it("can treat them as unreadable", () => {
    const r = read(text, s("parsing.negativeAmounts", "invalid"));
    expect(r.diagnostics.map((d) => d.code)).toEqual(["invalid-amount"]);
    expect(r.book.entries[0]!.lines[0]).toMatchObject({ blank: true });
  });

  it("reads parentheses as negative", () => {
    expect(codes("Jan 1 x\n  Cash (500)\n    Common Stock 500\n")).toEqual(["negative-amount"]);
  });
});

describe("directives", () => {
  it("collects open lines into one opening entry dated the first day of the period", () => {
    const text = 'book "B" period 2026-01-01..2026-01-31\nopen Cash 5,000\nopen Accumulated Depreciation, Equipment 1,200\nopen Cash cr 300\nopen Common Stock 3,500\n';
    const { book, diagnostics } = read(text);
    expect(diagnostics).toEqual([]);
    const opening = book.entries[0]!;
    expect(opening).toMatchObject({ id: "opening", date: "2026-01-01", memo: "Opening balances" });
    expect(summary(opening.lines)).toEqual([
      "dr cash 5000",
      "cr accumulated-depreciation-equipment 1200",
      "cr cash 300",
      "cr common-stock 3500",
    ]);
  });

  it("puts the opening entry first even when open lines come later", () => {
    const { book } = read("Jan 2 x\n  Cash 1\n    Common Stock 1\n\nopen Cash 5\n");
    expect(book.entries.map((e) => e.id)).toEqual(["opening", "e1"]);
    expect(book.entries[0]!.date).toBeUndefined();
  });

  it("flags an open line without an amount", () => {
    expect(codes("open Cash\n")).toEqual(["unreadable-line"]);
  });

  it("adds accounts, with contra, alias and normal options", () => {
    const { book, diagnostics } = read(
      'account "Delivery Vans" asset\naccount "Accumulated Depreciation, Vans" asset contra "Delivery Vans"\naccount "Catering Revenue" revenue alias "Catering"\naccount "Drawings" equity normal debit\n',
    );
    expect(diagnostics).toEqual([]);
    const byName = (n: string) => book.chart.find((a) => a.name === n);
    expect(byName("Delivery Vans")).toEqual({ id: "delivery-vans", name: "Delivery Vans", type: "asset", normal: "debit" });
    expect(byName("Accumulated Depreciation, Vans")).toMatchObject({ contraOf: "delivery-vans", normal: "credit" });
    expect(byName("Catering Revenue")).toMatchObject({ normal: "credit", aliases: ["Catering"] });
    expect(byName("Drawings")).toMatchObject({ type: "equity", normal: "debit" });
  });

  it("lets postings above an account line use the account", () => {
    const { book } = read('Jan 1 x\n  Vans 100\n    Cash 100\n\naccount "Delivery Vans" asset alias "Vans"\n');
    expect(book.entries[0]!.lines[0]!.account).toBe("delivery-vans");
  });

  it("redefines an account already in the chart instead of adding a second one", () => {
    const { book } = read('account "Cash" asset alias "Bank"\nJan 1 x\n  Bank 1\n    Common Stock 1\n');
    expect(book.chart.filter((a) => a.id === "cash")).toEqual([
      { id: "cash", name: "Cash", type: "asset", normal: "debit", group: "current-assets", aliases: ["Bank"] },
    ]);
    expect(book.entries[0]!.lines[0]!.account).toBe("cash");
  });

  it("gives a new account a unique id", () => {
    const { book } = read('account "Cash!" asset\n');
    expect(book.chart.at(-1)!.id).toBe("cash-2");
  });

  it("flags a malformed account line and a contra account that isn't in the chart", () => {
    expect(codes("account Vans asset\n")).toEqual(["unreadable-line"]);
    expect(codes('account "Vans" vehicle\n')).toEqual(["unreadable-line"]);
    expect(codes('account "Vans" asset colour "red"\n')).toEqual(["unreadable-line"]);
    expect(codes('account "AD Vans" asset contra "Vans"\n')).toEqual(["unknown-account"]);
  });

  it("reads show lines with their options", () => {
    const { shows, diagnostics } = read(
      "show t-accounts: Cash, Accumulated Depreciation, Equipment, Notes Payable\nshow equation\nshow cash-flow: indirect\n",
    );
    expect(diagnostics).toEqual([]);
    expect(shows.map(({ visual, options }) => ({ visual, options }))).toEqual([
      { visual: "t-accounts", options: ["Cash", "Accumulated Depreciation, Equipment", "Notes Payable"] },
      { visual: "equation", options: [] },
      { visual: "cash-flow", options: ["indirect"] },
    ]);
  });

  it("flags an unknown visual and keeps it as written", () => {
    const text = "show pie-chart: Cash\n";
    const r = read(text);
    expect(r.shows[0]!.visual).toBe("pie-chart");
    expect(r.diagnostics.map((d) => [d.code, slice(text, d.target.source)])).toEqual([["unknown-visual", "pie-chart"]]);
  });
});

describe("recovery", () => {
  it("skips an unreadable line and still reads the rest of its entry", () => {
    const text = "Jan 1 x\n  Cash 100\n  250\n    Common Stock 100\n";
    const r = read(text);
    expect(r.book.entries[0]!.lines).toHaveLength(2);
    expect(r.diagnostics.map((d) => [d.code, slice(text, d.target.source)])).toEqual([["unreadable-line", "250"]]);
  });

  it("keeps the memo and postings of an entry with a bad date", () => {
    const r = read("Feb 30 Pay rent\n  Rent Expense 1,200\n    Cash 1,200\n");
    expect(r.book.entries[0]).toMatchObject({ memo: "Pay rent" });
    expect(r.book.entries[0]!.date).toBeUndefined();
    expect(r.book.entries[0]!.lines).toHaveLength(2);
  });

  it("flags an unclosed quote", () => {
    expect(codes('Jan 1 x\n  "Cash 100\n    Common Stock 100\n')).toEqual(["unreadable-line"]);
  });

  it("targets each diagnostic at its entry and line", () => {
    const r = read("Jan 1 x\n  Cash 100\n    Common Stock 1.234\n");
    expect(r.diagnostics[0]!.target).toMatchObject({ entry: "e1", line: 1 });
  });

  it("never throws on random input", () => {
    const pieces = ["Jan 1", " ", "  ", "\t", "\n", "Cash", "100", "-", "/", ":", ",", "[", "]", '"', "dr", "open", "show", "account", "set", "book", "k", "$", "(", ")", "1,0"];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    for (let n = 0; n < 500; n++) {
      let text = "";
      for (let i = next() % 40; i > 0; i--) text += pieces[next() % pieces.length];
      expect(() => parse(text), JSON.stringify(text)).not.toThrow();
    }
  });
});
