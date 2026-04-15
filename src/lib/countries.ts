/**
 * Centralized supported countries configuration for Rowie.
 * This file MUST be kept identical across all repos:
 *   - rowie-api/src/config/countries.ts
 *   - rowie-vendor/lib/countries.ts
 *   - rowie-marketing/lib/countries.ts
 *   - rowie-app/src/lib/countries.ts
 *
 * Used for: signup country selector, FAQ, rates page, phone input defaults,
 * org currency/timezone defaults, and anywhere countries are referenced.
 */

export interface Country {
  /** ISO 3166-1 alpha-2 */
  code: string;
  /** English display name */
  name: string;
  /** ISO 4217 currency code (Stripe settlement currency) */
  currency: string;
  /** IANA timezone (org default at signup) */
  timezone: string;
}

/**
 * All countries where a vendor can create a Rowie account.
 * Sorted alphabetically by name.
 */
export const COUNTRIES: Country[] = [
  // Oceania
  { code: 'AU', name: 'Australia', currency: 'aud', timezone: 'Australia/Sydney' },
  // Europe — EUR
  { code: 'AT', name: 'Austria', currency: 'eur', timezone: 'Europe/Vienna' },
  { code: 'BE', name: 'Belgium', currency: 'eur', timezone: 'Europe/Brussels' },
  { code: 'BG', name: 'Bulgaria', currency: 'eur', timezone: 'Europe/Sofia' },
  // North America
  { code: 'CA', name: 'Canada', currency: 'cad', timezone: 'America/Toronto' },
  // Europe — EUR
  { code: 'HR', name: 'Croatia', currency: 'eur', timezone: 'Europe/Zagreb' },
  { code: 'CY', name: 'Cyprus', currency: 'eur', timezone: 'Asia/Nicosia' },
  // Europe — non-EUR
  { code: 'CZ', name: 'Czechia', currency: 'czk', timezone: 'Europe/Prague' },
  { code: 'DK', name: 'Denmark', currency: 'dkk', timezone: 'Europe/Copenhagen' },
  // Europe — EUR
  { code: 'EE', name: 'Estonia', currency: 'eur', timezone: 'Europe/Tallinn' },
  { code: 'FI', name: 'Finland', currency: 'eur', timezone: 'Europe/Helsinki' },
  { code: 'FR', name: 'France', currency: 'eur', timezone: 'Europe/Paris' },
  { code: 'DE', name: 'Germany', currency: 'eur', timezone: 'Europe/Berlin' },
  // Europe — non-EUR
  { code: 'HU', name: 'Hungary', currency: 'huf', timezone: 'Europe/Budapest' },
  // Europe — EUR
  { code: 'IE', name: 'Ireland', currency: 'eur', timezone: 'Europe/Dublin' },
  { code: 'IT', name: 'Italy', currency: 'eur', timezone: 'Europe/Rome' },
  { code: 'LV', name: 'Latvia', currency: 'eur', timezone: 'Europe/Riga' },
  // Europe — non-EUR
  { code: 'LI', name: 'Liechtenstein', currency: 'chf', timezone: 'Europe/Vaduz' },
  // Europe — EUR
  { code: 'LT', name: 'Lithuania', currency: 'eur', timezone: 'Europe/Vilnius' },
  { code: 'LU', name: 'Luxembourg', currency: 'eur', timezone: 'Europe/Luxembourg' },
  // Asia
  { code: 'MY', name: 'Malaysia', currency: 'myr', timezone: 'Asia/Kuala_Lumpur' },
  // Europe — EUR
  { code: 'MT', name: 'Malta', currency: 'eur', timezone: 'Europe/Malta' },
  { code: 'NL', name: 'Netherlands', currency: 'eur', timezone: 'Europe/Amsterdam' },
  // Oceania
  { code: 'NZ', name: 'New Zealand', currency: 'nzd', timezone: 'Pacific/Auckland' },
  // Europe — non-EUR
  { code: 'NO', name: 'Norway', currency: 'nok', timezone: 'Europe/Oslo' },
  // Europe — EUR
  { code: 'PL', name: 'Poland', currency: 'pln', timezone: 'Europe/Warsaw' },
  { code: 'PT', name: 'Portugal', currency: 'eur', timezone: 'Europe/Lisbon' },
  { code: 'RO', name: 'Romania', currency: 'ron', timezone: 'Europe/Bucharest' },
  // Asia
  { code: 'SG', name: 'Singapore', currency: 'sgd', timezone: 'Asia/Singapore' },
  // Europe — EUR
  { code: 'SK', name: 'Slovakia', currency: 'eur', timezone: 'Europe/Bratislava' },
  { code: 'SI', name: 'Slovenia', currency: 'eur', timezone: 'Europe/Ljubljana' },
  { code: 'ES', name: 'Spain', currency: 'eur', timezone: 'Europe/Madrid' },
  // Europe — non-EUR
  { code: 'SE', name: 'Sweden', currency: 'sek', timezone: 'Europe/Stockholm' },
  { code: 'CH', name: 'Switzerland', currency: 'chf', timezone: 'Europe/Zurich' },
  // Europe — GBP
  { code: 'GB', name: 'United Kingdom', currency: 'gbp', timezone: 'Europe/London' },
  // North America
  { code: 'US', name: 'United States', currency: 'usd', timezone: 'America/New_York' },
] as const;

/** Set of all supported country codes for quick lookups */
export const COUNTRY_CODES = new Set(COUNTRIES.map(c => c.code));

/** Lookup country by code */
export function getCountry(code: string): Country | undefined {
  return COUNTRIES.find(c => c.code === code.toUpperCase());
}

/** Get default currency for a country code. Falls back to 'eur'. */
export function getCurrencyForCountry(code: string): string {
  return getCountry(code)?.currency || 'eur';
}

/** Get default timezone for a country code. Falls back to 'Europe/London'. */
export function getTimezoneForCountry(code: string): string {
  return getCountry(code)?.timezone || 'Europe/London';
}

/** All country names as a comma-separated string (for FAQ / display). */
export const COUNTRY_NAMES_LIST = COUNTRIES.map(c => c.name).join(', ');

/** Total number of supported countries */
export const COUNTRY_COUNT = COUNTRIES.length;

/**
 * Pre-computed combined Tap to Pay rates (Stripe + Rowie) per currency for display.
 * Used by the app signup screen and anywhere rates need to be shown without an API call.
 *
 * IMPORTANT: Update these when stripe-rates or platform-fees change.
 */
const TTP_DISPLAY_RATES: Record<string, { starter: string; pro: string }> = {
  usd: { starter: '2.9% + $0.18', pro: '2.8% + $0.16' },
  cad: { starter: '2.9% + $0.23', pro: '2.8% + $0.21' },
  gbp: { starter: '2.2% + £0.25', pro: '1.8% + £0.22' },
  eur: { starter: '2.2% + €0.25', pro: '1.8% + €0.22' },
  aud: { starter: '2.15% + A$0.18', pro: '2.05% + A$0.16' },
  nzd: { starter: '2.8% + NZ$0.23', pro: '2.7% + NZ$0.21' },
  sek: { starter: '2.2% + 2.60kr', pro: '1.8% + 2.27kr' },
  dkk: { starter: '2.2% + 1.83kr', pro: '1.8% + 1.60kr' },
  nok: { starter: '2.2% + 2.60kr', pro: '1.8% + 2.27kr' },
  chf: { starter: '2.2% + CHF0.25', pro: '1.8% + CHF0.22' },
  czk: { starter: '2.2% + 5.70Kč', pro: '1.8% + 4.95Kč' },
  pln: { starter: '2.2% + 0.60zł', pro: '1.8% + 0.48zł' },
  huf: { starter: '2.2% + 80Ft', pro: '1.8% + 68Ft' },
  ron: { starter: '2.2% + 1.00lei', pro: '1.8% + 0.85lei' },
  sgd: { starter: '3.6% + S$0.68', pro: '3.5% + S$0.66' },
  myr: { starter: '3.0% + RM0.98', pro: '2.9% + RM0.96' },
};

/** Get the combined TTP rate display string for a country and tier. */
export function getTTPDisplayRate(countryCode: string, tier: 'starter' | 'pro'): string {
  const currency = getCurrencyForCountry(countryCode);
  return TTP_DISPLAY_RATES[currency]?.[tier] || TTP_DISPLAY_RATES.eur[tier];
}
