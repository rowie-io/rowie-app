import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  TextInput,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { CardField, useConfirmPayment, CardFieldInput, initStripe } from '@stripe/stripe-react-native';
import { config } from '../lib/config';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { formatCents, fromSmallestUnit } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { useQueryClient } from '@tanstack/react-query';
import { stripeTerminalApi, ordersApi } from '../lib/api';
import logger from '../lib/logger';
import { isValidEmail } from '../lib/validation';
import { useTranslations } from '../lib/i18n';

type PaymentMethodType = 'tap_to_pay' | 'cash' | 'split' | 'card';

type RouteParams = {
  PaymentResult: {
    success: boolean;
    amount: number;
    paymentIntentId: string;
    orderId?: string;
    orderNumber?: string;
    customerEmail?: string;
    errorMessage?: string;
    skipToCardEntry?: boolean; // Go directly to card entry page
    preorderId?: string; // If present, complete the preorder on success
    paymentMethod?: PaymentMethodType;
    cashTendered?: number; // Cash tendered in smallest currency unit
    changeAmount?: number; // Change due in smallest currency unit
  };
};

export function PaymentResultScreen() {
  const { colors, isDark } = useTheme();
  const { currency } = useAuth();
  const t = useTranslations('payment');
  const tc = useTranslations('common');
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'PaymentResult'>>();
  const { clearCart } = useCart();
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const queryClient = useQueryClient();
  const { success, amount, paymentIntentId, orderId, orderNumber, customerEmail, errorMessage, skipToCardEntry, preorderId, paymentMethod, cashTendered, changeAmount } = route.params;

  // Resolve the payment method (PaymentProcessingScreen may not pass it explicitly)
  const resolvedMethod: PaymentMethodType = paymentMethod || 'tap_to_pay';

  // Method-specific visual config
  const methodConfig = useMemo(() => {
    switch (resolvedMethod) {
      case 'cash':
        return {
          iconName: 'cash-outline' as const,
          iconColor: '#fff',
          accentColor: colors.primary,
          bgColor: colors.primary,
          title: t('cashReceived'),
          badgeText: t('transactionCompleted'),
          confettiColors: ['#FBBF24', '#F59E0B', '#D97706', '#22C55E', '#FFD700'],
        };
      case 'split':
        return {
          iconName: 'layers-outline' as const,
          iconColor: '#fff',
          accentColor: '#8B5CF6', // Purple accent for split
          bgColor: '#8B5CF6',
          title: t('splitComplete'),
          badgeText: t('splitMethodsBadge'),
          confettiColors: ['#8B5CF6', '#A78BFA', '#22C55E', '#F59E0B', '#4ECDC4'],
        };
      case 'card':
        return {
          iconName: 'card-outline' as const,
          iconColor: '#fff',
          accentColor: colors.success,
          bgColor: colors.success,
          title: t('cardPaymentComplete'),
          badgeText: t('transactionCompleted'),
          confettiColors: [colors.success, '#86EFAC', '#F59E0B', '#FFD700', '#4ECDC4'],
        };
      default: // tap_to_pay
        return {
          iconName: 'radio-outline' as const,
          iconColor: '#fff',
          accentColor: colors.success,
          bgColor: colors.success,
          title: t('tapComplete'),
          badgeText: t('transactionCompleted'),
          confettiColors: [colors.success, '#86EFAC', '#F59E0B', '#FFD700', '#4ECDC4'],
        };
    }
  }, [resolvedMethod, colors, t]);

  // Dynamic font sizes based on screen width (accounting for 24px padding on each side)
  const amountText = formatCents(amount, currency);
  const availableWidth = screenWidth - 48;
  const amountFontSize = Math.min(56, availableWidth / (amountText.length * 0.55));
  const titleFontSize = Math.min(26, availableWidth / 11);

  // Receipt state
  const [receiptEmail, setReceiptEmail] = useState(customerEmail || '');
  const [receiptSent, setReceiptSent] = useState(false);
  const [sendingReceipt, setSendingReceipt] = useState(false);
  const [showEmailInput, setShowEmailInput] = useState(false);

  // Manual card entry state - fallback when Tap to Pay fails
  const [showCardEntry, setShowCardEntry] = useState(false);
  const [cardDetails, setCardDetails] = useState<CardFieldInput.Details | null>(null);
  const [processingCard, setProcessingCard] = useState(false);

  // Stripe hook for confirming card payments
  const { confirmPayment } = useConfirmPayment();

  // Invalidate transaction cache on any successful payment so History tab is fresh
  useEffect(() => {
    if (success) {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    }
  }, [success, queryClient]);

  // Auto-send receipt if customer email was provided during checkout
  useEffect(() => {
    if (success && customerEmail && paymentIntentId && !receiptSent) {
      const autoSendReceipt = async () => {
        try {
          await stripeTerminalApi.sendReceipt(paymentIntentId, customerEmail.trim());
          setReceiptSent(true);
          logger.log('[PaymentResult] Auto-sent receipt to:', customerEmail);
        } catch (error) {
          logger.error('[PaymentResult] Failed to auto-send receipt:', error);
          // Don't show error to user - they can manually send later
        }
      };
      autoSendReceipt();
    }
  }, [success, customerEmail, paymentIntentId, receiptSent]);

  // Legacy preorder completion flow — preorders were replaced by table_sessions.
  // The session system handles its own settlement via /sessions/{id}/settle.
  // This effect is preserved only to invalidate the transactions cache if the
  // caller still passes preorderId; the actual completion is now done via the
  // session settle endpoint upstream.
  useEffect(() => {
    if (success && preorderId && paymentIntentId) {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    }
  }, [success, preorderId, paymentIntentId, queryClient]);

  // Animations
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const bounceAnim = useRef(new Animated.Value(1)).current; // Start at 1 to avoid layout shift
  const rotateAnim = useRef(new Animated.Value(0)).current;

  // Confetti animations (for success)
  const confetti = useRef(
    Array.from({ length: 20 }, () => ({
      x: useRef(new Animated.Value(0)).current,
      y: useRef(new Animated.Value(0)).current,
      rotate: useRef(new Animated.Value(0)).current,
      opacity: useRef(new Animated.Value(0)).current,
    }))
  ).current;

  // Ring pulse animations for tap-to-pay / card success
  const ring1Scale = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0)).current;
  const ring2Scale = useRef(new Animated.Value(1)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;
  const ring3Scale = useRef(new Animated.Value(1)).current;
  const ring3Opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Icon scale animation
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.3,
        duration: 400,
        easing: Easing.out(Easing.back(2)),
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 3,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    // Fade in content
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      delay: 200,
      useNativeDriver: true,
    }).start();

    // Success animations
    if (success) {
      // Single pulse on load
      Animated.sequence([
        Animated.timing(bounceAnim, {
          toValue: 1.08,
          duration: 300,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(bounceAnim, {
          toValue: 1,
          duration: 400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();

      // Confetti animation
      confetti.forEach((particle, index) => {
        const delay = index * 50;
        const duration = 2000 + Math.random() * 1000;
        const startX = Math.random() * 300 - 150;
        const endX = startX + (Math.random() * 100 - 50);
        const endY = 600 + Math.random() * 200;

        Animated.parallel([
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(particle.opacity, {
              toValue: 1,
              duration: 200,
              useNativeDriver: true,
            }),
            // Fade out near the end of the fall
            Animated.delay(duration - 500),
            Animated.timing(particle.opacity, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(particle.x, {
              toValue: endX,
              duration,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(particle.y, {
              toValue: endY,
              duration,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(particle.rotate, {
              toValue: 360 * 3, // 3 rotations instead of infinite loop
              duration,
              easing: Easing.linear,
              useNativeDriver: true,
            }),
          ]),
        ]).start();
      });

      // Ring pulse animation for tap-to-pay and card methods
      if (resolvedMethod === 'tap_to_pay' || resolvedMethod === 'card') {
        const rings = [
          { scale: ring1Scale, opacity: ring1Opacity, delay: 500, startOpacity: 0.35 },
          { scale: ring2Scale, opacity: ring2Opacity, delay: 700, startOpacity: 0.25 },
          { scale: ring3Scale, opacity: ring3Opacity, delay: 900, startOpacity: 0.15 },
        ];
        rings.forEach(({ scale, opacity, delay: ringDelay, startOpacity }) => {
          Animated.sequence([
            Animated.delay(ringDelay),
            Animated.timing(opacity, { toValue: startOpacity, duration: 100, useNativeDriver: true }),
            Animated.parallel([
              Animated.timing(scale, { toValue: 2.8, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
            ]),
          ]).start();
        });
      }

      clearCart();
    }
  }, []);

  const handleNewSale = () => {
    // Cancel any dangling PaymentIntent on failure path
    if (!success && paymentIntentId) {
      stripeTerminalApi.cancelPaymentIntent(paymentIntentId).catch(() => {});
    }
    // Reset navigation to Menu tab
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      })
    );
  };

  const handleTryAgain = () => {
    // Cancel the failed PaymentIntent so it doesn't linger as "Incomplete" in Stripe
    if (paymentIntentId) {
      stripeTerminalApi.cancelPaymentIntent(paymentIntentId).catch(() => {});
    }
    navigation.goBack();
  };

  // Handle manual card payment - fallback when Tap to Pay fails
  // Note: Manual card entry has higher Stripe fees (2.9% + 30¢) vs Tap to Pay (2.7% + 5¢)
  const handleManualCardPayment = async () => {
    if (!cardDetails?.complete) {
      Alert.alert(t('cardRequiredTitle'), t('cardRequiredMessage'));
      return;
    }

    setProcessingCard(true);

    try {
      // Cancel the original terminal PaymentIntent so it doesn't linger as "Incomplete" in Stripe
      if (paymentIntentId) {
        stripeTerminalApi.cancelPaymentIntent(paymentIntentId).catch(() => {});
      }

      // Create a new payment intent for card payment (direct charge on connected account)
      const paymentIntent = await stripeTerminalApi.createPaymentIntent({
        amount: fromSmallestUnit(amount, currency), // API expects base currency unit
        currency, // Multi-currency support — never assume USD
        description: preorderId ? t('preorderPaymentDescription') : t('orderPaymentDescription', { orderNumber: orderNumber || 'Payment' }),
        metadata: {
          orderId: orderId || '',
          orderNumber: orderNumber || '',
          ...(preorderId && { preorderId }),
        },
        receiptEmail: customerEmail || undefined,
        captureMethod: 'automatic',
        paymentMethodType: 'card',
      });

      // Link to existing order if we have one
      // Mark as 'card' (manual entry) since this is the fallback flow
      if (orderId) {
        await ordersApi.linkPaymentIntent(orderId, paymentIntent.id, 'card');
      }

      // Initialize Stripe with the connected account ID for direct charges
      // This ensures the payment is processed on the vendor's connected account
      await initStripe({
        publishableKey: config.stripePublishableKey,
        merchantIdentifier: 'merchant.com.rowie',
        stripeAccountId: paymentIntent.stripeAccountId,
      });

      // Confirm payment with card details
      const { error, paymentIntent: confirmedIntent } = await confirmPayment(paymentIntent.clientSecret, {
        paymentMethodType: 'Card',
        paymentMethodData: {
          billingDetails: {
            email: customerEmail || undefined,
          },
        },
      });

      if (error) {
        logger.error('[ManualCard] Payment failed:', error);
        Alert.alert(t('paymentFailedTitle'), error.message || t('manualCardPaymentFailedMessage'));
        return;
      }

      if (confirmedIntent?.status === 'Succeeded') {
        // Success! Reset navigation to show fresh success screen
        clearCart();
        navigation.dispatch(
          CommonActions.reset({
            index: 1,
            routes: [
              { name: 'MainTabs' },
              {
                name: 'PaymentResult',
                params: {
                  success: true,
                  amount,
                  paymentIntentId: paymentIntent.id,
                  orderId,
                  orderNumber,
                  customerEmail,
                  preorderId,
                },
              },
            ],
          })
        );
      } else {
        Alert.alert(t('paymentIncompleteTitle'), t('paymentIncompleteMessage'));
      }
    } catch (error: any) {
      logger.error('[ManualCard] Payment error:', error);
      Alert.alert(t('paymentErrorTitle'), error.message || t('manualCardPaymentErrorMessage'));
    } finally {
      setProcessingCard(false);
    }
  };

  const handleSendReceipt = async () => {
    if (!receiptEmail.trim()) {
      Alert.alert(t('emailRequiredTitle'), t('emailRequiredMessage'));
      return;
    }

    // Basic email validation
    if (!isValidEmail(receiptEmail)) {
      Alert.alert(t('invalidEmailTitle'), t('invalidEmailMessage'));
      return;
    }

    setSendingReceipt(true);
    try {
      await stripeTerminalApi.sendReceipt(paymentIntentId, receiptEmail.trim());
      setReceiptSent(true);
      setShowEmailInput(false);
      Alert.alert(t('receiptSentTitle'), t('receiptSentMessage', { email: receiptEmail.trim() }));
    } catch (error: any) {
      logger.error('Error sending receipt:', error);
      Alert.alert(t('receiptErrorTitle'), error.message || t('receiptErrorMessage'));
    } finally {
      setSendingReceipt(false);
    }
  };

  const styles = createStyles(colors, success, resolvedMethod);

  // Clean card entry page - shown when user needs to enter card manually
  if (showCardEntry) {
    return (
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[styles.safeArea, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            {/* Header */}
            <View style={styles.cardPageHeader}>
              <TouchableOpacity
                style={styles.cardPageBackButton}
                onPress={() => setShowCardEntry(false)}
                accessibilityRole="button"
                accessibilityLabel={t('goBackToPaymentResult')}
              >
                <Ionicons name="arrow-back" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={styles.cardPageTitle} maxFontSizeMultiplier={1.3}>{t('cardPaymentTitle')}</Text>
              <View style={{ width: 40 }} />
            </View>

            <View style={styles.cardPageContent}>
              {/* Amount Display */}
              <View style={styles.cardPageAmountContainer}>
                <Text style={styles.cardPageAmountLabel} maxFontSizeMultiplier={1.5}>{t('amountToPay')}</Text>
                <Text style={styles.cardPageAmount} maxFontSizeMultiplier={1.2} accessibilityRole="summary" accessibilityLabel={t('amountToPayAccessibility', { amount: formatCents(amount, currency) })}>{formatCents(amount, currency)}</Text>
                {orderNumber && (
                  <Text style={styles.cardPageOrderNumber} maxFontSizeMultiplier={1.5}>{t('orderNumberLabel', { orderNumber })}</Text>
                )}
              </View>

              {/* Fee Warning */}
              <View style={styles.feeWarningContainer} accessibilityRole="alert">
                <Ionicons name="information-circle" size={16} color={colors.warning} />
                <Text style={styles.feeWarningText} maxFontSizeMultiplier={1.5}>
                  {t('feeWarning')}
                </Text>
              </View>

              {/* Card Field */}
              <View style={styles.cardPageFormContainer}>
                <CardField
                  postalCodeEnabled={false}
                  placeholders={{
                    number: t('cardPlaceholderNumber'),
                    expiration: t('cardPlaceholderExpiration'),
                    cvc: t('cardPlaceholderCvc'),
                  }}
                  cardStyle={{
                    backgroundColor: isDark ? '#292524' : '#FAFAF9',
                    textColor: isDark ? '#F5F5F4' : '#1C1917',
                    placeholderColor: isDark ? '#78716C' : '#A8A29E',
                    borderColor: isDark ? '#44403C' : '#E7E5E4',
                    borderWidth: 1,
                    borderRadius: 12,
                    fontSize: 20,
                    cursorColor: colors.primary,
                    textErrorColor: colors.error,
                  }}
                  style={styles.cardField}
                  onCardChange={(details) => setCardDetails(details)}
                />

                <View style={styles.cardSecurityNote}>
                  <Ionicons name="shield-checkmark" size={14} color={colors.success} />
                  <Text style={styles.cardSecurityText} maxFontSizeMultiplier={1.5}>
                    {t('cardSecurityNote')}
                  </Text>
                </View>
              </View>

              {/* Pay Button - moved inside content area */}
              <TouchableOpacity
                onPress={handleManualCardPayment}
                disabled={!cardDetails?.complete || processingCard}
                activeOpacity={0.9}
                style={[
                  styles.cardPagePayButton,
                  { backgroundColor: isDark ? '#fff' : '#1C1917' },
                  (!cardDetails?.complete || processingCard) && styles.cardPagePayButtonDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel={processingCard ? t('processingCardPaymentAccessibility') : t('payWithCardAccessibility', { amount: formatCents(amount, currency) })}
                accessibilityState={{ disabled: !cardDetails?.complete || processingCard }}
              >
                {processingCard ? (
                  <ActivityIndicator size="small" color={isDark ? '#1C1917' : '#fff'} accessibilityLabel={t('processingCardPaymentAccessibility')} />
                ) : (
                  <>
                    <Ionicons name="lock-closed" size={20} color={isDark ? '#1C1917' : '#fff'} />
                    <Text style={[styles.cardPagePayButtonText, { color: isDark ? '#1C1917' : '#fff' }]} maxFontSizeMultiplier={1.3}>
                      {t('payAmount', { amount: formatCents(amount, currency) })}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </TouchableWithoutFeedback>
    );
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {/* Background Glow */}
        {success && (
          <View style={styles.backgroundGradients}>
            <View style={[styles.gradientOrb, styles.gradientOrb1, { backgroundColor: methodConfig.accentColor }]} />
            <View style={[styles.gradientOrb, styles.gradientOrb2, { backgroundColor: methodConfig.accentColor }]} />
          </View>
        )}

        {/* Confetti */}
        {success && (
          <View style={styles.confettiContainer}>
            {confetti.map((particle, index) => (
              <Animated.View
                key={index}
                style={[
                  styles.confetti,
                  {
                    backgroundColor: methodConfig.confettiColors[index % methodConfig.confettiColors.length],
                    opacity: particle.opacity,
                    transform: [
                      { translateX: particle.x },
                      { translateY: particle.y },
                      {
                        rotate: particle.rotate.interpolate({
                          inputRange: [0, 360],
                          outputRange: ['0deg', '360deg'],
                        }),
                      },
                    ],
                  },
                ]}
              />
            ))}
          </View>
        )}

        <View style={[styles.safeArea, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.content}>
            {/* Icon */}
            <Animated.View
              style={[
                styles.iconContainer,
                {
                  transform: [
                    { scale: success ? Animated.multiply(scaleAnim, bounceAnim) : scaleAnim },
                  ],
                },
              ]}
            >
              {/* Ring animations for tap-to-pay / card */}
              {success && (resolvedMethod === 'tap_to_pay' || resolvedMethod === 'card') && (
                <>
                  <Animated.View style={[styles.ring, { borderColor: methodConfig.accentColor, transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]} />
                  <Animated.View style={[styles.ring, { borderColor: methodConfig.accentColor, transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]} />
                  <Animated.View style={[styles.ring, { borderColor: methodConfig.accentColor, transform: [{ scale: ring3Scale }], opacity: ring3Opacity }]} />
                </>
              )}

              {success ? (
                <View style={[styles.methodIconCircle, { backgroundColor: methodConfig.bgColor }]}>
                  <Ionicons name={methodConfig.iconName} size={44} color={methodConfig.iconColor} />
                </View>
              ) : (
                <>
                  <View style={[styles.iconGlow, { backgroundColor: colors.error }]} />
                  <Ionicons name="close-circle" size={100} color={colors.error} />
                </>
              )}
            </Animated.View>

            <Animated.View style={{ opacity: fadeAnim, alignItems: 'center', width: '100%' }}>
              {/* Title */}
              <Text style={[styles.title, { fontSize: titleFontSize }]} maxFontSizeMultiplier={1.3} accessibilityRole="header">
                {success ? methodConfig.title : t('paymentFailedTitle')}
              </Text>

              {success ? (
                <>
                  {/* Cash-specific: breakdown card with change due */}
                  {resolvedMethod === 'cash' && cashTendered != null && changeAmount != null ? (
                    <View style={styles.cashBreakdownCard}>
                      <View style={styles.cashRow}>
                        <Text style={styles.cashLabel} maxFontSizeMultiplier={1.5}>{t('totalDue')}</Text>
                        <Text style={styles.cashValue} maxFontSizeMultiplier={1.3}>{formatCents(amount, currency)}</Text>
                      </View>
                      <View style={styles.cashRow}>
                        <Text style={styles.cashLabel} maxFontSizeMultiplier={1.5}>{t('cashTendered')}</Text>
                        <Text style={styles.cashValue} maxFontSizeMultiplier={1.3}>{formatCents(cashTendered, currency)}</Text>
                      </View>
                      <View style={styles.cashDivider} />
                      <View style={styles.cashChangeSection}>
                        <Text style={styles.cashChangeLabel} maxFontSizeMultiplier={1.5}>{t('changeDue')}</Text>
                        <Text
                          style={styles.cashChangeAmount}
                          maxFontSizeMultiplier={1.2}
                          accessibilityRole="summary"
                          accessibilityLabel={t('changeDueAccessibility', { amount: formatCents(changeAmount, currency) })}
                        >
                          {formatCents(changeAmount, currency)}
                        </Text>
                      </View>
                      {orderNumber && (
                        <Text style={styles.cashOrderNumber} maxFontSizeMultiplier={1.5}>{t('orderNumberLabel', { orderNumber })}</Text>
                      )}
                    </View>
                  ) : (
                    /* Tap-to-pay / split / card: amount card */
                    <View style={styles.amountCard}>
                      <Text
                        style={[styles.amount, { fontSize: amountFontSize }]}
                        maxFontSizeMultiplier={1.2}
                        accessibilityRole="summary"
                        accessibilityLabel={t('amountChargedAccessibility', { amount: amountText })}
                      >
                        {amountText}
                      </Text>
                      {orderNumber && (
                        <Text style={styles.amountCardOrder} maxFontSizeMultiplier={1.5}>{t('orderNumberLabel', { orderNumber })}</Text>
                      )}
                    </View>
                  )}

                  {/* Status badge */}
                  <View
                    style={[styles.successBadge, { backgroundColor: methodConfig.accentColor + '12', borderColor: methodConfig.accentColor + '25' }]}
                    accessibilityRole="text"
                    accessibilityLabel={receiptSent ? t('receiptSent') : methodConfig.badgeText}
                  >
                    <Ionicons name="checkmark-circle" size={18} color={methodConfig.accentColor} />
                    <Text style={[styles.successBadgeText, { color: methodConfig.accentColor }]} maxFontSizeMultiplier={1.5}>
                      {receiptSent ? t('receiptSent') : methodConfig.badgeText}
                    </Text>
                  </View>

                  {/* Receipt Section */}
                  {!receiptSent && !showEmailInput && (
                    <TouchableOpacity
                      style={styles.receiptButton}
                      onPress={() => setShowEmailInput(true)}
                      accessibilityRole="button"
                      accessibilityLabel={t('sendReceiptAccessibility')}
                      accessibilityHint={t('sendReceiptHint')}
                    >
                      <Ionicons name="mail-outline" size={20} color={colors.textSecondary} />
                      <Text style={styles.receiptButtonText} maxFontSizeMultiplier={1.3}>{t('sendReceipt')}</Text>
                    </TouchableOpacity>
                  )}

                  {showEmailInput && (
                    <View style={styles.emailInputContainer}>
                      <TextInput
                        style={styles.emailInput}
                        placeholder={t('enterEmailAddress')}
                        placeholderTextColor={colors.textMuted}
                        value={receiptEmail}
                        onChangeText={setReceiptEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        accessibilityLabel={t('emailAddressForReceipt')}
                      />
                      <TouchableOpacity
                        style={[styles.sendButton, sendingReceipt && styles.sendButtonDisabled]}
                        onPress={handleSendReceipt}
                        disabled={sendingReceipt}
                        accessibilityRole="button"
                        accessibilityLabel={sendingReceipt ? t('sendingReceiptAccessibility') : t('sendReceiptAccessibility')}
                        accessibilityState={{ disabled: sendingReceipt }}
                      >
                        {sendingReceipt ? (
                          <ActivityIndicator size="small" color="#fff" accessibilityLabel={t('sendingReceiptAccessibility')} />
                        ) : (
                          <Ionicons name="send" size={18} color="#fff" />
                        )}
                      </TouchableOpacity>
                    </View>
                  )}

                  {receiptSent && customerEmail && (
                    <View style={styles.receiptSentContainer}>
                      <Text
                        style={styles.receiptSentText}
                        numberOfLines={1}
                        ellipsizeMode="middle"
                        maxFontSizeMultiplier={1.5}
                      >
                        {t('sentTo', { email: customerEmail })}
                      </Text>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <View style={styles.errorContainer} accessibilityRole="alert">
                    <Text style={styles.errorText} maxFontSizeMultiplier={1.5}>
                      {errorMessage || t('defaultErrorMessage')}
                    </Text>
                  </View>

                  {/* Manual Card Entry Option */}
                  <View style={styles.fallbackContainer}>
                    <View style={styles.fallbackHeader}>
                      <Ionicons name="card-outline" size={20} color={colors.primary} />
                      <Text style={styles.fallbackTitle} maxFontSizeMultiplier={1.3}>{t('alternativePayment')}</Text>
                    </View>
                    <Text style={styles.fallbackDescription} maxFontSizeMultiplier={1.5}>
                      {t('enterCardManuallyDescription')}
                    </Text>
                    <TouchableOpacity
                      style={styles.fallbackButton}
                      onPress={() => setShowCardEntry(true)}
                      accessibilityRole="button"
                      accessibilityLabel={t('enterCardManually')}
                      accessibilityHint={t('enterCardManuallyHint')}
                    >
                      <Ionicons name="keypad-outline" size={18} color={colors.primary} />
                      <Text style={styles.fallbackButtonText} maxFontSizeMultiplier={1.3}>{t('enterCardManually')}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </Animated.View>
          </View>

          {/* Actions */}
          <Animated.View style={[styles.footer, { opacity: fadeAnim }]}>
            {success ? (
              <TouchableOpacity
                onPress={handleNewSale}
                activeOpacity={0.9}
                style={[styles.primaryButton, { backgroundColor: methodConfig.accentColor }]}
                accessibilityRole="button"
                accessibilityLabel={t('newSale')}
              >
                <Ionicons name="add-circle" size={24} color="#fff" />
                <Text style={styles.primaryButtonText} maxFontSizeMultiplier={1.3}>{t('newSale')}</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  onPress={handleTryAgain}
                  activeOpacity={0.9}
                  style={[styles.primaryButton, { backgroundColor: isDark ? '#fff' : '#1C1917' }]}
                  accessibilityRole="button"
                  accessibilityLabel={tc('tryAgain')}
                  accessibilityHint={t('retryPaymentHint')}
                >
                  <Ionicons name="refresh" size={24} color={isDark ? '#1C1917' : '#fff'} />
                  <Text style={[styles.primaryButtonText, { color: isDark ? '#1C1917' : '#fff' }]} maxFontSizeMultiplier={1.3}>{tc('tryAgain')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={handleNewSale} accessibilityRole="button" accessibilityLabel={t('cancelOrder')}>
                  <Text style={styles.secondaryButtonText} maxFontSizeMultiplier={1.3}>{t('cancelOrder')}</Text>
                </TouchableOpacity>
              </>
            )}
          </Animated.View>
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const createStyles = (colors: any, success: boolean, method: PaymentMethodType) => {
  return StyleSheet.create({
    backgroundGradients: {
      ...StyleSheet.absoluteFillObject,
      overflow: 'hidden',
    },
    gradientOrb: {
      position: 'absolute',
      borderRadius: 9999,
      opacity: 0.08,
    },
    gradientOrb1: {
      width: 600,
      height: 600,
      top: -300,
      right: -200,
    },
    gradientOrb2: {
      width: 500,
      height: 500,
      bottom: -250,
      left: -200,
      opacity: 0.05,
    },
    confettiContainer: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'flex-start',
      pointerEvents: 'none',
      overflow: 'hidden',
    },
    confetti: {
      position: 'absolute',
      width: 8,
      height: 8,
      borderRadius: 4,
      top: 200,
    },
    safeArea: {
      flex: 1,
      overflow: 'hidden',
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
      overflow: 'hidden',
    },
    // Icon container with rings support
    iconContainer: {
      position: 'relative',
      marginBottom: 32,
      alignItems: 'center',
      justifyContent: 'center',
      width: 120,
      height: 120,
    },
    iconGlow: {
      position: 'absolute',
      width: 160,
      height: 160,
      borderRadius: 80,
      opacity: 0.08,
    },
    // Filled circle icon for success states
    methodIconCircle: {
      width: 96,
      height: 96,
      borderRadius: 48,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.lg,
    },
    // Expanding ring for tap-to-pay
    ring: {
      position: 'absolute',
      width: 96,
      height: 96,
      borderRadius: 48,
      borderWidth: 2.5,
    },
    title: {
      fontFamily: fonts.extraBold,
      color: colors.text,
      marginBottom: 20,
      textAlign: 'center',
      letterSpacing: -0.5,
    },
    // Amount card — elevated container for the amount
    amountCard: {
      alignItems: 'center',
      alignSelf: 'stretch',
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 24,
      paddingHorizontal: 20,
      marginBottom: 20,
      ...shadows.md,
    },
    amount: {
      fontFamily: fonts.bold,
      color: colors.text,
      textAlign: 'center',
    },
    amountCardOrder: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textMuted,
      marginTop: 8,
    },
    // Cash breakdown card
    cashBreakdownCard: {
      alignSelf: 'stretch',
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 24,
      marginBottom: 20,
      ...shadows.md,
    },
    cashRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 8,
    },
    cashLabel: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
    },
    cashValue: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    cashDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 12,
    },
    cashChangeSection: {
      alignItems: 'center',
      paddingTop: 4,
    },
    cashChangeLabel: {
      fontSize: 12,
      fontFamily: fonts.semiBold,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1.5,
      marginBottom: 6,
    },
    cashChangeAmount: {
      fontSize: 44,
      fontFamily: fonts.extraBold,
      color: colors.success,
      letterSpacing: -1,
    },
    cashOrderNumber: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: 12,
    },
    successBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 18,
      borderRadius: 9999,
      borderWidth: 1,
      marginBottom: 4,
    },
    successBadgeText: {
      fontSize: 14,
      fontFamily: fonts.semiBold,
    },
    receiptButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 16,
      paddingVertical: 12,
      paddingHorizontal: 20,
    },
    receiptButtonText: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
    },
    emailInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 16,
      gap: 12,
      alignSelf: 'stretch',
    },
    emailInput: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      backgroundColor: colors.card,
      borderRadius: 14,
      paddingHorizontal: 16,
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sendButton: {
      width: 48,
      height: 48,
      minWidth: 48,
      flexShrink: 0,
      borderRadius: 14,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.md,
    },
    sendButtonDisabled: {
      opacity: 0.7,
    },
    receiptSentContainer: {
      alignSelf: 'stretch',
      alignItems: 'center',
      marginTop: 12,
      paddingHorizontal: 20,
    },
    receiptSentText: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textMuted,
      textAlign: 'center',
    },
    errorContainer: {
      backgroundColor: colors.errorBg,
      paddingVertical: 16,
      paddingHorizontal: 24,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.error + '30',
      marginTop: 8,
      ...shadows.sm,
    },
    errorText: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.error,
      textAlign: 'center',
      lineHeight: 22,
    },
    // Fallback Payment Link styles
    fallbackContainer: {
      marginTop: 20,
      padding: 20,
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      alignSelf: 'stretch',
    },
    fallbackHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 8,
    },
    fallbackTitle: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    fallbackDescription: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: 16,
    },
    fallbackButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: colors.primary + '15',
      borderWidth: 1,
      borderColor: colors.primary + '30',
    },
    fallbackButtonDisabled: {
      opacity: 0.6,
    },
    fallbackButtonText: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: colors.primary,
    },
    // Manual Card Entry styles
    cardEntryContainer: {
      marginTop: 20,
      padding: 20,
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.primary + '30',
      alignSelf: 'stretch',
    },
    cardEntryHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 8,
    },
    cardEntryTitle: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    cardEntryAmount: {
      fontSize: 32,
      fontFamily: fonts.bold,
      color: colors.text,
      textAlign: 'center',
      marginBottom: 16,
    },
    cardField: {
      height: 50,
      marginBottom: 12,
    },
    cardSecurityNote: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginBottom: 16,
    },
    cardSecurityText: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: colors.textMuted,
    },
    cardPayButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingVertical: 16,
      borderRadius: 14,
      backgroundColor: colors.primary,
      ...shadows.md,
    },
    cardPayButtonDisabled: {
      opacity: 0.5,
    },
    cardPayButtonText: {
      fontSize: 17,
      fontFamily: fonts.semiBold,
      color: '#fff',
    },
    cardCancelButton: {
      alignItems: 'center',
      paddingVertical: 14,
      marginTop: 12,
    },
    cardCancelText: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: colors.textMuted,
    },
    // Clean card payment page styles
    cardPageHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
    },
    cardPageBackButton: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      backgroundColor: colors.card,
    },
    cardPageTitle: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    cardPageContent: {
      paddingHorizontal: 24,
      paddingTop: 32,
    },
    cardPageAmountContainer: {
      alignItems: 'center',
      marginBottom: 32,
    },
    cardPageAmountLabel: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 8,
    },
    cardPageAmount: {
      fontSize: 48,
      fontFamily: fonts.bold,
      color: colors.text,
    },
    cardPageOrderNumber: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textMuted,
      marginTop: 8,
    },
    feeWarningContainer: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: colors.warningBg || colors.warning + '15',
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.warning + '30',
      marginBottom: 20,
    },
    feeWarningText: {
      flex: 1,
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.warning,
      lineHeight: 18,
    },
    cardPageFormContainer: {
      marginBottom: 24,
    },
    cardPageField: {
      height: 60,
      marginBottom: 16,
    },
    cardPagePayButtonContainer: {
      marginTop: 8,
    },
    cardPagePayButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingVertical: 18,
      borderRadius: 9999,
      ...shadows.lg,
      shadowColor: colors.primary,
    },
    cardPagePayButtonDisabled: {
      opacity: 0.5,
    },
    cardPagePayButtonText: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: '#fff',
    },
    footer: {
      padding: 20,
      paddingBottom: 36,
      gap: 12,
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 18,
      borderRadius: 9999,
      gap: 12,
      ...shadows.lg,
    },
    primaryButtonText: {
      color: '#fff',
      fontSize: 18,
      fontFamily: fonts.semiBold,
    },
    secondaryButton: {
      alignItems: 'center',
      paddingVertical: 16,
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryButtonText: {
      fontSize: 16,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
    },
  });
};
