import { createContext, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

/** What the reader is pointing at: an entry, and optionally one of its lines. */
export interface Highlight {
  entry: string;
  line?: number;
}

export interface HighlightStore {
  value: Highlight | null;
  /** Ignored while a drag is in progress, so no visual changes under the pointer mid-drag. */
  set: (next: Highlight | null) => void;
  /** Visuals report their drags here. */
  dragStarted: () => void;
  dragEnded: () => void;
}

const HighlightContext = createContext<HighlightStore | null>(null);

const same = (a: Highlight | null, b: Highlight | null) => a?.entry === b?.entry && a?.line === b?.line;

function useStore(): HighlightStore {
  const [value, setValue] = useState<Highlight | null>(null);
  const drags = useRef(0);
  return useMemo(
    () => ({
      value,
      set: (next) => {
        if (drags.current === 0) setValue((prev) => (same(prev, next) ? prev : next));
      },
      dragStarted: () => {
        drags.current++;
      },
      dragEnded: () => {
        drags.current = Math.max(0, drags.current - 1);
      },
    }),
    [value],
  );
}

/**
 * Links the visuals inside it: hovering or focusing a line in one lights up
 * both sides of its entry in all of them.
 */
export function HighlightProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  return <HighlightContext.Provider value={store}>{children}</HighlightContext.Provider>;
}

/** The shared highlight, or one of the visual's own when there is no provider. */
export function useHighlight(): HighlightStore {
  const own = useStore();
  return useContext(HighlightContext) ?? own;
}
