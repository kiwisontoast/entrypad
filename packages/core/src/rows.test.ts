import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "./parse/parse.js";
import { headerKey, importRows } from "./rows.js";
import type { RowImportOptions } from "./rows.js";
import { defaultSettings, setSetting } from "./settings.js";
import type { SettingValue } from "./settings.js";
import type { Line } from "./types.js";

const today = new Date(2026, 5, 1);
const period = { start: "2026-01-01", end: "2026-12-31" };
const s = (key?: string, value?: SettingValue) =>
  key === undefined ? defaultSettings() : setSetting(defaultSettings(), key, value!);
const summary = (lines: Line[]) => lines.map((l) => `${l.side} ${l.account} ${l.amount / 100}`);
const rows = (text: string, settings = s(), options: RowImportOptions = {}) => importRows(text, settings, { period, today, ...options });
const entries = (text: string, settings = s(), options: RowImportOptions = {}) =>
  rows(text, settings, options).book.entries.map((e) => summary(e.lines));
const codes = (text: string, settings = s()) => rows(text, settings).diagnostics.map((d) => d.code);
const messages = (text: string, settings = s()) => rows(text, settings).diagnostics.map((d) => d.message);

const PLAN = [
  "Date\tRef\tAccount\tDescription\tDebit\tCredit",
  "1/1\t1\tCash\tOwner invests\t10,000\t",
  "1/1\t1\tCommon Stock\t\t\t10,000",
  "1/3\t2\tEquipment\tBuy oven\t8,000\t",
  "1/3\t2\tCash\t\t\t4,000",
  "1/3\t2\tNotes Payable\t\t\t4,000",
].join("\n");
const PLAN_ENTRIES = [
  ["dr cash 10000", "cr common-stock 10000"],
  ["dr equipment 8000", "cr cash 4000", "cr notes-payable 4000"],
];

describe("docs/shorthand.md spreadsheet paste examples", () => {
  const doc = readFileSync(new URL("../../../docs/shorthand.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const blocks = [...doc.matchAll(/^```(\w*)\n([\s\S]*?)^```/gm)].map((m) => ({ lang: m[1]!, text: m[2]! }));
  const pairs = blocks.flatMap((b, i) => (b.lang === "csv" || b.lang === "tsv" ? [{ rows: b.text, shorthand: blocks[i + 1]?.text }] : []));

  it("has examples, each followed by the shorthand it becomes", () => {
    expect(pairs.length).toBeGreaterThanOrEqual(3);
    for (const p of pairs) expect(p.shorthand).toBeDefined();
  });

  pairs.forEach((pair, i) => {
    it(`example ${i + 1}: ${pair.rows.split("\n")[0]}`, () => {
      const r = rows(pair.rows);
      expect(r.diagnostics).toEqual([]);
      expect(r.ambiguous).toEqual([]);
      expect(r.text).toBe(pair.shorthand);
      const back = parse(`book "" period ${period.start}..${period.end}\n${r.text}`, s(), { today });
      expect(back.diagnostics).toEqual([]);
    });
  });
});

describe("importRows: reading the text", () => {
  it("reads the plan's example, pasted from Excel", () => {
    const r = rows(PLAN);
    expect(r.delimiter).toBe("\t");
    expect(r.headerRow).toBe(0);
    expect(r.mapping).toEqual({ date: 0, ref: 1, account: 2, memo: 3, debit: 4, credit: 5 });
    expect(r.grouping).toBe("ref");
    expect(r.book.entries.map((e) => [e.date, e.memo])).toEqual([
      ["2026-01-01", "Owner invests"],
      ["2026-01-03", "Buy oven"],
    ]);
    expect(r.book.entries.map((e) => summary(e.lines))).toEqual(PLAN_ENTRIES);
  });

  it("detects commas and semicolons as separators", () => {
    const csv = "Date,Account,Debit,Credit\n1/5,Cash,100,\n1/5,Service Revenue,,100\n";
    expect(rows(csv).delimiter).toBe(",");
    expect(entries(csv)).toEqual([["dr cash 100", "cr service-revenue 100"]]);
    const ssv = csv.replace(/,/g, ";");
    expect(rows(ssv).delimiter).toBe(";");
    expect(entries(ssv)).toEqual([["dr cash 100", "cr service-revenue 100"]]);
  });

  it("follows RFC 4180 quoting: separators, doubled quotes and line breaks inside quotes", () => {
    const csv = [
      'Date,Account,Memo,Debit,Credit',
      '1/31,Depreciation Expense,"Record ""straight-line""',
      'depreciation",200,',
      '1/31,"Accumulated Depreciation, Equipment",,,"200"',
    ].join("\n");
    const r = rows(csv);
    expect(r.diagnostics).toEqual([]);
    expect(r.book.entries[0]!.memo).toBe('Record "straight-line" depreciation');
    expect(summary(r.book.entries[0]!.lines)).toEqual(["dr depreciation-expense 200", "cr accumulated-depreciation-equipment 200"]);
  });

  it("accepts a byte order mark, CRLF endings, spaces before a quote and trailing empty columns", () => {
    const csv = "﻿Date,Account,Debit,Credit,,\r\n1/5,Cash, \"1,000\",,,\r\n1/5,Service Revenue,,1000,,\r\n";
    const r = rows(csv);
    expect(r.diagnostics).toEqual([]);
    expect(r.ambiguous).toEqual([]);
    expect(r.columns).toEqual(["Date", "Account", "Debit", "Credit", "", ""]);
    expect(summary(r.book.entries[0]!.lines)).toEqual(["dr cash 1000", "cr service-revenue 1000"]);
  });

  it("reports a quote that isn't closed and reads the rest as one cell", () => {
    const r = rows('Date,Account,Debit,Credit\n1/5,Cash,100,\n1/5,"Supplies,,100\n');
    expect(r.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ["unreadable-line", "Row 3 has a quote that isn't closed, so the rest of the text was read as one cell"],
    ]);
  });

  it("returns nothing for empty text, without throwing", () => {
    const r = rows("");
    expect(r.text).toBe("");
    expect(r.book.entries).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });
});

describe("importRows: columns", () => {
  it("matches header names without regard to case, spaces or punctuation", () => {
    expect(headerKey("JE #")).toBe("je no");
    expect(headerKey("Dr.")).toBe("dr");
    expect(headerKey("Debit ($)")).toBe("debit");
    expect(headerKey("Amount (USD)")).toBe("amount");
    const r = rows("posting DATE\tJE #\tAcct\tNarration\tDR\tCR.\n1/5\t7\tCash\tSale\t100\t\n\t7\tSales Revenue\t\t\t100\n");
    expect(r.mapping).toEqual({ date: 0, ref: 1, account: 2, memo: 3, debit: 4, credit: 5 });
    expect(r.ambiguous).toEqual([]);
  });

  it("skips a title above the header", () => {
    const r = rows("Sunrise Bakery\nAccount,Debit,Credit\nCash,5,\nSupplies Expense,,5\n");
    expect(r.headerRow).toBe(1);
    expect(r.ambiguous).toEqual([]);
    expect(entries("Sunrise Bakery\nAccount,Debit,Credit\nCash,5,\nSupplies,,5\n")).toEqual([["dr cash 5", "cr supplies 5"]]);
  });

  it("flags an unknown column and leaves it out", () => {
    const r = rows("Date,Account,Debit,Credit,Department\n1/5,Cash,100,,Retail\n1/5,Service Revenue,,100,Retail\n");
    expect(r.ambiguous.map((a) => [a.kind, a.columns, a.message])).toEqual([
      ["unknown-column", [4], `The "Department" column isn't a column Entrypad knows, so it was left out`],
    ]);
    expect(r.diagnostics).toEqual([]);
  });

  it("flags two columns that both look like Amount, and uses the first", () => {
    const r = rows("Account,Amount,Net Amount\nCash,100,1\nService Revenue,-100,-1\n");
    expect(r.ambiguous.map((a) => [a.kind, a.columns, a.field])).toEqual([["duplicate-field", [1, 2], "amount"]]);
    expect(r.mapping.amount).toBe(1);
    expect(entries("Account,Amount,Net Amount\nCash,100,1\nService Revenue,-100,-1\n")).toEqual([["dr cash 100", "cr service-revenue 100"]]);
  });

  it("flags missing columns", () => {
    expect(rows("Date,Memo,Debit,Credit\n1/5,Sale,1,\n").ambiguous.map((a) => [a.kind, a.field])).toEqual([["missing-field", "account"]]);
    expect(rows("Date,Account\n1/5,Cash\n").ambiguous.map((a) => [a.kind, a.field])).toEqual([["missing-field", "amount"]]);
    expect(rows("Account,Debit\nCash,1\n").ambiguous.map((a) => [a.kind, a.field])).toEqual([["missing-field", "credit"]]);
  });

  it("prefers Debit and Credit over an Amount or Dr/Cr column, and says so", () => {
    const r = rows("Account,Debit,Credit,Amount\nCash,5,,5\nSupplies,,5,-5\n");
    expect(r.ambiguous.map((a) => [a.kind, a.field])).toEqual([["conflicting-fields", "amount"]]);
    expect(r.mapping.amount).toBeUndefined();
  });

  it("guesses the columns when there is no header, and flags that", () => {
    const r = rows(PLAN.split("\n").slice(1).join("\n"));
    expect(r.headerRow).toBeUndefined();
    expect(r.mapping).toEqual({ date: 0, ref: 1, account: 2, memo: 3, debit: 4, credit: 5 });
    expect(r.ambiguous.map((a) => a.kind)).toEqual(["no-header"]);
    expect(r.book.entries.map((e) => summary(e.lines))).toEqual(PLAN_ENTRIES);
  });

  it("guesses an Amount column and a Dr/Cr column without a header", () => {
    const r = rows("1/31,Wages Expense,Dr,500\n1/31,Wages Payable,Cr,500\n");
    expect(r.mapping).toEqual({ date: 0, side: 2, account: 1, amount: 3 });
    expect(r.book.entries.map((e) => summary(e.lines))).toEqual([["dr wages-expense 500", "cr wages-payable 500"]]);
  });

  it("uses an explicit mapping instead of detecting one", () => {
    const text = "Konto;Betrag\nCash;100\nService Revenue;-100\n";
    const detected = rows(text);
    expect(detected.ambiguous.length).toBeGreaterThan(0);
    const r = rows(text, s(), { mapping: { account: 0, amount: 1 }, header: true });
    expect(r.headerRow).toBe(0);
    expect(r.ambiguous).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    expect(r.book.entries.map((e) => summary(e.lines))).toEqual([["dr cash 100", "cr service-revenue 100"]]);
  });

  it("can be told that the first row is data", () => {
    const r = rows("Cash,100\nService Revenue,-100\n", s(), { mapping: { account: 0, amount: 1 }, header: false });
    expect(r.headerRow).toBeUndefined();
    expect(r.book.entries.map((e) => summary(e.lines))).toEqual([["dr cash 100", "cr service-revenue 100"]]);
  });
});

describe("importRows: amounts and sides", () => {
  it("reads $10,000, 10,000.00, (450) and -450 into integer cents", () => {
    const r = rows('Account,Amount\nCash,"$10,000"\nSupplies,"10,000.00"\nCommon Stock,(450)\nNotes Payable,"-19,550"\n');
    expect(r.diagnostics).toEqual([]);
    expect(r.book.entries[0]!.lines.map((l) => [l.side, l.amount])).toEqual([
      ["dr", 1_000_000],
      ["dr", 1_000_000],
      ["cr", 45_000],
      ["cr", 1_955_000],
    ]);
  });

  it("can read negative amounts in a single column as debits instead", () => {
    expect(entries("Account,Amount\nCash,-100\nService Revenue,100\n", s("spreadsheet.amountSigns", "negative-debit"))).toEqual([
      ["dr cash 100", "cr service-revenue 100"],
    ]);
  });

  it("takes the side from a Dr/Cr column, in any spelling", () => {
    expect(entries("Account,D/C,Amount\nCash,debit,100\nService Revenue,C,100\n")).toEqual([["dr cash 100", "cr service-revenue 100"]]);
  });

  it("falls back to the sign when a Dr/Cr cell isn't one, and flags it", () => {
    const text = "Account,Dr/Cr,Amount\nCash,Dr,100\nService Revenue,Out,-100\n";
    expect(entries(text)).toEqual([["dr cash 100", "cr service-revenue 100"]]);
    expect(messages(text)).toEqual([`Row 3: "Out" isn't Dr or Cr, so the amount's sign was used`]);
  });

  it("reads a negative debit or credit by parsing.negativeAmounts", () => {
    const text = "Account,Debit,Credit\nCash,-100,\nService Revenue,-100,\n";
    expect(entries(text)).toEqual([["dr cash 100", "dr service-revenue 100"]]);
    expect(codes(text)).toEqual(["negative-amount", "negative-amount"]);
    expect(messages(text)[0]).toBe(`Row 2: "-100" is negative, so it was read as 100 on the debit side`);
    expect(entries("Account,Debit,Credit\nCash,100,\nService Revenue,-100,\n", s("parsing.negativeAmounts", "other-side"))).toEqual([
      ["dr cash 100", "cr service-revenue 100"],
    ]);
    expect(codes(text, s("parsing.negativeAmounts", "invalid"))).toEqual(["invalid-amount", "invalid-amount"]);
  });

  it("treats Excel's accounting zero and a 0 beside an amount as empty", () => {
    const r = rows('Account,Debit,Credit\nCash," $ -   ",500\nService Revenue,500,0.00\n');
    expect(r.diagnostics).toEqual([]);
    expect(r.book.entries.map((e) => summary(e.lines))).toEqual([["cr cash 500", "dr service-revenue 500"]]);
  });

  it("leaves out a row with both a debit and a credit", () => {
    const text = "Account,Debit,Credit\nCash,100,\nService Revenue,,100\nTotal,100,100\n";
    expect(entries(text)).toEqual([["dr cash 100", "cr service-revenue 100"]]);
    expect(messages(text)).toEqual(["Row 4 has both a debit and a credit, so it was left out"]);
  });

  it("leaves a blank amount to be filled in, on the side that balances the entry", () => {
    const r = rows("Date,Account,Memo,Debit,Credit\n1/15,Accounts Receivable,Bill a client,3000,\n1/15,Service Revenue,,,\n");
    expect(r.diagnostics).toEqual([]);
    expect(r.book.entries[0]!.lines[1]).toMatchObject({ account: "service-revenue", side: "cr", amount: 300_000, inferred: true });
    expect(r.text).toContain("      Service Revenue\n");
  });

  it("flags an amount it can't read, keeping the account", () => {
    const r = rows("Account,Debit,Credit\nCash,\"12,34\",\nService Revenue,,1234.567\n");
    expect(r.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ["invalid-amount", `Row 2: "12,34" has misplaced commas`],
      ["invalid-amount", `Row 3: "1234.567" has more than two decimal places`],
    ]);
    expect(r.book.entries[0]!.lines.map((l) => [l.account, l.side, !!l.blank])).toEqual([
      ["cash", "dr", true],
      ["service-revenue", "cr", true],
    ]);
  });

  it("points each finding at the cell in the text it was given", () => {
    const text = "Account,Debit,Credit\nCash,1x,\n";
    const d = rows(text).diagnostics[0]!;
    expect(text.slice(d.target.source!.from, d.target.source!.to)).toBe("1x");
  });

  it("leaves out a row with an amount but no account", () => {
    const text = "Account,Debit,Credit\nCash,5,\n,,5\nSupplies,,5\n";
    expect(entries(text)).toEqual([["dr cash 5", "cr supplies 5"]]);
    expect(messages(text)).toEqual(["Row 3 has an amount but no account, so it was left out"]);
  });

  it("keeps unknown accounts as written, for the editor to flag", () => {
    const r = rows("Account,Debit,Credit\nDelivery Vans,5,\nCash,,5\n");
    expect(r.book.entries[0]!.lines[0]!.account).toBe("Delivery Vans");
    expect(r.diagnostics).toEqual([]);
  });

  it("uses no floating-point arithmetic: cents add up exactly", () => {
    const r = rows("Account,Debit,Credit\nCash,0.10,\nCash,0.20,\nService Revenue,,0.30\n");
    expect(r.book.entries[0]!.lines.map((l) => l.amount)).toEqual([10, 20, 30]);
  });
});

describe("importRows: dates", () => {
  it("reads month-first dates, takes the year from the period and fills blank cells down", () => {
    const r = rows("Date,Account,Memo,Debit,Credit\n1/3,Equipment,Buy oven,8000,\n,Cash,,,8000\nJan 9,Rent Expense,Pay rent,1200,\n2026-01-09,Cash,,,1200\n");
    expect(r.book.entries.map((e) => [e.date, e.memo])).toEqual([
      ["2026-01-03", "Buy oven"],
      ["2026-01-09", "Pay rent"],
    ]);
  });

  it("follows parsing.dateOrder", () => {
    const r = rows("Date,Account,Amount\n1/3,Cash,5\n1/3,Supplies,-5\n", s("parsing.dateOrder", "day-first"));
    expect(r.book.entries[0]!.date).toBe("2026-03-01");
  });

  it("writes the year when there is no period to imply it", () => {
    const r = importRows("Date,Account,Amount\n1/3,Cash,5\n1/3,Supplies,-5\n", s(), { today });
    expect(r.text.split("\n")[0]).toBe("Jan 3, 2026");
    expect(r.book.entries[0]!.date).toBe("2026-01-03");
  });

  it("flags a date it can't read and leaves the entry undated", () => {
    const text = "Date,Account,Amount\n2/30,Cash,5\n,Supplies,-5\n3/1/26,Cash,1\n,Supplies,-1\n";
    const r = rows(text);
    expect(r.diagnostics.map((d) => d.message)).toEqual([`Row 2: "2/30" isn't a real date`, `Row 4: "3/1/26" isn't a date`]);
    expect(r.book.entries.map((e) => e.date)).toEqual([undefined, undefined]);
  });
});

describe("importRows: grouping", () => {
  it("groups by Ref, joining rows with the same ref wherever they are", () => {
    const text = "Ref,Account,Debit,Credit\n1,Cash,100,\n2,Supplies,5,\n1,Service Revenue,,100\n2,Cash,,5\n";
    expect(entries(text)).toEqual([
      ["dr cash 100", "cr service-revenue 100"],
      ["dr supplies 5", "cr cash 5"],
    ]);
    expect(rows(text).grouping).toBe("ref");
  });

  it("puts a row with an empty Ref cell in the entry above", () => {
    expect(entries("Ref,Account,Debit,Credit\nJE-1,Cash,100,\n,Service Revenue,,100\n")).toEqual([["dr cash 100", "cr service-revenue 100"]]);
  });

  it("groups by blank rows when there is no Ref", () => {
    const text = "Date,Account,Debit,Credit\n1/31,Wages Expense,500,\n1/31,Wages Payable,,500\n\n1/31,Interest Expense,20,\n1/31,Interest Payable,,20\n";
    expect(rows(text).grouping).toBe("blank-rows");
    expect(entries(text)).toHaveLength(2);
  });

  it("groups by a change in date or memo otherwise", () => {
    const text = [
      "Date,Account,Memo,Debit,Credit",
      "1/3,Equipment,Buy oven,800,",
      "1/3,Cash,,,800",
      "1/3,Supplies,Buy flour,50,",
      "1/3,Cash,,,50",
      "1/4,Rent Expense,,10,",
      "1/4,Cash,,,10",
    ].join("\n");
    const r = rows(text);
    expect(r.grouping).toBe("date-and-memo");
    expect(r.book.entries.map((e) => [e.date, e.memo, e.lines.length])).toEqual([
      ["2026-01-03", "Buy oven", 2],
      ["2026-01-03", "Buy flour", 2],
      ["2026-01-04", undefined, 2],
    ]);
  });

  it("can be told to group by blank rows or by date and memo", () => {
    const text = "Ref,Date,Account,Debit,Credit\n1,1/3,Cash,5,\n1,1/4,Supplies,,5\n";
    expect(entries(text)).toHaveLength(1);
    expect(entries(text, s("spreadsheet.groupRows", "date-and-memo"))).toHaveLength(2);
    const blank = "Ref,Account,Debit,Credit\n1,Cash,5,\n\n1,Supplies,,5\n";
    expect(entries(blank)).toHaveLength(1);
    expect(entries(blank, s("spreadsheet.groupRows", "blank-rows"))).toHaveLength(2);
  });

  it("keeps the memos of later rows as comments above the entry", () => {
    const r = rows("Ref,Account,Memo,Debit,Credit\n1,Cash,Sale,5,\n1,Service Revenue,Invoice 12,,5\n");
    expect(r.text.split("\n").slice(0, 2)).toEqual(["# Invoice 12", "-      Sale"]);
    expect(r.book.entries[0]!.memo).toBe("Sale");
  });

  it("leaves out a group with no account or amount, and says so", () => {
    const text = "Date,Account,Memo,Debit,Credit\n1/3,Cash,Sale,5,\n1/3,Service Revenue,,,5\n\n1/9,,Prepared by the controller,,\n";
    const r = rows(text);
    expect(r.book.entries).toHaveLength(1);
    expect(r.diagnostics.map((d) => d.message)).toEqual(["Row 5 has no account or amount, so it was left out"]);
  });
});
