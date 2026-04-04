import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { fonts } from '../../lib/fonts';
import { spacing } from '../../lib/spacing';

interface SectionHeaderProps {
  title: string;
  action?: {
    label: string;
    onPress: () => void;
  };
}

export const SectionHeader = memo(function SectionHeader({
  title,
  action,
}: SectionHeaderProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Text
        style={[styles.title, { color: colors.textSecondary }]}
        maxFontSizeMultiplier={1.5}
      >
        {title.toUpperCase()}
      </Text>
      {action ? (
        <TouchableOpacity
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text
            style={[styles.actionText, { color: colors.primary }]}
            maxFontSizeMultiplier={1.5}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 12,
    fontFamily: fonts.semiBold,
    letterSpacing: 0.5,
  },
  actionText: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
});
