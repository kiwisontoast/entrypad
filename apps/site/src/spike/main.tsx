import { resolveSettings } from "@entrypad/core";
import type { EntrypadSettings } from "@entrypad/core";
import { serializeSvg, svgBlob } from "@entrypad/export";
import type { SerializeSvgOptions } from "@entrypad/export";
import { PostingBoard, SettingsPanel } from "@entrypad/react";
import type { BoardValue } from "@entrypad/react";
import { Profiler, StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPerf } from "./perf.js";
import { chartWith, sampleBook, sampleDrafts } from "./sample.js";
import "./spike.css";

const params = new URLSearchParams(location.search);
const accountCount = Math.max(4, Math.min(120, Number(params.get("accounts") ?? 30) || 30));
const { chart, visible } = chartWith(accountCount);
const initial = (): BoardValue => ({ book: sampleBook(chart), drafts: sampleDrafts });

const perf = createPerf();

const STORAGE_KEY = "entrypad.spike.settings";

function loadStored(): unknown {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function store(settings: EntrypadSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private windows, blocked site data); settings then last for this visit.
  }
}

/** URL flags used by the tests, applied on top of stored settings. */
function urlOverrides(): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (params.get("frames") === "plain") o["display.staticPartsAsComponents"] = false;
  if (params.get("diagnostics") === "0") o["display.showDiagnostics"] = false;
  return o;
}

/** The settings this page acts on; the rest are shown but marked. */
const LIVE = new Set([
  "book.decimals",
  "diagnostics.abnormal-balance",
  "display.showDiagnostics",
  "display.staticPartsAsComponents",
  "display.singlePointerDrags",
  "export.includeDiagnostics",
]);

function boardSvg(): SVGSVGElement {
  const svg = document.querySelector<SVGSVGElement>("#board svg");
  if (!svg) throw new Error("Board is not rendered");
  return svg;
}

declare global {
  interface Window {
    __spike: {
      value: () => BoardValue;
      status: () => "idle" | "dragging";
      exportSvg: (options?: SerializeSvgOptions) => string;
      settings: () => EntrypadSettings;
      perf: typeof perf.log;
    };
  }
}

function App() {
  const [value, setValue] = useState<BoardValue>(initial);
  const [settings, setSettings] = useState<EntrypadSettings>(
    () => resolveSettings(loadStored(), urlOverrides()).settings,
  );
  const [maxWidth, setMaxWidth] = useState(() => Math.min(window.innerWidth, 1240));
  const valueRef = useRef(value);
  valueRef.current = value;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const updateSettings = (next: EntrypadSettings) => {
    setSettings(next);
    store(next);
  };

  useEffect(() => {
    const onResize = () => setMaxWidth(Math.min(window.innerWidth, 1240));
    window.addEventListener("resize", onResize);
    window.__spike = {
      value: () => valueRef.current,
      status: () => perf.status,
      exportSvg: (options) =>
        serializeSvg(boardSvg(), options ?? { includeDiagnostics: settingsRef.current.export.includeDiagnostics }),
      settings: () => settingsRef.current,
      perf: perf.log,
    };
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The book's display decimals follow the settings.
  const book = useMemo(
    () => ({ ...value.book, settings: { ...value.book.settings, decimals: settings.book.decimals } }),
    [value.book, settings.book.decimals],
  );

  const download = () => {
    const text = serializeSvg(boardSvg(), { includeDiagnostics: settings.export.includeDiagnostics });
    const url = URL.createObjectURL(svgBlob(text));
    const a = document.createElement("a");
    a.href = url;
    a.download = "entrypad-posting-board.svg";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const posted = value.book.entries.length;
  return (
    <main>
      <header>
        <h1>Drag spike</h1>
        <p>
          Drag a card onto a T-account to post it. Drag a posted amount onto another account to
          reclassify it. {accountCount} accounts, {posted} entries posted.
        </p>
        <div className="controls">
          <button type="button" onClick={download}>
            Export SVG
          </button>
          <button type="button" onClick={() => setValue(initial())}>
            Reset
          </button>
          <span className="sizes">
            Board size: <a href="?accounts=30">30</a> <a href="?accounts=40">40</a>{" "}
            <a href="?accounts=60">60</a>
          </span>
        </div>
        <details id="settings">
          <summary>Settings</summary>
          <p className="note">
            Every default Entrypad uses is listed here. Settings tagged "Not used yet" are saved now and
            start working when the parser and editor ship.
          </p>
          <SettingsPanel
            settings={settings}
            onChange={updateSettings}
            inactive={(key) => !LIVE.has(key)}
            inactiveNote="Not used yet"
          />
        </details>
      </header>
      <div id="board">
        <Profiler id="board" onRender={(_id, _phase, actual) => perf.onCommit(actual)}>
          <PostingBoard
            book={book}
            drafts={value.drafts}
            accounts={visible}
            onChange={setValue}
            showDiagnostics={settings.display.showDiagnostics}
            severities={settings.diagnostics}
            opaqueFrames={settings.display.staticPartsAsComponents}
            singlePointerDrags={settings.display.singlePointerDrags}
            maxWidth={maxWidth}
            onDragStatus={perf.onStatus}
          />
        </Profiler>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
