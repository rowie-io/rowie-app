import React, { memo } from 'react';
import { ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../context/ThemeContext';
import { brandGradient, brandGradientLight } from '../../lib/colors';

interface GradientDividerProps {
  style?: ViewStyle;
}

/**
 * Thin gradient line — use as a section divider or header accent.
 * 2px tall by default, full width.
 */
export const GradientDivider = memo(function GradientDivider({ style }: GradientDividerProps) {
  const { isDark } = useTheme();
  return (
    <LinearGradient
      colors={isDark ? brandGradient : brandGradientLight}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[{ height: 2, borderRadius: 1 }, style]}
    />
  );
});

/**
 * Faded gradient line — transparent on edges, gradient in the middle.
 * Good for subtle section breaks.
 */
export const GradientFadeDivider = memo(function GradientFadeDivider({ style }: GradientDividerProps) {
  const { isDark } = useTheme();
  const mid = isDark ? brandGradient[0] : brandGradientLight[0];
  return (
    <LinearGradient
      colors={['transparent', mid, 'transparent']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[{ height: 1, opacity: 0.4 }, style]}
    />
  );
});

/**
 * Gradient dot/badge — small circular gradient indicator.
 */
export const GradientDot = memo(function GradientDot({ size = 8, style }: { size?: number; style?: ViewStyle }) {
  const { isDark } = useTheme();
  return (
    <LinearGradient
      colors={isDark ? brandGradient : brandGradientLight}
      style={[{ width: size, height: size, borderRadius: size / 2 }, style]}
    />
  );
});
