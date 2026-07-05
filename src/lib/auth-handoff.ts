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

    // SECURITY: never put the access/refresh token in the handoff URL — it
    // would persist in the external browser's history and be readable by
    // extensions. Instead exchange them for a single-use, 60-second opaque code
    // (server-side, over TLS) and carry only that code in the URL fragment.
    const resp = await fetch(`${config.apiUrl}/auth/handoff/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ refreshToken, user }),
    });

    if (!resp.ok) {
      logger.error('[AuthHandoff] Failed to create handoff code', { status: resp.status });
      return null;
    }

    const data = (await resp.json()) as { code?: string };
    if (!data?.code) {
      logger.error('[AuthHandoff] Handoff response missing code');
      return null;
    }

    // Only the opaque single-use code travels in the URL (hash fragment keeps
    // it out of server logs / Referer as well).
    const params = new URLSearchParams({ code: data.code });
    if (redirectPath) {
      params.append('redirect', redirectPath);
    }

    return `${config.vendorDashboardUrl}/auth/callback#${params.toString()}`;
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
