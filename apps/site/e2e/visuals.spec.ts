import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { center, mouseDrag, waitForSettled } from "./helpers.js";

async function openVisuals(page: Page, query = ""): Promise<void> {
  await page.goto(`/visuals/${query}`);
  await page.locator("#t-accounts svg").waitFor();
  await page.waitForFunction(() => window.__visuals !== undefined);
}

const line = (page: Page, entry: string, index: number) =>
  page.evaluate(([e, i]) => window.__visuals.book().entries.find((x) => x.id === e)?.lines[i], [entry, index] as const);

test.describe("Phase 1 visuals", () => {
  test.use({ viewport: { width: 1280, height: 2200 } });

  test("draw the bakery's books without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await openVisuals(page);
    // examples/sunrise-bakery.expected.json: Cash 24,747.41, shown in whole dollars.
    await expect(page.locator("#t-cash")).toContainText("24,747");
    await expect(page.locator('[id^="card-e"]')).toHaveCount(20);
    await expect(page.locator("#equation")).toContainText("Assets = Liabilities + Equity");
    expect(errors).toEqual([]);
  });

  test("dragging a T-account amount onto another account reclassifies it", async ({ page }) => {
    await openVisuals(page);
    // Jan 2 rent, debited to Rent Expense.
    const posting = page.locator("#p-e2-0");
    await mouseDrag(page, await center(posting), await center(page.locator("#t-prepaid-insurance")));
    await expect.poll(() => line(page, "e2", 0).then((l) => l?.account)).toBe("prepaid-insurance");
    // 1,320 before, plus the 1,800 of rent.
    await expect(page.locator("#t-prepaid-insurance")).toContainText("3,120");
  });

  test("clicking an amount and then an account reclassifies it too", async ({ page }) => {
    await openVisuals(page);
    await page.locator("#p-e2-0").click();
    await expect(page.locator("#p-e2-0")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#t-supplies").click();
    await expect.poll(() => line(page, "e2", 0).then((l) => l?.account)).toBe("supplies");
  });

  test("so does the keyboard: Enter on an amount, then Enter on an account", async ({ page }) => {
    await openVisuals(page);
    await page.locator("#p-e2-0").focus();
    await page.keyboard.press("Enter");
    await page.locator("#t-supplies").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => line(page, "e2", 0).then((l) => l?.account)).toBe("supplies");
  });

  test("Escape puts a picked-up amount back", async ({ page }) => {
    await openVisuals(page);
    await page.locator("#p-e2-0").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#p-e2-0")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#p-e2-0")).not.toHaveAttribute("aria-pressed");
  });

  test("dragging a T-account amount up raises it, and the other side of the entry with it", async ({ page }) => {
    await openVisuals(page);
    // Jan 2 rent, 1,800: one step is $10 (the largest power of ten within 1%).
    const from = await center(page.locator("#p-e2-0"));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y - 4, { steps: 2 });
    await page.mouse.move(from.x, from.y - 34, { steps: 10 });
    // Mid-drag the amount stays where it is and shows the new value.
    const mid = await center(page.locator("#p-e2-0"));
    expect(Math.abs(mid.y - from.y)).toBeLessThan(2);
    await page.mouse.up();
    await expect.poll(() => line(page, "e2", 0).then((l) => l?.amount)).toBeGreaterThan(180_000);
    const debit = (await line(page, "e2", 0))!;
    const credit = (await line(page, "e2", 1))!;
    expect(debit.account).toBe("rent-expense");
    expect(debit.amount % 1_000).toBe(0);
    expect(credit.amount).toBe(debit.amount);
    await expect(page.locator("#p-e2-0")).toContainText((debit.amount / 100).toLocaleString("en-US"));
  });

  test("dragging an amount down lowers it", async ({ page }) => {
    await openVisuals(page);
    const from = await center(page.locator("#p-e2-0"));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + 4, { steps: 2 });
    // Still inside Rent Expense's T, so the amount changes instead of moving.
    await page.mouse.move(from.x + 1, from.y + 50, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => line(page, "e2", 0).then((l) => l?.amount)).toBeLessThan(180_000);
    expect((await line(page, "e2", 0))!.amount).toBeGreaterThanOrEqual(1_000);
  });

  test("the arrow keys change a focused amount, ten steps with Shift", async ({ page }) => {
    await openVisuals(page);
    await page.locator("#p-e2-0").focus();
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => line(page, "e2", 0).then((l) => l?.amount)).toBe(181_000);
    expect((await line(page, "e2", 1))!.amount).toBe(181_000);
    await page.locator("#p-e2-0").focus();
    await page.keyboard.press("Shift+ArrowDown");
    await expect.poll(() => line(page, "e2", 0).then((l) => l?.amount)).toBe(171_000);
    await expect(page.locator("#t-rent-expense")).toContainText("1,710");
  });

  test("picking up an amount renders only a few states, whatever the number of accounts", async ({ page }) => {
    // Drop targets render their preview only when the pointer reaches them,
    // so the first frame of a drag doesn't draw all 30 T-accounts 30 times.
    await openVisuals(page, "?accounts=30");
    const from = await center(page.locator("#p-e2-0"));
    await page.mouse.move(from.x, from.y);
    await page.evaluate(() => (window.__visuals.renders = 0));
    await page.mouse.down();
    await page.mouse.move(from.x + 6, from.y + 6, { steps: 2 });
    await expect.poll(() => page.evaluate(() => window.__visuals.status())).toBe("dragging");
    expect(await page.evaluate(() => window.__visuals.renders)).toBeLessThan(8);
    await page.mouse.up();
  });

  test("dragging a card line to the other column flips its side", async ({ page }) => {
    await openVisuals(page);
    // Jan 1: Common Stock, credited. Drag it left into the debit column.
    const credit = page.locator("#cl-e1-1");
    await waitForSettled(credit);
    const from = await center(credit);
    await mouseDrag(page, { x: from.x + 100, y: from.y }, { x: from.x - 60, y: from.y });
    await expect.poll(() => line(page, "e1", 1).then((l) => l?.side)).toBe("dr");
  });

  test("Enter on a card line flips its side", async ({ page }) => {
    await openVisuals(page);
    await page.locator("#cl-e1-0").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => line(page, "e1", 0).then((l) => l?.side)).toBe("cr");
  });

  test("hovering a line lights up its entry in every visual", async ({ page }) => {
    await openVisuals(page);
    // Jan 3: ovens for 12,000, half cash, half note.
    await page.locator("#cl-e3-0").hover();
    await expect(page.locator("#p-e3-0 rect")).toHaveAttribute("fill", "#e3effb");
    // The Notes Payable credit; the Cash one is folded into "earlier".
    await expect(page.locator("#p-e3-2 rect")).toHaveAttribute("fill", "#e3effb");
    await expect(page.locator("#eq-assets")).toContainText("+6,000");
    await expect(page.locator("#equation")).toContainText("L +6,000");
    await page.mouse.move(5, 5);
    await expect(page.locator("#p-e3-0 rect")).toHaveAttribute("fill", "transparent");
  });

  test("steps through the month one entry at a time", async ({ page }) => {
    await openVisuals(page, "?at=1");
    await expect(page.locator('[id^="card-e"]')).toHaveCount(1);
    await expect(page.locator("#t-cash")).toContainText("25,000");
    await page.locator("#next").click();
    await expect(page.locator('[id^="card-e"]')).toHaveCount(2);
    await expect(page.locator("#t-cash")).toContainText("23,200");
    await expect(page.locator("#position")).toHaveText("After 2 of 20");
  });

  test("squiggles an equation that doesn't balance", async ({ page }) => {
    await openVisuals(page);
    await expect(page.locator("#dx-equation")).toHaveCount(0);
    await page.evaluate(() => {
      const b = window.__visuals.book();
      window.__visuals.setBook({
        ...b,
        entries: b.entries.map((e) => (e.id === "e1" ? { ...e, lines: e.lines.map((l, i) => (i === 1 ? { ...l, amount: 2_000_000 } : l)) } : e)),
      });
    });
    await expect(page.locator("#dx-equation")).toHaveCount(1);
    // Squiggles are lifted out of their wrapper group, so look for them anywhere in the cards.
    await expect(page.locator('#cards [data-code="unbalanced-entry"]')).toHaveCount(1);
  });
});
