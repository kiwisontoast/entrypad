import { defaultSettings } from "./settings.js";
import type { EntrypadSettings } from "./settings.js";
import type { Account } from "./types.js";

type MatchSettings = Pick<EntrypadSettings, "accounts">;

/** Spaces, tabs and non-breaking spaces. */
const SPACE_RUN = /[\s ]+/g;

function normaliser(s: EntrypadSettings["accounts"]): (text: string) => string {
  return (text) => {
    let t = text.trim();
    if (s.collapseSpaces) t = t.replace(SPACE_RUN, " ");
    if (s.ignoreCase) t = t.toLowerCase();
    return t;
  };
}

interface MatchIndex {
  names: Map<string, Account>;
  aliases: Map<string, Account>;
  ids: Map<string, Account>;
}

const indexCache = new WeakMap<readonly Account[], Map<string, MatchIndex>>();

function settingsKey(s: EntrypadSettings["accounts"]): string {
  return `${+s.ignoreCase}${+s.collapseSpaces}${+s.matchAliases}${+s.matchIds}`;
}

/**
 * Builds lookup tables once per chart and settings combination. The first
 * account to claim a key keeps it, so chart order breaks ties.
 */
function indexFor(chart: readonly Account[], s: EntrypadSettings["accounts"]): MatchIndex {
  let byKey = indexCache.get(chart);
  if (!byKey) indexCache.set(chart, (byKey = new Map()));
  const key = settingsKey(s);
  const cached = byKey.get(key);
  if (cached) return cached;

  const norm = normaliser(s);
  const index: MatchIndex = { names: new Map(), aliases: new Map(), ids: new Map() };
  const claim = (map: Map<string, Account>, text: string, account: Account) => {
    const k = norm(text);
    if (k && !map.has(k)) map.set(k, account);
  };
  for (const account of chart) {
    claim(index.names, account.name, account);
    if (s.matchAliases) for (const alias of account.aliases ?? []) claim(index.aliases, alias, account);
    if (s.matchIds) claim(index.ids, account.id, account);
  }
  byKey.set(key, index);
  return index;
}

/**
 * Finds the account a posting names, following the `accounts.*` settings.
 * A full name wins over an alias, and an alias over an id. Returns undefined
 * when nothing matches.
 */
export function matchAccount(
  name: string,
  chart: readonly Account[],
  settings: MatchSettings = defaultSettings(),
): Account | undefined {
  const s = settings.accounts;
  const key = normaliser(s)(name);
  if (!key) return undefined;
  const index = indexFor(chart, s);
  return index.names.get(key) ?? index.aliases.get(key) ?? index.ids.get(key);
}

/**
 * Edit distance counting insertions, deletions, substitutions and swaps of
 * two neighbouring characters (optimal string alignment).
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const cols = b.length + 1;
  let prevPrev = new Array<number>(cols).fill(0);
  let prev = Array.from({ length: cols }, (_, j) => j);
  let row = new Array<number>(cols).fill(0);
  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, prevPrev[j - 2]! + 1);
      }
      row[j] = d;
    }
    [prevPrev, prev, row] = [prev, row, prevPrev];
  }
  return prev[b.length]!;
}

const loose = (text: string) => text.trim().replace(SPACE_RUN, " ").toLowerCase();

/**
 * How far `query` is from `candidate`. A candidate that starts with the
 * query, or contains it as whole words, counts as close: "Accumulated
 * Depreciation" is near "Accumulated Depreciation, Equipment".
 */
function score(query: string, candidate: string): number {
  const distance = editDistance(query, candidate);
  if (query.length >= 3) {
    const at = candidate.indexOf(query);
    const before = candidate[at - 1];
    const after = candidate[at + query.length];
    const wholeWords = at >= 0 && (at === 0 || !/[a-z0-9]/.test(before!)) && (after === undefined || !/[a-z0-9]/.test(after));
    if (wholeWords) return Math.min(distance, 1.5);
  }
  return distance;
}

/** The largest score still worth suggesting for a query of this length. */
const threshold = (length: number) => Math.max(2, Math.ceil(length * 0.4));

/**
 * The nearest accounts to a name that matched nothing, best first, for a
 * "did you mean" fix. Compares against names and aliases without regard to
 * case or spacing, and leaves out anything too far away to be a typo.
 */
export function suggestAccounts(name: string, chart: readonly Account[], limit = 3): Account[] {
  const query = loose(name);
  if (!query) return [];
  const max = threshold(query.length);
  const ranked: { account: Account; score: number; order: number }[] = [];
  chart.forEach((account, order) => {
    let best = Infinity;
    for (const text of [account.name, ...(account.aliases ?? [])]) {
      best = Math.min(best, score(query, loose(text)));
    }
    if (best <= max) ranked.push({ account, score: best, order });
  });
  ranked.sort((a, b) => a.score - b.score || a.order - b.order);
  return ranked.slice(0, limit).map((r) => r.account);
}
