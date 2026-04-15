/**
 * Lightweight i18n system for React Native.
 * Mirrors next-intl's useTranslations('namespace') → t('key') API.
 *
 * Each language has a pre-translated JSON file in src/messages/.
 * At runtime, the current language's JSON is deep-merged over English
 * so any missing keys fall back to English automatically.
 */

import { useCallback, useMemo } from 'react';
import { useLanguage } from '../context/LanguageContext';
import type { SupportedLanguage } from './languages';

// Static imports — bundled at build time, no async loading
import en from '../messages/en.json';
import es from '../messages/es.json';
import fr from '../messages/fr.json';
import de from '../messages/de.json';
import it from '../messages/it.json';
import nl from '../messages/nl.json';
import pt from '../messages/pt.json';
import sv from '../messages/sv.json';
import da from '../messages/da.json';
import no from '../messages/no.json';
import fi from '../messages/fi.json';
import cs from '../messages/cs.json';

type Messages = Record<string, unknown>;

const messagesByLocale: Record<SupportedLanguage, Messages> = {
  en, es, fr, de, it, nl, pt, sv, da, no, fi, cs,
};

/** Deep merge — locale values override English defaults */
function deepMerge(base: Messages, override: Messages): Messages {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      typeof override[key] === 'object' &&
      override[key] !== null &&
      !Array.isArray(override[key]) &&
      typeof result[key] === 'object' &&
      result[key] !== null
    ) {
      result[key] = deepMerge(
        result[key] as Messages,
        override[key] as Messages
      );
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

/** Get merged messages for a locale (English base + locale overrides) */
function getMessages(locale: SupportedLanguage): Messages {
  if (locale === 'en') return en;
  return deepMerge(en, messagesByLocale[locale] || {});
}

/**
 * Module-level active language, used by the non-hook `translate()` helper
 * below. Providers that can't use the React context (e.g. AuthContext, which
 * sits above LanguageProvider in the tree) read from this instead.
 *
 * Kept in sync by LanguageProvider via `setI18nLanguage()`.
 */
let activeLanguage: SupportedLanguage = 'en';

export function setI18nLanguage(lang: SupportedLanguage) {
  activeLanguage = lang;
}

/**
 * Non-hook translator. Use only from places that cannot call `useTranslations`
 * (imperative callbacks outside the LanguageProvider tree, module-level code).
 * Inside components, always prefer `useTranslations`.
 */
export function translate(
  key: string,
  params?: Record<string, string | number>
): string {
  const messages = getMessages(activeLanguage);
  let value = resolve(messages, key);
  if (value === undefined) return key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return value;
}

/** Resolve a dot-path key from a nested object */
function resolve(obj: Messages, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

/**
 * Hook that mirrors next-intl's useTranslations API.
 *
 * Usage:
 *   const t = useTranslations('settings');
 *   t('title')           // → "Settings"
 *   t('greeting', { name: 'Alex' })  // → "Hello, Alex"
 */
export function useTranslations(namespace?: string) {
  const { language } = useLanguage();

  const messages = useMemo(() => getMessages(language), [language]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      let value = resolve(messages, fullKey);

      if (value === undefined) {
        // Fallback: show the key path so missing translations are obvious in dev
        return fullKey;
      }

      // Simple interpolation: replace {param} with values
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }

      return value;
    },
    [messages, namespace]
  );

  return t;
}
