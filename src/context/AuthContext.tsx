import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Alert, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authService, User, Organization, Subscription, stripeConnectApi, ConnectStatus } from '../lib/api';
import { setOnSessionKicked, apiClient } from '../lib/api/client';
import { setOnSocketSessionKicked } from '../lib/session-callbacks';
import {
  checkBiometricCapabilities,
  isBiometricLoginEnabled,
  BiometricCapabilities,
} from '../lib/biometricAuth';
import { translate } from '../lib/i18n';
import logger from '../lib/logger';

/** When set, LoginScreen should skip the auto biometric prompt on mount. */
export const SKIP_BIOMETRIC_KEY = 'rowie_skip_biometric_on_mount';

interface AccessibleLocation {
  id: string;
  name: string;
  isDefault?: boolean;
  [key: string]: any;
}

interface AuthState {
  user: User | null;
  organization: Organization | null;
  subscription: Subscription | null;
  accessibleLocations: AccessibleLocation[];
  isLoading: boolean;
  isAuthenticated: boolean;
  connectStatus: ConnectStatus | null;
  isPaymentReady: boolean;
  connectLoading: boolean;
  biometricCapabilities: BiometricCapabilities | null;
  biometricEnabled: boolean;
  currency: string;
}

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  refreshConnectStatus: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  setBiometricEnabled: (enabled: boolean) => void;
  refreshBiometricStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    organization: null,
    subscription: null,
    accessibleLocations: [],
    isLoading: true,
    isAuthenticated: false,
    connectStatus: null,
    isPaymentReady: false,
    connectLoading: true,
    biometricCapabilities: null,
    biometricEnabled: false,
    currency: 'usd',
  });

  // Track if we're already showing a session kicked alert
  const sessionKickedAlertShown = useRef(false);

  // Handle session kicked (user logged in on another device)
  const handleSessionKicked = useCallback(async () => {
    // Prevent showing multiple alerts
    if (sessionKickedAlertShown.current) {
      return;
    }
    sessionKickedAlertShown.current = true;

    logger.log('[AuthContext] Session kicked - signing out user');

    // Clear auth data immediately
    try {
      await authService.logout();
    } catch (error) {
      logger.error('[AuthContext] Error during session kicked logout:', error);
    }

    // Update state
    setState({
      user: null,
      organization: null,
      subscription: null,
      accessibleLocations: [],
      isLoading: false,
      isAuthenticated: false,
      connectStatus: null,
      isPaymentReady: false,
      connectLoading: false,
      biometricCapabilities: null,
      biometricEnabled: false,
      currency: 'usd',
    });
    AsyncStorage.removeItem('currentLocationId').catch(() => {});

    // Show alert to user (translated to current locale)
    Alert.alert(
      translate('auth.sessionEndedTitle'),
      translate('auth.sessionEndedMessage'),
      [{ text: translate('auth.sessionEndedOk'), onPress: () => { sessionKickedAlertShown.current = false; } }]
    );
  }, []);

  // Set up the session kicked callbacks for both API client and socket
  useEffect(() => {
    setOnSessionKicked(handleSessionKicked);
    setOnSocketSessionKicked(handleSessionKicked);
  }, [handleSessionKicked]);

  // Load cached user/org and stop loading immediately if we have cached data
  const loadCachedAuth = useCallback(async (): Promise<boolean> => {
    try {
      logger.log('[AuthContext] loadCachedAuth: checking authentication...');
      const isAuthenticated = await authService.isAuthenticated();
      logger.log('[AuthContext] loadCachedAuth: isAuthenticated =', isAuthenticated);

      if (!isAuthenticated) {
        logger.log('[AuthContext] loadCachedAuth: no token, setting isLoading=false');
        setState(prev => ({ ...prev, isLoading: false }));
        return false;
      }

      // Try to get cached user/org/subscription
      const user = await authService.getUser();
      const organization = await authService.getOrganization();
      const subscription = await authService.getSubscription();
      logger.log('[AuthContext] loadCachedAuth: cached user =', user?.email, ', org =', organization?.name, ', subscription =', subscription?.tier);

      if (user && organization) {
        // We have cached data, show it immediately
        logger.log('[AuthContext] loadCachedAuth: using cached data');
        setState(prev => ({
          ...prev,
          user,
          organization,
          subscription,
          isLoading: false,
          isAuthenticated: true,
          currency: user.currency || 'usd',
        }));
        return true;
      }

      // Token exists but no cached data - keep isLoading true, refreshProfileFromAPI will handle it
      logger.log('[AuthContext] loadCachedAuth: token exists but no cached data');
      return false;
    } catch (error) {
      logger.error('[AuthContext] loadCachedAuth: error', error);
      setState(prev => ({ ...prev, isLoading: false }));
      return false;
    }
  }, []);

  // Fetch fresh profile data from API and update cache
  const refreshProfileFromAPI = useCallback(async (hadCachedData: boolean) => {
    try {
      const isAuthenticated = await authService.isAuthenticated();

      if (!isAuthenticated) {
        if (!hadCachedData) {
          setState(prev => ({ ...prev, isLoading: false }));
        }
        return;
      }

      try {
        const profile = await authService.getProfile();

        // Cache the fresh data
        await authService.saveUser(profile.user);
        await authService.saveOrganization(profile.organization);

        // Update state with fresh data
        const profileLocations: AccessibleLocation[] = (profile as any).accessibleLocations || [];
        setState(prev => ({
          ...prev,
          user: profile.user,
          organization: profile.organization,
          accessibleLocations: profileLocations.length > 0 ? profileLocations : prev.accessibleLocations,
          isLoading: false,
          isAuthenticated: true,
          currency: profile.user.currency || 'usd',
        }));
      } catch (error: any) {
        logger.error('Failed to fetch profile:', error);
        // If it's a 401, the API client already tried to refresh and failed
        // In that case, or any auth error, log the user out
        if (error?.statusCode === 401) {
          await authService.logout();
          setState({
            user: null,
            organization: null,
            subscription: null,
            accessibleLocations: [],
            isLoading: false,
            isAuthenticated: false,
            connectStatus: null,
            isPaymentReady: false,
            connectLoading: false,
            biometricCapabilities: null,
            biometricEnabled: false,
            currency: 'usd',
          });
        } else {
          // For other errors (network, 404, 500, etc.), keep the user logged in with cached data
          // Just stop loading if we didn't have cached data
          if (!hadCachedData) {
            setState(prev => ({ ...prev, isLoading: false }));
          }
        }
      }
    } catch (error) {
      logger.error('Failed to refresh profile:', error);
      // If we didn't have cached data, stop loading
      if (!hadCachedData) {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    }
  }, []);

  useEffect(() => {
    // Load cached data first (instant), then refresh from API in background
    loadCachedAuth().then((hadCachedData) => {
      refreshProfileFromAPI(hadCachedData);
    });
  }, [loadCachedAuth, refreshProfileFromAPI]);

  const signIn = async (email: string, password: string) => {
    // Reset session kicked state so API client and socket can operate normally
    apiClient.resetSessionKicked();
    const response = await authService.login({ email, password });

    // Persist the selected location to AsyncStorage so the API client injects
    // X-Location-Id on every request. Single-location users auto-select; multi-
    // location users keep whatever's already stored (LocationPickerScreen will
    // prompt them to pick if the stored id is missing or stale).
    const accessibleLocations: any[] = (response as any).accessibleLocations || [];
    if (accessibleLocations.length === 1) {
      await AsyncStorage.setItem('currentLocationId', accessibleLocations[0].id);
    } else if (accessibleLocations.length > 1) {
      const existing = await AsyncStorage.getItem('currentLocationId');
      const stillValid = existing && accessibleLocations.some((l: any) => l.id === existing);
      if (!stillValid) {
        const def = accessibleLocations.find((l: any) => l.isDefault) || accessibleLocations[0];
        await AsyncStorage.setItem('currentLocationId', def.id);
      }
    } else {
      await AsyncStorage.removeItem('currentLocationId');
    }

    setState(prev => ({
      ...prev,
      user: response.user,
      organization: response.organization,
      subscription: response.subscription || null,
      accessibleLocations,
      isLoading: false,
      isAuthenticated: true,
      connectLoading: true, // Reset to loading state for connect status
      currency: response.user.currency || 'usd',
    }));
  };

  const signOut = async () => {
    // Tell LoginScreen not to auto-trigger biometric on mount —
    // this is an intentional logout, not an app launch.
    await AsyncStorage.setItem(SKIP_BIOMETRIC_KEY, '1').catch(() => {});

    // Clear state immediately for instant UI transition
    setState({
      user: null,
      organization: null,
      subscription: null,
      accessibleLocations: [],
      isLoading: false,
      isAuthenticated: false,
      connectStatus: null,
      isPaymentReady: false,
      connectLoading: false,
      biometricCapabilities: null,
      biometricEnabled: false,
      currency: 'usd',
    });
    // Clear the location selection so the next login starts fresh
    await AsyncStorage.removeItem('currentLocationId').catch(() => {});
    // Clear local tokens + invalidate on server in background
    authService.logout().catch((error) => {
      logger.error('Logout error:', error);
    });
  };

  const refreshAuth = async () => {
    await refreshProfileFromAPI(true);
  };

  // Fetch Stripe Connect status
  const refreshConnectStatus = useCallback(async () => {
    try {
      const status = await stripeConnectApi.getStatus();
      // Only require chargesEnabled for Tap to Pay - payoutsEnabled is needed for receiving money
      // but users can still accept payments before completing full onboarding (bank account setup)
      const isReady = status.chargesEnabled;
      setState(prev => ({
        ...prev,
        connectStatus: status,
        isPaymentReady: isReady,
        connectLoading: false,
      }));
    } catch (error) {
      logger.error('Failed to fetch Connect status:', error);
      setState(prev => ({
        ...prev,
        connectStatus: null,
        isPaymentReady: false,
        connectLoading: false,
      }));
    }
  }, []);

  // Mark onboarding as complete
  const completeOnboarding = useCallback(async () => {
    try {
      await authService.completeOnboarding();
      // Update local user state and cache in one setState call to avoid stale closure
      setState(prev => {
        const updatedUser = prev.user ? { ...prev.user, onboardingCompleted: true } : null;
        if (updatedUser) {
          authService.saveUser(updatedUser).catch(err => logger.error('Failed to save user:', err));
        }
        return { ...prev, user: updatedUser };
      });
    } catch (error) {
      logger.error('Failed to complete onboarding:', error);
      // Don't throw - onboarding completion is not critical
    }
  }, []);

  // Fetch Connect status when authenticated
  useEffect(() => {
    if (state.isAuthenticated && !state.isLoading) {
      refreshConnectStatus();
    }
  }, [state.isAuthenticated, state.isLoading, refreshConnectStatus]);

  // Load biometric capabilities and status on startup
  const refreshBiometricStatus = useCallback(async () => {
    const capabilities = await checkBiometricCapabilities();
    let enabled = false;
    if (capabilities.isAvailable) {
      enabled = await isBiometricLoginEnabled();
    }
    setState(prev => ({
      ...prev,
      biometricCapabilities: capabilities,
      biometricEnabled: enabled,
    }));
  }, []);

  const setBiometricEnabled = useCallback((enabled: boolean) => {
    setState(prev => ({ ...prev, biometricEnabled: enabled }));
  }, []);

  useEffect(() => {
    if (state.isAuthenticated && !state.isLoading) {
      refreshBiometricStatus();
    }
  }, [state.isAuthenticated, state.isLoading, refreshBiometricStatus]);

  // Prefetch avatar image into native cache
  useEffect(() => {
    if (state.user?.avatarUrl) {
      Image.prefetch(state.user.avatarUrl).catch(() => {});
    }
  }, [state.user?.avatarUrl]);

  const value = useMemo(() => ({
    ...state,
    signIn,
    signOut,
    refreshAuth,
    refreshConnectStatus,
    completeOnboarding,
    setBiometricEnabled,
    refreshBiometricStatus,
  }), [state, signIn, signOut, refreshAuth, refreshConnectStatus, completeOnboarding, setBiometricEnabled, refreshBiometricStatus]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
