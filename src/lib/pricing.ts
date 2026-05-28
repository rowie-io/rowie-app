/**
 * Centralized pricing configuration for Rowie.
 * This file MUST be kept identical across all repos:
 *   - rowie-api/src/config/pricing.ts
 *   - rowie-vendor/lib/pricing.ts
 *   - rowie-marketing/lib/pricing-config.ts
 *   - rowie-app/src/lib/pricing.ts
 */

// Per-ticket platform fee charged to the customer via gross-up (vendor nets
// the ticket subtotal). Values are in the smallest currency unit.
//
// Major currencies are flat at 75 subunits (a clean "0.75 of your money"
// headline — $0.75, €0.75, £0.75, etc.). Small-unit currencies (SEK/NOK/DKK/
// CZK/HUF) where 0.75 of the major unit would be a few cents are scaled to
// land at roughly $0.75 USD equivalent instead.
// Currencies not listed fall back to PRICING.events.ticketFeeDefaultCents.
const TICKET_FEE_BY_CURRENCY: Record<string, number> = {
  usd: 75,    // $0.75
  eur: 75,    // €0.75
  gbp: 75,    // £0.75
  cad: 75,    // C$0.75
  aud: 75,    // A$0.75
  nzd: 75,    // NZ$0.75
  sgd: 75,    // S$0.75
  myr: 75,    // RM 0.75
  chf: 75,    // 0.75 CHF
  pln: 75,    // 0.75 PLN
  ron: 75,    // 0.75 RON
  sek: 800,   // 8 SEK   — scaled (1 SEK ≈ $0.09)
  nok: 800,   // 8 NOK   — scaled (1 NOK ≈ $0.09)
  dkk: 525,   // 5.25 DKK — scaled (1 DKK ≈ $0.14)
  czk: 1700,  // 17 Kč    — scaled (1 CZK ≈ $0.04)
  huf: 28000, // 280 HUF  — scaled (1 HUF ≈ $0.003)
};

// Region-aware Pro monthly price display. Stripe holds a multi-currency price
// (price_1Tby…) with matching 29.99 amounts in USD/EUR/GBP. Currencies not
// listed fall back to the USD display + USD charge.
const PRO_PRICE_BY_CURRENCY: Record<string, string> = {
  usd: '$29.99',
  eur: '€29.99',
  gbp: '£29.99',
};

export const PRICING = {
  pro: {
    monthlyPriceCents: 2999,
    monthlyPriceDisplay: '$29.99',
    monthlyPriceByCurrency: PRO_PRICE_BY_CURRENCY,
    period: '/mo',
    transactionFeeRate: 0.028,
    transactionFeeFixedCents: 15,
    transactionFeeDisplay: '', // Computed dynamically per country — see stripe-rates.ts
    trialDays: 7,
  },
  starter: {
    monthlyPriceCents: 0,
    monthlyPriceDisplay: 'Free',
    period: '',
    transactionFeeRate: 0.029,
    transactionFeeFixedCents: 17,
    transactionFeeDisplay: '', // Computed dynamically per country — see stripe-rates.ts
    trialDays: 0,
  },
  referral: {
    commissionRate: 0.10,
    commissionDisplay: '10%',
    durationMonths: 12,
    payoutThresholdDisplay: '€1.00',
    clearingWindowDays: 30,
  },
  events: {
    ticketFeeDefaultCents: 75,
    ticketFeeByCurrency: TICKET_FEE_BY_CURRENCY,
    ticketFeeDisplay: '$0.75 per ticket',
  },
} as const;

/** Region-aware Pro monthly price display string, falling back to USD. */
export function getProMonthlyDisplay(currency?: string | null): string {
  const c = (currency ?? 'usd').toLowerCase();
  return PRO_PRICE_BY_CURRENCY[c] ?? PRICING.pro.monthlyPriceDisplay;
}

/**
 * Returns the per-ticket platform fee in the smallest currency unit for a
 * given org currency, falling back to PRICING.events.ticketFeeDefaultCents
 * when the currency isn't explicitly mapped.
 */
export function getTicketFeeCents(currency: string | null | undefined): number {
  const c = (currency ?? 'usd').toLowerCase();
  return TICKET_FEE_BY_CURRENCY[c] ?? PRICING.events.ticketFeeDefaultCents;
}
