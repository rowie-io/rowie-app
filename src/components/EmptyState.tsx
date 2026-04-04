import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { fonts } from '../lib/fonts';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  /** Optional CTA button */
  actionLabel?: string;
  actionIcon?: keyof typeof Ionicons.glyphMap;
  onAction?: () => void;
  /** Fade in on mount (default true) */
  animated?: boolean;
}

export function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  actionIcon,
  onAction,
  animated = true,
}: EmptyStateProps) {
  const { colors, isDark } = useTheme();
  const fadeAnim = useRef(new Animated.Value(animated ? 0 : 1)).current;

  useEffect(() => {
    if (!animated) return;
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [animated, fadeAnim]);

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <View
        style={[
          styles.iconContainer,
          {
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(245,158,11,0.1)',
            borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(245,158,11,0.15)',
          },
        ]}
      >
        <Ionicons
          name={icon}
          size={40}
          color={isDark ? 'rgba(255,255,255,0.9)' : colors.primary}
        />
      </View>
      <Text
        maxFontSizeMultiplier={1.2}
        style={[styles.title, { color: isDark ? '#fff' : colors.text }]}
      >
        {title}
      </Text>
      <Text
        maxFontSizeMultiplier={1.5}
        style={[styles.subtitle, { color: isDark ? 'rgba(255,255,255,0.55)' : colors.textSecondary }]}
      >
        {subtitle}
      </Text>
      {actionLabel && onAction && (
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: colors.primary }]}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          {actionIcon && <Ionicons name={actionIcon} size={18} color="#fff" />}
          <Text maxFontSizeMultiplier={1.3} style={styles.actionButtonText}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
  },
  title: {
    fontSize: 22,
    fontFamily: fonts.bold,
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: fonts.regular,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 280,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
  },
  actionButtonText: {
    fontSize: 15,
    fontFamily: fonts.semiBold,
    color: '#fff',
  },
});
