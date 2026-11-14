import type { Book, Diagnostic, Entry, Line } from "@entrypad/core";
import { DraggableRenderer, translate } from "dragology";
import type { Draggable, Svgx } from "dragology";
import { memo, useMemo } from "react";
import type { KeyboardEvent } from "react";
import { useHighlight } from "./highlight.js";
import type { Highlight } from "./highlight.js";
import type { Theme } from "./theme.js";
import {
  closestWith,
  DRAG_HANDLE,
  entryAttrs,
  highlightHandlers,
  KEEP_CLICKS,
  money,
  resolveTheme,
  squiggle,
  useDragReporter,
  useFindings,
  viewBook,
  VisualShell,
} from "./visual.js";
import type { InteractionProps, VisualProps } from "./visual.js";

export type EntryCardsProps = VisualProps & InteractionProps;

interface CState {
  book: Book;
  highlight: Highlight | null;
}

// Layout, in SVG user units.
const PAD = 16;
const GAP = 16;
const CARD_W = 320;
const HEAD_H = 44;
/** Baseline of the first line, below the memo. */
const FIRST_LINE = HEAD_H + 14;
const ROW_H = 20;
const FOOT = 12;
/** Where debit and credit names start, and where the two amount columns end. */
const DR_X = 14;
const CR_X = 40;
const DR_RIGHT = CARD_W - 96;
const CR_RIGHT = CARD_W - 16;
/** The line between the two amount columns, which decides a dragged line's side. */
const SPLIT = (DR_RIGHT + CR_RIGHT) / 2 - 30;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const showDate = (iso?: string) => (iso ? `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}` : "No date");

export const cardId = (entryId: string) => `card-${entryId}`;
export const cardLineId = (entryId: string, index: number) => `cl-${entryId}-${index}`;
const zoneId = (entryId: string, side: Line["side"]) => `zone-${entryId}-${side}`;

const cardHeight = (e: Entry) => FIRST_LINE + Math.max(1, e.lines.length) * ROW_H - ROW_H + FOOT + 8;

interface Placed {
  entry: Entry;
  x: number;
  y: number;
  h: number;
}

function place(entries: readonly Entry[], maxWidth: number): { placed: Placed[]; width: number; height: number } {
  const cols = Math.max(1, Math.min(entries.length || 1, Math.floor((maxWidth - 2 * PAD + GAP) / (CARD_W + GAP))));
  const placed: Placed[] = [];
  let y = PAD;
  for (let i = 0; i < entries.length; i += cols) {
    const row = entries.slice(i, i + cols);
    const h = Math.max(...row.map(cardHeight));
    row.forEach((entry, j) => placed.push({ entry, x: PAD + j * (CARD_W + GAP), y, h }));
    y += h + GAP;
  }
  const width = 2 * PAD + cols * (CARD_W + GAP) - GAP;
  return { placed, width, height: Math.max(y - GAP + PAD, 2 * PAD + HEAD_H) };
}

/** A copy of the book with one line moved to the other side. */
export function flipSide(book: Book, entryId: string, index: number): Book {
  return {
    ...book,
    entries: book.entries.map((e) =>
      e.id !== entryId ? e : { ...e, lines: e.lines.map((l, i) => (i === index ? { ...l, side: l.side === "dr" ? "cr" : "dr" } : l)) },
    ),
  };
}

interface FrameProps {
  date: string;
  memo: string;
  tags: string;
  height: number;
  lit: boolean;
  theme: Theme;
}

/** The parts of a card that don't move during a drag (Phase 0 rule 2). */
const CardFrame = memo(function CardFrame(props: FrameProps) {
  return cardFrame(props);
});

function cardFrame({ date, memo, tags, height, lit, theme }: FrameProps): Svgx {
  const maxChars = Math.floor((CARD_W - 80) / 6.6);
  return (
    <g>
      <rect width={CARD_W} height={height} rx={8} fill={theme.surface} stroke={lit ? theme.accent : theme.border} strokeWidth={lit ? 1.5 : 1} />
      <text transform={translate(14, 20)} fontSize={11} fontWeight={600} fill={theme.muted} letterSpacing={0.4}>
        {date.toUpperCase()}
      </text>
      <text transform={translate(CARD_W - 14, 20)} textAnchor="end" fontSize={11} fill={theme.muted}>
        {tags}
      </text>
      <text transform={translate(14, 36)} fontSize={12.5} fontWeight={600} fill={theme.ink}>
        {memo.length > maxChars ? memo.slice(0, maxChars - 1) + "…" : memo}
      </text>
    </g>
  );
}

function makeDraggable(
  layout: ReturnType<typeof place>,
  findings: readonly Diagnostic[],
  theme: Theme,
  frames: boolean,
  editable: boolean,
): Draggable<CState> {
  return ({ state, d, draggedId }) => {
    const names = new Map(state.book.chart.map((a) => [a.id, a.name]));
    const z = (id: string) => (draggedId === id ? "/1" : false);

    const drawLine = (entry: Entry, line: Line, index: number, origin: Placed): Svgx => {
      const id = cardLineId(entry.id, index);
      const name = names.get(line.account) ?? line.account;
      const lit = state.highlight?.entry === entry.id;
      const focus = lit && state.highlight?.line === index;
      const amount = line.blank && !line.inferred ? "" : money(line.amount, state.book);
      const side = line.side === "dr" ? "debit" : "credit";
      const other = line.side === "dr" ? "credit" : "debit";
      const x = line.side === "dr" ? DR_X : CR_X;
      const right = line.side === "dr" ? DR_RIGHT : CR_RIGHT;
      // A credit's name may run under the empty debit column.
      const maxChars = Math.floor(((line.side === "dr" ? DR_RIGHT : CR_RIGHT) - 72 - x) / 6.2);
      return (
        <g
          id={id}
          transform={translate(origin.x, origin.y + FIRST_LINE + index * ROW_H)}
          dragologyZIndex={z(id)}
          {...entryAttrs(entry.id, index)}
          {...(editable && {
            ...DRAG_HANDLE,
            ...KEEP_CLICKS,
            tabIndex: 0,
            role: "button",
            dragologyOnDrag: () =>
              d
                .closest([d.dropTarget(zoneId(entry.id, line.side === "dr" ? "cr" : "dr"), { ...state, book: flipSide(state.book, entry.id, index) })])
                .whenFar(state)
                .withFloating(),
          })}
        >
          {/* A <title>, not aria-label: Dragology can't blend two different strings between states. */}
          <title>{`${name}, ${side}${amount ? ` ${amount}` : ""}${editable ? `. Press Enter to make it a ${other}.` : ""}`}</title>
          <rect x={6} y={-14} width={CARD_W - 12} height={ROW_H - 1} rx={3} fill={focus || draggedId === id ? theme.accentSoft : "transparent"} />
          <text transform={translate(x, 0)} fontSize={12} fill={theme.ink}>
            {name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name}
          </text>
          <text
            transform={translate(right, 0)}
            textAnchor="end"
            fontSize={12}
            fill={line.inferred ? theme.muted : theme.ink}
            {...(line.inferred && { fontStyle: "italic" })}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {amount}
          </text>
        </g>
      );
    };

    const drawCard = (p: Placed): Svgx => {
      const { entry } = p;
      const lit = state.highlight?.entry === entry.id;
      const frame: FrameProps = {
        date: showDate(entry.date),
        memo: entry.memo ?? "",
        tags: (entry.tags ?? []).join(", "),
        height: p.h,
        lit,
        theme,
      };
      const linesTop = p.y + FIRST_LINE - 16;
      const linesH = Math.max(1, entry.lines.length) * ROW_H + 4;
      return (
        <g id={cardId(entry.id)}>
          <g id={`frame-${entry.id}`} transform={translate(p.x, p.y)}>
            <title>{`${frame.date}, ${frame.memo}`}</title>
            {/* Dragology can't see inside components, so this invisible box keeps the card's size. */}
            <rect width={CARD_W} height={p.h} fill="none" />
            {frames ? <CardFrame {...frame} /> : cardFrame(frame)}
          </g>
          <rect id={zoneId(entry.id, "dr")} transform={translate(p.x, linesTop)} width={SPLIT} height={linesH} fill="none" />
          <rect id={zoneId(entry.id, "cr")} transform={translate(p.x + SPLIT, linesTop)} width={CARD_W - SPLIT} height={linesH} fill="none" />
          {entry.lines.map((line, i) => drawLine(entry, line, i, p))}
        </g>
      );
    };

    // Squiggles: under the memo for a finding about the whole entry, under
    // the account name for one about a line. Each carries the layer marker.
    const placedById = new Map(layout.placed.map((p) => [p.entry.id, p]));
    const squiggles: Svgx[] = [];
    findings.forEach((f, i) => {
      const p = f.target.entry ? placedById.get(f.target.entry) : undefined;
      if (!p) return;
      const onLine = f.target.line !== undefined && f.target.line < p.entry.lines.length;
      const line = onLine ? p.entry.lines[f.target.line!] : undefined;
      const x = p.x + (line ? (line.side === "dr" ? DR_X : CR_X) : 14);
      const y = p.y + (line ? FIRST_LINE + f.target.line! * ROW_H + 4 : 40);
      squiggles.push(
        <path
          id={`dx-card-${i}`}
          data-entrypad-layer="diagnostics"
          data-code={f.code}
          transform={translate(x, y)}
          d={squiggle(line ? 110 : CARD_W - 28)}
          fill="none"
          stroke={theme[f.severity]}
          strokeWidth={1.25}
        >
          <title>{f.message}</title>
        </path>,
      );
    });

    return (
      <g>
        <rect width={layout.width} height={layout.height} fill={theme.canvas} />
        {layout.placed.map(drawCard)}
        <g id="card-diagnostics" data-entrypad-layer="diagnostics" dragologyZIndex={2}>
          {squiggles}
        </g>
      </g>
    );
  };
}

/**
 * Each entry as a card: date, memo, tags, then its debit and credit lines.
 * Drag a line across to the other amount column to flip its side, or focus
 * it and press Enter.
 */
export function EntryCards(props: EntryCardsProps) {
  const { book, onBookChange, showDiagnostics = false, at, maxWidth = 1200, staticPartsAsComponents = true, singlePointerDrags = true, touchScroll = true, onDragStatus } = props;
  const theme = resolveTheme(props.theme);
  const view = useMemo(() => viewBook(book, at), [book, at]);
  const findings = useFindings(view, props.diagnostics, showDiagnostics);
  const store = useHighlight();
  const report = useDragReporter(store, onDragStatus);

  const layout = useMemo(() => place(view.entries, maxWidth), [view.entries, maxWidth]);
  const editable = onBookChange !== undefined;
  const draggable = useMemo(
    () => makeDraggable(layout, findings, theme, staticPartsAsComponents, editable),
    [layout, findings, theme, staticPartsAsComponents, editable],
  );
  // The renderer draws the view; changes are applied to the whole book.
  const state = useMemo<CState>(() => ({ book: view, highlight: store.value }), [view, store.value]);
  const apply = (next: Book) => {
    if (next === view) return;
    // Entries after `at` aren't drawn, so carry them over unchanged.
    onBookChange?.({ ...next, entries: [...next.entries, ...book.entries.slice(next.entries.length)] });
  };

  // Keys are handled on the container, from the line's data attributes (see entryAttrs).
  const handlers = {
    ...highlightHandlers(store),
    ...(editable && {
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const el = closestWith(e.target, "entrypad-line");
        if (!el) return;
        e.preventDefault();
        apply(flipSide(view, el.getAttribute("data-entrypad-entry")!, Number(el.getAttribute("data-entrypad-line"))));
      },
    }),
  };

  return (
    <VisualShell
      label="Journal entries"
      theme={theme}
      singlePointerDrags={singlePointerDrags}
      touchScroll={touchScroll}
      onAbort={() => report("idle")}
      handlers={handlers}
    >
      {(epoch) => (
        <DraggableRenderer<CState>
          key={epoch}
          draggable={draggable}
          state={state}
          width={layout.width}
          height={layout.height}
          onDropState={(s) => apply(s.book)}
          onDragStatus={(s) => report(s.type)}
        />
      )}
    </VisualShell>
  );
}
