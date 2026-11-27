import { balanceSheet, groupLabels, incomeStatement, retainedEarnings } from "@entrypad/core";
import type { Book, Line, StatementSection } from "@entrypad/core";
import { DraggableRenderer, translate } from "dragology";
import type { Draggable, Svgx } from "dragology";
import { memo, useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent } from "react";
import { useHighlight } from "./highlight.js";
import type { Highlight } from "./highlight.js";
import {
  amountColumn,
  doubleBelow,
  FIGURES,
  firstBaseline,
  fitText,
  headingLines,
  INDENT,
  longDate,
  periodLine,
  ROW_H,
  ruleAbove,
  SIDE,
  SR_ONLY,
  StatementHeading,
  statementDates,
} from "./statementParts.js";
import type { Theme } from "./theme.js";
import {
  amountStep,
  closestWith,
  DRAG_HANDLE,
  entryAttrs,
  highlightHandlers,
  KEEP_CLICKS,
  money,
  resolveTheme,
  scrubAmount,
  squiggle,
  useDragReporter,
  VisualShell,
  withAmount,
} from "./visual.js";
import type { InteractionProps, VisualProps } from "./visual.js";

export type StatementFlowProps = Omit<VisualProps, "accounts"> & InteractionProps;

interface FlowState {
  book: Book;
  highlight: Highlight | null;
}

// ---------------------------------------------------------------------------
// Scrubbing: the statements are views, so changing a figure changes an entry.
// ---------------------------------------------------------------------------

/** The posting a scrub of an income statement figure changes. */
export interface ScrubTarget {
  entryId: string;
  lineIndex: number;
  line: Line;
  /** The figure as the statement shows it, in cents (signed as on the statement). */
  amount: number;
  /** The side whose postings raise the figure: credits for revenue, debits for expenses. */
  raise: "dr" | "cr";
}

const isClosing = (tags: readonly string[] | undefined) => tags?.includes("closing") ?? false;

/** The income statement sections, with the side that raises each one's figures. */
const incomeSections = (book: Book, at: number | undefined): [StatementSection, "dr" | "cr"][] => {
  const is = incomeStatement(book, at);
  return [
    [is.revenue, "cr"],
    [is.costOfSales, "dr"],
    [is.operatingExpenses, "dr"],
    [is.otherRevenue, "cr"],
    [is.otherExpenses, "dr"],
    [is.incomeTaxes, "dr"],
  ];
};

/**
 * What scrubbing an account's income statement figure would change: the
 * account's most recent posting among the entries shown, closing entries
 * aside (the statement leaves those out too). Undefined when the account
 * isn't on the income statement.
 */
export function scrubTarget(book: Book, at: number | undefined, accountId: string): ScrubTarget | undefined {
  let found: [number, "dr" | "cr"] | undefined;
  for (const [section, raise] of incomeSections(book, at)) {
    const line = section.lines.find((l) => l.account.id === accountId);
    if (line) found = [line.amount, raise];
  }
  if (!found) return undefined;
  const entries = at === undefined ? book.entries : book.entries.slice(0, Math.max(0, at));
  for (let e = entries.length - 1; e >= 0; e--) {
    const entry = entries[e]!;
    if (isClosing(entry.tags)) continue;
    for (let i = entry.lines.length - 1; i >= 0; i--) {
      const line = entry.lines[i]!;
      if (line.account === accountId) return { entryId: entry.id, lineIndex: i, line, amount: found[0], raise: found[1] };
    }
  }
  return undefined;
}

/**
 * A copy of the book in which an income statement figure reads `to`
 * (a magnitude, as the figure is drawn) instead of its current value. The
 * book is the only state, so the difference goes into the account's most
 * recent posting (see `scrubTarget`) through `withAmount`, which also moves
 * the other side of a two-line entry so it stays balanced. A posting never
 * drops below the book's smallest unit, so the figure can only fall as far
 * as that posting allows.
 */
export function withStatementAmount(book: Book, target: ScrubTarget, to: number): Book {
  const direction = target.amount < 0 ? -1 : 1;
  const effect = (target.line.side === target.raise ? 1 : -1) * direction;
  const unit = book.settings.decimals === 2 ? 1 : 100;
  const next = Math.max(unit, target.line.amount + effect * (to - Math.abs(target.amount)));
  return withAmount(book, target.entryId, target.lineIndex, next);
}

// ---------------------------------------------------------------------------
// The statements as rows.
// ---------------------------------------------------------------------------

type Carry = "ni-out" | "ni-in" | "re-out" | "re-in";

interface Row {
  key: string;
  label: string;
  indent: 0 | 1 | 2;
  amount?: number;
  col?: "inner" | "outer";
  /** A single rule over this column, above the row: the figures above it add up to this one. */
  rule?: "inner" | "outer";
  /** A double rule below: a final total. */
  double?: boolean;
  strong?: boolean;
  head?: boolean;
  account?: string;
  /** Income statement lines: the side whose postings raise the figure. */
  raise?: "dr" | "cr";
  carry?: Carry;
  /** Extra space above the row. */
  space?: number;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** A section's heading and lines; a section of several lines gets an indented column and a total. */
function addSection(rows: Row[], title: string, s: StatementSection, total: string, base: 0 | 1, raise?: "dr" | "cr"): boolean {
  if (!s.lines.length) return false;
  rows.push({ key: `${s.id}-head`, label: title, indent: base, head: true, strong: base === 0, ...(rows.length && { space: base === 0 ? 6 : 3 }) });
  const indent = (base + 1) as 1 | 2;
  const single = s.lines.length === 1;
  for (const l of s.lines) {
    rows.push({ key: l.account.id, label: l.account.name, indent, amount: l.amount, col: single ? "outer" : "inner", account: l.account.id, ...(raise && { raise }) });
  }
  if (!single) rows.push({ key: `${s.id}-total`, label: total, indent: 1, amount: s.total, col: "outer", rule: "inner" });
  return true;
}

function incomeRows(book: Book, at: number | undefined): Row[] {
  const is = incomeStatement(book, at);
  const rows: Row[] = [];
  addSection(rows, "Revenue", is.revenue, "Total revenue", 0, "cr");
  const cos = addSection(rows, "Cost of sales", is.costOfSales, "Total cost of sales", 0, "dr");
  if (cos) rows.push({ key: "gross-profit", label: "Gross profit", indent: 0, amount: is.grossProfit, col: "outer", rule: "outer" });
  const opex = addSection(rows, "Operating expenses", is.operatingExpenses, "Total operating expenses", 0, "dr");
  const other = is.otherRevenue.lines.length + is.otherExpenses.lines.length + is.incomeTaxes.lines.length > 0;
  if (other && opex) rows.push({ key: "operating-income", label: "Operating income", indent: 0, amount: is.operatingIncome, col: "outer", rule: "outer" });
  addSection(rows, "Other revenue", is.otherRevenue, "Total other revenue", 0, "cr");
  addSection(rows, "Other expenses", is.otherExpenses, "Total other expenses", 0, "dr");
  if (is.incomeTaxes.lines.length) {
    rows.push({ key: "income-before-taxes", label: "Income before income taxes", indent: 0, amount: is.incomeBeforeTaxes, col: "outer", rule: "outer" });
    addSection(rows, "Income taxes", is.incomeTaxes, "Total income taxes", 0, "dr");
  }
  rows.push({
    key: "net-income",
    label: is.netIncome < 0 ? "Net loss" : "Net income",
    indent: 0,
    amount: is.netIncome,
    col: "outer",
    ...(rows.length && { rule: "outer" as const, space: 4 }),
    double: true,
    strong: true,
    carry: "ni-out",
  });
  return rows;
}

function retainedRows(book: Book, at: number | undefined): Row[] {
  const re = retainedEarnings(book, at);
  const loss = re.netIncome < 0;
  return [
    { key: "re-beginning", label: "Retained earnings, beginning", indent: 0, amount: re.beginning, col: "outer" },
    { key: "re-net-income", label: loss ? "Less: Net loss" : "Add: Net income", indent: 0, amount: Math.abs(re.netIncome), col: "outer", carry: "ni-in" },
    ...(re.dividends ? [{ key: "re-dividends", label: "Less: Dividends", indent: 0, amount: re.dividends, col: "outer" } as Row] : []),
    { key: "re-ending", label: "Retained earnings, ending", indent: 0, amount: re.ending, col: "outer", rule: "outer", double: true, strong: true, carry: "re-out" },
  ];
}

const EQUITY = "Stockholders’ equity";

function balanceRows(book: Book, at: number | undefined): Row[] {
  const bs = balanceSheet(book, at);
  const rows: Row[] = [{ key: "assets-head", label: "Assets", indent: 0, head: true, strong: true }];
  for (const s of bs.assets) addSection(rows, groupLabels[s.id], s, `Total ${lower(groupLabels[s.id])}`, 1);
  rows.push({ key: "total-assets", label: "Total assets", indent: 0, amount: bs.totalAssets, col: "outer", rule: "outer", double: true, strong: true, space: 2 });
  rows.push({ key: "le-head", label: `Liabilities and ${lower(EQUITY)}`, indent: 0, head: true, strong: true, space: 12 });
  for (const s of bs.liabilities) addSection(rows, groupLabels[s.id], s, `Total ${lower(groupLabels[s.id])}`, 1);
  if (bs.liabilities.length > 1) rows.push({ key: "total-liabilities", label: "Total liabilities", indent: 1, amount: bs.totalLiabilities, col: "outer", rule: "outer" });
  rows.push({ key: "equity-head", label: EQUITY, indent: 1, head: true, space: 3 });
  const equity: Row[] = [
    ...bs.contributedCapital.lines.map((l): Row => ({ key: l.account.id, label: l.account.name, indent: 2, amount: l.amount, account: l.account.id })),
    { key: "retained-earnings", label: "Retained earnings", indent: 2, amount: bs.retainedEarnings, carry: "re-in" },
  ];
  const single = equity.length === 1;
  for (const r of equity) rows.push({ ...r, col: single ? "outer" : "inner" });
  if (!single) rows.push({ key: "total-equity", label: `Total ${lower(EQUITY)}`, indent: 1, amount: bs.totalEquity, col: "outer", rule: "inner" });
  rows.push({
    key: "total-le",
    label: `Total liabilities and ${lower(EQUITY)}`,
    indent: 0,
    amount: bs.totalLiabilitiesAndEquity,
    col: "outer",
    rule: "outer",
    double: true,
    strong: true,
    space: 2,
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Layout.
// ---------------------------------------------------------------------------

type CardId = "is" | "re" | "bs";

interface Card {
  id: CardId;
  lines: string[];
  named: boolean;
  rows: Row[];
  baselines: number[];
  width: number;
  height: number;
  colW: number;
}

const outerRight = (c: Card) => c.width - SIDE;
const innerRight = (c: Card) => outerRight(c) - c.colW - 14;
const colRight = (c: Card, col: "inner" | "outer" | undefined) => (col === "inner" ? innerRight(c) : outerRight(c));

function makeCard(id: CardId, book: Book, title: string, date: string | undefined, rows: Row[], width: number): Card {
  const lines = headingLines(book, title, date);
  const baselines: number[] = [];
  let y = firstBaseline(lines.length);
  for (const r of rows) {
    y += r.space ?? 0;
    baselines.push(y);
    y += ROW_H + (r.double ? 3 : 0);
  }
  const colW = amountColumn(rows.filter((r) => r.amount !== undefined).map((r) => money(r.amount!, book)));
  return { id, lines, named: !!book.name, rows, baselines, width, height: (baselines.at(-1) ?? y) + 22, colW };
}

const PAD = 16;
/** Space between side-by-side statements, where the connectors run. */
const GAP_ROW = 44;
const GAP_TWO = 56;
/** Space between stacked statements. */
const GAP_STACK = 24;
/** Room to the right of stacked statements for the connectors. */
const RIGHT = 24;
const MIN_W = 300;

interface Placed extends Card {
  x: number;
  y: number;
}

interface FlowLayout {
  mode: "row" | "two" | "stack";
  cards: Placed[];
  connectors: { id: string; d: string; arrow: string; dot: [number, number] }[];
  width: number;
  height: number;
}

const carryY = (c: Placed, carry: Carry) => c.y + c.baselines[c.rows.findIndex((r) => r.carry === carry)]! - 4;

/** A connector leaving one statement's right edge and entering the next one's left edge. */
function across(id: string, x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  const end = x2 - 5;
  return {
    id,
    d: Math.abs(y1 - y2) < 0.5 ? `M${x1} ${y1} H${end}` : `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${end} ${y2}`,
    arrow: `M${x2} ${y2} L${x2 - 6} ${y2 - 3.5} L${x2 - 6} ${y2 + 3.5} Z`,
    dot: [x1, y1] as [number, number],
  };
}

/** A connector that loops out of a statement's right edge and back into the right edge of the one below. */
function loop(id: string, x: number, y1: number, y2: number, out: number) {
  const r = 6;
  const xm = x + out;
  return {
    id,
    d: `M${x} ${y1} H${xm - r} Q${xm} ${y1} ${xm} ${y1 + r} V${y2 - r} Q${xm} ${y2} ${xm - r} ${y2} H${x + 5}`,
    arrow: `M${x} ${y2} L${x + 6} ${y2 - 3.5} L${x + 6} ${y2 + 3.5} Z`,
    dot: [x, y1] as [number, number],
  };
}

function layoutFlow(book: Book, at: number | undefined, maxWidth: number): FlowLayout {
  const { start, end } = statementDates(book, at);
  const flowDate = periodLine(start, end);
  const pointDate = end && longDate(end);
  const rowW = Math.min(380, Math.floor((maxWidth - 2 * PAD - 2 * GAP_ROW) / 3));
  const twoW = Math.min(400, Math.floor((maxWidth - 2 * PAD - GAP_TWO) / 2));
  const mode = rowW >= MIN_W ? "row" : twoW >= MIN_W ? "two" : "stack";
  const width = mode === "row" ? rowW : mode === "two" ? twoW : Math.max(240, Math.min(440, maxWidth - 2 * PAD - RIGHT));

  const is = makeCard("is", book, "Income Statement", flowDate, incomeRows(book, at), width);
  const re = makeCard("re", book, "Statement of Retained Earnings", flowDate, retainedRows(book, at), width);
  const bs = makeCard("bs", book, "Balance Sheet", pointDate, balanceRows(book, at), width);
  const base = (c: Card, carry: Carry) => c.baselines[c.rows.findIndex((r) => r.carry === carry)]!;

  let placed: [Placed, Placed, Placed];
  if (mode === "row") {
    // The retained earnings statement drops so its net income lines up with the income statement's.
    const drop = Math.max(0, base(is, "ni-out") - base(re, "ni-in"));
    placed = [
      { ...is, x: PAD, y: PAD },
      { ...re, x: PAD + width + GAP_ROW, y: PAD + drop },
      { ...bs, x: PAD + 2 * (width + GAP_ROW), y: PAD },
    ];
  } else if (mode === "two") {
    placed = [
      { ...is, x: PAD, y: PAD },
      { ...re, x: PAD, y: PAD + is.height + GAP_STACK },
      { ...bs, x: PAD + width + GAP_TWO, y: PAD },
    ];
  } else {
    placed = [
      { ...is, x: PAD, y: PAD },
      { ...re, x: PAD, y: PAD + is.height + GAP_STACK },
      { ...bs, x: PAD, y: PAD + is.height + re.height + 2 * GAP_STACK },
    ];
  }
  const [pi, pr, pb] = placed;
  const connectors =
    mode === "row"
      ? [across("sf-carry-net-income", pi.x + width, carryY(pi, "ni-out"), pr.x, carryY(pr, "ni-in")), across("sf-carry-retained-earnings", pr.x + width, carryY(pr, "re-out"), pb.x, carryY(pb, "re-in"))]
      : mode === "two"
        ? [loop("sf-carry-net-income", pi.x + width, carryY(pi, "ni-out"), carryY(pr, "ni-in"), 16), across("sf-carry-retained-earnings", pr.x + width, carryY(pr, "re-out"), pb.x, carryY(pb, "re-in"))]
        : [loop("sf-carry-net-income", pi.x + width, carryY(pi, "ni-out"), carryY(pr, "ni-in"), 14), loop("sf-carry-retained-earnings", pr.x + width, carryY(pr, "re-out"), carryY(pb, "re-in"), 14)];
  const right = Math.max(...placed.map((c) => c.x + c.width)) + (mode === "stack" ? RIGHT : 0);
  const bottom = Math.max(...placed.map((c) => c.y + c.height));
  return { mode, cards: placed, connectors, width: right + PAD, height: bottom + PAD };
}

/** One layout per book, `at` and width; drags redraw the same state many times. */
const layoutCache = new WeakMap<Book, Map<string, FlowLayout>>();
function cachedLayout(book: Book, at: number | undefined, maxWidth: number): FlowLayout {
  let byKey = layoutCache.get(book);
  if (!byKey) layoutCache.set(book, (byKey = new Map()));
  const key = `${at ?? "all"}:${maxWidth}`;
  let layout = byKey.get(key);
  if (!layout) byKey.set(key, (layout = layoutFlow(book, at, maxWidth)));
  return layout;
}

// ---------------------------------------------------------------------------
// Drawing.
// ---------------------------------------------------------------------------

interface CardProps {
  card: Card;
  book: Book;
  /** Accounts in the highlighted entry, joined with "|", so the memo can compare them cheaply. */
  lit: string;
  /** Keys of the rows whose amounts are drawn as draggables instead. */
  live: string;
  theme: Theme;
}

const TITLES: Record<CardId, string> = { is: "Income Statement", re: "Statement of Retained Earnings", bs: "Balance Sheet" };

/** A statement's frame, heading, labels, rules and fixed figures. Opaque to Dragology (Phase 0 rule 2). */
const StatementCard = memo(function StatementCard(props: CardProps) {
  return statementCard(props);
});

function statementCard({ card, book, lit, live, theme }: CardProps): Svgx {
  const litSet = new Set(lit ? lit.split("|") : []);
  const liveSet = new Set(live ? live.split("|") : []);
  const parts: Svgx[] = [];
  card.rows.forEach((r, i) => {
    const y = card.baselines[i]!;
    const x = SIDE + r.indent * INDENT;
    const right = colRight(card, r.col);
    const on = r.account !== undefined && litSet.has(r.account);
    if (on) parts.push(<rect key={`${r.key}-lit`} x={6} y={y - 13} width={card.width - 12} height={ROW_H - 1} rx={3} fill={theme.accentSoft} />);
    const max = r.amount === undefined ? card.width - SIDE - x : right - card.colW - 8 - x;
    const label = fitText(r.label, max, 12, r.strong);
    parts.push(
      <text key={`${r.key}-label`} x={x} y={y} fontSize={12} fontWeight={r.strong ? 600 : 400} fill={theme.ink}>
        {label !== r.label && <title>{r.label}</title>}
        {label}
      </text>,
    );
    if (r.rule) parts.push(ruleAbove(colRight(card, r.rule), card.colW, y, theme, `${r.key}-rule`));
    if (r.amount !== undefined && !liveSet.has(r.key)) {
      const carried = r.carry !== undefined;
      parts.push(
        <text
          key={`${r.key}-amount`}
          x={right}
          y={y}
          textAnchor="end"
          fontSize={12}
          fontWeight={r.strong || carried ? 600 : 400}
          fill={carried ? theme.accent : r.amount < 0 && r.strong ? theme.error : theme.ink}
          style={FIGURES}
        >
          {money(r.amount, book)}
        </text>,
      );
    }
    if (r.double) parts.push(doubleBelow(right, card.colW, y, theme, `${r.key}-double`));
  });
  return (
    <g>
      <rect width={card.width} height={card.height} rx={6} fill={theme.surface} stroke={theme.border} />
      <StatementHeading lines={card.lines} named={card.named} width={card.width} theme={theme} />
      {parts}
    </g>
  );
}

interface ConnectorProps {
  connectors: FlowLayout["connectors"];
  theme: Theme;
}

/** The lines that carry net income and ending retained earnings from one statement to the next. */
const Connectors = memo(function Connectors({ connectors, theme }: ConnectorProps) {
  return (
    <g>
      {connectors.map((c) => (
        <g key={c.id} data-entrypad-carry={c.id}>
          <path d={c.d} fill="none" stroke={theme.accent} strokeWidth={1.4} />
          <path d={c.arrow} fill={theme.accent} />
          <circle cx={c.dot[0]} cy={c.dot[1]} r={2.6} fill={theme.accent} />
        </g>
      ))}
    </g>
  );
});

export const statementAmountId = (accountId: string, entryId: string, lineIndex: number) => `sf-amount-${accountId}-${entryId}-${lineIndex}`;
export const statementCardId = (id: CardId) => `sf-${id}`;

/** A box no pointer leaves, so a scrub keeps going wherever the pointer wanders. */
const EVERYWHERE = { x: -1e6, y: -1e6, width: 2e6, height: 2e6 };

function makeDraggable(
  at: number | undefined,
  maxWidth: number,
  showDiagnostics: boolean,
  theme: Theme,
  frames: boolean,
  editable: boolean,
  onRenderState: (() => void) | undefined,
): Draggable<FlowState> {
  return ({ state, d, draggedId }) => {
    onRenderState?.();
    const { book } = state;
    const layout = cachedLayout(book, at, maxWidth);
    const highlighted = state.highlight && book.entries.findIndex((e) => e.id === state.highlight!.entry);
    const litAccounts =
      highlighted !== null && highlighted >= 0 && (at === undefined || highlighted < at) ? [...new Set(book.entries[highlighted]!.lines.map((l) => l.account))].join("|") : "";
    const litSet = new Set(litAccounts ? litAccounts.split("|") : []);

    const amounts: Svgx[] = [];
    const liveKeys = new Map<CardId, string[]>();
    for (const card of layout.cards) {
      if (card.id !== "is") continue;
      card.rows.forEach((r, i) => {
        if (!r.raise || !r.account || r.amount === undefined) return;
        const target = scrubTarget(book, at, r.account);
        if (!target) return;
        liveKeys.set(card.id, [...(liveKeys.get(card.id) ?? []), r.key]);
        const id = statementAmountId(r.account, target.entryId, target.lineIndex);
        const name = r.label;
        const shown = money(r.amount, book);
        const entry = book.entries.find((e) => e.id === target.entryId);
        const lit = litSet.has(r.account) || draggedId === id;
        const step = amountStep(r.amount, book.settings.decimals);
        amounts.push(
          <g
            id={id}
            transform={translate(card.x + colRight(card, r.col), card.y + card.baselines[i]!)}
            dragologyZIndex={draggedId === id ? "/1" : false}
            data-entrypad-scrub={r.account}
            {...entryAttrs(target.entryId, target.lineIndex)}
            {...(editable && {
              ...DRAG_HANDLE,
              ...KEEP_CLICKS,
              tabIndex: 0,
              role: "button",
              style: { cursor: "ns-resize" },
              dragologyOnDrag: () =>
                scrubAmount(d, EVERYWHERE, Math.abs(r.amount!), step, (cents) => ({ ...state, book: withStatementAmount(state.book, target, cents) })),
            })}
          >
            <title>{`${name}, ${shown}${editable ? `. Drag up or down, or press the up or down arrow, to change it. This changes the most recent posting: ${entry?.memo ?? target.entryId}.` : ""}`}</title>
            <rect x={-card.colW - 4} y={-13} width={card.colW + 8} height={ROW_H - 1} rx={3} fill={lit ? theme.accentSoft : "transparent"} />
            <text textAnchor="end" fontSize={12} fill={theme.ink} style={FIGURES}>
              {shown}
            </text>
          </g>,
        );
      });
    }

    const bs = layout.cards.find((c) => c.id === "bs")!;
    const totalIndex = bs.rows.findIndex((r) => r.key === "total-le");
    const balanced = balanceSheet(book, at).balanced;

    return (
      <g>
        <rect width={layout.width} height={layout.height} fill={theme.canvas} />
        {layout.cards.map((card) => {
          const props: CardProps = { card, book, lit: litAccounts, live: (liveKeys.get(card.id) ?? []).join("|"), theme };
          return (
            <g id={statementCardId(card.id)} transform={translate(card.x, card.y)}>
              <title>{TITLES[card.id]}</title>
              <rect width={card.width} height={card.height} fill="none" />
              {frames ? <StatementCard {...props} /> : statementCard(props)}
            </g>
          );
        })}
        <g id="sf-connectors">
          <Connectors connectors={layout.connectors} theme={theme} />
        </g>
        {amounts}
        {showDiagnostics && !balanced ? (
          <path
            id="dx-balance-sheet"
            data-entrypad-layer="diagnostics"
            transform={translate(bs.x + outerRight(bs) - bs.colW, bs.y + bs.baselines[totalIndex]! + 11)}
            d={squiggle(bs.colW)}
            fill="none"
            stroke={theme.error}
            strokeWidth={1.25}
          >
            <title>{`Total assets (${money(balanceSheet(book, at).totalAssets, book)}) don't equal total liabilities and ${lower(EQUITY)} (${money(balanceSheet(book, at).totalLiabilitiesAndEquity, book)})`}</title>
          </path>
        ) : null}
      </g>
    );
  };
}

/**
 * The income statement, the statement of retained earnings and the balance
 * sheet, side by side when there is room and stacked when there isn't, with
 * net income carried along a connector into retained earnings and ending
 * retained earnings carried into the balance sheet's equity.
 *
 * Drag a revenue or expense figure up or down to change it, or focus it and
 * press the arrow keys (Shift for ten steps). Since the book is the only
 * state, this changes an entry: the account's most recent posting among the
 * entries shown moves by the difference, and the other side of a two-line
 * entry moves with it (see `withStatementAmount`). Net income, retained
 * earnings and equity follow.
 */
export function StatementFlow(props: StatementFlowProps) {
  const {
    book,
    onBookChange,
    showDiagnostics = false,
    at,
    maxWidth = 1200,
    staticPartsAsComponents = true,
    singlePointerDrags = true,
    touchScroll = true,
    onDragStatus,
  } = props;
  const theme = resolveTheme(props.theme);
  const store = useHighlight();
  const report = useDragReporter(store, onDragStatus);
  const editable = onBookChange !== undefined;
  const layout = cachedLayout(book, at, maxWidth);
  const refocus = useRef<{ container: HTMLElement; account: string } | null>(null);

  // A key press redraws the figure as a new element; put the focus back on it.
  useEffect(() => {
    const pending = refocus.current;
    if (!pending) return;
    refocus.current = null;
    const el = pending.container.querySelector<SVGElement>(`[data-entrypad-scrub="${pending.account}"]`);
    el?.focus();
  });

  /** The keyboard version of a scrub: one step per press, ten with Shift. */
  const nudge = (account: string, steps: number) => {
    const target = scrubTarget(book, at, account);
    if (!target) return;
    const from = Math.abs(target.amount);
    const step = amountStep(from, book.settings.decimals);
    const to = Math.max(step, from + steps * step);
    if (to !== from) onBookChange?.(withStatementAmount(book, target, to));
  };

  const handlers = {
    ...highlightHandlers(store),
    ...(editable && {
      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        const account = closestWith(e.target, "entrypad-scrub")?.getAttribute("data-entrypad-scrub");
        if (!account) return;
        e.preventDefault();
        refocus.current = { container: e.currentTarget, account };
        nudge(account, (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1));
      },
    }),
  };

  const onRender = useRef(props.onRenderState);
  onRender.current = props.onRenderState;
  const draggable = useMemo(
    () => makeDraggable(at, maxWidth, showDiagnostics, theme, staticPartsAsComponents, editable, () => onRender.current?.()),
    [at, maxWidth, showDiagnostics, theme, staticPartsAsComponents, editable],
  );
  const state = useMemo<FlowState>(() => ({ book, highlight: store.value }), [book, store.value]);

  const is = incomeStatement(book, at);
  const re = retainedEarnings(book, at);
  const bs = balanceSheet(book, at);
  const summary =
    `Net income of ${money(is.netIncome, book)} carries to the statement of retained earnings. ` +
    `Ending retained earnings of ${money(re.ending, book)} carry to the balance sheet. ` +
    `Total assets ${money(bs.totalAssets, book)}; total liabilities and ${lower(EQUITY)} ${money(bs.totalLiabilitiesAndEquity, book)}.`;

  return (
    <VisualShell
      label="Financial statements"
      theme={theme}
      singlePointerDrags={singlePointerDrags}
      touchScroll={touchScroll}
      onAbort={() => report("idle")}
      handlers={handlers}
    >
      {(epoch) => (
        <>
          <DraggableRenderer<FlowState>
            key={epoch}
            draggable={draggable}
            state={state}
            width={layout.width}
            height={layout.height}
            onDropState={(s) => {
              if (s.book !== book) onBookChange?.(s.book);
            }}
            onDragStatus={(s) => report(s.type)}
          />
          <p style={SR_ONLY} aria-live="polite">
            {summary}
          </p>
        </>
      )}
    </VisualShell>
  );
}
