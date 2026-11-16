import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { center, mouseDrag, waitForSettled } from "./helpers.js";

/**
 * The Phase 1 gate: type about ten entries into the editor, check the
 * T-accounts and the equation, drag in a visual, and check the text follows.
 */

const text = (page: Page) => page.evaluate(() => window.__editor.text());

/** Types lines one key at a time, as a person would, letting Enter indent. */
async function typeLines(page: Page, lines: string[]): Promise<void> {
  for (const line of lines) {
    // Clear whatever indentation Enter left, then type the line as written.
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Delete");
    await page.keyboard.type(line);
    await page.keyboard.press("Enter");
  }
}

test.describe("Phase 1 gate", () => {
  test.use({ viewport: { width: 1440, height: 1100 } });

  test("ten typed entries drive the visuals, and a drag edits the text", async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/editor/?example=blank");
    await page.locator(".cm-content").waitFor();
    await page.waitForFunction(() => window.__editor !== undefined);
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");

    await typeLines(page, [
      "Jan 1 Owner invests: Cash 20,000 / Common Stock 20,000",
      "",
      "Jan 2 Pay rent: Rent Expense 1,500 / Cash 1,500",
      "",
      "Jan 3 Buy an oven, part on a note [investing]",
      "  Equipment 9,000",
      "      Cash 4,000",
      "      Notes Payable 5,000",
      "",
      "Jan 5 Supplies on account: Supplies 800 / Accounts Payable 800",
      "",
      "Jan 7 Cash sales: Cash 2,600 / Sales Revenue 2,600",
      "",
      "Jan 10 Bill a catering client",
      "  A/R 1,200",
      "      Sales Revenue",
      "",
      "Jan 15 Pay wages: Wages Expense 1,900 / Cash 1,900",
      "",
      "Jan 20 Pay the supplier: Accounts Payable 500 / Cash 500",
      "",
      "Jan 25 Collect from the catering client: Cash 1,200 / Accounts Receivable 1,200",
      "",
      "Jan 31 Supplies used [adjusting]",
      "  Supplies Expense 350",
      "      Supplies 350",
    ]);

    // Ten entries, no problems (the filled-in catering amount is only a hint).
    await expect.poll(() => page.evaluate(() => window.__editor.book().entries.length)).toBe(10);
    await expect(page.locator("#status")).toHaveText("No problems");
    await expect(page.locator(".cm-lintRange-hint")).toHaveCount(1);

    // Cash: 20,000 - 1,500 - 4,000 + 2,600 - 1,900 - 500 + 1,200.
    await expect(page.locator("#t-cash")).toContainText("15,900");
    await expect(page.locator("#t-supplies")).toContainText("450");
    await expect(page.locator("#t-notes-payable")).toContainText("5,000");
    // Assets 25,350 = liabilities 5,300 + equity 20,050 (net income 50).
    await expect(page.locator("#eq-assets")).toContainText("25,350");
    await expect(page.locator("#equation")).toContainText("5,300 + 20,050");

    // Drag the rent card's Cash credit into the debit column: the text follows,
    // and the now unbalanced entry is flagged.
    const cashLine = page.locator("#cl-e2-1");
    await cashLine.scrollIntoViewIfNeeded();
    await waitForSettled(cashLine);
    let at = await center(cashLine);
    await mouseDrag(page, { x: at.x + 100, y: at.y }, { x: at.x - 60, y: at.y });
    await expect.poll(() => text(page)).toMatch(/Jan 2 +Pay rent\n {2}Rent Expense +1,500\n {2}Cash +1,500\n/);
    await expect(page.locator("#status")).toHaveText("1 error, 0 warnings");
    await expect(page.locator(".cm-lintRange-error")).toHaveCount(1);

    // Drag it back to the credit column: balanced again.
    await waitForSettled(cashLine);
    at = await center(cashLine);
    await mouseDrag(page, { x: at.x - 60, y: at.y }, { x: at.x + 160, y: at.y });
    await expect.poll(() => text(page)).toMatch(/Jan 2 +Pay rent\n {2}Rent Expense +1,500\n {6}Cash +1,500\n/);
    await expect(page.locator("#status")).toHaveText("No problems");

    // Reclassify the rent in the T-accounts: the entry's text follows.
    const rent = page.locator("#p-e2-0");
    await rent.scrollIntoViewIfNeeded();
    await mouseDrag(page, await center(rent), await center(page.locator("#t-supplies-expense")));
    await expect.poll(() => text(page)).toMatch(/Jan 2 +Pay rent\n {2}Supplies Expense +1,500\n/);
    await expect(page.locator("#t-supplies-expense")).toContainText("1,850");

    // Everything else is still exactly as typed.
    const typed = await text(page);
    expect(typed).toContain("Jan 3 Buy an oven, part on a note [investing]\n  Equipment 9,000\n      Cash 4,000\n      Notes Payable 5,000\n");
    expect(typed).toContain("Jan 1 Owner invests: Cash 20,000 / Common Stock 20,000\n");
    expect(errors).toEqual([]);
  });
});
