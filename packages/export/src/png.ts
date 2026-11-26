import { svgDataUrl } from "./svg.js";

export interface RasterOptions {
  /** Pixel density: 2 draws every SVG unit as 2x2 pixels (setting export.pngScale). */
  scale?: number;
}

/** The width and height written on a standalone SVG's root element. */
export function svgSize(svgText: string): { width: number; height: number } {
  const root = /<svg\b[^>]*>/.exec(svgText)?.[0] ?? "";
  const read = (name: string) => Number.parseFloat(new RegExp(`\\s${name}="([^"]+)"`).exec(root)?.[1] ?? "");
  const width = read("width");
  const height = read("height");
  if (!(width > 0 && height > 0)) throw new Error("The SVG has no width and height");
  return { width, height };
}

/**
 * Draws standalone SVG text (from `serializeSvgWithFonts`, so the fonts
 * travel inside it) onto a new canvas at the given scale.
 */
export async function svgToCanvas(svgText: string, { scale = 2 }: RasterOptions = {}): Promise<HTMLCanvasElement> {
  const { width, height } = svgSize(svgText);
  const img = new Image();
  img.src = svgDataUrl(svgText);
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw to a canvas");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A canvas's pixels as a PNG file. */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The browser couldn't make a PNG"))), "image/png"),
  );
}

/** Standalone SVG text as a PNG file, `scale` pixels per SVG unit. */
export async function svgToPng(svgText: string, options: RasterOptions = {}): Promise<Blob> {
  return canvasToPng(await svgToCanvas(svgText, options));
}

/**
 * Puts a PNG on the clipboard, for pasting straight into a slide. Pass the
 * promise rather than awaiting it first: Safari only allows clipboard writes
 * that start during the click, and accepts a PNG still being made.
 */
export async function copyPng(png: Blob | Promise<Blob>): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("This browser can't copy images");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
