import type { AccountGroup } from "./groups.js";
import { OPENING_ENTRY_ID } from "./parse/parse.js";
import { defaultSettings } from "./settings.js";
import type { EntrypadSettings } from "./settings.js";
import { groupsOf, incomeStatement, isClosing } from "./statements.js";
import type { StatementLine } from "./statements.js";
import type { Account, Book, Entry, EntryTag } from "./types.js";
import { entriesUpTo, memo } from "./views.js";
import type { At } from "./views.js";

export type CashFlowSection = "operating" | "investing" | "financing";
export type CashFlowMethod = "direct" | "indirect";

export const cashFlowSections: readonly CashFlowSection[] = ["operating", "investing", "financing"];

/** How an entry that moves cash is placed on the cash flow statement. */
export interface CashSection {
  section: CashFlowSection;
  /** False when a tag on the entry chose the section. */
  inferred: boolean;
  /** For an inferred investing or financing section, the account on the other side that decided it. */
  basis?: Account;
}

/** One entry's effect on cash, as the direct method shows it. */
export interface CashFlowItem extends CashSection {
  entryId: string;
  date?: string;
  memo?: string;
  /** Integer cents: positive for cash received, negative for cash paid. */
  amount: number;
}

export interface CashActivity {
  items: CashFlowItem[];
  total: number;
}

/** The operating section by the indirect method: net income adjusted to the cash it brought in. */
export interface IndirectOperating {
  netIncome: number;
  /**
   * Items in net income that didn't move cash, such as depreciation (added
   * back), and income from entries shown under investing or financing,
   * such as a gain on a sale (taken off). Each is signed by its effect on cash.
   */
  adjustments: StatementLine[];
  /** Changes in current assets other than cash: an increase is negative. */
  currentAssets: StatementLine[];
  /** Changes in current liabilities other than short-term debt: an increase is positive. */
  currentLiabilities: StatementLine[];
  /** Equal to the operating total by the direct method. */
  total: number;
}

/** An entry with no cash in it that exchanges investing or financing items, e.g. equipment bought with a note. */
export interface NonCashActivity {
  entryId: string;
  date?: string;
  memo?: string;
}

interface CashFlowBase {
  investing: CashActivity;
  financing: CashActivity;
  /** Operating, investing and financing together. */
  netChange: number;
  /** Cash from the opening balances. */
  beginningCash: number;
  endingCash: number;
  nonCashActivities: NonCashActivity[];
}

export interface DirectCashFlow extends CashFlowBase {
  method: "direct";
  operating: CashActivity;
}

export interface IndirectCashFlow extends CashFlowBase {
  method: "indirect";
  operating: IndirectOperating;
}

export type CashFlow = DirectCashFlow | IndirectCashFlow;

/** What a line's account means for the cash flow statement. */
type Role = "cash" | "income" | "current-asset" | "current-liability" | "investing" | "financing" | "other";

const ROLES: Partial<Record<AccountGroup, Role>> = {
  cash: "cash",
  "current-assets": "current-asset",
  "current-liabilities": "current-liability",
  investments: "investing",
  "property-plant-equipment": "investing",
  "intangible-assets": "investing",
  "short-term-debt": "financing",
  "long-term-liabilities": "financing",
  "contributed-capital": "financing",
  dividends: "financing",
};

function roles(book: Book): Map<string, Role> {
  const out = new Map<string, Role>();
  const groupOf = groupsOf(book.chart);
  for (const account of book.chart) {
    const group = groupOf.get(account.id)!;
    out.set(account.id, account.type === "revenue" || account.type === "expense" ? "income" : (ROLES[group] ?? "other"));
  }
  return out;
}

const signed = (line: Entry["lines"][number]) => (line.side === "dr" ? line.amount : -line.amount);

/** Cash received less cash paid in one entry. */
function cashIn(entry: Entry, role: Map<string, Role>): number {
  let net = 0;
  for (const line of entry.lines) if (role.get(line.account) === "cash") net += signed(line);
  return net;
}

/**
 * The section for an entry that moves cash. A section tag decides it. An
 * untagged entry is placed by the accounts on its other side when
 * `cashFlow.inferSections` is on: property, plant and equipment,
 * investments and intangibles make it investing; debt, stock and dividends
 * make it financing; anything else, operating. When the setting is off,
 * untagged entries are operating.
 */
function sectionOf(entry: Entry, book: Book, role: Map<string, Role>, infer: boolean): CashSection {
  const tag = entry.tags?.find((t: EntryTag): t is CashFlowSection => (cashFlowSections as readonly string[]).includes(t));
  if (tag) return { section: tag, inferred: false };
  if (infer) {
    for (const section of ["investing", "financing"] as const) {
      const line = entry.lines.find((l) => role.get(l.account) === section);
      if (line) return { section, inferred: true, basis: book.chart.find((a) => a.id === line.account)! };
    }
  }
  return { section: "operating", inferred: true };
}

/**
 * The section of every entry that moves cash, by entry id. The opening
 * balances and closing entries are left out, as are entries whose cash
 * lines net to zero, such as a transfer between bank accounts.
 */
export function cashSections(book: Book, settings: EntrypadSettings = defaultSettings(), at?: number): Map<string, CashSection> {
  const role = roles(book);
  const out = new Map<string, CashSection>();
  for (const entry of entriesUpTo(book, at)) {
    if (entry.id === OPENING_ENTRY_ID || isClosing(entry) || cashIn(entry, role) === 0) continue;
    out.set(entry.id, sectionOf(entry, book, role, settings.cashFlow.inferSections));
  }
  return out;
}

/** Adds an amount to an account's line, keeping lines in chart order. */
function adder(book: Book) {
  const order = new Map(book.chart.map((a, i) => [a.id, i]));
  const byId = new Map(book.chart.map((a) => [a.id, a]));
  const totals = new Map<string, number>();
  return {
    add: (account: string, amount: number) => totals.set(account, (totals.get(account) ?? 0) + amount),
    lines: (): StatementLine[] =>
      [...totals]
        .filter(([, amount]) => amount !== 0)
        .sort(([a], [b]) => order.get(a)! - order.get(b)!)
        .map(([id, amount]) => ({ account: byId.get(id)!, amount })),
  };
}

const total = (lines: { amount: number }[]) => lines.reduce((sum, l) => sum + l.amount, 0);

function compute(book: Book, at: At, infer: boolean): { direct: DirectCashFlow; indirect: IndirectCashFlow } {
  const role = roles(book);
  const activities: Record<CashFlowSection, CashFlowItem[]> = { operating: [], investing: [], financing: [] };
  const nonCashActivities: NonCashActivity[] = [];
  const adjustments = adder(book);
  const currentAssets = adder(book);
  const currentLiabilities = adder(book);
  let beginningCash = 0;

  /** Revenue and expense lines from an entry that the operating section doesn't cover come off net income. */
  const removeIncome = (entry: Entry) => {
    for (const line of entry.lines) if (role.get(line.account) === "income") adjustments.add(line.account, signed(line));
  };

  for (const entry of entriesUpTo(book, at)) {
    if (isClosing(entry)) continue;
    const ref = { entryId: entry.id, ...(entry.date !== undefined && { date: entry.date }), ...(entry.memo !== undefined && { memo: entry.memo }) };
    const cash = cashIn(entry, role);
    if (entry.id === OPENING_ENTRY_ID) {
      beginningCash += cash;
      removeIncome(entry);
      continue;
    }
    const known = entry.lines.filter((l) => role.has(l.account));
    if (cash !== 0) {
      const placed = sectionOf(entry, book, role, infer);
      activities[placed.section].push({ ...ref, ...placed, amount: cash });
      if (placed.section !== "operating") {
        removeIncome(entry);
        continue;
      }
    } else {
      const income = known.filter((l) => role.get(l.account) === "income").reduce((sum, l) => sum + signed(l), 0);
      const longTerm = known.some((l) => ["investing", "financing"].includes(role.get(l.account)!));
      // No cash and no effect on net income: an exchange of investing or financing items, disclosed separately.
      if (income === 0 && longTerm) {
        nonCashActivities.push(ref);
        continue;
      }
    }

    // What remains is in the operating section: the entry's lines other than
    // cash and income are the adjustments that turn net income into cash.
    const working = known.filter((l) => ["current-asset", "current-liability"].includes(role.get(l.account)!));
    const others = known.filter((l) => ["investing", "financing", "other"].includes(role.get(l.account)!));
    for (const line of working) (role.get(line.account) === "current-asset" ? currentAssets : currentLiabilities).add(line.account, -signed(line));
    if (!others.length) continue;
    if (cash === 0 && !working.length) {
      // A non-cash charge such as depreciation: shown as the expense added back.
      for (const line of known) if (role.get(line.account) === "income") adjustments.add(line.account, signed(line));
    } else {
      for (const line of others) adjustments.add(line.account, -signed(line));
    }
  }

  const activity = (section: CashFlowSection): CashActivity => ({ items: activities[section], total: total(activities[section]) });
  const operating = activity("operating");
  const investing = activity("investing");
  const financing = activity("financing");
  const netChange = operating.total + investing.total + financing.total;
  const base = { investing, financing, netChange, beginningCash, endingCash: beginningCash + netChange, nonCashActivities };

  const { netIncome } = incomeStatement(book, at);
  const indirect: IndirectOperating = {
    netIncome,
    adjustments: adjustments.lines(),
    currentAssets: currentAssets.lines(),
    currentLiabilities: currentLiabilities.lines(),
    total: 0,
  };
  indirect.total = netIncome + total(indirect.adjustments) + total(indirect.currentAssets) + total(indirect.currentLiabilities);
  return { direct: { method: "direct", operating, ...base }, indirect: { method: "indirect", operating: indirect, ...base } };
}

const inferring = memo((book: Book, at: At) => compute(book, at, true));
const tagsOnly = memo((book: Book, at: At) => compute(book, at, false));

/**
 * The statement of cash flows after the first `at` entries, by the direct
 * method (each entry's cash, by section) or the indirect method (net
 * income adjusted for non-cash items and changes in working capital). Both
 * give the same operating total and net change in cash. Closing entries are
 * left out, and the opening balances give the beginning cash.
 */
export function cashFlow(book: Book, method: "direct", at?: number, settings?: EntrypadSettings): DirectCashFlow;
export function cashFlow(book: Book, method: "indirect", at?: number, settings?: EntrypadSettings): IndirectCashFlow;
export function cashFlow(book: Book, method: CashFlowMethod, at?: number, settings?: EntrypadSettings): CashFlow;
export function cashFlow(book: Book, method: CashFlowMethod, at?: number, settings: EntrypadSettings = defaultSettings()): CashFlow {
  const both = (settings.cashFlow.inferSections ? inferring : tagsOnly)(book, at);
  return method === "direct" ? both.direct : both.indirect;
}
