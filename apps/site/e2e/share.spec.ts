import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import lz from "lz-string";

async function openEditor(page: Page, url = "/editor/"): Promise<void> {
  await page.goto(url);
  await page.locator(".cm-content").waitFor();
  await page.waitForFunction(() => window.__editor !== undefined);
}

const text = (page: Page) => page.evaluate(() => window.__editor.text());

/** Clicks a copy button and returns what it put on the clipboard. */
async function copied(page: Page, button: string): Promise<string> {
  await page.locator(button).click();
  await expect(page.locator("#share-status")).toContainText("copied");
  return page.evaluate(() => navigator.clipboard.readText());
}

const bookIn = (link: string) => lz.decompressFromEncodedURIComponent(new URL(link).hash.replace(/^#v1:/, ""));

async function allowClipboard(context: BrowserContext) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
}

async function openEmbed(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.__embed !== undefined);
}

test.describe("sharing", () => {
  test.use({ viewport: { width: 1440, height: 1100 } });

  test("a link opens the editor on exactly the same text", async ({ page, context }) => {
    await allowClipboard(context);
    await openEditor(page);
    await page.evaluate(() => window.__editor.setText(window.__editor.text() + "\nJan 31 Owner draws cash\n  Dividends   500\n      Cash        500\n"));
    const before = await text(page);
    const link = await copied(page, "#copy-link");
    expect(link).toMatch(/\/editor\/#v1:/);
    expect(bookIn(link)).toBe(before);

    const other = await context.newPage();
    await openEditor(other, link);
    expect(await text(other)).toBe(before);
    await expect(other.locator("#example")).toHaveValue("shared");
  });

  test("a link carries the reader's own file settings as set lines", async ({ page, context }) => {
    await allowClipboard(context);
    await openEditor(page);
    await page.evaluate(() => localStorage.setItem("entrypad.editor.settings", JSON.stringify({ autofix: { inferBlankAmount: false } })));
    await openEditor(page);
    const shared = bookIn(await copied(page, "#copy-link"));
    expect(shared.split("\n")[0]).toMatch(/^set autofix\.inferBlankAmount /);
    expect(shared.endsWith(await text(page))).toBe(true);
    await page.evaluate(() => localStorage.clear());
  });

  test("suggests a file when the link is longer than the setting allows", async ({ page, context }) => {
    await allowClipboard(context);
    await openEditor(page);
    await page.evaluate(() => localStorage.setItem("entrypad.editor.settings", JSON.stringify({ sharing: { linkWarningLength: 1000 } })));
    await openEditor(page);
    await copied(page, "#copy-link");
    await expect(page.locator("#share-status")).toContainText("saving a file may be safer");
    await page.evaluate(() => localStorage.clear());
  });

  test("saves the book as a .entrypad file and opens it again", async ({ page }) => {
    await openEditor(page);
    const before = await text(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#save-file").click()]);
    expect(download.suggestedFilename()).toBe("sunrise-bakery.entrypad");
    const saved = readFileSync(await download.path(), "utf8");
    expect(saved).toBe(before);

    await page.locator("#example").selectOption("bikes");
    await expect.poll(() => text(page)).not.toBe(before);
    await page.locator('input[type="file"]').setInputFiles({ name: "bakery.entrypad", mimeType: "text/plain", buffer: Buffer.from(saved) });
    await expect.poll(() => text(page)).toBe(before);
    await expect(page.locator("#share-status")).toHaveText("Opened bakery.entrypad.");
  });
});

test.describe("embed", () => {
  test.use({ viewport: { width: 1000, height: 700 } });

  async function embedLink(page: Page, context: BrowserContext): Promise<string> {
    await allowClipboard(context);
    await openEditor(page);
    return copied(page, "#copy-embed");
  }

  test("shows one visual without squiggles and steps through by key and button", async ({ page, context }) => {
    const link = await embedLink(page, context);
    expect(link).toContain("/embed/?visual=t-accounts#v1:");
    await openEmbed(page, link);
    await expect(page.locator("#t-cash")).toBeVisible();
    await expect(page.locator('[id^="dx-"]')).toHaveCount(0);
    await expect(page.locator("#position")).toHaveText("All 20 entries");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#position")).toHaveText("19 of 20");
    await page.keyboard.press("Home");
    await expect(page.locator("#position")).toHaveText("0 of 20");
    await page.locator("#next").click();
    await expect(page.locator("#position")).toHaveText("1 of 20");
    // After the owner's investment only.
    await expect(page.locator("#t-cash")).toContainText("25,000");
  });

  test("works inside an iframe", async ({ page, context }) => {
    const link = await embedLink(page, context);
    const host = await context.newPage();
    await host.setContent(`<!doctype html><title>Host</title><iframe src="${link.replace("t-accounts", "equation")}" width="760" height="460" style="border:0"></iframe>`);
    const frame = host.frameLocator("iframe");
    await expect(frame.locator("#equation, svg").first()).toBeVisible();
    await expect(frame.locator("body")).toContainText("Assets = Liabilities + Equity");
    await frame.locator("#prev").click();
    await expect(frame.locator("#position")).toHaveText("19 of 20");
  });

  test("explains itself when the link has no book", async ({ page }) => {
    await page.goto("/embed/");
    await expect(page.locator("h1")).toHaveText("No book to show");
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

    test("a swipe steps through and the visual fits the screen", async ({ page, context }) => {
      const desktop = await context.newPage();
      await desktop.setViewportSize({ width: 1440, height: 1100 });
      const link = await embedLink(desktop, context);
      await openEmbed(page, link);
      const box = (await page.locator("svg").first().boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(391);

      const cdp = await context.newCDPSession(page);
      const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
        cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, radiusX: 8, radiusY: 8, force: 1 }] });
      // The buttons answer a tap. (Tapped first: the first touch after a fast
      // swipe only stops the browser's fling, as on a real phone.)
      const prev = (await page.locator("#prev").boundingBox())!;
      await touch("touchStart", prev.x + prev.width / 2, prev.y + prev.height / 2);
      await touch("touchEnd", prev.x + prev.width / 2, prev.y + prev.height / 2);
      await expect(page.locator("#position")).toHaveText("19 of 20");
      // Swiping right to left, from the empty canvas below the visual, goes forward.
      const y = Math.min(box.y + box.height + 40, 760);
      await touch("touchStart", 330, y);
      for (const x of [290, 230, 170, 110]) await touch("touchMove", x, y);
      await touch("touchEnd", 110, y);
      await expect(page.locator("#position")).toHaveText("All 20 entries");
      // And left to right goes back.
      await touch("touchStart", 60, y);
      for (const x of [100, 160, 220, 280]) await touch("touchMove", x, y);
      await touch("touchEnd", 280, y);
      await expect(page.locator("#position")).toHaveText("19 of 20");
    });
  });
});
