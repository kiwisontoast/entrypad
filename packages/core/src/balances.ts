import type { Account, Book, Side } from "./types.js";

export interface Posting {
  entryId: string;
  lineIndex: number;
  side: Side;
  amount: number;
  memo?: string;
}

export interface AccountBalance {
  account: Account;
  /** Total debits in cents. */
  debits: number;
  /** Total credits in cents. */
  credits: number;
  /**
   * Balance in cents on the account's normal side. Positive means a normal
   * balance; negative means an abnormal one (e.g. a cash overdraft).
   */
  balance: number;
  postings: Posting[];
}

/**
 * Totals every account in the chart. Accounts with no activity are included
 * with zero balances. Lines that name an account outside the chart are
 * ignored here; diagnostics report them separately.
 */
export function balances(book: Book): Map<string, AccountBalance> {
  const result = new Map<string, AccountBalance>();
  for (const account of book.chart) {
    result.set(account.id, { account, debits: 0, credits: 0, balance: 0, postings: [] });
  }
  for (const entry of book.entries) {
    entry.lines.forEach((line, lineIndex) => {
      const row = result.get(line.account);
      if (!row) return;
      if (line.side === "dr") row.debits += line.amount;
      else row.credits += line.amount;
      row.postings.push({
        entryId: entry.id,
        lineIndex,
        side: line.side,
        amount: line.amount,
        ...(entry.memo !== undefined && { memo: entry.memo }),
      });
    });
  }
  for (const row of result.values()) {
    row.balance =
      row.account.normal === "debit" ? row.debits - row.credits : row.credits - row.debits;
  }
  return result;
}

/** True when total debits equal total credits across the whole journal. */
export function isBalanced(book: Book): boolean {
  let net = 0;
  for (const entry of book.entries) {
    for (const line of entry.lines) net += line.side === "dr" ? line.amount : -line.amount;
  }
  return net === 0;
}
