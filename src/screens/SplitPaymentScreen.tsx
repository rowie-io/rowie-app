import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useTerminal } from '../context/StripeTerminalContext';
import { useTapToPayGuard } from '../hooks/useTapToPayGuard';
import { ordersApi, OrderPayment, stripeTerminalApi } from '../lib/api';
import { formatCents, getCurrencySymbol, isZeroDecimal, fromSmallestUnit, toSmallestUnit, getStripeMinimumAmount } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { CardField, useConfirmPayment, CardFieldInput, initStripe } from '@stripe/stripe-react-native';
import { config } from '../lib/config';
import { useTranslations } from '../lib/i18n';
import { KeypadButton } from '../components/Keypad';

type RouteParams = {
  SplitPayment: {
    orderId: string;
    orderNumber: string;
    totalAmount: number; // in cents
    customerEmail?: string;
  };
};

type PaymentMethod = 'card' | 'cash' | 'tap_to_pay';
type AmountField = 'amount' | 'tendered';

const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'backspace'],
];

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
  const { guardCheckout } = useTapToPayGuard();
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
  // Which amount field the in-app keypad edits (OS decimal-pad replaced with
  // the same large keypad pattern used by QuickCharge / CashPayment).
  const [activeField, setActiveField] = useState<AmountField>('amount');
  const { width: screenWidth } = useWindowDimensions();

  const styles = createStyles(colors, isDark);

  // The tendered field only exists for cash — snap the keypad back to the
  // amount field when the method changes away from cash.
  useEffect(() => {
    if (selectedMethod !== 'cash' && activeField !== 'amount') {
      setActiveField('amount');
    }
  }, [selectedMethod, activeField]);

  // Keypad key sizing inside the payment form card (screen padding 20 + form
  // padding 20 on each side, 2 gaps of 10).
  const keypadButtonWidth = useMemo(
    () => Math.min(104, Math.max(64, Math.floor((screenWidth - 100) / 3))),
    [screenWidth]
  );

  // Shared digit handling for both amount fields: one decimal point max,
  // two decimals max, no decimal point for zero-decimal currencies.
  const applyKeypadKey = useCallback((prev: string, key: string): string => {
    if (key === 'backspace') return prev.slice(0, -1);
    if (key === '.') {
      if (isZeroDecimal(currency) || prev.includes('.')) return prev;
      return prev + '.';
    }
    if (!isZeroDecimal(currency)) {
      const parts = prev.split('.');
      if (parts[1] && parts[1].length >= 2) return prev;
    }
    if (prev.replace('.', '').length >= 8) return prev;
    return prev + key;
  }, [currency]);

  const handleKeypadKey = useCallback((key: string) => {
    if (activeField === 'tendered') {
      setCashTendered((prev) => applyKeypadKey(prev, key));
    } else {
      setPaymentAmount((prev) => applyKeypadKey(prev, key));
    }
  }, [activeField, applyKeypadKey]);

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
    // Standard TTP gate (no-op on Android/web/server-driven readers) — routes
    // the vendor to TapToPayEducation on iOS when the device hasn't run the
    // enable flow yet. Matches Checkout / QuickCharge / BookingDetail.
    if (!guardCheckout()) {
      return;
    }
    setIsProcessing(true);
    try {
      const isServerDriven = preferredReader?.readerType === 'internet';

      // Create payment intent via API. Order linkage MUST go through
      // metadata.orderId — the API's Zod schema strips unknown top-level keys
      // and only reads metadata.orderId for webhook/receipt attribution.
      // No top-level tipAmount here: split legs are arbitrary slices of the
      // order total, so the tip portion of a leg isn't attributable —
      // the platform fee falls back to the full leg amount (legacy behaviour).
      const piResponse = await stripeTerminalApi.createPaymentIntent({
        amount: fromSmallestUnit(amount, currency), // Convert smallest unit to base unit for API
        currency, // Multi-currency support — never assume USD
        metadata: {
          orderId,
          orderNumber,
          isQuickCharge: 'false',
        },
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
      // Order linkage goes through metadata.orderId — top-level orderId /
      // isQuickCharge were silently stripped by the API's Zod schema, leaving
      // these PIs unattributed. (See the tap-to-pay leg above re: no tipAmount.)
      const paymentIntent = await stripeTerminalApi.createPaymentIntent({
        amount: fromSmallestUnit(amount, currency),
        currency, // Multi-currency support — never assume USD
        metadata: {
          orderId,
          orderNumber,
          isQuickCharge: 'false',
        },
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
    setActiveField('amount');
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
                            color={belowMin ? colors.textMuted : selectedMethod === method ? colors.onPrimary : colors.text}
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

                  {/* Amount Input (in-app keypad below edits the active field) */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel} maxFontSizeMultiplier={1.5}>{t('paymentAmount')}</Text>
                    <Pressable
                      style={[styles.amountInputContainer, activeField === 'amount' && styles.amountFieldActive]}
                      onPress={() => setActiveField('amount')}
                      accessibilityRole="button"
                      accessibilityLabel={t('paymentAmountAccessibility')}
                      accessibilityState={{ selected: activeField === 'amount' }}
                    >
                      <Text style={styles.dollarSign} maxFontSizeMultiplier={1.3}>{getCurrencySymbol(currency)}</Text>
                      <Text
                        style={[styles.amountValue, !paymentAmount && styles.amountPlaceholder]}
                        maxFontSizeMultiplier={1.3}
                        numberOfLines={1}
                      >
                        {paymentAmount || (isZeroDecimal(currency) ? t('zeroDecimalPlaceholder') : t('decimalPlaceholder'))}
                      </Text>
                      <TouchableOpacity
                        style={styles.remainingButton}
                        onPress={handlePayRemaining}
                        accessibilityRole="button"
                        accessibilityLabel={t('fillRemainingAccessibility', { amount: formatCents(remainingBalance, currency) })}
                      >
                        <Text style={styles.remainingButtonText} maxFontSizeMultiplier={1.3}>{t('remainingButton')}</Text>
                      </TouchableOpacity>
                    </Pressable>
                  </View>

                  {/* Cash Tendered (for cash payments) */}
                  {selectedMethod === 'cash' && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel} maxFontSizeMultiplier={1.5}>{t('cashTenderedLabel')}</Text>
                      <Pressable
                        style={[styles.amountInputContainer, activeField === 'tendered' && styles.amountFieldActive]}
                        onPress={() => setActiveField('tendered')}
                        accessibilityRole="button"
                        accessibilityLabel={t('cashTenderedAmountAccessibility')}
                        accessibilityState={{ selected: activeField === 'tendered' }}
                      >
                        <Text style={styles.dollarSign} maxFontSizeMultiplier={1.3}>{getCurrencySymbol(currency)}</Text>
                        <Text
                          style={[styles.amountValue, !cashTendered && styles.amountPlaceholder]}
                          maxFontSizeMultiplier={1.3}
                          numberOfLines={1}
                        >
                          {cashTendered || (isZeroDecimal(currency) ? t('zeroDecimalPlaceholder') : t('decimalPlaceholder'))}
                        </Text>
                      </Pressable>
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

                  {/* In-app keypad — edits the highlighted amount field */}
                  <View style={styles.keypadContainer}>
                    {KEYPAD_ROWS.map((row, rowIndex) => (
                      <View key={rowIndex} style={styles.keypadRow}>
                        {row.map((key) => (
                          <KeypadButton
                            key={key}
                            keyValue={key}
                            onPress={handleKeypadKey}
                            colors={colors}
                            buttonSize={keypadButtonWidth}
                            buttonHeight={52}
                            backgroundColor={colors.surface}
                            pressedBackgroundColor={colors.background}
                            disabled={key === '.' && isZeroDecimal(currency)}
                            accessibilityLabel={key === 'backspace' ? t('deleteKey') : key === '.' ? t('decimalPoint') : key}
                          />
                        ))}
                      </View>
                    ))}
                  </View>

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
      minHeight: 44,
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
      color: colors.onPrimary,
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
      minHeight: 52,
    },
    amountFieldActive: {
      borderColor: colors.primary,
      borderWidth: 1.5,
    },
    dollarSign: {
      fontSize: 20,
      fontFamily: fonts.semiBold,
      color: colors.textSecondary,
      marginRight: 4,
    },
    amountValue: {
      flex: 1,
      fontSize: 20,
      fontFamily: fonts.semiBold,
      color: colors.text,
      paddingVertical: 14,
    },
    amountPlaceholder: {
      color: colors.textMuted,
    },
    keypadContainer: {
      marginBottom: 8,
    },
    keypadRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 10,
      marginBottom: 10,
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
