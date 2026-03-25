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
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth, SKIP_BIOMETRIC_KEY } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Input } from '../components/Input';
import { colors, glass } from '../lib/colors';
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

// Key to track if user has been asked about biometric setup
const BIOMETRIC_PROMPT_SHOWN_KEY = 'biometric_prompt_shown';


export function LoginScreen() {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const glassColors = isDark ? glass.dark : glass.light;
  const navigation = useNavigation<any>();
  const { signIn, refreshAuth } = useAuth();
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

  const styles = createStyles(glassColors);

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
      setError('Biometric login failed. Please use your password.');
    } finally {
      setBiometricLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please enter email and password');
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
      setError(err.message || 'Invalid credentials');
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
        `Enable ${capabilities.biometricName}?`,
        `Would you like to use ${capabilities.biometricName} to sign in faster next time?`,
        [
          {
            text: 'Not Now',
            style: 'cancel',
          },
          {
            text: 'Enable',
            onPress: async () => {
              // Credentials already stored, just enable biometric
              const success = await enableBiometricLogin();
              if (success) {
                Alert.alert(
                  'Success',
                  `${capabilities.biometricName} login is now enabled. You can manage this in Settings.`
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
    <LinearGradient
      colors={['#030712', '#0c1a2d', '#030712']}
      locations={[0, 0.5, 1]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={styles.gradient}
    >
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
                accessibilityLabel="Rowie"
              />
              <Text maxFontSizeMultiplier={1.2} style={styles.title}>Sign In</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.subtitle}>Access your account to start taking payments</Text>
            </View>

            {/* Card */}
            <LinearGradient
              colors={['#111827', '#030712']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.card}
            >
              {error && (
                <View style={styles.errorContainer} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                  <Text maxFontSizeMultiplier={1.5} style={styles.errorText}>{error}</Text>
                </View>
              )}

              <View style={styles.form}>
                <View style={styles.inputGroup}>
                  <Text maxFontSizeMultiplier={1.5} style={styles.label}>Email</Text>
                  <Input
                    icon="mail-outline"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    accessibilityLabel="Email address"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text maxFontSizeMultiplier={1.5} style={styles.label}>Password</Text>
                  <Input
                    icon="lock-closed-outline"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Enter your password"
                    secureTextEntry={!showPassword}
                    autoComplete="password"
                    accessibilityLabel="Password"
                    rightIcon={
                      <TouchableOpacity
                        onPress={() => setShowPassword(!showPassword)}
                        style={styles.showHideButton}
                        accessibilityRole="button"
                        accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                      >
                        <Ionicons
                          name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                          size={20}
                          color={colors.gray400}
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
                  accessibilityLabel="Forgot password"
                >
                  <Text maxFontSizeMultiplier={1.3} style={styles.forgotPassword}>Forgot password?</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.button, loading && styles.buttonDisabled]}
                  onPress={handleLogin}
                  disabled={loading}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={loading ? 'Signing in' : 'Sign in'}
                  accessibilityState={{ disabled: loading, busy: loading }}
                >
                  {loading ? (
                    <View style={styles.buttonContent}>
                      <ActivityIndicator color={colors.text} size="small" accessibilityLabel="Signing in" />
                      <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>Signing in...</Text>
                    </View>
                  ) : (
                    <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>Sign in</Text>
                  )}
                </TouchableOpacity>

                {/* Apple TTPOi 1.7: Biometric login button */}
                {biometricCapabilities?.isAvailable && biometricEnabled && (
                  <>
                    <View style={styles.dividerContainer}>
                      <View style={styles.dividerLine} />
                      <Text maxFontSizeMultiplier={1.5} style={styles.dividerText}>or</Text>
                      <View style={styles.dividerLine} />
                    </View>

                    <TouchableOpacity
                      style={[styles.biometricButton, biometricLoading && styles.buttonDisabled]}
                      onPress={handleBiometricLogin}
                      disabled={biometricLoading}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={biometricLoading ? 'Authenticating with biometrics' : `Sign in with ${biometricCapabilities?.biometricName}`}
                      accessibilityState={{ disabled: biometricLoading, busy: biometricLoading }}
                    >
                      {biometricLoading ? (
                        <ActivityIndicator color={colors.primary} size="small" accessibilityLabel="Authenticating" />
                      ) : (
                        <>
                          <Ionicons
                            name={
                              biometricCapabilities.biometricName === 'Face ID' || biometricCapabilities.biometricName === 'Face Unlock'
                                ? 'scan-outline'
                                : 'finger-print-outline'
                            }
                            size={24}
                            color={colors.primary}
                          />
                          <Text maxFontSizeMultiplier={1.3} style={styles.biometricButtonText}>
                            Sign in with {biometricCapabilities.biometricName}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>

                    {storedEmail && (
                      <Text maxFontSizeMultiplier={1.5} style={styles.storedEmailText}>
                        Signed in as {storedEmail}
                      </Text>
                    )}
                  </>
                )}
              </View>
            </LinearGradient>

            {/* Footer */}
            <View style={styles.footer}>
              <Text maxFontSizeMultiplier={1.5} style={styles.footerText}>Don't have an account? </Text>
              <TouchableOpacity onPress={handleCreateAccount} accessibilityRole="link" accessibilityLabel="Create an account">
                <Text maxFontSizeMultiplier={1.3} style={styles.footerLink}>Create One</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </LinearGradient>
  );
}

const createStyles = (glassColors: typeof glass.dark) => StyleSheet.create({
  gradient: {
    flex: 1,
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
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: fonts.regular,
    color: colors.gray400,
    marginTop: 6,
    textAlign: 'center',
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: glassColors.border,
    padding: 24,
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
    backgroundColor: glassColors.backgroundElevated,
    ...shadows.lg,
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
    color: colors.error,
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
    color: colors.gray300,
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
    color: colors.primary,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    ...shadows.md,
    shadowColor: colors.primary,
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
    color: colors.gray500,
  },
  footerLink: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: colors.primary,
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
    backgroundColor: glassColors.border,
  },
  dividerText: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.gray500,
    paddingHorizontal: 16,
  },
  biometricButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: glassColors.background,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: glassColors.border,
    paddingVertical: 16,
  },
  biometricButtonText: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    color: colors.primary,
  },
  storedEmailText: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.gray500,
    textAlign: 'center',
    marginTop: 8,
  },
});

