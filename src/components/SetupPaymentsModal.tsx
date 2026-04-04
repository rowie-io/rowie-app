/**
 * Setup Payments Modal
 * Prompts users to complete Stripe Connect onboarding before Tap to Pay
 *
 * This modal is shown to new users who haven't set up their payment processing
 * account yet. Stripe Connect must be configured before Tap to Pay can work.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { fonts } from '../lib/fonts';
import { brandGradient, brandGradientLight } from '../lib/colors';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslations } from '../lib/i18n';

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
  const t = useTranslations('components.setupPaymentsModal');
  const insets = useSafeAreaInsets();

  const styles = createStyles(colors);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      accessibilityViewIsModal={true}
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          {/* Icon */}
          <View style={styles.iconContainer}>
            <Ionicons
              name="card-outline"
              size={40}
              color={colors.primary}
              accessibilityLabel={t('title')}
            />
          </View>

          {/* Title */}
          <Text
            style={[styles.title, { color: colors.text }]}
            accessibilityRole="header"
            maxFontSizeMultiplier={1.2}
          >
            {t('title')}
          </Text>

          {/* Description */}
          <Text style={[styles.description, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
            {t('description')}
          </Text>

          {/* Feature bullets */}
          <View style={styles.featuresList}>
            {(['featureSecure', 'featureDirectDeposits', 'featureTimeline'] as const).map((key) => (
              <View key={key} style={styles.featureRow}>
                <Ionicons name="checkmark" size={16} color={colors.primary} />
                <Text style={[styles.featureText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>{t(key)}</Text>
              </View>
            ))}
          </View>

          {/* Actions */}
          <TouchableOpacity
            onPress={onSetup}
            activeOpacity={0.85}
            style={styles.setupButtonWrap}
            accessibilityRole="button"
            accessibilityLabel={t('setupButtonText')}
            accessibilityHint={t('setupButtonText')}
          >
            <LinearGradient
              colors={isDark ? brandGradient : brandGradientLight}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.setupButton}
            >
              <Text style={styles.setupButtonText} maxFontSizeMultiplier={1.3}>{t('setupButtonText')}</Text>
            </LinearGradient>
          </TouchableOpacity>

          {onSkip && (
            <TouchableOpacity
              onPress={onSkip}
              activeOpacity={0.7}
              style={styles.skipButton}
              accessibilityRole="button"
              accessibilityLabel={t('skipButtonText')}
              accessibilityHint={t('skipButtonText')}
            >
              <Text style={[styles.skipText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>{t('skipButtonText')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: any) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    card: {
      width: '100%',
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 24,
      alignItems: 'center',
    },
    iconContainer: {
      marginBottom: 16,
    },
    title: {
      fontSize: 20,
      fontFamily: fonts.bold,
      textAlign: 'center',
      marginBottom: 8,
    },
    description: {
      fontSize: 15,
      fontFamily: fonts.regular,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: 20,
    },
    featuresList: {
      width: '100%',
      marginBottom: 24,
      gap: 10,
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    featureText: {
      fontSize: 15,
      fontFamily: fonts.regular,
      flex: 1,
    },
    setupButtonWrap: {
      width: '100%',
    },
    setupButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      paddingHorizontal: 24,
      borderRadius: 14,
    },
    setupButtonText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: '#fff',
    },
    skipButton: {
      marginTop: 16,
      paddingVertical: 8,
    },
    skipText: {
      fontSize: 15,
      fontFamily: fonts.regular,
      textAlign: 'center',
    },
  });
