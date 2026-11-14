import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Line } from "../types.js";
import { parse } from "./parse.js";
import type { ParseResult } from "./parse.js";

const doc = readFileSync(new URL("../../../../docs/shorthand.md", import.meta.url), "utf8");
const blocks = [...doc.matchAll(/^```(\w*)\r?\n([\s\S]*?)^```/gm)].map((m) => ({ lang: m[1]!, text: m[2]! }));
const today = new Date(2026, 5, 1);
const summary = (lines: Line[]) => lines.map((l) => `${l.side} ${l.account} ${l.amount / 100}`);

/**
 * Every code block in the spec, in order. A block is either checked against
 * what the parser makes of it, or skipped with the reason it isn't shorthand.
 */
const expectations: (((r: ParseResult) => void) | { skip: string })[] = [
  // A complete example
  (r) => {
    expect(r.book.name).toBe("Sunrise Bakery");
    expect(r.book.period).toEqual({ start: "2026-01-01", end: "2026-01-31" });
    expect(r.book.entries.map((e) => [e.date, e.memo, e.tags])).toEqual([
      ["2026-01-01", "Owner invests cash", undefined],
      ["2026-01-03", "Buy oven, half cash, half note", ["investing"]],
      ["2026-01-09", "Pay January rent", undefined],
      ["2026-01-15", "Bill a catering client", undefined],
      ["2026-01-31", "Record depreciation", ["adjusting"]],
    ]);
    expect(r.book.entries.map((e) => summary(e.lines))).toEqual([
      ["dr cash 10000", "cr common-stock 10000"],
      ["dr equipment 8000", "cr cash 4000", "cr notes-payable 4000"],
      ["dr rent-expense 1200", "cr cash 1200"],
      ["dr accounts-receivable 3000", "cr service-revenue 3000"],
      ["dr depreciation-expense 200", "cr accumulated-depreciation-equipment 200"],
    ]);
    expect(r.book.entries[3]!.lines[1]).toMatchObject({ blank: true, inferred: true });
    expect(r.shows.map((s) => [s.visual, s.options])).toEqual([
      ["t-accounts", ["Cash", "Equipment", "Notes Payable"]],
      ["equation", []],
    ]);
  },
  { skip: "header line template" },
  { skip: "posting line template" },
  // dr and cr override indentation
  (r) => expect(summary(r.book.entries[0]!.lines)).toEqual(["dr equipment 8000", "cr cash 4000", "cr notes-payable 4000"]),
  // The one-line form
  (r) => {
    expect(r.book.entries.map((e) => [e.memo, e.tags, summary(e.lines)])).toEqual([
      ["Owner invests", undefined, ["dr cash 10000", "cr common-stock 10000"]],
      ["Buy oven", ["investing"], ["dr equipment 8000", "cr cash 4000", "cr notes-payable 4000"]],
    ]);
  },
  // book
  (r) => expect([r.book.name, r.book.period]).toEqual(["Sunrise Bakery", { start: "2026-01-01", end: "2026-01-31" }]),
  // open
  (r) =>
    expect(summary(r.book.entries[0]!.lines)).toEqual([
      "dr cash 5000",
      "cr accumulated-depreciation-equipment 1200",
      "cr cash 300",
    ]),
  // account
  (r) =>
    expect(r.book.chart.slice(-3)).toEqual([
      { id: "delivery-vans", name: "Delivery Vans", type: "asset", normal: "debit" },
      { id: "accumulated-depreciation-vans", name: "Accumulated Depreciation, Vans", type: "asset", normal: "credit", contraOf: "delivery-vans" },
      { id: "catering-revenue", name: "Catering Revenue", type: "revenue", normal: "credit", aliases: ["Catering"] },
    ]),
  // show
  (r) =>
    expect(r.shows.map((s) => [s.visual, s.options])).toEqual([
      ["t-accounts", ["Cash", "Equipment", "Notes Payable"]],
      ["equation", []],
      ["cash-flow", ["indirect"]],
    ]),
  // set
  (r) =>
    expect(r.settings).toEqual({
      "parsing.dateOrder": "day-first",
      "autofix.inferBlankAmount": false,
      "diagnostics.zero-amount": "off",
    }),
  { skip: "the grammar, in EBNF" },
  { skip: "hledger and shorthand side by side; the hledger half is tested with the importer" },
];

describe("docs/shorthand.md examples", () => {
  it("has an expectation for every code block", () => {
    expect(blocks).toHaveLength(expectations.length);
  });

  blocks.forEach((block, i) => {
    const expectation = expectations[i];
    const first = block.text.split("\n")[0];
    if (!expectation || "skip" in expectation) {
      it.skip(`block ${i + 1} (${expectation?.skip ?? "no expectation"})`, () => {});
      return;
    }
    it(`block ${i + 1}: ${first}`, () => {
      const result = parse(block.text, undefined, { today });
      expect(result.diagnostics).toEqual([]);
      expectation(result);
    });
  });
});
