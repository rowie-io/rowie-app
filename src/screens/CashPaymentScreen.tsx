import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Vibration,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { ordersApi } from '../lib/api';
import { formatCents, getCurrencySymbol, isZeroDecimal, fromSmallestUnit, toSmallestUnit } from '../utils/currency';
import { glass } from '../lib/colors';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';

type RouteParams = {
  CashPayment: {
    orderId: string;
    orderNumber: string;
    totalAmount: number; // in cents
    customerEmail?: string;
  };
};

export function CashPaymentScreen() {
  const { colors, isDark } = useTheme();
  const { currency } = useAuth();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'CashPayment'>>();
  const glassColors = isDark ? glass.dark : glass.light;

  const { orderId, orderNumber, totalAmount, customerEmail } = route.params;

  const [cashTendered, setCashTendered] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);

  const cashTenderedCents = toSmallestUnit(parseFloat(cashTendered || '0'), currency);
  const changeAmount = Math.max(0, cashTenderedCents - totalAmount);
  const isEnoughCash = cashTenderedCents >= totalAmount;

  const styles = createStyles(colors, glassColors, isDark);

  // Handle keypad input
  const handleKeyPress = (key: string) => {
    Vibration.vibrate(10);
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
    Vibration.vibrate(10);
    setCashTendered(isZeroDecimal(currency) ? String(totalAmount) : (totalAmount / 100).toFixed(2));
  };

  // Complete cash payment
  const handleComplete = async () => {
    if (!isEnoughCash) {
      Alert.alert('Insufficient Cash', 'The cash tendered is less than the total amount.');
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
      Alert.alert('Payment Failed', error.message || 'Failed to complete cash payment.');
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
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>Cash Payment</Text>
        <View style={{ width: 48 }} />
      </View>

      {/* Total Amount Display */}
      <View style={styles.totalSection}>
        <Text style={styles.totalLabel} maxFontSizeMultiplier={1.5}>Total Due</Text>
        <Text style={styles.totalAmount} maxFontSizeMultiplier={1.2} accessibilityRole="summary" accessibilityLabel={`Total due ${formatCents(totalAmount, currency)}`}>{formatCents(totalAmount, currency)}</Text>
      </View>

      {/* Cash Tendered Display */}
      <View style={styles.tenderedSection}>
        <Text style={styles.tenderedLabel} maxFontSizeMultiplier={1.5}>Cash Tendered</Text>
        <View style={styles.tenderedDisplay}>
          <Text style={styles.dollarSign} maxFontSizeMultiplier={1.2}>{getCurrencySymbol(currency)}</Text>
          <Text style={[styles.tenderedAmount, !cashTendered && styles.tenderedPlaceholder]} maxFontSizeMultiplier={1.2} accessibilityRole="text" accessibilityLabel={`Cash tendered ${getCurrencySymbol(currency)}${cashTendered || (isZeroDecimal(currency) ? '0' : '0.00')}`}>
            {cashTendered || (isZeroDecimal(currency) ? '0' : '0.00')}
          </Text>
        </View>
      </View>

      {/* Change Display */}
      {isEnoughCash && changeAmount > 0 && (
        <View style={styles.changeSection} accessibilityRole="summary" accessibilityLabel={`Change due ${formatCents(changeAmount, currency)}`}>
          <Text style={styles.changeLabel} maxFontSizeMultiplier={1.5}>Change Due</Text>
          <Text style={styles.changeAmount} maxFontSizeMultiplier={1.2}>{formatCents(changeAmount, currency)}</Text>
        </View>
      )}

      {/* Insufficient Warning */}
      {cashTenderedCents > 0 && !isEnoughCash && (
        <View style={styles.insufficientSection} accessibilityRole="alert">
          <Ionicons name="warning-outline" size={18} color={colors.error} />
          <Text style={styles.insufficientText} maxFontSizeMultiplier={1.5}>
            Insufficient — {formatCents(totalAmount - cashTenderedCents, currency)} more needed
          </Text>
        </View>
      )}

      {/* Exact Amount Button */}
      <View style={styles.exactRow}>
        <TouchableOpacity style={styles.exactButton} onPress={handleExactAmount} accessibilityRole="button" accessibilityLabel={`Exact amount ${formatCents(totalAmount, currency)}`}>
          <Text style={styles.exactButtonText} maxFontSizeMultiplier={1.3}>Exact Amount</Text>
        </TouchableOpacity>
      </View>

      {/* Number Keypad */}
      <View style={styles.keypad}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace'].map((key) => (
          <TouchableOpacity
            key={key}
            style={styles.keypadButton}
            onPress={() => handleKeyPress(key)}
            accessibilityRole="button"
            accessibilityLabel={key === 'backspace' ? 'Delete' : key === '.' ? 'Decimal point' : key}
          >
            {key === 'backspace' ? (
              <Ionicons name="backspace-outline" size={28} color={colors.text} />
            ) : (
              <Text style={styles.keypadButtonText} maxFontSizeMultiplier={1.2}>{key}</Text>
            )}
          </TouchableOpacity>
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
          accessibilityLabel={isProcessing ? 'Processing payment' : isEnoughCash ? 'Complete payment' : 'Enter cash amount'}
          accessibilityState={{ disabled: !isEnoughCash || isProcessing }}
        >
          {isProcessing ? (
            <ActivityIndicator color="#fff" accessibilityLabel="Processing payment" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={24} color="#fff" />
              <Text style={styles.completeButtonText} maxFontSizeMultiplier={1.3}>
                {isEnoughCash ? 'Complete Payment' : 'Enter Cash Amount'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (colors: any, glassColors: typeof glass.dark, isDark: boolean) =>
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
      backgroundColor: glassColors.backgroundSubtle,
      borderBottomWidth: 1,
      borderBottomColor: glassColors.borderSubtle,
    },
    backButton: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: glassColors.border,
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
      borderBottomColor: glassColors.border,
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
    exactRow: {
      alignItems: 'center',
      paddingVertical: 12,
    },
    exactButton: {
      paddingHorizontal: 24,
      paddingVertical: 12,
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
    keypad: {
      flex: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 20,
      paddingVertical: 8,
      justifyContent: 'center',
    },
    keypadButton: {
      width: '30%',
      aspectRatio: 2,
      alignItems: 'center',
      justifyContent: 'center',
      margin: '1.5%',
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: glassColors.border,
    },
    keypadButtonText: {
      fontSize: 28,
      fontFamily: fonts.semiBold,
      color: colors.text,
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
