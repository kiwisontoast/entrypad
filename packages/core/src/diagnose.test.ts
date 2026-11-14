import { describe, expect, it } from "vitest";
import { bookRules, diagnose } from "./diagnose.js";
import { editEntry } from "./edit.js";
import { parse } from "./parse/parse.js";
import type { Rule } from "./rules.js";
import { defaultSettings, setSetting } from "./settings.js";
import type { SettingValue } from "./settings.js";
import type { Book } from "./types.js";

const today = new Date(2026, 5, 1);
const s = (key?: string, value?: SettingValue) =>
  key === undefined ? defaultSettings() : setSetting(defaultSettings(), key, value!);
const check = (text: string, settings = s()) => {
  const { book } = parse(text, settings, { today });
  return { book, findings: diagnose(book, settings) };
};
const codes = (text: string, settings = s()) => check(text, settings).findings.map((d) => d.code);
const slice = (text: string, r?: { from: number; to: number }) => (r ? text.slice(r.from, r.to) : undefined);

const clean = `book "B" period 2026-01-01..2026-01-31
open Cash 1,000
open Common Stock 1,000

Jan 1 Owner invests
  Cash 10,000
      Common Stock 10,000

Jan 15 Bill a client
  Accounts Receivable 3,000
      Service Revenue 3,000
`;

describe("diagnose", () => {
  it("finds nothing in a correct book", () => {
    expect(check(clean).findings).toEqual([]);
  });

  it("never changes the book", () => {
    const { book } = parse("Jan 1 x\n  Cash 100\n    Common Stock 90\n");
    const before = JSON.stringify(book);
    diagnose(book);
    expect(JSON.stringify(book)).toBe(before);
  });

  it("covers every rule in the plan, each with a code in the settings registry", () => {
    expect(bookRules.map((r) => r.code)).toEqual([
      "unbalanced-entry",
      "unknown-account",
      "single-line-entry",
      "ambiguous-blank",
      "abnormal-balance",
      "odd-side",
      "zero-amount",
      "inferred-amount",
      "outside-period",
    ]);
    for (const r of bookRules) expect(defaultSettings().diagnostics).toHaveProperty(r.code, r.severity);
  });

  it("takes severities from the settings, and off removes a rule's findings", () => {
    const text = "Jan 1 x\n  Cash 100\n    Common Stock 90\n";
    expect(check(text).findings[0]!.severity).toBe("error");
    expect(check(text, s("diagnostics.unbalanced-entry", "warning")).findings[0]!.severity).toBe("warning");
    expect(codes(text, s("diagnostics.unbalanced-entry", "off"))).toEqual([]);
  });

  it("returns findings in text order", () => {
    const text = "Jan 1 x\n  Cash 100\n    Comon Stock 100\n\nJan 2 y\n  Cash 0\n    Common Stock 0\n";
    expect(codes(text)).toEqual(["unknown-account", "zero-amount", "zero-amount"]);
  });

  it("runs a pack's own rules, at their own default severity", () => {
    const bigEntries: Rule<Book> = {
      code: "large-entry",
      severity: "hint",
      check: (book) => book.entries.filter((e) => e.lines.some((l) => l.amount >= 1_000_000)).map((e) => ({ message: "Large", target: { entry: e.id } })),
    };
    const { book } = parse(clean);
    const findings = diagnose(book, defaultSettings(), [...bookRules, bigEntries]);
    expect(findings.map((d) => [d.code, d.severity, d.target.entry])).toEqual([["large-entry", "hint", "e1"]]);
  });
});

describe("unbalanced-entry", () => {
  it("states both totals", () => {
    const text = "Jan 1 x\n  Equipment 5,000\n    Cash 4,500\n";
    const d = check(text).findings[0]!;
    expect(d).toMatchObject({ code: "unbalanced-entry", severity: "error", message: "Debits ($5,000) don't equal credits ($4,500)" });
    expect(d.target.entry).toBe("e1");
    expect(slice(text, d.target.source)).toBe(text.trimEnd());
  });

  it("offers to put the difference on a side's only line", () => {
    const { book, findings } = check("Jan 3 x\n  Equipment 8,000\n      Cash 4,000\n      Notes Payable 4,500\n");
    const d = findings[0]!;
    expect(d.fixes!.map((f) => f.label)).toEqual(["Put the difference on line 1: Equipment $8,500"]);
    const fixed = d.fixes![0]!.apply(book);
    expect(fixed.entries[0]!.lines[0]!.amount).toBe(850_000);
    expect(diagnose(fixed).map((f) => f.code)).not.toContain("unbalanced-entry");
    expect(book.entries[0]!.lines[0]!.amount).toBe(800_000);
  });

  it("offers both lines of a two-line entry, but not one that would go to zero or below", () => {
    expect(check("Jan 1 x\n  Cash 100\n    Common Stock 90\n").findings[0]!.fixes!.map((f) => f.label)).toEqual([
      "Put the difference on line 1: Cash $90",
      "Put the difference on line 2: Common Stock $100",
    ]);
    const zero = check("Jan 1 x\n  Cash 0\n    Common Stock 100\n").findings.find((f) => f.code === "unbalanced-entry")!;
    expect(zero.fixes!.map((f) => f.label)).toEqual(["Put the difference on line 1: Cash $100"]);
  });

  it("offers no fix when several lines on each side could explain it", () => {
    const d = check("Jan 1 x\n  Cash 100\n  Supplies 50\n    Common Stock 100\n    Notes Payable 40\n").findings[0]!;
    expect(d.fixes).toBeUndefined();
  });

  it("flags a blank amount that would have to be zero or negative", () => {
    const d = check("Jan 3 x\n  Cash 100\n      Common Stock 100\n      Service Revenue\n").findings;
    expect(d.map((f) => f.code)).toEqual(["unbalanced-entry"]);
    expect(d[0]!.message).toContain("can't be filled in");
  });

  it("flags a blank amount left unfilled because inference is off", () => {
    const d = check("Jan 3 x\n  Cash 100\n      Service Revenue\n", s("autofix.inferBlankAmount", false)).findings;
    expect(d.map((f) => f.code)).toEqual(["unbalanced-entry"]);
    expect(d[0]!.message).toContain("turned off");
  });

  it("flags opening balances that don't balance", () => {
    expect(codes("open Cash 5,000\nopen Common Stock 4,000\n")).toEqual(["unbalanced-entry"]);
  });

  it("checks amounts with cents exactly", () => {
    expect(codes("Jan 1 x\n  Cash 0.10\n  Supplies 0.20\n    Common Stock 0.30\n")).toEqual([]);
  });
});

describe("unknown-account", () => {
  it("underlines the name and offers the nearest accounts", () => {
    const text = "Jan 1 x\n  Cash 100\n    Comon Stock 100\n";
    const { book, findings } = check(text);
    const d = findings[0]!;
    expect(d.message).toBe('"Comon Stock" isn\'t in the chart of accounts');
    expect(slice(text, d.target.source)).toBe("Comon Stock");
    expect(d.fixes![0]!.label).toBe("Change to Common Stock");
    expect(diagnose(d.fixes![0]!.apply(book))).toEqual([]);
  });

  it("offers no fixes when suggestions are turned off", () => {
    const d = check("Jan 1 x\n  Cash 100\n    Comon Stock 100\n", s("autofix.suggestNearestAccount", false)).findings[0]!;
    expect(d.fixes).toBeUndefined();
  });
});

describe("single-line-entry and ambiguous-blank", () => {
  it("flags an entry with one line or none, without also calling it unbalanced", () => {
    expect(codes("Jan 1 x\n  Cash 100\n")).toEqual(["single-line-entry"]);
    expect(codes("Jan 1 x\n")).toEqual(["single-line-entry"]);
  });

  it("flags each blank when there are several", () => {
    const text = "Jan 3 x\n  Equipment 8,000\n      Cash\n      Notes Payable\n";
    const d = check(text).findings;
    expect(d.map((f) => [f.code, slice(text, f.target.source)])).toEqual([
      ["ambiguous-blank", "Cash"],
      ["ambiguous-blank", "Notes Payable"],
    ]);
    expect(d[0]!.message).toBe("Only one amount in an entry can be left blank, and this entry has 2");
  });
});

describe("abnormal-balance", () => {
  it("flags an overdrawn account at the posting that overdrew it", () => {
    const text = "Jan 1 a\n  Cash 100\n    Common Stock 100\n\nJan 2 b\n  Rent Expense 300\n    Cash 300\n";
    const d = check(text).findings;
    expect(d.map((f) => f.code)).toEqual(["abnormal-balance"]);
    expect(d[0]!.message).toBe("Cash has a credit balance of $200, but its normal balance is a debit");
    expect(d[0]!.target).toMatchObject({ account: "cash", entry: "e2", line: 1 });
    expect(slice(text, d[0]!.target.source)).toBe("Cash");
  });

  it("understands contra accounts' normal side", () => {
    expect(codes("Jan 1 x\n  Depreciation Expense 200\n    Accumulated Depreciation, Equipment 200\n")).toEqual([]);
    expect(codes("Jan 1 x\n  Accumulated Depreciation, Equipment 200\n    Cash 200\n")).toContain("abnormal-balance");
  });
});

describe("odd-side", () => {
  it("flags revenue debited and expenses credited outside closing", () => {
    const text = "Jan 1 x\n  Service Revenue 100\n    Cash 100\n";
    const d = check(text).findings.filter((f) => f.code === "odd-side");
    expect(d[0]!.message).toBe("Service Revenue is debited here. Revenue accounts are usually only debited when closing the books.");
    expect(codes("Jan 1 x\n  Cash 100\n    Rent Expense 100\n")).toContain("odd-side");
  });

  it("accepts them in a closing entry", () => {
    expect(codes("Jan 31 Close revenue [closing]\n  Service Revenue 100\n    Retained Earnings 100\n")).not.toContain("odd-side");
  });
});

describe("zero-amount, inferred-amount and outside-period", () => {
  it("flags a zero amount", () => {
    const text = "Jan 1 x\n  Cash 0\n    Common Stock 0\n";
    const d = check(text).findings;
    expect(d.map((f) => [f.code, f.severity, slice(text, f.target.source)])).toEqual([
      ["zero-amount", "warning", "0"],
      ["zero-amount", "warning", "0"],
    ]);
  });

  it("hints at a filled-in amount and offers to write it in", () => {
    const text = "Jan 15 Bill a client\n  Accounts Receivable 3,000\n      Service Revenue\n";
    const { book, findings } = check(text);
    const d = findings[0]!;
    expect(d).toMatchObject({ code: "inferred-amount", severity: "hint", message: "Filled in as $3,000 to balance the entry" });
    expect(slice(text, d.target.source)).toBe("Service Revenue");
    const fixed = d.fixes![0]!.apply(book);
    expect(fixed.entries[0]!.lines[1]).toEqual({ account: "service-revenue", side: "cr", amount: 300_000, source: book.entries[0]!.lines[1]!.source });
    expect(diagnose(fixed)).toEqual([]);
  });

  it("hints at an entry dated outside the period", () => {
    const d = check('book "B" period 2026-01-01..2026-01-31\n\n2026-02-03 x\n  Cash 1\n    Common Stock 1\n').findings[0]!;
    expect(d).toMatchObject({ code: "outside-period", severity: "hint" });
    expect(d.message).toBe("This entry is dated Feb 3, 2026, outside the book's period (Jan 1, 2026 to Jan 31, 2026)");
  });
});

describe("fixes in the editor", () => {
  it("flow back into the text through editEntry", () => {
    const text = "# My notes\nJan 15 Bill a client\n  Accounts Receivable 3,000\n      Service Revenue\n\nJan 16 y\n  Cash 1\n    Comon Stock 1\n";
    const { book, findings } = check(text);
    let out = text;
    for (const d of findings) {
      const fixed = d.fixes![0]!.apply(book);
      const entry = fixed.entries.find((e) => e.id === d.target.entry)!;
      out = editEntry(out, entry.id, entry);
    }
    expect(out).toBe("# My notes\nJan 15 Bill a client\n  Accounts Receivable  3,000\n      Service Revenue         3,000\n\nJan 16 y\n  Cash              1\n      Common Stock     1\n");
    expect(check(out).findings).toEqual([]);
  });
});
