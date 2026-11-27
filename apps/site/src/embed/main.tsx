import { matchAccount, parse } from "@entrypad/core";
import type { Book } from "@entrypad/core";
import { EntryCards, Equation, HighlightProvider, StatementFlow, TAccount, TrialBalance } from "@entrypad/react";
import { StrictMode, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { decodeBook } from "../share.js";
import "../typography.js";
import "./embed.css";

/**
 * The embed player: one visual, full-bleed, in present mode. No squiggles
 * and no editor. Left and right arrow keys, the on-screen buttons, or a
 * horizontal swipe step through the entries. Drags still work, but only
 * change what this viewer sees.
 *
 * URL: /embed/?visual=t-accounts#v1:<book>. `visual` is t-accounts,
 * equation, entry-cards, trial-balance or statement-flow; without it, the
 * book's first show line that names one of them, else t-accounts. `at=n`
 * starts after n entries.
 */

type VisualName = "t-accounts" | "equation" | "entry-cards" | "trial-balance" | "statement-flow";
const VISUALS: readonly VisualName[] = ["t-accounts", "equation", "entry-cards", "trial-balance", "statement-flow"];
const isVisual = (v: string | null | undefined): v is VisualName => VISUALS.includes(v as VisualName);

const params = new URLSearchParams(location.search);
const text = decodeBook(location.hash);
const parsed = text === undefined ? undefined : parse(text);
const visual: VisualName = isVisual(params.get("visual"))
  ? (params.get("visual") as VisualName)
  : (parsed?.shows.map((s) => s.visual).find(isVisual) ?? "t-accounts");

declare global {
  interface Window {
    __embed: { book: () => Book; at: () => number; visual: VisualName };
  }
}

/** Accounts a `show t-accounts:` (or `show trial-balance:`) line names, as ids. */
function namedAccounts(book: Book, name: VisualName = "t-accounts"): string[] | undefined {
  const names = parsed?.shows.filter((s) => s.visual === name).flatMap((s) => s.options) ?? [];
  const ids = names.map((n) => matchAccount(n, book.chart, parsed!.resolved)?.id).filter((id): id is string => id !== undefined);
  return ids.length ? ids : undefined;
}

function Player({ initial }: { initial: Book }) {
  const [book, setBook] = useState(initial);
  const count = book.entries.length;
  const [at, setAt] = useState(() => {
    const n = Number(params.get("at"));
    return params.has("at") && Number.isInteger(n) ? Math.max(0, Math.min(count, n)) : count;
  });
  const [width, setWidth] = useState(() => window.innerWidth);
  const stateRef = useRef({ book, at });
  stateRef.current = { book, at };

  const step = (by: number) => setAt((a) => Math.max(0, Math.min(count, a + by)));

  useEffect(() => {
    window.__embed = { book: () => stateRef.current.book, at: () => stateRef.current.at, visual };
    const onResize = () => setWidth(window.innerWidth);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") step(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") step(-1);
      else if (e.key === "Home") setAt(0);
      else if (e.key === "End") setAt(count);
      else return;
      e.preventDefault();
    };
    // A horizontal swipe that starts off the draggable parts steps through.
    let start: { x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      const onHandle = e.target instanceof Element && e.target.closest("[data-entrypad-drag], button");
      start = e.touches.length === 1 && t && !onHandle ? { x: t.clientX, y: t.clientY } : null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
    // count only changes if a drag adds or removes entries, which they don't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = at >= count ? undefined : at;
  const common = { book, onBookChange: setBook, showDiagnostics: false, maxWidth: width - 16, ...(shown !== undefined && { at: shown }) };
  const accounts = namedAccounts(book);
  const tbAccounts = namedAccounts(book, "trial-balance");
  const view: Record<VisualName, () => ReactElement> = {
    "t-accounts": () => <TAccount {...common} {...(accounts && { accounts })} />,
    equation: () => <Equation {...common} />,
    "entry-cards": () => <EntryCards {...common} />,
    "trial-balance": () => <TrialBalance {...common} {...(tbAccounts && { accounts: tbAccounts })} />,
    "statement-flow": () => <StatementFlow {...common} />,
  };

  return (
    <main>
      <div className="visual">{view[visual]()}</div>
      {count > 0 && (
        <nav className="steps" aria-label="Step through the entries">
          <button type="button" id="prev" onClick={() => step(-1)} disabled={at === 0} aria-label="Previous entry">
            ←
          </button>
          <span id="position" aria-live="polite">
            {at >= count ? `All ${count} entries` : `${at} of ${count}`}
          </span>
          <button type="button" id="next" onClick={() => step(1)} disabled={at >= count} aria-label="Next entry">
            →
          </button>
        </nav>
      )}
    </main>
  );
}

function Empty() {
  return (
    <main>
      <div className="empty">
        <h1>No book to show</h1>
        <p>This embed link has no book in it. Copy an embed link from the Entrypad editor and use that instead.</p>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HighlightProvider>{parsed ? <Player initial={parsed.book} /> : <Empty />}</HighlightProvider>
  </StrictMode>,
);
