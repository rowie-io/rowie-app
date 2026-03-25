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
import { glass } from '../lib/colors';
import { shadows } from '../lib/shadows';
import { StarBackground } from '../components/StarBackground';
import { config } from '../lib/config';
import logger from '../lib/logger';


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
  const { colors, isDark } = useTheme();
  const { currency } = useAuth();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'PaymentProcessing'>>();
  const glassColors = isDark ? glass.dark : glass.light;
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
  const [statusText, setStatusText] = useState('Preparing payment...');
  const isCancelledRef = useRef(false);
  const isServerDriven = preferredReader?.readerType === 'internet';
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Navigate to PaymentResult via stack reset.
  // On SUCCESS: reset to [MainTabs, PaymentResult] — Checkout must NOT be in the
  // stack because clearCart() empties the cart, and Checkout's useEffect calls
  // goBack() when items.length === 0, which destroys the PaymentResult screen.
  // On FAILURE: keep Checkout so "Try Again" (goBack) returns there.
  const navigateToResult = useCallback((params: Record<string, any>) => {
    navigation.dispatch((state: any) => {
      let routes;
      if (params.success) {
        routes = [
          state.routes[0],
          { name: 'PaymentResult', params },
        ];
      } else {
        routes = [
          ...state.routes.slice(0, -1),
          { name: 'PaymentResult', params },
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
        errorMessage: terminalPaymentResult.error || 'Payment failed on reader',
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
        setStatusText('Tap to Pay unavailable on web');
        return;
      }

      // Wait for background warm (SDK init + reader pre-connect) to finish
      setStatusText('Preparing...');
      await waitForWarm();

      // Ensure reader is connected (fast no-op if warm already connected it)
      setStatusText('Connecting...');
      try {
        // If preferred reader is Bluetooth, connect via bluetoothScan; otherwise default tapToPay
        const discoveryMethod = preferredReader?.readerType === 'bluetooth' ? 'bluetoothScan' : 'tapToPay';
        await connectReader(discoveryMethod);
      } catch (connectErr: any) {
        if (connectErr.message?.includes('contact support')) {
          throw connectErr;
        }
        throw new Error(`Connection failed: ${connectErr.message}`);
      }

      // Initialize Stripe SDK with connected account for Terminal PI retrieval
      await initStripe({
        publishableKey: config.stripePublishableKey,
        merchantIdentifier: 'merchant.com.rowie',
        stripeAccountId,
      });

      setStatusText('Starting payment...');

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
        throw new Error(`Payment status: ${result.status}`);
      }
    } catch (error: any) {
      if (isCancelledRef.current) return;

      let errorMessage = error.message || 'Payment failed';

      if (errorMessage.toLowerCase().includes('command was canceled') ||
          errorMessage.toLowerCase().includes('command was cancelled')) {
        errorMessage = 'The transaction was canceled.';
      } else if (errorMessage.toLowerCase().includes('no such payment_intent')) {
        errorMessage = 'Stripe is still setting up your account. This can take a few minutes after onboarding. Please try again shortly, or contact support if the issue persists.';
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
        throw new Error('No preferred reader configured');
      }

      setStatusText(`Sending to ${preferredReader.label || 'reader'}...`);
      logger.log('[PaymentProcessing] Starting server-driven flow, reader:', preferredReader.id);

      // Clear any stale payment result
      clearTerminalPaymentResult();

      // Send the existing PaymentIntent to the reader
      await processServerDrivenPayment(preferredReader.id, paymentIntentId);

      setStatusText('Waiting for customer to tap card...');

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
            errorMessage: 'Payment timed out. The reader may be offline or the customer did not tap their card.',
            preorderId,
          });
        }
      }, SERVER_DRIVEN_TIMEOUT_MS);

      // Result will arrive via socket event, handled by the useEffect above

    } catch (error: any) {
      if (isCancelledRef.current) return;

      let errorMessage = error.message || 'Failed to send payment to reader';

      if (errorMessage.includes('No such terminal.reader')) {
        errorMessage = 'Reader not found. It may have been removed or is offline.';
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

  const styles = createStyles(colors, glassColors);

  return (
    <StarBackground colors={colors} isDark={isDark}>
      <View style={[styles.safeArea, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.content}>
          {/* Amount Display */}
          <Text style={styles.amount} maxFontSizeMultiplier={1.2} accessibilityRole="summary" accessibilityLabel={`Amount ${formatCents(amount, currency)}`}>{formatCents(amount, currency)}</Text>

          {/* Loading indicator */}
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Processing payment" />
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
            accessibilityLabel={isCancelling ? 'Cancelling payment' : 'Cancel payment'}
            accessibilityState={{ disabled: isCancelling }}
          >
            <Text style={styles.cancelButtonText} maxFontSizeMultiplier={1.3}>
              {isCancelling ? 'Cancelling...' : 'Cancel'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </StarBackground>
  );
}

const createStyles = (colors: any, glassColors: typeof glass.dark) => {
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
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
      ...shadows.sm,
    },
    cancelButtonText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.textSecondary,
    },
  });
};
