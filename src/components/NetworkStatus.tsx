import React, { useEffect, useState, useRef } from 'react';
import { Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../context/ThemeContext';
import { fonts } from '../lib/fonts';
import { useTranslations } from '../lib/i18n';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

/**
 * Connectivity banner. Rendered as a normal layout row at the top of the app
 * (NOT an absolute overlay) so it pushes content down instead of covering
 * screen headers. Auto-hides shortly after connectivity is restored.
 */
export function NetworkStatus() {
  const { colors } = useTheme();
  const t = useTranslations('components.networkStatus');
  const insets = useSafeAreaInsets();
  const { isConnected } = useNetworkStatus();
  const [showBanner, setShowBanner] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isConnected === false) {
      setShowBanner(true);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else if (isConnected === true && showBanner) {
      // Show "Back Online" briefly then hide
      Animated.sequence([
        Animated.delay(1500),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => setShowBanner(false));
    }
  }, [isConnected, showBanner, fadeAnim]);

  if (!showBanner) return null;

  const isOffline = isConnected === false;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: isOffline ? colors.error : colors.success,
          paddingTop: insets.top + 8,
          opacity: fadeAnim,
        },
      ]}
      accessibilityRole="alert"
      accessibilityLabel={isOffline ? t('noInternetConnection') : t('backOnline')}
      accessibilityLiveRegion="assertive"
    >
      <Ionicons
        name={isOffline ? 'cloud-offline' : 'cloud-done'}
        size={18}
        color="#fff"
      />
      <Text style={styles.text} maxFontSizeMultiplier={1.5}>
        {isOffline ? t('noInternetConnection') : t('backOnline')}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Layout row (not position:absolute) — pushes the app content down while
    // visible so it never covers screen headers.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 12,
  },
  text: {
    color: '#fff',
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
});
