import { trialBalance } from "@entrypad/core";
import type { TrialBalanceRow } from "@entrypad/core";
import { useMemo } from "react";
import { useHighlight } from "./highlight.js";
import {
  amountColumn,
  doubleBelow,
  FIGURES,
  firstBaseline,
  fitText,
  headingLines,
  longDate,
  ROW_H,
  ruleAbove,
  SIDE,
  SR_ONLY,
  StatementHeading,
  statementDates,
} from "./statementParts.js";
import { money, resolveTheme, squiggle } from "./visual.js";
import type { VisualProps } from "./visual.js";

export type TrialBalanceProps = Omit<VisualProps, "onBookChange">;

const PAD = 16;
const MAX_W = 480;
/** Space between the debit and credit columns. */
const COL_GAP = 18;

export const trialBalanceRowId = (accountId: string) => `tb-row-${accountId}`;

/**
 * Every account's balance in a debit or a credit column, with the totals
 * under a single rule and over a double one. Read-only. The rows of the
 * accounts in the entry being hovered or dragged in another visual light up.
 * `accounts` limits the rows to those accounts, in that order; the totals
 * are then the totals of the rows shown.
 */
export function TrialBalance(props: TrialBalanceProps) {
  const { book, at, showDiagnostics = false } = props;
  const theme = resolveTheme(props.theme);
  const { value: highlight } = useHighlight();
  const tb = trialBalance(book, at);

  const rows = useMemo<TrialBalanceRow[]>(() => {
    if (!props.accounts) return tb.rows;
    const byId = new Map(tb.rows.map((r) => [r.account.id, r]));
    return props.accounts.map((id) => byId.get(id)).filter((r): r is TrialBalanceRow => r !== undefined);
  }, [tb, props.accounts]);
  const debits = rows.reduce((s, r) => s + r.debit, 0);
  const credits = rows.reduce((s, r) => s + r.credit, 0);
  const balanced = debits === credits;

  // Accounts the highlighted entry posts to, if it is among the entries shown.
  const lit = useMemo(() => {
    if (!highlight) return new Set<string>();
    const index = book.entries.findIndex((e) => e.id === highlight.entry);
    if (index < 0 || (at !== undefined && index >= at)) return new Set<string>();
    return new Set(book.entries[index]!.lines.map((l) => l.account));
  }, [book, at, highlight]);

  const width = Math.max(260, Math.min(MAX_W, (props.maxWidth ?? MAX_W + 2 * PAD) - 2 * PAD));
  const cell = (cents: number) => (cents ? money(cents, book) : "");
  const colW = amountColumn([money(debits, book), money(credits, book), ...rows.map((r) => cell(r.debit || r.credit))]);
  const creditRight = width - SIDE;
  const debitRight = creditRight - colW - COL_GAP;
  const nameMax = debitRight - colW - 10 - SIDE;

  const { end } = statementDates(book, at);
  const lines = headingLines(book, "Trial Balance", end && longDate(end));
  const headerY = firstBaseline(lines.length) - 2;
  const top = headerY + 8 + 18;
  const totalY = top + rows.length * ROW_H + 6;
  const height = totalY + 22;
  const fullHeight = height + 2 * PAD;

  const summary = `Trial balance: debits ${money(debits, book)}, credits ${money(credits, book)}, ${balanced ? "in balance" : "out of balance"}.`;

  return (
    <div role="group" aria-label="Trial balance" style={{ display: "inline-block", position: "relative", maxWidth: "100%", fontFamily: theme.font }}>
      <svg
        role="img"
        aria-label={summary}
        width={width + 2 * PAD}
        height={fullHeight}
        viewBox={`0 0 ${width + 2 * PAD} ${fullHeight}`}
        style={{ maxWidth: "100%", height: "auto" }}
      >
        <rect width={width + 2 * PAD} height={fullHeight} fill={theme.canvas} />
        <g id="tb-statement" transform={`translate(${PAD}, ${PAD})`}>
          <rect width={width} height={height} rx={6} fill={theme.surface} stroke={theme.border} />
          <StatementHeading lines={lines} named={!!book.name} width={width} theme={theme} />
          <text x={SIDE} y={headerY} fontSize={11} fontWeight={600} fill={theme.muted}>
            Account
          </text>
          <text x={debitRight} y={headerY} textAnchor="end" fontSize={11} fontWeight={600} fill={theme.muted}>
            Debit
          </text>
          <text x={creditRight} y={headerY} textAnchor="end" fontSize={11} fontWeight={600} fill={theme.muted}>
            Credit
          </text>
          <line x1={SIDE} y1={headerY + 6} x2={width - SIDE} y2={headerY + 6} stroke={theme.border} />
          {rows.map((r, i) => {
            const y = top + i * ROW_H;
            const on = lit.has(r.account.id);
            return (
              <g key={r.account.id} id={trialBalanceRowId(r.account.id)} {...(on && { "data-entrypad-lit": "" })}>
                <title>{`${r.account.name}, ${r.debit ? `debit ${money(r.debit, book)}` : `credit ${money(r.credit, book)}`}`}</title>
                <rect x={6} y={y - 13} width={width - 12} height={ROW_H - 1} rx={3} fill={on ? theme.accentSoft : "transparent"} />
                <text x={SIDE} y={y} fontSize={12} fill={theme.ink}>
                  {fitText(r.account.name, nameMax, 12)}
                </text>
                <text x={debitRight} y={y} textAnchor="end" fontSize={12} fill={theme.ink} style={FIGURES}>
                  {cell(r.debit)}
                </text>
                <text x={creditRight} y={y} textAnchor="end" fontSize={12} fill={theme.ink} style={FIGURES}>
                  {cell(r.credit)}
                </text>
              </g>
            );
          })}
          <g id="tb-totals">
            {ruleAbove(debitRight, colW, totalY, theme)}
            {ruleAbove(creditRight, colW, totalY, theme)}
            <text x={SIDE} y={totalY} fontSize={12} fontWeight={600} fill={theme.ink}>
              Total
            </text>
            <text id="tb-debits" x={debitRight} y={totalY} textAnchor="end" fontSize={12} fontWeight={600} fill={theme.ink} style={FIGURES}>
              {money(debits, book)}
            </text>
            <text id="tb-credits" x={creditRight} y={totalY} textAnchor="end" fontSize={12} fontWeight={600} fill={theme.ink} style={FIGURES}>
              {money(credits, book)}
            </text>
            {doubleBelow(debitRight, colW, totalY, theme)}
            {doubleBelow(creditRight, colW, totalY, theme)}
          </g>
          {showDiagnostics && !balanced ? (
            <path
              id="dx-trial-balance"
              data-entrypad-layer="diagnostics"
              transform={`translate(${debitRight - colW}, ${totalY + 12})`}
              d={squiggle(creditRight - debitRight + colW)}
              fill="none"
              stroke={theme.error}
              strokeWidth={1.25}
            >
              <title>{`Debits (${money(debits, book)}) don't equal credits (${money(credits, book)})`}</title>
            </path>
          ) : null}
        </g>
      </svg>
      <table style={SR_ONLY}>
        <caption>Trial balance</caption>
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Debit</th>
            <th scope="col">Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.account.id}>
              <th scope="row">{r.account.name}</th>
              <td>{cell(r.debit)}</td>
              <td>{cell(r.credit)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Total</th>
            <td>{money(debits, book)}</td>
            <td>{money(credits, book)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
