import { diagnose, formatCents } from "@entrypad/core";
import type { Account, Book, Diagnostic } from "@entrypad/core";
import { useCallback, useMemo, useRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
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
