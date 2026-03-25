/**
 * Biometric Authentication Service
 * Apple TTPOi Requirement 1.7: Use Face ID or Touch ID for login
 *
 * Provides FaceID/TouchID authentication for secure login flow
 */

import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import logger from './logger';

// Keys for secure storage
const BIOMETRIC_ENABLED_KEY = 'biometric_enabled';
const BIOMETRIC_CREDENTIALS_KEY = 'biometric_credentials';
const CREDENTIALS_STORED_KEY = 'credentials_stored';

export interface BiometricCapabilities {
  isAvailable: boolean;
  biometricTypes: LocalAuthentication.AuthenticationType[];
  hasHardware: boolean;
  isEnrolled: boolean;
  biometricName: string; // "Face ID", "Touch ID", or "Biometric"
}

export interface StoredCredentials {
  email: string;
  // Note: We don't store the actual password - instead we store an encrypted
  // refresh token or use a special biometric-only session
  hasStoredSession: boolean;
}

/**
 * Check if biometric authentication is available on this device
 */
export async function checkBiometricCapabilities(): Promise<BiometricCapabilities> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

    // Determine biometric name based on platform and available types
    let biometricName = 'Biometric';
    if (Platform.OS === 'ios') {
      // iOS: Face ID for facial recognition, Touch ID for fingerprint
      if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        biometricName = 'Face ID';
      } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        biometricName = 'Touch ID';
      }
    } else {
      // Android: Prioritize fingerprint (more common), fallback to face unlock
      // Many Android devices report both types even when only fingerprint is used
      if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
        biometricName = 'Fingerprint';
      } else if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
        biometricName = 'Face Unlock';
      } else if (supportedTypes.length > 0) {
        biometricName = 'Biometric';
      }
    }

    return {
      isAvailable: hasHardware && isEnrolled,
      biometricTypes: supportedTypes,
      hasHardware,
      isEnrolled,
      biometricName,
    };
  } catch (error) {
    logger.warn('[BiometricAuth] Error checking capabilities:', error);
    return {
      isAvailable: false,
      biometricTypes: [],
      hasHardware: false,
      isEnrolled: false,
      biometricName: 'Biometric',
    };
  }
}

/**
 * Prompt user for biometric authentication
 */
export async function authenticateWithBiometric(
  promptMessage?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const capabilities = await checkBiometricCapabilities();

    if (!capabilities.isAvailable) {
      return {
        success: false,
        error: capabilities.hasHardware
          ? `${capabilities.biometricName} is not set up on this device`
          : `${capabilities.biometricName} is not available on this device`,
      };
    }

    logger.log('[BiometricAuth] Calling authenticateAsync...');
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: promptMessage || `Sign in with ${capabilities.biometricName}`,
      disableDeviceFallback: false, // Allow passcode fallback if biometric is locked out
      cancelLabel: 'Use Password',
    });
    logger.log('[BiometricAuth] Auth result:', JSON.stringify(result));

    if (result.success) {
      return { success: true };
    }

    // Handle different error types
    if (result.error === 'user_cancel') {
      logger.log('[BiometricAuth] User cancelled');
      return { success: false, error: 'Authentication cancelled' };
    }

    if (result.error === 'lockout') {
      logger.log('[BiometricAuth] Biometric locked out');
      return { success: false, error: `${capabilities.biometricName} is locked. Please use your password.` };
    }

    logger.log('[BiometricAuth] Auth failed:', result.error);
    return {
      success: false,
      error: result.error === 'user_fallback'
        ? 'Use password instead'
        : `Authentication failed: ${result.error}`,
    };
  } catch (error: any) {
    logger.error('[BiometricAuth] Authentication error:', error);
    return { success: false, error: error.message || 'Authentication failed' };
  }
}

/**
 * Check if biometric login is enabled for this user
 */
export async function isBiometricLoginEnabled(): Promise<boolean> {
  try {
    const value = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
    return value === 'true';
  } catch (error) {
    logger.warn('[BiometricAuth] Error checking if enabled:', error);
    return false;
  }
}

/**
 * Store credentials securely after login
 * Called automatically on every successful login to keep credentials fresh
 * @param email - User's email
 * @param password - User's password (stored encrypted in Keychain/Keystore)
 */
export async function storeCredentials(
  email: string,
  password: string
): Promise<boolean> {
  try {
    logger.log('[BiometricAuth] Storing credentials for:', email);

    const credentials = JSON.stringify({
      email,
      password,
      timestamp: Date.now(),
    });

    await SecureStore.setItemAsync(BIOMETRIC_CREDENTIALS_KEY, credentials, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });
    await SecureStore.setItemAsync(CREDENTIALS_STORED_KEY, 'true');

    logger.log('[BiometricAuth] Credentials stored successfully');
    return true;
  } catch (error) {
    logger.error('[BiometricAuth] Error storing credentials:', error);
    return false;
  }
}

/**
 * Check if credentials are stored (from a previous login)
 */
export async function hasStoredCredentials(): Promise<boolean> {
  try {
    const value = await SecureStore.getItemAsync(CREDENTIALS_STORED_KEY);
    return value === 'true';
  } catch (error) {
    return false;
  }
}

/**
 * Enable biometric login
 * Requires credentials to already be stored (from login) and biometric verification
 */
export async function enableBiometricLogin(): Promise<boolean> {
  try {
    logger.log('[BiometricAuth] Enabling biometric login...');

    // Check if credentials are stored
    const hasCredentials = await hasStoredCredentials();
    if (!hasCredentials) {
      logger.log('[BiometricAuth] No stored credentials found');
      return false;
    }

    // Authenticate with biometric to confirm identity
    const authResult = await authenticateWithBiometric('Enable biometric login');
    if (!authResult.success) {
      logger.log('[BiometricAuth] Biometric auth cancelled/failed');
      return false;
    }

    // Enable biometric login
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'true');

    logger.log('[BiometricAuth] Biometric login enabled successfully');
    return true;
  } catch (error) {
    logger.error('[BiometricAuth] Error enabling:', error);
    return false;
  }
}

/**
 * Disable biometric login (keeps credentials stored for easy re-enable)
 */
export async function disableBiometricLogin(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
    logger.log('[BiometricAuth] Biometric login disabled');
  } catch (error) {
    logger.error('[BiometricAuth] Error disabling:', error);
  }
}

/**
 * Clear all stored credentials (called on logout when biometric is disabled)
 */
export async function clearStoredCredentials(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(BIOMETRIC_CREDENTIALS_KEY);
    await SecureStore.deleteItemAsync(CREDENTIALS_STORED_KEY);
    await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
    logger.log('[BiometricAuth] Stored credentials cleared');
  } catch (error) {
    logger.error('[BiometricAuth] Error clearing credentials:', error);
  }
}

/**
 * Get stored credentials after successful biometric authentication
 * Returns email and password for login
 */
export async function getBiometricCredentials(): Promise<{
  email: string;
  password: string;
} | null> {
  try {
    logger.log('[BiometricAuth] Getting biometric credentials...');

    // Authenticate first
    const authResult = await authenticateWithBiometric('Sign in');
    if (!authResult.success) {
      logger.log('[BiometricAuth] Biometric auth failed/cancelled');
      return null;
    }

    // Get stored credentials
    const stored = await SecureStore.getItemAsync(BIOMETRIC_CREDENTIALS_KEY);
    if (!stored) {
      logger.log('[BiometricAuth] No stored credentials found');
      return null;
    }

    const credentials = JSON.parse(stored);
    logger.log('[BiometricAuth] Retrieved credentials for:', credentials.email);

    return {
      email: credentials.email,
      password: credentials.password,
    };
  } catch (error) {
    logger.error('[BiometricAuth] Error getting credentials:', error);
    return null;
  }
}

/**
 * Get stored email (without requiring biometric auth)
 */
export async function getStoredEmail(): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(BIOMETRIC_CREDENTIALS_KEY);
    if (!stored) return null;
    const credentials = JSON.parse(stored);
    return credentials.email || null;
  } catch (error) {
    return null;
  }
}
