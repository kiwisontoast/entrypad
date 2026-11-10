import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/**
 * Makes a drag follow one pointer from start to finish. Dragology 0.2.0
 * listens for pointermove and pointerup on the document without checking
 * which pointer they come from, and it doesn't listen for pointercancel. On a
 * touchscreen that means a second finger can take over a drag, and a drag the
 * browser cancels (a system gesture, an incoming call) stays stuck.
 *
 * This hook listens in the capture phase, before Dragology's own listeners:
 * - Once a pointer goes down inside `container`, events from every other
 *   pointer are stopped until that pointer is released.
 * - If the browser cancels the active pointer, the returned epoch changes.
 *   Use it as the renderer's `key`: remounting a controlled renderer drops
 *   the drag and leaves the state as it was before the gesture.
 */
export function usePointerGuard(container: RefObject<Element | null>, onAbort?: () => void): number {
  const [epoch, setEpoch] = useState(0);
  const onAbortRef = useRef(onAbort);
  onAbortRef.current = onAbort;

  useEffect(() => {
    let active: number | null = null;

    const onDown = (e: PointerEvent) => {
      if (active === null) {
        if (container.current?.contains(e.target as Node)) active = e.pointerId;
      } else if (e.pointerId !== active) {
        e.stopImmediatePropagation();
      }
    };
    const onMove = (e: PointerEvent) => {
      if (active !== null && e.pointerId !== active) e.stopImmediatePropagation();
    };
    const onUp = (e: PointerEvent) => {
      if (active === null) return;
      if (e.pointerId !== active) e.stopImmediatePropagation();
      else active = null;
    };
    const onCancel = (e: PointerEvent) => {
      if (active === null || e.pointerId !== active) return;
      active = null;
      setEpoch((n) => n + 1);
      onAbortRef.current?.();
    };

    const opts = { capture: true } as const;
    document.addEventListener("pointerdown", onDown, opts);
    document.addEventListener("pointermove", onMove, opts);
    document.addEventListener("pointerup", onUp, opts);
    document.addEventListener("pointercancel", onCancel, opts);
    return () => {
      document.removeEventListener("pointerdown", onDown, opts);
      document.removeEventListener("pointermove", onMove, opts);
      document.removeEventListener("pointerup", onUp, opts);
      document.removeEventListener("pointercancel", onCancel, opts);
    };
  }, [container]);

  return epoch;
}
