import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { CDPSession, Locator, Page } from "@playwright/test";
import lz from "lz-string";
import { center } from "./helpers.js";
import type { Point } from "./helpers.js";

/** The trial balance and the statement flow, on /visuals/, in the editor and in the embed player. */

const bakeryText = readFileSync(new URL("../../../examples/sunrise-bakery.entrypad", import.meta.url), "utf8").replace(/\r\n?/g, "\n");
const expected = JSON.parse(readFileSync(new URL("../../../examples/sunrise-bakery.expected.json", import.meta.url), "utf8")) as {
  trialBalance: { debits: string; credits: string; rows: Record<string, { debit?: string; credit?: string }> };
  incomeStatement: Record<string, string>;
  retainedEarnings: Record<string, string>;
  balanceSheet: Record<string, string>;
};

const ACCENT_SOFT = "#e3effb";

async function openVisuals(page: Page, query = ""): Promise<void> {
  await page.goto(`/visuals/${query}`);
  await page.locator("#statement-flow svg").waitFor();
  await page.waitForFunction(() => window.__visuals !== undefined);
}

/** Shows the bakery with cents, as the expected figures are written. */
async function withCents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const b = window.__visuals.book();
    window.__visuals.setBook({ ...b, settings: { ...b.settings, decimals: 2 } });
  });
}

const line = (page: Page, entry: string, index: number) =>
  page.evaluate(([e, i]) => window.__visuals.book().entries.find((x) => x.id === e)?.lines[i], [entry, index] as const);

const figure = (page: Page, account: string) => page.locator(`[data-entrypad-scrub="${account}"]`);

/** Scrolls an element into the middle of the viewport, so pointer input reaches it. */
async function bringIntoView(locator: Locator): Promise<void> {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await locator.page().waitForTimeout(100);
}

/** Presses on a point, moves straight up or down by `dy` and lets go. */
async function scrub(page: Page, from: Point, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + Math.sign(dy) * 4, { steps: 2 });
  await page.mouse.move(from.x, from.y + dy, { steps: 10 });
  await page.mouse.up();
}

test.describe("statement visuals", () => {
  test.use({ viewport: { width: 1280, height: 1100 } });

  test("draw the bakery's books without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await openVisuals(page);
    await expect(page.locator("#trial-balance")).toContainText("Trial Balance");
    await expect(page.locator("#sf-is")).toContainText("Income Statement");
    await expect(page.locator("#sf-re")).toContainText("Statement of Retained Earnings");
    await expect(page.locator("#sf-bs")).toContainText("Balance Sheet");
    await expect(page.locator("#sf-is")).toContainText("For the month ended January 31, 2026");
    await expect(page.locator('[data-entrypad-carry="sf-carry-net-income"]')).toHaveCount(1);
    await expect(page.locator('[data-entrypad-carry="sf-carry-retained-earnings"]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test("the trial balance matches the bakery's expected figures", async ({ page }) => {
    await openVisuals(page);
    await withCents(page);
    const chart = await page.evaluate(() => window.__visuals.book().chart.map((a) => [a.name, a.id] as const));
    const ids = new Map(chart);
    const rows = Object.entries(expected.trialBalance.rows);
    await expect(page.locator('[id^="tb-row-"]')).toHaveCount(rows.length);
    for (const [name, { debit, credit }] of rows) {
      const row = page.locator(`#tb-row-${ids.get(name)}`);
      await expect(row).toContainText(name);
      await expect(row).toContainText((debit ?? credit)!);
    }
    await expect(page.locator("#tb-debits")).toHaveText(expected.trialBalance.debits);
    await expect(page.locator("#tb-credits")).toHaveText(expected.trialBalance.credits);
    await expect(page.locator("#dx-trial-balance")).toHaveCount(0);
  });

  test("the statements match the bakery's expected figures", async ({ page }) => {
    await openVisuals(page);
    await withCents(page);
    const is = expected.incomeStatement;
    await expect(figure(page, "sales-revenue").locator("text")).toHaveText(is.revenue!);
    await expect(page.locator("#sf-is")).toContainText(`Total operating expenses${is.operatingExpenses}`);
    await expect(page.locator("#sf-is")).toContainText(`Operating income${is.operatingIncome}`);
    await expect(page.locator("#sf-is")).toContainText(`Net income${is.netIncome}`);
    const re = expected.retainedEarnings;
    await expect(page.locator("#sf-re")).toContainText(`Retained earnings, beginning${re.beginning}`);
    await expect(page.locator("#sf-re")).toContainText(`Add: Net income${re.netIncome}`);
    await expect(page.locator("#sf-re")).toContainText(`Retained earnings, ending${re.ending}`);
    const bs = expected.balanceSheet;
    const sheet = page.locator("#sf-bs");
    await expect(sheet).toContainText(`Total current assets${bs.currentAssets}`);
    await expect(sheet).toContainText(`Total property, plant, and equipment${bs.propertyPlantEquipment}`);
    await expect(sheet).toContainText(`Total assets${bs.totalAssets}`);
    await expect(sheet).toContainText(`Total current liabilities${bs.currentLiabilities}`);
    await expect(sheet).toContainText(`Common Stock${bs.contributedCapital}`);
    await expect(sheet).toContainText(`Retained earnings${bs.retainedEarnings}`);
    await expect(sheet).toContainText(`Total stockholders’ equity${bs.totalEquity}`);
    await expect(sheet).toContainText(`Total liabilities and stockholders’ equity${bs.totalLiabilitiesAndEquity}`);
    await expect(page.locator("#dx-balance-sheet")).toHaveCount(0);
  });

  test("hovering an entry lights up the rows it posts to", async ({ page }) => {
    await openVisuals(page);
    // Jan 2 rent: Rent Expense and Cash.
    await page.locator("#cl-e2-0").hover();
    await expect(page.locator("#tb-row-rent-expense")).toHaveAttribute("data-entrypad-lit", "");
    await expect(page.locator("#tb-row-cash")).toHaveAttribute("data-entrypad-lit", "");
    await expect(page.locator("#tb-row-supplies")).not.toHaveAttribute("data-entrypad-lit");
    await expect(figure(page, "rent-expense").locator("rect")).toHaveAttribute("fill", ACCENT_SOFT);
    await expect(figure(page, "wages-expense").locator("rect")).toHaveAttribute("fill", "transparent");
    await page.mouse.move(5, 5);
    await expect(page.locator("#tb-row-rent-expense")).not.toHaveAttribute("data-entrypad-lit");
  });

  test("hovering a statement figure lights up the entry a scrub would change", async ({ page }) => {
    await openVisuals(page);
    const sales = figure(page, "sales-revenue");
    await bringIntoView(sales);
    // The most recent sales posting: Jan 28, counter sales, Cash and Sales Revenue.
    await expect(sales).toHaveAttribute("data-entrypad-entry", "e14");
    await sales.hover();
    await expect(page.locator("#tb-row-cash")).toHaveAttribute("data-entrypad-lit", "");
    await expect(page.locator("#tb-row-sales-revenue")).toHaveAttribute("data-entrypad-lit", "");
  });

  test("dragging a revenue figure up raises its most recent posting, and the cash with it", async ({ page }) => {
    await openVisuals(page);
    const sales = figure(page, "sales-revenue");
    await bringIntoView(sales);
    const from = await center(sales);
    await scrub(page, from, -30);
    // 17,187: one step is $100, the largest power of ten within 1%.
    await expect.poll(() => line(page, "e14", 1).then((l) => l?.amount)).toBeGreaterThan(439_914);
    const credit = (await line(page, "e14", 1))!;
    const debit = (await line(page, "e14", 0))!;
    expect(credit.account).toBe("sales-revenue");
    expect((credit.amount - 439_914) % 10_000).toBe(0);
    expect(debit.account).toBe("cash");
    expect(debit.amount).toBe(credit.amount);
    // Earlier sales are left alone.
    expect((await line(page, "e11", 1))!.amount).toBe(389_628);
    // Net income, retained earnings and equity follow.
    const netIncome = 628_666 + credit.amount - 439_914;
    const shown = Math.round(netIncome / 100).toLocaleString("en-US");
    await expect(page.locator("#sf-is")).toContainText(`Net income${shown}`);
    await expect(page.locator("#sf-re")).toContainText(`Retained earnings, ending${shown}`);
    await expect(page.locator("#sf-bs")).toContainText(`Retained earnings${shown}`);
    await expect(page.locator("#dx-balance-sheet")).toHaveCount(0);
  });

  test("dragging an expense figure down lowers it", async ({ page }) => {
    await openVisuals(page);
    const rent = figure(page, "rent-expense");
    await bringIntoView(rent);
    await scrub(page, await center(rent), 40);
    await expect.poll(() => line(page, "e2", 0).then((l) => l?.amount)).toBeLessThan(180_000);
    expect((await line(page, "e2", 0))!.amount).toBeGreaterThanOrEqual(100);
    expect((await line(page, "e2", 1))!.amount).toBe((await line(page, "e2", 0))!.amount);
  });

  test("the arrow keys change a focused figure, ten steps with Shift, and keep the focus", async ({ page }) => {
    await openVisuals(page);
    await figure(page, "rent-expense").focus();
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => line(page, "e2", 0).then((l) => l?.amount)).toBe(181_000);
    expect((await line(page, "e2", 1))!.amount).toBe(181_000);
    // No need to focus it again.
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => line(page, "e2", 0).then((l) => l?.amount)).toBe(182_000);
    await page.keyboard.press("Shift+ArrowDown");
    await expect.poll(() => line(page, "e2", 0).then((l) => l?.amount)).toBe(172_000);
    await expect(figure(page, "rent-expense").locator("text")).toHaveText("1,720");
    // Net income 6,287 before, plus the 80 of rent saved.
    await expect(page.locator("#sf-re")).toContainText("Retained earnings, ending6,367");
    await expect(page.locator("#tb-row-rent-expense")).toContainText("1,720");
  });

  test("steps through the month one entry at a time", async ({ page }) => {
    await openVisuals(page, "?at=2");
    await expect(page.locator('[id^="tb-row-"]')).toHaveCount(3);
    await expect(page.locator("#tb-row-cash")).toContainText("23,200");
    await expect(page.locator("#sf-is")).toContainText("For the period January 1 to January 2, 2026");
    await expect(page.locator("#sf-bs")).toContainText("January 2, 2026");
    await expect(page.locator("#sf-is")).toContainText("Net loss(1,800)");
    await expect(page.locator("#sf-re")).toContainText("Less: Net loss1,800");
    await page.locator("#next").click();
    await expect(page.locator("#position")).toHaveText("After 3 of 20");
    await expect(page.locator("#tb-row-equipment")).toContainText("12,000");
    await expect(page.locator("#sf-bs")).toContainText("Notes Payable6,000");
  });

  test("squiggles a balance sheet and a trial balance that don't balance", async ({ page }) => {
    await openVisuals(page);
    await page.evaluate(() => {
      const b = window.__visuals.book();
      window.__visuals.setBook({
        ...b,
        entries: b.entries.map((e) => (e.id === "e1" ? { ...e, lines: e.lines.map((l, i) => (i === 1 ? { ...l, amount: 2_000_000 } : l)) } : e)),
      });
    });
    await expect(page.locator("#dx-trial-balance")).toHaveCount(1);
    await expect(page.locator("#dx-balance-sheet")).toHaveCount(1);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

    test("both fit the screen's width, with the statements stacked", async ({ page }) => {
      await openVisuals(page);
      for (const id of ["#trial-balance", "#statement-flow"]) {
        const box = (await page.locator(`${id} svg`).first().boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(391);
      }
      const is = (await page.locator("#sf-is").boundingBox())!;
      const re = (await page.locator("#sf-re").boundingBox())!;
      const bs = (await page.locator("#sf-bs").boundingBox())!;
      expect(re.y).toBeGreaterThan(is.y + is.height);
      expect(bs.y).toBeGreaterThan(re.y + re.height);
    });

    test("a finger drag up a revenue figure raises it", async ({ page }) => {
      await openVisuals(page);
      const sales = figure(page, "sales-revenue");
      await bringIntoView(sales);
      const finger = await Finger.on(page);
      const from = await center(sales);
      await finger.down(from);
      await finger.glide(from, { x: from.x, y: from.y - 30 }, 10);
      expect(await page.evaluate(() => window.__visuals.status())).toBe("dragging");
      await finger.up();
      await expect.poll(() => line(page, "e14", 1).then((l) => l?.amount)).toBeGreaterThan(439_914);
      expect((await line(page, "e14", 0))!.amount).toBe((await line(page, "e14", 1))!.amount);
    });
  });
});

test.describe("statement visuals in the editor", () => {
  test.use({ viewport: { width: 1440, height: 1100 } });

  async function openEditor(page: Page, query = ""): Promise<void> {
    await page.goto(`/editor/${query}`);
    await page.locator("#statement-flow svg").waitFor();
    await page.waitForFunction(() => window.__editor !== undefined);
  }
  const text = (page: Page) => page.evaluate(() => window.__editor.text());

  test("sit below the other visuals, each with an export menu", async ({ page }) => {
    await openEditor(page);
    const cards = (await page.locator("#cards").boundingBox())!;
    const tb = (await page.locator("#trial-balance").boundingBox())!;
    const flow = (await page.locator("#statement-flow").boundingBox())!;
    expect(tb.y).toBeGreaterThan(cards.y);
    expect(flow.y).toBeGreaterThan(tb.y);
    await expect(page.locator("#trial-balance .export summary")).toHaveText("Export");
    await expect(page.locator("#statement-flow .export summary")).toHaveText("Export");
    await expect(page.locator("#tb-row-cash")).toContainText("24,747");
  });

  test("an arrow key on a figure rewrites its entry in the text", async ({ page }) => {
    await openEditor(page);
    const before = await text(page);
    await figure(page, "rent-expense").focus();
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => text(page)).not.toBe(before);
    const after = await text(page);
    expect(after).toMatch(/Jan 2 [^\n]*\n?[^\n]*Rent Expense[^\n]*1,810/);
    expect(after).not.toContain("Rent Expense 1,800");
    // Only that entry changed.
    const rent = /Jan 2 {2}Pay January rent[^\n]*\n(?:[ \t]+[^\n]*\n)*/;
    expect(after.replace(rent, "")).toBe(before.replace(rent, ""));
  });

  test("dragging a figure rewrites its entry in the text", async ({ page }) => {
    await openEditor(page);
    const sales = figure(page, "sales-revenue");
    await bringIntoView(sales);
    const before = await text(page);
    await scrub(page, await center(sales), -20);
    await expect.poll(() => text(page)).not.toBe(before);
    const fourthWeek = await page.evaluate(() => window.__editor.book().entries.find((e) => e.memo === "Counter sales, fourth week")!.lines);
    expect(fourthWeek[1]!.amount).toBeGreaterThan(439_914);
    expect(fourthWeek[0]!.amount).toBe(fourthWeek[1]!.amount);
    // The text carries the new figure, and the other weeks' sales are as written.
    expect(await text(page)).toContain((fourthWeek[1]!.amount / 100).toLocaleString("en-US", { minimumFractionDigits: 2 }));
    expect(await text(page)).toContain("3,896.28");
  });

  test("show lines pick the trial balance's rows", async ({ page }) => {
    await openEditor(page, "?example=blank");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("Jan 1 x: Cash 100 / Common Stock 100\n\nshow trial-balance: Common Stock\n");
    await expect(page.locator("#tb-row-common-stock")).toBeVisible();
    await expect(page.locator("#tb-row-cash")).toHaveCount(0);
  });
});

test.describe("statement visuals in the embed player", () => {
  test.use({ viewport: { width: 1440, height: 1100 } });
  const link = (visual: string) => `/embed/?visual=${visual}#v1:${lz.compressToEncodedURIComponent(bakeryText)}`;

  test("shows the statement flow without squiggles and steps through", async ({ page }) => {
    await page.goto(link("statement-flow"));
    await page.waitForFunction(() => window.__embed !== undefined);
    await expect(page.locator("#sf-bs")).toContainText("Balance Sheet");
    await expect(page.locator('[id^="dx-"]')).toHaveCount(0);
    await page.keyboard.press("Home");
    await expect(page.locator("#position")).toHaveText("0 of 20");
    await page.locator("#next").click();
    await expect(page.locator("#sf-bs")).toContainText("Common Stock25,000");
  });

  test("shows the trial balance", async ({ page }) => {
    await page.goto(link("trial-balance"));
    await page.waitForFunction(() => window.__embed !== undefined);
    await expect(page.locator("#tb-debits")).toHaveText("49,678");
  });
});

/** A finger on the touchscreen, through Chromium's DevTools protocol (as in touch.spec.ts). */
class Finger {
  constructor(private cdp: CDPSession) {}

  static async on(page: Page) {
    return new Finger(await page.context().newCDPSession(page));
  }

  async down(p: Point) {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [tp(p)] });
  }

  async glide(from: Point, to: Point, steps = 12) {
    for (let i = 1; i <= steps; i++) {
      const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
      await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [tp(p)] });
    }
  }

  async up() {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
}

const tp = (p: Point) => ({ x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 });
