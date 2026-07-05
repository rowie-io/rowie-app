/**
 * Secure storage helper for sensitive auth values (tokens, session version).
 *
 * Sensitive keys live in expo-secure-store (encrypted native Keychain/Keystore)
 * instead of plaintext AsyncStorage. Large/non-secret blobs (user, organization)
 * stay in AsyncStorage — SecureStore has a ~2KB per-value limit on Android and
 * those JSON blobs can exceed it.
 *
 * Includes a one-time read migration: if a value isn't in SecureStore yet, we
 * fall back to the legacy AsyncStorage key, migrate it into SecureStore, and
 * delete the AsyncStorage copy — so existing logged-in users aren't logged out
 * on upgrade.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import logger from '../logger';

// SecureStore isn't available on web — fall back to AsyncStorage there.
const IS_WEB = Platform.OS === 'web';

export async function getSecureItem(key: string): Promise<string | null> {
  if (IS_WEB) {
    return AsyncStorage.getItem(key);
  }
  try {
    const value = await SecureStore.getItemAsync(key);
    if (value !== null) {
      return value;
    }

    // One-time migration from legacy plaintext AsyncStorage.
    const legacy = await AsyncStorage.getItem(key);
    if (legacy !== null) {
      await SecureStore.setItemAsync(key, legacy);
      await AsyncStorage.removeItem(key);
      logger.log('[SecureStorage] Migrated key from AsyncStorage:', key);
      return legacy;
    }

    return null;
  } catch (error) {
    logger.error('[SecureStorage] Error reading key:', key, error);
    return null;
  }
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (IS_WEB) {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function removeSecureItem(key: string): Promise<void> {
  if (IS_WEB) {
    await AsyncStorage.removeItem(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (error) {
    logger.error('[SecureStorage] Error deleting key:', key, error);
  }
  // Also clear any legacy AsyncStorage copy that predates the migration.
  await AsyncStorage.removeItem(key);
}
