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
import { BlurView } from 'expo-blur';

import { useTheme } from '../context/ThemeContext';
import { shadows } from '../lib/shadows';
import { useTranslations } from '../lib/i18n';

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
  const t = useTranslations('components.tapToPayFirstUse');
  const styles = createStyles(colors, isDark);

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
              <View style={[styles.iconGradient, { backgroundColor: colors.primary }]}>
                <View style={styles.iconInner}>
                  <Ionicons name="wifi" size={32} color="#fff" style={styles.wifiIcon} />
                </View>
              </View>
            </View>

            {/* Title */}
            <Text style={styles.title} maxFontSizeMultiplier={1.3}>{t('welcomeTitle', { name: TAP_TO_PAY_NAME })}</Text>

            {/* Description */}
            <Text style={styles.description} maxFontSizeMultiplier={1.5}>
              {t('description')}
            </Text>

            {/* Features list */}
            <View style={styles.featuresList}>
              <View style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={styles.featureText} maxFontSizeMultiplier={1.5}>{t('featureQuickSecure')}</Text>
              </View>
              <View style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={styles.featureText} maxFontSizeMultiplier={1.5}>{t('featureCardsWallets')}</Text>
              </View>
              <View style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={styles.featureText} maxFontSizeMultiplier={1.5}>{t('featureNoCardReader')}</Text>
              </View>
            </View>

            {/* Learn More Link */}
            <TouchableOpacity style={styles.learnMoreButton} onPress={onLearnMore} accessibilityRole="button" accessibilityLabel={t('learnMore')}>
              <Ionicons name="school-outline" size={18} color={colors.primary} />
              <Text style={styles.learnMoreText} maxFontSizeMultiplier={1.5}>{t('learnMore')}</Text>
            </TouchableOpacity>

            {/* Apple Terms Link - Apple TTPOi 3.3 */}
            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={styles.termsLink}
                onPress={() => Linking.openURL('https://www.apple.com/legal/privacy/en-ww/tap-to-pay/')}
                accessibilityRole="link"
                accessibilityLabel={t('applePrivacyPolicy')}
                accessibilityHint={t('applePrivacyPolicy')}
              >
                <Ionicons name="shield-checkmark-outline" size={14} color={colors.textMuted} />
                <Text style={styles.termsLinkText} maxFontSizeMultiplier={1.5}>
                  {t('applePrivacyPolicy')}
                </Text>
              </TouchableOpacity>
            )}

            {/* Action Buttons */}
            <View style={styles.buttonContainer}>
              <TouchableOpacity style={styles.skipButton} onPress={onSkip} accessibilityRole="button" accessibilityLabel={t('skipButton')} accessibilityHint={t('skipButton')}>
                <Text style={styles.skipButtonText} maxFontSizeMultiplier={1.3}>{t('skipButton')}</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={onProceed} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel={t('proceedButton')} accessibilityHint={t('proceedButton')}>
                <View style={[styles.proceedButton, { backgroundColor: colors.primary }]}>
                  <Text style={styles.proceedButtonText} maxFontSizeMultiplier={1.3}>{t('proceedButton')}</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </BlurView>
    </Modal>
  );
}

const createStyles = (colors: any, isDark: boolean) =>
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
      // Solid opaque background for readability
      backgroundColor: isDark ? '#292524' : '#FFFFFF',
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
      backgroundColor: isDark ? '#292524' : '#F5F5F4',
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
      backgroundColor: isDark ? '#292524' : '#F5F5F4',
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
