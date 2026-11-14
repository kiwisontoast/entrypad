import { describe, expect, it } from "vitest";
import { parse } from "./parse/parse.js";
import { equation, ledger } from "./views.js";

const today = new Date(2026, 5, 1);
const book = parse(
  `book "Sunrise Bakery" period 2026-01-01..2026-01-31

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

Jan 20 Pay a dividend
  Dividends                  500
      Cash                            500

Jan 31 Record depreciation   [adjusting]
  Depreciation Expense       200.50
      Accumulated Depreciation, Equipment   200.50
`,
  undefined,
  { today },
).book;

describe("ledger", () => {
  it("gives each account its postings with the balance after each one", () => {
    const cash = ledger(book).get("cash")!;
    expect(cash.rows.map((r) => [r.entryId, r.side, r.amount / 100, r.balance / 100])).toEqual([
      ["e1", "dr", 10000, 10000],
      ["e2", "cr", 4000, 6000],
      ["e3", "cr", 1200, 4800],
      ["e5", "cr", 500, 4300],
    ]);
    expect(cash).toMatchObject({ debits: 1_000_000, credits: 570_000, balance: 430_000 });
    expect(cash.rows[1]).toMatchObject({ date: "2026-01-03", memo: "Buy oven, half cash, half note", lineIndex: 1 });
  });

  it("measures balances on each account's normal side", () => {
    const l = ledger(book);
    expect(l.get("notes-payable")!.balance).toBe(400_000);
    expect(l.get("accumulated-depreciation-equipment")!.balance).toBe(20_050);
    expect(l.get("dividends")!.balance).toBe(50_000);
    expect(l.get("service-revenue")!.balance).toBe(300_000);
  });

  it("includes accounts with no activity and leaves out unknown ones", () => {
    const l = ledger(parse("Jan 1 x\n  Delivery Vans 100\n    Cash 100\n").book);
    expect(l.get("land")).toMatchObject({ rows: [], balance: 0 });
    expect(l.has("Delivery Vans")).toBe(false);
    expect(l.get("cash")!.balance).toBe(-10_000);
  });

  it("covers only the first entries when given at", () => {
    expect(ledger(book, 0).get("cash")!.rows).toEqual([]);
    expect(ledger(book, 2).get("cash")!.balance).toBe(600_000);
    expect(ledger(book, 99).get("cash")!.balance).toBe(430_000);
  });

  it("returns the same object for the same book and at", () => {
    expect(ledger(book)).toBe(ledger(book));
    expect(ledger(book, 2)).toBe(ledger(book, 2));
    expect(ledger(book, 99)).toBe(ledger(book));
    expect(ledger(book, 2)).not.toBe(ledger(book, 3));
    expect(ledger({ ...book })).not.toBe(ledger(book));
  });
});

describe("equation", () => {
  it("rolls revenue and expenses into equity, so it balances before closing", () => {
    expect(equation(book)).toEqual({
      assets: 10_000_00 - 4_000_00 + 8_000_00 - 1_200_00 + 3_000_00 - 500_00 - 200_50,
      liabilities: 4_000_00,
      equity: 10_000_00 - 500_00 + 3_000_00 - 1_200_00 - 200_50,
      equityAccounts: 10_000_00 - 500_00,
      revenue: 3_000_00,
      expenses: 1_200_00 + 200_50,
      netIncome: 3_000_00 - 1_400_50,
      balanced: true,
    });
  });

  it("balances after every balanced entry", () => {
    for (let at = 0; at <= book.entries.length; at++) expect(equation(book, at).balanced, `after ${at}`).toBe(true);
    expect(equation(book, 2)).toMatchObject({ assets: 14_000_00, liabilities: 4_000_00, equity: 10_000_00 });
  });

  it("keeps the same totals after closing entries move income into retained earnings", () => {
    const closed = parse(
      "Jan 1 a\n  Cash 1,000\n    Service Revenue 1,000\n\nJan 2 b\n  Rent Expense 400\n    Cash 400\n\nJan 31 Close [closing]\n  Service Revenue 1,000\n    Rent Expense 400\n    Retained Earnings 600\n",
    ).book;
    expect(equation(closed, 2)).toMatchObject({ equity: 600_00, equityAccounts: 0, netIncome: 600_00 });
    expect(equation(closed)).toMatchObject({ assets: 600_00, equity: 600_00, equityAccounts: 600_00, revenue: 0, expenses: 0, netIncome: 0, balanced: true });
  });

  it("reports an unbalanced book as unbalanced", () => {
    expect(equation(parse("Jan 1 x\n  Cash 100\n    Common Stock 90\n").book).balanced).toBe(false);
  });
});
