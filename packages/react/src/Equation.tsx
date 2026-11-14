import { equation } from "@entrypad/core";
import type { Equation as EquationTotals } from "@entrypad/core";
import { useMemo } from "react";
import { useHighlight } from "./highlight.js";
import { money, resolveTheme, squiggle } from "./visual.js";
import type { VisualProps } from "./visual.js";

export type EquationProps = Omit<VisualProps, "onBookChange" | "accounts">;

// Layout, in SVG user units.
const PAD = 20;
const TOP = 56;
const BAR_H = 240;
const BAR_W = 96;
const LABEL_H = 64;

/**
 * Assets = Liabilities + Equity as two stacked bars drawn to the same scale,
 * so a balanced book always shows two bars of the same height. Equity is
 * split into the equity accounts and net income not yet closed to them.
 * Hovering a line in another visual marks how its entry moved each bar.
 */
export function Equation(props: EquationProps) {
  const { book, at, showDiagnostics = false } = props;
  const theme = resolveTheme(props.theme);
  const { value: highlight } = useHighlight();
  const eq = equation(book, at);

  // What the highlighted entry did: the equation just before and just after it.
  const delta = useMemo(() => {
    if (!highlight) return null;
    const index = book.entries.findIndex((e) => e.id === highlight.entry);
    if (index < 0 || (at !== undefined && index >= at)) return null;
    const before = equation(book, index);
    const after = equation(book, index + 1);
    return {
      assets: after.assets - before.assets,
      liabilities: after.liabilities - before.liabilities,
      equity: after.equity - before.equity,
    };
  }, [book, at, highlight]);

  const width = Math.min(props.maxWidth ?? 480, 480);
  const right = eq.liabilities + eq.equity;
  const scale = BAR_H / Math.max(eq.assets, right, Math.abs(eq.liabilities) + Math.abs(eq.equity), 1);
  const h = (cents: number) => Math.max(0, cents) * scale;
  const leftX = PAD + 24;
  const rightX = width - PAD - 24 - BAR_W;
  const base = TOP + BAR_H;
  const unbalanced = !eq.balanced;

  const segments: { id: string; label: string; value: number; y: number; height: number; fill: string; changed: number }[] = [];
  let y = base;
  for (const [id, label, value, fill, changed] of [
    ["eq-liabilities", "Liabilities", eq.liabilities, theme.warning, delta?.liabilities ?? 0],
    ["eq-equity-accounts", "Equity", eq.equityAccounts, theme.accent, 0],
    ["eq-net-income", "Net income", eq.netIncome, theme.hint, 0],
  ] as const) {
    const height = h(value);
    y -= height;
    segments.push({ id, label, value, y, height, fill, changed });
  }
  const equityChanged = delta?.equity ?? 0;

  const signed = (cents: number) => (cents > 0 ? `+${money(cents, book)}` : `-${money(-cents, book)}`);
  const summary = `Assets ${money(eq.assets, book)} ${eq.balanced ? "equal" : "don't equal"} liabilities ${money(eq.liabilities, book)} plus equity ${money(eq.equity, book)}`;

  return (
    <div role="img" aria-label={summary} style={{ display: "inline-block", maxWidth: "100%", fontFamily: theme.font }}>
      <svg width={width} height={TOP + BAR_H + LABEL_H} viewBox={`0 0 ${width} ${TOP + BAR_H + LABEL_H}`} style={{ maxWidth: "100%", height: "auto" }}>
        <rect width={width} height={TOP + BAR_H + LABEL_H} fill={theme.canvas} />
        <text x={width / 2} y={30} textAnchor="middle" fontSize={13} fontWeight={600} fill={theme.ink}>
          Assets = Liabilities + Equity
        </text>
        <line x1={PAD} y1={base} x2={width - PAD} y2={base} stroke={theme.border} />

        <g id="eq-assets">
          <rect
            x={leftX}
            y={base - h(eq.assets)}
            width={BAR_W}
            height={h(eq.assets)}
            fill={theme.ink}
            fillOpacity={0.78}
            stroke={delta?.assets ? theme.accent : "none"}
            strokeWidth={2}
          />
          <text x={leftX + BAR_W / 2} y={base + 20} textAnchor="middle" fontSize={12} fontWeight={600} fill={theme.ink}>
            Assets
          </text>
          <text x={leftX + BAR_W / 2} y={base + 36} textAnchor="middle" fontSize={12} fill={theme.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
            {money(eq.assets, book)}
          </text>
          {delta?.assets ? (
            <text x={leftX + BAR_W / 2} y={base - h(eq.assets) - 8} textAnchor="middle" fontSize={12} fontWeight={600} fill={theme.accent}>
              {signed(delta.assets)}
            </text>
          ) : null}
        </g>

        <text x={width / 2} y={base - BAR_H / 2} textAnchor="middle" fontSize={22} fill={theme.muted}>
          =
        </text>
        {showDiagnostics && unbalanced ? (
          <path data-entrypad-layer="diagnostics" id="dx-equation" transform={`translate(${width / 2 - 14}, ${base - BAR_H / 2 + 8})`} d={squiggle(28)} fill="none" stroke={theme.error} strokeWidth={1.25}>
            <title>{`Assets (${money(eq.assets, book)}) don't equal liabilities plus equity (${money(right, book)})`}</title>
          </path>
        ) : null}

        {segments.map((s) => (
          <g id={s.id} key={s.id}>
            {/* Net income is drawn lighter: it is equity that hasn't been closed to retained earnings yet. */}
            <rect x={rightX} y={s.y} width={BAR_W} height={s.height} fill={s.fill} fillOpacity={s.id === "eq-net-income" ? 0.45 : 0.78} stroke={s.changed ? theme.accent : "none"} strokeWidth={2} />
            {s.height >= 16 ? (
              <text x={rightX + BAR_W / 2} y={s.y + s.height / 2 + 4} textAnchor="middle" fontSize={11} fill={s.id === "eq-net-income" ? theme.ink : theme.surface}>
                {s.label}
              </text>
            ) : null}
          </g>
        ))}
        {delta?.liabilities || equityChanged ? (
          <text x={rightX + BAR_W / 2} y={base - h(eq.liabilities) - h(eq.equityAccounts) - h(eq.netIncome) - 8} textAnchor="middle" fontSize={12} fontWeight={600} fill={theme.accent}>
            {[delta?.liabilities ? `L ${signed(delta.liabilities)}` : "", equityChanged ? `E ${signed(equityChanged)}` : ""].filter(Boolean).join("  ")}
          </text>
        ) : null}
        <text x={rightX + BAR_W / 2} y={base + 20} textAnchor="middle" fontSize={12} fontWeight={600} fill={theme.ink}>
          Liabilities + Equity
        </text>
        <text x={rightX + BAR_W / 2} y={base + 36} textAnchor="middle" fontSize={12} fill={theme.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
          {`${money(eq.liabilities, book)} + ${money(eq.equity, book)}`}
        </text>
      </svg>
    </div>
  );
}

export type { EquationTotals };
