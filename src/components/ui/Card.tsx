import React, { memo } from 'react';
import { View, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { spacing, radius } from '../../lib/spacing';

interface CardProps {
  children: React.ReactNode;
  padding?: number;
  noBorder?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export const Card = memo(function Card({
  children,
  padding = spacing.lg,
  noBorder = false,
  onPress,
  style,
  accessibilityLabel,
}: CardProps) {
  const { colors } = useTheme();

  const cardStyle: ViewStyle = {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: noBorder ? 0 : 1,
    borderColor: colors.border,
    padding,
  };

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        style={[cardStyle, style]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[cardStyle, style]}>
      {children}
    </View>
  );
});

const styles = StyleSheet.create({});
