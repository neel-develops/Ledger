/**
 * Money is ALWAYS an integer number of paise. ₹150.50 === 15050.
 *
 * Floating point is never used for arithmetic on money. The only place a
 * fractional value is tolerated is at the parse boundary (user typed "150.5"),
 * and it is rounded to paise immediately and irreversibly.
 */

export type Paise = number;

/** Largest amount we accept: ₹10,00,00,00,000 (10 billion rupees) in paise. */
export const MAX_PAISE = 1_000_000_000_000;

export class MoneyError extends Error {}

export function isPaise(value: unknown): value is Paise {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_PAISE;
}

export function assertPaise(value: unknown, label = 'amount'): Paise {
  if (!isPaise(value)) throw new MoneyError(`${label} must be an integer number of paise`);
  return value;
}

/**
 * JavaScript has two zeros and `-0` leaks into money the moment you negate a
 * balance that happens to be settled — which would render as "-₹0". Every
 * arithmetic helper here collapses it.
 */
export function normalizeZero(value: Paise): Paise {
  return value === 0 ? 0 : value;
}

/** Negate a money value without producing `-0`. */
export function negatePaise(value: Paise): Paise {
  return normalizeZero(-assertPaise(value));
}

/** Sum with overflow protection. Never use `.reduce((a, b) => a + b)` on money directly. */
export function sumPaise(values: readonly Paise[]): Paise {
  let total = 0;
  for (const v of values) {
    total += assertPaise(v);
    if (!Number.isSafeInteger(total)) throw new MoneyError('money overflow');
  }
  return normalizeZero(total);
}

/**
 * Parse user input ("1,250.75", "₹1250.75", "1250") into paise.
 * Returns null for anything that is not a clean amount.
 */
export function parseRupeesToPaise(input: string | number | null | undefined): Paise | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim().replace(/[₹,\s]/g, '');
  if (raw === '' || !/^-?\d*(\.\d{0,2})?$/.test(raw)) return null;
  if (raw === '-' || raw === '.' || raw === '-.') return null;

  const negative = raw.startsWith('-');
  const [whole = '0', frac = ''] = raw.replace('-', '').split('.');
  const paise = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(paise) || paise > MAX_PAISE) return null;
  return negative ? -paise : paise;
}

/** `15050` -> `"150.50"`. Pure string math, no float division. */
export function paiseToDecimalString(paise: Paise): string {
  assertPaise(paise);
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${String(frac).padStart(2, '0')}`;
}

export interface FormatOptions {
  /** Drop ".00" on whole-rupee amounts. Default true. */
  compactPaise?: boolean;
  /** Prefix with ₹. Default true. */
  symbol?: boolean;
  /** Always show a leading + for positive values. Default false. */
  signed?: boolean;
}

/** `15050` -> `"₹150.50"`; `150000` -> `"₹1,500"` (Indian digit grouping). */
export function formatPaise(paise: Paise, options: FormatOptions = {}): string {
  const { compactPaise = true, symbol = true, signed = false } = options;
  assertPaise(paise);

  const normalized = normalizeZero(paise);
  const sign = normalized < 0 ? '-' : signed && normalized > 0 ? '+' : '';
  const abs = Math.abs(normalized);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;

  const body = groupIndian(whole);
  const tail = compactPaise && frac === 0 ? '' : `.${String(frac).padStart(2, '0')}`;

  return `${sign}${symbol ? '₹' : ''}${body}${tail}`;
}

/** 1234567 -> "12,34,567" (lakh/crore grouping). */
export function groupIndian(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/**
 * Split an amount between N shares without losing or inventing a single paisa.
 * Remainder paise are distributed to the earliest shares.
 */
export function splitEvenly(total: Paise, parts: number): Paise[] {
  assertPaise(total);
  if (!Number.isInteger(parts) || parts < 1) throw new MoneyError('parts must be >= 1');
  const base = Math.trunc(total / parts);
  const remainder = total - base * parts;
  const out: Paise[] = [];
  for (let i = 0; i < parts; i++) out.push(base + (i < Math.abs(remainder) ? Math.sign(remainder) : 0));
  return out;
}

/** The "—" the UI shows when a real value is not yet known. Never a fake number. */
export const NO_VALUE = '—';
