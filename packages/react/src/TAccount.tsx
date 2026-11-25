import { ledger } from "@entrypad/core";
import type { Account, AccountLedger, Book, Diagnostic, LedgerRow } from "@entrypad/core";
import { DraggableRenderer, translate } from "dragology";
import type { Draggable, DragSpec, DragSpecBuilder, Svgx } from "dragology";
import { memo, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useHighlight } from "./highlight.js";
import type { Highlight } from "./highlight.js";
import type { Theme } from "./theme.js";
import {
  closestWith,
  DRAG_HANDLE,
  entryAttrs,
  highlightHandlers,
  amountStep,
  KEEP_CLICKS,
  lazyDropTarget,
  money,
  scrubAmount,
  withAmount,
  resolveTheme,
  squiggle,
  useDragReporter,
  useFindings,
  useVisibleAccounts,
  viewBook,
  VisualShell,
} from "./visual.js";
import type { InteractionProps, VisualProps } from "./visual.js";

export type TAccountProps = VisualProps & InteractionProps;

interface TState {
  book: Book;
  highlight: Highlight | null;
  /** The posting picked up by click or keyboard, waiting for a target account. */
  moving: string | null;
}

// Layout, in SVG user units.
const PAD = 16;
const GAP = 16;
const T_W_MAX = 184;
const T_W_MIN = 150;
const T_H = 132;
const ROW_TOP = 50;
const ROW_H = 17;
const MAX_ROWS = 4;

interface Layout {
  cols: number;
  tW: number;
  width: number;
  height: number;
}

function computeLayout(count: number, maxWidth: number): Layout {
  const fitCols = Math.max(1, Math.min(6, Math.floor((maxWidth - 2 * PAD + GAP) / (T_W_MIN + GAP))));
  const cols = Math.max(1, Math.min(fitCols, count));
  // On narrow screens, shrink the T-accounts rather than overflow.
  const fit = Math.floor((maxWidth - 2 * PAD - (cols - 1) * GAP) / cols);
  const tW = Math.max(T_W_MIN, Math.min(T_W_MAX, fit));
  const width = 2 * PAD + cols * (tW + GAP) - GAP;
  const rows = Math.max(1, Math.ceil(count / cols));
  return { cols, tW, width, height: 2 * PAD + rows * (T_H + GAP) - GAP };
}

interface FrameProps {
  name: string;
  width: number;
  normal: Account["normal"];
  lit: boolean;
  theme: Theme;
}

/**
 * The parts of a T-account that don't move during a drag. As a memoised
 * component it is opaque to Dragology, so it isn't walked or blended on
 * every frame (Phase 0 rule 2).
 */
const TFrame = memo(function TFrame(props: FrameProps) {
  return tFrame(props);
});

function tFrame({ name, width, normal, lit, theme }: FrameProps): Svgx {
  const balRight = normal === "debit" ? width / 2 - 10 : width - 12;
  const balLeft = normal === "debit" ? 12 : width / 2 + 10;
  const maxChars = Math.floor((width - 16) / 7);
  return (
    <g>
      <rect width={width} height={T_H} rx={6} fill={lit ? theme.accentSoft : theme.surface} stroke={lit ? theme.accent : theme.border} strokeWidth={lit ? 1.5 : 1} />
      <text transform={translate(width / 2, 21)} textAnchor="middle" fontSize={12.5} fontWeight={600} fill={theme.ink}>
        {name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name}
      </text>
      <line x1={12} y1={31} x2={width - 12} y2={31} stroke={theme.ink} strokeWidth={1.25} />
      <line x1={width / 2} y1={31} x2={width / 2} y2={T_H - 34} stroke={theme.ink} strokeWidth={1.25} />
      <line x1={balLeft} y1={T_H - 30} x2={balRight + 2} y2={T_H - 30} stroke={theme.border} />
      <text transform={translate(balLeft, T_H - 13)} fontSize={11} fill={theme.muted}>
        Bal.
      </text>
    </g>
  );
}

export const tAccountId = (accountId: string) => `t-${accountId}`;
export const postingId = (entryId: string, lineIndex: number) => `p-${entryId}-${lineIndex}`;
const postingKey = (r: LedgerRow) => `${r.entryId}:${r.lineIndex}`;

/** A copy of the book with one posting moved to another account. */
export function reclassify(book: Book, entryId: string, lineIndex: number, accountId: string): Book {
  return {
    ...book,
    entries: book.entries.map((e) =>
      e.id !== entryId ? e : { ...e, lines: e.lines.map((l, i) => (i === lineIndex ? { ...l, account: accountId } : l)) },
    ),
  };
}

/** Where the T-account at a given index sits, in canvas coordinates. */
function tPosition(layout: Layout, index: number) {
  return {
    x: PAD + (index % layout.cols) * (layout.tW + GAP),
    y: PAD + Math.floor(index / layout.cols) * (T_H + GAP),
  };
}

const tBox = (layout: Layout, index: number) => ({ ...tPosition(layout, index), width: layout.tW, height: T_H });

/**
 * Dragging a posting. While the pointer stays inside the posting's own
 * T-account, moving up or down changes the amount (and the other side of a
 * two-line entry with it). Once it leaves, the posting floats and drops onto
 * any other shown account to reclassify it; far from all of them, nothing
 * changes. Targets render their preview only when the pointer reaches them,
 * which keeps picking a posting up cheap.
 */
function dragPosting(
  d: DragSpecBuilder<TState>,
  state: TState,
  accounts: readonly Account[],
  layout: Layout,
  row: LedgerRow,
  from: string,
): DragSpec<TState> {
  const targets: DragSpec<TState>[] = [];
  let own: number | undefined;
  accounts.forEach((a, index) => {
    if (a.id === from) return void (own = index);
    targets.push(lazyDropTarget(d, tBox(layout, index), { ...state, book: reclassify(state.book, row.entryId, row.lineIndex, a.id), moving: null }));
  });
  const move = d.closest(targets).whenFar(state).withFloating();
  if (own === undefined) return move;
  const step = amountStep(row.amount, state.book.settings.decimals);
  // First in the list, so it wins the tie at the start of the drag.
  const scrub = scrubAmount(d, tBox(layout, own), row.amount, step, (cents) => ({
    ...state,
    book: withAmount(state.book, row.entryId, row.lineIndex, cents),
    moving: null,
  }));
  return d.closest([scrub, move]);
}

const isActivation = (e: KeyboardEvent) => e.key === "Enter" || e.key === " ";

function makeDraggable(
  accounts: readonly Account[],
  layout: Layout,
  at: number | undefined,
  findings: readonly Diagnostic[],
  theme: Theme,
  frames: boolean,
  editable: boolean,
  onRenderState: (() => void) | undefined,
): Draggable<TState> {
  const T_W = layout.tW;
  const abnormal = new Map(findings.filter((f) => f.code === "abnormal-balance" && f.target.account).map((f) => [f.target.account!, f]));

  return ({ state, d, draggedId }) => {
    onRenderState?.();
    const view = viewBook(state.book, at);
    const rows = ledger(view);
    const z = (id: string) => (draggedId === id ? "/1" : false);

    const drawPosting = (r: LedgerRow, account: Account, slot: number): Svgx => {
      const id = postingId(r.entryId, r.lineIndex);
      const key = postingKey(r);
      const colRight = r.side === "dr" ? T_W / 2 - 10 : T_W - 12;
      const lit = state.highlight?.entry === r.entryId;
      const picked = state.moving === key;
      const amount = money(r.amount, view);
      const side = r.side === "dr" ? "debit" : "credit";
      return (
        <g
          id={id}
          transform={translate(colRight, ROW_TOP + slot * ROW_H)}
          dragologyZIndex={z(id)}
          {...entryAttrs(r.entryId, r.lineIndex)}
          {...(editable && {
            ...DRAG_HANDLE,
            ...KEEP_CLICKS,
            "data-entrypad-posting": key,
            tabIndex: 0,
            role: "button",
            // Only ever "true" or absent: Dragology can't blend two different strings.
            ...(picked && { "aria-pressed": "true" }),
            dragologyOnDrag: () => dragPosting(d, state, accounts, layout, r, account.id),
          })}
        >
          {/* The accessible name lives in a <title>, not aria-label: Dragology
              blends attributes between states and can't blend two strings. */}
          <title>{`${account.name}, ${side} ${amount}${r.memo ? `, ${r.memo}` : ""}${editable ? ". Press Enter, then choose another account to move it. Press the up or down arrow to change the amount." : ""}`}</title>
          <rect
            x={-72}
            y={-13}
            width={78}
            height={17}
            rx={3}
            fill={picked || draggedId === id || lit ? theme.accentSoft : "transparent"}
            stroke={picked ? theme.accent : "none"}
          />
          <text textAnchor="end" fontSize={12} fill={theme.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
            {amount}
          </text>
        </g>
      );
    };

    const drawColumn = (posted: LedgerRow[], account: Account, side: "dr" | "cr"): Svgx[] => {
      const overflow = posted.length > MAX_ROWS;
      const shown = overflow ? posted.slice(posted.length - (MAX_ROWS - 1)) : posted;
      const out = shown.map((r, i) => drawPosting(r, account, overflow ? i + 1 : i));
      if (overflow) {
        const colRight = side === "dr" ? T_W / 2 - 10 : T_W - 12;
        out.unshift(
          <text id={`more-${account.id}-${side}`} transform={translate(colRight, ROW_TOP)} textAnchor="end" fontSize={11} fill={theme.muted}>
            {`${posted.length - (MAX_ROWS - 1)} earlier`}
          </text>,
        );
      }
      return out;
    };

    const position = (index: number) => tPosition(layout, index);

    const drawT = (account: Account, row: AccountLedger, index: number): Svgx => {
      const { x, y } = position(index);
      const lit = state.highlight !== null && row.rows.some((r) => r.entryId === state.highlight!.entry);
      const target = state.moving !== null;
      const balRight = account.normal === "debit" ? T_W / 2 - 10 : T_W - 12;
      return (
        <g
          id={tAccountId(account.id)}
          transform={translate(x, y)}
          data-entrypad-account={account.id}
          {...(editable && target && { tabIndex: 0, role: "button" })}
        >
          <title>{target ? `Move to ${account.name}` : `${account.name} T-account, balance ${money(row.balance, view)}`}</title>
          {/* Dragology can't see inside components, so this invisible box gives the drop target its full size. */}
          <rect width={T_W} height={T_H} fill="none" />
          {frames ? <TFrame name={account.name} width={T_W} normal={account.normal} lit={lit} theme={theme} /> : tFrame({ name: account.name, width: T_W, normal: account.normal, lit, theme })}
          <text
            transform={translate(balRight, T_H - 13)}
            textAnchor="end"
            fontSize={12}
            fontWeight={600}
            fill={row.balance < 0 ? theme.error : theme.ink}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {money(row.balance, view)}
          </text>
          <g id={`dr-${account.id}`}>{drawColumn(row.rows.filter((r) => r.side === "dr"), account, "dr")}</g>
          <g id={`cr-${account.id}`}>{drawColumn(row.rows.filter((r) => r.side === "cr"), account, "cr")}</g>
        </g>
      );
    };

    // Each squiggle carries the layer marker itself: Dragology lifts it out
    // of the wrapper group, so the wrapper's marker wouldn't reach it.
    const squiggles: Svgx[] = [];
    accounts.forEach((account, index) => {
      const finding = abnormal.get(account.id);
      const row = rows.get(account.id);
      if (!finding || !row || row.balance >= 0) return;
      const { x, y } = position(index);
      const right = account.normal === "debit" ? T_W / 2 - 10 : T_W - 12;
      squiggles.push(
        <path
          id={`dx-abnormal-${account.id}`}
          data-entrypad-layer="diagnostics"
          transform={translate(x + right - 52, y + T_H - 8)}
          d={squiggle(54)}
          fill="none"
          stroke={theme[finding.severity]}
          strokeWidth={1.25}
        >
          <title>{finding.message}</title>
        </path>,
      );
    });

    return (
      <g>
        <rect width={layout.width} height={layout.height} fill={theme.canvas} />
        {accounts.map((a, i) => drawT(a, rows.get(a.id) ?? { account: a, rows: [], debits: 0, credits: 0, balance: 0 }, i))}
        <g id="t-diagnostics" data-entrypad-layer="diagnostics" dragologyZIndex={2}>
          {squiggles}
        </g>
      </g>
    );
  };
}

/**
 * A grid of T-accounts with every posting, a running total and the balance.
 * Drag a posted amount onto another T-account to reclassify it, or click it
 * (or press Enter) and then click the account to move it to. Drag it up or
 * down inside its own T-account (or press the arrow keys) to change it.
 */
export function TAccount(props: TAccountProps) {
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
  const accounts = useVisibleAccounts(book, props.accounts);
  const view = useMemo(() => viewBook(book, at), [book, at]);
  const findings = useFindings(view, props.diagnostics, showDiagnostics);
  const store = useHighlight();
  const [moving, setMoving] = useState<string | null>(null);
  const report = useDragReporter(store, onDragStatus);
  const movingRef = useRef(moving);
  movingRef.current = moving;

  const layout = computeLayout(accounts.length, maxWidth);
  const editable = onBookChange !== undefined;

  /** Moves the picked-up posting to an account. */
  const moveTo = (accountId: string) => {
    const [entryId, line] = (movingRef.current ?? "").split(":");
    const posting = book.entries.find((e) => e.id === entryId)?.lines[Number(line)];
    setMoving(null);
    if (posting && posting.account !== accountId) onBookChange?.(reclassify(book, entryId!, Number(line), accountId));
  };

  /** The keyboard version of dragging an amount: one step per press (ten with Shift). */
  const nudge = (key: string, steps: number) => {
    const [entryId, line] = key.split(":");
    const posting = book.entries.find((e) => e.id === entryId)?.lines[Number(line)];
    if (!posting) return;
    const step = amountStep(posting.amount, book.settings.decimals);
    const cents = Math.max(step, posting.amount + steps * step);
    if (cents !== posting.amount) onBookChange?.(withAmount(book, entryId!, Number(line), cents));
  };

  // Clicks and keys are handled here, on the container, from the elements'
  // data attributes (see entryAttrs).
  const activate = (target: EventTarget | null) => {
    const posting = closestWith(target, "entrypad-posting")?.getAttribute("data-entrypad-posting");
    if (posting) return setMoving((m) => (m === posting ? null : posting));
    const account = closestWith(target, "entrypad-account")?.getAttribute("data-entrypad-account");
    if (account && movingRef.current) moveTo(account);
  };
  const handlers = {
    ...highlightHandlers(store),
    ...(editable && {
      onClick: (e: { target: EventTarget | null }) => activate(e.target),
      onKeyDown: (e: KeyboardEvent) => {
        if (isActivation(e)) {
          e.preventDefault();
          activate(e.target);
        } else if (e.key === "Escape") setMoving(null);
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          const posting = closestWith(e.target, "entrypad-posting")?.getAttribute("data-entrypad-posting");
          if (!posting) return;
          e.preventDefault();
          nudge(posting, (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1));
        }
      },
    }),
  };

  const onRender = useRef(props.onRenderState);
  onRender.current = props.onRenderState;
  const draggable = useMemo(
    () => makeDraggable(accounts, layout, at, findings, theme, staticPartsAsComponents, editable, () => onRender.current?.()),
    // Layout is plain numbers; rebuild only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, layout.cols, layout.tW, layout.width, layout.height, at, findings, theme, staticPartsAsComponents, editable],
  );
  const state = useMemo<TState>(() => ({ book, highlight: store.value, moving }), [book, store.value, moving]);

  return (
    <VisualShell
      label="T-accounts"
      theme={theme}
      singlePointerDrags={singlePointerDrags}
      touchScroll={touchScroll}
      onAbort={() => report("idle")}
      handlers={handlers}
    >
      {(epoch) => (
        <DraggableRenderer<TState>
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
      )}
    </VisualShell>
  );
}
