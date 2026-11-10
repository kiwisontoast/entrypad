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
  let text = whole.toLocaleString("en-US");
  if (decimals === 2) {
    text += "." + String(frac).padStart(2, "0");
  } else if (frac >= 50) {
    // Round half up for whole-dollar display only; stored values stay exact.
    text = (whole + 1).toLocaleString("en-US");
  }
  return cents < 0 ? `(${text})` : text;
}
