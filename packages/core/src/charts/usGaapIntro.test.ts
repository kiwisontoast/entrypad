import { describe, expect, it } from "vitest";
import { usGaapIntroChart } from "./usGaapIntro.js";

describe("usGaapIntroChart", () => {
  const ids = usGaapIntroChart.map((a) => a.id);

  it("has about 40 accounts with unique ids", () => {
    expect(ids.length).toBe(40);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses ids that are safe as element ids", () => {
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("points every contra account at an account in the chart", () => {
    for (const a of usGaapIntroChart.filter((a) => a.contraOf)) {
      expect(ids).toContain(a.contraOf);
      const base = usGaapIntroChart.find((b) => b.id === a.contraOf);
      expect(a.normal).not.toBe(base?.normal);
    }
  });

  it("gives every type its usual normal balance, apart from contras and dividends", () => {
    const debitTypes = new Set(["asset", "expense"]);
    for (const a of usGaapIntroChart) {
      if (a.contraOf || a.id === "dividends") continue;
      expect(a.normal).toBe(debitTypes.has(a.type) ? "debit" : "credit");
    }
  });
});
