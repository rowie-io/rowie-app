import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  ScrollView,
  Linking,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, SKIP_BIOMETRIC_KEY } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Input } from '../components/Input';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { config } from '../lib/config';
import {
  checkBiometricCapabilities,
  isBiometricLoginEnabled,
  getBiometricCredentials,
  getStoredEmail,
  storeCredentials,
  enableBiometricLogin,
  BiometricCapabilities,
} from '../lib/biometricAuth';
import { authService } from '../lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import logger from '../lib/logger';
import { useTranslations } from '../lib/i18n';

// Key to track if user has been asked about biometric setup
const BIOMETRIC_PROMPT_SHOWN_KEY = 'biometric_prompt_shown';


export function LoginScreen() {
  const { colors: themeColors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { signIn, refreshAuth } = useAuth();
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Apple TTPOi 1.7: Biometric authentication support
  const [biometricCapabilities, setBiometricCapabilities] = useState<BiometricCapabilities | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [storedEmail, setStoredEmail] = useState<string | null>(null);

  const styles = createStyles(themeColors);

  // Check biometric capabilities and stored credentials on mount
  useEffect(() => {
    const checkBiometric = async () => {
      const capabilities = await checkBiometricCapabilities();
      setBiometricCapabilities(capabilities);

      if (capabilities.isAvailable) {
        const enabled = await isBiometricLoginEnabled();
        setBiometricEnabled(enabled);

        if (enabled) {
          const email = await getStoredEmail();
          setStoredEmail(email);
        }
      }
    };
    checkBiometric();
  }, []);

  // Auto-trigger biometric only on initial mount (app launch), not on every focus.
  // Skip if the user just logged out intentionally (signOut sets SKIP_BIOMETRIC_KEY).
  const hasAttemptedBiometricRef = React.useRef(false);
  useEffect(() => {
    if (biometricEnabled && biometricCapabilities?.isAvailable && !hasAttemptedBiometricRef.current) {
      hasAttemptedBiometricRef.current = true;

      const maybePrompt = async () => {
        const skip = await AsyncStorage.getItem(SKIP_BIOMETRIC_KEY).catch(() => null);
        // Clear the flag regardless so it only applies once
        await AsyncStorage.removeItem(SKIP_BIOMETRIC_KEY).catch(() => {});
        if (skip) {
          logger.log('[Login] Skipping auto biometric — user just logged out');
          return;
        }
        handleBiometricLogin();
      };

      // Small delay to let the screen render first
      const timer = setTimeout(maybePrompt, 500);
      return () => clearTimeout(timer);
    }
  }, [biometricEnabled, biometricCapabilities]);

  // Handle biometric login
  const handleBiometricLogin = async () => {
    if (!biometricCapabilities?.isAvailable || biometricLoading) return;

    setBiometricLoading(true);
    setError(null);

    try {
      const credentials = await getBiometricCredentials();

      if (!credentials) {
        // User cancelled or no stored credentials
        setBiometricLoading(false);
        return;
      }

      // Use stored email/password to login
      logger.log('[Login] Biometric login with stored credentials for:', credentials.email);
      await signIn(credentials.email, credentials.password);
      logger.log('[Login] Biometric login successful');
    } catch (err: any) {
      logger.error('[Login] Biometric login failed:', err);
      setError(t('biometricLoginFailed'));
    } finally {
      setBiometricLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      setError(t('emailAndPasswordRequired'));
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();
      await signIn(trimmedEmail, password);

      // Always store credentials securely for potential biometric use
      await storeCredentials(trimmedEmail, password);

      // After successful login, prompt for biometric setup if available
      promptForBiometricSetup();
    } catch (err: any) {
      // authService.login goes through apiClient.post('/auth/login') which
      // throws ApiError {error, ...} — prefer `.error` so the API's reason
      // (e.g. "user is disabled") isn't masked by the generic fallback.
      setError(err?.error || err?.message || t('invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  // Prompt user to enable biometric login after successful password login
  const promptForBiometricSetup = async () => {
    try {
      // Check if biometrics are available
      const capabilities = await checkBiometricCapabilities();
      if (!capabilities.isAvailable) return;

      // Check if already enabled
      const alreadyEnabled = await isBiometricLoginEnabled();
      if (alreadyEnabled) return;

      // Check if we've already asked this user
      const promptShown = await AsyncStorage.getItem(BIOMETRIC_PROMPT_SHOWN_KEY);
      if (promptShown === 'true') return;

      // Mark that we've shown the prompt (so we don't ask again if they decline)
      await AsyncStorage.setItem(BIOMETRIC_PROMPT_SHOWN_KEY, 'true');

      // Small delay to let the app transition to authenticated state
      await new Promise(resolve => setTimeout(resolve, 800));

      // Ask user if they want to enable biometric login
      Alert.alert(
        t('enableBiometricTitle', { biometricName: capabilities.biometricName }),
        t('enableBiometricMessage', { biometricName: capabilities.biometricName }),
        [
          {
            text: t('notNow'),
            style: 'cancel',
          },
          {
            text: t('enable'),
            onPress: async () => {
              // Credentials already stored, just enable biometric
              const success = await enableBiometricLogin();
              if (success) {
                Alert.alert(
                  t('successTitle'),
                  t('biometricEnabledMessage', { biometricName: capabilities.biometricName })
                );
              }
            },
          },
        ]
      );
    } catch (error) {
      logger.error('[Login] Error prompting for biometric setup:', error);
      // Silently fail - don't disrupt the login flow
    }
  };

  const handleForgotPassword = () => {
    navigation.navigate('ForgotPassword');
  };

  const handleCreateAccount = () => {
    navigation.navigate('SignUp');
  };

  return (
    <View style={styles.screenBackground}>
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.header}>
              <Image
                source={require('../../assets/rowie-wordmark.png')}
                style={styles.wordmark}
                resizeMode="contain"
                accessibilityLabel={t('rowieAccessibilityLabel')}
              />
              <Text maxFontSizeMultiplier={1.2} style={styles.title}>{t('loginTitle')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.subtitle}>{t('loginSubtitle')}</Text>
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
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text maxFontSizeMultiplier={1.5} style={styles.label}>{t('passwordLabel')}</Text>
                  <Input
                    icon="lock-closed-outline"
                    value={password}
                    onChangeText={setPassword}
                    placeholder={t('passwordPlaceholder')}
                    secureTextEntry={!showPassword}
                    autoComplete="password"
                    accessibilityLabel={t('passwordAccessibilityLabel')}
                    rightIcon={
                      <TouchableOpacity
                        onPress={() => setShowPassword(!showPassword)}
                        style={styles.showHideButton}
                        accessibilityRole="button"
                        accessibilityLabel={showPassword ? t('hidePassword') : t('showPassword')}
                      >
                        <Ionicons
                          name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                          size={20}
                          color={themeColors.textSecondary}
                        />
                      </TouchableOpacity>
                    }
                  />
                </View>

                {/* Forgot Password */}
                <TouchableOpacity
                  onPress={handleForgotPassword}
                  style={styles.forgotPasswordButton}
                  accessibilityRole="link"
                  accessibilityLabel={t('forgotPasswordAccessibilityLabel')}
                >
                  <Text maxFontSizeMultiplier={1.3} style={styles.forgotPassword}>{t('forgotPasswordLink')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.button, loading && styles.buttonDisabled]}
                  onPress={handleLogin}
                  disabled={loading}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={loading ? t('signingInAccessibilityLabel') : t('signInAccessibilityLabel')}
                  accessibilityState={{ disabled: loading, busy: loading }}
                >
                  {loading ? (
                    <View style={styles.buttonContent}>
                      <ActivityIndicator color={themeColors.text} size="small" accessibilityLabel={t('signingInAccessibilityLabel')} />
                      <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>{t('signingInButton')}</Text>
                    </View>
                  ) : (
                    <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>{t('signInButton')}</Text>
                  )}
                </TouchableOpacity>

                {/* Apple TTPOi 1.7: Biometric login button */}
                {biometricCapabilities?.isAvailable && biometricEnabled && (
                  <>
                    <View style={styles.dividerContainer}>
                      <View style={styles.dividerLine} />
                      <Text maxFontSizeMultiplier={1.5} style={styles.dividerText}>{t('dividerOr')}</Text>
                      <View style={styles.dividerLine} />
                    </View>

                    <TouchableOpacity
                      style={[styles.biometricButton, biometricLoading && styles.buttonDisabled]}
                      onPress={handleBiometricLogin}
                      disabled={biometricLoading}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={biometricLoading ? t('biometricAuthenticatingAccessibilityLabel') : t('signInWithBiometricAccessibilityLabel', { biometricName: biometricCapabilities?.biometricName })}
                      accessibilityState={{ disabled: biometricLoading, busy: biometricLoading }}
                    >
                      {biometricLoading ? (
                        <ActivityIndicator color={themeColors.primary} size="small" accessibilityLabel={t('authenticatingAccessibilityLabel')} />
                      ) : (
                        <>
                          <Ionicons
                            name={
                              biometricCapabilities.biometricName === 'Face ID' || biometricCapabilities.biometricName === 'Face Unlock'
                                ? 'scan-outline'
                                : 'finger-print-outline'
                            }
                            size={24}
                            color={themeColors.primary}
                          />
                          <Text maxFontSizeMultiplier={1.3} style={styles.biometricButtonText}>
                            {t('signInWithBiometric', { biometricName: biometricCapabilities.biometricName })}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>

                    {storedEmail && (
                      <Text maxFontSizeMultiplier={1.5} style={styles.storedEmailText}>
                        {t('signedInAs', { email: storedEmail })}
                      </Text>
                    )}
                  </>
                )}
              </View>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
              <Text maxFontSizeMultiplier={1.5} style={styles.footerText}>{t('dontHaveAccount')}</Text>
              <TouchableOpacity onPress={handleCreateAccount} accessibilityRole="link" accessibilityLabel={t('createAccountAccessibilityLabel')}>
                <Text maxFontSizeMultiplier={1.3} style={styles.footerLink}>{t('createOne')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </View>
  );
}

const createStyles = (c: { [key: string]: any }) => StyleSheet.create({
  screenBackground: {
    flex: 1,
    backgroundColor: c.background,
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
    paddingTop: 16,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    width: 120,
    height: 120,
    borderRadius: 28,
    marginBottom: 8,
  },
  wordmark: {
    width: 260,
    height: 104,
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontFamily: fonts.bold,
    color: c.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: fonts.regular,
    color: c.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.border,
    padding: 24,
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
    backgroundColor: c.card,
  },
  errorContainer: {
    backgroundColor: c.errorBg,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  errorText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: c.error,
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
    color: c.textSecondary,
    marginLeft: 4,
  },
  showHideButton: {
    position: 'absolute',
    right: 12,
    padding: 8,
  },
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginTop: -8,
  },
  forgotPassword: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: c.primary,
  },
  button: {
    backgroundColor: c.primary,
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
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
    color: c.textMuted,
  },
  footerLink: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: c.primary,
  },
  // Apple TTPOi 1.7: Biometric login styles
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: c.border,
  },
  dividerText: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: c.textMuted,
    paddingHorizontal: 16,
  },
  biometricButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: c.background,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: 16,
  },
  biometricButtonText: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    color: c.primary,
  },
  storedEmailText: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: c.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});

