import React, { memo, useCallback, useRef } from 'react';
import { Animated, Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';

export interface KeypadButtonProps {
  keyValue: string;
  onPress: (key: string) => void;
  colors: any;
  /** Button width in points. */
  buttonSize: number;
  /** Button height in points — defaults to buttonSize (square key). */
  buttonHeight?: number;
  /** Translated VoiceOver label — required, never hardcode English here. */
  accessibilityLabel: string;
  /** Visually + functionally disable the key (e.g. '.' for zero-decimal currencies). */
  disabled?: boolean;
  /** Resting background — defaults to colors.background (QuickCharge sheet). */
  backgroundColor?: string;
  /** Pressed background — defaults to colors.card. */
  pressedBackgroundColor?: string;
}

/**
 * Animated, haptic keypad button shared by QuickChargeBottomSheet,
 * CashPaymentScreen and SplitPaymentScreen amount entry.
 *
 * Special keys: 'DEL' / 'backspace' render a backspace icon, 'C' renders as a
 * clear action. Everything else renders as a digit/symbol.
 */
export const KeypadButton = memo(function KeypadButton({
  keyValue,
  onPress,
  colors,
  buttonSize,
  buttonHeight,
  accessibilityLabel,
  disabled = false,
  backgroundColor,
  pressedBackgroundColor,
}: KeypadButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const height = buttonHeight ?? buttonSize;
  const minDim = Math.min(buttonSize, height);
  const numberFontSize = Math.round(minDim * 0.36);
  const actionFontSize = Math.round(minDim * 0.22);
  const iconSize = Math.round(minDim * 0.36);
  const borderRadius = Math.round(minDim * 0.25);

  const restingBg = backgroundColor ?? colors.background;
  const pressedBg = pressedBackgroundColor ?? colors.card;

  const handlePressIn = useCallback(() => {
    Animated.spring(scale, {
      toValue: 0.9,
      useNativeDriver: true,
      tension: 150,
      friction: 10,
    }).start();
  }, [scale]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start();
  }, [scale]);

  const isBackspace = keyValue === 'DEL' || keyValue === 'backspace';
  const isAction = isBackspace || keyValue === 'C';

  const handlePress = useCallback(() => {
    if (disabled) return;
    Haptics.impactAsync(
      isAction ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light
    ).catch(() => {});
    onPress(keyValue);
  }, [keyValue, onPress, disabled, isAction]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={disabled ? undefined : handlePressIn}
        onPressOut={disabled ? undefined : handlePressOut}
        onPress={handlePress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [
          {
            width: buttonSize,
            height,
            borderRadius,
            justifyContent: 'center',
            alignItems: 'center',
            opacity: disabled ? 0.35 : 1,
            backgroundColor: pressed && !disabled ? pressedBg : restingBg,
            borderWidth: 1,
            borderColor: pressed && !disabled ? colors.borderLight : colors.border,
            ...shadows.sm,
          },
        ]}
      >
        {isBackspace ? (
          <Ionicons name="backspace-outline" size={iconSize} color={colors.textSecondary} />
        ) : (
          <Text
            style={{
              fontSize: isAction ? actionFontSize : numberFontSize,
              fontFamily: isAction ? fonts.medium : fonts.semiBold,
              color: isAction ? colors.textSecondary : colors.text,
            }}
            maxFontSizeMultiplier={1.3}
          >
            {keyValue}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
});
