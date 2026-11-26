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
  /**
   * The account's id when the name matched the chart; otherwise the name as
   * written, which diagnostics flag as an unknown account.
   */
  account: string;
  side: Side;
  /** Integer cents. */
  amount: number;
  /**
   * True when no amount was written. If `inferred` is also true, `amount` is
   * the value filled in to balance the entry; otherwise it is 0.
   */
  blank?: boolean;
  /** True when `amount` was filled in to balance the entry. */
  inferred?: boolean;
  source?: LineSource;
}

export type EntryTag = "adjusting" | "closing" | "operating" | "investing" | "financing";

/** Character offsets into the shorthand text, `from` inclusive and `to` exclusive. */
export interface SourceRange {
  from: number;
  to: number;
}

/**
 * Where a line came from, with the account name and the amount kept apart so
 * a squiggle can underline either one.
 */
export interface LineSource {
  /** The whole posting, without leading indentation or trailing spaces. */
  line: SourceRange;
  account: SourceRange;
  /** Absent when the amount was left blank. */
  amount?: SourceRange;
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
  /** From the `book` line, e.g. "Sunrise Bakery". */
  name?: string;
  chart: Account[];
  entries: Entry[];
  period?: { start: string; end: string };
  settings: BookSettings;
  /** Depreciable assets, from `asset` lines. Absent when there are none. */
  assets?: Asset[];
}

export type DepreciationMethod = "straight-line" | "double-declining" | "units";

/**
 * A depreciable asset, from an `asset` line. Its schedule is a view worked
 * out from these figures (see `depreciationSchedule`); it posts nothing.
 */
export interface Asset {
  /** Stable identifier made from the name, e.g. "ovens". */
  id: string;
  /** Display label, e.g. "Ovens". */
  name: string;
  /** The account the asset is carried in: its id when it matched the chart, otherwise the name as written. */
  account: string;
  /** Integer cents. */
  cost: number;
  /** Integer cents; 0 when not written. */
  salvage: number;
  /** Useful life in months. Absent for the units-of-production method. */
  life?: number;
  method: DepreciationMethod;
  /** Units-of-production method: the total units the asset is expected to produce. */
  units?: number;
  /** Units-of-production method: units used, by month ("2026-01"), in month order. */
  usage?: { month: string; units: number }[];
  /** ISO date the asset was placed in service. */
  from: string;
  source?: SourceRange;
}
