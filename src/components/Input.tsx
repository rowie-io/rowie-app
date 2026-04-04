import React, { memo, useState } from 'react';
import {
  View,
  TextInput,
  TextInputProps,
  StyleSheet,
  ViewStyle,
  TextStyle,
  AccessibilityProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { fonts } from '../lib/fonts';
import { radius } from '../lib/spacing';

interface InputProps extends Omit<TextInputProps, 'style'>, AccessibilityProps {
  icon?: keyof typeof Ionicons.glyphMap;
  rightIcon?: React.ReactNode;
  containerStyle?: ViewStyle;
  inputStyle?: TextStyle;
  label?: string;
  error?: string;
}

export const Input = memo(function Input({
  icon,
  rightIcon,
  containerStyle,
  inputStyle,
  onFocus,
  onBlur,
  label,
  error,
  placeholder,
  accessibilityLabel,
  accessibilityHint,
  ...props
}: InputProps) {
  const { colors } = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = (e: any) => {
    setIsFocused(true);
    onFocus?.(e);
  };

  const handleBlur = (e: any) => {
    setIsFocused(false);
    onBlur?.(e);
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.inputBackground,
          borderColor: isFocused ? colors.primary : colors.inputBorder,
        },
        containerStyle,
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={20}
          color={colors.textMuted}
          style={styles.icon}
        />
      )}
      <TextInput
        style={[
          styles.input,
          { color: colors.inputText },
          icon && styles.inputWithIcon,
          rightIcon && styles.inputWithRightIcon,
          inputStyle,
        ]}
        placeholderTextColor={colors.inputPlaceholder}
        selectionColor={colors.primary}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        accessibilityLabel={accessibilityLabel || label || placeholder}
        accessibilityHint={accessibilityHint}
        aria-invalid={error ? true : undefined}
        accessibilityLiveRegion={error ? 'polite' : 'none'}
        accessibilityValue={error ? { text: error } : undefined}
        {...props}
      />
      {rightIcon}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  icon: {
    marginLeft: 12,
  },
  input: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: fonts.regular,
    outlineStyle: 'none',
  } as any,
  inputWithIcon: {
    paddingLeft: 8,
  },
  inputWithRightIcon: {
    paddingRight: 48,
  },
});
