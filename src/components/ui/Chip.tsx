import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { fonts } from '../../lib/fonts';
import { brandGradient, brandGradientLight } from '../../lib/colors';
import { spacing, radius } from '../../lib/spacing';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
  disabled?: boolean;
}

export const Chip = memo(function Chip({
  label,
  selected = false,
  onPress,
  icon,
  style,
  disabled = false,
}: ChipProps) {
  const { colors, isDark } = useTheme();

  const content = (
    <>
      {icon ? (
        <Ionicons
          name={icon}
          size={16}
          color={selected ? '#fff' : colors.textSecondary}
          style={styles.icon}
        />
      ) : null}
      <Text
        style={[
          styles.label,
          { color: selected ? '#fff' : colors.textSecondary },
          selected && { fontFamily: fonts.semiBold },
        ]}
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </Text>
    </>
  );

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      style={[{ opacity: disabled ? 0.5 : 1 }, style]}
    >
      {selected ? (
        <LinearGradient
          colors={isDark ? brandGradient : brandGradientLight}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.chip}
        >
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.chip, { backgroundColor: colors.chipBg, borderWidth: 1, borderColor: colors.border }]}>
          {content}
        </View>
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
  },
  icon: {
    marginRight: spacing.xs,
  },
  label: {
    fontSize: 14,
    fontFamily: fonts.medium,
  },
});
