import { describe, expect, it } from "vitest";
import { usGaapIntroChart } from "./charts/usGaapIntro.js";
import { diagnose } from "./diagnose.js";
import { exportHledger, importHledger, matchHledgerAccount } from "./hledger.js";
import { parse } from "./parse/parse.js";
import { defaultSettings, setSetting } from "./settings.js";
import type { SettingValue } from "./settings.js";
import type { Book, Line } from "./types.js";

const today = new Date(2026, 5, 1);
const s = (key?: string, value?: SettingValue) =>
  key === undefined ? defaultSettings() : setSetting(defaultSettings(), key, value!);
const summary = (lines: Line[]) => lines.map((l) => `${l.side} ${l.account} ${l.amount / 100}`);
const slice = (text: string, r?: { from: number; to: number }) => (r ? text.slice(r.from, r.to) : undefined);

describe("matchHledgerAccount", () => {
  const id = (name: string, settings = s()) => matchHledgerAccount(name, usGaapIntroChart, settings)?.id;

  it("matches by the last part of the name", () => {
    expect(id("assets:cash")).toBe("cash");
    expect(id("assets:current:accounts receivable")).toBe("accounts-receivable");
    expect(id("Assets:A/R")).toBe("accounts-receivable");
  });

  it("falls back to the one account of the right type that contains the last part", () => {
    expect(id("liabilities:notes")).toBe("notes-payable");
    expect(id("expenses:rent")).toBe("rent-expense");
    expect(id("revenues:service")).toBe("service-revenue");
    expect(id("income:interest")).toBe("interest-revenue");
  });

  it("matches nothing when that part fits several accounts or none", () => {
    expect(id("assets:prepaid")).toBeUndefined();
    expect(id("assets:delivery vans")).toBeUndefined();
  });

  it("can match by the full name instead", () => {
    expect(id("assets:cash", s("hledger.importMatch", "full-name"))).toBeUndefined();
    expect(id("Cash", s("hledger.importMatch", "full-name"))).toBe("cash");
  });
});

describe("importHledger", () => {
  it("reads the spec's example", () => {
    const journal = "2026-01-03 Buy oven\n    assets:equipment     $8,000\n    assets:cash         $-4,000\n    liabilities:notes   $-4,000\n";
    const r = importHledger(journal, s(), { today });
    expect(r.diagnostics).toEqual([]);
    expect(r.text).toBe("Jan 3, 2026 Buy oven\n  Equipment          8,000\n      Cash                  4,000\n      Notes Payable         4,000\n");
    expect(summary(r.book.entries[0]!.lines)).toEqual(["dr equipment 8000", "cr cash 4000", "cr notes-payable 4000"]);
  });

  it("drops status marks and codes, and reads every date form and amount form", () => {
    const journal = [
      "2026/01/05 * (1042) Pay rent  ; paid by cheque",
      "    expenses:rent       1,200.50 USD",
      "    assets:cash        -$1,200.50",
      "",
      "2026.01.06 ! Sell services",
      "    assets:cash         $ 300",
      "    revenues:service   -300",
    ].join("\n");
    const r = importHledger(journal, s(), { today });
    expect(r.diagnostics).toEqual([]);
    expect(r.book.entries.map((e) => [e.date, e.memo])).toEqual([
      ["2026-01-05", "Pay rent"],
      ["2026-01-06", "Sell services"],
    ]);
    expect(summary(r.book.entries[0]!.lines)).toEqual(["dr rent-expense 1200.5", "cr cash 1200.5"]);
    expect(summary(r.book.entries[1]!.lines)).toEqual(["dr cash 300", "cr service-revenue 300"]);
  });

  it("fills a posting with no amount from what balances the transaction, on whichever side that is", () => {
    const r = importHledger("2026-01-15 Bill\n    assets:receivable   $3,000\n    revenues:service\n", s(), { today });
    expect(r.book.entries[0]!.lines[1]).toMatchObject({ account: "service-revenue", side: "cr", amount: 300_000, inferred: true });
    const debit = importHledger("2026-01-15 Pay\n    expenses:rent\n    assets:cash   $-500\n", s(), { today });
    expect(debit.book.entries[0]!.lines[0]).toMatchObject({ side: "dr", amount: 50_000, inferred: true });
  });

  it("turns ; comments into # comments", () => {
    const r = importHledger("; Bakery journal\n# set up in 2026\n\n2026-01-01 Start\n    ; posting note\n    assets:cash   $10\n    equity:common stock   $-10\n", s(), { today });
    expect(r.text.startsWith("# Bakery journal\n# set up in 2026\n\n# posting note\nJan 1, 2026 Start\n")).toBe(true);
    expect(r.diagnostics).toEqual([]);
  });

  it("keeps unused directives as comments and hints at them", () => {
    const journal = "commodity $1,000.00\n    format $1,000.00\ninclude other.journal\nP 2026-01-01 AAPL $150\n~ monthly\n    expenses:rent  $1,200\n    assets:cash\n\n2026-01-02 x\n    assets:cash  $1\n    equity:common stock  $-1\n";
    const r = importHledger(journal, s(), { today });
    expect(r.diagnostics.map((d) => [d.code, d.severity, slice(journal, d.target.source)])).toEqual([
      ["unsupported-directive", "hint", "commodity $1,000.00"],
      ["unsupported-directive", "hint", "include other.journal"],
      ["unsupported-directive", "hint", "P 2026-01-01 AAPL $150"],
      ["unsupported-directive", "hint", "~ monthly"],
    ]);
    expect(r.text).toContain("# commodity $1,000.00\n#     format".replace("#     format", "# format"));
    expect(r.text).toContain("# ~ monthly\n# expenses:rent  $1,200\n# assets:cash");
    expect(r.book.entries).toHaveLength(1);
  });

  it("drops unused directives when told to, still hinting", () => {
    const r = importHledger("include other.journal\n\n2026-01-02 x\n    assets:cash  $1\n    equity:common stock  $-1\n", s("hledger.keepUnsupportedAsComments", false), { today });
    expect(r.text).not.toContain("include");
    expect(r.diagnostics[0]!.message).toContain("left out");
  });

  it("drops balance assertions, prices and virtual postings with a hint", () => {
    const journal = "2026-01-02 x\n    assets:cash  $5 = $105\n    (budget:food)  $5\n    equity:common stock  $-5 @ $1\n";
    const r = importHledger(journal, s(), { today });
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      "A balance assertion isn't used by Entrypad, so it was kept as a comment",
      "A virtual posting isn't used by Entrypad, so it was kept as a comment",
      "A price isn't used by Entrypad, so it was kept as a comment",
    ]);
    expect(summary(r.book.entries[0]!.lines)).toEqual(["dr cash 5", "cr common-stock 5"]);
  });

  it("reads hledger tags that name Entrypad tags", () => {
    const r = importHledger("2026-01-31 Depreciation  ; adjusting:, project:oven\n    expenses:depreciation  $200\n    assets:accumulated depreciation, equipment  $-200\n", s(), { today });
    expect(r.book.entries[0]).toMatchObject({ memo: "Depreciation", tags: ["adjusting"] });
    expect(r.book.entries[0]!.lines.map((l) => l.account)).toEqual(["depreciation-expense", "accumulated-depreciation-equipment"]);
  });

  it("keeps an unmatched name, for diagnose to flag with suggestions", () => {
    const r = importHledger("2026-01-02 x\n    assets:delivery vans  $100\n    assets:cash  $-100\n", s(), { today });
    expect(r.book.entries[0]!.lines[0]!.account).toBe("delivery vans");
    expect(diagnose(r.book).map((d) => d.code)).toEqual(["unknown-account", "abnormal-balance"]);
  });

  it("flags amounts in other commodities and dates that don't exist", () => {
    const journal = "2026-02-30 x\n    assets:cash  10 AAPL\n    equity:common stock  $-10\n";
    const r = importHledger(journal, s(), { today });
    expect(r.diagnostics.map((d) => [d.code, slice(journal, d.target.source)])).toEqual([
      ["invalid-date", "2026-02-30"],
      ["invalid-amount", "10 AAPL"],
    ]);
  });

  it("reads comment blocks", () => {
    const r = importHledger("comment\nanything here\n\nend comment\n2026-01-02 x\n    assets:cash  $1\n    equity:common stock  $-1\n", s(), { today });
    expect(r.text.startsWith("# anything here\n#\n")).toBe(true);
    expect(r.book.entries).toHaveLength(1);
  });

  it("never throws on random input", () => {
    const pieces = ["2026-01-02", " ", "    ", "\t", "\n", "assets:cash", "$", "-", "100", "=", "@", ";", "(", "[", "~", "commodity", "comment", "end comment", "*", "!"];
    let seed = 3;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    for (let n = 0; n < 300; n++) {
      let text = "";
      for (let i = next() % 30; i > 0; i--) text += pieces[next() % pieces.length];
      expect(() => importHledger(text), JSON.stringify(text)).not.toThrow();
    }
  });
});

describe("exportHledger", () => {
  const bakery = parse(
    `book "Sunrise Bakery" period 2026-01-01..2026-01-31
open Cash 1,000
open Common Stock 1,000

Jan 3  Buy oven   [investing]
  Equipment                8,000.50
      Cash                          4,000
      Notes Payable                 4,000.50

- Undated note
  Supplies  100
      Cash

Jan 15 Bill a catering client
  Accounts Receivable      3,000
      Service Revenue
`,
    defaultSettings(),
    { today },
  ).book;

  it("writes a dated hledger transaction per entry, debits positive and credits negative", () => {
    expect(exportHledger(bakery, s(), { today })).toBe(`; Sunrise Bakery
; Period 2026-01-01 to 2026-01-31

2026-01-01 Opening balances
    assets:cash          $1,000.00
    equity:common stock  $-1,000.00

2026-01-03 Buy oven  ; investing:
    assets:equipment           $8,000.50
    assets:cash                $-4,000.00
    liabilities:notes payable  $-4,000.50

2026-01-03 Undated note  ; undated in Entrypad
    assets:supplies  $100.00
    assets:cash      $-100.00

2026-01-15 Bill a catering client
    assets:accounts receivable  $3,000.00
    revenues:service revenue    $-3,000.00
`);
  });

  it("follows the export settings", () => {
    const plain = setSetting(setSetting(s(), "hledger.exportAccountNames", "plain"), "hledger.exportCurrencySymbol", false);
    const text = exportHledger(bakery, plain, { today });
    expect(text).toContain("    Equipment      8,000.50\n    Cash           -4,000.00\n    Notes Payable  -4,000.50");
  });

  it("dates undated entries from the period, then today, when nothing above has a date", () => {
    const undated = parse("- a\n  Cash 1\n    Common Stock 1\n").book;
    const header = (journal: string) => journal.split("\n").find((l) => /^\d/.test(l));
    expect(header(exportHledger({ ...undated, period: { start: "2026-03-01", end: "2026-03-31" } }))).toBe("2026-03-01 a  ; undated in Entrypad");
    expect(header(exportHledger(undated, s(), { today }))).toBe("2026-06-01 a  ; undated in Entrypad");
  });

  it("reads back as the same book", () => {
    const back = importHledger(exportHledger(bakery, s(), { today }), s(), { today });
    expect(back.diagnostics).toEqual([]);
    const meaning = (b: Book) => b.entries.map((e) => ({ memo: e.memo, tags: e.tags, lines: summary(e.lines) }));
    expect(meaning(back.book)).toEqual(meaning(bakery));
  });
});
