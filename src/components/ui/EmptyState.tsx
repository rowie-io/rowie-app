import React, { memo, useEffect, useRef } from 'react';
import { Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { fonts } from '../../lib/fonts';
import { spacing, radius } from '../../lib/spacing';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** Secondary line — `subtitle` and `description` are equivalent */
  subtitle?: string;
  description?: string;
  /** Optional CTA button (flat props form) */
  actionLabel?: string;
  actionIcon?: keyof typeof Ionicons.glyphMap;
  onAction?: () => void;
  /** Optional CTA button (object form) — equivalent to actionLabel + onAction */
  action?: {
    label: string;
    onPress: () => void;
  };
  /** Fade in on mount (default true) */
  animated?: boolean;
}

export const EmptyState = memo(function EmptyState({
  icon,
  title,
  subtitle,
  description,
  actionLabel,
  actionIcon,
  onAction,
  action,
  animated = true,
}: EmptyStateProps) {
  const { colors } = useTheme();
  const fadeAnim = useRef(new Animated.Value(animated ? 0 : 1)).current;

  useEffect(() => {
    if (!animated) return;
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [animated, fadeAnim]);

  const body = subtitle ?? description;
  const ctaLabel = action?.label ?? actionLabel;
  const ctaOnPress = action?.onPress ?? onAction;

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <Ionicons name={icon} size={48} color={colors.textMuted} />
      <Text
        style={[styles.title, { color: colors.text }]}
        maxFontSizeMultiplier={1.3}
      >
        {title}
      </Text>
      {body ? (
        <Text
          style={[styles.description, { color: colors.textSecondary }]}
          maxFontSizeMultiplier={1.5}
        >
          {body}
        </Text>
      ) : null}
      {ctaLabel && ctaOnPress ? (
        <TouchableOpacity
          onPress={ctaOnPress}
          style={[styles.actionButton, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
        >
          {actionIcon && <Ionicons name={actionIcon} size={18} color={colors.onPrimary} />}
          <Text
            style={[styles.actionText, { color: colors.onPrimary }]}
            maxFontSizeMultiplier={1.3}
          >
            {ctaLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
  },
  title: {
    fontSize: 18,
    fontFamily: fonts.semiBold,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  description: {
    fontSize: 15,
    fontFamily: fonts.regular,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    minHeight: 44,
  },
  actionText: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
});
