import { expect, test } from "@playwright/test";
import { center, grabPoint, mouseDrag } from "./helpers.js";

// The new landing page, previewed at /home/ until launch. Several demos share
// account ids, so every locator is scoped to its section.

test.describe("landing page preview", () => {
  test.use({ viewport: { width: 1280, height: 1000 } });

  test("loads without errors, with every section in place", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto("/home/");
    await expect(page.locator("h1")).toHaveText("What if accounting visuals moved the way the books do?");
    await expect(page.locator("#hero-demo svg")).toBeVisible();
    await expect(page.locator("#step-text")).toContainText("Owner invests cash");
    await expect(page.locator("#gallery .card")).toHaveCount(3);
    await expect(page.locator("#dev-example")).toContainText('import { parse, TAccount } from "entrypad";');
    expect(errors).toEqual([]);
  });

  test("the hero posts a card dropped on an account, and starts over", async ({ page }) => {
    await page.goto("/home/");
    const hero = page.locator("#hero-demo");
    await hero.locator("svg").waitFor();
    await mouseDrag(page, await grabPoint(hero.locator("#card-rent")), await center(hero.locator("#t-rent-expense")));
    await expect(hero.locator("#t-rent-expense")).toContainText("1,200");
    await expect(hero.locator("#t-cash")).toContainText("8,800");
    await page.locator("#hero-reset").click();
    await expect(hero.locator("#t-cash")).toContainText("10,000");
    await expect(hero.locator("#card-rent")).toHaveCount(1);
  });

  test("the third step's T-accounts take an amount change from the keyboard", async ({ page }) => {
    await page.goto("/home/");
    const step = page.locator("#step-drag");
    // Jan 9 cash sales, 3,654: one step is $10.
    await step.locator("#p-e3-1").focus();
    await page.keyboard.press("ArrowUp");
    await expect(step.locator("#t-sales-revenue")).toContainText("3,664");
    await expect(step.locator("#t-cash")).toContainText("22,664");
  });

  test("Try it redraws the books as the text changes, and links to the editor", async ({ page }) => {
    await page.goto("/home/");
    const box = page.locator("#try-text");
    await box.fill("Jan 1 Owner invests: Cash 5,000 / Common Stock 5,000\n");
    const tryIt = page.locator("#try");
    await expect(tryIt.locator("#t-cash")).toContainText("5,000");
    await expect(tryIt.locator("#t-equipment")).toHaveCount(0);
    const href = await tryIt.locator("a.open").getAttribute("href");
    expect(href).toMatch(/\/editor\/#v1:/);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

    test("fits the screen with no sideways scrolling", async ({ page }) => {
      await page.goto("/home/");
      await page.locator("#gallery svg").first().waitFor();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      for (const svg of await page.locator("main svg").all()) {
        const b = (await svg.boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(391);
      }
    });
  });
});
