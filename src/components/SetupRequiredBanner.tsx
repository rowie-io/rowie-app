import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { fonts } from '../lib/fonts';

interface SetupRequiredBannerProps {
  compact?: boolean;
}

export function SetupRequiredBanner({ compact = false }: SetupRequiredBannerProps) {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();

  // Solid colors for dark mode to prevent stars showing through
  const compactBg = isDark ? '#09090b' : colors.warning + '15';
  const containerBg = isDark ? '#09090b' : colors.warning + '10';
  const containerBorder = isDark ? '#3d2a0d' : colors.warning + '30';

  const handleSetup = () => {
    navigation.navigate('StripeOnboarding');
  };

  if (compact) {
    return (
      <TouchableOpacity
        style={[styles.compactContainer, { backgroundColor: compactBg }]}
        onPress={handleSetup}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Complete payment setup to accept payments"
        accessibilityHint="Navigates to the Stripe onboarding screen to complete payment setup"
      >
        <Ionicons name="warning" size={16} color={colors.warning} />
        <Text style={[styles.compactText, { color: colors.warning }]} maxFontSizeMultiplier={1.3}>
          Complete payment setup to accept payments
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.warning} />
      </TouchableOpacity>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: containerBg, borderColor: containerBorder }]}
      accessibilityRole="alert"
    >
      <View style={styles.content}>
        <View style={[styles.iconContainer, { backgroundColor: colors.warning + '20' }]}>
          <Ionicons name="card-outline" size={24} color={colors.warning} />
        </View>
        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: colors.text }]} maxFontSizeMultiplier={1.5}>Payment Setup Required</Text>
          <Text style={[styles.description, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
            Complete your payment setup to start accepting payments
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.warning }]}
        onPress={handleSetup}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Complete Setup"
        accessibilityHint="Navigates to the Stripe onboarding screen to complete payment setup"
      >
        <Text style={styles.buttonText} maxFontSizeMultiplier={1.3}>Complete Setup</Text>
        <Ionicons name="arrow-forward" size={16} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    margin: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    fontFamily: fonts.regular,
    lineHeight: 20,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
  },
  buttonText: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
    color: '#fff',
  },
  // Compact styles
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 8,
  },
  compactText: {
    fontSize: 13,
    fontFamily: fonts.medium,
    flex: 1,
  },
});
