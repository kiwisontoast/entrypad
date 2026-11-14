import type { EntrypadSettings } from "../settings.js";

export type AmountResult =
  | { ok: true; cents: number; negative: boolean }
  /** `problem` completes the sentence "<amount> ...", for the diagnostic message. */
  | { ok: false; problem: string };

/**
 * The shape of an amount: optional sign or parentheses, optional $, digits
 * with commas and a decimal point, and an optional k. Anything with this
 * shape is read as an amount, so a malformed one is flagged rather than
 * swallowed into the account name.
 */
const SHAPE = /^(\()?(-)?(\$)?(-)?((?:[0-9][0-9,]*)?(?:\.[0-9]*)?)([kK])?(\))?$/;

/** True when a word should be read as an amount, valid or not. */
export function looksLikeAmount(word: string): boolean {
  const m = SHAPE.exec(word);
  return !!m && /[0-9]/.test(m[5]!);
}

/**
 * Reads an amount into integer cents. The sign is reported separately: the
 * caller decides what a negative amount means (`parsing.negativeAmounts`).
 */
export function parseAmount(word: string, settings: Pick<EntrypadSettings, "parsing">): AmountResult {
  const m = SHAPE.exec(word);
  if (!m || !/[0-9]/.test(m[5]!)) return { ok: false, problem: "isn't a number" };
  const [, open, minus1, , minus2, number, k, close] = m;
  if (!!open !== !!close) return { ok: false, problem: "has an unmatched parenthesis" };
  if (minus1 && minus2) return { ok: false, problem: "has two minus signs" };
  if (open && (minus1 || minus2)) return { ok: false, problem: "is both negative and in parentheses" };
  if (k && !settings.parsing.thousandsSuffix) {
    return { ok: false, problem: "uses k for thousands, which is turned off" };
  }

  const dot = number!.indexOf(".");
  const whole = dot === -1 ? number! : number!.slice(0, dot);
  const fraction = dot === -1 ? "" : number!.slice(dot + 1);
  if (dot !== -1 && fraction === "") return { ok: false, problem: "ends with a decimal point" };
  if (whole.includes(",") && !/^[0-9]{1,3}(,[0-9]{3})+$/.test(whole)) {
    return { ok: false, problem: "has misplaced commas" };
  }

  // With k the value is multiplied by 1,000, so up to five decimal places
  // still leave at most two.
  const places = k ? 5 : 2;
  if (fraction.length > places) {
    return { ok: false, problem: k ? "has more than two decimal places once multiplied by 1,000" : "has more than two decimal places" };
  }
  const digits = whole.replace(/,/g, "") + fraction.padEnd(places, "0");
  const cents = Number(digits || "0");
  if (!Number.isSafeInteger(cents)) return { ok: false, problem: "is too large" };
  return { ok: true, cents, negative: !!(open || minus1 || minus2) };
}
