/**
 * Shared language constants — kept identical across all repos:
 *   - rowie-app/src/lib/languages.ts
 *   - rowie-vendor/lib/languages.ts
 *   - rowie-marketing/lib/languages.ts (subset)
 */

export const SUPPORTED_LANGUAGES = [
  'en', 'es', 'fr', 'de', 'it', 'nl', 'pt', 'sv', 'da', 'no', 'fi', 'cs',
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  nl: 'Nederlands',
  pt: 'Português',
  sv: 'Svenska',
  da: 'Dansk',
  no: 'Norsk',
  fi: 'Suomi',
  cs: 'Čeština',
};

/** Map 2-letter country code to default language */
export const COUNTRY_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  US: 'en', GB: 'en', IE: 'en', AU: 'en', NZ: 'en', SG: 'en', MY: 'en', CA: 'en',
  ES: 'es',
  FR: 'fr', BE: 'fr', LU: 'fr',
  DE: 'de', AT: 'de', CH: 'de',
  IT: 'it',
  NL: 'nl',
  PT: 'pt',
  SE: 'sv',
  DK: 'da',
  NO: 'no',
  FI: 'fi',
  CZ: 'cs',
};
