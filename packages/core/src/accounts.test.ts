import { describe, expect, it } from "vitest";
import { editDistance, matchAccount, suggestAccounts } from "./accounts.js";
import { usGaapIntroChart as chart } from "./charts/usGaapIntro.js";
import { defaultSettings, setSetting } from "./settings.js";
import type { Account } from "./types.js";

const id = (name: string, settings = defaultSettings()) => matchAccount(name, chart, settings)?.id;
const with_ = (key: string, value: boolean) => setSetting(defaultSettings(), key, value);

describe("matchAccount", () => {
  it("matches a full name", () => {
    expect(id("Accounts Receivable")).toBe("accounts-receivable");
    expect(id("Accumulated Depreciation, Equipment")).toBe("accumulated-depreciation-equipment");
  });

  it("ignores case, extra spaces and surrounding spaces by default", () => {
    expect(id("accounts receivable")).toBe("accounts-receivable");
    expect(id("  ACCOUNTS   Receivable ")).toBe("accounts-receivable");
    expect(id("Accounts Receivable")).toBe("accounts-receivable");
  });

  it("matches aliases and ids", () => {
    expect(id("A/R")).toBe("accounts-receivable");
    expect(id("ar")).toBe("accounts-receivable");
    expect(id("Deferred Revenue")).toBe("unearned-revenue");
    expect(id("accounts-receivable")).toBe("accounts-receivable");
  });

  it("returns undefined for an unknown or empty name", () => {
    expect(id("Delivery Vans")).toBeUndefined();
    expect(id("   ")).toBeUndefined();
  });

  it("honours accounts.ignoreCase", () => {
    const s = with_("accounts.ignoreCase", false);
    expect(id("accounts receivable", s)).toBeUndefined();
    expect(id("Accounts Receivable", s)).toBe("accounts-receivable");
    expect(id("A/R", s)).toBe("accounts-receivable");
  });

  it("honours accounts.collapseSpaces", () => {
    const s = with_("accounts.collapseSpaces", false);
    expect(id("Accounts  Receivable", s)).toBeUndefined();
    expect(id("Accounts Receivable", s)).toBe("accounts-receivable");
  });

  it("honours accounts.matchAliases", () => {
    const s = with_("accounts.matchAliases", false);
    expect(id("A/R", s)).toBeUndefined();
    expect(id("Accounts Receivable", s)).toBe("accounts-receivable");
  });

  it("honours accounts.matchIds", () => {
    const s = with_("accounts.matchIds", false);
    expect(id("accounts-receivable", s)).toBeUndefined();
  });

  it("prefers a full name over an alias, and an alias over an id", () => {
    const custom: Account[] = [
      { id: "sales", name: "Sales Revenue", type: "revenue", normal: "credit" },
      { id: "other", name: "Sales", type: "revenue", normal: "credit", aliases: ["sales-revenue"] },
      { id: "sales-revenue", name: "Product Sales", type: "revenue", normal: "credit", aliases: ["Sales"] },
    ];
    expect(matchAccount("Sales", custom)?.id).toBe("other");
    expect(matchAccount("sales-revenue", custom)?.id).toBe("other");
  });

  it("works with a chart it has not seen before", () => {
    const custom: Account[] = [{ id: "vans", name: "Delivery Vans", type: "asset", normal: "debit" }];
    expect(matchAccount("delivery vans", custom)?.id).toBe("vans");
    expect(matchAccount("Cash", custom)).toBeUndefined();
  });
});

describe("editDistance", () => {
  it("counts insertions, deletions, substitutions and neighbouring swaps as one edit each", () => {
    expect(editDistance("cash", "cash")).toBe(0);
    expect(editDistance("cash", "cashe")).toBe(1);
    expect(editDistance("cash", "csh")).toBe(1);
    expect(editDistance("cash", "kash")).toBe(1);
    expect(editDistance("receivable", "recievable")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});

describe("suggestAccounts", () => {
  const names = (q: string) => suggestAccounts(q, chart).map((a) => a.name);

  it("puts the closest typo match first", () => {
    expect(names("Acounts Recievable")[0]).toBe("Accounts Receivable");
    expect(names("Rent Expence")[0]).toBe("Rent Expense");
    expect(names("Depreciation Expenses")[0]).toBe("Depreciation Expense");
    expect(names("cahs")[0]).toBe("Cash");
  });

  it("matches aliases as well as names", () => {
    expect(names("A/RR")[0]).toBe("Accounts Receivable");
  });

  it("suggests the longer names that contain what was typed", () => {
    expect(names("Accumulated Depreciation")).toEqual([
      "Accumulated Depreciation, Buildings",
      "Accumulated Depreciation, Equipment",
    ]);
  });

  it("returns at most three, each account once", () => {
    const hits = suggestAccounts("Payable", chart);
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(new Set(hits.map((a) => a.id)).size).toBe(hits.length);
    expect(suggestAccounts("Payable", chart, 5).length).toBe(5);
  });

  it("suggests nothing for a name far from every account", () => {
    expect(names("Delivery Vans")).toEqual([]);
    expect(names("")).toEqual([]);
  });
});
