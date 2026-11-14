import { looksLikeAmount } from "./amount.js";
import { isSpace } from "./text.js";

/** A span of a line: offsets within the line's text. */
export interface Span {
  from: number;
  to: number;
}

export const skipSpaces = (text: string, i: number, to = text.length) => {
  while (i < to && isSpace(text[i])) i++;
  return i;
};
export const backSpaces = (text: string, i: number, from = 0) => {
  while (i > from && isSpace(text[i - 1])) i--;
  return i;
};

/** Splits off the last word of a span, when there is more than one. */
export function lastWord(text: string, span: Span): { word: Span; rest: Span } | undefined {
  const to = backSpaces(text, span.to, span.from);
  let i = to;
  while (i > span.from && !isSpace(text[i - 1])) i--;
  if (i === span.from) return undefined;
  return { word: { from: i, to }, rest: { from: span.from, to: backSpaces(text, i, span.from) } };
}

export type NameResult = { ok: true; name: string; span: Span } | { ok: false; problem: string };

/**
 * Reads an account name filling the whole span: either a quoted name or
 * plain words. The span must already be trimmed.
 */
export function readName(text: string, span: Span): NameResult {
  if (span.from >= span.to) return { ok: false, problem: "This line has no account name." };
  if (text[span.from] !== '"') return { ok: true, name: text.slice(span.from, span.to), span };
  const close = text.indexOf('"', span.from + 1);
  if (close === -1 || close >= span.to) return { ok: false, problem: "This quoted account name has no closing quote." };
  if (close !== span.to - 1) return { ok: false, problem: "Only an amount can follow a quoted account name." };
  const name = text.slice(span.from + 1, close).trim();
  if (!name) return { ok: false, problem: "This quoted account name is empty." };
  return { ok: true, name, span };
}

export interface AccountAndAmount {
  name: string;
  nameSpan: Span;
  /** The amount as written, if there is one; it may still be invalid. */
  amount?: Span;
}

/**
 * Reads `<account> [<amount>]` from a trimmed span. The amount is the last
 * word when it is shaped like one; everything before it is the name.
 */
export function readAccountAndAmount(text: string, span: Span): { ok: true; value: AccountAndAmount } | { ok: false; problem: string } {
  // A lone amount with no name.
  if (looksLikeAmount(text.slice(span.from, span.to))) return { ok: false, problem: "This line has an amount but no account name." };
  const split = lastWord(text, span);
  let nameSpan = span;
  let amount: Span | undefined;
  if (split && looksLikeAmount(text.slice(split.word.from, split.word.to))) {
    nameSpan = split.rest;
    amount = split.word;
  }
  const name = readName(text, nameSpan);
  if (!name.ok) return name;
  return { ok: true, value: { name: name.name, nameSpan, ...(amount && { amount }) } };
}

export interface Token {
  text: string;
  quoted: boolean;
  span: Span;
}

/** Splits a span into words and double-quoted strings. Returns undefined on an unclosed quote. */
export function tokenize(text: string, span: Span): Token[] | undefined {
  const tokens: Token[] = [];
  let i = skipSpaces(text, span.from, span.to);
  while (i < span.to) {
    if (text[i] === '"') {
      const close = text.indexOf('"', i + 1);
      if (close === -1 || close >= span.to) return undefined;
      tokens.push({ text: text.slice(i + 1, close), quoted: true, span: { from: i, to: close + 1 } });
      i = close + 1;
    } else {
      const start = i;
      while (i < span.to && !isSpace(text[i])) i++;
      tokens.push({ text: text.slice(start, i), quoted: false, span: { from: start, to: i } });
    }
    i = skipSpaces(text, i, span.to);
  }
  return tokens;
}
