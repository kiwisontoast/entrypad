import { parse, toCents } from "@entrypad/core";
import type { Book } from "@entrypad/core";
import { EntryCards, Equation, HighlightProvider, PostingBoard, TAccount } from "@entrypad/react";
import type { BoardValue } from "@entrypad/react";
import { StrictMode, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import bakery from "../../../../examples/sunrise-bakery.entrypad?raw";
import { bookUrl } from "../share.js";
import "../typography.js";
import "./home.css";

/**
 * The landing page. The text is plain HTML in home/index.html, so it reads
 * without JavaScript; each live figure is a small React island mounted here.
 */

const SAMPLE = `book "Sunrise Bakery" period 2026-01-01..2026-01-31

Jan 1  Owner invests cash
  Cash                25,000
      Common Stock              25,000

Jan 3  Buy ovens, half cash, half note   [investing]
  Equipment           12,000
      Cash                       6,000
      Notes Payable              6,000

Jan 9  Cash sales for the week
  Cash                 3,654
      Sales Revenue              3,654

Jan 31 Depreciation on the ovens   [adjusting]
  Depreciation Expense   200
      Accumulated Depreciation     200
`;

const DEV_EXAMPLE = `import { parse, TAccount } from "entrypad";
import { useState } from "react";

const text = \`Jan 1  Owner invests cash
  Cash            10,000
      Common Stock         10,000\`;

export function Books() {
  const [book, setBook] = useState(() => parse(text).book);
  return <TAccount book={book} onBookChange={setBook} />;
}`;

/** The width of an element's box, kept current as the page resizes. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(280, Math.floor(el.clientWidth))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function Island({ children, className }: { children: (width: number) => ReactNode; className?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  return (
    <div ref={ref} className={className}>
      {children(width)}
    </div>
  );
}

function mount(id: string, node: ReactNode): void {
  const el = document.getElementById(id);
  if (el) createRoot(el).render(<StrictMode>{node}</StrictMode>);
}

// The hero: three unposted cards and four T-accounts.

function heroStart(): BoardValue {
  const book = parse(`Jan 1  Owner invests cash
  Cash  10,000
      Common Stock  10,000
`).book;
  return {
    book,
    drafts: [
      { id: "rent", memo: "Pay January rent", amount: toCents(1_200), fixed: { account: "cash", side: "cr" } },
      { id: "supplies", memo: "Buy supplies on account", amount: toCents(450), fixed: { account: "accounts-payable", side: "cr" } },
      { id: "pay", memo: "Pay the supplier", amount: toCents(450), fixed: { account: "accounts-payable", side: "dr" } },
    ],
  };
}

function Hero() {
  const [value, setValue] = useState(heroStart);
  useEffect(() => {
    const button = document.getElementById("hero-reset");
    const reset = () => setValue(heroStart());
    button?.addEventListener("click", reset);
    return () => button?.removeEventListener("click", reset);
  }, []);
  return (
    <Island>
      {(width) => (
        <PostingBoard
          {...value}
          onChange={setValue}
          accounts={["cash", "supplies", "accounts-payable", "rent-expense"]}
          showDiagnostics={false}
          maxWidth={width}
        />
      )}
    </Island>
  );
}

// How it works: the same short book, as text, as T-accounts, and live.

const sampleBook = parse(SAMPLE).book;
const STEP_ACCOUNTS = ["cash", "equipment", "notes-payable", "sales-revenue"];

function StepDrag() {
  const [book, setBook] = useState<Book>(sampleBook);
  return <Island>{(width) => <TAccount book={book} onBookChange={setBook} accounts={STEP_ACCOUNTS} maxWidth={width} />}</Island>;
}

// The gallery: each visual on the bakery's month, live in place.

const bakeryBook = parse(bakery).book;
const bakeryLink = bookUrl("/editor/", bakery);

function GalleryCard({ title, note, children }: { title: string; note: string; children: (width: number) => ReactNode }) {
  return (
    <article className="card">
      <h3>{title}</h3>
      <p>{note}</p>
      <Island className="card-figure">{children}</Island>
      <a className="open" href={bakeryLink}>
        Open in the editor
      </a>
    </article>
  );
}

function Gallery() {
  const [book, setBook] = useState<Book>(bakeryBook);
  return (
    <HighlightProvider>
      <GalleryCard title="T-accounts" note="Every posting, a running total and the balance. Drag to reclassify or change an amount.">
        {(width) => <TAccount book={book} onBookChange={setBook} accounts={["cash", "accounts-receivable", "sales-revenue", "rent-expense"]} maxWidth={width} />}
      </GalleryCard>
      <GalleryCard title="The accounting equation" note="Assets against liabilities and equity, drawn to scale, with net income shown until it is closed.">
        {(width) => <Equation book={book} maxWidth={width} />}
      </GalleryCard>
      <GalleryCard title="Journal entries" note="Each transaction as a card. Drag a line across to move it to the other side.">
        {(width) => <EntryCards book={book} onBookChange={setBook} at={3} maxWidth={width} />}
      </GalleryCard>
    </HighlightProvider>
  );
}

// Try it: a plain text box with the T-accounts and the equation under it.

function TryIt() {
  const [text, setText] = useState(SAMPLE);
  const book = parse(text).book;
  return (
    <div className="try">
      <label className="try-label" htmlFor="try-text">
        Journal entries
      </label>
      <textarea id="try-text" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} rows={18} />
      <HighlightProvider>
        <Island>{(width) => <TAccount book={book} maxWidth={width} />}</Island>
        <Island>{(width) => <Equation book={book} maxWidth={Math.min(width, 520)} />}</Island>
      </HighlightProvider>
      <a className="open" href={bookUrl("/editor/", text)}>
        Open these entries in the full editor
      </a>
    </div>
  );
}

const stepText = document.getElementById("step-text");
if (stepText) stepText.textContent = SAMPLE.split("\n").slice(2).join("\n").trimEnd();
const devExample = document.getElementById("dev-example");
if (devExample) devExample.textContent = DEV_EXAMPLE;

mount("hero-demo", <Hero />);
mount("step-books", <Island>{(width) => <TAccount book={sampleBook} accounts={STEP_ACCOUNTS} maxWidth={width} />}</Island>);
mount("step-drag", <StepDrag />);
mount("gallery", <Gallery />);
mount("try", <TryIt />);
