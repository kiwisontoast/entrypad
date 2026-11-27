import { expect, test } from "@playwright/test";
import { britishLeft } from "../src/docs/american.js";

test.describe("shorthand reference", () => {
  test("is the spec in American English, with working contents and links", async ({ page }) => {
    await page.goto("/docs/");
    await expect(page.locator("h1")).toHaveText("The Entrypad shorthand");
    await expect(page.locator(".contents li").first()).toHaveText("A complete example");
    const prose = await page.locator(".reference").evaluate((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelectorAll("pre, code").forEach((c) => c.remove());
      return copy.textContent ?? "";
    });
    expect(britishLeft(prose)).toEqual([]);
    expect(prose).toContain("journalize");
    // Code keeps its own spelling: setting keys and shorthand are never changed.
    await expect(page.locator(".reference pre").first()).toContainText('book "Sunrise Bakery" period 2026-01-01..2026-01-31');
    const broken = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href")!.slice(1)).filter((id) => !document.getElementById(id)),
    );
    expect(broken).toEqual([]);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test("fits the screen; wide tables and code scroll inside themselves", async ({ page }) => {
      await page.goto("/docs/");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  });
});
