import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';

import { initStripe } from '@stripe/stripe-react-native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useTerminal } from '../context/StripeTerminalContext';
import { stripeTerminalApi } from '../lib/api';
import { formatCents } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { config } from '../lib/config';
import logger from '../lib/logger';
import { useTranslations } from '../lib/i18n';


type RouteParams = {
  PaymentProcessing: {
    paymentIntentId: string;
    clientSecret: string;
    stripeAccountId: string;
    amount: number;
    orderId?: string;
    orderNumber?: string;
    customerEmail?: string;
    preorderId?: string;
  };
};

// Server-driven payment timeout (2 minutes)
const SERVER_DRIVEN_TIMEOUT_MS = 120_000;

export function PaymentProcessingScreen() {
  const { colors } = useTheme();
  const { currency } = useAuth();
  const t = useTranslations('payment');
  const tc = useTranslations('common');
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'PaymentProcessing'>>();
  const {
    connectReader,
    processPayment: terminalProcessPayment,
    processServerDrivenPayment,
    cancelPayment,
    waitForWarm,
    preferredReader,
    terminalPaymentResult,
    clearTerminalPaymentResult,
  } = useTerminal();

  const { paymentIntentId, clientSecret, stripeAccountId, amount, orderId, orderNumber, customerEmail, preorderId } = route.params;
  const [isCancelling, setIsCancelling] = useState(false);
  const [statusText, setStatusText] = useState(t('preparingPayment'));
  const isCancelledRef = useRef(false);
  const isServerDriven = preferredReader?.readerType === 'internet';
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Navigate to PaymentResult via stack reset.
  // On SUCCESS: reset to [MainTabs, PaymentResult] — Checkout must NOT be in the
  // stack because clearCart() empties the cart, and Checkout's useEffect calls
  // goBack() when items.length === 0, which destroys the PaymentResult screen.
  // On FAILURE: keep Checkout so "Try Again" (goBack) returns there.
  const navigateToResult = useCallback((params: Record<string, any>) => {
    const fullParams: Record<string, any> = { ...params, paymentMethod: 'tap_to_pay' };
    navigation.dispatch((state: any) => {
      let routes;
      if (fullParams.success) {
        routes = [
          state.routes[0],
          { name: 'PaymentResult', params: fullParams },
        ];
      } else {
        routes = [
          ...state.routes.slice(0, -1),
          { name: 'PaymentResult', params: fullParams },
        ];
      }
      return CommonActions.reset({
        index: routes.length - 1,
        routes,
      });
    });
  }, [navigation]);

  // Watch for server-driven payment results from Socket.IO
  useEffect(() => {
    if (!isServerDriven || !terminalPaymentResult) return;

    // Only handle results for our PaymentIntent
    if (terminalPaymentResult.paymentIntentId && terminalPaymentResult.paymentIntentId !== paymentIntentId) {
      return;
    }

    if (isCancelledRef.current) return;

    // Clear timeout since we got a result
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (terminalPaymentResult.status === 'succeeded') {
      logger.log('[PaymentProcessing] Server-driven payment succeeded');
      clearTerminalPaymentResult();
      navigateToResult({
        success: true,
        amount,
        paymentIntentId,
        orderId,
        orderNumber,
        customerEmail,
        preorderId,
      });
    } else {
      logger.log('[PaymentProcessing] Server-driven payment failed:', terminalPaymentResult.error);
      clearTerminalPaymentResult();
      navigateToResult({
        success: false,
        amount,
        paymentIntentId,
        orderId,
        orderNumber,
        customerEmail,
        errorMessage: terminalPaymentResult.error || t('paymentFailedOnReader'),
        preorderId,
      });
    }
  }, [terminalPaymentResult, isServerDriven, paymentIntentId, isCancelledRef, amount, orderId, orderNumber, customerEmail, preorderId, navigation, clearTerminalPaymentResult]);

  useEffect(() => {
    if (isServerDriven) {
      processServerDrivenFlow();
    } else {
      processSDKFlow();
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Mode A: SDK-driven payment (Tap to Pay or Bluetooth reader)
  const processSDKFlow = async () => {
    try {
      if (Platform.OS === 'web') {
        setStatusText(t('tapToPayUnavailableOnWeb'));
        return;
      }

      // Wait for background warm (SDK init + reader pre-connect) to finish
      setStatusText(t('preparing'));
      await waitForWarm();

      // Ensure reader is connected (fast no-op if warm already connected it)
      setStatusText(t('connecting'));
      try {
        // If preferred reader is Bluetooth, connect via bluetoothScan; otherwise default tapToPay
        const discoveryMethod = preferredReader?.readerType === 'bluetooth' ? 'bluetoothScan' : 'tapToPay';
        await connectReader(discoveryMethod);
      } catch (connectErr: any) {
        if (connectErr.message?.includes('contact support')) {
          throw connectErr;
        }
        throw new Error(t('connectionFailed', { message: connectErr.message }));
      }

      // Initialize Stripe SDK with connected account for Terminal PI retrieval
      await initStripe({
        publishableKey: config.stripePublishableKey,
        merchantIdentifier: 'merchant.com.rowie',
        stripeAccountId,
      });

      setStatusText(t('startingPayment'));

      const result = await terminalProcessPayment(clientSecret);

      if (isCancelledRef.current) return;

      if (result.status === 'succeeded') {
        navigateToResult({
          success: true,
          amount,
          paymentIntentId,
          orderId,
          orderNumber,
          customerEmail,
          preorderId,
        });
      } else {
        throw new Error(t('paymentStatus', { status: result.status }));
      }
    } catch (error: any) {
      if (isCancelledRef.current) return;

      let errorMessage = error.message || t('paymentFailed');
      const lower = errorMessage.toLowerCase();

      if (lower.includes('command was canceled') ||
          lower.includes('command was cancelled')) {
        errorMessage = t('transactionCanceled');
      } else if (lower.includes('no such payment_intent')) {
        errorMessage = t('stripeSettingUp');
      } else if (
        // Network drop mid-payment — the tap may have completed on the
        // reader but our app couldn't confirm. Tell the cashier to verify
        // in History rather than charging the customer twice on retry.
        lower.includes('network') ||
        lower.includes('internet') ||
        lower.includes('connection') ||
        lower.includes('timed out') ||
        lower.includes('timeout') ||
        lower.includes('offline') ||
        lower.includes('unreachable')
      ) {
        errorMessage = t('paymentNetworkDropVerifyHistory');
      }

      navigateToResult({
        success: false,
        amount,
        paymentIntentId,
        orderId,
        orderNumber,
        customerEmail,
        errorMessage,
        preorderId,
      });
    }
  };

  // Mode B: Server-driven payment (Smart/Internet reader like S700, WisePOS E)
  const processServerDrivenFlow = async () => {
    try {
      if (!preferredReader) {
        throw new Error(t('noPreferredReader'));
      }

      setStatusText(t('sendingToReader', { readerLabel: preferredReader.label || 'reader' }));
      logger.log('[PaymentProcessing] Starting server-driven flow, reader:', preferredReader.id);

      // Clear any stale payment result
      clearTerminalPaymentResult();

      // Send the existing PaymentIntent to the reader
      await processServerDrivenPayment(preferredReader.id, paymentIntentId);

      setStatusText(t('waitingForCustomerTap'));

      // Set timeout — if no socket event within 2 minutes, fail
      timeoutRef.current = setTimeout(() => {
        if (!isCancelledRef.current) {
          logger.warn('[PaymentProcessing] Server-driven payment timed out');
          navigateToResult({
            success: false,
            amount,
            paymentIntentId,
            orderId,
            orderNumber,
            customerEmail,
            errorMessage: t('paymentTimedOut'),
            preorderId,
          });
        }
      }, SERVER_DRIVEN_TIMEOUT_MS);

      // Result will arrive via socket event, handled by the useEffect above

    } catch (error: any) {
      if (isCancelledRef.current) return;

      let errorMessage = error.message || t('failedToSendToReader');
      const lower = errorMessage.toLowerCase();

      if (errorMessage.includes('No such terminal.reader')) {
        errorMessage = t('readerNotFound');
      } else if (
        // Same network-drop guard as SDK flow: don't let a generic
        // "Failed to send to reader" hide the fact the payment may have
        // captured server-side. Cashier must verify in History before
        // re-running the charge.
        lower.includes('network') ||
        lower.includes('internet') ||
        lower.includes('connection') ||
        lower.includes('timed out') ||
        lower.includes('timeout') ||
        lower.includes('offline') ||
        lower.includes('unreachable')
      ) {
        errorMessage = t('paymentNetworkDropVerifyHistory');
      }

      navigateToResult({
        success: false,
        amount,
        paymentIntentId,
        orderId,
        orderNumber,
        customerEmail,
        errorMessage,
        preorderId,
      });
    }
  };

  const handleCancel = async () => {
    isCancelledRef.current = true;
    setIsCancelling(true);

    // Clear timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Navigate immediately for better UX
    navigation.goBack();

    // Cleanup in background (fire and forget)
    if (isServerDriven && preferredReader) {
      // Cancel the action on the smart reader
      stripeTerminalApi.cancelReaderAction(preferredReader.id).catch(() => {});
    } else {
      cancelPayment().catch(() => {});
    }
    stripeTerminalApi.cancelPaymentIntent(paymentIntentId).catch(() => {});
  };

  const styles = createStyles(colors);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.safeArea, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.content}>
          {/* Amount Display */}
          <Text style={styles.amount} maxFontSizeMultiplier={1.2} accessibilityRole="summary" accessibilityLabel={t('amountAccessibilityLabel', { amount: formatCents(amount, currency) })}>{formatCents(amount, currency)}</Text>

          {/* Loading indicator */}
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={t('processingPaymentAccessibility')} />
          </View>

          {/* Status */}
          <Text style={styles.statusText} maxFontSizeMultiplier={1.5} accessibilityRole="text" accessibilityLiveRegion="polite">{statusText}</Text>

          {/* Reader info for server-driven */}
          {isServerDriven && preferredReader && (
            <Text style={[styles.readerLabel, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
              {preferredReader.label || preferredReader.deviceType}
            </Text>
          )}

        </View>

        {/* Cancel Button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            disabled={isCancelling}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={isCancelling ? t('cancellingPaymentAccessibility') : t('cancelPaymentAccessibility')}
            accessibilityState={{ disabled: isCancelling }}
          >
            <Text style={styles.cancelButtonText} maxFontSizeMultiplier={1.3}>
              {isCancelling ? t('cancelling') : tc('cancel')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const createStyles = (colors: any) => {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
    },
    amount: {
      fontSize: 56,
      fontFamily: fonts.bold,
      color: colors.text,
      marginBottom: 48,
      fontVariant: ['tabular-nums'],
    },
    loaderContainer: {
      marginBottom: 24,
    },
    statusText: {
      fontSize: 16,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    readerLabel: {
      fontSize: 13,
      fontFamily: fonts.regular,
      textAlign: 'center',
      marginTop: 8,
    },
    footer: {
      padding: 20,
      paddingBottom: 36,
    },
    cancelButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      borderRadius: 16,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadows.sm,
    },
    cancelButtonText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.textSecondary,
    },
  });
};
