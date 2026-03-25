import React, { useEffect, useState, useRef } from 'react';
import { Text, StyleSheet, Animated } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../context/ThemeContext';
import { fonts } from '../lib/fonts';

export function NetworkStatus() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const [showBanner, setShowBanner] = useState(false);
  const slideAnim = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const connected = state.isConnected && state.isInternetReachable !== false;
      setIsConnected(connected);
    });

    // Check initial state
    NetInfo.fetch().then((state) => {
      const connected = state.isConnected && state.isInternetReachable !== false;
      setIsConnected(connected);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isConnected === false) {
      setShowBanner(true);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 10,
      }).start();
    } else if (isConnected === true && showBanner) {
      // Show "Back Online" briefly then hide
      Animated.sequence([
        Animated.delay(1500),
        Animated.timing(slideAnim, {
          toValue: -100,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => setShowBanner(false));
    }
  }, [isConnected, showBanner, slideAnim]);

  if (!showBanner) return null;

  const isOffline = isConnected === false;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: isOffline ? colors.error : colors.success,
          paddingTop: insets.top + 8,
          transform: [{ translateY: slideAnim }],
        },
      ]}
      accessibilityRole="alert"
      accessibilityLabel={isOffline ? 'No Internet Connection' : 'Back Online'}
      accessibilityLiveRegion="assertive"
    >
      <Ionicons
        name={isOffline ? 'cloud-offline' : 'cloud-done'}
        size={18}
        color="#fff"
      />
      <Text style={styles.text} maxFontSizeMultiplier={1.5}>
        {isOffline ? 'No Internet Connection' : 'Back Online'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingBottom: 12,
    zIndex: 9999,
  },
  text: {
    color: '#fff',
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
});
