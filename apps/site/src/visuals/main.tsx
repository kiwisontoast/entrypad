import { diagnose, parse } from "@entrypad/core";
import type { Book } from "@entrypad/core";
import { EntryCards, Equation, HighlightProvider, TAccount } from "@entrypad/react";
import { Profiler, StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import bakery from "../../../../examples/sunrise-bakery.entrypad?raw";
import { createPerf } from "../spike/perf.js";
import { thirtyAccounts } from "../spike/sample.js";
import "../typography.js";
import "./visuals.css";

/**
 * A development page for the Phase 1 visuals, with the bakery sample book.
 * `?accounts=30` draws the same 30 T-accounts as the spike, for the perf tests.
 */

const params = new URLSearchParams(location.search);
const initial = (): Book => parse(bakery).book;
const accounts = params.get("accounts") === "30" ? thirtyAccounts : undefined;
const perf = createPerf();
const countRender = () => {
  if (window.__visuals) window.__visuals.renders++;
};

declare global {
  interface Window {
    __visuals: {
      book: () => Book;
      setBook: (book: Book) => void;
      at: () => number | undefined;
      status: () => "idle" | "dragging";
      perf: typeof perf.log;
      /** How many states the T-accounts have drawn, previews included. */
      renders: number;
    };
  }
}

function App() {
  const [book, setBook] = useState<Book>(initial);
  const [at, setAt] = useState<number | undefined>(() => (params.has("at") ? Number(params.get("at")) : undefined));
  const [width, setWidth] = useState(() => Math.min(window.innerWidth, 1240));
  const bookRef = useRef(book);
  bookRef.current = book;
  const atRef = useRef(at);
  atRef.current = at;

  useEffect(() => {
    const onResize = () => setWidth(Math.min(window.innerWidth, 1240));
    window.addEventListener("resize", onResize);
    window.__visuals = { book: () => bookRef.current, setBook, at: () => atRef.current, status: () => perf.status, perf: perf.log, renders: 0 };
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const count = book.entries.length;
  const step = (by: number) => setAt((a) => Math.max(0, Math.min(count, (a ?? count) + by)));
  const diagnostics = diagnose(book);

  return (
    <HighlightProvider>
      <main>
        <header>
          <h1>Visuals</h1>
          <p>
            {book.name}: {count} entries. Hover a line to light up its entry everywhere. Drag a card line to the other column
            to flip its side, or a T-account amount onto another account to reclassify it.
          </p>
          <div className="controls">
            <button type="button" id="prev" onClick={() => step(-1)}>
              Previous entry
            </button>
            <button type="button" id="next" onClick={() => step(1)}>
              Next entry
            </button>
            <button type="button" id="all" onClick={() => setAt(undefined)}>
              Show all
            </button>
            <span id="position">{at === undefined ? `All ${count} entries` : `After ${at} of ${count}`}</span>
            <button type="button" id="reset" onClick={() => setBook(initial())}>
              Reset
            </button>
          </div>
        </header>
        <section id="equation">
          <Equation book={book} {...(at !== undefined && { at })} showDiagnostics maxWidth={width} />
        </section>
        <section id="t-accounts">
          <Profiler id="t-accounts" onRender={(_id, _phase, actual) => perf.onCommit(actual)}>
            <TAccount
              book={book}
              onBookChange={setBook}
              {...(at !== undefined && { at })}
              {...(accounts && { accounts })}
              showDiagnostics
              diagnostics={diagnostics}
              maxWidth={width}
              onDragStatus={perf.onStatus}
              onRenderState={countRender}
            />
          </Profiler>
        </section>
        <section id="cards">
          <EntryCards book={book} onBookChange={setBook} {...(at !== undefined && { at })} showDiagnostics diagnostics={diagnostics} maxWidth={width} />
        </section>
      </main>
    </HighlightProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
