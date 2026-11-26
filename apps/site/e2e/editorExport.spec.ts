import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PNG } from "pngjs";

async function openEditor(page: Page): Promise<void> {
  await page.goto("/editor/");
  await page.locator(".cm-content").waitFor();
  await page.waitForFunction(() => window.__editor !== undefined);
}

/** Opens a visual's export menu and saves what one of its buttons downloads. */
async function exportFile(page: Page, section: string, button: string): Promise<{ name: string; bytes: Buffer }> {
  await page.locator(`#${section} .export summary`).click();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.locator(`#${section} .${button}`).click()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), bytes: readFileSync(path) };
}

/** Graphic Control Extensions, one per GIF frame. */
const gifFrames = (bytes: Buffer) => {
  let n = 0;
  for (let i = 0; i + 2 < bytes.length; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) n++;
  return n;
};

test.describe("editor export", () => {
  test.use({ viewport: { width: 1440, height: 1100 } });

  test("saves an entry cards SVG with its fonts and without squiggles", async ({ page }) => {
    await openEditor(page);
    // The bakery has an inferred amount, so the editor draws a hint squiggle.
    expect(await page.locator('#cards [data-entrypad-layer="diagnostics"]').count()).toBeGreaterThan(0);
    const { name, bytes } = await exportFile(page, "cards", "export-svg");
    expect(name).toBe("sunrise-bakery-entries.svg");
    const svg = bytes.toString("utf8");
    expect(svg.startsWith("<?xml")).toBe(true);
    expect(svg).toContain("@font-face");
    expect(svg).not.toContain('data-entrypad-layer="diagnostics"');
  });

  test("saves a PNG at the resolution setting, 2x by default", async ({ page }) => {
    await openEditor(page);
    const svg = page.locator("#t-accounts svg").first();
    const width = Number(await svg.getAttribute("width"));
    const height = Number(await svg.getAttribute("height"));
    const { name, bytes } = await exportFile(page, "t-accounts", "export-png");
    expect(name).toBe("sunrise-bakery-t-accounts.png");
    const png = PNG.sync.read(bytes);
    expect(png.width).toBe(Math.round(width * 2));
    expect(png.height).toBe(Math.round(height * 2));
    // Not blank: the canvas colour and dark ink both appear.
    const colours = new Set<number>();
    for (let i = 0; i < png.data.length; i += 4 * 97) colours.add(png.data.readUInt32BE(i));
    expect(colours.size).toBeGreaterThan(3);
  });

  test("copies a PNG to the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openEditor(page);
    await page.locator("#equation .export summary").click();
    await page.locator("#equation .export-copy").click();
    await expect(page.locator("#equation .export-status")).toHaveText("Copied. Paste it into a slide.", { timeout: 30_000 });
    const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types));
    expect(types).toContain("image/png");
  });

  test("saves a GIF of the month, one frame per entry plus the empty books", async ({ page }) => {
    test.setTimeout(120_000);
    await openEditor(page);
    const count = await page.evaluate(() => window.__editor.book().entries.length);
    const { name, bytes } = await exportFile(page, "equation", "export-gif");
    expect(name).toBe("sunrise-bakery-equation.gif");
    expect(bytes.subarray(0, 6).toString("latin1")).toBe("GIF89a");
    expect(gifFrames(bytes)).toBe(count + 1);
    // The live visual wasn't touched by the step-through.
    await expect(page.locator("#position")).toHaveText(`All ${count} entries`);
  });
});
