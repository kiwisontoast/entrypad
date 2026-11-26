import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnose.js";
import { format, formatAsset } from "./format.js";
import { parse } from "./parse/parse.js";
import { contraAccount, depreciationSchedule, depreciationSchedules } from "./schedules.js";
import { defaultSettings, setSetting } from "./settings.js";
import type { Book } from "./types.js";

const today = new Date(2026, 5, 1);
const read = (text: string) => parse(text, undefined, { today });
const one = (line: string, head = "") => {
  const r = read(`${head}${line}\n`);
  return { asset: r.book.assets?.[0], codes: r.diagnostics.map((d) => d.code), result: r };
};
const amounts = (book: Book, id: string, grain: "month" | "year" = "month") =>
  depreciationSchedule(book, id, { grain })!.rows.map((r) => r.depreciation);

describe("reading asset lines", () => {
  it("reads every part, in any order", () => {
    const { asset, codes } = one('asset "Ovens" from Jan 3, 2026 life 5 years salvage 500 cost 12k account equipment method Straight-Line');
    expect(codes).toEqual([]);
    expect(asset).toMatchObject({ id: "ovens", account: "equipment", cost: 1_200_000, salvage: 50_000, life: 60, method: "straight-line", from: "2026-01-03" });
  });

  it("defaults salvage to zero and the method to straight-line, or units when units are given", () => {
    expect(one('asset "A" account Equipment cost 100 life 18 months from 2026-01-01').asset).toMatchObject({ salvage: 0, life: 18, method: "straight-line" });
    expect(one('asset "A" account Equipment cost 100 units 1,000 from 2026-01-01').asset).toMatchObject({ method: "units", units: 1_000, usage: [] });
    expect(one('asset "A" account Equipment cost 100 method units units 10 from 2026-01-01').asset).toMatchObject({ method: "units", units: 10 });
  });

  it("reads a life in years with a fraction when it comes to whole months", () => {
    expect(one('asset "A" account Equipment cost 100 life 2.5 years from 2026-01-01').asset?.life).toBe(30);
    expect(one('asset "A" account Equipment cost 100 life 1 year from 2026-01-01').asset?.life).toBe(12);
    expect(one('asset "A" account Equipment cost 100 life 2.55 years from 2026-01-01').codes).toEqual(["unreadable-line"]);
  });

  it("reads account names with spaces, and quoted names that contain a keyword", () => {
    const head = 'account "Delivery Vans" asset\naccount "Used Cost Machines" asset\n';
    expect(one('asset "V" account Delivery  Vans cost 100 life 1 year from 2026-01-01', head).asset?.account).toBe("delivery-vans");
    expect(one('asset "M" account "Used Cost Machines" cost 100 life 1 year from 2026-01-01', head).asset?.account).toBe("used-cost-machines");
  });

  it("sums units used by month, and puts units without a month in the last month of the period", () => {
    const head = 'book "B" period 2026-01-01..2026-03-31\n';
    const { asset, codes } = one('asset "L" account Equipment cost 100 units 1,000 from 2026-01-01 used 10 in 2026-02 used 5 used 2 in February 2026 used 1 in Jan 2026', head);
    expect(codes).toEqual([]);
    expect(asset?.usage).toEqual([
      { month: "2026-01", units: 1 },
      { month: "2026-02", units: 12 },
      { month: "2026-03", units: 5 },
    ]);
  });

  it("flags what it can't read and leaves the asset out", () => {
    const bad = [
      ['asset "A" account Equipment cost 100 life 5 years', "unreadable-line"],
      ['asset "A" account Equipment cost 100 life 5 years method sum-of-years from 2026-01-01', "unreadable-line"],
      ['asset "A" account Equipment cost 100 salvage 200 life 5 years from 2026-01-01', "invalid-amount"],
      ['asset "A" account Equipment cost -100 life 5 years from 2026-01-01', "invalid-amount"],
      ['asset "A" account Equipment cost 100 life 5 years from 2026-02-30', "invalid-date"],
      ['asset "A" account Equipment cost 100 life 5 years from 2026-01-01 cost 200', "unreadable-line"],
      ['asset "A" account Equipment cost 100 units 10 life 5 years from 2026-01-01', "unreadable-line"],
      ['asset "A" account Equipment cost 100 life 5 years used 3 in Jan 2026 from 2026-01-01', "unreadable-line"],
      ['asset "A" account Equipment cost 100 method units from 2026-01-01', "unreadable-line"],
      ['asset "A" account Equipment cost 100 units 10 from 2026-02-01 used 3 in Jan 2026', "invalid-date"],
      ['asset "A" account Equipment cost 100 units 10 from 2026-01-01 used 3', "invalid-date"],
      ['asset "A" account Equipment cost 100 units 10 from 2026-01-01 used 3 in Smarch 2026', "invalid-date"],
      ['asset "A" account Rent Expense cost 100 life 5 years from 2026-01-01', "unreadable-line"],
      ['asset "A" account Accumulated Depreciation, Equipment cost 100 life 5 years from 2026-01-01', "unreadable-line"],
      ['asset A account Equipment cost 100 life 5 years from 2026-01-01', "unreadable-line"],
      ['asset "A" Equipment cost 100 life 5 years from 2026-01-01', "unreadable-line"],
    ] as const;
    for (const [line, code] of bad) {
      const { asset, codes } = one(line);
      expect(asset, line).toBeUndefined();
      expect(codes, line).toEqual([code]);
    }
  });

  it("keeps an asset whose account isn't in the chart, and flags the account", () => {
    const { asset, result } = one('asset "A" account Spaceships cost 100 life 5 years from 2026-01-01');
    expect(asset?.account).toBe("Spaceships");
    expect(result.diagnostics).toMatchObject([{ code: "unknown-account", target: { account: "Spaceships" } }]);
  });

  it("gives assets with the same name distinct ids", () => {
    const r = read('asset "Oven" account Equipment cost 1 life 1 year from 2026-01-01\nasset "Oven" account Equipment cost 2 life 1 year from 2026-01-01\n');
    expect(r.book.assets?.map((a) => a.id)).toEqual(["oven", "oven-2"]);
  });

  it("ends the entry above it", () => {
    const r = read('Jan 1 x\n  Cash 1\n    Common Stock 1\nasset "A" account Equipment cost 1 life 1 year from 2026-01-01\n');
    expect(r.diagnostics).toEqual([]);
    expect(r.book.entries[0]!.lines).toHaveLength(2);
  });
});

describe("writing asset lines", () => {
  it("spells out every part in a fixed order", () => {
    const r = read(
      [
        'book "B" period 2026-01-01..2026-01-31',
        'account "Used Cost Machines" asset',
        'asset "Ovens" from 2026-01-03 account equipment cost 12000 life 60 months',
        'asset "Van" account Equipment cost 30,000.50 salvage 3k life 30 months method double-declining from 2026-01-01',
        'asset "Line" account "Used Cost Machines" cost 50,000 units 400,000 used 9000 from 2026-01-01',
      ].join("\n"),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.book.assets!.map((a) => formatAsset(a, r.book.chart))).toEqual([
      'asset "Ovens" account Equipment cost 12,000 salvage 0 life 5 years method straight-line from 2026-01-03',
      'asset "Van" account Equipment cost 30,000.50 salvage 3,000 life 30 months method double-declining from 2026-01-01',
      'asset "Line" account "Used Cost Machines" cost 50,000 salvage 0 units 400,000 from 2026-01-01 used 9,000 in Jan 2026',
    ]);
    const text = format(r.book);
    expect(read(text).book.assets).toEqual(r.book.assets!.map((a) => ({ ...a, source: expect.anything() })));
    expect(format(read(text).book)).toBe(text);
  });
});

describe("depreciationSchedule", () => {
  const book = read(
    [
      'asset "Laptops" account Equipment cost 4,800 life 3 years method straight-line from 2026-04-02',
      'asset "Van" account Equipment cost 30,000 salvage 3,000 life 5 years method double-declining from 2026-01-01',
      'asset "Printer" account Equipment cost 1,000 life 3 years method double-declining from 2026-01-01',
      'asset "Press" account Equipment cost 10,000 salvage 4,000 life 5 years method double-declining from 2026-01-01',
      'asset "Line" account Equipment cost 50,000 salvage 2,000 units 400,000 from 2026-01-01 used 9,000 in Jan 2026 used 1,000 in Mar 2026',
      'asset "Drill" account Equipment cost 1,000 units 3 from 2026-01-01 used 1 in Jan 2026 used 1 in Feb 2026 used 1 in Mar 2026 used 5 in Apr 2026',
    ].join("\n"),
  ).book;

  it("spreads straight-line evenly, and the last month takes the rounding remainder", () => {
    const s = depreciationSchedule(book, "laptops")!;
    expect(s.depreciable).toBe(480_000);
    expect(s.rows).toHaveLength(36);
    expect(s.rows[0]).toEqual({ number: 1, start: "2026-04-01", end: "2026-04-30", opening: 480_000, depreciation: 13_333, accumulated: 13_333, closing: 466_667 });
    expect(s.rows[35]).toEqual({ number: 36, start: "2029-03-01", end: "2029-03-31", opening: 13_345, depreciation: 13_345, accumulated: 480_000, closing: 0 });
    expect(amounts(book, "laptops", "year")).toEqual([159_996, 159_996, 160_008]);
  });

  it("starts the month after with schedules.firstMonth set to next-month", () => {
    const settings = setSetting(defaultSettings(), "schedules.firstMonth", "next-month");
    const s = depreciationSchedule(book, "Laptops", { settings })!;
    expect(s.rows[0]!.start).toBe("2026-05-01");
    expect(s.rows[35]!.end).toBe("2029-04-30");
  });

  it("works double-declining balance by year, as in the spec's table", () => {
    const years = depreciationSchedule(book, "van", { grain: "year" })!.rows;
    expect(years.map((r) => [r.opening, r.depreciation, r.accumulated, r.closing])).toEqual([
      [3_000_000, 1_200_000, 1_200_000, 1_800_000],
      [1_800_000, 720_000, 1_920_000, 1_080_000],
      [1_080_000, 432_000, 2_352_000, 648_000],
      [648_000, 259_200, 2_611_200, 388_800],
      [388_800, 88_800, 2_700_000, 300_000],
    ]);
    expect(years[0]).toMatchObject({ start: "2026-01-01", end: "2026-12-31" });
    expect(amounts(book, "van").slice(0, 2)).toEqual([100_000, 100_000]);
  });

  it("rounds each double-declining year to the cent, and the final year takes the rest", () => {
    // 1,000 over three years: 666.67, then two thirds of 333.33, then what is left.
    expect(amounts(book, "printer", "year")).toEqual([66_667, 22_222, 11_111]);
    // 6,666.67 spread over twelve months: 555.55 for eleven, 555.62 in the twelfth.
    const months = amounts(book, "printer");
    expect([months[0], months[11]]).toEqual([5_555, 5_562]);
  });

  it("never takes double-declining balance below salvage", () => {
    expect(amounts(book, "press", "year")).toEqual([400_000, 200_000, 0, 0, 0]);
  });

  it("depreciates units of production by the units used", () => {
    const s = depreciationSchedule(book, "line")!;
    expect(s.rows.map((r) => [r.units, r.depreciation])).toEqual([
      [9_000, 108_000],
      [0, 0],
      [1_000, 12_000],
    ]);
    expect(amounts(book, "drill")).toEqual([33_333, 33_333, 33_334, 0]);
    expect(depreciationSchedule(book, "drill", { grain: "year" })!.rows).toEqual([
      { number: 1, start: "2026-01-01", end: "2026-04-30", opening: 100_000, depreciation: 100_000, accumulated: 100_000, closing: 0, units: 8 },
    ]);
  });

  it("adds up to cost less salvage for every time-based method", () => {
    for (const s of depreciationSchedules(book).filter((s) => s.asset.method !== "units")) {
      expect(s.rows.reduce((t, r) => t + r.depreciation, 0), s.asset.name).toBe(s.depreciable);
      expect(s.rows.every((r) => r.depreciation >= 0 && r.closing >= s.asset.salvage), s.asset.name).toBe(true);
    }
  });

  it("finds the accumulated depreciation account through the chart", () => {
    expect(contraAccount(book, book.assets![0]!)?.id).toBe("accumulated-depreciation-equipment");
    expect(depreciationSchedule(book, "nothing")).toBeUndefined();
  });
});

describe("depreciation-mismatch", () => {
  const head = 'book "B" period 2026-01-01..2026-01-31\nasset "Ovens" account Equipment cost 12,000 life 5 years method straight-line from 2026-01-03\n\n';
  const sale = "Jan 7 Counter sales\n  Cash 500\n    Sales Revenue 500\n\n";
  const depreciation = (amount: string, date = "Jan 31", tags = "[adjusting]") =>
    `${date} Depreciate the ovens ${tags}\n  Depreciation Expense ${amount}\n    Accumulated Depreciation, Equipment ${amount}\n\n`;
  const findings = (text: string, settings = defaultSettings()) => {
    const book = read(text).book;
    return { book, found: diagnose(book, settings).filter((d) => d.code === "depreciation-mismatch") };
  };

  it("is quiet when the entry matches the schedule", () => {
    expect(findings(head + sale + depreciation("200")).found).toEqual([]);
  });

  it("flags an entry that differs, and offers to change it", () => {
    const { book, found } = findings(head + sale + depreciation("250"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      severity: "hint",
      message: "The schedule for Ovens has $200 of depreciation for January 2026, and this entry credits Accumulated Depreciation, Equipment with $250",
      target: { entry: "e2", line: 1, account: "accumulated-depreciation-equipment" },
    });
    const fixed = found[0]!.fixes![0]!.apply(book);
    expect(found[0]!.fixes![0]!.label).toBe("Change the entry to $200");
    expect(fixed.entries[1]!.lines.map((l) => l.amount)).toEqual([20_000, 20_000]);
    expect(diagnose(fixed).filter((d) => d.code === "depreciation-mismatch")).toEqual([]);
  });

  it("flags scheduled depreciation that isn't recorded, and offers to add the entry", () => {
    const { book, found } = findings(head + sale);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toBe("The schedule for Ovens has $200 of depreciation for January 2026, and none of it is recorded");
    expect(found[0]!.target.source).toEqual(book.assets![0]!.source);
    const fixed = found[0]!.fixes![0]!.apply(book);
    expect(fixed.entries.at(-1)).toMatchObject({ date: "2026-01-31", tags: ["adjusting"], lines: [{ account: "depreciation-expense", side: "dr", amount: 20_000 }, { account: "accumulated-depreciation-equipment", side: "cr", amount: 20_000 }] });
    expect(diagnose(fixed).filter((d) => d.code === "depreciation-mismatch")).toEqual([]);
  });

  it("compares a yearly or quarterly entry with the months since the previous one", () => {
    const year = head.replace("2026-01-31", "2026-12-31");
    expect(findings(year + sale + depreciation("2,400", "Dec 31")).found).toEqual([]);
    expect(findings(year + sale + depreciation("600", "Mar 31")).found).toEqual([]);
    const gap = findings(year + depreciation("200", "Jan 31") + depreciation("200", "Mar 31")).found;
    expect(gap.map((d) => d.message)).toEqual([
      "The schedule for Ovens has $400 of depreciation for February to March 2026, and this entry credits Accumulated Depreciation, Equipment with $200",
    ]);
  });

  it("checks only up to the latest entry, and leaves out closing entries and opening balances", () => {
    const year = head.replace("2026-01-31", "2026-12-31");
    expect(findings(year + depreciation("200") + sale.replace("Jan 7", "Jan 8")).found).toEqual([]);
    const closing = findings(head + depreciation("200") + depreciation("50", "Jan 31", "[closing]")).found;
    expect(closing).toEqual([]);
    expect(findings(head + "open Accumulated Depreciation, Equipment 999\nopen Equipment 999\n\n" + depreciation("200")).found).toEqual([]);
  });

  it("adds up the assets that share an accumulated depreciation account", () => {
    const two = head + 'asset "Mixers" account Equipment cost 2,400 life 2 years method straight-line from 2026-01-01\n\n';
    expect(findings(two + depreciation("300")).found).toEqual([]);
    expect(findings(two + depreciation("200")).found[0]!.message).toMatch(/^The schedules for Ovens and Mixers have \$300 /);
  });

  it("follows its severity setting", () => {
    const off = setSetting(defaultSettings(), "diagnostics.depreciation-mismatch", "off");
    expect(findings(head + depreciation("250"), off).found).toEqual([]);
  });
});
