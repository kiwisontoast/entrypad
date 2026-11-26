import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { samples } from "../../../examples/generate.ts";
import type { Expected } from "../../../examples/generate.ts";
import { diagnose } from "./diagnose.js";
import { parse } from "./parse/parse.js";
import { balanceSheet, incomeStatement, retainedEarnings, trialBalance } from "./statements.js";
import { equation, ledger } from "./views.js";

const dir = new URL("../../../examples/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir), "utf8").replace(/\r\n/g, "\n");

/** "12,345.67" or "-200.00" to cents, without using the code under test. */
const cents = (dollars: string) => {
  const negative = dollars.startsWith("-");
  const [whole, frac = "00"] = dollars.replace(/[-,]/g, "").split(".");
  const value = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return negative ? -value : value;
};

describe.each(samples().map((s) => [s.slug, s] as const))("sample book %s", (slug, sample) => {
  const text = read(`${slug}.entrypad`);
  const expected = JSON.parse(read(`${slug}.expected.json`)) as Expected;
  const { book, diagnostics } = parse(text);

  it("is checked in exactly as the generator writes it", () => {
    expect(text).toBe(sample.text);
    expect(expected).toEqual(sample.expected);
  });

  it("reads without errors or warnings", () => {
    expect(diagnostics).toEqual([]);
    const findings = diagnose(book).filter((d) => d.severity !== "hint");
    expect(findings).toEqual([]);
  });

  it("has the expected name, period and number of entries", () => {
    expect(book.name).toBe(expected.book);
    expect(book.period).toEqual(expected.period);
    expect(book.entries).toHaveLength(expected.entries);
    expect(book.entries.length).toBeGreaterThanOrEqual(10);
    expect(book.entries.length).toBeLessThanOrEqual(26);
  });

  it("gives every account the expected balance, and leaves the rest at zero", () => {
    const actual = ledger(book);
    for (const row of actual.values()) {
      const want = expected.balances[row.account.name];
      expect(row.balance, row.account.name).toBe(want === undefined ? 0 : cents(want));
    }
    for (const name of Object.keys(expected.balances)) {
      expect([...actual.values()].some((r) => r.account.name === name), name).toBe(true);
    }
  });

  it("has the expected trial balance totals", () => {
    let debits = 0;
    let credits = 0;
    for (const row of ledger(book).values()) {
      const net = row.debits - row.credits;
      if (net > 0) debits += net;
      else credits -= net;
    }
    expect({ debits, credits }).toEqual({ debits: cents(expected.trialBalance.debits), credits: cents(expected.trialBalance.credits) });
  });

  it("has the expected accounting equation", () => {
    const eq = equation(book);
    expect(eq.balanced).toBe(true);
    expect({ assets: eq.assets, liabilities: eq.liabilities, equity: eq.equity, netIncome: eq.netIncome }).toEqual({
      assets: cents(expected.equation.assets),
      liabilities: cents(expected.equation.liabilities),
      equity: cents(expected.equation.equity),
      netIncome: cents(expected.equation.netIncome),
    });
  });

  const allCents = (figures: Record<string, string>) => Object.fromEntries(Object.entries(figures).map(([k, v]) => [k, cents(v)]));

  it("has the expected trial balance, account by account", () => {
    const tb = trialBalance(book);
    expect(tb.balanced).toBe(true);
    expect({ debits: tb.debits, credits: tb.credits }).toEqual({ debits: cents(expected.trialBalance.debits), credits: cents(expected.trialBalance.credits) });
    const rows = Object.fromEntries(tb.rows.map((r) => [r.account.name, r.debit ? { debit: r.debit } : { credit: r.credit }]));
    const want = Object.fromEntries(
      Object.entries(expected.trialBalance.rows).map(([name, row]) => [name, "debit" in row ? { debit: cents(row.debit) } : { credit: cents(row.credit) }]),
    );
    expect(rows).toEqual(want);
  });

  it("has the expected income statement", () => {
    const is = incomeStatement(book);
    expect({
      revenue: is.revenue.total,
      costOfSales: is.costOfSales.total,
      grossProfit: is.grossProfit,
      operatingExpenses: is.operatingExpenses.total,
      operatingIncome: is.operatingIncome,
      otherExpenses: is.otherExpenses.total,
      incomeBeforeTaxes: is.incomeBeforeTaxes,
      incomeTaxes: is.incomeTaxes.total,
      netIncome: is.netIncome,
    }).toEqual(allCents(expected.incomeStatement));
    expect(is.otherRevenue.total).toBe(0);
  });

  it("has the expected statement of retained earnings", () => {
    expect(retainedEarnings(book)).toEqual(allCents(expected.retainedEarnings));
  });

  it("has the expected balance sheet", () => {
    const bs = balanceSheet(book);
    const section = (sections: typeof bs.assets, id: string) => sections.find((s) => s.id === id)?.total ?? 0;
    expect(bs.balanced).toBe(true);
    for (const s of bs.assets) expect(["current-assets", "property-plant-equipment"]).toContain(s.id);
    expect(bs.liabilities.map((s) => s.id)).toEqual(["current-liabilities"]);
    expect({
      currentAssets: section(bs.assets, "current-assets"),
      propertyPlantEquipment: section(bs.assets, "property-plant-equipment"),
      totalAssets: bs.totalAssets,
      currentLiabilities: section(bs.liabilities, "current-liabilities"),
      totalLiabilities: bs.totalLiabilities,
      contributedCapital: bs.contributedCapital.total,
      retainedEarnings: bs.retainedEarnings,
      totalEquity: bs.totalEquity,
      totalLiabilitiesAndEquity: bs.totalLiabilitiesAndEquity,
    }).toEqual(allCents(expected.balanceSheet));
  });
});
