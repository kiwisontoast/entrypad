/** Converts a whole-dollar or decimal amount to integer cents. */
export function toCents(dollars: number): number {
  const cents = Math.round(dollars * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Amount out of range: ${dollars}`);
  }
  return cents;
}

/**
 * Formats integer cents for display, e.g. 120000 -> "1,200" with 0 decimals,
 * or "1,200.00" with 2. Negative amounts use parentheses, as on a statement.
 */
export function formatCents(cents: number, decimals: 0 | 2 = 0): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let text: string;
  if (decimals === 2) {
    text = groupThousands(whole) + "." + String(frac).padStart(2, "0");
  } else {
    // Round half up for whole-dollar display only; stored values stay exact.
    text = groupThousands(frac >= 50 ? whole + 1 : whole);
  }
  return cents < 0 ? `(${text})` : text;
}

/**
 * A whole number with comma thousands separators, e.g. 1234567 -> "1,234,567".
 * Written out by hand because `toLocaleString` builds a number formatter on
 * every call, and a drag formats thousands of amounts on its first frame.
 */
export function groupThousands(n: number): string {
  const digits = String(n);
  if (digits.length <= 3) return digits;
  const head = digits.length % 3 || 3;
  let out = digits.slice(0, head);
  for (let i = head; i < digits.length; i += 3) out += "," + digits.slice(i, i + 3);
  return out;
}
