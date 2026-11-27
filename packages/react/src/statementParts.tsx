import type { Book } from "@entrypad/core";
import { memo } from "react";
import type { CSSProperties } from "react";
import type { Theme } from "./theme.js";

/**
 * Pieces the statement visuals share: the three-line heading, dates written
 * out the way statements write them, and text fitting. Everything here is
 * plain SVG drawn by React, never walked by Dragology.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-01-31" -> "January 31, 2026". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The first and last dates the shown entries cover: the book's period, cut short by a step-through. */
export function statementDates(book: Book, at?: number): { start?: string; end?: string } {
  const dated = (entries: Book["entries"]) => entries.map((e) => e.date).filter((d): d is string => d !== undefined);
  const all = dated(book.entries);
  const start = book.period?.start ?? all[0];
  const partial = at !== undefined && at < book.entries.length;
  const end = partial ? (dated(book.entries.slice(0, Math.max(0, at))).at(-1) ?? start) : (book.period?.end ?? all.at(-1));
  return { ...(start !== undefined && { start }), ...(end !== undefined && { end }) };
}

/** The date line of a statement that covers a period: "For the month ended January 31, 2026". */
export function periodLine(start: string | undefined, end: string | undefined): string | undefined {
  if (!start || !end) return end ? longDate(end) : undefined;
  if (end <= start) return longDate(end);
  const [sy, sm, sd] = start.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = end.split("-").map(Number) as [number, number, number];
  if (sd === 1 && ed === lastDayOf(ey, em)) {
    const months = (ey - sy) * 12 + (em - sm) + 1;
    if (months === 1) return `For the month ended ${longDate(end)}`;
    if (months === 3) return `For the quarter ended ${longDate(end)}`;
    if (months === 12) return `For the year ended ${longDate(end)}`;
  }
  const from = longDate(start);
  return sy === ey ? `For the period ${from.slice(0, from.lastIndexOf(","))} to ${longDate(end)}` : `For the period ${from} to ${longDate(end)}`;
}

/**
 * Roughly how wide a piece of text is in the visuals' typeface (Source Sans
 * 3), in SVG units. Generous on purpose: it is only used to decide when to
 * shorten a label, and a label shortened a little early is better than one
 * running into its amount.
 */
export function textWidth(text: string, fontSize: number, bold = false): number {
  let units = 0;
  for (const ch of text) units += ch === " " ? 0.22 : /[ijlrtfI.,:;'’!|()]/.test(ch) ? 0.3 : /[mwMW]/.test(ch) ? 0.8 : /[A-Z]/.test(ch) ? 0.58 : 0.49;
  return units * fontSize * (bold ? 1.05 : 1);
}

/** The text, shortened with an ellipsis if it would be wider than `max`. */
export function fitText(text: string, max: number, fontSize: number, bold = false): string {
  if (textWidth(text, fontSize, bold) <= max) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(cut + "…", fontSize, bold) > max) cut = cut.slice(0, -1);
  return cut.trimEnd() + "…";
}

/** Width of an amount column wide enough for every figure in it, with tabular digits. */
export function amountColumn(texts: readonly string[], fontSize = 12): number {
  // Tabular digits are half an em wide; commas, points and parentheses much less.
  const widest = texts.reduce((w, t) => Math.max(w, [...t].reduce((u, ch) => u + (/\d/.test(ch) ? 0.51 : 0.27), 0)), 0);
  return Math.max(40, Math.ceil(widest * fontSize) + 4);
}

export const FIGURES: CSSProperties = { fontVariantNumeric: "tabular-nums" };

/** Visually hidden, still read by screen readers. */
export const SR_ONLY: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** Statement geometry, in SVG units. */
export const ROW_H = 18;
export const SIDE = 14;
export const INDENT = 12;
const HEAD_LINE = 15.5;

/** The lines of a statement heading: the entity, the statement, and its date. */
export function headingLines(book: Book, title: string, date: string | undefined): string[] {
  return [book.name, title, date].filter((s): s is string => !!s);
}

/** Where the first row's baseline sits under a heading of this many lines. */
export const firstBaseline = (lines: number) => 22 + (lines - 1) * HEAD_LINE + 31;

interface HeadingProps {
  lines: readonly string[];
  /** True when the first line is the entity's name rather than the statement's title. */
  named: boolean;
  width: number;
  theme: Theme;
}

/** The centred heading every statement opens with, and the rule under it. */
export const StatementHeading = memo(function StatementHeading({ lines, named, width, theme }: HeadingProps) {
  const ruleY = 22 + (lines.length - 1) * HEAD_LINE + 10;
  return (
    <g>
      {lines.map((line, i) => {
        const isName = named && i === 0;
        const isDate = i === lines.length - 1 && lines.length > (named ? 2 : 1);
        const size = isName ? 13 : isDate ? 11.5 : 12.5;
        return (
          <text
            key={i}
            x={width / 2}
            y={22 + i * HEAD_LINE}
            textAnchor="middle"
            fontSize={size}
            fontWeight={isDate ? 400 : 600}
            fill={isDate ? theme.muted : theme.ink}
          >
            {fitText(line, width - 2 * SIDE, size, !isDate)}
          </text>
        );
      })}
      <line x1={SIDE} y1={ruleY} x2={width - SIDE} y2={ruleY} stroke={theme.border} />
    </g>
  );
});

/** A single rule over an amount column, drawn above the row whose baseline is `y`. */
export function ruleAbove(right: number, colW: number, y: number, theme: Theme, key?: string) {
  return <line key={key} x1={right - colW} y1={y - 13.5} x2={right} y2={y - 13.5} stroke={theme.ink} strokeWidth={0.9} />;
}

/** The double rule under a final total whose baseline is `y`. */
export function doubleBelow(right: number, colW: number, y: number, theme: Theme, key?: string) {
  return (
    <g key={key}>
      <line x1={right - colW} y1={y + 4} x2={right} y2={y + 4} stroke={theme.ink} strokeWidth={0.9} />
      <line x1={right - colW} y1={y + 6.5} x2={right} y2={y + 6.5} stroke={theme.ink} strokeWidth={0.9} />
    </g>
  );
}
