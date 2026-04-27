import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { authService } from '../lib/api';
import { useTheme } from '../context/ThemeContext';
import { useTranslations } from '../lib/i18n';

export function ResetPasswordScreen() {
  const { colors: themeColors } = useTheme();
  const t = useTranslations('auth');
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const token = route.params?.token;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const styles = createStyles(themeColors);

  const handleSubmit = async () => {
    if (!token) {
      setError(t('invalidResetToken'));
      return;
    }

    if (!password || !confirmPassword) {
      setError(t('fillBothPasswordFields'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('passwordsDoNotMatch'));
      return;
    }

    if (password.length < 8) {
      setError(t('resetPasswordMinLength'));
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await authService.resetPassword(token, password);
      setIsSuccess(true);
    } catch (err: any) {
      setError(err.error || err.message || t('failedToResetPassword'));
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

                <Text maxFontSizeMultiplier={1.2} style={styles.successTitle} accessibilityRole="header">{t('passwordResetSuccessTitle')}</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.successSubtitle}>
                  {t('passwordResetSuccessMessage')}
                </Text>

                <TouchableOpacity
                  style={styles.button}
                  onPress={() => navigation.navigate('Login')}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={t('backToLoginAccessibilityLabel')}
                >
                  <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>{t('backToLoginLink')}</Text>
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
                onPress={() => navigation.navigate('Login')}
                style={styles.backButton}
                accessibilityRole="link"
                accessibilityLabel={t('backToLoginAccessibilityLabel')}
              >
                <Ionicons name="arrow-back" size={20} color={themeColors.textSecondary} />
                <Text maxFontSizeMultiplier={1.3} style={styles.backButtonText}>{t('backToLoginLink')}</Text>
              </TouchableOpacity>

              {/* Header */}
              <View style={styles.header}>
                <Text maxFontSizeMultiplier={1.2} style={styles.title}>{t('resetYourPassword')}</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.subtitle}>{t('resetYourPasswordSubtitle')}</Text>
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
                    <Text maxFontSizeMultiplier={1.5} style={styles.label}>{t('newPasswordLabel')}</Text>
                    <View style={styles.inputContainer}>
                      <TextInput
                        style={[styles.input, styles.passwordInput]}
                        value={password}
                        onChangeText={setPassword}
                        placeholder={t('newPasswordPlaceholder')}
                        placeholderTextColor={themeColors.textMuted}
                        secureTextEntry={!showPasswords}
                        autoComplete="new-password"
                        accessibilityLabel={t('newPasswordAccessibilityLabel')}
                        accessibilityHint={t('newPasswordAccessibilityHint')}
                      />
                      <TouchableOpacity
                        onPress={() => setShowPasswords(!showPasswords)}
                        style={styles.showHideButton}
                        accessibilityRole="button"
                        accessibilityLabel={showPasswords ? t('hidePasswords') : t('showPasswords')}
                      >
                        <Ionicons
                          name={showPasswords ? 'eye-off-outline' : 'eye-outline'}
                          size={20}
                          color={themeColors.textSecondary}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text maxFontSizeMultiplier={1.5} style={styles.label}>{t('confirmNewPasswordLabel')}</Text>
                    <View style={styles.inputContainer}>
                      <TextInput
                        style={styles.input}
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        placeholder={t('confirmNewPasswordPlaceholder')}
                        placeholderTextColor={themeColors.textMuted}
                        secureTextEntry={!showPasswords}
                        autoComplete="new-password"
                        accessibilityLabel={t('confirmNewPasswordAccessibilityLabel')}
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[styles.button, loading && styles.buttonDisabled]}
                    onPress={handleSubmit}
                    disabled={loading || !token}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={loading ? t('resettingPasswordAccessibilityLabel') : t('resetPasswordAccessibilityLabel')}
                    accessibilityState={{ disabled: loading || !token, busy: loading }}
                  >
                    {loading ? (
                      <View style={styles.buttonContent}>
                        <ActivityIndicator color={themeColors.text} size="small" accessibilityLabel={t('resettingPasswordAccessibilityLabel')} />
                        <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>{t('resettingButton')}</Text>
                      </View>
                    ) : (
                      <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>{t('resetPasswordButton')}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Footer */}
              <View style={styles.footer}>
                <Text maxFontSizeMultiplier={1.5} style={styles.footerText}>{t('rememberPassword')}</Text>
                <TouchableOpacity onPress={() => navigation.navigate('Login')} accessibilityRole="link" accessibilityLabel={t('backToLoginAccessibilityLabel')}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.footerLink}>{t('backToLoginLink')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const createStyles = (themeColors: { background: string; card: string; border: string; inputBackground: string; inputBorder: string; [key: string]: any }) => StyleSheet.create({
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
    paddingVertical: 32,
  },
  contentWrapper: {
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    marginBottom: 16,
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
    backgroundColor: themeColors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: themeColors.border,
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
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: themeColors.inputBackground,
    borderWidth: 1,
    borderColor: themeColors.inputBorder,
    borderRadius: 16,
  },
  input: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: themeColors.text,
  },
  passwordInput: {
    paddingRight: 48,
  },
  showHideButton: {
    position: 'absolute',
    right: 12,
    padding: 8,
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
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 28,
  },
  footerText: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: themeColors.textMuted,
  },
  footerLink: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: themeColors.primary,
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
    marginBottom: 24,
  },
});
