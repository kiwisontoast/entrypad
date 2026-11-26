import { accountGroups, effectiveGroup } from "./groups.js";
import type { AccountGroup } from "./groups.js";
import type { Account, Book, Entry } from "./types.js";
import { entriesUpTo, ledger, memo } from "./views.js";
import type { At } from "./views.js";

/** One account on the trial balance. Exactly one of `debit` and `credit` is non-zero. */
export interface TrialBalanceRow {
  account: Account;
  /** Integer cents. */
  debit: number;
  credit: number;
}

export interface TrialBalance {
  /** Every account with a balance, in chart order. Accounts that net to zero are left out. */
  rows: TrialBalanceRow[];
  debits: number;
  credits: number;
  balanced: boolean;
}

/** One account on a statement. */
export interface StatementLine {
  account: Account;
  /**
   * Integer cents, signed so that it adds to the section total: a contra
   * account such as accumulated depreciation is negative.
   */
  amount: number;
}

export interface StatementSection {
  /** The group the section is named after. */
  id: AccountGroup;
  /** Accounts with a non-zero amount, by group and then in chart order. */
  lines: StatementLine[];
  total: number;
}

/**
 * A multi-step income statement. Closing entries are left out, so the
 * statement shows the period's activity whether or not the books are closed.
 */
export interface IncomeStatement {
  revenue: StatementSection;
  costOfSales: StatementSection;
  /** Revenue less cost of sales. */
  grossProfit: number;
  operatingExpenses: StatementSection;
  /** Gross profit less operating expenses. */
  operatingIncome: number;
  otherRevenue: StatementSection;
  otherExpenses: StatementSection;
  incomeBeforeTaxes: number;
  incomeTaxes: StatementSection;
  netIncome: number;
  /** Revenue and other revenue together. */
  revenues: number;
  /** Every expense section together. */
  expenses: number;
}

export interface RetainedEarningsStatement {
  /** The retained earnings accounts' balance before closing entries, e.g. from `open` lines. */
  beginning: number;
  netIncome: number;
  /** Dividends declared in the period, outside closing entries. */
  dividends: number;
  /** Beginning plus net income less dividends. */
  ending: number;
}

/** A classified balance sheet. */
export interface BalanceSheet {
  /** Current assets (cash first), investments, property, plant, and equipment, and so on. Empty sections are left out. */
  assets: StatementSection[];
  totalAssets: number;
  /** Current liabilities (short-term debt included), then long-term liabilities. Empty sections are left out. */
  liabilities: StatementSection[];
  totalLiabilities: number;
  contributedCapital: StatementSection;
  /** Ending retained earnings from the statement of retained earnings, so income not yet closed is included. */
  retainedEarnings: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  /** True when total assets equal total liabilities and equity. */
  balanced: boolean;
}

const groupOrder = new Map<string, number>(accountGroups.map((g, i) => [g.id, i]));

/** The statement group of every account, worked out once per chart. */
const groupCache = new WeakMap<readonly Account[], Map<string, AccountGroup>>();
export function groupsOf(chart: readonly Account[]): Map<string, AccountGroup> {
  let groups = groupCache.get(chart);
  if (!groups) groupCache.set(chart, (groups = new Map(chart.map((a) => [a.id, effectiveGroup(a, chart)]))));
  return groups;
}

export const isClosing = (entry: Entry) => entry.tags?.includes("closing") ?? false;

/** Debits less credits for each account, over the given entries. */
function netByAccount(entries: readonly Entry[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const entry of entries) {
    for (const line of entry.lines) net.set(line.account, (net.get(line.account) ?? 0) + (line.side === "dr" ? line.amount : -line.amount));
  }
  return net;
}

/**
 * The accounts in the given groups as one section. `sign` is 1 for
 * debit-balance sections (assets, expenses) and -1 for the others.
 */
function section(book: Book, net: Map<string, number>, id: AccountGroup, groups: readonly AccountGroup[], sign: 1 | -1): StatementSection {
  const groupOf = groupsOf(book.chart);
  const lines: StatementLine[] = [];
  for (const account of book.chart) {
    if (!groups.includes(groupOf.get(account.id)!)) continue;
    const amount = sign * (net.get(account.id) ?? 0);
    if (amount !== 0) lines.push({ account, amount });
  }
  // Array sort is stable, so chart order holds within each group.
  lines.sort((a, b) => groupOrder.get(groupOf.get(a.account.id)!)! - groupOrder.get(groupOf.get(b.account.id)!)!);
  return { id, lines, total: lines.reduce((sum, l) => sum + l.amount, 0) };
}

/**
 * Every account's balance in a debit or a credit column, after the first
 * `at` entries. Closing entries count, so after closing this is the
 * post-closing trial balance.
 */
export const trialBalance = memo((book: Book, at: At): TrialBalance => {
  const rows: TrialBalanceRow[] = [];
  let debits = 0;
  let credits = 0;
  for (const { account, debits: dr, credits: cr } of ledger(book, at).values()) {
    const net = dr - cr;
    if (net === 0) continue;
    rows.push({ account, debit: Math.max(net, 0), credit: Math.max(-net, 0) });
    if (net > 0) debits += net;
    else credits -= net;
  }
  return { rows, debits, credits, balanced: debits === credits };
});

/** The income statement for the first `at` entries, leaving out closing entries. */
export const incomeStatement = memo((book: Book, at: At): IncomeStatement => {
  const net = netByAccount(entriesUpTo(book, at).filter((e) => !isClosing(e)));
  const revenue = section(book, net, "revenue", ["revenue"], -1);
  const costOfSales = section(book, net, "cost-of-sales", ["cost-of-sales"], 1);
  const operatingExpenses = section(book, net, "operating-expenses", ["operating-expenses"], 1);
  const otherRevenue = section(book, net, "other-revenue", ["other-revenue"], -1);
  const otherExpenses = section(book, net, "other-expenses", ["other-expenses"], 1);
  const incomeTaxes = section(book, net, "income-taxes", ["income-taxes"], 1);
  const grossProfit = revenue.total - costOfSales.total;
  const operatingIncome = grossProfit - operatingExpenses.total;
  const incomeBeforeTaxes = operatingIncome + otherRevenue.total - otherExpenses.total;
  return {
    revenue,
    costOfSales,
    grossProfit,
    operatingExpenses,
    operatingIncome,
    otherRevenue,
    otherExpenses,
    incomeBeforeTaxes,
    incomeTaxes,
    netIncome: incomeBeforeTaxes - incomeTaxes.total,
    revenues: revenue.total + otherRevenue.total,
    expenses: costOfSales.total + operatingExpenses.total + otherExpenses.total + incomeTaxes.total,
  };
});

/**
 * Beginning retained earnings, plus net income, less dividends. Closing
 * entries are left out throughout: they only move net income and dividends
 * into retained earnings, which this statement already does.
 */
export const retainedEarnings = memo((book: Book, at: At): RetainedEarningsStatement => {
  const net = netByAccount(entriesUpTo(book, at).filter((e) => !isClosing(e)));
  const groupOf = groupsOf(book.chart);
  let beginning = 0;
  let dividends = 0;
  for (const account of book.chart) {
    const group = groupOf.get(account.id);
    const n = net.get(account.id) ?? 0;
    if (group === "retained-earnings") beginning -= n;
    else if (group === "dividends") dividends += n;
  }
  const { netIncome } = incomeStatement(book, at);
  return { beginning, netIncome, dividends, ending: beginning + netIncome - dividends };
});

/**
 * The classified balance sheet after the first `at` entries. Retained
 * earnings come from the statement of retained earnings, so the sheet
 * balances before closing as well as after, as the equation does.
 */
export const balanceSheet = memo((book: Book, at: At): BalanceSheet => {
  const net = new Map<string, number>();
  for (const [id, row] of ledger(book, at)) net.set(id, row.debits - row.credits);
  const assets = [
    section(book, net, "current-assets", ["cash", "current-assets"], 1),
    section(book, net, "investments", ["investments"], 1),
    section(book, net, "property-plant-equipment", ["property-plant-equipment"], 1),
    section(book, net, "intangible-assets", ["intangible-assets"], 1),
    section(book, net, "other-assets", ["other-assets"], 1),
  ].filter((s) => s.lines.length);
  const liabilities = [
    section(book, net, "current-liabilities", ["current-liabilities", "short-term-debt"], -1),
    section(book, net, "long-term-liabilities", ["long-term-liabilities"], -1),
  ].filter((s) => s.lines.length);
  const contributedCapital = section(book, net, "contributed-capital", ["contributed-capital"], -1);
  const re = retainedEarnings(book, at).ending;
  const totalAssets = assets.reduce((sum, s) => sum + s.total, 0);
  const totalLiabilities = liabilities.reduce((sum, s) => sum + s.total, 0);
  const totalEquity = contributedCapital.total + re;
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
  return {
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    contributedCapital,
    retainedEarnings: re,
    totalEquity,
    totalLiabilitiesAndEquity,
    balanced: totalAssets === totalLiabilitiesAndEquity,
  };
});
