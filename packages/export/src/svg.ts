const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** Elements carrying this attribute are editor-only and never exported. */
export const DIAGNOSTICS_LAYER_SELECTOR = '[data-entrypad-layer="diagnostics"]';

/** Inline style properties that only matter for live interaction. */
const INTERACTION_STYLE_PROPS = new Set([
  "cursor",
  "touch-action",
  "user-select",
  "-webkit-user-select",
  "pointer-events",
]);

/** Inherited text properties copied from the page onto the exported root. */
const INHERITED_TEXT_PROPS = ["font-family"];

/** Bookkeeping attributes the drag renderer adds to every element. */
const RENDERER_ATTRIBUTES = ["data-path"];

export interface SerializeSvgOptions {
  /**
   * Keep the diagnostics overlay (the squiggles). Off by default: exports
   * never show flags. Only tests and debugging should turn this on.
   */
  includeDiagnostics?: boolean;
  /** Paint a solid background behind the visual, e.g. "#ffffff". */
  background?: string;
  /** Prepend an XML declaration so the file opens cleanly as .svg. */
  xmlDeclaration?: boolean;
}

/**
 * Turns a rendered visual into a standalone SVG document. The live element is
 * not modified. The result depends only on attributes in the tree, so it looks
 * the same in a browser, PowerPoint or Keynote as long as the visual itself
 * uses presentation attributes or inline styles rather than page CSS.
 */
export function serializeSvg(svg: SVGSVGElement, options: SerializeSvgOptions = {}): string {
  const { includeDiagnostics = false, background, xmlDeclaration = true } = options;
  const clone = svg.cloneNode(true) as SVGSVGElement;

  if (!includeDiagnostics) {
    for (const el of Array.from(clone.querySelectorAll(DIAGNOSTICS_LAYER_SELECTOR))) {
      el.remove();
    }
  }

  for (const el of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
    stripInteractionStyles(el);
    for (const attr of RENDERER_ATTRIBUTES) el.removeAttribute(attr);
  }

  // Text styles the live SVG inherits from the page don't travel with the
  // file, so write the resolved values onto the root, where every layer
  // inherits them.
  const computed = svg.ownerDocument.defaultView?.getComputedStyle(svg);
  for (const prop of INHERITED_TEXT_PROPS) {
    const value = computed?.getPropertyValue(prop).trim();
    if (value && !clone.hasAttribute(prop)) clone.setAttribute(prop, value);
  }

  const { width, height } = measure(svg);
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("xmlns:xlink", XLINK_NS);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.hasAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  if (background) {
    const doc = clone.ownerDocument;
    const rect = doc.createElementNS(SVG_NS, "rect");
    rect.setAttribute("width", "100%");
    rect.setAttribute("height", "100%");
    rect.setAttribute("fill", background);
    clone.insertBefore(rect, clone.firstChild);
  }

  const body = new XMLSerializer().serializeToString(clone);
  return xmlDeclaration ? `<?xml version="1.0" encoding="UTF-8"?>\n${body}` : body;
}

/** Wraps serialized SVG text in a Blob with the right media type. */
export function svgBlob(svgText: string): Blob {
  return new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
}

/** A data: URL for serialized SVG text, e.g. for an <img> preview. */
export function svgDataUrl(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

function measure(svg: SVGSVGElement): { width: number; height: number } {
  const w = Number.parseFloat(svg.getAttribute("width") ?? "");
  const h = Number.parseFloat(svg.getAttribute("height") ?? "");
  if (Number.isFinite(w) && Number.isFinite(h)) return { width: w, height: h };
  const box = svg.getBoundingClientRect();
  return { width: Math.round(box.width), height: Math.round(box.height) };
}

function stripInteractionStyles(el: Element): void {
  const style = el.getAttribute("style");
  if (style === null) return;
  const kept = style
    .split(";")
    .map((decl) => decl.trim())
    .filter((decl) => {
      if (!decl) return false;
      const prop = decl.slice(0, decl.indexOf(":")).trim().toLowerCase();
      return !INTERACTION_STYLE_PROPS.has(prop);
    });
  if (kept.length) el.setAttribute("style", kept.join("; "));
  else el.removeAttribute("style");
}
