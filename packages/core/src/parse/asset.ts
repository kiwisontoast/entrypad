import { matchAccount } from "../accounts.js";
import type { Diagnostic, DiagnosticCode } from "../diagnostics.js";
import type { EntrypadSettings } from "../settings.js";
import type { Asset, Book, DepreciationMethod, SourceRange } from "../types.js";
import { parseAmount } from "./amount.js";
import type { ClassifiedLine } from "./classify.js";
import { isoDate, isRealDate, readFullDate } from "./date.js";
import { tokenize } from "./tokens.js";
import type { Span, Token } from "./tokens.js";

type Report = (f: { code: DiagnosticCode; message: string; target: Diagnostic["target"] }) => void;

/** The words that start each part of an `asset` line. An account name containing one is quoted. */
export const assetKeywords = ["account", "cost", "salvage", "life", "method", "units", "used", "from"] as const;
type Keyword = (typeof assetKeywords)[number];

export const depreciationMethods: readonly DepreciationMethod[] = ["straight-line", "double-declining", "units"];

const FORM =
  'Write it as: asset "Name" account Equipment cost 12,000 life 5 years from 2026-01-01, optionally with salvage 1,000 and method double-declining, or with units 100,000 used 2,400 in place of life';

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Reads `2026-01`, `Jan 2026` or `January 2026` as "2026-01". */
export function readMonth(text: string): string | undefined {
  const t = text.trim().replace(/\s+/g, " ");
  let m = /^([0-9]{4})-([0-9]{1,2})$/.exec(t);
  if (m) return +m[2]! >= 1 && +m[2]! <= 12 ? isoDate(+m[1]!, +m[2]!, 1).slice(0, 7) : undefined;
  m = /^([A-Za-z]+) ([0-9]{4})$/.exec(t);
  if (!m) return undefined;
  const name = m[1]!.toLowerCase();
  const index = MONTH_NAMES.findIndex((full) => full === name || full.slice(0, 3) === name || (name === "sept" && full === "september"));
  return index < 0 ? undefined : isoDate(+m[2]!, index + 1, 1).slice(0, 7);
}

/** A whole number of units, e.g. 100,000 or 2.5k. */
function readUnits(word: string, settings: EntrypadSettings): number | undefined {
  if (word.includes("$")) return undefined;
  const r = parseAmount(word, settings);
  if (!r.ok || r.negative || r.cents % 100 !== 0) return undefined;
  return r.cents / 100;
}

/** `5 years`, `18 months` or `2.5 years`, as a whole number of months. */
function readLife(count: string, unit: string): number | undefined {
  const m = /^([0-9]+)(?:\.([0-9]+))?$/.exec(count);
  const perUnit = /^years?$/i.test(unit) ? 12 : /^months?$/i.test(unit) ? 1 : 0;
  if (!m || !perUnit) return undefined;
  const scale = 10 ** (m[2]?.length ?? 0);
  const scaled = Number(m[1]! + (m[2] ?? "")) * perUnit;
  if (scaled % scale !== 0 || scaled === 0) return undefined;
  return scaled / scale;
}

function slug(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "asset";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

const isKeyword = (t: Token): t is Token & { text: Keyword } =>
  !t.quoted && (assetKeywords as readonly string[]).includes(t.text.toLowerCase());

interface Part {
  key: Keyword;
  keyToken: Token;
  values: Token[];
}

/**
 * Reads every `asset` line into `book.assets`. A line with a part that
 * can't be read is flagged and left out, so no schedule is drawn from a
 * guess; an account name that isn't in the chart is kept as written and
 * flagged, as in a posting.
 */
export function readAssetLines(lines: ClassifiedLine[], book: Book, settings: EntrypadSettings, report: Report): void {
  const assets: Asset[] = [];
  const ids = new Set<string>();

  for (const line of lines) {
    if (line.kind !== "directive" || line.keyword !== "asset") continue;
    const abs = (span: Span): SourceRange => ({ from: line.from + span.from, to: line.from + span.to });
    const source = abs({ from: line.start, to: line.end });
    let ok = true;
    const flag = (code: DiagnosticCode, message: string, span?: Span) => {
      ok = false;
      report({ code, message, target: { source: span ? abs(span) : source } });
    };

    const tokens = tokenize(line.text, { from: line.start + "asset".length, to: line.end });
    if (!tokens || !tokens.length || !tokens[0]!.quoted || !tokens[0]!.text.trim()) {
      flag("unreadable-line", FORM);
      continue;
    }
    const name = tokens[0]!.text.trim();

    // Split the rest into parts, each a keyword and the words up to the next one.
    // `method` takes exactly one word, so `method units` reads as a method.
    const parts: Part[] = [];
    for (const t of tokens.slice(1)) {
      const current = parts[parts.length - 1];
      if (current?.key === "method" && !current.values.length) current.values.push(t);
      else if (isKeyword(t)) parts.push({ key: t.text.toLowerCase() as Keyword, keyToken: t, values: [] });
      else if (current && current.key !== "method") current.values.push(t);
      else {
        flag("unreadable-line", `"${t.text}" isn't part of an asset line. ${FORM}`, t.span);
        break;
      }
    }
    if (!ok) continue;

    const seen = new Set<Keyword>();
    let account: { name: string; span: Span } | undefined;
    let cost: number | undefined;
    let salvage = 0;
    let life: number | undefined;
    let method: DepreciationMethod | undefined;
    let units: number | undefined;
    let from: string | undefined;
    const used: { units: number; month?: string; span: Span }[] = [];

    for (const part of parts) {
      const span: Span = { from: part.keyToken.span.from, to: part.values[part.values.length - 1]?.span.to ?? part.keyToken.span.to };
      const valueSpan: Span | undefined = part.values.length
        ? { from: part.values[0]!.span.from, to: part.values[part.values.length - 1]!.span.to }
        : undefined;
      const valueText = valueSpan ? line.text.slice(valueSpan.from, valueSpan.to) : "";
      if (part.key !== "used" && seen.has(part.key)) {
        flag("unreadable-line", `This asset line gives ${part.key} more than once`, span);
        continue;
      }
      seen.add(part.key);
      if (!valueSpan) {
        flag("unreadable-line", `Write a value after ${part.key}. ${FORM}`, span);
        continue;
      }
      const one = part.values.length === 1 ? part.values[0]!.text : undefined;

      switch (part.key) {
        case "account": {
          const first = part.values[0]!;
          if (first.quoted && part.values.length > 1) flag("unreadable-line", "Only one account name can follow account", span);
          else account = { name: first.quoted ? first.text.trim() : valueText, span: valueSpan };
          break;
        }
        case "cost":
        case "salvage": {
          const r = one === undefined ? undefined : parseAmount(one, settings);
          if (!r || !r.ok || r.negative) {
            const problem = !r ? "isn't a single amount" : !r.ok ? r.problem : "is negative";
            flag("invalid-amount", `The ${part.key} "${valueText}" ${problem}`, valueSpan);
          } else if (part.key === "cost") cost = r.cents;
          else salvage = r.cents;
          break;
        }
        case "life": {
          const months = part.values.length === 2 ? readLife(part.values[0]!.text, part.values[1]!.text) : undefined;
          if (months === undefined) flag("unreadable-line", "Write the life as a number of years or months, e.g. life 5 years or life 18 months", span);
          else life = months;
          break;
        }
        case "method": {
          const m = depreciationMethods.find((d) => d === one?.toLowerCase());
          if (!m) flag("unreadable-line", `"${valueText}" isn't a method. The methods are ${depreciationMethods.join(", ")}.`, valueSpan);
          else method = m;
          break;
        }
        case "units": {
          const n = one === undefined ? undefined : readUnits(one, settings);
          if (!n) flag("invalid-amount", `The units "${valueText}" should be a whole number above zero, e.g. units 100,000`, valueSpan);
          else units = n;
          break;
        }
        case "used": {
          const n = readUnits(part.values[0]!.text, settings);
          const hasMonth = part.values.length > 1;
          const monthTokens = part.values.slice(2);
          const month = monthTokens.length
            ? readMonth(line.text.slice(monthTokens[0]!.span.from, monthTokens[monthTokens.length - 1]!.span.to))
            : undefined;
          if (n === undefined) flag("invalid-amount", `The units used "${part.values[0]!.text}" should be a whole number, e.g. used 2,400`, part.values[0]!.span);
          else if (hasMonth && (part.values[1]!.text.toLowerCase() !== "in" || !month)) {
            flag("invalid-date", "Write the month the units were used in as: used 2,400 in Jan 2026", span);
          } else used.push({ units: n, ...(month && { month }), span });
          break;
        }
        case "from": {
          const d = readFullDate(valueText, settings);
          if (!d || !isRealDate(d.year, d.month, d.day)) flag("invalid-date", `"${valueText}" isn't a real date with a year, e.g. from 2026-01-01`, valueSpan);
          else from = isoDate(d.year, d.month, d.day);
          break;
        }
      }
    }
    if (!ok) continue;

    const missing = (["account", "cost", "from"] as const).filter((k) => !seen.has(k));
    if (missing.length) {
      flag("unreadable-line", `This asset line has no ${missing.join(" or ")}. ${FORM}`);
      continue;
    }
    method ??= units !== undefined ? "units" : "straight-line";
    if (method === "units") {
      if (units === undefined) flag("unreadable-line", "The units method needs the total units expected, e.g. units 100,000");
      else if (life !== undefined) flag("unreadable-line", "The units method takes its life from the units, so leave out life");
    } else if (life === undefined) {
      flag("unreadable-line", `The ${method} method needs a life, e.g. life 5 years`);
    } else if (units !== undefined || used.length) {
      flag("unreadable-line", `units and used apply only to the units method, not ${method}`);
    }
    if (salvage > cost!) flag("invalid-amount", "The salvage value is more than the cost");
    if (!ok) continue;

    const matched = matchAccount(account!.name, book.chart, settings);
    if (matched && (matched.type !== "asset" || matched.contraOf !== undefined)) {
      const article = matched.type === "expense" || matched.type === "equity" ? "an" : "a";
      const kind = matched.contraOf !== undefined ? "a contra account" : `${article} ${matched.type} account`;
      flag("unreadable-line", `${matched.name} is ${kind}. An asset line needs the asset account, such as Equipment.`, account!.span);
      continue;
    }
    if (!matched) {
      report({ code: "unknown-account", message: `"${account!.name}" isn't in the chart`, target: { account: account!.name, source: abs(account!.span) } });
    }

    // Units without a month were used in the last month of the book's period.
    const byMonth = new Map<string, number>();
    const firstMonth = from!.slice(0, 7);
    for (const u of used) {
      const month = u.month ?? book.period?.end.slice(0, 7);
      if (!month) {
        flag("invalid-date", "This book has no period, so say which month the units were used in: used 2,400 in Jan 2026", u.span);
      } else if (month < firstMonth) {
        flag("invalid-date", `The asset is in service from ${from}, so it can't have units used before then`, u.span);
      } else byMonth.set(month, (byMonth.get(month) ?? 0) + u.units);
    }
    if (!ok) continue;

    assets.push({
      id: slug(name, ids),
      name,
      account: matched?.id ?? account!.name,
      cost: cost!,
      salvage,
      ...(life !== undefined && { life }),
      method,
      ...(units !== undefined && { units }),
      ...(method === "units" && {
        usage: [...byMonth].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, n]) => ({ month, units: n })),
      }),
      from: from!,
      source,
    });
  }
  if (assets.length) book.assets = assets;
}
