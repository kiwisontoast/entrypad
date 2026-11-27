import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { center, mouseDrag } from "./helpers.js";

async function openEditor(page: Page, query = ""): Promise<void> {
  await page.goto(`/editor/${query}`);
  await page.locator(".cm-content").waitFor();
  await page.waitForFunction(() => window.__editor !== undefined);
}

const text = (page: Page) => page.evaluate(() => window.__editor.text());

/** Puts the cursor at the end of the text and inserts more. */
async function append(page: Page, more: string): Promise<void> {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(more);
}

test.describe("editor", () => {
  test.use({ viewport: { width: 1440, height: 1100 } });

  test("opens the bakery sample with its visuals and no problems", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openEditor(page);
    await expect(page.locator("h1")).toHaveText("Sunrise Bakery");
    await expect(page.locator("#status")).toHaveText("No problems");
    await expect(page.locator("#t-cash")).toBeVisible();
    // Only hints: the catering bill's blank amount, and the cash entries
    // without a cash flow tag, whose section is inferred. Each is underlined.
    const hints = await page.evaluate(() => window.__editor.analysis().findings.map((f) => `${f.severity} ${f.code}`));
    expect(hints.filter((h) => h === "hint inferred-amount")).toHaveLength(1);
    expect(hints.every((h) => h === "hint inferred-amount" || h === "hint inferred-cash-section")).toBe(true);
    await expect(page.locator(".cm-lintRange-hint")).toHaveCount(hints.length);
    expect(errors).toEqual([]);
  });

  test("typing an entry updates the visuals", async ({ page }) => {
    await openEditor(page, "?example=blank");
    await append(page, "Jan 1 Owner invests\n  Cash 10,000\n      Common Stock 10,000\n");
    await expect(page.locator("#t-cash")).toContainText("10,000");
    await expect(page.locator("#card-e1")).toHaveCount(1);
    await expect(page.locator("#equation")).toContainText("10,000");
  });

  test("Enter indents the way the shorthand expects", async ({ page }) => {
    await openEditor(page, "?example=blank");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("Jan 1 Owner invests");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Cash 100");
    await page.keyboard.press("Enter");
    expect(await text(page)).toContain("Jan 1 Owner invests\n  Cash 100\n  ");
  });

  test("squiggles a mistake and fixes it from the tooltip", async ({ page }) => {
    await openEditor(page, "?example=blank");
    await append(page, "Jan 1 Owner invests\n  Cash 10,000\n      Comon Stock 10,000\n");
    const squiggle = page.locator(".cm-lintRange-error");
    await expect(squiggle).toHaveCount(1);
    await expect(page.locator("#status")).toHaveText("1 error, 0 warnings");
    await squiggle.hover();
    await page.locator(".cm-diagnosticAction", { hasText: "Change to Common Stock" }).click();
    await expect.poll(() => text(page)).toContain("Common Stock");
    await expect(page.locator(".cm-lintRange-error")).toHaveCount(0);
    await expect(page.locator("#status")).toHaveText("No problems");
  });

  test("a drag rewrites only the entry it changed", async ({ page }) => {
    await openEditor(page);
    const before = await text(page);
    // The book's show line draws Cash, Supplies, Equipment, Accounts Payable and
    // Sales Revenue. Move the Jan 4 supplies purchase from Supplies to Equipment.
    await mouseDrag(page, await center(page.locator("#p-e4-0")), await center(page.locator("#t-equipment")));
    await expect.poll(() => text(page)).not.toBe(before);
    const after = await text(page);
    // The header is kept exactly as written; only the postings are rewritten.
    expect(after).toContain("Jan 4  Flour, sugar and boxes on account\n  Equipment ");
    const entry = /Jan 4 {2}Flour[^\n]*\n(?:[ \t]+[^\n]*\n)*/;
    expect(after.replace(entry, "")).toBe(before.replace(entry, ""));
  });

  test("flipping a card line rewrites the text", async ({ page }) => {
    await openEditor(page);
    await page.locator("#cl-e1-0").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => text(page)).toContain("Jan 1  Owner invests cash   [financing]\n  cr Cash");
  });

  test("loads another example", async ({ page }) => {
    await openEditor(page);
    await page.locator("#example").selectOption("bikes");
    await expect(page.locator("h1")).toHaveText("Spoke & Chain Bikes");
    await expect(page.locator("#t-inventory")).toBeVisible();
  });

  test("show lines pick the T-accounts", async ({ page }) => {
    await openEditor(page, "?example=blank");
    await append(page, "Jan 1 x: Cash 100 / Common Stock 100\n\nshow t-accounts: Common Stock\n");
    await expect(page.locator("#t-common-stock")).toBeVisible();
    await expect(page.locator("#t-cash")).toHaveCount(0);
  });

  test("steps through the entries", async ({ page }) => {
    await openEditor(page);
    for (let i = 0; i < 19; i++) await page.locator("#prev").click();
    await expect(page.locator("#position")).toHaveText("After 1 of 20");
    await expect(page.locator('[id^="card-e"]')).toHaveCount(1);
  });
});
