import type { Diagnostic } from "./diagnostics.js";
import { formatAmount } from "./format.js";
import { daysInMonth, isoDate } from "./parse/date.js";
import { OPENING_ENTRY_ID } from "./parse/parse.js";
import type { Rule, RuleFinding } from "./rules.js";
import { defaultSettings } from "./settings.js";
import type { EntrypadSettings } from "./settings.js";
import type { Account, Asset, Book, Entry, Line } from "./types.js";

export type ScheduleGrain = "month" | "year";

/** One month or year of an asset's depreciation. Amounts are integer cents. */
export interface ScheduleRow {
  /** 1 for the first month (or year) of depreciation. */
  number: number;
  /** ISO dates of the first and last day the row covers. */
  start: string;
  end: string;
  /** Book value at the start: cost less accumulated depreciation. */
  opening: number;
  depreciation: number;
  /** Accumulated depreciation at the end. */
  accumulated: number;
  /** Book value at the end. */
  closing: number;
  /** Units-of-production method: the units used in the row. */
  units?: number;
}

export interface DepreciationSchedule {
  asset: Asset;
  grain: ScheduleGrain;
  /** Cost less salvage: what the rows add up to once the asset is fully depreciated. */
  depreciable: number;
  rows: ScheduleRow[];
}

export interface ScheduleOptions {
  /** Monthly rows (the default) or one row per year of the asset's life, counted from its first month. */
  grain?: ScheduleGrain;
  /** For `schedules.firstMonth`. */
  settings?: EntrypadSettings;
}

/** Months as one running number, so ranges are simple arithmetic. */
const monthIndex = (iso: string) => +iso.slice(0, 4) * 12 + (+iso.slice(5, 7) - 1);
const yearOf = (i: number) => Math.floor(i / 12);
const monthStart = (i: number) => isoDate(yearOf(i), (i % 12) + 1, 1);
const monthEnd = (i: number) => isoDate(yearOf(i), (i % 12) + 1, daysInMonth(yearOf(i), (i % 12) + 1));

/** a × b ÷ c for non-negative integers, rounded half up, without leaving integer arithmetic. */
function mulDivRound(a: number, b: number, c: number): number {
  const [x, y, z] = [BigInt(a), BigInt(b), BigInt(c)];
  return Number((2n * x * y + z) / (2n * z));
}

/** Splits an amount over some months: each takes the share rounded down to the cent, and the last takes what is left. */
function spread(total: number, months: number): number[] {
  const each = Math.floor(total / months);
  return Array.from({ length: months }, (_, i) => (i === months - 1 ? total - each * (months - 1) : each));
}

/** The month depreciation starts in, and the depreciation for each month from then on. */
function monthly(asset: Asset, settings: EntrypadSettings): { first: number; amounts: number[]; units?: number[] } {
  const base = asset.cost - asset.salvage;
  const inService = monthIndex(asset.from);

  if (asset.method === "units") {
    const total = asset.units ?? 0;
    const usage = new Map((asset.usage ?? []).map((u) => [monthIndex(u.month), u.units]));
    const last = Math.max(inService - 1, ...usage.keys());
    const amounts: number[] = [];
    const units: number[] = [];
    let used = 0;
    let remaining = base;
    for (let m = inService; m <= last; m++) {
      const n = usage.get(m) ?? 0;
      used += n;
      // Once the expected units are reached, the rest of the depreciable amount goes, so the total is exact.
      const amount = total <= 0 ? 0 : used >= total ? remaining : Math.min(remaining, mulDivRound(n, base, total));
      remaining -= amount;
      amounts.push(amount);
      units.push(n);
    }
    return { first: inService, amounts, units };
  }

  const life = asset.life ?? 0;
  const first = inService + (settings.schedules.firstMonth === "next-month" ? 1 : 0);
  if (life <= 0) return { first, amounts: [] };
  if (asset.method === "straight-line") return { first, amounts: spread(base, life) };

  // Double-declining balance: each year takes twice the straight-line rate
  // (2 / life in years, which is 24 / life in months) of the book value at
  // the start of that year, never going below salvage. The final year takes
  // the book value down to salvage.
  const amounts: number[] = [];
  const years = Math.ceil(life / 12);
  let bookValue = asset.cost;
  for (let y = 1; y <= years; y++) {
    const months = Math.min(12, life - 12 * (y - 1));
    const left = bookValue - asset.salvage;
    const year = y === years ? left : Math.min(mulDivRound(bookValue, 24, life), left);
    amounts.push(...spread(year, months));
    bookValue -= year;
  }
  return { first, amounts };
}

function rowsFor(asset: Asset, grain: ScheduleGrain, settings: EntrypadSettings): ScheduleRow[] {
  const { first, amounts, units } = monthly(asset, settings);
  const size = grain === "year" ? 12 : 1;
  const rows: ScheduleRow[] = [];
  let accumulated = 0;
  for (let i = 0; i < amounts.length; i += size) {
    const slice = amounts.slice(i, i + size);
    const depreciation = slice.reduce((s, a) => s + a, 0);
    const opening = asset.cost - accumulated;
    accumulated += depreciation;
    rows.push({
      number: i / size + 1,
      start: monthStart(first + i),
      end: monthEnd(first + i + slice.length - 1),
      opening,
      depreciation,
      accumulated,
      closing: asset.cost - accumulated,
      ...(units && { units: units.slice(i, i + size).reduce((s, n) => s + n, 0) }),
    });
  }
  return rows;
}

/**
 * The depreciation schedule for one asset, found by id or name. This is a
 * view: it posts nothing to the book. Rows cover the asset's whole life
 * (for units of production, up to the last month with units used); filter
 * them by date for a period.
 */
export function depreciationSchedule(book: Book, asset: string | Asset, options: ScheduleOptions = {}): DepreciationSchedule | undefined {
  const found = typeof asset === "string" ? book.assets?.find((a) => a.id === asset || a.name === asset) : asset;
  if (!found) return undefined;
  const grain = options.grain ?? "month";
  const settings = options.settings ?? defaultSettings();
  return { asset: found, grain, depreciable: found.cost - found.salvage, rows: rowsFor(found, grain, settings) };
}

/** The schedule of every asset in the book, in file order. */
export function depreciationSchedules(book: Book, options: ScheduleOptions = {}): DepreciationSchedule[] {
  return (book.assets ?? []).map((a) => depreciationSchedule(book, a, options)!);
}

/** The accumulated depreciation account for an asset: the first account in the chart that is a contra of the asset's account. */
export function contraAccount(book: Book, asset: Asset): Account | undefined {
  return book.chart.find((a) => a.contraOf === asset.account);
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (i: number) => `${MONTH_NAMES[i % 12]} ${yearOf(i)}`;
const monthRange = (from: number, to: number) =>
  from === to ? monthName(to) : yearOf(from) === yearOf(to) ? `${MONTH_NAMES[from % 12]} to ${monthName(to)}` : `${monthName(from)} to ${monthName(to)}`;
const dollars = (cents: number) => `$${formatAmount(cents)}`;
const listNames = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

function written(line: Line, amount: number): Line {
  const { blank: _blank, inferred: _inferred, ...rest } = line;
  return { ...rest, amount };
}

/**
 * The `depreciation-mismatch` check. For each accumulated depreciation
 * account that an asset's schedule credits, it compares what the book
 * credits to it with what the schedules call for, month by month, over the
 * book's period up to its latest entry. An entry that covers several months
 * (quarterly or yearly depreciation) is compared with the schedule for all
 * the months since the previous one. Scheduled depreciation after the last
 * such entry is reported as not recorded.
 */
export const depreciationMismatch: Rule<Book> = {
  code: "depreciation-mismatch",
  severity: "hint",
  check(book, { settings }) {
    const assets = book.assets ?? [];
    const period = book.period;
    const dated = book.entries.filter(
      (e) => e.id !== OPENING_ENTRY_ID && e.date !== undefined && (!period || (e.date >= period.start && e.date <= period.end)),
    );
    if (!assets.length || !dated.length) return [];
    const months = dated.map((e) => monthIndex(e.date!));
    const start = period ? monthIndex(period.start) : Math.min(...months);
    const end = Math.max(...months);

    const groups = new Map<string, { contra: Account; assets: Asset[]; scheduled: Map<number, number> }>();
    for (const asset of assets) {
      const contra = contraAccount(book, asset);
      if (!contra) continue;
      let group = groups.get(contra.id);
      if (!group) groups.set(contra.id, (group = { contra, assets: [], scheduled: new Map() }));
      group.assets.push(asset);
      const { first, amounts } = monthly(asset, settings);
      amounts.forEach((amount, k) => group!.scheduled.set(first + k, (group!.scheduled.get(first + k) ?? 0) + amount));
    }

    const out: RuleFinding[] = [];
    for (const { contra, assets: group, scheduled } of groups.values()) {
      const recorded = new Map<number, { amount: number; lines: { entry: Entry; index: number }[] }>();
      for (const entry of dated) {
        if (entry.tags?.includes("closing")) continue;
        entry.lines.forEach((line, index) => {
          if (line.account !== contra.id || line.side !== "cr") return;
          const m = monthIndex(entry.date!);
          const r = recorded.get(m) ?? { amount: 0, lines: [] };
          r.amount += line.amount;
          r.lines.push({ entry, index });
          recorded.set(m, r);
        });
      }

      const lead = (from: number, to: number) => {
        const names = group.filter((a) => {
          const { first, amounts } = monthly(a, settings);
          return amounts.some((x, k) => x > 0 && first + k >= from && first + k <= to);
        });
        const shown = listNames((names.length ? names : group).map((a) => a.name));
        return names.length > 1 ? `The schedules for ${shown} have` : `The schedule for ${shown} has`;
      };
      // Leading months with nothing scheduled are left out of the range a message names.
      const trim = (from: number, to: number) => {
        let m = from;
        while (m < to && !(scheduled.get(m) ?? 0)) m++;
        return m;
      };

      let owed = 0;
      let from = start;
      for (let m = start; m <= end; m++) {
        owed += scheduled.get(m) ?? 0;
        const r = recorded.get(m);
        if (!r) continue;
        if (r.amount !== owed) {
          // The fix runs later, after `owed` has moved on, so it keeps its own copy.
          const due = owed;
          const range = trim(from, m);
          const { entry, index } = r.lines[r.lines.length - 1]!;
          const line = entry.lines[index]!;
          const what = r.lines.length === 1 ? "this entry credits" : `the entries in ${monthName(m)} credit`;
          const other = entry.lines.filter((_, i) => i !== index);
          const fixes: Diagnostic["fixes"] =
            owed > 0 && r.lines.length === 1 && other.length === 1 && other[0]!.side === "dr"
              ? [
                  {
                    label: `Change the entry to ${dollars(owed)}`,
                    apply: (b: Book) => ({
                      ...b,
                      entries: b.entries.map((e) => (e.id === entry.id ? { ...e, lines: e.lines.map((l) => written(l, due)) } : e)),
                    }),
                  },
                ]
              : [];
          out.push({
            message: `${lead(range, m)} ${dollars(owed)} of depreciation for ${monthRange(range, m)}, and ${what} ${contra.name} with ${dollars(r.amount)}`,
            target: {
              entry: entry.id,
              line: index,
              account: contra.id,
              ...((line.source?.amount ?? line.source?.line) && { source: line.source!.amount ?? line.source!.line }),
            },
            ...(fixes.length && { fixes }),
          });
        }
        owed = 0;
        from = m + 1;
      }

      if (owed > 0) {
        const range = trim(from, end);
        const asset = group.find((a) => a.source) ?? group[0]!;
        const expense = book.chart.find((a) => a.id === "depreciation-expense");
        const fixes: Diagnostic["fixes"] = expense
          ? [
              {
                label: `Add an entry crediting ${contra.name} with ${dollars(owed)}`,
                apply: (b: Book) => {
                  const ids = new Set(b.entries.map((e) => e.id));
                  let id = `depreciation-${monthStart(end).slice(0, 7)}`;
                  for (let n = 2; ids.has(id); n++) id = `depreciation-${monthStart(end).slice(0, 7)}-${n}`;
                  const entry: Entry = {
                    id,
                    date: monthEnd(end),
                    memo: "Record depreciation",
                    tags: ["adjusting"],
                    lines: [
                      { account: expense.id, side: "dr", amount: owed },
                      { account: contra.id, side: "cr", amount: owed },
                    ],
                  };
                  return { ...b, entries: [...b.entries, entry] };
                },
              },
            ]
          : [];
        out.push({
          message: `${lead(range, end)} ${dollars(owed)} of depreciation for ${monthRange(range, end)}, and none of it is recorded`,
          target: { account: contra.id, ...(asset.source && { source: asset.source }) },
          ...(fixes.length && { fixes }),
        });
      }
    }
    return out;
  },
};
