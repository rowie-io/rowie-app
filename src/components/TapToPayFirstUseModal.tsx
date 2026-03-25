/**
 * First-use modal for Tap to Pay on iPhone
 * Apple TTPOi Requirement 3.2: Make merchants aware that TTP is available
 *
 * Shows on first payment attempt to educate merchants about TTP functionality
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';

import { useTheme } from '../context/ThemeContext';
import { glass } from '../lib/colors';
import { shadows } from '../lib/shadows';

// Apple TTPOi 5.4: Region-correct copy
const TAP_TO_PAY_NAME = Platform.OS === 'ios' ? 'Tap to Pay on iPhone' : 'Tap to Pay';

interface TapToPayFirstUseModalProps {
  visible: boolean;
  onLearnMore: () => void;
  onSkip: () => void;
  onProceed: () => void;
}

export function TapToPayFirstUseModal({
  visible,
  onLearnMore,
  onSkip,
  onProceed,
}: TapToPayFirstUseModalProps) {
  const { colors, isDark } = useTheme();
  const glassColors = isDark ? glass.dark : glass.light;
  const styles = createStyles(colors, glassColors, isDark);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <BlurView intensity={80} style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.card}>
            {/* Icon */}
            <View style={styles.iconContainer}>
              <LinearGradient
                colors={[colors.primary, colors.primary700]}
                style={styles.iconGradient}
              >
                <View style={styles.iconInner}>
                  <Ionicons name="wifi" size={32} color="#fff" style={styles.wifiIcon} />
                </View>
              </LinearGradient>
            </View>

            {/* Title */}
            <Text style={styles.title} maxFontSizeMultiplier={1.3}>Welcome to {TAP_TO_PAY_NAME}</Text>

            {/* Description */}
            <Text style={styles.description} maxFontSizeMultiplier={1.5}>
              Accept contactless payments directly on your device. No additional hardware needed.
            </Text>

            {/* Features list */}
            <View style={styles.featuresList}>
              <View style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={styles.featureText} maxFontSizeMultiplier={1.5}>Quick and secure payments</Text>
              </View>
              <View style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={styles.featureText} maxFontSizeMultiplier={1.5}>Works with cards and digital wallets</Text>
              </View>
              <View style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={styles.featureText} maxFontSizeMultiplier={1.5}>No card reader required</Text>
              </View>
            </View>

            {/* Learn More Link */}
            <TouchableOpacity style={styles.learnMoreButton} onPress={onLearnMore} accessibilityRole="button" accessibilityLabel="Learn how Tap to Pay works">
              <Ionicons name="school-outline" size={18} color={colors.primary} />
              <Text style={styles.learnMoreText} maxFontSizeMultiplier={1.5}>Learn how it works</Text>
            </TouchableOpacity>

            {/* Apple Terms Link - Apple TTPOi 3.3 */}
            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={styles.termsLink}
                onPress={() => Linking.openURL('https://www.apple.com/legal/privacy/en-ww/tap-to-pay/')}
                accessibilityRole="link"
                accessibilityLabel="Apple Tap to Pay Privacy Policy"
                accessibilityHint="Opens the Apple privacy policy in your browser"
              >
                <Ionicons name="shield-checkmark-outline" size={14} color={colors.textMuted} />
                <Text style={styles.termsLinkText} maxFontSizeMultiplier={1.5}>
                  Apple Tap to Pay Privacy Policy
                </Text>
              </TouchableOpacity>
            )}

            {/* Action Buttons */}
            <View style={styles.buttonContainer}>
              <TouchableOpacity style={styles.skipButton} onPress={onSkip} accessibilityRole="button" accessibilityLabel="Maybe later" accessibilityHint="Skips Tap to Pay setup for now">
                <Text style={styles.skipButtonText} maxFontSizeMultiplier={1.3}>Maybe later</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={onProceed} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel="Got it, let's go!" accessibilityHint="Proceeds with Tap to Pay setup">
                <LinearGradient
                  colors={[colors.primary, colors.primary700]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.proceedButton}
                >
                  <Text style={styles.proceedButtonText} maxFontSizeMultiplier={1.3}>Got it, let's go!</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </BlurView>
    </Modal>
  );
}

const createStyles = (colors: any, glassColors: typeof glass.dark, isDark: boolean) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    container: {
      width: '90%',
      maxWidth: 400,
    },
    card: {
      // Use solid opaque background instead of glass for better readability
      backgroundColor: isDark ? '#1f2937' : '#ffffff',
      borderRadius: 24,
      padding: 24,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
      ...shadows.xl,
    },
    iconContainer: {
      marginBottom: 20,
    },
    iconGradient: {
      width: 80,
      height: 80,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.md,
    },
    iconInner: {
      width: 50,
      height: 50,
      alignItems: 'center',
      justifyContent: 'center',
    },
    wifiIcon: {
      transform: [{ rotate: '90deg' }],
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 12,
    },
    description: {
      fontSize: 15,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: 20,
    },
    featuresList: {
      width: '100%',
      backgroundColor: isDark ? '#111827' : '#f3f4f6',
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
    },
    featureText: {
      fontSize: 14,
      color: colors.text,
      flex: 1,
    },
    learnMoreButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 12,
      marginBottom: 20,
    },
    learnMoreText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.primary,
    },
    termsLink: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginBottom: 16,
    },
    termsLinkText: {
      fontSize: 12,
      color: colors.textMuted,
      textDecorationLine: 'underline',
    },
    buttonContainer: {
      flexDirection: 'row',
      gap: 12,
      width: '100%',
    },
    skipButton: {
      flex: 1,
      paddingVertical: 16,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? '#111827' : '#f3f4f6',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
    },
    skipButtonText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    proceedButton: {
      flex: 1,
      paddingVertical: 16,
      paddingHorizontal: 24,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 140,
      ...shadows.sm,
    },
    proceedButtonText: {
      fontSize: 15,
      fontWeight: '600',
      color: '#fff',
    },
  });
