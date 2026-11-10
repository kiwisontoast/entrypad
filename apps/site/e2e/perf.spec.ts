import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { center, grabPoint, openSpike } from "./helpers.js";
import type { Point } from "./helpers.js";

interface Stats {
  n: number;
  p50: number;
  p95: number;
  max: number;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

function stats(values: number[]): Stats {
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  return { n: s.length, p50: r1(at(0.5)), p95: r1(at(0.95)), max: r1(s.at(-1) ?? 0) };
}

type Mode = "drag" | "baseline";
interface Case {
  mode: Mode;
  accounts: number;
  cpu: number;
  frames: "opaque" | "plain";
}

// CI runs the cases that answer the Phase 0 question; PERF_FULL=1 runs all.
const full = process.env.PERF_FULL === "1";
const cases: Case[] = [
  { mode: "baseline", accounts: 30, cpu: 1, frames: "opaque" },
  { mode: "drag", accounts: 30, cpu: 1, frames: "opaque" },
  { mode: "drag", accounts: 30, cpu: 1, frames: "plain" },
  ...(full
    ? ([
        { mode: "baseline", accounts: 30, cpu: 4, frames: "opaque" },
        { mode: "drag", accounts: 30, cpu: 4, frames: "opaque" },
        { mode: "drag", accounts: 30, cpu: 4, frames: "plain" },
        { mode: "drag", accounts: 30, cpu: 6, frames: "opaque" },
        { mode: "drag", accounts: 60, cpu: 1, frames: "opaque" },
        { mode: "drag", accounts: 60, cpu: 4, frames: "opaque" },
      ] satisfies Case[])
    : []),
];

const results: Record<string, unknown>[] = [];

/** The pointer path: into each account on the board in turn, then away. */
async function sweepPath(page: Page): Promise<Point[]> {
  const ids = await page.locator('[id^="t-"]').evaluateAll((els) => els.map((e) => e.id));
  const points: Point[] = [];
  for (const id of ids) points.push(await center(page.locator(`#${id}`)));
  return points;
}

test.describe("drag performance", () => {
  test.use({ viewport: { width: 1280, height: 1900 } });

  for (const c of cases) {
    const name = `${c.mode} ${c.accounts} accounts, ${c.frames} frames, ${c.cpu}x CPU slowdown`;
    test(name, async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      await openSpike(page, `?accounts=${c.accounts}&frames=${c.frames}`);
      const path = await sweepPath(page);
      expect(path.length).toBe(c.accounts);
      const box = (await page.locator("#board svg").boundingBox())!;
      const cardGrab = await grabPoint(page.locator("#card-rent"));
      // Baseline presses on empty canvas instead, so nothing is dragged.
      const from = c.mode === "drag" ? cardGrab : { x: box.x + box.width - 30, y: cardGrab.y };

      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: c.cpu });
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 8, from.y + 8, { steps: 2 });
      for (const p of path) await page.mouse.move(p.x, p.y, { steps: 4 });
      await page.mouse.move(box.x + box.width - 30, from.y, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(800);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

      const log = await page.evaluate(() => window.__spike.perf);
      const moves = log.events.filter((e) => e.type === "pointermove");
      const longFrames = log.longFrames;
      const row = {
        ...c,
        moveHandler: stats(moves.map((e) => e.ms)),
        reactCommit: stats(log.commits),
        frameInterval: stats(log.frames),
        framesOver33ms: log.frames.filter((f) => f > 33.4).length,
        longFrames: {
          n: longFrames.length,
          totalMs: Math.round(longFrames.reduce((s, f) => s + f.duration, 0)),
          scriptMs: Math.round(longFrames.reduce((s, f) => s + f.script, 0)),
          styleLayoutMs: Math.round(longFrames.reduce((s, f) => s + f.styleLayout, 0)),
        },
        dragged: log.statuses.includes("dragging"),
        idleAfter: (await page.evaluate(() => window.__spike.status())) === "idle",
        entriesAfter: await page.evaluate(() => window.__spike.value().book.entries.length),
      };
      results.push(row);
      console.log(`[perf] ${JSON.stringify(row)}`);
      await testInfo.attach("perf.json", { body: JSON.stringify(row, null, 2), contentType: "application/json" });

      expect(row.dragged).toBe(c.mode === "drag");
      expect(row.idleAfter).toBe(true);
      expect(row.entriesAfter).toBe(2);
      // A loose ceiling so CI catches large regressions without flaking.
      if (c.mode === "drag" && c.cpu === 1 && c.accounts === 30 && c.frames === "opaque") {
        expect(row.reactCommit.p50).toBeLessThan(16);
      }
    });
  }

  test.afterAll(() => {
    if (!results.length) return;
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/perf-summary.json", JSON.stringify(results, null, 2));
  });
});
