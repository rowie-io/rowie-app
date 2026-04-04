import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { authService } from '../lib/api';
import { Input } from '../components/Input';
import { useTheme } from '../context/ThemeContext';
import { useTranslations } from '../lib/i18n';

export function ForgotPasswordScreen() {
  const { colors: themeColors } = useTheme();
  const t = useTranslations('auth');
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const styles = createStyles(themeColors);

  const handleSubmit = async () => {
    if (!email) {
      setError(t('enterEmailRequired'));
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await authService.requestPasswordReset(email.trim().toLowerCase());
      setIsSuccess(true);
    } catch (err: any) {
      setError(err.error || err.message || t('failedToSendResetEmail'));
    } finally {
      setLoading(false);
    }
  };

  // Success state
  if (isSuccess) {
    return (
      <View style={styles.screenBackground}>
        <SafeAreaView style={styles.container}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.contentWrapper}>
              <View style={styles.card}>
                <View style={styles.successIcon}>
                  <Text maxFontSizeMultiplier={1.2} style={styles.successIconText}>✓</Text>
                </View>

                <Text maxFontSizeMultiplier={1.2} style={styles.successTitle} accessibilityRole="header">{t('checkYourEmail')}</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.successSubtitle}>
                  {t('resetLinkSent')}
                </Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.successEmail}>{email}</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.successHint}>
                  {t('checkSpamFolder')}
                </Text>

                <TouchableOpacity
                  style={styles.button}
                  onPress={() => navigation.goBack()}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={t('backToLoginAccessibilityLabel')}
                >
                  <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>{t('backToLogin')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setIsSuccess(false);
                    setEmail('');
                  }}
                  style={styles.tryAgainButton}
                  accessibilityRole="button"
                  accessibilityLabel={t('tryDifferentEmailAccessibilityLabel')}
                >
                  <Text maxFontSizeMultiplier={1.3} style={styles.tryAgainText}>{t('tryDifferentEmail')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.screenBackground}>
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.contentWrapper}>
              {/* Back button */}
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                style={styles.backButton}
                accessibilityRole="link"
                accessibilityLabel={t('backToLoginAccessibilityLabel')}
              >
                <Text maxFontSizeMultiplier={1.3} style={styles.backButtonText}>{t('backToLoginArrow')}</Text>
              </TouchableOpacity>

              {/* Header */}
              <View style={styles.header}>
                <View style={styles.iconContainer}>
                  <Text maxFontSizeMultiplier={1.2} style={styles.iconText}>✉</Text>
                </View>
                <Text maxFontSizeMultiplier={1.2} style={styles.title}>{t('forgotPasswordTitle')}</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.subtitle}>
                  {t('forgotPasswordSubtitle')}
                </Text>
              </View>

              {/* Card */}
              <View style={styles.card}>
              {error && (
                <View style={styles.errorContainer} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                  <Text maxFontSizeMultiplier={1.5} style={styles.errorText}>{error}</Text>
                </View>
              )}

              <View style={styles.form}>
                <View style={styles.inputGroup}>
                  <Text maxFontSizeMultiplier={1.5} style={styles.label}>{t('emailLabel')}</Text>
                  <Input
                    icon="mail-outline"
                    value={email}
                    onChangeText={setEmail}
                    placeholder={t('emailPlaceholder')}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    accessibilityLabel={t('emailAccessibilityLabel')}
                    accessibilityHint={t('forgotPasswordEmailAccessibilityHint')}
                  />
                  <Text maxFontSizeMultiplier={1.5} style={styles.inputHint}>
                    {t('forgotPasswordEmailHint')}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.button, loading && styles.buttonDisabled]}
                  onPress={handleSubmit}
                  disabled={loading}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={loading ? t('sendingResetEmailAccessibilityLabel') : t('resetPasswordAccessibilityLabel')}
                  accessibilityState={{ disabled: loading, busy: loading }}
                >
                  {loading ? (
                    <View style={styles.buttonContent}>
                      <ActivityIndicator color={themeColors.text} size="small" accessibilityLabel={t('sendingResetEmailAccessibilityLabel')} />
                      <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>{t('sendingButton')}</Text>
                    </View>
                  ) : (
                    <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>{t('resetPasswordButton')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const createStyles = (themeColors: { background: string; card: string; border: string; [key: string]: any }) => StyleSheet.create({
  screenBackground: {
    flex: 1,
    backgroundColor: themeColors.background,
  },
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 40,
  },
  contentWrapper: {
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 24,
  },
  backButtonText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: themeColors.textSecondary,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconText: {
    fontSize: 32,
    color: themeColors.primary,
  },
  title: {
    fontSize: 28,
    fontFamily: fonts.bold,
    color: themeColors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: fonts.regular,
    color: themeColors.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: themeColors.border,
    backgroundColor: themeColors.card,
    padding: 24,
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  errorText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: themeColors.error,
  },
  form: {
    gap: 20,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: themeColors.textSecondary,
    marginLeft: 4,
  },
  inputHint: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: themeColors.textMuted,
    marginTop: 4,
    marginLeft: 4,
  },
  button: {
    backgroundColor: themeColors.primary,
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    ...shadows.md,
    shadowColor: themeColors.primary,
    shadowOpacity: 0.3,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  buttonText: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    color: '#fff',
  },
  // Success styles
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 24,
  },
  successIconText: {
    fontSize: 32,
    color: themeColors.success,
  },
  successTitle: {
    fontSize: 24,
    fontFamily: fonts.bold,
    color: themeColors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 15,
    fontFamily: fonts.regular,
    color: themeColors.textSecondary,
    textAlign: 'center',
  },
  successEmail: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    color: themeColors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  successHint: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: themeColors.textMuted,
    textAlign: 'center',
    marginBottom: 24,
  },
  tryAgainButton: {
    alignItems: 'center',
    marginTop: 12,
  },
  tryAgainText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: themeColors.primary,
  },
});
