import { describe, expect, it } from "vitest";
import { encodeGif } from "./gif.js";
import { svgSize } from "./png.js";

function solid(width: number, height: number, rgb: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return data;
}

/** Offsets of each Graphic Control Extension (one per frame). */
function controlBlocks(bytes: Uint8Array): number[] {
  const at: number[] = [];
  for (let i = 0; i + 2 < bytes.length; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) at.push(i);
  return at;
}

describe("encodeGif", () => {
  const frames = [
    { data: solid(4, 3, [255, 255, 255]), width: 4, height: 3, delayMs: 1500 },
    { data: solid(4, 3, [227, 239, 251]), width: 4, height: 3, delayMs: 1500 },
    { data: solid(4, 3, [207, 34, 46]), width: 4, height: 3, delayMs: 3000 },
  ];

  it("writes a looping GIF89a with one frame per step", () => {
    const bytes = encodeGif(frames);
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe("GIF89a");
    // Logical screen size, little endian.
    expect(bytes[6]! | (bytes[7]! << 8)).toBe(4);
    expect(bytes[8]! | (bytes[9]! << 8)).toBe(3);
    expect(new TextDecoder().decode(bytes)).toContain("NETSCAPE2.0");
    expect(controlBlocks(bytes)).toHaveLength(3);
    expect(bytes.at(-1)).toBe(0x3b);
  });

  it("stores each frame's delay in hundredths of a second", () => {
    const bytes = encodeGif(frames);
    const delays = controlBlocks(bytes).map((i) => bytes[i + 4]! | (bytes[i + 5]! << 8));
    expect(delays).toEqual([150, 150, 300]);
  });

  it("plays once when asked", () => {
    expect(new TextDecoder().decode(encodeGif(frames, { repeat: -1 }))).not.toContain("NETSCAPE2.0");
  });

  it("refuses an empty list of frames", () => {
    expect(() => encodeGif([])).toThrow(RangeError);
  });
});

describe("svgSize", () => {
  it("reads the root element's width and height", () => {
    expect(svgSize('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="712" height="296.5" viewBox="0 0 712 296.5"><g width="1"/></svg>')).toEqual({
      width: 712,
      height: 296.5,
    });
  });

  it("throws when there is no size to scale", () => {
    expect(() => svgSize("<svg><rect/></svg>")).toThrow();
  });
});
