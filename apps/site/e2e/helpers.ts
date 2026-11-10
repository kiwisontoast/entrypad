import type { Locator, Page } from "@playwright/test";

export interface Point {
  x: number;
  y: number;
}

export async function center(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No bounding box for ${locator}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Grab point for an element: a little inside its top-left corner. */
export async function grabPoint(locator: Locator, dx = 30, dy = 14): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No bounding box for ${locator}`);
  return { x: box.x + dx, y: box.y + dy };
}

/** Throws if a point is outside the viewport, where input events don't land. */
export function assertOnScreen(page: Page, ...points: Point[]): void {
  const size = page.viewportSize();
  if (!size) return;
  for (const p of points) {
    if (p.x < 0 || p.y < 0 || p.x >= size.width || p.y >= size.height) {
      throw new Error(`Point (${p.x}, ${p.y}) is outside the ${size.width}x${size.height} viewport`);
    }
  }
}

/** Mouse drag from one point to another with intermediate moves. */
export async function mouseDrag(page: Page, from: Point, to: Point, steps = 12): Promise<void> {
  assertOnScreen(page, from, to);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 6, from.y + 6, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

export async function openSpike(page: Page, query = ""): Promise<void> {
  await page.goto(`/spike/${query}`);
  await page.locator("#board svg").waitFor();
  await page.waitForFunction(() => window.__spike !== undefined);
}

export function journal(page: Page) {
  return page.evaluate(() => window.__spike.value());
}

/** Waits until an element stops moving, e.g. after a drop animation. */
export async function waitForSettled(locator: Locator, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  let last = JSON.stringify(await locator.boundingBox());
  let stableFor = 0;
  while (Date.now() < deadline) {
    await locator.page().waitForTimeout(50);
    const now = JSON.stringify(await locator.boundingBox());
    stableFor = now === last ? stableFor + 1 : 0;
    if (stableFor >= 3) return;
    last = now;
  }
  throw new Error(`${locator} kept moving for ${timeout}ms`);
}

export function nextFrames(page: Page, n = 2): Promise<void> {
  return page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
}
