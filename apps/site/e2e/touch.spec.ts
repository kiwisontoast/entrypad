import { expect, test } from "@playwright/test";
import type { CDPSession, Page } from "@playwright/test";
import { assertOnScreen, center, grabPoint, journal, openSpike, waitForSettled } from "./helpers.js";
import type { Point } from "./helpers.js";

/**
 * Finger input goes through Chromium's DevTools protocol
 * (Input.dispatchTouchEvent), which feeds the same pipeline as a real
 * touchscreen: touch-action applies and pages see pointerType "touch".
 */
class Finger {
  constructor(
    private cdp: CDPSession,
    private page: Page,
  ) {}

  static async on(page: Page) {
    return new Finger(await page.context().newCDPSession(page), page);
  }

  async down(...points: Point[]) {
    assertOnScreen(this.page, ...points);
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points.map(tp) });
  }

  async move(...points: Point[]) {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points.map(tp) });
  }

  async glide(from: Point, to: Point, steps = 12) {
    for (let i = 1; i <= steps; i++) {
      await this.move({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    }
  }

  async up() {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async cancel() {
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  }
}

const tp = (p: Point) => ({ x: Math.round(p.x), y: Math.round(p.y), radiusX: 8, radiusY: 8, force: 1 });

async function recordPointerTypes(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __pointerTypes: string[] };
    w.__pointerTypes = [];
    document.addEventListener("pointerdown", (e) => w.__pointerTypes.push(e.pointerType), { capture: true });
  });
}
const pointerTypes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pointerTypes: string[] }).__pointerTypes);

test.describe("touch", () => {
  test.use({ hasTouch: true });

  test("a finger drag posts a card", async ({ page }) => {
    await openSpike(page);
    await recordPointerTypes(page);
    const finger = await Finger.on(page);
    const from = await grabPoint(page.locator("#card-rent"));
    const to = await center(page.locator("#t-rent-expense"));

    await finger.down(from);
    await finger.glide(from, to);
    await finger.up();

    expect(await pointerTypes(page)).toEqual(["touch"]);
    await expect.poll(async () => (await journal(page)).book.entries.at(-1)?.lines[0]?.account).toBe("rent-expense");
    await expect(page.locator("#t-rent-expense")).toContainText("1,200");
  });

  test("a finger drag reclassifies a posted amount", async ({ page }) => {
    await openSpike(page);
    const finger = await Finger.on(page);
    let from = await grabPoint(page.locator("#card-rent"));
    let to = await center(page.locator("#t-rent-expense"));
    await finger.down(from);
    await finger.glide(from, to);
    await finger.up();

    const posting = page.locator("#p-je-rent-0");
    await waitForSettled(posting);
    from = await center(posting);
    to = await center(page.locator("#t-prepaid-rent"));
    await finger.down(from);
    await finger.glide(from, to);
    await finger.up();
    await expect
      .poll(async () => (await journal(page)).book.entries.find((e) => e.id === "je-rent")?.lines[0]?.account)
      .toBe("prepaid-rent");
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });

    test("a finger drag posts a card", async ({ page }) => {
      await openSpike(page);
      const finger = await Finger.on(page);
      const card = page.locator("#card-supplies");
      const target = page.locator("#t-supplies");
      // Scroll so the card and its target are both on screen.
      const cardBox = (await card.boundingBox())!;
      await page.evaluate((y) => window.scrollTo(0, y), cardBox.y - 40);
      await page.waitForTimeout(100);
      const from = await grabPoint(card);
      const to = await center(target);

      await finger.down(from);
      await finger.glide(from, to, 16);
      await finger.up();
      await expect
        .poll(async () => (await journal(page)).book.entries.at(-1)?.lines[0]?.account)
        .toBe("supplies");
    });

    /** A point on the board with nothing draggable under it: right of the card tray. */
    async function emptyBoardPoint(page: Page) {
      const box = (await page.locator("#board svg").boundingBox())!;
      return { x: Math.min(box.x + box.width - 12, 380), y: 600 };
    }

    async function swipeUp(page: Page, finger: Finger, start: Point) {
      await finger.down(start);
      await finger.glide(start, { x: start.x, y: start.y - 400 }, 10);
      await finger.up();
      await page.waitForTimeout(400);
    }

    test("a finger on an empty part of the board scrolls the page", async ({ page }) => {
      await openSpike(page);
      const finger = await Finger.on(page);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await swipeUp(page, finger, await emptyBoardPoint(page));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
      // Nothing was dragged or posted on the way.
      expect((await journal(page)).book.entries).toHaveLength(2);
    });

    test("a finger on a card drags it instead of scrolling", async ({ page }) => {
      await openSpike(page);
      const finger = await Finger.on(page);
      const from = await grabPoint(page.locator("#card-rent"));
      await finger.down(from);
      await finger.glide(from, { x: from.x + 20, y: from.y + 300 }, 10);
      expect(await page.evaluate(() => window.__spike.status())).toBe("dragging");
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await finger.up();
    });

    test("with touch scrolling turned off, the board holds the page still", async ({ page }) => {
      await openSpike(page);
      await page.evaluate(() =>
        localStorage.setItem("entrypad.spike.settings", JSON.stringify({ display: { touchScroll: false } })),
      );
      await openSpike(page);
      const finger = await Finger.on(page);
      await swipeUp(page, finger, await emptyBoardPoint(page));
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await page.evaluate(() => localStorage.clear());
    });
  });

  test.describe("the Phase 1 visuals", () => {
    const openVisuals = async (page: Page) => {
      await page.goto("/visuals/");
      await page.locator("#t-accounts svg").waitFor();
      await page.waitForFunction(() => window.__visuals !== undefined);
    };
    const line = (page: Page, entry: string, index: number) =>
      page.evaluate(([e, i]) => window.__visuals.book().entries.find((x) => x.id === e)?.lines[i], [entry, index] as const);
    /** Scrolls so an element sits near the top of the viewport. */
    const bringUp = async (page: Page, selector: string) => {
      const box = (await page.locator(selector).boundingBox())!;
      await page.evaluate((y) => window.scrollBy(0, y), box.y - 80);
      await page.waitForTimeout(100);
    };

    test("a finger drag reclassifies a T-account amount", async ({ page }) => {
      await openVisuals(page);
      await recordPointerTypes(page);
      const finger = await Finger.on(page);
      const from = await center(page.locator("#p-e2-0"));
      const to = await center(page.locator("#t-prepaid-insurance"));
      await finger.down(from);
      await finger.glide(from, to);
      await finger.up();
      expect(await pointerTypes(page)).toEqual(["touch"]);
      await expect.poll(() => line(page, "e2", 0).then((l) => l?.account)).toBe("prepaid-insurance");
    });

    test("a finger drag up a T-account amount raises it", async ({ page }) => {
      await openVisuals(page);
      const finger = await Finger.on(page);
      const from = await center(page.locator("#p-e2-0"));
      await finger.down(from);
      await finger.glide(from, { x: from.x, y: from.y - 30 }, 10);
      await finger.up();
      await expect.poll(() => line(page, "e2", 0).then((l) => l?.amount)).toBeGreaterThan(180_000);
      expect((await line(page, "e2", 1))!.amount).toBe((await line(page, "e2", 0))!.amount);
    });

    test("a cancelled touch on a T-account amount leaves the books alone", async ({ page }) => {
      await openVisuals(page);
      const finger = await Finger.on(page);
      const from = await center(page.locator("#p-e2-0"));
      const to = await center(page.locator("#t-prepaid-insurance"));
      await finger.down(from);
      await finger.glide(from, to);
      expect(await page.evaluate(() => window.__visuals.status())).toBe("dragging");
      await finger.cancel();
      await expect.poll(() => page.evaluate(() => window.__visuals.status())).toBe("idle");
      expect((await line(page, "e2", 0))!.account).toBe("rent-expense");
    });

    test("a finger drag flips an entry card line to the other side", async ({ page }) => {
      await openVisuals(page);
      await bringUp(page, "#cl-e1-1");
      const finger = await Finger.on(page);
      const credit = page.locator("#cl-e1-1");
      await waitForSettled(credit);
      const c = await center(credit);
      const from = { x: c.x + 100, y: c.y };
      await finger.down(from);
      await finger.glide(from, { x: c.x - 60, y: c.y });
      await finger.up();
      await expect.poll(() => line(page, "e1", 1).then((l) => l?.side)).toBe("dr");
    });

    test.describe("on a phone", () => {
      test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });

      test("every visual fits the screen's width", async ({ page }) => {
        await openVisuals(page);
        for (const id of ["#equation", "#t-accounts", "#cards"]) {
          const box = (await page.locator(`${id} svg`).first().boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(391);
        }
      });

      test("a finger on the equation scrolls the page", async ({ page }) => {
        await openVisuals(page);
        const finger = await Finger.on(page);
        const box = (await page.locator("#equation svg").boundingBox())!;
        const start = { x: box.x + box.width / 2, y: Math.min(box.y + box.height / 2, 700) };
        await finger.down(start);
        await finger.glide(start, { x: start.x, y: start.y - 300 }, 10);
        await finger.up();
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(150);
      });

      test("a finger on a T-account amount drags it instead of scrolling", async ({ page }) => {
        await openVisuals(page);
        await bringUp(page, "#p-e2-0");
        const before = await page.evaluate(() => window.scrollY);
        const finger = await Finger.on(page);
        const from = await center(page.locator("#p-e2-0"));
        await finger.down(from);
        await finger.glide(from, { x: from.x + 10, y: from.y + 200 }, 10);
        expect(await page.evaluate(() => window.__visuals.status())).toBe("dragging");
        expect(await page.evaluate(() => window.scrollY)).toBe(before);
        await finger.up();
      });
    });
  });

  test("a cancelled touch abandons the drag and leaves the books alone", async ({ page }) => {
    // Dragology 0.2.0 ignores pointercancel on its own; usePointerGuard handles it.
    await openSpike(page);
    const finger = await Finger.on(page);
    const from = await grabPoint(page.locator("#card-rent"));
    const to = await center(page.locator("#t-rent-expense"));
    await finger.down(from);
    await finger.glide(from, to);
    expect(await page.evaluate(() => window.__spike.status())).toBe("dragging");
    await finger.cancel();

    await expect.poll(() => page.evaluate(() => window.__spike.status())).toBe("idle");
    expect((await journal(page)).book.entries).toHaveLength(2);
    // The card is back in the tray and a later mouse movement drags nothing.
    await page.mouse.move(to.x + 200, to.y + 50, { steps: 5 });
    await page.mouse.click(1250, 120);
    await page.waitForTimeout(300);
    expect((await journal(page)).drafts.map((d) => d.id)).toContain("rent");
    expect((await journal(page)).book.entries).toHaveLength(2);
    // And the board still works afterwards.
    const again = await grabPoint(page.locator("#card-rent"));
    await finger.down(again);
    await finger.glide(again, to);
    await finger.up();
    await expect.poll(async () => (await journal(page)).book.entries.length).toBe(3);
  });

  test("a second finger can't take over a drag", async ({ page }) => {
    // Dragology 0.2.0 doesn't track pointer ids; usePointerGuard filters them.
    await openSpike(page);
    const finger = await Finger.on(page);
    const from = await grabPoint(page.locator("#card-rent"));
    const target = await center(page.locator("#t-rent-expense"));
    await finger.down(from);
    await finger.glide(from, target, 10);

    // A second finger lands on another account and moves; the first holds.
    const other = await center(page.locator("#t-advertising-expense"));
    await finger.down(target, other);
    await finger.move(target, { x: other.x + 30, y: other.y });
    await finger.move(target, { x: other.x + 60, y: other.y });
    await page.waitForTimeout(200);
    const card = (await page.locator("#card-rent").boundingBox())!;
    expect(Math.abs(card.y + card.height / 2 - target.y)).toBeLessThan(80);

    await finger.up();
    await expect
      .poll(async () => (await journal(page)).book.entries.at(-1)?.lines[0]?.account)
      .toBe("rent-expense");
  });
});
