/**
 * Centralized pricing configuration for Rowie.
 * This file MUST be kept identical across all repos:
 *   - rowie-api/src/config/pricing.ts
 *   - rowie-vendor/lib/pricing.ts
 *   - rowie-marketing/lib/pricing-config.ts
 *   - rowie-app/src/lib/pricing.ts
 */

export const PRICING = {
  pro: {
    monthlyPriceCents: 2499,
    monthlyPriceDisplay: '€24.99',
    period: '/mo',
    transactionFeeRate: 0.028,
    transactionFeeFixedCents: 16,
    transactionFeeDisplay: '2.8% + $0.16 per tap',
    trialDays: 7,
  },
  starter: {
    monthlyPriceCents: 0,
    monthlyPriceDisplay: 'Free',
    period: '',
    transactionFeeRate: 0.029,
    transactionFeeFixedCents: 18,
    transactionFeeDisplay: '2.9% + $0.18 per tap',
    trialDays: 0,
  },
  referral: {
    commissionRate: 0.10,
    commissionDisplay: '10%',
    durationMonths: 12,
    payoutThresholdDisplay: '€1.00',
    clearingWindowDays: 30,
  },
} as const;
