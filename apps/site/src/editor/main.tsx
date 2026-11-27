import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { forceLinting, lintGutter, linter, lintKeymap } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { matchAccount, resolveSettings } from "@entrypad/core";
import type { Book, EntrypadSettings } from "@entrypad/core";
import { EntryCards, Equation, HighlightProvider, SettingsPanel, TAccount, theme } from "@entrypad/react";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import bikes from "../../../../examples/spoke-and-chain-bikes.entrypad?raw";
import bakery from "../../../../examples/sunrise-bakery.entrypad?raw";
import advisory from "../../../../examples/northfield-advisory.entrypad?raw";
import "../typography.js";
import { analyse, lintDiagnostics, writeBook } from "./analyse.js";
import { ExportMenu, slug } from "./exportMenu.js";
import { bookUrl, decodeBook, shareableText } from "../share.js";
import type { Analysis } from "./analyse.js";
import { shorthandLanguage } from "./language.js";
import "./editor.css";

/**
 * The editor: shorthand on the left, the visuals on the right. The text is
 * the only state. Typing re-reads it; a drag in a visual, or a quick fix,
 * rewrites just the entries it changed.
 */

const EXAMPLES: Record<string, { label: string; text: string }> = {
  bakery: { label: "Sunrise Bakery (January)", text: bakery },
  bikes: { label: "Spoke & Chain Bikes (March)", text: bikes },
  advisory: { label: "Northfield Advisory (April)", text: advisory },
  blank: { label: "Blank book", text: 'book "My company" period 2026-01-01..2026-01-31\n\n' },
};

const params = new URLSearchParams(location.search);
// A share link carries the book in the hash; otherwise start from an example.
const shared = decodeBook(location.hash);
if (shared !== undefined) EXAMPLES.shared = { label: "Shared book", text: shared };
const firstExample = shared !== undefined ? "shared" : (params.get("example") ?? "bakery");
const STORAGE_KEY = "entrypad.editor.settings";

function loadSettings(): EntrypadSettings {
  try {
    return resolveSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).settings;
  } catch {
    return resolveSettings().settings;
  }
}

function storeSettings(settings: EntrypadSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private windows, blocked site data); settings then last for this visit.
  }
}

/** Settings the editor doesn't use yet; they stay editable and are marked. */
const notHere = (_key: string) => false;

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The visual an embed link shows, from the book's first show line it can draw. */
const EMBEDDABLE = ["t-accounts", "equation", "entry-cards"];

const editorTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13.5px", backgroundColor: theme.surface },
  ".cm-scroller": { fontFamily: theme.monoFont, lineHeight: "1.55" },
  ".cm-gutters": { backgroundColor: theme.canvas, borderRight: `1px solid ${theme.border}`, color: theme.muted },
  ".cm-activeLine": { backgroundColor: "#f3f6fa" },
  ".cm-activeLineGutter": { backgroundColor: "#e9eef5" },
});

declare global {
  interface Window {
    __editor: {
      text: () => string;
      setText: (text: string) => void;
      book: () => Book;
      analysis: () => Analysis;
    };
  }
}

function App() {
  const [settings, setSettings] = useState<EntrypadSettings>(loadSettings);
  const [text, setText] = useState(() => EXAMPLES[firstExample]?.text ?? EXAMPLES.bakery!.text);
  const [example, setExample] = useState(EXAMPLES[firstExample] ? firstExample : "bakery");
  const [at, setAt] = useState<number | undefined>(undefined);
  const [width, setWidth] = useState(720);
  const editorEl = useRef<HTMLDivElement>(null);
  const visualsEl = useRef<HTMLDivElement>(null);
  const equationEl = useRef<HTMLElement>(null);
  const tAccountsEl = useRef<HTMLElement>(null);
  const cardsEl = useRef<HTMLElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [shareStatus, setShareStatus] = useState("");
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const analysis = analyse(text, settings);
  const { book, resolved, findings } = analysis;

  useEffect(() => {
    const view = new EditorView({
      parent: editorEl.current!,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...lintKeymap]),
          shorthandLanguage,
          linter(
            (v) => {
              const s = settingsRef.current;
              return s.display.showDiagnostics ? lintDiagnostics(analyse(v.state.doc.toString(), s), s) : [];
            },
            { delay: 150 },
          ),
          lintGutter(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setText(update.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ "aria-label": "Book text", spellcheck: "false" }),
          editorTheme,
        ],
      }),
    });
    viewRef.current = view;
    window.__editor = {
      text: () => view.state.doc.toString(),
      setText: (t) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } }),
      book: () => analyse(view.state.doc.toString(), settingsRef.current).book,
      analysis: () => analyse(view.state.doc.toString(), settingsRef.current),
    };
    return () => view.destroy();
    // The editor is created once; later text comes from the editor itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (viewRef.current) forceLinting(viewRef.current);
  }, [settings]);

  useEffect(() => {
    const el = visualsEl.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(320, Math.floor(el.clientWidth))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const updateSettings = (next: EntrypadSettings) => {
    setSettings(next);
    storeSettings(next);
  };

  const loadExample = (key: string) => {
    const view = viewRef.current;
    const next = EXAMPLES[key];
    if (!view || !next) return;
    setExample(key);
    setAt(undefined);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next.text } });
  };

  const replaceText = (next: string) => {
    const view = viewRef.current;
    if (!view) return;
    setAt(undefined);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
  };

  /** The book as it should travel: with set lines for the reader's own file settings. */
  const outgoing = () => shareableText(text, analysis, settings);
  const fileBase = slug(book.name ?? "book");

  const copy = async (link: string, what: string) => {
    try {
      await navigator.clipboard.writeText(link);
      const limit = settings.sharing.linkWarningLength;
      setShareStatus(
        link.length > limit
          ? `${what} copied. It is ${link.length.toLocaleString("en-US")} characters long, and some apps cut links over ${limit.toLocaleString("en-US")}; saving a file may be safer.`
          : `${what} copied.`,
      );
    } catch {
      setShareStatus("This browser didn't allow copying. Try again, or save a file instead.");
    }
  };
  const shareLink = () => bookUrl("/editor/", outgoing());
  const embedVisual = analysis.shows.find((s) => EMBEDDABLE.includes(s.visual))?.visual ?? "t-accounts";
  const embedLink = () => bookUrl("/embed/", outgoing(), `?visual=${embedVisual}`);

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    replaceText(await file.text());
    setExample("file");
    setShareStatus(`Opened ${file.name}.`);
  };

  /** A drag in any visual: write the changed entries back into the text. */
  const onBookChange = (next: Book) => {
    if (viewRef.current) writeBook(viewRef.current, analysis, next, settings);
  };

  // `show t-accounts: ...` lines pick the T-accounts; otherwise every account in use.
  const tAccounts = useMemo(() => {
    const named = analysis.shows.filter((s) => s.visual === "t-accounts").flatMap((s) => s.options);
    const ids = named.map((n) => matchAccount(n, book.chart, resolved)?.id).filter((id): id is string => id !== undefined);
    return ids.length ? ids : undefined;
  }, [analysis, book.chart, resolved]);

  const count = book.entries.length;
  const shownAt = at === undefined || at >= count ? undefined : at;
  const step = (by: number) => setAt((a) => Math.max(0, Math.min(count, (a ?? count) + by)));
  const display = settings.display;
  const interaction = {
    staticPartsAsComponents: display.staticPartsAsComponents,
    singlePointerDrags: display.singlePointerDrags,
    touchScroll: display.touchScroll,
  };
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;

  return (
    <HighlightProvider>
      <header>
        <h1>{book.name ?? "Untitled book"}</h1>
        <div className="controls">
          <label>
            Example{" "}
            <select id="example" value={example} onChange={(e) => loadExample(e.target.value)}>
              {example === "file" && <option value="file">Opened file</option>}
              {Object.entries(EXAMPLES).map(([key, e]) => (
                <option key={key} value={key}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <span className="share">
            <button type="button" id="open-file" onClick={() => fileInput.current?.click()}>
              Open file
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".entrypad,.txt,text/plain"
              hidden
              onChange={(e) => {
                void openFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              id="save-file"
              onClick={() => download(new Blob([outgoing()], { type: "text/plain;charset=utf-8" }), `${fileBase}.entrypad`)}
            >
              Save file
            </button>
            <button type="button" id="copy-link" onClick={() => void copy(shareLink(), "Link")}>
              Copy link
            </button>
            <button type="button" id="copy-embed" onClick={() => void copy(embedLink(), "Embed link")}>
              Copy embed link
            </button>
            <span id="share-status" role="status">
              {shareStatus}
            </span>
          </span>
          <span className="step">
            <button type="button" id="prev" onClick={() => step(-1)} aria-label="Previous entry">
              ←
            </button>
            <span id="position">{shownAt === undefined ? `All ${count} entries` : `After ${shownAt} of ${count}`}</span>
            <button type="button" id="next" onClick={() => step(1)} aria-label="Next entry">
              →
            </button>
          </span>
          <span id="status" className={errors ? "has-errors" : ""}>
            {errors || warnings ? `${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"}` : "No problems"}
          </span>
          <details id="settings">
            <summary>Settings</summary>
            <p className="note">A set line in the book overrides these for that book.</p>
            <SettingsPanel settings={settings} onChange={updateSettings} inactive={notHere} inactiveNote="Not used in the editor yet" />
          </details>
        </div>
      </header>
      <div className="workspace">
        <div className="editor" ref={editorEl} />
        <div className="visuals" ref={visualsEl}>
          <section id="equation" ref={equationEl}>
            <Equation book={book} {...(shownAt !== undefined && { at: shownAt })} showDiagnostics={display.showDiagnostics} maxWidth={width} />
            <ExportMenu
              section={equationEl}
              fileName={slug(book.name ?? "book", "equation")}
              settings={settings}
              count={count}
              shareLink={shareLink}
              renderAt={(n) => <Equation book={book} at={n} showDiagnostics={false} maxWidth={width} />}
            />
          </section>
          <section id="t-accounts" ref={tAccountsEl}>
            <TAccount
              book={book}
              onBookChange={onBookChange}
              {...(shownAt !== undefined && { at: shownAt })}
              {...(tAccounts && { accounts: tAccounts })}
              showDiagnostics={display.showDiagnostics}
              diagnostics={findings}
              maxWidth={width}
              {...interaction}
            />
            <ExportMenu
              section={tAccountsEl}
              fileName={slug(book.name ?? "book", "t-accounts")}
              settings={settings}
              count={count}
              shareLink={shareLink}
              renderAt={(n) => <TAccount book={book} at={n} {...(tAccounts && { accounts: tAccounts })} maxWidth={width} />}
            />
          </section>
          <section id="cards" ref={cardsEl}>
            <EntryCards
              book={book}
              onBookChange={onBookChange}
              {...(shownAt !== undefined && { at: shownAt })}
              showDiagnostics={display.showDiagnostics}
              diagnostics={findings}
              maxWidth={width}
              {...interaction}
            />
            <ExportMenu
              section={cardsEl}
              fileName={slug(book.name ?? "book", "entries")}
              settings={settings}
              count={count}
              shareLink={shareLink}
              renderAt={(n) => <EntryCards book={book} at={n} maxWidth={width} />}
            />
          </section>
        </div>
      </div>
    </HighlightProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
