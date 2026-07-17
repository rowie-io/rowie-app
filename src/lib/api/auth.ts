import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { apiClient } from './client';
import { getSecureItem, setSecureItem, removeSecureItem } from './secureStorage';
import { organizationsService } from './organizations';
import { isBiometricLoginEnabled, clearStoredCredentials } from '../biometricAuth';
import { getDeviceId, getDeviceInfoForApi } from '../device';
import logger from '../logger';

export interface ComputedRates {
  tapToPay: { starter: string; pro: string };
  manualCard: { starter: string; pro: string };
}

// Location the user can operate in (from /auth/me and /auth/login).
// Owners/admins get all org locations; staff get their user_locations rows.
export interface AccessibleLocation {
  id: string;
  name: string;
  isDefault?: boolean;
  [key: string]: any;
}

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatarUrl?: string;
  organizationId: string;
  role: string;
  emailAlerts?: boolean;
  marketingEmails?: boolean;
  weeklyReports?: boolean;
  onboardingCompleted?: boolean;
  tapToPayDeviceIds?: string[];
  currency?: string;
  rates?: ComputedRates;
  language?: string;
  orgLanguage?: string;
  // 2-letter ISO country code from the org's billing address; used by
  // UpgradeScreen to pick the correct regional transaction-fee display
  // (EU/UK have different Stripe base rates than US/CA). When undefined
  // callers fall back to 'US'. API may or may not populate it — the field
  // is optional and the fallback path is the runtime guarantee.
  country?: string;
  // Returned at the top level of /auth/me (and /auth/login) alongside the
  // user fields, so it lands on the object stored as `profile.user`.
  accessibleLocations?: AccessibleLocation[];
}

export interface Organization {
  id: string;
  name: string;
  slug?: string;
  settings?: {
    tips?: {
      enabled: boolean;
      percentages: number[];
      allowCustom: boolean;
    };
    receipts?: {
      autoEmailReceipt: boolean;
      promptForEmail: boolean;
    };
  };
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface Subscription {
  tier: 'starter' | 'pro' | 'enterprise';
  status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'none';
}

export interface LoginResponse {
  user: User;
  organization: Organization;
  tokens: AuthTokens;
  sessionVersion: number; // For single session enforcement
  subscription?: Subscription; // Subscription info returned from login
  // Top-level sibling of user/organization in the login payload (unlike
  // /auth/me, where it sits on the user object itself)
  accessibleLocations?: AccessibleLocation[];
}

class AuthService {
  private static readonly ACCESS_TOKEN_KEY = 'accessToken';
  private static readonly REFRESH_TOKEN_KEY = 'refreshToken';
  private static readonly USER_KEY = 'user';
  private static readonly ORGANIZATION_KEY = 'organization';
  private static readonly SESSION_VERSION_KEY = 'sessionVersion';
  private static readonly SUBSCRIPTION_KEY = 'subscription';

  private refreshPromise: Promise<AuthTokens | null> | null = null;

  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    // Get device info for tracking
    const deviceId = await getDeviceId();
    const deviceInfo = getDeviceInfoForApi();
    const appVersion = Constants.expoConfig?.version || 'unknown';

    // Include source: 'app' so the backend knows this is a mobile app login
    // This enables single-session enforcement for the app only (not vendor portal)
    const response = await apiClient.post<LoginResponse>('/auth/login', {
      ...credentials,
      source: 'app',
      deviceId,
      deviceInfo: {
        ...deviceInfo,
        appVersion,
      },
    });

    logger.log('[AuthService] Login complete', { hasUser: !!response.user });

    await this.saveAuthData(response);

    return response;
  }

  async logout(): Promise<void> {
    const refreshToken = await this.getRefreshToken();

    // Check if biometric login is enabled
    const biometricEnabled = await isBiometricLoginEnabled();
    logger.log('[AuthService] Logout - biometric enabled:', biometricEnabled);

    // Invalidate token on server FIRST (best-effort) — the request needs the
    // Authorization header, so tokens must still be present when it's sent
    if (refreshToken) {
      logger.log('[AuthService] Invalidating token on server...');
      try {
        await apiClient.post('/auth/logout', { refreshToken });
        logger.log('[AuthService] Token invalidated on server');
      } catch (error) {
        // Silently handle error - local logout proceeds regardless
        logger.log('[AuthService] Token invalidation failed (non-critical)');
      }
    }

    // Clear auth data regardless of server outcome
    await this.clearAuthData();

    // If biometric is NOT enabled, clear stored credentials too
    if (!biometricEnabled) {
      logger.log('[AuthService] Clearing stored credentials (biometric disabled)');
      await clearStoredCredentials();
    }
  }

  async refreshTokens(): Promise<AuthTokens | null> {
    if (this.refreshPromise) {
      logger.log('[AuthService] refreshTokens already in-flight, returning existing promise');
      return this.refreshPromise;
    }

    const refreshToken = await this.getRefreshToken();
    if (!refreshToken) {
      return null;
    }

    this.refreshPromise = this.refreshTokensWithToken(refreshToken)
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  /**
   * Refresh tokens using a provided refresh token.
   * Used for biometric login where the token is stored in SecureStore, not AsyncStorage.
   */
  async refreshTokensWithToken(refreshToken: string): Promise<AuthTokens | null> {
    logger.log('[AuthService] refreshTokensWithToken called', {
      hasRefreshToken: !!refreshToken,
    });

    try {
      const tokens = await apiClient.post<AuthTokens>('/auth/refresh', { refreshToken });

      // Refresh tokens are single-use: the API rotates them, so the response
      // carries a NEW refresh token and the one we just sent is now dead.
      // Persisting both is mandatory — dropping the new refresh token would
      // strand the session at the next refresh.
      await this.saveTokens(tokens);

      return tokens;
    } catch (error: any) {
      logger.log('[AuthService] Refresh failed:', error?.message);
      // Only nuke the session when the server actually REJECTED the refresh
      // token (401/403 from /auth/refresh — ApiError carries statusCode).
      // Network failures (fetch TypeError, no statusCode) and 5xx are
      // transient: keep the tokens so the next attempt can retry.
      const status = error?.statusCode;
      if (status === 401 || status === 403) {
        await this.clearAuthData();
      }
      throw error;
    }
  }

  async requestPasswordReset(email: string): Promise<void> {
    await apiClient.post('/auth/forgot-password', { email });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await apiClient.post('/auth/reset-password', {
      token,
      password: newPassword,
    });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiClient.post('/auth/change-password', {
      currentPassword,
      newPassword,
    });
  }

  async checkPassword(password: string): Promise<{ valid: boolean; errors: string[] }> {
    return apiClient.post<{ valid: boolean; errors: string[] }>('/auth/check-password', {
      password,
    });
  }

  async getProfile(): Promise<{ user: User; organization: Organization }> {
    // Fetch user data from /auth/me
    const user = await apiClient.get<User>('/auth/me');

    // Fetch organization data using user's organizationId
    const organization = await organizationsService.getById(user.organizationId);

    return { user, organization };
  }

  async completeOnboarding(): Promise<{ onboardingCompleted: boolean }> {
    return apiClient.post<{ onboardingCompleted: boolean }>('/auth/complete-onboarding', {});
  }

  /**
   * Link an IAP purchase token to the user's subscription
   * This must be called after a successful IAP purchase so the webhook can find the subscription
   */
  async linkIapPurchase(params: {
    platform: 'ios' | 'android';
    purchaseToken: string;
    transactionId?: string;
    productId?: string;
  }): Promise<{ message: string; subscriptionId: string }> {
    logger.log('[AuthService] Linking IAP purchase', {
      platform: params.platform,
      productId: params.productId,
      purchaseTokenPreview: params.purchaseToken.substring(0, 20) + '...',
    });

    const response = await apiClient.post<{ message: string; subscriptionId: string }>(
      '/auth/link-iap-purchase',
      params
    );

    logger.log('[AuthService] IAP purchase linked successfully', response);
    return response;
  }

  async registerTapToPayDevice(deviceId: string): Promise<{ tapToPayDeviceIds: string[] }> {
    return apiClient.post<{ tapToPayDeviceIds: string[] }>('/auth/tap-to-pay-device', { deviceId });
  }

  async requestAccountDeletion(): Promise<{ success: boolean; message: string; deletionDate: string }> {
    return apiClient.post<{ success: boolean; message: string; deletionDate: string }>('/auth/request-account-deletion', {});
  }

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getAccessToken();
    return !!token;
  }

  async getAccessToken(): Promise<string | null> {
    return getSecureItem(AuthService.ACCESS_TOKEN_KEY);
  }

  async getRefreshToken(): Promise<string | null> {
    return getSecureItem(AuthService.REFRESH_TOKEN_KEY);
  }

  async getUser(): Promise<User | null> {
    const userStr = await AsyncStorage.getItem(AuthService.USER_KEY);
    if (!userStr) return null;

    try {
      return JSON.parse(userStr);
    } catch {
      return null;
    }
  }

  async getOrganization(): Promise<Organization | null> {
    const orgStr = await AsyncStorage.getItem(AuthService.ORGANIZATION_KEY);
    if (!orgStr) return null;

    try {
      return JSON.parse(orgStr);
    } catch {
      return null;
    }
  }

  async saveUser(user: User): Promise<void> {
    await AsyncStorage.setItem(AuthService.USER_KEY, JSON.stringify(user));
  }

  async saveOrganization(organization: Organization): Promise<void> {
    await AsyncStorage.setItem(AuthService.ORGANIZATION_KEY, JSON.stringify(organization));
  }

  async getSubscription(): Promise<Subscription | null> {
    const subStr = await AsyncStorage.getItem(AuthService.SUBSCRIPTION_KEY);
    if (!subStr) return null;

    try {
      return JSON.parse(subStr);
    } catch {
      return null;
    }
  }

  async saveSubscription(subscription: Subscription): Promise<void> {
    await AsyncStorage.setItem(AuthService.SUBSCRIPTION_KEY, JSON.stringify(subscription));
  }

  private async saveAuthData(response: LoginResponse): Promise<void> {
    const promises: Promise<void>[] = [
      this.saveTokens(response.tokens),
      this.saveUser(response.user),
      this.saveOrganization(response.organization),
      this.saveSessionVersion(response.sessionVersion),
    ];

    // Save subscription if included in response
    if (response.subscription) {
      promises.push(this.saveSubscription(response.subscription));
    }

    await Promise.all(promises);
  }

  async getSessionVersion(): Promise<number | null> {
    const version = await getSecureItem(AuthService.SESSION_VERSION_KEY);
    return version ? parseInt(version, 10) : null;
  }

  private async saveSessionVersion(version: number): Promise<void> {
    await setSecureItem(AuthService.SESSION_VERSION_KEY, version.toString());
  }

  private async saveTokens(tokens: AuthTokens): Promise<void> {
    await Promise.all([
      setSecureItem(AuthService.ACCESS_TOKEN_KEY, tokens.accessToken),
      setSecureItem(AuthService.REFRESH_TOKEN_KEY, tokens.refreshToken),
    ]);
  }

  private async clearAuthData(): Promise<void> {
    await Promise.all([
      // Sensitive keys live in SecureStore.
      removeSecureItem(AuthService.ACCESS_TOKEN_KEY),
      removeSecureItem(AuthService.REFRESH_TOKEN_KEY),
      removeSecureItem(AuthService.SESSION_VERSION_KEY),
      // Non-secret blobs remain in AsyncStorage.
      AsyncStorage.multiRemove([
        AuthService.USER_KEY,
        AuthService.ORGANIZATION_KEY,
        AuthService.SUBSCRIPTION_KEY,
      ]),
    ]);
  }
}

export const authService = new AuthService();
