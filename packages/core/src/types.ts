export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export type Side = "dr" | "cr";

export interface Account {
  /** Stable identifier, e.g. "cash" or "accounts-receivable". */
  id: string;
  /** Display label, e.g. "Cash". */
  name: string;
  type: AccountType;
  normal: "debit" | "credit";
  /** Statement grouping, e.g. "current-assets". */
  group?: string;
  /** For contra accounts: the account this one offsets. */
  contraOf?: string;
  /** Other names the parser accepts, e.g. "A/R". */
  aliases?: string[];
}

export interface Line {
  account: string;
  side: Side;
  /** Integer cents. */
  amount: number;
}

export type EntryTag = "adjusting" | "closing" | "operating" | "investing" | "financing";

export interface SourceRange {
  from: number;
  to: number;
}

export interface Entry {
  id: string;
  /** ISO date, e.g. "2026-01-03". */
  date?: string;
  memo?: string;
  lines: Line[];
  tags?: EntryTag[];
  source?: SourceRange;
}

export interface BookSettings {
  standard: "us-gaap";
  currency: "USD";
  decimals: 0 | 2;
}

export interface Book {
  chart: Account[];
  entries: Entry[];
  period?: { start: string; end: string };
  settings: BookSettings;
}
