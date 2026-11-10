import { serializeSvg, svgBlob } from "@entrypad/export";
import type { SerializeSvgOptions } from "@entrypad/export";
import { PostingBoard } from "@entrypad/react";
import type { BoardValue } from "@entrypad/react";
import { Profiler, StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPerf } from "./perf.js";
import { chartWith, sampleBook, sampleDrafts } from "./sample.js";
import "./spike.css";

const params = new URLSearchParams(location.search);
const accountCount = Math.max(4, Math.min(120, Number(params.get("accounts") ?? 30) || 30));
const { chart, visible } = chartWith(accountCount);
const initial = (): BoardValue => ({ book: sampleBook(chart), drafts: sampleDrafts });

const perf = createPerf();

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
      perf: typeof perf.log;
    };
  }
}

function App() {
  const [value, setValue] = useState<BoardValue>(initial);
  const [showDiagnostics, setShowDiagnostics] = useState(params.get("diagnostics") !== "0");
  const [maxWidth, setMaxWidth] = useState(() => Math.min(window.innerWidth, 1240));
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const onResize = () => setMaxWidth(Math.min(window.innerWidth, 1240));
    window.addEventListener("resize", onResize);
    window.__spike = {
      value: () => valueRef.current,
      status: () => perf.status,
      exportSvg: (options) => serializeSvg(boardSvg(), options),
      perf: perf.log,
    };
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const download = () => {
    const url = URL.createObjectURL(svgBlob(serializeSvg(boardSvg())));
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
          <label>
            <input
              type="checkbox"
              checked={showDiagnostics}
              onChange={(e) => setShowDiagnostics(e.target.checked)}
            />{" "}
            Show diagnostics
          </label>
          <span className="sizes">
            Board size: <a href="?accounts=30">30</a> <a href="?accounts=40">40</a>{" "}
            <a href="?accounts=60">60</a>
          </span>
        </div>
      </header>
      <div id="board">
        <Profiler id="board" onRender={(_id, _phase, actual) => perf.onCommit(actual)}>
          <PostingBoard
            book={value.book}
            drafts={value.drafts}
            accounts={visible}
            onChange={setValue}
            showDiagnostics={showDiagnostics}
            maxWidth={maxWidth}
            opaqueFrames={params.get("frames") !== "plain"}
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
