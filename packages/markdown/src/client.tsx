import { parse } from "@entrypad/core";
import type { Book } from "@entrypad/core";
import { HighlightProvider } from "@entrypad/react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { blockVisual, blockVisuals, shownAccounts } from "./render.js";
import type { BlockVisual } from "./render.js";

/**
 * Makes the Entrypad figures on a page live: each `<figure class="entrypad">`
 * that `renderBlock` wrote is replaced by the same visuals, now draggable,
 * with the linked highlight across the visuals of one figure. Drags change
 * only what this reader sees. Returns the number of figures it took over.
 *
 *     import { hydrateEntrypad } from "@entrypad/markdown/client";
 *     hydrateEntrypad();
 */
export function hydrateEntrypad(root: ParentNode = document): number {
  let count = 0;
  for (const figure of Array.from(root.querySelectorAll<HTMLElement>("figure.entrypad[data-entrypad-source]"))) {
    if (figure.dataset.entrypadLive) continue;
    const source = figure.dataset.entrypadSource ?? "";
    const width = Number(figure.dataset.entrypadWidth) || 720;
    const visuals = Array.from(figure.querySelectorAll<HTMLElement>(".entrypad-visual"))
      .map((el) => el.dataset.visual)
      .filter((v): v is BlockVisual => (blockVisuals as readonly string[]).includes(v ?? ""));
    figure.dataset.entrypadLive = "true";
    createRoot(figure).render(
      <StrictMode>
        <LiveFigure source={source} visuals={visuals} width={width} />
      </StrictMode>,
    );
    count++;
  }
  return count;
}

function LiveFigure({ source, visuals, width }: { source: string; visuals: BlockVisual[]; width: number }) {
  const [parsed] = useState(() => parse(source));
  const [book, setBook] = useState<Book>(parsed.book);
  const [fit, setFit] = useState(width);
  const accounts = shownAccounts(parsed);

  // Fit the figure's own column, never wider than the width it was drawn for.
  useEffect(() => {
    const onResize = () => setFit(Math.min(width, document.documentElement.clientWidth - 16));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [width]);

  return (
    <HighlightProvider>
      {visuals.map((v) => (
        <div key={v} className="entrypad-visual" data-visual={v}>
          {blockVisual(v, book, accounts, fit, setBook)}
        </div>
      ))}
    </HighlightProvider>
  );
}
