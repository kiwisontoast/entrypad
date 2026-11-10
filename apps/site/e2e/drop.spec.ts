import { expect, test } from "@playwright/test";
import { center, grabPoint, journal, mouseDrag, openSpike, waitForSettled } from "./helpers.js";

test.describe("posting by drag", () => {
  test("dropping a card on a T-account posts the entry", async ({ page }) => {
    await openSpike(page);
    await expect(page.locator("#t-rent-expense")).toBeVisible();

    await mouseDrag(page, await grabPoint(page.locator("#card-rent")), await center(page.locator("#t-rent-expense")));

    await expect.poll(async () => (await journal(page)).drafts.map((d) => d.id)).not.toContain("rent");
    const { book } = await journal(page);
    const entry = book.entries.find((e) => e.id === "je-rent");
    expect(entry?.lines).toEqual([
      { account: "rent-expense", side: "dr", amount: 120_000 },
      { account: "cash", side: "cr", amount: 120_000 },
    ]);
    await expect(page.locator("#t-rent-expense")).toContainText("1,200");
    // Cash: 10,000 - 4,000 - 1,200.
    await expect(page.locator("#t-cash")).toContainText("4,800");
  });

  test("dropping away from every account leaves the books unchanged", async ({ page }) => {
    await openSpike(page);
    const card = page.locator("#card-rent");
    const start = await grabPoint(card);
    // Into the empty space to the right of the card tray.
    await mouseDrag(page, start, { x: 1200, y: start.y + 10 });
    await page.waitForTimeout(500);
    const { book, drafts } = await journal(page);
    expect(drafts.map((d) => d.id)).toContain("rent");
    expect(book.entries).toHaveLength(2);
  });

  test("the card's own fixed account is not a drop target", async ({ page }) => {
    await openSpike(page);
    await mouseDrag(page, await grabPoint(page.locator("#card-rent")), await center(page.locator("#t-cash")));
    await page.waitForTimeout(500);
    expect((await journal(page)).drafts.map((d) => d.id)).toContain("rent");
  });

  test("dragging a posted amount to another account reclassifies it", async ({ page }) => {
    await openSpike(page);
    await mouseDrag(page, await grabPoint(page.locator("#card-rent")), await center(page.locator("#t-rent-expense")));
    await expect.poll(async () => (await journal(page)).book.entries.length).toBe(3);

    const posting = page.locator("#p-je-rent-0");
    await expect(posting).toBeVisible();
    await waitForSettled(posting);
    await mouseDrag(page, await center(posting), await center(page.locator("#t-prepaid-rent")));

    await expect
      .poll(async () => (await journal(page)).book.entries.find((e) => e.id === "je-rent")?.lines[0]?.account)
      .toBe("prepaid-rent");
    await expect(page.locator("#t-prepaid-rent")).toContainText("1,200");
  });

  test("the board keeps its own font whatever the page uses", async ({ page }) => {
    await openSpike(page);
    await page.addStyleTag({ content: "body { font-family: 'Times New Roman', serif !important; }" });
    const font = await page.locator("#t-cash text").first().evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font).toMatch(/^"Source Sans 3"/);
  });

  test("an overdraft shows a diagnostic squiggle under Cash", async ({ page }) => {
    await openSpike(page);
    await expect(page.locator("#dx-abnormal-cash")).toHaveCount(0);
    await mouseDrag(page, await grabPoint(page.locator("#card-van")), await center(page.locator("#t-equipment")));
    await expect(page.locator("#t-cash")).toContainText("(1,500)");
    await expect(page.locator("#dx-abnormal-cash")).toHaveCount(1);
  });
});
