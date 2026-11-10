import { expect, test } from "@playwright/test";

const headingFont = (page: import("@playwright/test").Page) =>
  page.getByTestId("preview").locator("h1").evaluate((el) => getComputedStyle(el).fontFamily);

test.describe("font test page", () => {
  test("shows every pairing and previews the one picked", async ({ page }) => {
    await page.goto("/fonts/");
    await expect(page.locator("[data-pairing]")).toHaveCount(6);
    await expect(page.locator('[data-pairing="newsreader-inter"]')).toHaveAttribute("aria-pressed", "true");
    expect(await headingFont(page)).toMatch(/^Newsreader/);

    await page.locator('[data-pairing="plex"]').click();
    expect(await headingFont(page)).toMatch(/^"IBM Plex Serif"/);
    await expect(page).toHaveURL(/pair=plex/);
    await expect(page.locator(".css pre")).toContainText('"IBM Plex Sans"');
  });

  test("mixing fonts keeps the choice in the address", async ({ page }) => {
    await page.goto("/fonts/");
    await page.getByLabel("Headings").selectOption("literata");
    await expect(page).toHaveURL(/h=literata/);
    await page.reload();
    expect(await headingFont(page)).toMatch(/^Literata/);
    await expect(page.locator("[aria-pressed=true]")).toHaveCount(0);
  });

  test("has no horizontal scroll on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fonts/");
    const [scrollWidth, viewportWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth!);
  });
});
