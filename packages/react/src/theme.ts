/**
 * The default presentation theme. Plain values so exports need no CSS.
 * The fonts are loaded by the host page; exports embed them (see
 * serializeSvgWithFonts). Keep the stacks in step with the site's typography.css.
 */
export const theme = {
  /** Text and figures in every visual. */
  font: '"Source Sans 3", "Segoe UI", system-ui, -apple-system, Helvetica, Arial, sans-serif',
  headingFont: 'Spectral, Georgia, "Times New Roman", serif',
  monoFont: '"Source Code Pro", ui-monospace, Consolas, "SF Mono", Menlo, monospace',
  canvas: "#f6f7f9",
  surface: "#ffffff",
  ink: "#1f2328",
  muted: "#656d76",
  border: "#d0d7de",
  accent: "#0b5cad",
  accentSoft: "#e3effb",
  error: "#c62828",
  warning: "#b26a00",
  hint: "#0b5cad",
} as const;

export type Theme = typeof theme;
