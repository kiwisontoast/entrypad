// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { inlineFontFaceCss, parseUnicodeRange, pickSource, selectFaces } from "./fonts.js";
import type { FontFaceSource } from "./fonts.js";

const LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+2000-206F";
const LATIN_EXT = "U+0100-02BA, U+1E00-1EFF";
const CYRILLIC = "U+0400-045F";

const face = (weight: string, range: string, name: string): FontFaceSource => ({
  family: "Source Sans 3",
  weight,
  style: "normal",
  unicodeRange: range,
  url: `https://example.test/${name}.woff2`,
  format: "woff2",
});

const faces = [
  face("400", LATIN, "400-latin"),
  face("400", LATIN_EXT, "400-latin-ext"),
  face("400", CYRILLIC, "400-cyrillic"),
  face("600", LATIN, "600-latin"),
  face("600", LATIN_EXT, "600-latin-ext"),
];

describe("parseUnicodeRange", () => {
  it("reads single points, spans and wildcards", () => {
    expect(parseUnicodeRange("U+0131, U+0152-0153, u+4??")).toEqual([
      [0x131, 0x131],
      [0x152, 0x153],
      [0x400, 0x4ff],
    ]);
  });
});

describe("pickSource", () => {
  it("prefers woff2 and resolves relative URLs", () => {
    const src = `url(a.ttf) format("truetype"), url("/fonts/a.woff2") format("woff2"), url(a.woff) format("woff")`;
    expect(pickSource(src, "https://site.test/assets/app.css")).toEqual({
      url: "https://site.test/fonts/a.woff2",
      format: "woff2",
    });
  });
});

describe("selectFaces", () => {
  const sans = '"Source Sans 3", "Segoe UI", sans-serif';

  it("takes only the weights used and the subsets the text needs", () => {
    const picked = selectFaces(
      faces,
      [
        { family: sans, weight: "400", style: "normal" },
        { family: sans, weight: "600", style: "normal" },
      ],
      "Cash 10,000 Bal. 6,000",
    );
    expect(picked.map((f) => f.url.split("/").pop())).toEqual(["400-latin.woff2", "600-latin.woff2"]);
  });

  it("adds an extended subset when the text needs it", () => {
    const picked = selectFaces(faces, [{ family: sans, weight: "400", style: "normal" }], "Pierogi Łódź");
    expect(picked.map((f) => f.url.split("/").pop())).toEqual(["400-latin.woff2", "400-latin-ext.woff2"]);
  });

  it("falls back to the closest declared weight", () => {
    const picked = selectFaces(faces, [{ family: sans, weight: "700", style: "normal" }], "Totals");
    expect(picked.map((f) => f.weight)).toEqual(["600"]);
  });

  it("embeds nothing for system fonts", () => {
    expect(selectFaces(faces, [{ family: '"Segoe UI", sans-serif', weight: "400", style: "normal" }], "Cash")).toEqual(
      [],
    );
  });
});

describe("inlineFontFaceCss", () => {
  it("inlines each file as a data URL and keeps its unicode-range", async () => {
    const bytes = new Uint8Array([119, 79, 70, 50]).buffer; // "wOF2"
    const css = await inlineFontFaceCss([faces[0]!], async () => ({ ok: true, arrayBuffer: async () => bytes }));
    expect(css).toBe(
      `@font-face{font-family:"Source Sans 3";font-style:normal;font-weight:400;` +
        `src:url(data:font/woff2;base64,d09GMg==);unicode-range:${LATIN};}`,
    );
  });

  it("fails loudly when a font can't be loaded", async () => {
    await expect(
      inlineFontFaceCss([faces[0]!], async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })),
    ).rejects.toThrow(/Could not load font/);
  });
});
