import type { EntrypadSettings } from "@entrypad/core";
import { copyPng, encodeGif, gifBlob, serializeSvgWithFonts, svgBlob, svgSize, svgToCanvas, svgToPng } from "@entrypad/export";
import type { Fetcher, GifFrame } from "@entrypad/export";
import { theme } from "@entrypad/react";
import { useState } from "react";
import type { ReactElement, RefObject } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

/**
 * The export menu under each visual in the editor: SVG, PNG, PNG to the
 * clipboard, and a GIF of the month stepped through one entry at a time.
 * Squiggles stay out unless export.includeDiagnostics is on.
 */

export interface ExportMenuProps {
  /** The section holding the visual; its first <svg> is what gets exported. */
  section: RefObject<HTMLElement | null>;
  /** File names start with this, e.g. "sunrise-bakery-t-accounts". */
  fileName: string;
  settings: EntrypadSettings;
  /** Number of entries, for the step-through. */
  count: number;
  /** The visual as it stood after `at` entries, read-only and without squiggles, for GIF frames. */
  renderAt: (at: number) => ReactElement;
}

/** "Sunrise Bakery" and "T-accounts" -> "sunrise-bakery-t-accounts". */
export const slug = (...parts: string[]) =>
  parts
    .join(" ")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "entrypad";

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Font files fetched once per export, however many frames embed them. */
function cachedFetcher(): Fetcher {
  const cache = new Map<string, Promise<ArrayBuffer>>();
  return async (url) => {
    let bytes = cache.get(url);
    if (!bytes) {
      bytes = fetch(url).then((r) => {
        if (!r.ok) throw new Error(`Could not load font ${url}`);
        return r.arrayBuffer();
      });
      cache.set(url, bytes);
    }
    const data = await bytes;
    return { ok: true, arrayBuffer: async () => data };
  };
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * Renders the visual after 0, 1, ... `count` entries in a hidden container
 * and returns one standalone SVG per step. The live visual on the page is
 * left alone.
 */
async function stepThroughSvgs(renderAt: (at: number) => ReactElement, count: number, settings: EntrypadSettings): Promise<string[]> {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, { position: "fixed", left: "-100000px", top: "0", pointerEvents: "none" });
  document.body.append(host);
  const root = createRoot(host);
  const fetcher = cachedFetcher();
  const svgs: string[] = [];
  try {
    for (let at = 0; at <= count; at++) {
      flushSync(() => root.render(renderAt(at)));
      await nextFrame();
      const svg = host.querySelector("svg");
      if (!svg) throw new Error("The visual didn't draw");
      svgs.push(
        await serializeSvgWithFonts(svg, { includeDiagnostics: settings.export.includeDiagnostics, embedFonts: settings.export.embedFonts, fetcher }),
      );
    }
  } finally {
    root.unmount();
    host.remove();
  }
  return svgs;
}

/** A GIF of the step-through. Frames that come out smaller (fewer cards, say) sit top left on the canvas colour. */
export async function stepThroughGif(renderAt: (at: number) => ReactElement, count: number, settings: EntrypadSettings): Promise<Blob> {
  const svgs = await stepThroughSvgs(renderAt, count, settings);
  // GIFs can't be sharp at 3x without getting large; 2x is plenty for a slide.
  const scale = Math.min(2, settings.export.pngScale);
  const sizes = svgs.map(svgSize);
  const width = Math.round(Math.max(...sizes.map((s) => s.width)) * scale);
  const height = Math.round(Math.max(...sizes.map((s) => s.height)) * scale);
  const delay = settings.export.gifSecondsPerEntry * 1000;
  const frames: GifFrame[] = [];
  for (const [i, svg] of svgs.entries()) {
    const drawn = await svgToCanvas(svg, { scale });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = theme.canvas;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(drawn, 0, 0);
    const { data } = ctx.getImageData(0, 0, width, height);
    // The finished month holds twice as long before the loop starts again.
    frames.push({ data, width, height, delayMs: i === svgs.length - 1 ? delay * 2 : delay });
  }
  return gifBlob(encodeGif(frames));
}

export function ExportMenu({ section, fileName, settings, count, renderAt }: ExportMenuProps) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const currentSvg = () => {
    const svg = section.current?.querySelector("svg");
    if (!svg) throw new Error("Nothing to export yet");
    return serializeSvgWithFonts(svg, { includeDiagnostics: settings.export.includeDiagnostics, embedFonts: settings.export.embedFonts });
  };

  const run = (label: string, task: () => Promise<string>) => async () => {
    setBusy(true);
    setStatus(label);
    try {
      setStatus(await task());
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  const items: [string, string, () => Promise<string>][] = [
    [
      "export-svg",
      "Download SVG",
      async () => {
        download(svgBlob(await currentSvg()), `${fileName}.svg`);
        return "SVG saved";
      },
    ],
    [
      "export-png",
      "Download PNG",
      async () => {
        download(await svgToPng(await currentSvg(), { scale: settings.export.pngScale }), `${fileName}.png`);
        return "PNG saved";
      },
    ],
    [
      "export-copy",
      "Copy as PNG",
      async () => {
        // Started before any await, so the clipboard write still counts as part of the click.
        await copyPng(currentSvg().then((svg) => svgToPng(svg, { scale: settings.export.pngScale })));
        return "Copied. Paste it into a slide.";
      },
    ],
    [
      "export-gif",
      "Download GIF of the month",
      async () => {
        download(await stepThroughGif(renderAt, count, settings), `${fileName}.gif`);
        return "GIF saved";
      },
    ],
  ];

  return (
    <details className="export">
      <summary>Export</summary>
      <div className="export-items">
        {items.map(([id, label, task]) => (
          <button key={id} type="button" className={id} disabled={busy} onClick={run(id === "export-gif" ? "Making the GIF…" : "Exporting…", task)}>
            {label}
          </button>
        ))}
        <span className="export-status" role="status">
          {status}
        </span>
      </div>
    </details>
  );
}
