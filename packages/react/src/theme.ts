/** The default presentation theme. Plain values so exports need no CSS. */
export const theme = {
  font: 'Inter, "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
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
