import type { Book, SourceRange } from "./types.js";

/** How loudly a finding is shown. "off" turns the rule off entirely. */
export type Severity = "error" | "warning" | "hint" | "off";

/** A suggested change. Applying it returns a new book; the old one is untouched. */
export interface DiagnosticFix {
  label: string;
  apply: (book: Book) => Book;
}

/**
 * One finding: a squiggle in the editor and on the visuals. Findings never
 * change the book and never block anything.
 */
export interface Diagnostic {
  severity: Exclude<Severity, "off">;
  /** One of the diagnostic codes below, or a code added by a pack. */
  code: string;
  /** Shown to the user, e.g. "Debits ($5,000) don't equal credits ($4,500)". */
  message: string;
  target: {
    /** Entry id. */
    entry?: string;
    /** Index of the line within the entry. */
    line?: number;
    /** Account id, or the name as written for an unknown account. */
    account?: string;
    /** The text to underline. */
    source?: SourceRange;
  };
  fixes?: DiagnosticFix[];
}

/**
 * Every finding Entrypad can report, with its default severity. Book rules
 * come from `diagnose()`; the others from reading the shorthand or imports.
 */
export const diagnosticDefaults = {
  // Book rules
  "unbalanced-entry": "error",
  "unknown-account": "error",
  "single-line-entry": "error",
  "ambiguous-blank": "error",
  "abnormal-balance": "warning",
  "odd-side": "warning",
  "zero-amount": "warning",
  "inferred-amount": "hint",
  "outside-period": "hint",
  // Reading the shorthand
  "unreadable-line": "error",
  "invalid-amount": "error",
  "invalid-date": "error",
  "negative-amount": "warning",
  "unknown-tag": "warning",
  "unknown-visual": "warning",
  "duplicate-book": "warning",
  "unknown-setting": "warning",
  // Importing hledger and ledger journals
  "unsupported-directive": "hint",
} as const satisfies Record<string, Exclude<Severity, "off">>;

export type DiagnosticCode = keyof typeof diagnosticDefaults;

export const diagnosticCodes = Object.keys(diagnosticDefaults) as DiagnosticCode[];

/** Plain-language names for the settings screen. */
export const diagnosticLabels: Record<DiagnosticCode, string> = {
  "unbalanced-entry": "Debits and credits differ in an entry",
  "unknown-account": "An account isn't in the chart",
  "single-line-entry": "An entry has only one line",
  "ambiguous-blank": "More than one amount is left blank",
  "abnormal-balance": "An account's balance is on the wrong side",
  "odd-side": "An account is debited or credited unusually",
  "zero-amount": "A line amount is zero",
  "inferred-amount": "A blank amount was filled in",
  "outside-period": "An entry falls outside the book's period",
  "unreadable-line": "A line can't be read",
  "invalid-amount": "An amount can't be read",
  "invalid-date": "A date can't be read or doesn't exist",
  "negative-amount": "An amount is written as negative",
  "unknown-tag": "A tag isn't recognized",
  "unknown-visual": "A show line names an unknown visual",
  "duplicate-book": "A file has more than one book line",
  "unknown-setting": "A set line names an unknown setting or value",
  "unsupported-directive": "An imported directive isn't used",
};
