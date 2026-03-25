/**
 * Auth Handoff Helper for opening Vendor Dashboard with authentication
 * Allows users to access the vendor portal without re-authenticating
 */

import { Linking } from 'react-native';
import { authService } from './api/auth';
import { config } from './config';
import logger from './logger';

/**
 * Creates an authenticated URL to the vendor dashboard
 * Uses hash fragment method for cross-origin compatibility
 *
 * @param redirectPath - Optional path to redirect to after authentication (e.g., '/products')
 * @returns The authenticated URL, or null if no tokens available
 */
export async function createVendorDashboardUrl(redirectPath?: string): Promise<string | null> {
  try {
    // Get current auth data
    const accessToken = await authService.getAccessToken();
    const refreshToken = await authService.getRefreshToken();
    const user = await authService.getUser();

    if (!accessToken || !refreshToken) {
      logger.error('[AuthHandoff] No authentication tokens available');
      return null;
    }

    // Build the auth callback URL with tokens in hash fragment
    const params = new URLSearchParams({
      accessToken,
      refreshToken,
    });

    if (user) {
      // Note: Don't use encodeURIComponent here - URLSearchParams handles encoding
      params.append('user', JSON.stringify(user));
    }

    // Add redirect path if provided
    if (redirectPath) {
      params.append('redirect', redirectPath);
    }

    // Use hash fragment for cross-origin compatibility
    const authCallbackUrl = `${config.vendorDashboardUrl}/auth/callback#${params.toString()}`;

    return authCallbackUrl;
  } catch (error) {
    logger.error('[AuthHandoff] Error creating vendor dashboard URL:', error);
    return null;
  }
}

/**
 * Opens the vendor dashboard in a browser with authentication
 * The user will be automatically logged in
 *
 * @param redirectPath - Optional path to redirect to after authentication (e.g., '/products')
 */
export async function openVendorDashboard(redirectPath?: string): Promise<void> {
  try {
    const url = await createVendorDashboardUrl(redirectPath);

    if (!url) {
      logger.error('[AuthHandoff] Cannot open vendor dashboard - no auth URL');
      // Fallback: open dashboard without auth (with redirect if provided)
      const fallbackUrl = redirectPath
        ? `${config.vendorDashboardUrl}${redirectPath}`
        : config.vendorDashboardUrl;
      await Linking.openURL(fallbackUrl);
      return;
    }

    // Open the authenticated URL in browser
    // Note: We don't check canOpenURL() because it can return false on Android
    // for HTTPS URLs even when they can be opened. Just try to open directly.
    await Linking.openURL(url);
  } catch (error) {
    logger.error('[AuthHandoff] Error opening vendor dashboard:', error);
    // Try fallback URL if main URL fails
    try {
      const fallbackUrl = redirectPath
        ? `${config.vendorDashboardUrl}${redirectPath}`
        : config.vendorDashboardUrl;
      await Linking.openURL(fallbackUrl);
    } catch (fallbackError) {
      logger.error('[AuthHandoff] Fallback also failed:', fallbackError);
    }
  }
}
