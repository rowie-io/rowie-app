import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { ordersApi } from '../lib/api';
import { formatCents, getCurrencySymbol, isZeroDecimal, fromSmallestUnit, toSmallestUnit } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { useTranslations } from '../lib/i18n';
import { KeypadButton } from '../components/Keypad';

type RouteParams = {
  CashPayment: {
    orderId: string;
    orderNumber: string;
    totalAmount: number; // in cents
    customerEmail?: string;
  };
};

const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'backspace'],
];

// Quick-tender denominations, in base currency units. Zero-decimal currencies
// (JPY, KRW, …) use note-sized values since their base unit is tiny.
const QUICK_TENDER_BASE = [5, 10, 20, 50, 100];
const QUICK_TENDER_ZERO_DECIMAL = [500, 1000, 2000, 5000, 10000];

export function CashPaymentScreen() {
  const { colors } = useTheme();
  const { currency } = useAuth();
  const t = useTranslations('payment');
  const tc = useTranslations('common');
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'CashPayment'>>();
  const { orderId, orderNumber, totalAmount, customerEmail } = route.params;

  const [cashTendered, setCashTendered] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { width: screenWidth } = useWindowDimensions();

  const cashTenderedCents = toSmallestUnit(parseFloat(cashTendered || '0'), currency);
  const changeAmount = Math.max(0, cashTenderedCents - totalAmount);
  const isEnoughCash = cashTenderedCents >= totalAmount;

  const styles = createStyles(colors);

  // Keypad key sizing: 3 columns filling the width, kept short so the whole
  // screen (totals + tendered + quick amounts + keypad + footer) fits.
  const keypadButtonWidth = Math.min(118, Math.max(72, Math.floor((screenWidth - 40 - 24) / 3)));
  const keypadButtonHeight = 60;

  // Quick-tender denominations that can actually cover the total (fill, not add).
  const quickTenderOptions = useMemo(() => {
    const base = isZeroDecimal(currency) ? QUICK_TENDER_ZERO_DECIMAL : QUICK_TENDER_BASE;
    return base.filter((denom) => toSmallestUnit(denom, currency) >= totalAmount);
  }, [currency, totalAmount]);

  // Handle keypad input (haptics handled inside KeypadButton)
  const handleKeyPress = (key: string) => {
    if (key === 'backspace') {
      setCashTendered(prev => prev.slice(0, -1));
    } else if (key === '.') {
      if (isZeroDecimal(currency)) return; // No decimals for zero-decimal currencies
      if (!cashTendered.includes('.')) {
        setCashTendered(prev => prev + '.');
      }
    } else {
      // Limit decimal places to 2 (skip for zero-decimal currencies)
      if (!isZeroDecimal(currency)) {
        const parts = cashTendered.split('.');
        if (parts[1] && parts[1].length >= 2) return;
      }
      setCashTendered(prev => prev + key);
    }
  };

  // Handle exact amount
  const handleExactAmount = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const base = fromSmallestUnit(totalAmount, currency);
    setCashTendered(isZeroDecimal(currency) ? String(base) : base.toFixed(2));
  };

  // Quick-tender: set (not add) the tendered amount to a denomination
  const handleQuickTender = (denomBase: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setCashTendered(isZeroDecimal(currency) ? String(denomBase) : denomBase.toFixed(2));
  };

  // Complete cash payment
  const handleComplete = async () => {
    if (!isEnoughCash) {
      Alert.alert(t('insufficientCashAlertTitle'), t('insufficientCashAlertMessage'));
      return;
    }

    setIsProcessing(true);
    try {
      const response = await ordersApi.completeCash(orderId, cashTenderedCents);

      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [
            { name: 'MainTabs' },
            {
              name: 'PaymentResult',
              params: {
                success: true,
                amount: totalAmount,
                paymentIntentId: null,
                orderId,
                orderNumber,
                customerEmail,
                paymentMethod: 'cash',
                cashTendered: cashTenderedCents,
                changeAmount: response.changeAmount,
              },
            },
          ],
        })
      );
    } catch (error: any) {
      // ordersApi.completeCash throws ApiError {error, statusCode, code, details}
      // (see lib/api/client.ts:120-127), NOT an Error instance. Prefer
      // `error.error` so the API's user-facing reason isn't masked by the
      // generic fallback.
      Alert.alert(t('cashPaymentFailedTitle'), error?.error || error?.message || t('cashPaymentFailedMessage'));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={tc('goBack')}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>{t('cashPaymentTitle')}</Text>
        <View style={{ width: 48 }} />
      </View>

      {/* Total Amount Display */}
      <View style={styles.totalSection}>
        <Text style={styles.totalLabel} maxFontSizeMultiplier={1.5}>{t('totalDue')}</Text>
        <Text style={styles.totalAmount} maxFontSizeMultiplier={1.2} accessibilityRole="summary" accessibilityLabel={t('totalDueAccessibility', { amount: formatCents(totalAmount, currency) })}>{formatCents(totalAmount, currency)}</Text>
      </View>

      {/* Cash Tendered Display */}
      <View style={styles.tenderedSection}>
        <Text style={styles.tenderedLabel} maxFontSizeMultiplier={1.5}>{t('cashTendered')}</Text>
        <View style={styles.tenderedDisplay}>
          <Text style={styles.dollarSign} maxFontSizeMultiplier={1.2}>{getCurrencySymbol(currency)}</Text>
          <Text style={[styles.tenderedAmount, !cashTendered && styles.tenderedPlaceholder]} maxFontSizeMultiplier={1.2} accessibilityRole="text" accessibilityLabel={t('cashTenderedAccessibility', { symbol: getCurrencySymbol(currency), amount: cashTendered || (isZeroDecimal(currency) ? t('zeroDecimalPlaceholder') : t('decimalPlaceholder')) })}>
            {cashTendered || (isZeroDecimal(currency) ? t('zeroDecimalPlaceholder') : t('decimalPlaceholder'))}
          </Text>
        </View>
      </View>

      {/* Change Display */}
      {isEnoughCash && changeAmount > 0 && (
        <View style={styles.changeSection} accessibilityRole="summary" accessibilityLabel={t('changeDueAccessibility', { amount: formatCents(changeAmount, currency) })}>
          <Text style={styles.changeLabel} maxFontSizeMultiplier={1.5}>{t('changeDue')}</Text>
          <Text style={styles.changeAmount} maxFontSizeMultiplier={1.2}>{formatCents(changeAmount, currency)}</Text>
        </View>
      )}

      {/* Insufficient Warning */}
      {cashTenderedCents > 0 && !isEnoughCash && (
        <View style={styles.insufficientSection} accessibilityRole="alert">
          <Ionicons name="warning-outline" size={18} color={colors.error} />
          <Text style={styles.insufficientText} maxFontSizeMultiplier={1.5}>
            {t('insufficientMoreNeeded', { amount: formatCents(totalAmount - cashTenderedCents, currency) })}
          </Text>
        </View>
      )}

      {/* Quick Tender Row: Exact + denominations that cover the total */}
      <View style={styles.quickTenderSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickTenderContainer}
        >
          <TouchableOpacity style={styles.exactButton} onPress={handleExactAmount} accessibilityRole="button" accessibilityLabel={t('exactAmountAccessibility', { amount: formatCents(totalAmount, currency) })}>
            <Text style={styles.exactButtonText} maxFontSizeMultiplier={1.3}>{t('exactAmount')}</Text>
          </TouchableOpacity>
          {quickTenderOptions.map((denom) => (
            <TouchableOpacity
              key={denom}
              style={styles.quickTenderButton}
              onPress={() => handleQuickTender(denom)}
              accessibilityRole="button"
              accessibilityLabel={t('tenderQuickAmountAccessibility', { amount: formatCents(toSmallestUnit(denom, currency), currency) })}
            >
              <Text style={styles.quickTenderButtonText} maxFontSizeMultiplier={1.3}>
                {`${getCurrencySymbol(currency)}${denom}`}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Number Keypad */}
      <View style={styles.keypad}>
        {KEYPAD_ROWS.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.keypadRow}>
            {row.map((key) => (
              <KeypadButton
                key={key}
                keyValue={key}
                onPress={handleKeyPress}
                colors={colors}
                buttonSize={keypadButtonWidth}
                buttonHeight={keypadButtonHeight}
                backgroundColor={colors.card}
                pressedBackgroundColor={colors.surface}
                disabled={key === '.' && isZeroDecimal(currency)}
                accessibilityLabel={key === 'backspace' ? t('deleteKey') : key === '.' ? t('decimalPoint') : key}
              />
            ))}
          </View>
        ))}
      </View>

      {/* Complete Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.completeButton,
            !isEnoughCash && styles.completeButtonDisabled,
          ]}
          onPress={handleComplete}
          disabled={!isEnoughCash || isProcessing}
          accessibilityRole="button"
          accessibilityLabel={isProcessing ? t('processingPaymentButtonAccessibility') : isEnoughCash ? t('completePaymentAccessibility') : t('enterCashAmountAccessibility')}
          accessibilityState={{ disabled: !isEnoughCash || isProcessing }}
        >
          {isProcessing ? (
            <ActivityIndicator color="#fff" accessibilityLabel={t('processingPaymentIndicator')} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={24} color="#fff" />
              <Text style={styles.completeButtonText} maxFontSizeMultiplier={1.3}>
                {isEnoughCash ? t('completePayment') : t('enterCashAmount')}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
    },
    backButton: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerTitle: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    totalSection: {
      alignItems: 'center',
      paddingVertical: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    totalLabel: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
      marginBottom: 4,
    },
    totalAmount: {
      fontSize: 36,
      fontFamily: fonts.bold,
      color: colors.text,
    },
    tenderedSection: {
      alignItems: 'center',
      paddingVertical: 16,
    },
    tenderedLabel: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
      marginBottom: 8,
    },
    tenderedDisplay: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    dollarSign: {
      fontSize: 32,
      fontFamily: fonts.semiBold,
      color: colors.primary,
      marginTop: 8,
      marginRight: 4,
    },
    tenderedAmount: {
      fontSize: 56,
      fontFamily: fonts.bold,
      color: colors.primary,
    },
    tenderedPlaceholder: {
      color: colors.textMuted,
    },
    changeSection: {
      alignItems: 'center',
      paddingVertical: 12,
      marginHorizontal: 20,
      backgroundColor: 'rgba(34, 197, 94, 0.1)',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: 'rgba(34, 197, 94, 0.3)',
    },
    changeLabel: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.success,
      marginBottom: 2,
    },
    changeAmount: {
      fontSize: 28,
      fontFamily: fonts.bold,
      color: colors.success,
    },
    insufficientSection: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      marginHorizontal: 20,
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: 'rgba(239, 68, 68, 0.3)',
      gap: 8,
    },
    insufficientText: {
      fontSize: 15,
      fontFamily: fonts.semiBold,
      color: colors.error,
    },
    quickTenderSection: {
      paddingVertical: 12,
    },
    quickTenderContainer: {
      paddingHorizontal: 20,
      gap: 8,
      alignItems: 'center',
    },
    exactButton: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 10,
      backgroundColor: colors.primary + '20',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.primary + '40',
    },
    exactButtonText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    quickTenderButton: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 18,
      paddingVertical: 10,
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    quickTenderButtonText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    keypad: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 8,
    },
    keypadRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 12,
      marginBottom: 12,
    },
    footer: {
      padding: 20,
      paddingBottom: 36,
    },
    completeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 18,
      borderRadius: 20,
      backgroundColor: colors.success,
      gap: 10,
      ...shadows.md,
    },
    completeButtonDisabled: {
      backgroundColor: colors.textMuted,
      opacity: 0.6,
    },
    completeButtonText: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: '#fff',
    },
  });
