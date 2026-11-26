import { describe, expect, it } from "vitest";
import { effectiveGroup } from "./groups.js";
import { parse } from "./parse/parse.js";
import { balanceSheet, incomeStatement, retainedEarnings, trialBalance } from "./statements.js";
import { equation } from "./views.js";

const today = new Date(2026, 5, 1);
const read = (text: string) => parse(text, undefined, { today }).book;

const shop = read(`book "Shop" period 2026-01-01..2026-01-31
account "Delivery Vans" asset group property-plant-equipment
account "Accumulated Depreciation, Vans" asset contra "Delivery Vans"
account "Sales Returns" revenue contra "Sales Revenue"
open Cash 5,000
open Retained Earnings 5,000

Jan 2 Buy a van: Delivery Vans 12,000 / Cash 2,000, Notes Payable 10,000

Jan 5 Sales
  Cash                 9,000
  Cost of Goods Sold   4,000
      Sales Revenue          9,000
      Inventory              4,000

Jan 6 Stock on account: Inventory 6,000 / Accounts Payable 6,000

Jan 8 A customer returns goods: Sales Returns 500 / Cash 500

Jan 15 Pay wages: Wages Expense 1,500 / Cash 1,500

Jan 20 Pay a dividend: Dividends 700 / Cash 700

Jan 31 Interest on the note   [adjusting]
  Interest Expense    50
      Interest Payable     50

Jan 31 Depreciate the van   [adjusting]
  Depreciation Expense   200
      Accumulated Depreciation, Vans   200

Jan 31 Income tax   [adjusting]
  Income Tax Expense   600
      Income Taxes Payable   600

Jan 31 Interest earned: Cash 30 / Interest Revenue 30
`);

const amounts = (lines: { account: { id: string }; amount: number }[]) => lines.map((l) => [l.account.id, l.amount]);

describe("effectiveGroup", () => {
  it("uses the account's own group, then the group of the account a contra offsets, then the type's default", () => {
    const chart = shop.chart;
    const byId = (id: string) => chart.find((a) => a.id === id)!;
    expect(effectiveGroup(byId("accumulated-depreciation-vans"), chart)).toBe("property-plant-equipment");
    expect(effectiveGroup(byId("sales-returns"), chart)).toBe("revenue");
    expect(effectiveGroup({ id: "x", name: "X", type: "liability", normal: "credit" }, chart)).toBe("current-liabilities");
    expect(effectiveGroup({ id: "x", name: "X", type: "liability", normal: "credit", group: "cash" }, chart)).toBe("current-liabilities");
  });
});

describe("trialBalance", () => {
  it("puts each balance in its column, leaves out accounts that net to zero, and totals both", () => {
    const tb = trialBalance(shop);
    expect(tb.balanced).toBe(true);
    expect(tb.debits).toBe(tb.credits);
    const cash = tb.rows.find((r) => r.account.id === "cash")!;
    expect(cash).toMatchObject({ debit: 9_330_00, credit: 0 });
    expect(tb.rows.find((r) => r.account.id === "accumulated-depreciation-vans")).toMatchObject({ debit: 0, credit: 200_00 });
    expect(tb.rows.some((r) => r.account.id === "land")).toBe(false);
  });

  it("covers only the first entries when given at, and memoises", () => {
    expect(trialBalance(shop, 1).rows.map((r) => r.account.id)).toEqual(["cash", "retained-earnings"]);
    expect(trialBalance(shop)).toBe(trialBalance(shop));
    expect(trialBalance(shop, 99)).toBe(trialBalance(shop));
  });
});

describe("incomeStatement", () => {
  const is = incomeStatement(shop);

  it("builds a multi-step statement by group, with contra revenue as a negative line", () => {
    expect(amounts(is.revenue.lines)).toEqual([
      ["sales-revenue", 9_000_00],
      ["sales-returns", -500_00],
    ]);
    expect(is.revenue.total).toBe(8_500_00);
    expect(is.costOfSales.total).toBe(4_000_00);
    expect(is.grossProfit).toBe(4_500_00);
    expect(amounts(is.operatingExpenses.lines)).toEqual([
      ["wages-expense", 1_500_00],
      ["depreciation-expense", 200_00],
    ]);
    expect(is.operatingIncome).toBe(2_800_00);
    expect(is.otherRevenue.total).toBe(30_00);
    expect(is.otherExpenses.total).toBe(50_00);
    expect(is.incomeBeforeTaxes).toBe(2_780_00);
    expect(is.incomeTaxes.total).toBe(600_00);
    expect(is.netIncome).toBe(2_180_00);
    expect(is.revenues - is.expenses).toBe(is.netIncome);
    expect(is.netIncome).toBe(equation(shop).netIncome);
  });
});

describe("retainedEarnings and balanceSheet", () => {
  it("rolls net income and dividends into retained earnings before closing", () => {
    expect(retainedEarnings(shop)).toEqual({ beginning: 5_000_00, netIncome: 2_180_00, dividends: 700_00, ending: 6_480_00 });
  });

  it("classifies the balance sheet by group and balances with the equation", () => {
    const bs = balanceSheet(shop);
    expect(bs.assets.map((s) => [s.id, s.total])).toEqual([
      ["current-assets", 9_330_00 + 2_000_00],
      ["property-plant-equipment", 12_000_00 - 200_00],
    ]);
    expect(amounts(bs.assets[1]!.lines)).toEqual([
      ["delivery-vans", 12_000_00],
      ["accumulated-depreciation-vans", -200_00],
    ]);
    expect(bs.liabilities.map((s) => [s.id, amounts(s.lines)])).toEqual([
      [
        "current-liabilities",
        [
          ["accounts-payable", 6_000_00],
          ["interest-payable", 50_00],
          ["income-taxes-payable", 600_00],
          ["notes-payable", 10_000_00],
        ],
      ],
    ]);
    expect(bs.contributedCapital.total).toBe(0);
    expect(bs.retainedEarnings).toBe(6_480_00);
    expect(bs.balanced).toBe(true);
    const eq = equation(shop);
    expect([bs.totalAssets, bs.totalLiabilities, bs.totalEquity]).toEqual([eq.assets, eq.liabilities, eq.equity]);
  });

  it("balances after every entry", () => {
    for (let at = 0; at <= shop.entries.length; at++) expect(balanceSheet(shop, at).balanced, `after ${at}`).toBe(true);
  });

  const closing = (via: string) =>
    read(`open Cash 1,000
open Common Stock 600
open Retained Earnings 400

Jan 1 Fees: Cash 1,000 / Service Revenue 1,000

Jan 2 Rent: Rent Expense 400 / Cash 400

Jan 3 Dividend: Dividends 100 / Cash 100

${via}`);

  it.each([
    [
      "straight to retained earnings",
      `Jan 31 Close [closing]
  Service Revenue 1,000
    Rent Expense 400
    Retained Earnings 600

Jan 31 Close dividends [closing]: Retained Earnings 100 / Dividends 100
`,
    ],
    [
      "through income summary",
      `Jan 31 Close revenue [closing]: Service Revenue 1,000 / Income Summary 1,000

Jan 31 Close expenses [closing]: Income Summary 400 / Rent Expense 400

Jan 31 Close income summary [closing]: Income Summary 600 / Retained Earnings 600

Jan 31 Close dividends [closing]: Retained Earnings 100 / Dividends 100
`,
    ],
  ])("gives the same statements before and after closing %s", (_, via) => {
    const book = closing(via);
    const before = book.entries.findIndex((e) => e.tags?.includes("closing"));
    for (let at = before; at <= book.entries.length; at++) {
      expect(incomeStatement(book, at).netIncome, `after ${at}`).toBe(600_00);
      expect(retainedEarnings(book, at), `after ${at}`).toEqual({ beginning: 400_00, netIncome: 600_00, dividends: 100_00, ending: 900_00 });
      expect(balanceSheet(book, at)).toMatchObject({ totalAssets: 1_500_00, totalEquity: 1_500_00, retainedEarnings: 900_00, balanced: true });
    }
    // After closing only the permanent accounts are left on the trial balance.
    expect(trialBalance(book).rows.map((r) => r.account.id)).toEqual(["cash", "common-stock", "retained-earnings"]);
  });
});
