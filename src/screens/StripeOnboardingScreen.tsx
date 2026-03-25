import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { stripeConnectApi } from '../lib/api';
import logger from '../lib/logger';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Star component for Apple-style sparkle effect
function Star({ style, size = 8, color = 'rgba(255,255,255,0.8)' }: { style?: any; size?: number; color?: string }) {
  return (
    <View style={[{ position: 'absolute' }, style]}>
      <View style={{
        width: size,
        height: size,
        backgroundColor: color,
        borderRadius: size / 2,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: size * 1.5,
      }} />
    </View>
  );
}

// Four-point star for larger sparkles
function FourPointStar({ style, size = 16, color = 'rgba(255,255,255,0.9)' }: { style?: any; size?: number; color?: string }) {
  return (
    <View style={[{ position: 'absolute', width: size, height: size }, style]}>
      <View style={{
        position: 'absolute',
        left: size / 2 - 1,
        top: 0,
        width: 2,
        height: size,
        backgroundColor: color,
        borderRadius: 1,
      }} />
      <View style={{
        position: 'absolute',
        top: size / 2 - 1,
        left: 0,
        width: size,
        height: 2,
        backgroundColor: color,
        borderRadius: 1,
      }} />
      <View style={{
        position: 'absolute',
        left: size / 2 - 2,
        top: size / 2 - 2,
        width: 4,
        height: 4,
        backgroundColor: color,
        borderRadius: 2,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: size / 2,
      }} />
    </View>
  );
}

// Central glowing star for loading
function GlowingStar({ size = 32, color, glowColor, pulseAnim }: { size?: number; color: string; glowColor: string; pulseAnim: Animated.Value }) {
  return (
    <Animated.View style={{
      width: size * 2,
      height: size * 2,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: pulseAnim,
      transform: [{ scale: pulseAnim }],
    }}>
      <View style={{
        position: 'absolute',
        width: size * 1.5,
        height: size * 1.5,
        borderRadius: size,
        backgroundColor: glowColor,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: size,
      }} />
      <View style={{
        position: 'absolute',
        width: 3,
        height: size,
        backgroundColor: color,
        borderRadius: 1.5,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
      }} />
      <View style={{
        position: 'absolute',
        width: size,
        height: 3,
        backgroundColor: color,
        borderRadius: 1.5,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
      }} />
      <View style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: color,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 10,
      }} />
    </Animated.View>
  );
}

// Loading component with stars
function LoadingWithStars({ colors, isDark }: { colors: any; isDark: boolean }) {
  const sparkleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.7)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(sparkleAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(sparkleAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 8000,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const starColor = isDark ? '#fff' : colors.primary;
  const glowColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(99,102,241,0.2)';

  return (
    <Animated.View style={[loadingStyles.container, { backgroundColor: isDark ? '#09090b' : colors.background, opacity: fadeAnim }]}>
      <LinearGradient
        colors={isDark
          ? ['transparent', 'rgba(99, 102, 241, 0.08)', 'rgba(139, 92, 246, 0.05)', 'transparent']
          : ['transparent', 'rgba(99, 102, 241, 0.05)', 'rgba(139, 92, 246, 0.03)', 'transparent']
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View style={[StyleSheet.absoluteFill, { opacity: sparkleAnim }]}>
        <FourPointStar style={{ top: 40, left: 30 }} size={14} color={isDark ? 'rgba(255,255,255,0.7)' : 'rgba(99,102,241,0.4)'} />
        <Star style={{ top: 80, left: 70 }} size={4} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(99,102,241,0.3)'} />
        <Star style={{ top: 60, right: 50 }} size={6} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(139,92,246,0.35)'} />
        <FourPointStar style={{ top: 100, right: 35 }} size={12} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(99,102,241,0.3)'} />
        <Star style={{ top: 130, left: 45 }} size={3} color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(139,92,246,0.25)'} />
        <Star style={{ top: 70, left: SCREEN_WIDTH * 0.45 }} size={5} color={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(99,102,241,0.3)'} />
        <Star style={{ top: 150, right: 80 }} size={4} color={isDark ? 'rgba(255,255,255,0.45)' : 'rgba(139,92,246,0.25)'} />
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.subtract(1, sparkleAnim) }]}>
        <Star style={{ top: 50, left: 50 }} size={5} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(99,102,241,0.3)'} />
        <FourPointStar style={{ top: 85, right: 40 }} size={16} color={isDark ? 'rgba(255,255,255,0.6)' : 'rgba(139,92,246,0.35)'} />
        <Star style={{ top: 120, left: 30 }} size={4} color={isDark ? 'rgba(255,255,255,0.45)' : 'rgba(99,102,241,0.25)'} />
        <Star style={{ top: 75, left: SCREEN_WIDTH * 0.55 }} size={6} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(139,92,246,0.3)'} />
        <FourPointStar style={{ top: 35, right: 90 }} size={10} color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(99,102,241,0.25)'} />
        <Star style={{ top: 140, right: 55 }} size={3} color={isDark ? 'rgba(255,255,255,0.5)' : 'rgba(139,92,246,0.25)'} />
        <Star style={{ top: 95, left: 90 }} size={5} color={isDark ? 'rgba(255,255,255,0.55)' : 'rgba(99,102,241,0.3)'} />
      </Animated.View>

      <View style={loadingStyles.content}>
        <Animated.View style={{ transform: [{ rotate: rotation }] }}>
          <GlowingStar size={36} color={starColor} glowColor={glowColor} pulseAnim={pulseAnim} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    zIndex: 10,
  },
});

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
          <View style={StyleSheet.absoluteFill}>
            <LoadingWithStars colors={colors} isDark={isDark} />
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
