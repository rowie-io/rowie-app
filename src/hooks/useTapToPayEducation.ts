/**
 * Hook to track Tap to Pay education first-use state
 * Apple TTPOi Requirement 3.2: Make merchants aware that TTP is available
 *
 * State is user-specific - each user gets their own education tracking
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import logger from '../lib/logger';

// Base keys - userId will be appended to make them user-specific
const EDUCATION_SEEN_KEY_BASE = '@rowie/tap_to_pay_education_seen';
const EDUCATION_DISMISSED_KEY_BASE = '@rowie/tap_to_pay_education_dismissed';

interface UseTapToPayEducationReturn {
  hasSeenEducation: boolean;
  hasDismissedEducation: boolean;
  isLoading: boolean;
  markEducationSeen: () => Promise<void>;
  markEducationDismissed: () => Promise<void>;
  shouldShowEducationPrompt: boolean;
  resetEducationState: () => Promise<void>;
}

export function useTapToPayEducation(userId?: string): UseTapToPayEducationReturn {
  const [hasSeenEducation, setHasSeenEducation] = useState(false);
  const [hasDismissedEducation, setHasDismissedEducation] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // User-specific storage keys
  const educationSeenKey = useMemo(
    () => userId ? `${EDUCATION_SEEN_KEY_BASE}_${userId}` : EDUCATION_SEEN_KEY_BASE,
    [userId]
  );
  const educationDismissedKey = useMemo(
    () => userId ? `${EDUCATION_DISMISSED_KEY_BASE}_${userId}` : EDUCATION_DISMISSED_KEY_BASE,
    [userId]
  );

  // Load state from AsyncStorage
  useEffect(() => {
    const loadState = async () => {
      // Don't load until we have a userId (prevents flashing modal before user loads)
      if (!userId) {
        setIsLoading(true);
        return;
      }

      try {
        const [seen, dismissed] = await Promise.all([
          AsyncStorage.getItem(educationSeenKey),
          AsyncStorage.getItem(educationDismissedKey),
        ]);
        setHasSeenEducation(seen === 'true');
        setHasDismissedEducation(dismissed === 'true');
      } catch (error) {
        logger.warn('[TapToPayEducation] Failed to load state:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadState();
    // educationSeenKey and educationDismissedKey are derived from userId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Mark education as seen (user completed the education flow)
  const markEducationSeen = useCallback(async () => {
    try {
      await AsyncStorage.setItem(educationSeenKey, 'true');
      setHasSeenEducation(true);
    } catch (error) {
      logger.warn('[TapToPayEducation] Failed to mark as seen:', error);
    }
  }, [educationSeenKey]);

  // Mark education as dismissed (user skipped/closed without completing)
  const markEducationDismissed = useCallback(async () => {
    try {
      await AsyncStorage.setItem(educationDismissedKey, 'true');
      setHasDismissedEducation(true);
    } catch (error) {
      logger.warn('[TapToPayEducation] Failed to mark as dismissed:', error);
    }
  }, [educationDismissedKey]);

  // Reset state (for testing/development)
  const resetEducationState = useCallback(async () => {
    try {
      await Promise.all([
        AsyncStorage.removeItem(educationSeenKey),
        AsyncStorage.removeItem(educationDismissedKey),
      ]);
      setHasSeenEducation(false);
      setHasDismissedEducation(false);
    } catch (error) {
      logger.warn('[TapToPayEducation] Failed to reset state:', error);
    }
  }, [educationSeenKey, educationDismissedKey]);

  // Show education prompt if user hasn't seen it and hasn't dismissed it
  // Also require userId to be present to prevent flashing
  const shouldShowEducationPrompt = !isLoading && !!userId && !hasSeenEducation && !hasDismissedEducation;

  return {
    hasSeenEducation,
    hasDismissedEducation,
    isLoading,
    markEducationSeen,
    markEducationDismissed,
    shouldShowEducationPrompt,
    resetEducationState,
  };
}
