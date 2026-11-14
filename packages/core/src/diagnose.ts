import { suggestAccounts } from "./accounts.js";
import { balances } from "./balances.js";
import type { Diagnostic } from "./diagnostics.js";
import { formatAmount } from "./format.js";
import { runRules } from "./rules.js";
import type { Rule, RuleFinding } from "./rules.js";
import { defaultSettings } from "./settings.js";
import type { EntrypadSettings } from "./settings.js";
import type { Account, Book, Entry, Line } from "./types.js";

const dollars = (cents: number) => `$${formatAmount(cents)}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const showDate = (iso: string) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`;

const accountsById = (book: Book) => new Map(book.chart.map((a) => [a.id, a]));
const nameOf = (line: Line, chart: Map<string, Account>) => chart.get(line.account)?.name ?? line.account;

/** A copy of the book with one line changed. Fixes never touch the book they're given. */
function withLine(book: Book, entryId: string, index: number, patch: (line: Line) => Line): Book {
  return {
    ...book,
    entries: book.entries.map((e) =>
      e.id === entryId ? { ...e, lines: e.lines.map((l, i) => (i === index ? patch(l) : l)) } : e,
    ),
  };
}

/** A line as if its amount had always been written: no blank or inferred marks. */
function written(line: Line, amount = line.amount): Line {
  const { blank: _blank, inferred: _inferred, ...rest } = line;
  return { ...rest, amount };
}

function totals(entry: Entry) {
  let debits = 0;
  let credits = 0;
  for (const l of entry.lines) {
    if (l.side === "dr") debits += l.amount;
    else credits += l.amount;
  }
  return { debits, credits };
}

const lineTarget = (entry: Entry, index: number, source = entry.lines[index]?.source?.line) => ({
  entry: entry.id,
  line: index,
  account: entry.lines[index]!.account,
  ...(source && { source }),
});
const entryTarget = (entry: Entry) => ({ entry: entry.id, ...(entry.source && { source: entry.source }) });

const unbalancedEntry: Rule<Book> = {
  code: "unbalanced-entry",
  severity: "error",
  check(book, { settings }) {
    const chart = accountsById(book);
    const out: RuleFinding[] = [];
    for (const entry of book.entries) {
      const blanks = entry.lines.filter((l) => l.blank && !l.inferred);
      // Fewer than two lines, or several blanks, have rules of their own.
      if (entry.lines.length < 2 || entry.lines.filter((l) => l.blank).length > 1) continue;
      const { debits, credits } = totals(entry);
      if (debits === credits && !blanks.length) continue;

      let message = `Debits (${dollars(debits)}) don't equal credits (${dollars(credits)})`;
      if (blanks.length) {
        message += settings.autofix.inferBlankAmount
          ? ". The blank amount can't be filled in, because it would have to be zero or negative."
          : ". Filling in a blank amount is turned off.";
      }

      // Offer to put the difference on a side's only line, when that keeps it positive.
      const fixes: Diagnostic["fixes"] = [];
      const difference = debits - credits;
      for (const side of ["dr", "cr"] as const) {
        const onSide = entry.lines.map((l, i) => [l, i] as const).filter(([l]) => l.side === side);
        if (onSide.length !== 1 || blanks.length) continue;
        const [line, index] = onSide[0]!;
        const amount = side === "dr" ? line.amount - difference : line.amount + difference;
        if (amount <= 0) continue;
        fixes.push({
          label: `Put the difference on line ${index + 1}: ${nameOf(line, chart)} ${dollars(amount)}`,
          apply: (b) => withLine(b, entry.id, index, (l) => written(l, amount)),
        });
      }
      out.push({ message, target: entryTarget(entry), ...(fixes.length && { fixes }) });
    }
    return out;
  },
};

const unknownAccount: Rule<Book> = {
  code: "unknown-account",
  severity: "error",
  check(book, { settings }) {
    const chart = accountsById(book);
    const out: RuleFinding[] = [];
    for (const entry of book.entries) {
      entry.lines.forEach((line, index) => {
        if (chart.has(line.account)) return;
        const suggestions = settings.autofix.suggestNearestAccount ? suggestAccounts(line.account, book.chart) : [];
        out.push({
          message: `"${line.account}" isn't in the chart of accounts`,
          target: lineTarget(entry, index, line.source?.account),
          ...(suggestions.length && {
            fixes: suggestions.map((a) => ({
              label: `Change to ${a.name}`,
              apply: (b: Book) => withLine(b, entry.id, index, (l) => ({ ...l, account: a.id })),
            })),
          }),
        });
      });
    }
    return out;
  },
};

const singleLineEntry: Rule<Book> = {
  code: "single-line-entry",
  severity: "error",
  check(book) {
    return book.entries
      .filter((e) => e.lines.length < 2)
      .map((entry) => ({
        message: entry.lines.length
          ? "An entry needs at least two lines: a debit and a credit"
          : "This entry has no lines. Add a debit and a credit below it.",
        target: entryTarget(entry),
      }));
  },
};

const ambiguousBlank: Rule<Book> = {
  code: "ambiguous-blank",
  severity: "error",
  check(book) {
    const out: RuleFinding[] = [];
    for (const entry of book.entries) {
      const blanks = entry.lines.map((l, i) => [l, i] as const).filter(([l]) => l.blank);
      if (blanks.length < 2) continue;
      for (const [, index] of blanks) {
        out.push({
          message: `Only one amount in an entry can be left blank, and this entry has ${blanks.length}`,
          target: lineTarget(entry, index),
        });
      }
    }
    return out;
  },
};

const abnormalBalance: Rule<Book> = {
  code: "abnormal-balance",
  severity: "warning",
  check(book) {
    const out: RuleFinding[] = [];
    const byEntry = new Map(book.entries.map((e) => [e.id, e]));
    for (const row of balances(book).values()) {
      if (row.balance >= 0) continue;
      // Point at the posting after which the balance turned abnormal for good.
      let running = 0;
      let culprit = row.postings[0];
      for (const p of row.postings) {
        const before = running;
        running += (p.side === "dr") === (row.account.normal === "debit") ? p.amount : -p.amount;
        if (before >= 0 && running < 0) culprit = p;
      }
      const other = row.account.normal === "debit" ? "credit" : "debit";
      const entry = culprit && byEntry.get(culprit.entryId);
      const line = entry?.lines[culprit!.lineIndex];
      out.push({
        message: `${row.account.name} has a ${other} balance of ${dollars(-row.balance)}, but its normal balance is a ${row.account.normal}`,
        target: {
          account: row.account.id,
          ...(entry && { entry: entry.id, line: culprit!.lineIndex }),
          ...(line?.source && { source: line.source.account }),
        },
      });
    }
    return out;
  },
};

const oddSide: Rule<Book> = {
  code: "odd-side",
  severity: "warning",
  check(book) {
    const chart = accountsById(book);
    const out: RuleFinding[] = [];
    for (const entry of book.entries) {
      if (entry.tags?.includes("closing")) continue;
      entry.lines.forEach((line, index) => {
        const account = chart.get(line.account);
        if (!account || (account.type !== "revenue" && account.type !== "expense")) return;
        const normal = account.normal === "debit" ? "dr" : "cr";
        if (line.side === normal) return;
        const verb = line.side === "dr" ? "debited" : "credited";
        const kind = account.type === "revenue" ? "Revenue accounts are" : "Expense accounts are";
        out.push({
          message: `${account.name} is ${verb} here. ${kind} usually only ${verb} when closing the books.`,
          target: lineTarget(entry, index, line.source?.account),
        });
      });
    }
    return out;
  },
};

const zeroAmount: Rule<Book> = {
  code: "zero-amount",
  severity: "warning",
  check(book) {
    const out: RuleFinding[] = [];
    for (const entry of book.entries) {
      entry.lines.forEach((line, index) => {
        if (line.amount !== 0 || line.blank) return;
        out.push({ message: "This amount is zero", target: lineTarget(entry, index, line.source?.amount ?? line.source?.line) });
      });
    }
    return out;
  },
};

const inferredAmount: Rule<Book> = {
  code: "inferred-amount",
  severity: "hint",
  check(book) {
    const out: RuleFinding[] = [];
    for (const entry of book.entries) {
      entry.lines.forEach((line, index) => {
        if (!line.inferred) return;
        out.push({
          message: `Filled in as ${dollars(line.amount)} to balance the entry`,
          target: lineTarget(entry, index),
          fixes: [{ label: "Write the amount in", apply: (b) => withLine(b, entry.id, index, (l) => written(l)) }],
        });
      });
    }
    return out;
  },
};

const outsidePeriod: Rule<Book> = {
  code: "outside-period",
  severity: "hint",
  check(book) {
    const period = book.period;
    if (!period) return [];
    return book.entries
      .filter((e) => e.date && (e.date < period.start || e.date > period.end))
      .map((entry) => ({
        message: `This entry is dated ${showDate(entry.date!)}, outside the book's period (${showDate(period.start)} to ${showDate(period.end)})`,
        target: entryTarget(entry),
      }));
  },
};

/** The book rules, in the order the plan lists them. Packs add theirs by passing a longer array. */
export const bookRules: readonly Rule<Book>[] = [
  unbalancedEntry,
  unknownAccount,
  singleLineEntry,
  ambiguousBlank,
  abnormalBalance,
  oddSide,
  zeroAmount,
  inferredAmount,
  outsidePeriod,
];

/**
 * Checks a book and returns its findings, in text order. Never changes the
 * book and never refuses one. Severities come from `diagnostics.*`.
 */
export function diagnose(
  book: Book,
  settings: EntrypadSettings = defaultSettings(),
  rules: readonly Rule<Book>[] = bookRules,
): Diagnostic[] {
  return runRules(book, rules, settings);
}
