import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { apiClient } from './client';
import { organizationsService } from './organizations';
import { isBiometricLoginEnabled, clearStoredCredentials } from '../biometricAuth';
import { getDeviceId, getDeviceInfoForApi } from '../device';
import logger from '../logger';

export interface ComputedRates {
  tapToPay: { starter: string; pro: string };
  manualCard: { starter: string; pro: string };
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
  cognitoUsername?: string;
  emailAlerts?: boolean;
  marketingEmails?: boolean;
  weeklyReports?: boolean;
  onboardingCompleted?: boolean;
  tapToPayDeviceIds?: string[];
  currency?: string;
  rates?: ComputedRates;
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

    // Extract Cognito username from the access token
    if (response.tokens.accessToken) {
      try {
        const tokenParts = response.tokens.accessToken.split('.');
        if (tokenParts.length === 3) {
          const payload = JSON.parse(atob(tokenParts[1]));
          logger.log('[AuthService] Token payload keys:', Object.keys(payload));
          logger.log('[AuthService] cognito:username:', payload['cognito:username']);
          logger.log('[AuthService] username:', payload.username);
          logger.log('[AuthService] sub:', payload.sub);
          const cognitoUsername = payload['cognito:username'] || payload.username || payload.sub;
          logger.log('[AuthService] Extracted cognitoUsername:', cognitoUsername);
          if (cognitoUsername) {
            response.user.cognitoUsername = cognitoUsername;
          }
        }
      } catch (error) {
        logger.error('[AuthService] Error parsing token:', error);
      }
    }
    logger.log('[AuthService] User after login:', JSON.stringify(response.user));

    await this.saveAuthData(response);

    return response;
  }

  async logout(): Promise<void> {
    const refreshToken = await this.getRefreshToken();

    // Check if biometric login is enabled
    const biometricEnabled = await isBiometricLoginEnabled();
    logger.log('[AuthService] Logout - biometric enabled:', biometricEnabled);

    // Clear auth data immediately for instant logout
    await this.clearAuthData();

    // If biometric is NOT enabled, clear stored credentials too
    if (!biometricEnabled) {
      logger.log('[AuthService] Clearing stored credentials (biometric disabled)');
      await clearStoredCredentials();
    }

    // Invalidate token on server
    if (refreshToken) {
      logger.log('[AuthService] Invalidating token on server...');
      try {
        await apiClient.post('/auth/logout', { refreshToken });
        logger.log('[AuthService] Token invalidated on server');
      } catch (error) {
        // Silently handle error - user is already logged out locally
        logger.log('[AuthService] Token invalidation failed (non-critical)');
      }
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
   * Refresh tokens using a provided refresh token
   * Used for biometric login where the token is stored in SecureStore, not AsyncStorage
   * @param refreshToken - The refresh token to use
   * @param providedUsername - Optional cognitoUsername (for biometric login where user data is cleared)
   */
  async refreshTokensWithToken(refreshToken: string, providedUsername?: string): Promise<AuthTokens | null> {
    logger.log('[AuthService] refreshTokensWithToken called');
    logger.log('[AuthService] Token being used (first 50 chars):', refreshToken?.substring(0, 50));
    logger.log('[AuthService] Provided username:', providedUsername);

    const accessToken = await this.getAccessToken();

    let cognitoUsername: string | undefined = providedUsername;

    // If no username provided, try to get it from stored data
    if (!cognitoUsername) {
      const user = await this.getUser();
      if (user?.cognitoUsername) {
        cognitoUsername = user.cognitoUsername;
      } else if (accessToken) {
        // Try to extract Cognito username from the access token
        try {
          const tokenParts = accessToken.split('.');
          if (tokenParts.length === 3) {
            const payload = JSON.parse(atob(tokenParts[1]));
            cognitoUsername = payload['cognito:username'] || payload.username || payload.email;
          }
        } catch (error) {
          // Ignore token parsing errors
        }
      }
    }

    logger.log('[AuthService] Using cognitoUsername:', cognitoUsername);

    try {
      logger.log('[AuthService] Calling /auth/refresh...');
      const tokens = await apiClient.post<AuthTokens>('/auth/refresh', {
        refreshToken,
        username: cognitoUsername,
      });

      logger.log('[AuthService] Got new tokens, saving...');
      logger.log('[AuthService] New access token:', tokens.accessToken?.substring(0, 20) + '...');
      await this.saveTokens(tokens);

      // Extract and save cognitoUsername from new access token
      if (tokens.accessToken) {
        try {
          const tokenParts = tokens.accessToken.split('.');
          if (tokenParts.length === 3) {
            const payload = JSON.parse(atob(tokenParts[1]));
            const extractedUsername = payload['cognito:username'] || payload.username || payload.sub;
            if (extractedUsername) {
              // Update stored user with cognitoUsername
              const storedUser = await this.getUser();
              if (storedUser) {
                storedUser.cognitoUsername = extractedUsername;
                await this.saveUser(storedUser);
                logger.log('[AuthService] Updated stored user with cognitoUsername:', extractedUsername);
              }
            }
          }
        } catch (error) {
          logger.error('[AuthService] Error extracting cognitoUsername from refreshed token:', error);
        }
      }

      // Verify tokens were saved
      const savedToken = await this.getAccessToken();
      logger.log('[AuthService] Verified saved token:', savedToken?.substring(0, 20) + '...');

      return tokens;
    } catch (error: any) {
      logger.log('[AuthService] Refresh failed:', error?.message);
      await this.clearAuthData();
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
    return AsyncStorage.getItem(AuthService.ACCESS_TOKEN_KEY);
  }

  async getRefreshToken(): Promise<string | null> {
    return AsyncStorage.getItem(AuthService.REFRESH_TOKEN_KEY);
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
    const version = await AsyncStorage.getItem(AuthService.SESSION_VERSION_KEY);
    return version ? parseInt(version, 10) : null;
  }

  private async saveSessionVersion(version: number): Promise<void> {
    await AsyncStorage.setItem(AuthService.SESSION_VERSION_KEY, version.toString());
  }

  private async saveTokens(tokens: AuthTokens): Promise<void> {
    await Promise.all([
      AsyncStorage.setItem(AuthService.ACCESS_TOKEN_KEY, tokens.accessToken),
      AsyncStorage.setItem(AuthService.REFRESH_TOKEN_KEY, tokens.refreshToken),
    ]);
  }

  private async clearAuthData(): Promise<void> {
    await AsyncStorage.multiRemove([
      AuthService.ACCESS_TOKEN_KEY,
      AuthService.REFRESH_TOKEN_KEY,
      AuthService.USER_KEY,
      AuthService.ORGANIZATION_KEY,
      AuthService.SESSION_VERSION_KEY,
      AuthService.SUBSCRIPTION_KEY,
    ]);
  }
}

export const authService = new AuthService();
