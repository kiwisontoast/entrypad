import { useEffect } from "react";
import type { RefObject } from "react";

/** Marks an element as a drag handle: a finger on it drags rather than scrolls. */
export const DRAG_HANDLE_ATTR = "data-entrypad-drag";

/**
 * Dragology sets `touch-action: none` on the whole <svg>, so on a touchscreen
 * a finger anywhere on a visual can't scroll the page, and a visual taller
 * than the screen traps the reader.
 *
 * Browsers only honor touch-action on the <svg> itself, not on the shapes
 * inside it, so this works in two steps instead:
 * 1. A stylesheet lets the <svg> scroll and zoom like the rest of the page.
 * 2. A touch that starts on a drag handle cancels that scroll from a
 *    non-passive touchstart/touchmove listener. Pointer events keep flowing,
 *    so Dragology sees an ordinary drag.
 *
 * `className` must be on an ancestor of the renderer's <svg>.
 */
export function useTouchScroll(container: RefObject<Element | null>, enabled: boolean): void {
  useEffect(() => {
    const el = container.current;
    if (!enabled || !el) return;
    let onHandle = false;

    const onStart = (e: TouchEvent) => {
      onHandle = e.target instanceof Element && e.target.closest(`[${DRAG_HANDLE_ATTR}]`) !== null;
      if (onHandle && e.cancelable) e.preventDefault();
    };
    const onMove = (e: TouchEvent) => {
      if (onHandle && e.cancelable) e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) onHandle = false;
    };

    const active = { passive: false } as const;
    el.addEventListener("touchstart", onStart as EventListener, active);
    el.addEventListener("touchmove", onMove as EventListener, active);
    el.addEventListener("touchend", onEnd as EventListener);
    el.addEventListener("touchcancel", onEnd as EventListener);
    return () => {
      el.removeEventListener("touchstart", onStart as EventListener);
      el.removeEventListener("touchmove", onMove as EventListener);
      el.removeEventListener("touchend", onEnd as EventListener);
      el.removeEventListener("touchcancel", onEnd as EventListener);
    };
  }, [container, enabled]);
}

/** Lets the empty parts of a visual scroll and zoom; must beat Dragology's inline style. */
export const TOUCH_SCROLL_CSS = ".entrypad-board svg { touch-action: manipulation !important; }";
