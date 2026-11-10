import { balances, diagnosticDefaults, formatCents } from "@entrypad/core";
import type { Account, AccountBalance, Book, DiagnosticCode, Entry, Posting, Severity, Side } from "@entrypad/core";
import { DraggableRenderer, translate } from "dragology";
import type { Draggable, DragSpec, DragSpecBuilder, Svgx } from "dragology";
import { memo, useMemo, useRef } from "react";
import { usePointerGuard } from "./pointerGuard.js";
import { theme } from "./theme.js";
import { DRAG_HANDLE_ATTR, TOUCH_SCROLL_CSS, useTouchScroll } from "./touchScroll.js";

/**
 * A transaction that hasn't been posted yet. One side is known (e.g. "Cr Cash
 * 1,200"); the other side's account is decided by where the card is dropped.
 */
export interface DraftCard {
  id: string;
  memo: string;
  /** Integer cents. */
  amount: number;
  fixed: { account: string; side: Side };
}

export interface BoardValue {
  book: Book;
  drafts: DraftCard[];
}

export interface PostingBoardProps extends BoardValue {
  onChange: (next: BoardValue) => void;
  /** Ids of the accounts to draw, in order. Defaults to the whole chart. */
  accounts?: string[];
  /** Draw the diagnostics overlay (editor only; never in exports). */
  showDiagnostics?: boolean;
  /** Severity of each check, from settings. Defaults to the registry's. */
  severities?: Partial<Record<DiagnosticCode, Severity>>;
  /** Width available for the visual, used to pick a column count. */
  maxWidth?: number;
  /**
   * Draw the static parts of each T-account as memoized React components,
   * which Dragology neither walks nor blends per frame. On by default; off
   * draws them as plain SVG, for comparison.
   */
  opaqueFrames?: boolean;
  /**
   * Make each drag follow one pointer and abandon drags the browser cancels
   * (see usePointerGuard). On by default.
   */
  singlePointerDrags?: boolean;
  /**
   * Let a finger on an empty part of the board scroll and zoom the page.
   * On by default.
   */
  touchScroll?: boolean;
  /** Instrumentation hook: called whenever the drag state machine updates. */
  onDragStatus?: (status: "idle" | "dragging") => void;
}

interface BoardState extends BoardValue {
  /** The account a pending drop would post to, drawn highlighted. */
  highlight: string | null;
}

// Layout, in SVG user units.
const PAD = 16;
const GAP = 16;
const T_W_MAX = 184;
const T_W_MIN = 150;
const T_H = 132;
const CARD_W = 264;
/** Right edges of the debit and credit amount columns on a card. */
const CARD_DR_RIGHT = CARD_W - 104;
const CARD_CR_RIGHT = CARD_W - 30;
const CARD_H = 84;
const HEADER_H = 24;
const ROW_TOP = 50;
const ROW_H = 17;
const MAX_ROWS = 4;

interface Layout {
  cols: number;
  /** Width of one T-account. */
  tW: number;
  width: number;
  height: number;
  cardsPerRow: number;
  gridTop: number;
}

function computeLayout(accountCount: number, cardCount: number, maxWidth: number): Layout {
  const cols = Math.max(2, Math.min(6, Math.floor((maxWidth - 2 * PAD + GAP) / (T_W_MAX + GAP))));
  // On narrow screens, shrink the T-accounts rather than overflow.
  const fit = Math.floor((maxWidth - 2 * PAD - (cols - 1) * GAP) / cols);
  const tW = Math.max(T_W_MIN, Math.min(T_W_MAX, fit));
  const width = 2 * PAD + cols * (tW + GAP) - GAP;
  const cardsPerRow = Math.max(1, Math.floor((width - 2 * PAD + GAP) / (CARD_W + GAP)));
  const cardRows = Math.max(1, Math.ceil(cardCount / cardsPerRow));
  const gridTop = PAD + HEADER_H + cardRows * (CARD_H + GAP) + HEADER_H;
  const rows = Math.ceil(accountCount / cols);
  const height = gridTop + rows * (T_H + GAP) - GAP + PAD;
  return { cols, tW, width, height, cardsPerRow, gridTop };
}

interface TFrameProps {
  name: string;
  width: number;
  normal: Account["normal"];
  lit: boolean;
}

/**
 * The parts of a T-account that don't move during a drag: box, title, rules
 * and the balance label. As a React component it is opaque to Dragology, so
 * it is neither re-walked nor blended on every frame, and memo lets React
 * skip it entirely while its props are unchanged.
 */
const TFrame = memo(function TFrame({ name, width, normal, lit }: TFrameProps) {
  return tFrame({ name, width, normal, lit });
});

/** Plain-function form: Dragology walks and blends it like any other SVG. */
function tFrame({ name, width, normal, lit }: TFrameProps): Svgx {
  const balRight = normal === "debit" ? width / 2 - 10 : width - 12;
  const balLeft = normal === "debit" ? 12 : width / 2 + 10;
  const maxChars = Math.floor((width - 16) / 7);
  return (
    <g>
      <rect
        width={width}
        height={T_H}
        rx={6}
        fill={lit ? theme.accentSoft : theme.surface}
        stroke={lit ? theme.accent : theme.border}
        strokeWidth={lit ? 1.5 : 1}
      />
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

const opposite = (side: Side): Side => (side === "dr" ? "cr" : "dr");

function postDraft(state: BoardState, card: DraftCard, accountId: string): BoardState {
  const open = { account: accountId, side: opposite(card.fixed.side), amount: card.amount };
  const fixed = { ...card.fixed, amount: card.amount };
  const entry: Entry = {
    id: `je-${card.id}`,
    memo: card.memo,
    lines: open.side === "dr" ? [open, fixed] : [fixed, open],
  };
  return {
    book: { ...state.book, entries: [...state.book.entries, entry] },
    drafts: state.drafts.filter((c) => c.id !== card.id),
    highlight: accountId,
  };
}

function reclassify(state: BoardState, posting: Posting, accountId: string): BoardState {
  return {
    ...state,
    book: {
      ...state.book,
      entries: state.book.entries.map((e) =>
        e.id !== posting.entryId
          ? e
          : {
              ...e,
              lines: e.lines.map((l, i) => (i === posting.lineIndex ? { ...l, account: accountId } : l)),
            },
      ),
    },
    highlight: accountId,
  };
}

const tId = (accountId: string) => `t-${accountId}`;
const postingId = (p: Posting) => `p-${p.entryId}-${p.lineIndex}`;
const cardId = (c: DraftCard) => `card-${c.id}`;

/**
 * Drop onto any account except `exclude`. Far from every account, the
 * dragged element floats and the books stay as they were.
 */
function dropOnAccount(
  d: DragSpecBuilder<BoardState>,
  state: BoardState,
  accounts: readonly Account[],
  exclude: string,
  next: (accountId: string) => BoardState,
): DragSpec<BoardState> {
  const targets = accounts
    .filter((a) => a.id !== exclude)
    .map((a) => d.dropTarget(tId(a.id), next(a.id)));
  return d
    .closest(targets)
    .whenFar(state)
    .withFloating()
    .onDrop((s) => ({ ...s, highlight: null }));
}

function makeBoard(
  accounts: readonly Account[],
  layout: Layout,
  showDiagnostics: boolean,
  opaqueFrames: boolean,
  severities: Partial<Record<DiagnosticCode, Severity>>,
): Draggable<BoardState> {
  const T_W = layout.tW;

  return ({ state, d, draggedId }) => {
    const totals = balances(state.book);
    const z = (id: string) => (draggedId === id ? "/1" : false);

    const drawPosting = (p: Posting, account: Account, row: number): Svgx => {
      const colRight = p.side === "dr" ? T_W / 2 - 10 : T_W - 12;
      const id = postingId(p);
      return (
        <g
          id={id}
          transform={translate(colRight, ROW_TOP + row * ROW_H)}
          {...DRAG_HANDLE}
          dragologyZIndex={z(id)}
          dragologyOnDrag={() =>
            dropOnAccount(d, state, accounts, account.id, (target) => reclassify(state, p, target))
          }
        >
          <rect x={-72} y={-13} width={78} height={17} rx={3} fill={draggedId === id ? theme.accentSoft : "transparent"} />
          <text textAnchor="end" fontSize={12} fill={theme.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCents(p.amount, state.book.settings.decimals)}
          </text>
        </g>
      );
    };

    const drawColumn = (rows: Posting[], account: Account): Svgx[] => {
      const shown = rows.length > MAX_ROWS ? rows.slice(rows.length - (MAX_ROWS - 1)) : rows;
      const out = shown.map((p, i) => drawPosting(p, account, rows.length > MAX_ROWS ? i + 1 : i));
      if (rows.length > MAX_ROWS) {
        const side = rows[0]?.side ?? "dr";
        const colRight = side === "dr" ? T_W / 2 - 10 : T_W - 12;
        out.unshift(
          <text
            id={`more-${account.id}-${side}`}
            transform={translate(colRight, ROW_TOP)}
            textAnchor="end"
            fontSize={11}
            fill={theme.muted}
          >
            {`${rows.length - (MAX_ROWS - 1)} earlier`}
          </text>,
        );
      }
      return out;
    };

    const drawT = (account: Account, row: AccountBalance, index: number): Svgx => {
      const x = PAD + (index % layout.cols) * (T_W + GAP);
      const y = layout.gridTop + Math.floor(index / layout.cols) * (T_H + GAP);
      const lit = state.highlight === account.id;
      const debits = row.postings.filter((p) => p.side === "dr");
      const credits = row.postings.filter((p) => p.side === "cr");
      const balRight = account.normal === "debit" ? T_W / 2 - 10 : T_W - 12;
      const abnormal = row.balance < 0;
      const frame: TFrameProps = { name: account.name, width: T_W, normal: account.normal, lit };
      return (
        <g id={tId(account.id)} transform={translate(x, y)} aria-label={`${account.name} T-account`}>
          {/* Dragology can't see inside components, so this invisible box is
              what gives the drop target its full size. */}
          <rect width={T_W} height={T_H} fill="none" />
          {opaqueFrames ? <TFrame {...frame} /> : tFrame(frame)}
          <text
            transform={translate(balRight, T_H - 13)}
            textAnchor="end"
            fontSize={12}
            fontWeight={600}
            fill={abnormal ? theme.error : theme.ink}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatCents(row.balance, state.book.settings.decimals)}
          </text>
          <g id={`dr-${account.id}`}>{drawColumn(debits, account)}</g>
          <g id={`cr-${account.id}`}>{drawColumn(credits, account)}</g>
        </g>
      );
    };

    const drawCard = (card: DraftCard, index: number): Svgx => {
      const col = index % layout.cardsPerRow;
      const rowN = Math.floor(index / layout.cardsPerRow);
      const x = PAD + col * (CARD_W + GAP);
      const y = PAD + HEADER_H + rowN * (CARD_H + GAP);
      const id = cardId(card);
      const fixedAccount = accounts.find((a) => a.id === card.fixed.account)?.name ?? card.fixed.account;
      const amount = formatCents(card.amount, state.book.settings.decimals);
      const openIsDebit = card.fixed.side === "cr";
      const lines: { label: string; side: Side; open: boolean }[] = openIsDebit
        ? [
            { label: "?", side: "dr", open: true },
            { label: fixedAccount, side: "cr", open: false },
          ]
        : [
            { label: fixedAccount, side: "dr", open: false },
            { label: "?", side: "cr", open: true },
          ];
      return (
        <g
          id={id}
          transform={translate(x, y)}
          {...DRAG_HANDLE}
          dragologyZIndex={z(id)}
          aria-label={`Unposted: ${card.memo}`}
          dragologyOnDrag={() =>
            dropOnAccount(d, state, accounts, card.fixed.account, (target) => postDraft(state, card, target))
          }
        >
          <rect
            width={CARD_W}
            height={CARD_H}
            rx={8}
            fill={theme.surface}
            stroke={draggedId === id ? theme.accent : theme.border}
            strokeWidth={draggedId === id ? 1.5 : 1}
          />
          <text transform={translate(14, 22)} fontSize={12.5} fontWeight={600} fill={theme.ink}>
            {card.memo}
          </text>
          {lines.map((l, i) => {
            const indent = l.side === "cr" ? 26 : 0;
            const rowY = 46 + i * 20;
            return (
              <g transform={translate(14, rowY)}>
                {l.open ? (
                  <rect
                    x={indent - 4}
                    y={-13}
                    width={112}
                    height={18}
                    rx={4}
                    fill={theme.accentSoft}
                    stroke={theme.accent}
                    strokeDasharray="3 3"
                  />
                ) : (
                  <g />
                )}
                <text transform={translate(indent, 0)} fontSize={12} fill={l.open ? theme.accent : theme.ink}>
                  {l.open ? "Drop on an account" : l.label}
                </text>
                <text
                  transform={translate(l.side === "dr" ? CARD_DR_RIGHT : CARD_CR_RIGHT, 0)}
                  textAnchor="end"
                  fontSize={12}
                  fill={theme.ink}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {amount}
                </text>
              </g>
            );
          })}
        </g>
      );
    };

    const diagnostics: Svgx[] = [];
    const abnormal = severities["abnormal-balance"] ?? diagnosticDefaults["abnormal-balance"];
    if (showDiagnostics && abnormal !== "off") {
      accounts.forEach((a, i) => {
        const row = totals.get(a.id);
        if (!row || row.balance >= 0) return;
        const x = PAD + (i % layout.cols) * (T_W + GAP);
        const y = layout.gridTop + Math.floor(i / layout.cols) * (T_H + GAP);
        const right = a.normal === "debit" ? T_W / 2 - 10 : T_W - 12;
        diagnostics.push(
          <path
            id={`dx-abnormal-${a.id}`}
            data-entrypad-layer="diagnostics"
            transform={translate(x + right - 52, y + T_H - 8)}
            d={squiggle(54)}
            fill="none"
            stroke={theme[abnormal]}
            strokeWidth={1.25}
          >
            <title>{`${a.name} has an abnormal balance`}</title>
          </path>,
        );
      });
    }

    return (
      <g>
        <rect width={layout.width} height={layout.height} fill={theme.canvas} />
        <text transform={translate(PAD, PAD + 12)} fontSize={11} fontWeight={600} fill={theme.muted} letterSpacing={0.6}>
          UNPOSTED
        </text>
        <text transform={translate(PAD, layout.gridTop - 12)} fontSize={11} fontWeight={600} fill={theme.muted} letterSpacing={0.6}>
          LEDGER
        </text>
        {accounts.map((a, i) => drawT(a, totals.get(a.id) ?? emptyBalance(a), i))}
        {state.drafts.map(drawCard)}
        {/* Dragology lifts every element with an id into its own top-level
            layer, so each diagnostic carries the marker itself; the wrapper's
            marker alone would not reach them. */}
        <g id="diagnostics" data-entrypad-layer="diagnostics" dragologyZIndex={2}>
          {diagnostics}
        </g>
      </g>
    );
  };
}

function emptyBalance(account: Account): AccountBalance {
  return { account, debits: 0, credits: 0, balance: 0, postings: [] };
}

/** A spell-check style wavy underline of the given width, starting at the origin. */
function squiggle(width: number): string {
  let d = "M0 0";
  for (let x = 0; x < width; x += 4) d += ` q 1 -2.5 2 0 q 1 2.5 2 0`;
  return d;
}

const noOverrides: Partial<Record<DiagnosticCode, Severity>> = {};

/** Marks drag handles so a finger on them drags instead of scrolling (see useTouchScroll). */
const DRAG_HANDLE = { [DRAG_HANDLE_ATTR]: "" };

/**
 * Prototype from the Phase 0 spike: unposted transaction cards above a grid
 * of T-accounts. Dropping a card on an account posts it; dragging a posted
 * amount to another account reclassifies it.
 */
export function PostingBoard(props: PostingBoardProps) {
  const {
    book,
    drafts,
    onChange,
    showDiagnostics = true,
    maxWidth = 1200,
    opaqueFrames = true,
    singlePointerDrags = true,
    touchScroll = true,
    severities = noOverrides,
    onDragStatus,
  } = props;

  const accounts = useMemo(() => {
    if (!props.accounts) return book.chart;
    const byId = new Map(book.chart.map((a) => [a.id, a]));
    return props.accounts.map((id) => byId.get(id)).filter((a): a is Account => a !== undefined);
  }, [book.chart, props.accounts]);

  const layout = computeLayout(accounts.length, drafts.length, maxWidth);
  const draggable = useMemo(
    () => makeBoard(accounts, layout, showDiagnostics, opaqueFrames, severities),
    // Layout is plain numbers; rebuild only when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, layout.cols, layout.tW, layout.width, layout.height, layout.cardsPerRow, layout.gridTop, showDiagnostics, opaqueFrames, severities],
  );
  const state = useMemo<BoardState>(() => ({ book, drafts, highlight: null }), [book, drafts]);
  const container = useRef<HTMLDivElement>(null);
  const epoch = usePointerGuard(container, () => onDragStatus?.("idle"), singlePointerDrags);
  useTouchScroll(container, touchScroll);

  return (
    // The font is set here, not on a group inside the SVG: Dragology lifts
    // elements with an id out of their parent groups, so they would not
    // inherit it. From here it reaches the <svg> and everything in it.
    <div
      ref={container}
      className={touchScroll ? "entrypad-board" : undefined}
      style={{ display: "contents", fontFamily: theme.font }}
    >
      {touchScroll && <style>{TOUCH_SCROLL_CSS}</style>}
      <DraggableRenderer<BoardState>
        // A new epoch remounts the renderer, which aborts a cancelled drag.
        key={epoch}
        draggable={draggable}
        state={state}
        width={layout.width}
        height={layout.height}
        onDropState={(s) => onChange({ book: s.book, drafts: s.drafts })}
        {...(onDragStatus && { onDragStatus: (s) => onDragStatus(s.type) })}
      />
    </div>
  );
}
