/**
 * Setup Payments Modal
 * Prompts users to complete Stripe Connect onboarding before Tap to Pay
 *
 * This modal is shown to new users who haven't set up their payment processing
 * account yet. Stripe Connect must be configured before Tap to Pay can work.
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../context/ThemeContext';
import { StarBackground } from './StarBackground';
import { glow } from '../lib/shadows';
import { radius, spacing } from '../lib/spacing';

interface SetupPaymentsModalProps {
  visible: boolean;
  isLoading?: boolean;
  onSetup: () => void;
  onSkip?: () => void;
}

export function SetupPaymentsModal({
  visible,
  isLoading = false,
  onSetup,
  onSkip,
}: SetupPaymentsModalProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const iconPulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ]).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(iconPulseAnim, {
            toValue: 1.08,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(iconPulseAnim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [visible]);

  const styles = createStyles(colors, isDark);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      accessibilityViewIsModal={true}
    >
      <StarBackground colors={colors} isDark={isDark}>
        <View style={[styles.container, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 20 }]}>
          <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            {/* Icon */}
            <Animated.View
              style={{ transform: [{ scale: iconPulseAnim }], marginBottom: spacing.xl }}
              accessibilityLabel="Payment card icon"
            >
              <LinearGradient
                colors={[colors.primary, colors.primary700]}
                style={styles.iconGradient}
              >
                <Ionicons name="card" size={36} color="#fff" />
              </LinearGradient>
            </Animated.View>

            {/* Title */}
            <Text
              style={styles.title}
              accessibilityRole="header"
              maxFontSizeMultiplier={1.2}
            >
              Set Up Payments
            </Text>

            {/* Description */}
            <Text style={styles.description} maxFontSizeMultiplier={1.5}>
              Connect your bank account to start accepting payments. This only takes a few minutes.
            </Text>

            {/* Features */}
            <View style={styles.featuresList}>
              {[
                { icon: 'shield-checkmark', text: 'Secure payment processing' },
                { icon: 'cash', text: 'Direct deposits to your bank' },
                { icon: 'time', text: 'Takes about 5 minutes' },
              ].map((feature, index) => (
                <View key={index} style={styles.featureRow}>
                  <View style={styles.featureIconBg}>
                    <Ionicons name={feature.icon as any} size={18} color={colors.primary} />
                  </View>
                  <Text style={styles.featureText} maxFontSizeMultiplier={1.5}>{feature.text}</Text>
                </View>
              ))}
            </View>
          </Animated.View>

          {/* Bottom actions */}
          <Animated.View style={[styles.bottomActions, { opacity: fadeAnim, paddingBottom: insets.bottom > 0 ? 0 : spacing.md }]}>
            <TouchableOpacity
              onPress={onSetup}
              activeOpacity={0.9}
              style={styles.setupButtonWrapper}
              accessibilityRole="button"
              accessibilityLabel="Set Up Payments"
              accessibilityHint="Opens Stripe Connect to set up your payment processing account"
            >
              <LinearGradient
                colors={[colors.primary, colors.primary700]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.setupButton}
              >
                <Text style={styles.setupButtonText} maxFontSizeMultiplier={1.3}>Set Up Payments</Text>
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </LinearGradient>
            </TouchableOpacity>

            {onSkip && (
              <TouchableOpacity
                onPress={onSkip}
                activeOpacity={0.7}
                style={styles.skipButton}
                accessibilityRole="button"
                accessibilityLabel="Skip for now"
                accessibilityHint="Skip payment setup and go to the app. You can set up payments later in Settings."
              >
                <Text style={styles.skipText} maxFontSizeMultiplier={1.3}>I'll do this later</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </View>
      </StarBackground>
    </Modal>
  );
}

const createStyles = (colors: any, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: spacing.xl,
      justifyContent: 'space-between',
    },
    content: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
    },
    iconGradient: {
      width: 88,
      height: 88,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.4,
      shadowRadius: 24,
      elevation: 12,
    },
    title: {
      fontSize: 28,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginBottom: spacing.sm,
      letterSpacing: -0.5,
    },
    description: {
      fontSize: 16,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 24,
      marginBottom: spacing.xl,
      paddingHorizontal: spacing.md,
    },
    featuresList: {
      width: '100%',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.03)',
      borderRadius: radius.xl,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)',
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: 10,
    },
    featureIconBg: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: colors.primary + '18',
      alignItems: 'center',
      justifyContent: 'center',
    },
    featureText: {
      fontSize: 15,
      color: colors.text,
      flex: 1,
      fontWeight: '500',
    },
    bottomActions: {
      width: '100%',
      alignItems: 'center',
    },
    setupButtonWrapper: {
      width: '100%',
      ...glow(colors.primary, 'subtle'),
    },
    setupButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: 18,
      borderRadius: radius.lg,
    },
    setupButtonText: {
      fontSize: 17,
      fontWeight: '600',
      color: '#fff',
    },
    skipButton: {
      marginTop: spacing.lg,
      paddingVertical: spacing.sm,
    },
    skipText: {
      fontSize: 15,
      color: colors.textMuted,
      textAlign: 'center',
    },
  });
