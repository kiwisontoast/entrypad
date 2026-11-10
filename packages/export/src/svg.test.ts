// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { serializeSvg } from "./svg.js";

function render(markup: string): SVGSVGElement {
  document.body.innerHTML = markup;
  return document.querySelector("svg") as SVGSVGElement;
}

const markup = `
  <svg width="300" height="200" style="overflow: visible; user-select: none; touch-action: none">
    <g id="t-cash" transform="translate(10, 20)" style="cursor: grab" data-path="t-cash/">
      <rect width="100" height="80" fill="#fff" data-path="t-cash/0/" />
      <text>Cash</text>
    </g>
    <g id="diagnostics" data-entrypad-layer="diagnostics">
      <path d="M0 0 q 2 -2 4 0" stroke="#cf222e" />
    </g>
  </svg>`;

describe("serializeSvg", () => {
  it("drops the diagnostics layer by default", () => {
    const out = serializeSvg(render(markup));
    expect(out).not.toContain("diagnostics");
    expect(out).toContain('id="t-cash"');
  });

  it("keeps diagnostics when asked", () => {
    expect(serializeSvg(render(markup), { includeDiagnostics: true })).toContain(
      'data-entrypad-layer="diagnostics"',
    );
  });

  it("produces a standalone document", () => {
    const out = serializeSvg(render(markup));
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('viewBox="0 0 300 200"');
  });

  it("removes interaction-only styles and keeps the rest", () => {
    const out = serializeSvg(render(markup));
    expect(out).not.toMatch(/cursor|touch-action|user-select/);
    expect(out).not.toContain("data-path");
    expect(out).toContain("overflow: visible");
  });

  it("leaves the live element untouched", () => {
    const svg = render(markup);
    serializeSvg(svg);
    expect(svg.querySelector('[data-entrypad-layer="diagnostics"]')).not.toBeNull();
    expect(svg.querySelector("#t-cash")?.getAttribute("style")).toBe("cursor: grab");
  });

  it("adds a background when asked", () => {
    expect(serializeSvg(render(markup), { background: "#ffffff" })).toContain('fill="#ffffff"');
  });
});
