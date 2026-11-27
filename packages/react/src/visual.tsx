import { diagnose, formatCents } from "@entrypad/core";
import type { Account, Book, Diagnostic } from "@entrypad/core";
import { renderStateReadOnly } from "dragology";
import type { Draggable, DragSpec, DragSpecBuilder, LayeredSvgx } from "dragology";
import { Children, createElement, isValidElement, useCallback, useMemo, useRef } from "react";
import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import type { Highlight, HighlightStore } from "./highlight.js";
import { usePointerGuard } from "./pointerGuard.js";
import { theme as defaultTheme } from "./theme.js";
import type { Theme } from "./theme.js";
import { DRAG_HANDLE_ATTR, TOUCH_SCROLL_CSS, useTouchScroll } from "./touchScroll.js";

/** The props every Entrypad visual shares. */
export interface VisualProps {
  book: Book;
  /** Called with the new book when a drag or key press changes it. Without it the visual is read-only. */
  onBookChange?: (book: Book) => void;
  /** Draw findings as squiggles. The editor turns this on; exports and embeds leave it off. */
  showDiagnostics?: boolean;
  /** The findings to draw. Defaults to `diagnose(book)`. */
  diagnostics?: readonly Diagnostic[];
  /** Ids of the accounts to show, in order. */
  accounts?: readonly string[];
  /** Show the books as they stood after this many entries, for step-through. */
  at?: number;
  theme?: Theme;
  /** Width available, in pixels; the layout fits itself inside it. */
  maxWidth?: number;
}

/**
 * Draws a visual as plain SVG, without the drag engine: for rendering on a
 * server (Markdown, static pages) or anywhere nothing should move. Nothing
 * can be dragged, and no browser APIs are touched, so it works with
 * `renderToStaticMarkup`.
 */
export interface StaticProps {
  staticRender?: boolean;
}

/** Strips the drag engine's own props from a drawn tree, so React renders it as plain SVG. */
function plain(node: ReactNode): ReactNode {
  if (!isValidElement<Record<string, unknown>>(node)) return node;
  // Components (memoised static parts) draw themselves.
  if (typeof node.type !== "string") return node;
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node.props)) {
    if (k.startsWith("dragology") || k === "children" || typeof v === "function") continue;
    props[k] = v;
  }
  return createElement(node.type, props, ...Children.toArray(node.props.children as ReactNode).map(plain));
}

/**
 * A draggable's drawing of one state, as plain SVG: what the drag engine
 * would show before anything moves. `draw` is the draggable itself; it is
 * given no drag builder, so it must only use one inside drag callbacks.
 */
export function staticSvg<T extends object>(draw: Draggable<T>, state: T, width: number, height: number, theme: Theme, label: string): ReactElement {
  // No drag builder: in static mode the draw function never starts a drag.
  const props = { state, d: undefined, draggedId: null, setState: () => {}, isTracking: false };
  const tree = draw(props as unknown as Parameters<Draggable<T>>[0]);
  return (
    <div role="img" aria-label={label} style={{ display: "inline-block", maxWidth: "100%", fontFamily: theme.font }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: "100%", height: "auto", display: "block" }}>
        {plain(tree)}
      </svg>
    </div>
  );
}

/** Performance and touch options, from the display settings. */
export interface InteractionProps {
  /** Draw unchanging parts as memoised components (`display.staticPartsAsComponents`). */
  staticPartsAsComponents?: boolean;
  /** One finger per drag (`display.singlePointerDrags`). */
  singlePointerDrags?: boolean;
  /** A finger on an empty part scrolls the page (`display.touchScroll`). */
  touchScroll?: boolean;
  /** Instrumentation: called whenever a drag starts or ends. */
  onDragStatus?: (status: "idle" | "dragging") => void;
  /** Instrumentation: called each time the visual draws a state, including the previews drawn mid-drag. */
  onRenderState?: () => void;
}

/** The book as it stood after the first `at` entries. */
export function viewBook(book: Book, at?: number): Book {
  return at === undefined || at >= book.entries.length ? book : { ...book, entries: book.entries.slice(0, Math.max(0, at)) };
}

/** The findings to draw: the ones given, or the book's own. */
export function useFindings(book: Book, given: readonly Diagnostic[] | undefined, show: boolean): readonly Diagnostic[] {
  return useMemo(() => (!show ? [] : (given ?? diagnose(book))), [book, given, show]);
}

/** The accounts a visual draws: those asked for, or else every account the book uses, in chart order. */
export function useVisibleAccounts(book: Book, ids: readonly string[] | undefined): Account[] {
  return useMemo(() => {
    const byId = new Map(book.chart.map((a) => [a.id, a]));
    if (ids) return ids.map((id) => byId.get(id)).filter((a): a is Account => a !== undefined);
    const used = new Set(book.entries.flatMap((e) => e.lines.map((l) => l.account)));
    return book.chart.filter((a) => used.has(a.id));
  }, [book.chart, book.entries, ids]);
}

export const money = (cents: number, book: Book) => formatCents(cents, book.settings.decimals);

/** A spell-check style wavy underline of the given width, starting at the origin. */
export function squiggle(width: number): string {
  let d = "M0 0";
  for (let x = 0; x < Math.max(4, width); x += 4) d += " q 1 -2.5 2 0 q 1 2.5 2 0";
  return d;
}

/** A rectangle in the visual's own (canvas) coordinates. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A drop target that renders its preview only once the pointer enters it.
 * Dragology's own `d.dropTarget` renders its state as soon as a drag starts,
 * so a drag with 30 possible targets renders the whole visual 30 times on
 * its first frame. Here the target's box comes from the visual's layout
 * instead, and the preview is rendered (once) on first entry.
 */
export function lazyDropTarget<T extends object>(d: DragSpecBuilder<T>, box: Box, state: T): DragSpec<T> {
  return d.custom((ctx) => {
    let preview: LayeredSvgx | undefined;
    const render = () => (preview ??= renderStateReadOnly(ctx, state));
    return (frame) => {
      const { x, y } = frame.pointer;
      const inside = x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
      return { preview: render, dropState: state, gap: inside ? 0 : Infinity };
    };
  });
}

/**
 * How much one step of an amount drag (a pixel, or an arrow key press) adds:
 * the largest power of ten that is at most 1% of the amount, and never less
 * than the book's smallest unit (a dollar, or a cent with two decimals).
 */
export function amountStep(cents: number, decimals: 0 | 2): number {
  let step = decimals === 2 ? 1 : 100;
  while (step * 10 * 100 <= Math.abs(cents)) step *= 10;
  return step;
}

/**
 * A copy of the book with one line's amount changed. When the other side of
 * the entry has a single line, that line changes by the same difference, so
 * a balanced entry stays balanced; otherwise the entry is left unbalanced
 * and its squiggle says so. A line that was left blank keeps its blank, since
 * the parser will fill it in again.
 */
export function withAmount(book: Book, entryId: string, lineIndex: number, cents: number): Book {
  return {
    ...book,
    entries: book.entries.map((e) => {
      if (e.id !== entryId) return e;
      const line = e.lines[lineIndex];
      if (!line || line.amount === cents) return e;
      const delta = cents - line.amount;
      const others = e.lines.flatMap((l, i) => (l.side !== line.side ? [i] : []));
      const partner = others.length === 1 ? others[0] : undefined;
      return {
        ...e,
        lines: e.lines.map((l, i) => {
          if (i === lineIndex) {
            // Written out from now on, even if it was inferred before.
            const { blank: _b, inferred: _i, ...rest } = l;
            return { ...rest, amount: cents };
          }
          return i === partner ? { ...l, amount: l.amount + delta } : l;
        }),
      };
    }),
  };
}

/**
 * Dragging an amount up or down to change it, while the pointer stays inside
 * `box`. Each pixel up adds one `step`, each pixel down takes one away, and
 * the amount never goes below one step. Outside the box the spec gives way
 * (an infinite gap), so a `closest` around it can switch to another drag.
 * The amount stays where it is on screen; only its value changes.
 */
export function scrubAmount<T extends object>(
  d: DragSpecBuilder<T>,
  box: Box,
  start: number,
  step: number,
  stateFor: (cents: number) => T,
): DragSpec<T> {
  return d.custom((ctx) => {
    const previews = new Map<number, LayeredSvgx>();
    // Measured from where the pointer was on the drag's first frame.
    let originY: number | undefined;
    return (frame) => {
      const { x, y } = frame.pointer;
      originY ??= y;
      const inside = x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
      const steps = Math.round(originY - y);
      const cents = Math.max(step, start + steps * step);
      const state = stateFor(cents);
      const preview = () => {
        let p = previews.get(cents);
        if (!p) previews.set(cents, (p = renderStateReadOnly(ctx, state)));
        return p;
      };
      return { preview, dropState: state, gap: inside ? 0 : Infinity };
    };
  });
}

/** Marks drag handles so a finger on them drags instead of scrolling (see useTouchScroll). */
export const DRAG_HANDLE = { [DRAG_HANDLE_ATTR]: "" };

export const resolveTheme = (t?: Theme) => t ?? defaultTheme;

/** Reports a renderer's drags to the shared highlight and to an optional listener. */
export function useDragReporter(store: HighlightStore, onDragStatus?: (s: "idle" | "dragging") => void) {
  const dragging = useRef(false);
  return useCallback(
    (status: "idle" | "dragging") => {
      if (status === "dragging" && !dragging.current) {
        dragging.current = true;
        store.dragStarted();
      } else if (status === "idle" && dragging.current) {
        dragging.current = false;
        store.dragEnded();
      }
      onDragStatus?.(status);
    },
    [store, onDragStatus],
  );
}

/**
 * Marks an element as belonging to an entry (and a line), for the linked
 * highlight. Visuals read these attributes from the container rather than
 * putting handlers on each element, because while Dragology animates a
 * change it keeps the old render's handlers on every element.
 */
export const entryAttrs = (entry: string, line?: number) => ({
  "data-entrypad-entry": entry,
  ...(line !== undefined && { "data-entrypad-line": String(line) }),
});

/**
 * Dragology starts a drag on pointerdown unless the element has a click
 * handler, in which case it waits for a little movement first. Draggable
 * elements carry this no-op so a plain click still counts as a click; the
 * container handles it.
 */
export const KEEP_CLICKS = { onClick: () => {} };

/** The element under an event that carries `data-<name>`, if any. */
export function closestWith(target: EventTarget | null, name: string): Element | null {
  return target instanceof Element ? target.closest(`[data-${name}]`) : null;
}

/** Container handlers that keep the shared highlight on whatever line is under the pointer or focused. */
export function highlightHandlers(store: HighlightStore) {
  const at = (target: EventTarget | null): Highlight | null => {
    const el = closestWith(target, "entrypad-entry");
    if (!el) return null;
    const line = el.getAttribute("data-entrypad-line");
    return { entry: el.getAttribute("data-entrypad-entry")!, ...(line !== null && { line: Number(line) }) };
  };
  return {
    onPointerOver: (e: { target: EventTarget | null }) => store.set(at(e.target)),
    onPointerLeave: () => store.set(null),
    onFocus: (e: { target: EventTarget | null }) => store.set(at(e.target)),
    onBlur: () => store.set(null),
  };
}

type ContainerHandlers = Partial<Pick<HTMLAttributes<HTMLDivElement>, "onClick" | "onKeyDown" | "onPointerOver" | "onPointerLeave" | "onFocus" | "onBlur">>;

interface ShellProps {
  label: string;
  theme: Theme;
  singlePointerDrags: boolean;
  touchScroll: boolean;
  onAbort: () => void;
  handlers?: ContainerHandlers;
  children: (epoch: number) => ReactNode;
}

/**
 * The wrapper every draggable visual renders inside. It applies the Phase 0
 * rules: the pointer guard on every renderer (a new epoch remounts it to
 * drop a cancelled drag), touch scrolling on the empty parts, and the font
 * set outside the SVG, since Dragology lifts elements out of their groups
 * and nothing inside could inherit it.
 */
export function VisualShell({ label, theme, singlePointerDrags, touchScroll, onAbort, handlers, children }: ShellProps) {
  const container = useRef<HTMLDivElement>(null);
  const epoch = usePointerGuard(container, onAbort, singlePointerDrags);
  useTouchScroll(container, touchScroll);
  return (
    <div
      ref={container}
      role="group"
      aria-label={label}
      className={touchScroll ? "entrypad-board" : undefined}
      style={{ display: "inline-block", maxWidth: "100%", fontFamily: theme.font }}
      {...handlers}
    >
      {touchScroll && <style>{TOUCH_SCROLL_CSS}</style>}
      {children(epoch)}
    </div>
  );
}
