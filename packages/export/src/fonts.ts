/** One @font-face rule: a single family, weight and style, often for one character subset. */
export interface FontFaceSource {
  family: string;
  weight: string;
  style: string;
  /** CSS unicode-range, e.g. "U+0000-00FF, U+0131". Absent means every character. */
  unicodeRange?: string;
  /** Absolute URL of the font file. */
  url: string;
  format?: string;
}

/** A font the visual draws text with. */
export interface FontUse {
  family: string;
  weight: string;
  style: string;
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");

/** The @font-face rules in a document's stylesheets. Cross-origin sheets are skipped. */
export function documentFontFaces(doc: Document = document): FontFaceSource[] {
  const faces: FontFaceSource[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // A cross-origin stylesheet can't be read.
    }
    const base = sheet.href ?? doc.baseURI;
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const src = rule.style.getPropertyValue("src");
      const picked = pickSource(src, base);
      if (!picked) continue;
      const range = rule.style.getPropertyValue("unicode-range").trim();
      faces.push({
        family: unquote(rule.style.getPropertyValue("font-family")),
        weight: normalizeWeight(rule.style.getPropertyValue("font-weight") || "400"),
        style: rule.style.getPropertyValue("font-style").trim() || "normal",
        ...(range && { unicodeRange: range }),
        url: picked.url,
        ...(picked.format && { format: picked.format }),
      });
    }
  }
  return faces;
}

/** Prefers woff2, then woff, then whatever comes first. */
export function pickSource(src: string, base: string): { url: string; format?: string } | undefined {
  const entries = [...src.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)(?:\s*format\(\s*["']?([^"')]+)["']?\s*\))?/g)].map(
    (m) => ({ url: new URL(m[2]!, base).href, format: m[3] }),
  );
  return (
    entries.find((e) => e.format === "woff2" || e.url.endsWith(".woff2")) ??
    entries.find((e) => e.format === "woff" || e.url.endsWith(".woff")) ??
    entries[0]
  );
}

function normalizeWeight(w: string): string {
  const t = w.trim();
  if (t === "normal") return "400";
  if (t === "bold") return "700";
  return t.split(/\s+/)[0] ?? "400";
}

/**
 * The fonts a rendered SVG uses, and every character it draws. Reads computed
 * styles, so it sees fonts set by the page as well as by attributes.
 */
export function fontsUsed(svg: SVGSVGElement): { uses: FontUse[]; chars: string } {
  const view = svg.ownerDocument.defaultView;
  const seen = new Map<string, FontUse>();
  let chars = "";
  for (const el of Array.from(svg.querySelectorAll("text, tspan"))) {
    const text = el.textContent ?? "";
    if (!text.trim()) continue;
    chars += text;
    const cs = view?.getComputedStyle(el);
    if (!cs) continue;
    const use: FontUse = {
      family: cs.fontFamily,
      weight: normalizeWeight(cs.fontWeight),
      style: cs.fontStyle || "normal",
    };
    seen.set(`${use.family}|${use.weight}|${use.style}`, use);
  }
  return { uses: [...seen.values()], chars };
}

/** Parses a unicode-range value into inclusive [start, end] pairs. */
export function parseUnicodeRange(range: string): [number, number][] {
  return range
    .split(",")
    .map((part) => part.trim().replace(/^u\+/i, ""))
    .filter(Boolean)
    .map((part): [number, number] => {
      if (part.includes("?")) {
        return [parseInt(part.replace(/\?/g, "0"), 16), parseInt(part.replace(/\?/g, "F"), 16)];
      }
      const [a, b] = part.split("-");
      return [parseInt(a!, 16), parseInt(b ?? a!, 16)];
    });
}

function covers(range: string | undefined, codePoints: number[]): boolean {
  if (!range) return true;
  const spans = parseUnicodeRange(range);
  return codePoints.some((cp) => spans.some(([lo, hi]) => cp >= lo && cp <= hi));
}

/**
 * The faces to embed: for each font in use, the first family in its stack
 * that the page declares, at the closest declared weight, limited to the
 * subsets that cover characters actually drawn.
 */
export function selectFaces(faces: FontFaceSource[], uses: FontUse[], chars: string): FontFaceSource[] {
  const codePoints = [...new Set([...chars].map((c) => c.codePointAt(0)!))];
  const picked = new Map<string, FontFaceSource>();
  for (const use of uses) {
    const stack = use.family.split(",").map(unquote);
    const family = stack.find((f) => faces.some((face) => face.family.toLowerCase() === f.toLowerCase()));
    if (!family) continue; // A system font: nothing to embed.
    const ofFamily = faces.filter(
      (f) => f.family.toLowerCase() === family.toLowerCase() && f.style === use.style,
    );
    if (!ofFamily.length) continue;
    const want = Number(use.weight);
    const weights = [...new Set(ofFamily.map((f) => f.weight))];
    const best = weights.reduce((a, b) => (Math.abs(Number(b) - want) < Math.abs(Number(a) - want) ? b : a));
    for (const face of ofFamily) {
      if (face.weight === best && covers(face.unicodeRange, codePoints)) picked.set(face.url, face);
    }
  }
  return [...picked.values()];
}

function base64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const mimeFor = (face: FontFaceSource) =>
  face.format === "woff" || face.url.endsWith(".woff")
    ? "font/woff"
    : face.format === "truetype" || face.url.endsWith(".ttf")
      ? "font/ttf"
      : "font/woff2";

/** @font-face rules with each font file inlined as a data: URL. */
export async function inlineFontFaceCss(faces: FontFaceSource[], fetcher: Fetcher = fetch): Promise<string> {
  const rules = await Promise.all(
    faces.map(async (face) => {
      const res = await fetcher(face.url);
      if (!res.ok) throw new Error(`Could not load font ${face.url}`);
      const data = base64(await res.arrayBuffer());
      const range = face.unicodeRange ? `unicode-range:${face.unicodeRange};` : "";
      return (
        `@font-face{font-family:"${face.family}";font-style:${face.style};font-weight:${face.weight};` +
        `src:url(data:${mimeFor(face)};base64,${data});${range}}`
      );
    }),
  );
  return rules.join("\n");
}
