import { matchAccount, parse } from "@entrypad/core";
import type { Book, EntrypadSettings, ParseResult } from "@entrypad/core";
import { EntryCards, Equation, TAccount } from "@entrypad/react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** The visuals an `entrypad` block can show, by the names `show` lines use. */
export const blockVisuals = ["t-accounts", "equation", "entry-cards"] as const;
export type BlockVisual = (typeof blockVisuals)[number];

export interface BlockOptions {
  /** The width the visuals fit inside, in pixels. They scale down on narrower screens. Default 720. */
  width?: number;
  /** The reader's settings; a `set` line in the block overrides them. */
  settings?: EntrypadSettings;
}

/** What a block draws: the visuals its `show` lines name, in order, or T-accounts when it names none. */
export function visualsFor(parsed: Pick<ParseResult, "shows">): BlockVisual[] {
  const named = parsed.shows.map((s) => s.visual).filter((v): v is BlockVisual => (blockVisuals as readonly string[]).includes(v));
  return named.length ? [...new Set(named)] : ["t-accounts"];
}

/** The accounts a `show t-accounts:` line names, as ids, if any. */
export function shownAccounts(parsed: ParseResult): string[] | undefined {
  const names = parsed.shows.filter((s) => s.visual === "t-accounts").flatMap((s) => s.options);
  const ids = names.map((n) => matchAccount(n, parsed.book.chart, parsed.resolved)?.id).filter((id): id is string => id !== undefined);
  return ids.length ? ids : undefined;
}

/** One visual of a block, as a React element. Live when `onBookChange` is given, otherwise plain SVG. */
export function blockVisual(
  visual: BlockVisual,
  book: Book,
  accounts: string[] | undefined,
  width: number,
  onBookChange?: (book: Book) => void,
): ReactElement {
  const live = onBookChange !== undefined;
  const common = { book, maxWidth: width, showDiagnostics: false, ...(live ? { onBookChange } : { staticRender: true }) };
  switch (visual) {
    case "t-accounts":
      return <TAccount {...common} {...(accounts && { accounts })} />;
    case "entry-cards":
      return <EntryCards {...common} />;
    case "equation":
      return <Equation book={book} maxWidth={width} showDiagnostics={false} />;
  }
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Renders the text of an `entrypad` code block as HTML: a `<figure>` with
 * each visual drawn as plain SVG, so the page reads well with no script at
 * all. The block's text rides along in `data-entrypad-source`, and
 * `@entrypad/markdown/client` turns the figures live in the browser.
 * Squiggles never appear: a block is a finished visual, not an editor.
 */
export function renderBlock(source: string, options: BlockOptions = {}): string {
  const width = options.width ?? 720;
  const parsed = parse(source, options.settings);
  const accounts = shownAccounts(parsed);
  const parts = visualsFor(parsed).map(
    (v) => `<div class="entrypad-visual" data-visual="${v}">${renderToStaticMarkup(blockVisual(v, parsed.book, accounts, width))}</div>`,
  );
  return `<figure class="entrypad" data-entrypad-source="${escapeAttr(source)}" data-entrypad-width="${width}">${parts.join("")}</figure>\n`;
}
