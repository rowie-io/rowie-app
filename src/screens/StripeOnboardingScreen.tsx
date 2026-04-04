import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { stripeConnectApi } from '../lib/api';
import logger from '../lib/logger';
import { useTranslations } from '../lib/i18n';

type StripeOnboardingParams = {
  returnTo?: 'education' | 'settings' | 'home';
};

export function StripeOnboardingScreen() {
  const route = useRoute<RouteProp<{ params: StripeOnboardingParams }, 'params'>>();
  const returnTo = route.params?.returnTo;
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const { refreshConnectStatus } = useAuth();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');

  const [onboardingUrl, setOnboardingUrl] = useState<string | null>(null);
  const [isFetchingUrl, setIsFetchingUrl] = useState(true);
  const [isWebViewLoading, setIsWebViewLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasShownCompletion, setHasShownCompletion] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);

  const styles = createStyles(colors);

  // Fetch the onboarding URL when the screen mounts
  useEffect(() => {
    fetchOnboardingUrl();
  }, []);

  const fetchOnboardingUrl = async () => {
    try {
      setIsFetchingUrl(true);
      setError(null);
      logger.log('[StripeOnboarding] Fetching onboarding URL...');
      const response = await stripeConnectApi.getOnboardingLink();
      logger.log('[StripeOnboarding] Got onboarding URL:', response.onboardingUrl);
      setOnboardingUrl(response.onboardingUrl);
    } catch (err: any) {
      // If no connected account exists yet (404), create one automatically
      if (err.statusCode === 404) {
        logger.log('[StripeOnboarding] No account found, creating one...');
        try {
          const createResponse = await stripeConnectApi.createAccount();
          logger.log('[StripeOnboarding] Account created, got URL:', createResponse.onboardingUrl);
          setOnboardingUrl(createResponse.onboardingUrl);
          return;
        } catch (createErr: any) {
          logger.error('[StripeOnboarding] Failed to create account:', createErr);
          setError(createErr.message || t('errorCreateAccountDefault'));
          return;
        }
      }
      logger.error('[StripeOnboarding] Failed to get onboarding URL:', err);
      setError(err.message || t('errorLoadOnboardingDefault'));
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const handleClose = () => {
    logger.log('[StripeOnboarding] handleClose called, returnTo:', returnTo);
    // Refresh connect status when closing
    refreshConnectStatus();

    // Route based on returnTo parameter
    if (returnTo === 'education') {
      // Replace so StripeOnboarding is removed from the stack —
      // prevents loop where education's goBack() returns here
      navigation.replace('TapToPayEducation');
    } else if (returnTo === 'settings') {
      // Coming from Settings - go back to Settings
      navigation.goBack();
    } else {
      // Default: go back or to main tabs
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        });
      }
    }
  };

  // Intercept navigations before they load — catch the Stripe callback redirect
  // before the WebView renders the rowie-vendor page.
  // Stripe loads third-party resources (hcaptcha, analytics, iframes) so we can't
  // block everything non-Stripe. Instead, only intercept our own callback URL.
  const handleShouldStartLoad = (request: { url: string }) => {
    const { url } = request;
    logger.log('[StripeOnboarding] onShouldStartLoad:', url);

    // Allow everything during warmup (no onboarding URL yet)
    if (!onboardingUrl) return true;
    // Allow empty/blank pages
    if (!url || url === 'about:blank') return true;

    // Block only our callback URL — Stripe redirects here when onboarding completes.
    // The callback is configured as {dashboardUrl}/banking (e.g. portal.rowie.io/banking)
    // Covers: portal.rowie.io, dev.rowie.io, rowie.io, localhost:*
    const isCallbackRedirect =
      url.includes('rowie.io') || url.includes('localhost');

    if (isCallbackRedirect) {
      logger.log('[StripeOnboarding] Detected callback redirect, closing:', url);
      if (!hasShownCompletion) {
        setHasShownCompletion(true);
        handleClose();
      }
      return false;
    }

    return true;
  };

  // Show loading overlay while API is fetching or WebView is loading the Stripe page
  const showLoading = isFetchingUrl || (onboardingUrl && isWebViewLoading);

  // Cycle through loading messages to show progress
  const LOADING_STEPS = [
    t('loadingStep1'),
    t('loadingStep2'),
    t('loadingStep3'),
    t('loadingStep4'),
  ];

  useEffect(() => {
    if (!showLoading || error) return;
    const interval = setInterval(() => {
      setLoadingStep(prev => (prev + 1) % LOADING_STEPS.length);
    }, 2200);
    return () => clearInterval(interval);
  }, [showLoading, error]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel={t('closeAccessibilityLabel')}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} maxFontSizeMultiplier={1.3}>{t('headerTitle')}</Text>
        <View style={styles.placeholder} />
      </View>

      {/* WebView only mounts once the URL is ready — avoids booting WebKit on an empty page */}
      <View style={styles.webView}>
        {onboardingUrl && (
          <WebView
            ref={webViewRef}
            source={{ uri: onboardingUrl }}
            style={styles.webView}
            onShouldStartLoadWithRequest={handleShouldStartLoad}
            onLoadEnd={(event) => {
              logger.log('[StripeOnboarding] onLoadEnd, url:', event.nativeEvent.url);
              setIsWebViewLoading(false);
            }}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            contentMode="mobile"
            automaticallyAdjustContentInsets={false}
            scalesPageToFit={true}
          />
        )}

        {/* Loading overlay with progress steps */}
        {showLoading && !error && (
          <View style={[StyleSheet.absoluteFill, styles.loadingContainer]}>
            <View style={styles.loadingIconWrap}>
              <Ionicons name="shield-checkmark-outline" size={48} color={colors.primary} />
            </View>
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 24 }} />
            <Text style={styles.loadingTitle} maxFontSizeMultiplier={1.3}>
              {t('loadingTitle')}
            </Text>
            <Text style={styles.loadingStep} maxFontSizeMultiplier={1.5}>
              {LOADING_STEPS[loadingStep]}
            </Text>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, {
                width: isFetchingUrl ? '40%' : '75%',
              }]} />
            </View>
          </View>
        )}

        {/* Error overlay */}
        {error && (
          <View style={[StyleSheet.absoluteFill, styles.errorContainer]}>
            <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
            <Text style={styles.errorText} maxFontSizeMultiplier={1.5} accessibilityRole="alert">{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={fetchOnboardingUrl} accessibilityRole="button" accessibilityLabel={t('tryAgainButtonText')}>
              <Text style={styles.retryButtonText} maxFontSizeMultiplier={1.3}>{t('tryAgainButtonText')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    closeButton: {
      padding: 8,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.text,
    },
    placeholder: {
      width: 40,
    },
    loadingContainer: {
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
      padding: 32,
    },
    loadingIconWrap: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: `${colors.primary}15`,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: `${colors.primary}30`,
    },
    loadingTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      marginTop: 20,
      textAlign: 'center',
    },
    loadingStep: {
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 8,
      textAlign: 'center',
      minHeight: 20,
    },
    progressBarTrack: {
      width: 200,
      height: 4,
      borderRadius: 2,
      backgroundColor: `${colors.text}15`,
      marginTop: 24,
      overflow: 'hidden',
    },
    progressBarFill: {
      height: '100%',
      borderRadius: 2,
      backgroundColor: colors.primary,
    },
    errorContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
      gap: 16,
      backgroundColor: colors.background,
    },
    errorText: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    retryButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 8,
      marginTop: 8,
    },
    retryButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    webView: {
      flex: 1,
    },
  });
