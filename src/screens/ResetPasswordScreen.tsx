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
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, glass } from '../lib/colors';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { authService } from '../lib/api';
import { useTheme } from '../context/ThemeContext';

export function ResetPasswordScreen() {
  const { isDark } = useTheme();
  const glassColors = isDark ? glass.dark : glass.light;
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const token = route.params?.token;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const styles = createStyles(glassColors);

  const handleSubmit = async () => {
    if (!token) {
      setError('Invalid or missing reset token');
      return;
    }

    if (!password || !confirmPassword) {
      setError('Please fill in both password fields');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await authService.resetPassword(token, password);
      setIsSuccess(true);
    } catch (err: any) {
      setError(err.error || err.message || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Success state
  if (isSuccess) {
    return (
      <LinearGradient
        colors={[colors.gray950, colors.background, colors.gray950]}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
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

                <Text maxFontSizeMultiplier={1.2} style={styles.successTitle} accessibilityRole="header">Password Reset Successful!</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.successSubtitle}>
                  Your password has been successfully reset. You can now log in with your new password.
                </Text>

                <TouchableOpacity
                  style={styles.button}
                  onPress={() => navigation.navigate('Login')}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Back to login"
                >
                  <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>Back to login</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={[colors.gray950, colors.background, colors.gray950]}
      locations={[0, 0.5, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
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
              {/* Header */}
              <View style={styles.header}>
                <Text maxFontSizeMultiplier={1.2} style={styles.title}>Reset Your Password</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.subtitle}>Enter your new password below</Text>
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
                    <Text maxFontSizeMultiplier={1.5} style={styles.label}>New Password</Text>
                    <View style={styles.inputContainer}>
                      <TextInput
                        style={[styles.input, styles.passwordInput]}
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Enter new password"
                        placeholderTextColor={colors.gray500}
                        secureTextEntry={!showPasswords}
                        autoComplete="new-password"
                        accessibilityLabel="New password"
                        accessibilityHint="Must be at least 8 characters"
                      />
                      <TouchableOpacity
                        onPress={() => setShowPasswords(!showPasswords)}
                        style={styles.showHideButton}
                        accessibilityRole="button"
                        accessibilityLabel={showPasswords ? 'Hide passwords' : 'Show passwords'}
                      >
                        <Ionicons
                          name={showPasswords ? 'eye-off-outline' : 'eye-outline'}
                          size={20}
                          color={colors.gray400}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text maxFontSizeMultiplier={1.5} style={styles.label}>Confirm New Password</Text>
                    <View style={styles.inputContainer}>
                      <TextInput
                        style={styles.input}
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        placeholder="Confirm new password"
                        placeholderTextColor={colors.gray500}
                        secureTextEntry={!showPasswords}
                        autoComplete="new-password"
                        accessibilityLabel="Confirm new password"
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[styles.button, loading && styles.buttonDisabled]}
                    onPress={handleSubmit}
                    disabled={loading || !token}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={loading ? 'Resetting password' : 'Reset password'}
                    accessibilityState={{ disabled: loading || !token, busy: loading }}
                  >
                    {loading ? (
                      <View style={styles.buttonContent}>
                        <ActivityIndicator color={colors.text} size="small" accessibilityLabel="Resetting password" />
                        <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>Resetting...</Text>
                      </View>
                    ) : (
                      <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>Reset password</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Footer */}
              <View style={styles.footer}>
                <Text maxFontSizeMultiplier={1.5} style={styles.footerText}>Remember your password? </Text>
                <TouchableOpacity onPress={() => navigation.navigate('Login')} accessibilityRole="link" accessibilityLabel="Back to login">
                  <Text maxFontSizeMultiplier={1.3} style={styles.footerLink}>Back to login</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
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
    paddingVertical: 32,
  },
  contentWrapper: {
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
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
    backgroundColor: glassColors.backgroundElevated,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: glassColors.border,
    padding: 24,
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
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: glassColors.background,
    borderWidth: 1,
    borderColor: glassColors.border,
    borderRadius: 16,
  },
  input: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.text,
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
    color: colors.success,
  },
  successTitle: {
    fontSize: 24,
    fontFamily: fonts.bold,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 15,
    fontFamily: fonts.regular,
    color: colors.gray400,
    textAlign: 'center',
    marginBottom: 24,
  },
});
