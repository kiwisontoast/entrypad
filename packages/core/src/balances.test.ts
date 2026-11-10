import { describe, expect, it } from "vitest";
import { balances, isBalanced } from "./balances.js";
import { formatCents, toCents } from "./money.js";
import type { Book } from "./types.js";

const book: Book = {
  settings: { standard: "us-gaap", currency: "USD", decimals: 0 },
  chart: [
    { id: "cash", name: "Cash", type: "asset", normal: "debit" },
    { id: "equipment", name: "Equipment", type: "asset", normal: "debit" },
    { id: "notes-payable", name: "Notes Payable", type: "liability", normal: "credit" },
    { id: "common-stock", name: "Common Stock", type: "equity", normal: "credit" },
  ],
  entries: [
    {
      id: "e1",
      memo: "Owner invests cash",
      lines: [
        { account: "cash", side: "dr", amount: toCents(10_000) },
        { account: "common-stock", side: "cr", amount: toCents(10_000) },
      ],
    },
    {
      id: "e2",
      memo: "Buy oven, half cash, half note",
      lines: [
        { account: "equipment", side: "dr", amount: toCents(8_000) },
        { account: "cash", side: "cr", amount: toCents(4_000) },
        { account: "notes-payable", side: "cr", amount: toCents(4_000) },
      ],
    },
  ],
};

describe("balances", () => {
  it("totals each account on its normal side", () => {
    const b = balances(book);
    expect(b.get("cash")).toMatchObject({ debits: 1_000_000, credits: 400_000, balance: 600_000 });
    expect(b.get("equipment")?.balance).toBe(800_000);
    expect(b.get("notes-payable")?.balance).toBe(400_000);
    expect(b.get("common-stock")?.balance).toBe(1_000_000);
  });

  it("lists postings in journal order", () => {
    const cash = balances(book).get("cash");
    expect(cash?.postings.map((p) => [p.entryId, p.side])).toEqual([
      ["e1", "dr"],
      ["e2", "cr"],
    ]);
  });

  it("reports an abnormal balance as negative", () => {
    const overdrawn: Book = {
      ...book,
      entries: [
        ...book.entries,
        {
          id: "e3",
          lines: [
            { account: "equipment", side: "dr", amount: toCents(7_000) },
            { account: "cash", side: "cr", amount: toCents(7_000) },
          ],
        },
      ],
    };
    expect(balances(overdrawn).get("cash")?.balance).toBe(-100_000);
  });

  it("checks that the journal balances", () => {
    expect(isBalanced(book)).toBe(true);
  });
});

describe("money", () => {
  it("avoids floating-point drift", () => {
    expect(toCents(0.1) + toCents(0.2)).toBe(toCents(0.3));
  });

  it("formats for statements", () => {
    expect(formatCents(120_000)).toBe("1,200");
    expect(formatCents(120_050, 2)).toBe("1,200.50");
    expect(formatCents(-45_000)).toBe("(450)");
  });
});
