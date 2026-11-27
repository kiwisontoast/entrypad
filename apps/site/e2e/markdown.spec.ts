import { expect, test } from "@playwright/test";
import { center, mouseDrag } from "./helpers.js";

test.describe("entrypad blocks in Markdown", () => {
  test("read as finished visuals without any script", async ({ page }) => {
    await page.goto("/markdown/?static");
    await page.waitForFunction(() => window.__markdown !== undefined);
    const figure = page.locator("figure.entrypad");
    await expect(figure).toHaveCount(1);
    await expect(figure.locator(".entrypad-visual")).toHaveCount(2);
    await expect(figure.locator("[data-visual='t-accounts']")).toContainText("Notes Payable");
    // Cash 25,000 less 6,000.
    await expect(figure.locator("[data-visual='t-accounts']")).toContainText("19,000");
    await expect(figure.locator("[data-visual='equation']")).toContainText("Assets = Liabilities + Equity");
    // Nothing to drag yet, and ordinary code blocks are left alone.
    await expect(figure.locator("[data-entrypad-drag]")).toHaveCount(0);
    await expect(page.locator("pre code.language-text")).toHaveText("An ordinary code block stays as it is.\n");
  });

  test("come alive with the client script, and drags work", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/markdown/");
    await page.waitForFunction(() => window.__markdown !== undefined);
    expect(await page.evaluate(() => window.__markdown.live)).toBe(1);
    const posting = page.locator("#p-e2-0");
    await expect(posting).toHaveAttribute("data-entrypad-drag", "");
    // Move the equipment debit onto Common Stock: Equipment empties, and
    // Common Stock's 25,000 credit balance falls to 13,000.
    await mouseDrag(page, await center(posting), await center(page.locator("#t-common-stock")));
    await expect(page.locator("#t-equipment")).not.toContainText("12,000");
    await expect(page.locator("#t-common-stock")).toContainText("13,000");
    expect(errors).toEqual([]);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

    test("fit the column, static or live", async ({ page }) => {
      for (const url of ["/markdown/?static", "/markdown/"]) {
        await page.goto(url);
        await page.waitForFunction(() => window.__markdown !== undefined);
        for (const svg of await page.locator("figure.entrypad svg").all()) {
          const box = (await svg.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, url).toBeLessThanOrEqual(391);
        }
      }
    });
  });
});
