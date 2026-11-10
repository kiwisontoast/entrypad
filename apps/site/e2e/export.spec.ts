import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { center, grabPoint, openSpike } from "./helpers.js";

test("a mid-drag frame exports as a standalone SVG that matches the screen", async ({ page, browser }, testInfo) => {
  await openSpike(page);

  // Hold the van card over Equipment. The preview posts it there, which
  // overdraws Cash and puts a squiggle under it.
  const from = await grabPoint(page.locator("#card-van"));
  const to = await center(page.locator("#t-equipment"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.waitForTimeout(700); // let preview transitions finish so the frame is steady
  expect(await page.evaluate(() => window.__spike.status())).toBe("dragging");
  await expect(page.locator("#dx-abnormal-cash")).toHaveCount(1);

  await page.evaluate(() => document.fonts.ready);
  const onScreen = await page.locator("#board svg").screenshot();
  // The pixel comparison renders the file as an <img>, which can't see the
  // page's web fonts, so it only matches if the fonts are embedded.
  const withDiagnostics = await page.evaluate(() => window.__spike.exportSvgWithFonts({ includeDiagnostics: true }));
  const exported = await page.evaluate(() => window.__spike.exportSvgWithFonts());
  await page.mouse.up();

  await testInfo.attach("mid-drag.svg", { body: exported, contentType: "image/svg+xml" });

  // Squiggles never reach an export.
  expect(withDiagnostics).toContain('id="dx-abnormal-cash"');
  expect(exported).not.toContain("dx-abnormal-cash");
  expect(exported).not.toContain("data-entrypad-layer");

  // Standalone: valid XML, no HTML islands, no renderer bookkeeping.
  expect(exported).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(exported).toMatch(/viewBox="0 0 \d+ \d+"/);
  expect(exported).not.toContain("foreignObject");
  expect(exported).not.toContain("data-path");
  const parseError = await page.evaluate(
    (text) => new DOMParser().parseFromString(text, "image/svg+xml").querySelector("parsererror")?.textContent ?? null,
    exported,
  );
  expect(parseError).toBeNull();

  // Fonts travel inside the file: Source Sans 3 as data, nothing fetched from elsewhere.
  expect(exported).toContain('font-family:"Source Sans 3"');
  expect(exported).toMatch(/src:url\(data:font\/woff2;base64,/);
  expect(exported).not.toMatch(/url\((?!data:)/);
  expect(exported.length).toBeLessThan(400_000);
  testInfo.annotations.push({ type: "export size", description: `${Math.round(exported.length / 1024)} KB` });
  console.log(`[export] file size with fonts: ${Math.round(exported.length / 1024)} KB`);

  // The dragged card is in the exported frame, posted state previewed.
  expect(exported).toContain('id="card-van"');
  expect(exported).toContain("(1,500)");

  // Render the file the way another app would (as an image, no page CSS or
  // scripts) and compare with what was on screen, diagnostics included.
  const viewer = await browser.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 1 });
  const b64 = Buffer.from(withDiagnostics).toString("base64");
  await viewer.setContent(
    `<html><body style="margin:0"><img id="out" src="data:image/svg+xml;base64,${b64}"></body></html>`,
  );
  await viewer.locator("#out").evaluate((img: HTMLImageElement) => img.decode());
  const rendered = await viewer.locator("#out").screenshot();
  await viewer.close();

  const a = PNG.sync.read(onScreen);
  const b = PNG.sync.read(rendered);
  expect([b.width, b.height]).toEqual([a.width, a.height]);
  const diff = new PNG({ width: a.width, height: a.height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  const ratio = mismatched / (a.width * a.height);
  const summary = `${mismatched} of ${a.width * a.height} px differ (${(ratio * 100).toFixed(3)}%)`;
  testInfo.annotations.push({ type: "pixel mismatch", description: summary });
  console.log(`[export] ${summary}`);
  if (ratio > 0) {
    await testInfo.attach("on-screen.png", { body: onScreen, contentType: "image/png" });
    await testInfo.attach("exported.png", { body: rendered, contentType: "image/png" });
    await testInfo.attach("diff.png", { body: PNG.sync.write(diff), contentType: "image/png" });
    writeFileSync(testInfo.outputPath("on-screen.png"), onScreen);
    writeFileSync(testInfo.outputPath("exported.png"), rendered);
    writeFileSync(testInfo.outputPath("diff.png"), PNG.sync.write(diff));
  }
  // Allow for text antialiasing differences between inline SVG and <img>.
  expect(ratio).toBeLessThan(0.002);
});
