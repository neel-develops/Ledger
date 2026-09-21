/**
 * Keypad arithmetic.
 *
 * The running value IS the paise amount. Pressing 1, 5, 0 walks it through
 * 1 → 15 → 150 paise, so the number in the UI and the number in the database
 * are the same integer. No float, no parsing step, nothing to round.
 */

const MAX_DIGITS = 11;

export function appendDigit(current: number, key: string): number {
  if (key === 'del') return Math.floor(current / 10);
  const digits = key === '00' ? '00' : key;
  if (!/^\d+$/.test(digits)) return current;

  const next = Number(`${current}${digits}`);
  if (!Number.isSafeInteger(next) || String(next).length > MAX_DIGITS) return current;
  return next;
}
