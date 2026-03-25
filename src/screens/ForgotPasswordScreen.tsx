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
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, glass } from '../lib/colors';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { authService } from '../lib/api';
import { Input } from '../components/Input';
import { useTheme } from '../context/ThemeContext';

export function ForgotPasswordScreen() {
  const { isDark } = useTheme();
  const glassColors = isDark ? glass.dark : glass.light;
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const styles = createStyles(glassColors);

  const handleSubmit = async () => {
    if (!email) {
      setError('Please enter your email address');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await authService.requestPasswordReset(email.trim().toLowerCase());
      setIsSuccess(true);
    } catch (err: any) {
      setError(err.error || err.message || 'Failed to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Success state
  if (isSuccess) {
    return (
      <LinearGradient
        colors={['#030712', '#0c1a2d', '#030712']}
        locations={[0, 0.5, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.gradient}
      >
        <SafeAreaView style={styles.container}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.contentWrapper}>
              <LinearGradient
                colors={['#111827', '#030712']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.card}
              >
                <View style={styles.successIcon}>
                  <Text maxFontSizeMultiplier={1.2} style={styles.successIconText}>✓</Text>
                </View>

                <Text maxFontSizeMultiplier={1.2} style={styles.successTitle} accessibilityRole="header">Check your email</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.successSubtitle}>
                  We've sent a password reset link to
                </Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.successEmail}>{email}</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.successHint}>
                  If you don't see the email, check your spam folder.
                </Text>

                <TouchableOpacity
                  style={styles.button}
                  onPress={() => navigation.goBack()}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Back to login"
                >
                  <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>Back to login</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setIsSuccess(false);
                    setEmail('');
                  }}
                  style={styles.tryAgainButton}
                  accessibilityRole="button"
                  accessibilityLabel="Try a different email"
                >
                  <Text maxFontSizeMultiplier={1.3} style={styles.tryAgainText}>Try a different email</Text>
                </TouchableOpacity>
              </LinearGradient>
            </View>
          </ScrollView>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={['#030712', '#0c1a2d', '#030712']}
      locations={[0, 0.5, 1]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
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
              {/* Back button */}
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                style={styles.backButton}
                accessibilityRole="link"
                accessibilityLabel="Back to login"
              >
                <Text maxFontSizeMultiplier={1.3} style={styles.backButtonText}>← Back to login</Text>
              </TouchableOpacity>

              {/* Header */}
              <View style={styles.header}>
                <View style={styles.iconContainer}>
                  <Text maxFontSizeMultiplier={1.2} style={styles.iconText}>✉</Text>
                </View>
                <Text maxFontSizeMultiplier={1.2} style={styles.title}>Forgot password?</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.subtitle}>
                  No worries, we'll send you reset instructions
                </Text>
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
                    accessibilityHint="Enter the email address associated with your account"
                  />
                  <Text maxFontSizeMultiplier={1.5} style={styles.inputHint}>
                    Enter the email address associated with your account
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.button, loading && styles.buttonDisabled]}
                  onPress={handleSubmit}
                  disabled={loading}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={loading ? 'Sending reset email' : 'Reset password'}
                  accessibilityState={{ disabled: loading, busy: loading }}
                >
                  {loading ? (
                    <View style={styles.buttonContent}>
                      <ActivityIndicator color={colors.text} size="small" accessibilityLabel="Sending reset email" />
                      <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>Sending...</Text>
                    </View>
                  ) : (
                    <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>Reset password</Text>
                  )}
                </TouchableOpacity>
              </View>
            </LinearGradient>
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
    color: colors.gray400,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: 'rgba(37, 99, 235, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconText: {
    fontSize: 32,
    color: colors.primary,
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
    backgroundColor: glassColors.backgroundElevated,
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
  inputHint: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.gray500,
    marginTop: 4,
    marginLeft: 4,
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
  },
  successEmail: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  successHint: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.gray500,
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
    color: colors.primary,
  },
});
