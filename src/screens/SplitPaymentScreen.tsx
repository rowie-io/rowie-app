import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Vibration,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useTerminal } from '../context/StripeTerminalContext';
import { ordersApi, OrderPayment, stripeTerminalApi } from '../lib/api';
import { formatCents, getCurrencySymbol, isZeroDecimal, fromSmallestUnit, toSmallestUnit, getStripeMinimumAmount } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { CardField, useConfirmPayment, CardFieldInput, initStripe } from '@stripe/stripe-react-native';
import { config } from '../lib/config';
import { useTranslations } from '../lib/i18n';

type RouteParams = {
  SplitPayment: {
    orderId: string;
    orderNumber: string;
    totalAmount: number; // in cents
    customerEmail?: string;
  };
};

type PaymentMethod = 'card' | 'cash' | 'tap_to_pay';

export function SplitPaymentScreen() {
  const { colors, isDark } = useTheme();
  const { currency } = useAuth();
  const t = useTranslations('payment');
  const tc = useTranslations('common');
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'SplitPayment'>>();
  const { clearCart } = useCart();
  const { initializeTerminal, connectReader, processPayment: terminalProcessPayment, preferredReader, processServerDrivenPayment, waitForWarm } = useTerminal();
  const { confirmPayment } = useConfirmPayment();

  const { orderId, orderNumber, totalAmount, customerEmail } = route.params;

  const [payments, setPayments] = useState<OrderPayment[]>([]);
  const [totalPaid, setTotalPaid] = useState(0);
  const [remainingBalance, setRemainingBalance] = useState(totalAmount);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  // Add payment modal state
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('tap_to_pay');
  const [cardDetails, setCardDetails] = useState<CardFieldInput.Details | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [cashTendered, setCashTendered] = useState('');

  const styles = createStyles(colors, isDark);

  // Fetch existing payments
  const fetchPayments = useCallback(async () => {
    try {
      const response = await ordersApi.getPayments(orderId);
      setPayments(response.payments);
      setTotalPaid(response.totalPaid);
      setRemainingBalance(response.remainingBalance);

      // Check if order is complete
      if (response.remainingBalance <= 0) {
        handleOrderComplete();
      }
    } catch (error: any) {
      // Surfacing this matters: a silent failure leaves the cashier
      // staring at "$0.00 / $0.00 remaining" with no idea why nothing
      // works. Show an alert so they know to check connectivity / retry.
      // ordersApi.getPayments throws ApiError {error, ...} from apiClient —
      // prefer `.error` so the API's reason isn't masked.
      Alert.alert(
        t('splitPaymentFailedTitle'),
        error?.error || error?.message || t('paymentFailed')
      );
    } finally {
      setIsLoading(false);
    }
  }, [orderId, t]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const handleOrderComplete = () => {
    clearCart();
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
              paymentMethod: 'split',
            },
          },
        ],
      })
    );
  };

  // Process terminal payment (Tap to Pay, Bluetooth, or Internet/Smart reader)
  const processTapToPayPayment = async (amount: number) => {
    setIsProcessing(true);
    try {
      const isServerDriven = preferredReader?.readerType === 'internet';

      // Create payment intent via API
      const piResponse = await stripeTerminalApi.createPaymentIntent({
        amount: fromSmallestUnit(amount, currency), // Convert smallest unit to base unit for API
        currency, // Multi-currency support — never assume USD
      });

      if (isServerDriven) {
        // Server-driven flow for smart/internet readers (S700, WisePOS E, etc.)
        await processServerDrivenPayment(preferredReader.id, piResponse.id);

        // Wait for the payment to complete via the reader (poll for result)
        // Server-driven payments are confirmed by the reader, so we record it immediately
        await ordersApi.addPayment(orderId, {
          paymentMethod: 'tap_to_pay',
          amount,
          stripePaymentIntentId: piResponse.id,
          readerId: preferredReader.id,
          readerLabel: preferredReader.label || undefined,
          readerType: 'internet',
        });
      } else {
        // SDK-driven flow (Tap to Pay or Bluetooth reader)
        await waitForWarm();
        const discoveryMethod = preferredReader?.readerType === 'bluetooth' ? 'bluetoothScan' : 'tapToPay';
        await connectReader(discoveryMethod);

        // Initialize Stripe SDK with connected account for Terminal PI retrieval
        await initStripe({
          publishableKey: config.stripePublishableKey,
          merchantIdentifier: 'merchant.com.rowie',
          stripeAccountId: piResponse.stripeAccountId,
        });

        // Process payment through the Terminal context (retrieve → collect → confirm)
        const result = await terminalProcessPayment(piResponse.clientSecret);

        if (result.status !== 'succeeded') {
          throw new Error(t('paymentStatus', { status: result.status }));
        }

        await ordersApi.addPayment(orderId, {
          paymentMethod: 'tap_to_pay',
          amount,
          stripePaymentIntentId: piResponse.id,
          readerId: preferredReader?.id,
          readerLabel: preferredReader?.label || undefined,
          readerType: preferredReader?.readerType || 'tap_to_pay',
        });
      }

      await fetchPayments();
      setShowAddPayment(false);
      resetPaymentForm();
    } catch (error: any) {
      // Mixed catch: Stripe Terminal SDK errors (Error w/ .message) AND
      // apiClient ApiError (.error, no .message). Prefer `.error` so the
      // API's reason surfaces, fall back to `.message` for SDK errors.
      Alert.alert(t('splitPaymentFailedTitle'), error?.error || error?.message || t('paymentFailed'));
    } finally {
      setIsProcessing(false);
    }
  };

  // Process manual card entry payment (regular Stripe SDK)
  const processManualCardPayment = async (amount: number) => {
    if (!cardDetails?.complete) {
      Alert.alert(t('splitCardRequiredTitle'), t('splitCardRequiredMessage'));
      return;
    }

    setIsProcessing(true);
    try {
      const paymentIntent = await stripeTerminalApi.createPaymentIntent({
        amount: fromSmallestUnit(amount, currency),
        currency, // Multi-currency support — never assume USD
        orderId,
        isQuickCharge: false,
        captureMethod: 'automatic',
        paymentMethodType: 'card',
      });

      await initStripe({
        publishableKey: config.stripePublishableKey,
        merchantIdentifier: 'merchant.com.rowie',
        stripeAccountId: paymentIntent.stripeAccountId,
      });

      const { error, paymentIntent: confirmedIntent } = await confirmPayment(paymentIntent.clientSecret, {
        paymentMethodType: 'Card',
        paymentMethodData: {
          billingDetails: {
            email: customerEmail || undefined,
          },
        },
      });

      if (error) {
        throw new Error(error.message || t('paymentFailed'));
      }

      if (confirmedIntent?.status !== 'Succeeded') {
        throw new Error(t('paymentWasNotSuccessful'));
      }

      await ordersApi.addPayment(orderId, {
        paymentMethod: 'card',
        amount,
        stripePaymentIntentId: paymentIntent.id,
      });

      await fetchPayments();
      setShowAddPayment(false);
      resetPaymentForm();
    } catch (error: any) {
      // Mixed catch: Stripe SDK confirmPayment Error (.message) AND apiClient
      // ApiError (.error, no .message). Prefer `.error`, fall back to `.message`.
      Alert.alert(t('splitPaymentFailedTitle'), error?.error || error?.message || t('paymentFailed'));
    } finally {
      setIsProcessing(false);
    }
  };

  // Process cash payment
  const processCashPayment = async (amount: number, tendered: number) => {
    setIsProcessing(true);
    try {
      await ordersApi.addPayment(orderId, {
        paymentMethod: 'cash',
        amount,
        cashTendered: tendered,
      });

      // Show change if any
      const change = tendered - amount;
      if (change > 0) {
        Alert.alert(t('changeDueAlertTitle'), t('changeDueAlertMessage', { amount: formatCents(change, currency) }));
      }

      // Refresh payments
      await fetchPayments();
      setShowAddPayment(false);
      resetPaymentForm();
    } catch (error: any) {
      // ordersApi.addPayment throws ApiError {error, ...} from apiClient —
      // prefer `.error` so the API's reason surfaces.
      Alert.alert(t('splitPaymentFailedTitle'), error?.error || error?.message || t('paymentFailed'));
    } finally {
      setIsProcessing(false);
    }
  };

  const resetPaymentForm = () => {
    setPaymentAmount('');
    setCashTendered('');
    setCardDetails(null);
    setSelectedMethod('tap_to_pay');
  };

  // Stripe's minimum charge varies by currency (e.g. $0.50 USD, £0.30 GBP,
  // ¥50 JPY). Resolve per-currency instead of hardcoding the USD value.
  const MIN_STRIPE_AMOUNT = getStripeMinimumAmount(currency);

  const amountCents = toSmallestUnit(parseFloat(paymentAmount || '0'), currency);
  const isStripeMethod = selectedMethod === 'tap_to_pay' || selectedMethod === 'card';
  const isBelowStripeMinimum = isStripeMethod && amountCents > 0 && amountCents < MIN_STRIPE_AMOUNT;

  // Auto-switch to cash if remaining balance drops below Stripe minimum
  useEffect(() => {
    if (remainingBalance > 0 && remainingBalance < MIN_STRIPE_AMOUNT && (selectedMethod === 'tap_to_pay' || selectedMethod === 'card')) {
      setSelectedMethod('cash');
    }
  }, [remainingBalance, selectedMethod, MIN_STRIPE_AMOUNT]);

  const handleAddPayment = async () => {
    if (amountCents <= 0) {
      Alert.alert(t('invalidAmountTitle'), t('invalidAmountMessage'));
      return;
    }

    if (amountCents > remainingBalance) {
      Alert.alert(t('amountTooHighTitle'), t('amountTooHighMessage', { amount: formatCents(remainingBalance, currency) }));
      return;
    }

    if (selectedMethod === 'cash') {
      const tenderedCents = toSmallestUnit(parseFloat(cashTendered || '0'), currency);
      if (tenderedCents < amountCents) {
        Alert.alert(t('insufficientCashSplitTitle'), t('insufficientCashSplitMessage'));
        return;
      }
      await processCashPayment(amountCents, tenderedCents);
    } else if (selectedMethod === 'tap_to_pay') {
      await processTapToPayPayment(amountCents);
    } else {
      await processManualCardPayment(amountCents);
    }
  };

  const handlePayRemaining = () => {
    const base = fromSmallestUnit(remainingBalance, currency);
    setPaymentAmount(isZeroDecimal(currency) ? String(base) : base.toFixed(2));
  };

  const getPaymentMethodIcon = (method: PaymentMethod): ComponentProps<typeof Ionicons>['name'] => {
    switch (method) {
      case 'cash':
        return 'cash-outline';
      case 'card':
        return 'card-outline';
      case 'tap_to_pay':
        return 'phone-portrait-outline';
      default:
        return 'card-outline';
    }
  };

  const getPaymentMethodLabel = (method: PaymentMethod): string => {
    switch (method) {
      case 'cash':
        return t('cashMethodLabel');
      case 'card':
        return t('cardMethodLabel');
      case 'tap_to_pay':
        return t('tapToPayMethodLabel');
      default:
        return t('cardMethodLabel');
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={t('loadingPaymentDetails')} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
      >
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
          <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>{t('splitPaymentTitle')}</Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          {/* Order Summary */}
          <View style={styles.summaryCard} accessibilityRole="summary" accessibilityLabel={t('orderSummaryAccessibility', { totalAmount: formatCents(totalAmount, currency), totalPaid: formatCents(totalPaid, currency), remainingBalance: formatCents(remainingBalance, currency) })}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel} maxFontSizeMultiplier={1.5}>{t('orderTotal')}</Text>
              <Text style={styles.summaryValue} maxFontSizeMultiplier={1.3}>{formatCents(totalAmount, currency)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel} maxFontSizeMultiplier={1.5}>{t('totalPaid')}</Text>
              <Text style={[styles.summaryValue, { color: colors.success }]} maxFontSizeMultiplier={1.3}>
                {formatCents(totalPaid, currency)}
              </Text>
            </View>
            <View style={[styles.summaryRow, styles.remainingRow]}>
              <Text style={styles.remainingLabel} maxFontSizeMultiplier={1.5}>{t('remaining')}</Text>
              <Text style={styles.remainingValue} maxFontSizeMultiplier={1.2}>{formatCents(remainingBalance, currency)}</Text>
            </View>
          </View>

          {/* Existing Payments */}
          {payments.length > 0 && (
            <View style={styles.paymentsSection}>
              <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.5}>{t('payments')}</Text>
              {payments.map((payment, index) => (
                <View key={payment.id || index} style={styles.paymentRow}>
                  <View style={styles.paymentLeft}>
                    <Ionicons
                      name={getPaymentMethodIcon(payment.paymentMethod)}
                      size={20}
                      color={colors.primary}
                    />
                    <Text style={styles.paymentMethod} maxFontSizeMultiplier={1.5}>
                      {getPaymentMethodLabel(payment.paymentMethod)}
                    </Text>
                  </View>
                  <Text style={styles.paymentAmount} maxFontSizeMultiplier={1.5}>
                    {formatCents(payment.amount, currency)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Add Payment Section */}
          {remainingBalance > 0 && (
            <View style={styles.addPaymentSection}>
              {!showAddPayment ? (
                <TouchableOpacity
                  style={styles.addPaymentButton}
                  onPress={() => setShowAddPayment(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t('addPayment')}
                  accessibilityHint={t('addPaymentHint', { amount: formatCents(remainingBalance, currency) })}
                >
                  <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                  <Text style={styles.addPaymentButtonText} maxFontSizeMultiplier={1.3}>{t('addPayment')}</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.paymentForm}>
                  <Text style={styles.formTitle} maxFontSizeMultiplier={1.3}>{t('addPayment')}</Text>

                  {/* Payment Method Selection */}
                  <View style={styles.methodSelection}>
                    {(['tap_to_pay', 'card', 'cash'] as PaymentMethod[]).map((method) => {
                      const isStripe = method === 'tap_to_pay' || method === 'card';
                      const belowMin = isStripe && remainingBalance < MIN_STRIPE_AMOUNT;
                      return (
                        <TouchableOpacity
                          key={method}
                          style={[
                            styles.methodButton,
                            selectedMethod === method && styles.methodButtonSelected,
                            belowMin && styles.methodButtonDisabled,
                          ]}
                          onPress={() => setSelectedMethod(method)}
                          disabled={belowMin}
                          accessibilityRole="button"
                          accessibilityLabel={`${getPaymentMethodLabel(method)}${belowMin ? t('belowMinimumUnavailable') : ''}`}
                          accessibilityState={{ selected: selectedMethod === method, disabled: belowMin }}
                        >
                          <Ionicons
                            name={getPaymentMethodIcon(method)}
                            size={20}
                            color={belowMin ? colors.textMuted : selectedMethod === method ? '#fff' : colors.text}
                          />
                          <Text
                            style={[
                              styles.methodButtonText,
                              selectedMethod === method && styles.methodButtonTextSelected,
                              belowMin && styles.methodButtonTextDisabled,
                            ]}
                            maxFontSizeMultiplier={1.3}
                          >
                            {getPaymentMethodLabel(method)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Stripe minimum warning */}
                  {isBelowStripeMinimum && (
                    <View style={styles.minimumWarning} accessibilityRole="alert">
                      <Ionicons name="warning" size={16} color={colors.warning} style={styles.minimumWarningIcon} />
                      <Text style={styles.minimumWarningText} maxFontSizeMultiplier={1.5}>
                        {t('minimumWarningMessage', { method: selectedMethod === 'tap_to_pay' ? t('tapToPayMethodLabel') : t('cardMethodLabel'), amount: formatCents(MIN_STRIPE_AMOUNT, currency) })}
                      </Text>
                    </View>
                  )}

                  {/* Amount Input */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel} maxFontSizeMultiplier={1.5}>{t('paymentAmount')}</Text>
                    <View style={styles.amountInputContainer}>
                      <Text style={styles.dollarSign} maxFontSizeMultiplier={1.3}>{getCurrencySymbol(currency)}</Text>
                      <TextInput
                        style={styles.amountInput}
                        value={paymentAmount}
                        onChangeText={setPaymentAmount}
                        keyboardType="decimal-pad"
                        placeholder={isZeroDecimal(currency) ? t('zeroDecimalPlaceholder') : t('decimalPlaceholder')}
                        placeholderTextColor={colors.textMuted}
                        accessibilityLabel={t('paymentAmountAccessibility')}
                      />
                      <TouchableOpacity
                        style={styles.remainingButton}
                        onPress={handlePayRemaining}
                        accessibilityRole="button"
                        accessibilityLabel={t('fillRemainingAccessibility', { amount: formatCents(remainingBalance, currency) })}
                      >
                        <Text style={styles.remainingButtonText} maxFontSizeMultiplier={1.3}>{t('remainingButton')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Cash Tendered (for cash payments) */}
                  {selectedMethod === 'cash' && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel} maxFontSizeMultiplier={1.5}>{t('cashTenderedLabel')}</Text>
                      <View style={styles.amountInputContainer}>
                        <Text style={styles.dollarSign} maxFontSizeMultiplier={1.3}>{getCurrencySymbol(currency)}</Text>
                        <TextInput
                          style={styles.amountInput}
                          value={cashTendered}
                          onChangeText={setCashTendered}
                          keyboardType="decimal-pad"
                          placeholder={isZeroDecimal(currency) ? t('zeroDecimalPlaceholder') : t('decimalPlaceholder')}
                          placeholderTextColor={colors.textMuted}
                          accessibilityLabel={t('cashTenderedAmountAccessibility')}
                        />
                      </View>
                      {/* Change calculation */}
                      {cashTendered && paymentAmount && (
                        <View style={styles.changeDisplay}>
                          <Text style={styles.changeLabel} maxFontSizeMultiplier={1.5}>{t('changeDueLabel')}</Text>
                          <Text style={styles.changeAmount} maxFontSizeMultiplier={1.3}>
                            {formatCents(toSmallestUnit(Math.max(0, parseFloat(cashTendered) - parseFloat(paymentAmount)), currency), currency)}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Card Entry (for manual card payments) */}
                  {selectedMethod === 'card' && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel} maxFontSizeMultiplier={1.5}>{t('cardDetails')}</Text>
                      <CardField
                        postalCodeEnabled={false}
                        cardStyle={{
                          backgroundColor: isDark ? colors.card : '#FFFFFF',
                          textColor: colors.text,
                          placeholderColor: colors.textMuted,
                          borderColor: colors.border,
                          borderWidth: 1,
                          borderRadius: 12,
                          fontSize: 16,
                        }}
                        style={{ width: '100%', height: 50, marginTop: 8 }}
                        onCardChange={setCardDetails}
                      />
                    </View>
                  )}

                  {/* Form Actions */}
                  <View style={styles.formActions}>
                    <TouchableOpacity
                      style={styles.cancelFormButton}
                      onPress={() => {
                        setShowAddPayment(false);
                        resetPaymentForm();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t('cancelAddingPayment')}
                    >
                      <Text style={styles.cancelFormButtonText} maxFontSizeMultiplier={1.3}>{tc('cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.processButton,
                        (isProcessing || isBelowStripeMinimum) && styles.processButtonDisabled,
                      ]}
                      onPress={handleAddPayment}
                      disabled={isProcessing || isBelowStripeMinimum}
                      accessibilityRole="button"
                      accessibilityLabel={isProcessing ? t('processingPaymentAccessibility') : t('processPaymentAccessibility')}
                      accessibilityState={{ disabled: isProcessing || isBelowStripeMinimum }}
                    >
                      {isProcessing ? (
                        <ActivityIndicator color="#fff" size="small" accessibilityLabel={t('processingPaymentIndicator')} />
                      ) : (
                        <>
                          <Ionicons name="checkmark-circle" size={20} color="#fff" />
                          <Text style={styles.processButtonText} maxFontSizeMultiplier={1.3}>{t('process')}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* Footer - Complete if balance is 0 */}
        {remainingBalance <= 0 && (
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.completeButton}
              onPress={handleOrderComplete}
              accessibilityRole="button"
              accessibilityLabel={t('paymentCompleteAccessibility')}
              accessibilityHint={t('paymentCompleteHint')}
            >
              <Ionicons name="checkmark-circle" size={24} color="#fff" />
              <Text style={styles.completeButtonText} maxFontSizeMultiplier={1.3}>{t('paymentComplete')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const createStyles = (colors: any, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    keyboardView: {
      flex: 1,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
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
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: 20,
    },
    summaryCard: {
      backgroundColor: colors.card,
      borderRadius: 20,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 20,
      ...shadows.md,
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    summaryLabel: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
    },
    summaryValue: {
      fontSize: 17,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    remainingRow: {
      marginBottom: 0,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.borderSubtle,
    },
    remainingLabel: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    remainingValue: {
      fontSize: 24,
      fontFamily: fonts.bold,
      color: colors.primary,
    },
    paymentsSection: {
      marginBottom: 20,
    },
    sectionTitle: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.text,
      marginBottom: 12,
    },
    paymentRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 8,
    },
    paymentLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    paymentMethod: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: colors.text,
    },
    paymentAmount: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.success,
    },
    addPaymentSection: {
      marginTop: 8,
    },
    addPaymentButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingVertical: 16,
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.primary + '40',
      borderStyle: 'dashed',
    },
    addPaymentButtonText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    paymentForm: {
      backgroundColor: colors.card,
      borderRadius: 20,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadows.md,
    },
    formTitle: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: colors.text,
      marginBottom: 16,
    },
    methodSelection: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 20,
    },
    methodButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    methodButtonSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    methodButtonDisabled: {
      opacity: 0.4,
    },
    methodButtonText: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.text,
    },
    methodButtonTextSelected: {
      color: '#fff',
    },
    methodButtonTextDisabled: {
      color: colors.textMuted,
    },
    minimumWarning: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: colors.warning + '15',
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.warning + '30',
    },
    minimumWarningIcon: {
      marginTop: 1,
    },
    minimumWarningText: {
      flex: 1,
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.warning,
      lineHeight: 18,
    },
    inputGroup: {
      marginBottom: 16,
    },
    inputLabel: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
      marginBottom: 8,
    },
    amountInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
    },
    dollarSign: {
      fontSize: 20,
      fontFamily: fonts.semiBold,
      color: colors.textSecondary,
      marginRight: 4,
    },
    amountInput: {
      flex: 1,
      fontSize: 20,
      fontFamily: fonts.semiBold,
      color: colors.text,
      paddingVertical: 14,
    },
    remainingButton: {
      backgroundColor: colors.primary + '20',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
    },
    remainingButtonText: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.primary,
    },
    changeDisplay: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 10,
      paddingHorizontal: 4,
    },
    changeLabel: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.success,
    },
    changeAmount: {
      fontSize: 18,
      fontFamily: fonts.bold,
      color: colors.success,
    },
    formActions: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 8,
    },
    cancelFormButton: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    cancelFormButtonText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    processButton: {
      flex: 2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: colors.success,
    },
    processButtonDisabled: {
      opacity: 0.6,
    },
    processButtonText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: '#fff',
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
    completeButtonText: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: '#fff',
    },
  });
