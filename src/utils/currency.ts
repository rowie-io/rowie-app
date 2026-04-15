/**
 * Shared currency formatting utilities for rowie-app.
 *
 * Zero-decimal currencies (JPY, KRW, etc.) have no fractional units.
 * Intl.NumberFormat handles decimal places and symbols automatically.
 */

const ZERO_DECIMAL_CURRENCIES = [
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
];

export function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.includes(currency.toLowerCase());
}

/**
 * Active formatting locale. Set by LanguageProvider on mount and on language
 * change so currency formatting uses the user's language for thousand/decimal
 * separators (German users see "1.234,56 €", US users see "$1,234.56").
 *
 * Module-level state instead of a hook so the pure formatCurrency() function
 * can be called from anywhere (not just React components).
 */
let activeLocale = 'en-US';

export function setCurrencyLocale(locale: string): void {
  if (locale && typeof locale === 'string') {
    activeLocale = locale;
  }
}

export function getCurrencyLocale(): string {
  return activeLocale;
}

export function fromSmallestUnit(amount: number, currency: string): number {
  return isZeroDecimal(currency) ? amount : amount / 100;
}

export function toSmallestUnit(amount: number, currency: string): number {
  return isZeroDecimal(currency) ? Math.round(amount) : Math.round(amount * 100);
}

/**
 * Format a base-unit monetary amount (e.g. dollars, yen) for display.
 *
 * @param amount - Amount in base currency unit (4.50 for $4.50, 1099 for ¥1099)
 * @param currency - 3-letter ISO currency code (default: 'usd')
 */
export function formatCurrency(amount: number, currency: string = 'usd'): string {
  const code = (currency || 'usd').toUpperCase();
  const zd = isZeroDecimal(code.toLowerCase());
  try {
    const result = new Intl.NumberFormat(activeLocale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: zd ? 0 : 2,
      maximumFractionDigits: zd ? 0 : 2,
    }).format(amount);
    return result;
  } catch (err) {
    // Hermes/older RN may fail on uncommon currencies — fall back to a simple
    // symbol + fixed-decimal format.
    const symbol = CURRENCY_SYMBOLS[code] || code;
    return `${symbol}${zd ? amount.toFixed(0) : amount.toFixed(2)}`;
  }
}

/**
 * Format an amount in Stripe's smallest unit (cents for USD, yen for JPY).
 * Converts to base unit first, then formats.
 *
 * Use for: cart amounts, order totals, Stripe transaction amounts.
 */
export function formatCents(cents: number, currency: string = 'usd'): string {
  const zd = isZeroDecimal(currency);
  return formatCurrency(zd ? cents : cents / 100, currency);
}

/**
 * Common currency symbols. Hermes (React Native) has limited Intl.formatToParts
 * support, so we use a lookup table for reliability.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'CA$', AUD: 'A$',
  NZD: 'NZ$', CHF: 'CHF', SEK: 'kr', NOK: 'kr', DKK: 'kr',
  SGD: 'S$', MYR: 'RM', CZK: 'Kč', PLN: 'zł', HUF: 'Ft',
  BRL: 'R$', MXN: 'MX$', INR: '₹', KRW: '₩', THB: '฿',
  PHP: '₱', IDR: 'Rp', ZAR: 'R', TRY: '₺', ILS: '₪',
  AED: 'د.إ', SAR: '﷼', HKD: 'HK$', TWD: 'NT$', CNY: '¥',
};

/**
 * Get the currency symbol for a currency code.
 */
export function getCurrencySymbol(currency: string = 'usd'): string {
  const code = (currency || 'usd').toUpperCase();
  return CURRENCY_SYMBOLS[code] || code;
}
