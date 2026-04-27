import React, { useState, useCallback, useMemo, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Animated,
  Modal,
  useWindowDimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { formatCents, getCurrencySymbol, isZeroDecimal, fromSmallestUnit } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { useTapToPayGuard } from '../hooks';
import { useTranslations } from '../lib/i18n';

const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['C', '0', 'DEL'],
];

interface KeypadButtonProps {
  keyValue: string;
  onPress: (key: string) => void;
  colors: any;
  buttonSize: number;
}

const KeypadButton = memo(function KeypadButton({ keyValue, onPress, colors, buttonSize }: KeypadButtonProps) {
  const scale = React.useRef(new Animated.Value(1)).current;

  const numberFontSize = Math.round(buttonSize * 0.36);
  const actionFontSize = Math.round(buttonSize * 0.22);
  const iconSize = Math.round(buttonSize * 0.36);
  const borderRadius = Math.round(buttonSize * 0.25);

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

  const handlePress = useCallback(() => {
    if (keyValue === 'C' || keyValue === 'DEL') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress(keyValue);
  }, [keyValue, onPress]);

  const isAction = keyValue === 'C' || keyValue === 'DEL';

  const buttonLabel =
    keyValue === 'DEL'
      ? 'Delete last digit'
      : keyValue === 'C'
        ? 'Clear amount'
        : `Keypad ${keyValue}`;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={buttonLabel}
        style={({ pressed }) => [
          {
            width: buttonSize,
            height: buttonSize,
            borderRadius: borderRadius,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: pressed
              ? colors.card
              : colors.background,
            borderWidth: 1,
            borderColor: pressed ? colors.borderLight : colors.border,
            ...shadows.sm,
          },
        ]}
      >
        {keyValue === 'DEL' ? (
          <Ionicons
            name="backspace-outline"
            size={iconSize}
            color={colors.textSecondary}
          />
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

interface QuickChargeBottomSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function QuickChargeBottomSheet({ visible, onClose }: QuickChargeBottomSheetProps) {
  const { colors, isDark } = useTheme();
  const { currency } = useAuth();
  const t = useTranslations('components.quickCharge');
  const navigation = useNavigation<any>();
  const { guardCheckout } = useTapToPayGuard();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  const [amount, setAmount] = useState('');

  // Calculate button size based on screen width (compact for bottom sheet)
  const buttonSize = useMemo(() => {
    const availableWidth = screenWidth - 80; // padding
    const maxButtonSize = Math.floor(availableWidth / 3.5);
    return Math.min(72, Math.max(56, maxButtonSize));
  }, [screenWidth]);

  const buttonGap = 12;

  const formatAmount = (value: string) => {
    const digits = value.replace(/\D/g, '');
    const rawCents = parseInt(digits || '0', 10);
    return isZeroDecimal(currency) ? String(rawCents) : (rawCents / 100).toFixed(2);
  };

  const displayAmount = formatAmount(amount);
  const formattedAmount = formatCents(parseInt(amount || '0', 10), currency);
  const cents = parseInt(amount || '0', 10);

  const handleKeypadPress = useCallback((key: string) => {
    if (key === 'DEL') {
      setAmount((prev) => prev.slice(0, -1));
    } else if (key === 'C') {
      setAmount('');
    } else {
      if (amount.length < 8) {
        setAmount((prev) => prev + key);
      }
    }
  }, [amount.length]);

  const handleCharge = useCallback(() => {
    if (cents < 50) {
      Alert.alert(t('invalidAmountTitle'), t('minimumCharge', { amount: formatCents(50, currency) }));
      return;
    }

    if (!guardCheckout()) {
      onClose();
      return;
    }

    // Close the bottom sheet
    onClose();

    // Navigate to checkout screen with quick charge params
    navigation.navigate('Checkout', {
      total: cents,
      isQuickCharge: true,
      quickChargeDescription: t('quickChargeDescription', { amount: formattedAmount }),
    });

    // Reset form
    setAmount('');
  }, [cents, displayAmount, navigation, onClose, guardCheckout]);

  const handleClose = useCallback(() => {
    setAmount('');
    onClose();
  }, [onClose]);

  const chargeDisabled = cents < 50;

  const containerBg = isDark ? '#1C1917' : '#ffffff';
  const handleColor = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalContainer}
      >
        <Pressable
          style={styles.overlay}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close quick charge"
        >
          <Pressable
            style={[
              styles.sheetContainer,
              {
                backgroundColor: containerBg,
                paddingBottom: insets.bottom + 16,
              },
            ]}
            onPress={(e) => e.stopPropagation()}
            accessible={false}
            accessibilityRole="none"
          >
            {/* Handle bar */}
            <View style={styles.handleContainer}>
              <View style={[styles.handle, { backgroundColor: handleColor }]} />
            </View>

            {/* Header */}
            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{t('title')}</Text>
              <Pressable
                onPress={handleClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </Pressable>
            </View>

            {/* Amount Display */}
            <View style={styles.amountContainer}>
              <Text style={[styles.currencySymbol, { color: colors.textMuted }]} maxFontSizeMultiplier={1.2}>{getCurrencySymbol(currency)}</Text>
              <Text style={[styles.amount, { color: colors.text }]} maxFontSizeMultiplier={1.2}>{displayAmount}</Text>
            </View>

            {/* Keypad */}
            <View style={styles.keypad}>
              {KEYPAD_ROWS.map((row, rowIndex) => (
                <View key={rowIndex} style={[styles.keypadRow, { gap: buttonGap }]}>
                  {row.map((key) => (
                    <KeypadButton
                      key={key}
                      keyValue={key}
                      onPress={handleKeypadPress}
                      colors={colors}
                      buttonSize={buttonSize}
                    />
                  ))}
                </View>
              ))}
            </View>

            {/* Charge Button */}
            <View style={styles.footer}>
              <Pressable
                onPress={() => {
                  if (!chargeDisabled) {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    handleCharge();
                  }
                }}
                disabled={chargeDisabled}
                accessibilityRole="button"
                accessibilityLabel={cents < 50 ? t('enterAmount') : t('chargeAmount', { amount: formattedAmount })}
                accessibilityState={{ disabled: chargeDisabled }}
                style={({ pressed }) => [
                  styles.chargeButton,
                  {
                    backgroundColor: chargeDisabled
                      ? colors.card
                      : isDark ? '#fff' : '#1C1917',
                  },
                  pressed && !chargeDisabled && styles.chargeButtonPressed,
                ]}
              >
                <Ionicons
                  name="flash"
                  size={20}
                  color={chargeDisabled ? colors.textMuted : isDark ? '#1C1917' : '#fff'}
                />
                <Text
                  style={[
                    styles.chargeButtonText,
                    { color: chargeDisabled ? colors.textMuted : isDark ? '#1C1917' : '#fff' },
                  ]}
                  maxFontSizeMultiplier={1.3}
                >
                  {cents < 50 ? t('enterAmount') : t('chargeAmount', { amount: formattedAmount })}
                </Text>
              </Pressable>

              <Text style={[styles.minimumHint, { color: colors.textMuted, opacity: cents > 0 && cents < 50 ? 1 : 0 }]} maxFontSizeMultiplier={1.5}>
                {t('minimumCharge', { amount: formatCents(50, currency) })}
              </Text>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    ...shadows.lg,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 18,
    fontFamily: fonts.semiBold,
  },
  amountContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
  },
  currencySymbol: {
    fontSize: 32,
    fontFamily: fonts.bold,
    marginRight: 2,
    marginTop: 4,
  },
  amount: {
    fontSize: 48,
    fontFamily: fonts.bold,
    letterSpacing: -2,
  },
  keypad: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 12,
  },
  footer: {
    paddingHorizontal: 20,
  },
  chargeButton: {
    flexDirection: 'row',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...shadows.md,
  },
  chargeButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  chargeButtonText: {
    fontSize: 17,
    fontFamily: fonts.semiBold,
  },
  minimumHint: {
    textAlign: 'center',
    marginTop: 10,
    fontSize: 13,
    fontFamily: fonts.regular,
  },
});
