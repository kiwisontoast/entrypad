/// <reference path="./gifenc.d.ts" />
import { applyPalette, GIFEncoder, quantize } from "gifenc";

/** One frame of an animated GIF: RGBA pixels and how long the frame shows. */
export interface GifFrame {
  /** RGBA bytes, four per pixel, row by row (an `ImageData` works as is). */
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  /** How long the frame stays on screen, in milliseconds. */
  delayMs: number;
}

export interface GifOptions {
  /** Colours per frame, at most 256. Visuals use few colours, so fewer keeps files small. */
  maxColors?: number;
  /** 0 loops for ever (the default); a positive number repeats that many times; -1 plays once. */
  repeat?: number;
}

/**
 * Encodes frames as an animated GIF. Each frame gets its own palette, which
 * suits visuals: flat colours, a few dozen at most. Frames of the same size
 * are expected; the first frame's size is the GIF's.
 */
export function encodeGif(frames: readonly GifFrame[], options: GifOptions = {}): Uint8Array {
  const { maxColors = 256, repeat = 0 } = options;
  if (!frames.length) throw new RangeError("A GIF needs at least one frame");
  const gif = GIFEncoder();
  frames.forEach((frame, i) => {
    const palette = quantize(frame.data, maxColors);
    const index = applyPalette(frame.data, palette);
    gif.writeFrame(index, frame.width, frame.height, {
      palette,
      // GIF delays are in hundredths of a second; gifenc rounds for us.
      delay: frame.delayMs,
      ...(i === 0 && { repeat }),
    });
  });
  gif.finish();
  return gif.bytes();
}

/** Wraps GIF bytes in a Blob with the right media type. */
export function gifBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/gif" });
}
