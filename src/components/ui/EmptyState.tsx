import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { fonts } from '../../lib/fonts';
import { spacing } from '../../lib/spacing';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  action?: {
    label: string;
    onPress: () => void;
  };
}

export const EmptyState = memo(function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={48} color={colors.textMuted} />
      <Text
        style={[styles.title, { color: colors.text }]}
        maxFontSizeMultiplier={1.3}
      >
        {title}
      </Text>
      {description ? (
        <Text
          style={[styles.description, { color: colors.textSecondary }]}
          maxFontSizeMultiplier={1.5}
        >
          {description}
        </Text>
      ) : null}
      {action ? (
        <TouchableOpacity
          onPress={action.onPress}
          style={[styles.actionButton, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text
            style={styles.actionText}
            maxFontSizeMultiplier={1.3}
          >
            {action.label}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
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
  },
  actionButton: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 12,
  },
  actionText: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: '#FFFFFF',
  },
});
