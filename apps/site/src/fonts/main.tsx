import { StrictMode, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { find, headingFonts, monoFonts, pairings, textFonts } from "./pairings.js";
import type { Pairing } from "./pairings.js";
import "./fonts.css";

interface Choice {
  heading: string;
  text: string;
  mono: string;
}

const params = new URLSearchParams(location.search);
const startPairing = pairings.find((p) => p.id === params.get("pair")) ?? pairings[0]!;
const start: Choice = {
  heading: params.get("h") ?? startPairing.heading,
  text: params.get("t") ?? startPairing.text,
  mono: params.get("m") ?? startPairing.mono,
};

function matching(c: Choice): Pairing | undefined {
  return pairings.find((p) => p.heading === c.heading && p.text === c.text && p.mono === c.mono);
}

function vars(c: Choice): CSSProperties {
  return {
    "--heading": find(headingFonts, c.heading).stack,
    "--text": find(textFonts, c.text).stack,
    "--mono": find(monoFonts, c.mono).stack,
  } as CSSProperties;
}

function App() {
  const [choice, setChoice] = useState<Choice>(start);
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const pairing = matching(choice);

  useEffect(() => {
    const q = new URLSearchParams();
    if (pairing) q.set("pair", pairing.id);
    else {
      q.set("h", choice.heading);
      q.set("t", choice.text);
      q.set("m", choice.mono);
    }
    history.replaceState(null, "", `?${q}`);
  }, [choice, pairing]);

  const css = [
    `--font-heading: ${find(headingFonts, choice.heading).stack};`,
    `--font-text: ${find(textFonts, choice.text).stack};`,
    `--font-mono: ${find(monoFonts, choice.mono).stack};`,
  ].join("\n");

  return (
    <div className="page" data-theme={dark ? "dark" : "light"}>
      <header className="top">
        <h1>Font test</h1>
        <p>
          Tap a pairing to see the site in it, or mix your own below the preview. The address bar keeps
          your choice, so you can send the link.
        </p>
      </header>

      <section aria-label="Pairings" className="pairings">
        {pairings.map((p) => {
          const selected = pairing?.id === p.id;
          return (
            <button
              type="button"
              key={p.id}
              className="pairing"
              aria-pressed={selected}
              data-pairing={p.id}
              style={vars(p)}
              onClick={() => setChoice({ heading: p.heading, text: p.text, mono: p.mono })}
            >
              <span className="pairing-name">
                {p.name}
                {p.pick && <span className="pick">My pick</span>}
              </span>
              <span className="pairing-heading">Entrypad</span>
              <span className="pairing-text">Drag a transaction onto the books.</span>
              <span className="pairing-figures">Cash 10,000 4,000 Bal. 6,000</span>
              <span className="pairing-why">{p.why}</span>
            </button>
          );
        })}
      </section>

      <div className="controls">
        <label>
          Headings
          <select value={choice.heading} onChange={(e) => setChoice({ ...choice, heading: e.target.value })}>
            {headingFonts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Text and figures
          <select value={choice.text} onChange={(e) => setChoice({ ...choice, text: e.target.value })}>
            {textFonts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Shorthand
          <select value={choice.mono} onChange={(e) => setChoice({ ...choice, mono: e.target.value })}>
            {monoFonts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark
        </label>
      </div>

      <article className="preview" style={vars(choice)} data-testid="preview">
        <h1>Entrypad</h1>
        <p className="lede">
          Entrypad makes live accounting visuals for presentations and reports. You write the journal
          entries, and it draws the T-accounts, the accounting equation and the financial statements from
          them. Drag a transaction onto the books and every view updates with it.
        </p>

        <h2>Write entries the way you journalize</h2>
        <p>Debits sit at the left and credits are indented, as in a general journal.</p>
        <pre>{`Jan 3  Buy oven, half cash, half note   [investing]
  Equipment                8,000
      Cash                          4,000
      Notes Payable                 4,000`}</pre>

        <h2>See the accounts move</h2>
        <p>Every T-account reads from the same journal, so the views always agree.</p>
        <TAccounts />

        <h2>Check that the figures line up</h2>
        <p>
          Columns of amounts use tabular figures, so every digit takes the same width. If a font lacks
          them, the columns below won't line up.
        </p>
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
            </tr>
          </thead>
          <tbody>
            {trialBalance.map(([name, dr, cr]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="num">{dr}</td>
                <td className="num">{cr}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Totals</td>
              <td className="num">19,411.11</td>
              <td className="num">19,411.11</td>
            </tr>
          </tfoot>
        </table>
        <p className="glyphs" aria-label="Characters that are easy to confuse">
          0O 1lI 5S 8B 2Z &nbsp; $1,234,567.89 &nbsp; (4,000) &nbsp; 10k
        </p>
      </article>

      <section className="css">
        <h2>CSS for this choice</h2>
        <pre>{css}</pre>
      </section>
    </div>
  );
}

const trialBalance: [string, string, string][] = [
  ["Cash", "4,800.00", ""],
  ["Accounts Receivable", "3,000.00", ""],
  ["Equipment", "8,000.00", ""],
  ["Prepaid Rent", "1,111.11", ""],
  ["Notes Payable", "", "4,000.00"],
  ["Common Stock", "", "10,000.00"],
  ["Service Revenue", "", "3,000.00"],
  ["Accumulated Depreciation", "", "2,411.11"],
  ["Rent Expense", "2,500.00", ""],
];

/** Static T-accounts drawn in the text font, as the visuals would be. */
function TAccounts() {
  const ts = [
    { name: "Cash", dr: ["10,000"], cr: ["4,000", "1,200"], bal: "4,800", normal: "dr" },
    { name: "Equipment", dr: ["8,000"], cr: [], bal: "8,000", normal: "dr" },
    { name: "Notes Payable", dr: [], cr: ["4,000"], bal: "4,000", normal: "cr" },
  ];
  const w = 184;
  const h = 132;
  return (
    <svg className="taccounts" viewBox={`0 0 ${ts.length * (w + 16) - 16} ${h}`} role="img" aria-label="Three T-accounts">
      {ts.map((t, i) => (
        <g key={t.name} transform={`translate(${i * (w + 16)}, 0)`}>
          <rect width={w} height={h} rx={6} className="t-box" />
          <text x={w / 2} y={21} textAnchor="middle" className="t-title">
            {t.name}
          </text>
          <line x1={12} y1={31} x2={w - 12} y2={31} className="t-rule" />
          <line x1={w / 2} y1={31} x2={w / 2} y2={h - 34} className="t-rule" />
          {t.dr.map((a, j) => (
            <text key={`d${j}`} x={w / 2 - 10} y={50 + j * 17} textAnchor="end" className="t-num">
              {a}
            </text>
          ))}
          {t.cr.map((a, j) => (
            <text key={`c${j}`} x={w - 12} y={50 + j * 17} textAnchor="end" className="t-num">
              {a}
            </text>
          ))}
          <text x={t.normal === "dr" ? 12 : w / 2 + 10} y={h - 13} className="t-label">
            Bal.
          </text>
          <text x={t.normal === "dr" ? w / 2 - 10 : w - 12} y={h - 13} textAnchor="end" className="t-num t-bal">
            {t.bal}
          </text>
        </g>
      ))}
    </svg>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
