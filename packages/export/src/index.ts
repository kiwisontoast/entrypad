export {
  DIAGNOSTICS_LAYER_SELECTOR,
  serializeSvg,
  serializeSvgWithFonts,
  svgBlob,
  svgDataUrl,
} from "./svg.js";
export type { SerializeSvgOptions, SerializeWithFontsOptions } from "./svg.js";
export {
  documentFontFaces,
  fontsUsed,
  inlineFontFaceCss,
  parseUnicodeRange,
  pickSource,
  selectFaces,
} from "./fonts.js";
export type { Fetcher, FontFaceSource, FontUse } from "./fonts.js";
