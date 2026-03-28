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

  const [onboardingUrl, setOnboardingUrl] = useState<string | null>(null);
  const [isFetchingUrl, setIsFetchingUrl] = useState(true);
  const [isWebViewLoading, setIsWebViewLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasShownCompletion, setHasShownCompletion] = useState(false);

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
      logger.error('[StripeOnboarding] Failed to get onboarding URL:', err);
      setError(err.message || 'Failed to load onboarding. Please try again.');
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} maxFontSizeMultiplier={1.3}>Banking</Text>
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

        {/* Loading overlay on top of WebView */}
        {showLoading && !error && (
          <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }]}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}

        {/* Error overlay */}
        {error && (
          <View style={[StyleSheet.absoluteFill, styles.errorContainer]}>
            <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
            <Text style={styles.errorText} maxFontSizeMultiplier={1.5} accessibilityRole="alert">{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={fetchOnboardingUrl} accessibilityRole="button" accessibilityLabel="Try Again">
              <Text style={styles.retryButtonText} maxFontSizeMultiplier={1.3}>Try Again</Text>
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
