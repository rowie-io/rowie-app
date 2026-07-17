import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { useTranslations } from '../lib/i18n';

interface UndoSnackbarProps {
  visible: boolean;
  /** Already-translated message, e.g. tc('removedFromCart', { name }). */
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  /** Distance from the bottom of the parent (absolute positioning). */
  bottomOffset?: number;
  /** Auto-dismiss delay. */
  durationMs?: number;
}

/**
 * Minimal inline snackbar used by MenuScreen / CheckoutScreen after a cart
 * line is removed (decrement at qty 1 or swipe-delete): "Removed X · Undo".
 * Intentionally NOT part of src/components/ui — it's a cart-flow helper.
 */
export function UndoSnackbar({
  visible,
  message,
  onUndo,
  onDismiss,
  bottomOffset = 76,
  durationMs = 4000,
}: UndoSnackbarProps) {
  const { colors } = useTheme();
  const tc = useTranslations('common');
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  // Keep the latest onDismiss without restarting the timer when the parent
  // re-renders and passes a new inline callback reference.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!visible) return;
    opacity.setValue(0);
    translateY.setValue(12);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, tension: 120, friction: 12, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(() => onDismissRef.current(), durationMs);
    return () => clearTimeout(timer);
    // Restart the timer when a new removal replaces the current one.
  }, [visible, message, durationMs, opacity, translateY]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          bottom: bottomOffset,
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity,
          transform: [{ translateY }],
        },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons name="trash-outline" size={16} color={colors.textSecondary} />
      <Text
        style={[styles.message, { color: colors.text }]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
      >
        {message}
      </Text>
      <TouchableOpacity
        style={styles.undoButton}
        onPress={onUndo}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={tc('undo')}
      >
        <Text style={[styles.undoText, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>
          {tc('undo')}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    zIndex: 100,
    ...shadows.lg,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.medium,
  },
  undoButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  undoText: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
});
