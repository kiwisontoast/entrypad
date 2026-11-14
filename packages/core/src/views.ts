import type { Account, Book, Side } from "./types.js";

/** One posting in an account's ledger, with the balance just after it. */
export interface LedgerRow {
  entryId: string;
  lineIndex: number;
  date?: string;
  memo?: string;
  side: Side;
  /** Integer cents. */
  amount: number;
  /** The account's balance after this posting, in cents, positive on its normal side. */
  balance: number;
}

export interface AccountLedger {
  account: Account;
  rows: LedgerRow[];
  debits: number;
  credits: number;
  /** The closing balance, positive on the account's normal side. */
  balance: number;
}

export interface Equation {
  /** Assets, net of contra assets. */
  assets: number;
  liabilities: number;
  /** Equity accounts plus net income not yet closed to them. */
  equity: number;
  /** Equity accounts alone: stock, paid-in capital, retained earnings, less dividends. */
  equityAccounts: number;
  revenue: number;
  expenses: number;
  /** Revenue less expenses still in their own accounts, i.e. not yet closed. */
  netIncome: number;
  /** True when assets equal liabilities plus equity. */
  balanced: boolean;
}

/**
 * How much of the book a view covers: the first `at` entries, in file
 * order, as a step-through shows them. Leave it out for the whole book.
 */
type At = number | undefined;

/** Caches one result per book object and `at`, since books are never changed in place. */
function memo<T>(compute: (book: Book, at: At) => T): (book: Book, at?: number) => T {
  const cache = new WeakMap<Book, Map<At, T>>();
  return (book, at) => {
    const key = at === undefined || at >= book.entries.length ? undefined : Math.max(0, Math.floor(at));
    let byAt = cache.get(book);
    if (!byAt) cache.set(book, (byAt = new Map()));
    if (!byAt.has(key)) byAt.set(key, compute(book, key));
    return byAt.get(key)!;
  };
}

const entriesUpTo = (book: Book, at: At) => (at === undefined ? book.entries : book.entries.slice(0, at));

/**
 * Every account's postings with a running balance after each one, in file
 * order. Accounts with no activity are included. Lines naming an account
 * outside the chart are left out; `diagnose` reports them.
 */
export const ledger = memo((book: Book, at: At): Map<string, AccountLedger> => {
  const result = new Map<string, AccountLedger>();
  for (const account of book.chart) result.set(account.id, { account, rows: [], debits: 0, credits: 0, balance: 0 });
  for (const entry of entriesUpTo(book, at)) {
    entry.lines.forEach((line, lineIndex) => {
      const row = result.get(line.account);
      if (!row) return;
      if (line.side === "dr") row.debits += line.amount;
      else row.credits += line.amount;
      const normalSide = row.account.normal === "debit" ? "dr" : "cr";
      row.balance += line.side === normalSide ? line.amount : -line.amount;
      row.rows.push({
        entryId: entry.id,
        lineIndex,
        ...(entry.date !== undefined && { date: entry.date }),
        ...(entry.memo !== undefined && { memo: entry.memo }),
        side: line.side,
        amount: line.amount,
        balance: row.balance,
      });
    });
  }
  return result;
});

/**
 * The accounting equation. Revenue and expenses count towards equity until
 * a closing entry moves them into retained earnings, so the equation holds
 * after every balanced entry, not only at the end of the period.
 */
export const equation = memo((book: Book, at: At): Equation => {
  let assets = 0;
  let liabilities = 0;
  let equityAccounts = 0;
  let revenue = 0;
  let expenses = 0;
  for (const { account, debits, credits } of ledger(book, at).values()) {
    // Contra accounts sit under their type with the opposite sign, so
    // accumulated depreciation reduces assets and dividends reduce equity.
    const net = debits - credits;
    if (account.type === "asset") assets += net;
    else if (account.type === "expense") expenses += net;
    else if (account.type === "liability") liabilities -= net;
    else if (account.type === "equity") equityAccounts -= net;
    else revenue -= net;
  }
  const netIncome = revenue - expenses;
  const equity = equityAccounts + netIncome;
  return { assets, liabilities, equity, equityAccounts, revenue, expenses, netIncome, balanced: assets === liabilities + equity };
});
