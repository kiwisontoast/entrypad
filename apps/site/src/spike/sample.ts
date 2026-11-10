import { toCents, usGaapIntroChart } from "@entrypad/core";
import type { Account, Book } from "@entrypad/core";
import type { DraftCard } from "@entrypad/react";

/** The 30 accounts the spike shows by default. */
export const thirtyAccounts = [
  "cash",
  "accounts-receivable",
  "allowance-for-doubtful-accounts",
  "inventory",
  "supplies",
  "prepaid-rent",
  "prepaid-insurance",
  "land",
  "buildings",
  "equipment",
  "accumulated-depreciation-equipment",
  "accounts-payable",
  "notes-payable",
  "wages-payable",
  "interest-payable",
  "unearned-revenue",
  "utilities-payable",
  "common-stock",
  "retained-earnings",
  "dividends",
  "service-revenue",
  "sales-revenue",
  "cost-of-goods-sold",
  "wages-expense",
  "rent-expense",
  "supplies-expense",
  "insurance-expense",
  "utilities-expense",
  "depreciation-expense",
  "advertising-expense",
];

/**
 * The chart plus, beyond the 40 standard accounts, customer subledger accounts
 * so the spike can test larger boards.
 */
export function chartWith(count: number): { chart: Account[]; visible: string[] } {
  const chart: Account[] = [...usGaapIntroChart];
  for (let i = 1; chart.length < count; i++) {
    const n = String(i).padStart(2, "0");
    chart.push({
      id: `ar-customer-${n}`,
      name: `A/R, Customer ${n}`,
      type: "asset",
      normal: "debit",
      group: "current-assets",
    });
  }
  const visible = count === 30 ? thirtyAccounts : chart.slice(0, count).map((a) => a.id);
  return { chart, visible };
}

export function sampleBook(chart: Account[]): Book {
  return {
    chart,
    settings: { standard: "us-gaap", currency: "USD", decimals: 0 },
    period: { start: "2026-01-01", end: "2026-01-31" },
    entries: [
      {
        id: "jan-01",
        date: "2026-01-01",
        memo: "Owner invests cash",
        lines: [
          { account: "cash", side: "dr", amount: toCents(10_000) },
          { account: "common-stock", side: "cr", amount: toCents(10_000) },
        ],
      },
      {
        id: "jan-03",
        date: "2026-01-03",
        memo: "Buy oven, half cash, half note",
        tags: ["investing"],
        lines: [
          { account: "equipment", side: "dr", amount: toCents(8_000) },
          { account: "cash", side: "cr", amount: toCents(4_000) },
          { account: "notes-payable", side: "cr", amount: toCents(4_000) },
        ],
      },
    ],
  };
}

export const sampleDrafts: DraftCard[] = [
  { id: "rent", memo: "Pay January rent", amount: toCents(1_200), fixed: { account: "cash", side: "cr" } },
  {
    id: "supplies",
    memo: "Buy supplies on account",
    amount: toCents(450),
    fixed: { account: "accounts-payable", side: "cr" },
  },
  {
    id: "catering",
    memo: "Bill a catering client",
    amount: toCents(3_000),
    fixed: { account: "accounts-receivable", side: "dr" },
  },
  { id: "van", memo: "Buy a delivery van for cash", amount: toCents(7_500), fixed: { account: "cash", side: "cr" } },
];
