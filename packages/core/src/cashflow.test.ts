import { describe, expect, it } from "vitest";
import { cashFlow, cashSections } from "./cashflow.js";
import { diagnose } from "./diagnose.js";
import { applyChanges, bookChanges } from "./edit.js";
import { parse } from "./parse/parse.js";
import { defaultSettings, setSetting } from "./settings.js";
import type { Book } from "./types.js";
import { ledger } from "./views.js";

const today = new Date(2026, 5, 1);
const read = (text: string) => parse(text, undefined, { today }).book;
const amounts = (lines: { account: { id: string }; amount: number }[]) => lines.map((l) => [l.account.id, l.amount]);
const tagsOff = setSetting(defaultSettings(), "cashFlow.inferSections", false);

const text = `book "Shop" period 2026-01-01..2026-01-31
account "Gain on Sale of Equipment" revenue group other-revenue
open Cash 5,000
open Equipment 3,000
open Accumulated Depreciation, Equipment 1,000
open Retained Earnings 7,000

Jan 2 Buy a van, part on a note
  Equipment 12,000
      Cash 2,000
      Notes Payable 10,000

Jan 3 Stock on account: Inventory 6,000 / Accounts Payable 6,000

Jan 5 Sales
  Cash                 9,000
  Cost of Goods Sold   4,000
      Sales Revenue          9,000
      Inventory              4,000

Jan 9 Sell the old oven   [investing]
  Cash 2,500
  Accumulated Depreciation, Equipment 1,000
      Equipment 3,000
      Gain on Sale of Equipment 500

Jan 12 Pay the supplier: Accounts Payable 4,000 / Cash 4,000

Jan 15 Pay wages: Wages Expense 1,500 / Cash 1,500

Jan 20 Pay a dividend: Dividends 700 / Cash 700

Jan 22 Issue stock for land: Land 8,000 / Common Stock 8,000

Jan 25 Repay part of the note: Notes Payable 1,000 / Cash 1,000

Jan 31 Depreciate the van   [adjusting]
  Depreciation Expense   200
      Accumulated Depreciation, Equipment   200

Jan 31 Wages owed   [adjusting]
  Wages Expense   300
      Wages Payable   300

Jan 31 Close [closing]
  Sales Revenue 9,000
  Gain on Sale of Equipment 500
      Cost of Goods Sold 4,000
      Wages Expense 1,800
      Depreciation Expense 200
      Retained Earnings 3,500
`;
const book = read(text);

describe("cashSections", () => {
  it("uses the tag, or infers the section from the other side of the entry", () => {
    expect([...cashSections(book)].map(([id, c]) => [id, c.section, c.inferred, c.basis?.id])).toEqual([
      ["e1", "investing", true, "equipment"],
      ["e3", "operating", true, undefined],
      ["e4", "investing", false, undefined],
      ["e5", "operating", true, undefined],
      ["e6", "operating", true, undefined],
      ["e7", "financing", true, "dividends"],
      ["e9", "financing", true, "notes-payable"],
    ]);
  });

  it("puts untagged entries under operating when inference is off", () => {
    expect([...cashSections(book, tagsOff)].map(([id, c]) => [id, c.section])).toEqual([
      ["e1", "operating"],
      ["e3", "operating"],
      ["e4", "investing"],
      ["e5", "operating"],
      ["e6", "operating"],
      ["e7", "operating"],
      ["e9", "operating"],
    ]);
  });

  it("leaves out transfers between cash accounts", () => {
    expect(cashSections(read("Jan 1 x: Petty Cash 100 / Cash 100\n")).size).toBe(0);
  });
});

describe("cashFlow, direct method", () => {
  const cf = cashFlow(book, "direct");

  it("lists each entry's cash by section, with beginning and ending cash", () => {
    expect(cf.operating.items.map((i) => [i.entryId, i.amount])).toEqual([
      ["e3", 9_000_00],
      ["e5", -4_000_00],
      ["e6", -1_500_00],
    ]);
    expect(cf.operating.items[0]).toMatchObject({ date: "2026-01-05", memo: "Sales", section: "operating", inferred: true });
    expect(cf.investing.items.map((i) => [i.entryId, i.amount])).toEqual([
      ["e1", -2_000_00],
      ["e4", 2_500_00],
    ]);
    expect(cf.financing.items.map((i) => [i.entryId, i.amount])).toEqual([
      ["e7", -700_00],
      ["e9", -1_000_00],
    ]);
    expect([cf.operating.total, cf.investing.total, cf.financing.total]).toEqual([3_500_00, 500_00, -1_700_00]);
    expect(cf).toMatchObject({ netChange: 2_300_00, beginningCash: 5_000_00, endingCash: 7_300_00 });
    expect(cf.endingCash).toBe(ledger(book).get("cash")!.balance);
  });

  it("lists entries that exchange investing or financing items without cash", () => {
    expect(cf.nonCashActivities).toEqual([{ entryId: "e8", date: "2026-01-22", memo: "Issue stock for land" }]);
  });
});

describe("cashFlow, indirect method", () => {
  const cf = cashFlow(book, "indirect");

  it("adjusts net income to the operating cash the direct method finds", () => {
    expect(cf.operating.netIncome).toBe(9_000_00 + 500_00 - 4_000_00 - 1_800_00 - 200_00);
    // Depreciation is added back; the gain on the oven came in under investing.
    expect(amounts(cf.operating.adjustments)).toEqual([
      ["depreciation-expense", 200_00],
      ["gain-on-sale-of-equipment", -500_00],
    ]);
    expect(amounts(cf.operating.currentAssets)).toEqual([["inventory", -2_000_00]]);
    expect(amounts(cf.operating.currentLiabilities)).toEqual([
      ["accounts-payable", 2_000_00],
      ["wages-payable", 300_00],
    ]);
    expect(cf.operating.total).toBe(cashFlow(book, "direct").operating.total);
    expect(cf.netChange).toBe(cashFlow(book, "direct").netChange);
  });

  it("agrees with the direct method after every entry, with or without inference", () => {
    for (const settings of [defaultSettings(), tagsOff]) {
      for (let at = 0; at <= book.entries.length; at++) {
        const direct = cashFlow(book, "direct", at, settings);
        const indirect = cashFlow(book, "indirect", at, settings);
        expect(indirect.operating.total, `after ${at}`).toBe(direct.operating.total);
        expect(indirect.netChange, `after ${at}`).toBe(direct.netChange);
        expect(direct.endingCash, `after ${at}`).toBe(ledger(book, at).get("cash")!.balance);
      }
    }
  });

  it("keeps a liability taken on for equipment out of the working capital changes", () => {
    const b = read("open Cash 1,000\nopen Common Stock 1,000\n\nJan 1 Oven on account: Equipment 600 / Accounts Payable 600\n\nJan 2 Pay for the oven [investing]: Accounts Payable 600 / Cash 600\n");
    const cf = cashFlow(b, "indirect");
    expect(cf.operating.currentLiabilities).toEqual([]);
    expect(cf.investing.total).toBe(-600_00);
    expect(cf.nonCashActivities.map((a) => a.entryId)).toEqual(["e1"]);
  });

  it("takes revenue in the opening balances off net income, since it brought in no cash this period", () => {
    const b = read("open Cash 500\nopen Service Revenue 500\n\nJan 3 Fees: Cash 200 / Service Revenue 200\n");
    const cf = cashFlow(b, "indirect");
    expect(cf.operating.netIncome).toBe(700_00);
    expect(amounts(cf.operating.adjustments)).toEqual([["service-revenue", -500_00]]);
    expect(cf.operating.total).toBe(200_00);
  });

  it("returns the same object for the same book, method, at and setting", () => {
    expect(cashFlow(book, "direct")).toBe(cashFlow(book, "direct"));
    expect(cashFlow(book, "direct", 99)).toBe(cashFlow(book, "direct"));
    expect(cashFlow(book, "direct", 3)).not.toBe(cashFlow(book, "direct"));
    expect(cashFlow(book, "direct", undefined, tagsOff)).not.toBe(cashFlow(book, "direct"));
  });
});

describe("inferred-cash-section", () => {
  const src = "Jan 2 Buy a van: Equipment 12,000 / Cash 12,000\n\nJan 3 Pay rent [operating]: Rent Expense 500 / Cash 500\n\nJan 4 Wages: Wages Expense 300 / Cash 300\n";
  const b = read(src);
  const hints = (book: Book, settings = defaultSettings()) => diagnose(book, settings).filter((d) => d.code === "inferred-cash-section");

  it("hints at each untagged cash entry, naming the section and the account that decided it", () => {
    expect(hints(b).map((d) => [d.severity, d.target.entry, d.message])).toEqual([
      ["hint", "e1", "This entry has no cash flow tag, so it's shown under investing activities because of Equipment"],
      ["hint", "e3", "This entry has no cash flow tag, so it's shown under operating activities"],
    ]);
    expect(hints(b, tagsOff).map((d) => d.message)).toEqual([
      "This entry has no cash flow tag, so it's shown under operating activities",
      "This entry has no cash flow tag, so it's shown under operating activities",
    ]);
  });

  it("offers to add the tag, the inferred section first, and the fix writes it into the header", () => {
    const d = hints(b)[0]!;
    expect(d.fixes!.map((f) => f.label)).toEqual(["Tag it [investing]", "Tag it [operating]", "Tag it [financing]"]);
    const fixed = d.fixes![0]!.apply(b);
    expect(fixed.entries[0]!.tags).toEqual(["investing"]);
    expect(b.entries[0]!.tags).toBeUndefined();
    const out = applyChanges(src, bookChanges(src, b, fixed));
    expect(out.split("\n")[0]).toBe("Jan 2, 2026 Buy a van   [investing]");
    expect(hints(read(out)).map((h) => h.target.entry)).toEqual(["e3"]);
  });

  it("can be turned off", () => {
    expect(hints(b, setSetting(defaultSettings(), "diagnostics.inferred-cash-section", "off"))).toEqual([]);
  });
});
