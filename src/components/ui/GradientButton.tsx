import React, { memo } from 'react';
import { Text, TouchableOpacity, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { brandGradient, brandGradientLight } from '../../lib/colors';
import { useTheme } from '../../context/ThemeContext';
import { useTranslations } from '../../lib/i18n';
import { fonts } from '../../lib/fonts';

interface GradientButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  size?: 'default' | 'large';
  style?: ViewStyle;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export const GradientButton = memo(function GradientButton({
  label,
  onPress,
  icon,
  loading = false,
  disabled = false,
  size = 'default',
  style,
  accessibilityLabel,
  accessibilityHint,
}: GradientButtonProps) {
  const { isDark } = useTheme();
  const tc = useTranslations('common');
  const isLarge = size === 'large';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[{ opacity: disabled ? 0.5 : 1 }, style]}
    >
      <LinearGradient
        colors={isDark ? brandGradient : brandGradientLight}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.gradient, isLarge && styles.gradientLarge]}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" accessibilityLabel={tc('loading')} />
        ) : (
          <>
            {icon && <Ionicons name={icon} size={isLarge ? 20 : 18} color="#fff" />}
            <Text
              style={[styles.label, isLarge && styles.labelLarge]}
              maxFontSizeMultiplier={1.3}
            >
              {label}
            </Text>
          </>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
  },
  gradientLarge: {
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: 16,
  },
  label: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
    color: '#fff',
  },
  labelLarge: {
    fontSize: 17,
  },
});
