import { settingsSpec } from "@entrypad/core";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { center, grabPoint, mouseDrag, openSpike } from "./helpers.js";

async function openSettings(page: Page) {
  await page.locator("#settings summary").click();
  await expect(page.locator("#settings [data-setting]").first()).toBeVisible();
}

const row = (page: Page, key: string) => page.locator(`#settings [data-setting="${key}"]`);

async function overdraw(page: Page) {
  await mouseDrag(page, await grabPoint(page.locator("#card-van")), await center(page.locator("#t-equipment")));
  await expect(page.locator("#t-cash")).toContainText("(1,500)");
}

test.describe("settings", () => {
  test.beforeEach(async ({ page }) => {
    await openSpike(page);
    await page.evaluate(() => localStorage.clear());
    await openSpike(page);
  });

  test("the panel offers every setting in the registry", async ({ page }) => {
    await openSettings(page);
    await expect(page.locator("#settings [data-setting]")).toHaveCount(settingsSpec.length);
    for (const spec of settingsSpec) await expect(row(page, spec.key)).toHaveCount(1);
    await expect(page.locator("#settings")).toContainText("All defaults");
  });

  test("search narrows the list", async ({ page }) => {
    await openSettings(page);
    await page.getByPlaceholder("Search settings").fill("tab width");
    await expect(page.locator("#settings [data-setting]")).toHaveCount(1);
    await expect(row(page, "parsing.tabWidth")).toBeVisible();
  });

  test("squiggles can be hidden, recoloured or switched off per check", async ({ page }) => {
    await overdraw(page);
    const squiggle = page.locator("#dx-abnormal-cash");
    await expect(squiggle).toHaveAttribute("stroke", "#b26a00"); // warning by default

    await openSettings(page);
    await row(page, "diagnostics.abnormal-balance").locator("select").selectOption("error");
    await expect(squiggle).toHaveAttribute("stroke", "#c62828");
    await row(page, "diagnostics.abnormal-balance").locator("select").selectOption("off");
    await expect(squiggle).toHaveCount(0);
    await row(page, "diagnostics.abnormal-balance").locator("select").selectOption("warning");
    await expect(squiggle).toHaveCount(1);

    await row(page, "display.showDiagnostics").locator("input").uncheck();
    await expect(squiggle).toHaveCount(0);
  });

  test("amounts can show cents", async ({ page }) => {
    await expect(page.locator("#t-cash")).toContainText("6,000");
    await openSettings(page);
    await row(page, "book.decimals").locator("select").selectOption("2");
    await expect(page.locator("#t-cash")).toContainText("6,000.00");
    await expect(page.locator("#card-rent")).toContainText("1,200.00");
  });

  test("exports can include squiggles when asked", async ({ page }) => {
    await overdraw(page);
    expect(await page.evaluate(() => window.__spike.exportSvg())).not.toContain("dx-abnormal-cash");
    await openSettings(page);
    await row(page, "export.includeDiagnostics").locator("input").check();
    expect(await page.evaluate(() => window.__spike.exportSvg())).toContain("dx-abnormal-cash");
  });

  test("settings survive a reload, and reset restores the defaults", async ({ page }) => {
    await openSettings(page);
    await row(page, "parsing.tabWidth").locator("input").fill("2");
    await row(page, "autofix.inferBlankAmount").locator("input").uncheck();
    await expect(page.locator("#settings")).toContainText("2 changed");

    await page.reload();
    await openSettings(page);
    expect(await page.evaluate(() => window.__spike.settings().parsing.tabWidth)).toBe(2);
    expect(await page.evaluate(() => window.__spike.settings().autofix.inferBlankAmount)).toBe(false);
    await expect(row(page, "parsing.tabWidth")).toContainText("(changed)");

    await page.getByRole("button", { name: "Reset to defaults" }).click();
    await expect(page.locator("#settings")).toContainText("All defaults");
    expect(await page.evaluate(() => window.__spike.settings().parsing.tabWidth)).toBe(4);
  });

  test("settings the page doesn't use yet are marked, not hidden", async ({ page }) => {
    await openSettings(page);
    await expect(row(page, "parsing.dateOrder")).toContainText("Not used yet");
    await expect(row(page, "display.showDiagnostics")).not.toContainText("Not used yet");
    await expect(row(page, "parsing.dateOrder")).toContainText("Saved with the book");
    await expect(row(page, "display.showDiagnostics")).toContainText("Your preference");
  });
});
