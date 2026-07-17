import React, { memo } from 'react';
import { Text, TouchableOpacity, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { brandGradient, brandGradientLight } from '../../lib/colors';
import { useTheme } from '../../context/ThemeContext';
import { useTranslations } from '../../lib/i18n';
import { fonts } from '../../lib/fonts';

type GradientButtonVariant = 'primary' | 'secondary' | 'destructive';
// 'default' and 'large' kept as aliases for backward compatibility
type GradientButtonSize = 'sm' | 'md' | 'lg' | 'default' | 'large';

interface GradientButtonProps {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  variant?: GradientButtonVariant;
  size?: GradientButtonSize;
  style?: ViewStyle;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const ICON_SIZE: Record<'sm' | 'md' | 'lg', number> = { sm: 16, md: 18, lg: 20 };

export const GradientButton = memo(function GradientButton({
  label,
  onPress,
  icon,
  loading = false,
  disabled = false,
  variant = 'primary',
  size = 'md',
  style,
  accessibilityLabel,
  accessibilityHint,
}: GradientButtonProps) {
  const { isDark, colors } = useTheme();
  const tc = useTranslations('common');

  // Normalize legacy size aliases
  const resolvedSize: 'sm' | 'md' | 'lg' =
    size === 'large' ? 'lg' : size === 'default' ? 'md' : size;

  // Fill + content colors per variant. Dark stone on amber (~9:1) instead of
  // white (~2.1:1) — WCAG / Apple TTPOi contrast requirement.
  const fill: [string, string] =
    variant === 'destructive'
      ? [colors.error, colors.error]
      : variant === 'secondary'
        ? [colors.buttonSecondaryBg, colors.buttonSecondaryBg]
        : isDark ? brandGradient : brandGradientLight;
  const contentColor =
    variant === 'destructive' ? '#FFFFFF' : variant === 'secondary' ? colors.text : colors.onPrimary;

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
        colors={fill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[
          styles.gradient,
          resolvedSize === 'sm' && styles.gradientSm,
          resolvedSize === 'lg' && styles.gradientLg,
          variant === 'secondary' && { borderWidth: 1, borderColor: colors.border },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={contentColor} size="small" accessibilityLabel={tc('loading')} />
        ) : (
          <>
            {icon && <Ionicons name={icon} size={ICON_SIZE[resolvedSize]} color={contentColor} />}
            <Text
              style={[
                styles.label,
                resolvedSize === 'sm' && styles.labelSm,
                resolvedSize === 'lg' && styles.labelLg,
                { color: contentColor },
              ]}
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
    minHeight: 48,
  },
  gradientSm: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    minHeight: 40,
  },
  gradientLg: {
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: 16,
    minHeight: 56,
  },
  label: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
  },
  labelSm: {
    fontSize: 14,
  },
  labelLg: {
    fontSize: 17,
  },
});
