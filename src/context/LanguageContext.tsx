import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '../lib/api/client';
import { LANGUAGE_NAMES, type SupportedLanguage } from '../lib/languages';
import { setCurrencyLocale } from '../utils/currency';
import logger from '../lib/logger';

/**
 * Map our 2-letter SupportedLanguage codes to BCP-47 locales used by
 * Intl.NumberFormat (e.g. 'en' → 'en-US', 'cs' → 'cs-CZ'). Picks the most
 * common region for each language so number grouping/separators are correct.
 */
const LOCALE_MAP: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  nl: 'nl-NL',
  pt: 'pt-PT',
  sv: 'sv-SE',
  da: 'da-DK',
  no: 'nb-NO',
  fi: 'fi-FI',
  cs: 'cs-CZ',
};

interface LanguageContextType {
  language: SupportedLanguage;
  orgLanguage: SupportedLanguage;
  languageName: string;
  setLanguage: (lang: SupportedLanguage) => Promise<void>;
  resetToOrgDefault: () => Promise<void>;
  isUserOverride: boolean;
  isLoading: boolean;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const LANGUAGE_STORAGE_KEY = 'rowie_language';

interface LanguageProviderProps {
  children: ReactNode;
  userLanguage?: string | null;
  orgLanguage?: string;
}

export function LanguageProvider({ children, userLanguage, orgLanguage: orgLangProp }: LanguageProviderProps) {
  const orgLang = (orgLangProp || 'en') as SupportedLanguage;
  const [language, setLanguageState] = useState<SupportedLanguage>(orgLang);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUserOverride, setIsUserOverride] = useState(false);

  // On mount: load cached language for instant display
  useEffect(() => {
    const load = async () => {
      try {
        const cached = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (cached && cached in LANGUAGE_NAMES) {
          setLanguageState(cached as SupportedLanguage);
          setIsUserOverride(true);
        }
      } catch (e) {
        logger.error('Failed to load language preference:', e);
      } finally {
        setIsLoaded(true);
      }
    };
    load();
  }, []);

  // When user/org data arrives from API, update
  useEffect(() => {
    if (!isLoaded) return;

    if (userLanguage && userLanguage in LANGUAGE_NAMES) {
      setLanguageState(userLanguage as SupportedLanguage);
      setIsUserOverride(true);
      AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, userLanguage).catch(() => {});
    } else if (!userLanguage) {
      // No user override — use org default
      setLanguageState(orgLang);
      setIsUserOverride(false);
      AsyncStorage.removeItem(LANGUAGE_STORAGE_KEY).catch(() => {});
    }
  }, [userLanguage, orgLang, isLoaded]);

  // Keep the currency formatter's locale in sync with the active language so
  // monetary amounts use the right thousand/decimal separators.
  useEffect(() => {
    setCurrencyLocale(LOCALE_MAP[language] || 'en-US');
  }, [language]);

  const setLanguage = useCallback(async (lang: SupportedLanguage) => {
    setIsLoading(true);
    try {
      await apiClient.patch('/auth/profile', { language: lang });
      setLanguageState(lang);
      setIsUserOverride(true);
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch (e) {
      logger.error('Failed to update language:', e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const resetToOrgDefault = useCallback(async () => {
    setIsLoading(true);
    try {
      await apiClient.patch('/auth/profile', { language: null });
      setLanguageState(orgLang);
      setIsUserOverride(false);
      await AsyncStorage.removeItem(LANGUAGE_STORAGE_KEY);
    } catch (e) {
      logger.error('Failed to reset language:', e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, [orgLang]);

  const value = useMemo(() => ({
    language,
    orgLanguage: orgLang,
    languageName: LANGUAGE_NAMES[language] || 'English',
    setLanguage,
    resetToOrgDefault,
    isUserOverride,
    isLoading,
  }), [language, orgLang, setLanguage, resetToOrgDefault, isUserOverride, isLoading]);

  if (!isLoaded) return null;

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextType {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
