// TODO(security): install expo-screen-capture and guard this screen with
// usePreventScreenCapture() — it displays transaction amounts / card details.
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
  Animated,
  Platform,
  Modal,
  KeyboardAvoidingView,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SymbolView } from 'expo-symbols';
import { Swipeable } from 'react-native-gesture-handler';
import { useTheme } from '../context/ThemeContext';
import { useCart, CartItem, PaymentMethodType } from '../context/CartContext';
import { useCatalog } from '../context/CatalogContext';
import { useAuth } from '../context/AuthContext';
import { useTerminal } from '../context/StripeTerminalContext';
import { stripeTerminalApi, ordersApi } from '../lib/api';
import { sessionsApi } from '../lib/api/sessions';
import { getDeviceId } from '../lib/device';
import { shadows } from '../lib/shadows';
import { fonts } from '../lib/fonts';
import { PayoutsSetupBanner } from '../components/PayoutsSetupBanner';
import { SetupRequiredBanner } from '../components/SetupRequiredBanner';
import { UndoSnackbar } from '../components/UndoSnackbar';
import logger from '../lib/logger';
import { isValidEmailOrEmpty } from '../lib/validation';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { formatCents, getCurrencySymbol, toSmallestUnit, fromSmallestUnit, isZeroDecimal } from '../utils/currency';
import { useTranslations } from '../lib/i18n';


interface TipOption {
  label: string;
  value: number;
  isCustom?: boolean;
}

// 36pt visual buttons + slop = ≥44pt effective touch target (Apple HIG).
const QTY_HIT_SLOP = { top: 8, bottom: 8, left: 4, right: 4 };

type RouteParams = {
  Checkout: {
    total: number;
    isQuickCharge?: boolean;
    quickChargeDescription?: string;
  };
};

export function CheckoutScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'Checkout'>>();
  const { items, itemCount, clearCart, addItem, incrementItem, decrementItem, removeItem, subtotal: cartSubtotal, orderNotes, setOrderNotes, customerEmail, setCustomerEmail, paymentMethod, setPaymentMethod, selectedTipIndex, setSelectedTipIndex, customTipAmount, setCustomTipAmount, showCustomTipInput, setShowCustomTipInput } = useCart();
  // CheckoutScreen is only reachable in quick_service mode now — table_service
  // sends carts straight to a table session via FloorPlan, so orders created
  // here never carry a tableId.
  const { selectedCatalog } = useCatalog();
  const { isPaymentReady, connectLoading, connectStatus, currency } = useAuth();
  const { deviceCompatibility, isInitialized: isTerminalInitialized, isWarming, preferredReader } = useTerminal();
  const t = useTranslations('checkout');
  const tc = useTranslations('common');

  // Apple TTPOi 5.4: Use region-correct, translated copy
  const tapToPayLabel = Platform.OS === 'ios' ? t('tapToPayLabel') : t('tapToPayLabelAndroid');

  // Catalog data is automatically updated via socket events in CatalogContext

  const [emailError, setEmailError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Last removed cart line (decrement at qty 1 or swipe-delete) — feeds the
  // "Removed X · Undo" snackbar so an accidental tap is recoverable.
  const [removedItem, setRemovedItem] = useState<CartItem | null>(null);

  // Hold order modal
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [holdName, setHoldName] = useState('');
  const [isHolding, setIsHolding] = useState(false);
  const holdNameInputRef = useRef<any>(null);

  // Refs to track current values for the beforeRemove handler (avoids stale closures)
  const currentValuesRef = useRef({
    tipAmount: 0,
    taxAmount: 0,
    subtotal: 0,
    grandTotal: 0,
    paymentMethod: 'tap_to_pay' as PaymentMethodType,
    customerEmail: '',
    orderNotes: '',
    holdName: '',
  });

  // Customer info section visibility (combines email + notes)
  const [showCustomerInfo, setShowCustomerInfo] = useState(false);

  const { total: routeTotal, isQuickCharge, quickChargeDescription } = route.params;
  const styles = createStyles(colors, isDark);

  // NOTE: Do NOT clear cart on unmount — only clear after explicit hold/complete actions

  // Use cart subtotal for regular checkout, route total for quick charge.
  const subtotal = isQuickCharge ? routeTotal : cartSubtotal;

  // Navigate back if cart becomes empty (quick charge is exempt — it has no
  // cart). While the undo snackbar is up we stay put so the last removal can
  // be undone; dismissing it (or letting it time out) then pops the screen.
  useEffect(() => {
    if (!isQuickCharge && items.length === 0 && !removedItem) {
      navigation.goBack();
    }
  }, [items.length, isQuickCharge, removedItem, navigation]);

  // Set to true before any programmatic goBack() so the hold flow doesn't
  // accidentally hit a beforeRemove guard later. Kept as a no-op ref for now;
  // the legacy resume guard was removed with the held-orders retirement.
  const allowNavigationRef = useRef(false);

  // Show setup required banner when charges aren't enabled
  const showSetupBanner = !connectLoading && connectStatus && !connectStatus.chargesEnabled;

  // Charges disabled → the Pay button is disabled with an inline explanation
  // instead of relying on a post-tap alert.
  const chargesDisabled = !!showSetupBanner;

  // Offline → payments can't be processed; disable the Pay button with an
  // inline explanation (same pattern as chargesDisabled).
  const { isOffline } = useNetworkStatus();

  // Show payouts banner when charges are enabled but payouts aren't (user can still accept payments)
  const showPayoutsBanner = !connectLoading && isPaymentReady && connectStatus && !connectStatus.payoutsEnabled;

  // Use catalog settings for tip, email, and tax
  const showTipScreen = selectedCatalog?.showTipScreen ?? true;
  const promptForEmail = selectedCatalog?.promptForEmail ?? true;
  const tipPercentages = selectedCatalog?.tipPercentages ?? [15, 18, 20, 25];
  const allowCustomTip = selectedCatalog?.allowCustomTip ?? true;
  // Tax rate stored as whole number percentage (e.g., 5 for 5%)
  const taxRate = selectedCatalog?.taxRate ?? 0;

  // Calculate tax amount (based on subtotal)
  const taxAmount = useMemo(() => {
    if (taxRate <= 0) return 0;
    return Math.round(subtotal * (taxRate / 100));
  }, [subtotal, taxRate]);

  // Build tip options
  const tipOptions: TipOption[] = useMemo(() => {
    const options: TipOption[] = tipPercentages.map((pct: number) => ({
      label: `${pct}%`,
      value: pct / 100,
    }));
    // Add custom tip option if allowed
    if (allowCustomTip) {
      options.push({ label: t('customTipOption'), value: -1, isCustom: true });
    }
    // Always add no tip option
    options.push({ label: t('noTipOption'), value: 0 });
    return options;
  }, [tipPercentages, allowCustomTip, t]);

  // Calculate tip and grand total (subtotal + tax + tip)
  const { tipAmount, grandTotal, tipPercentage } = useMemo(() => {
    const subtotalWithTax = subtotal + taxAmount;
    if (!showTipScreen || selectedTipIndex === null) {
      return { tipAmount: 0, grandTotal: subtotalWithTax, tipPercentage: 0 };
    }
    const selectedOption = tipOptions[selectedTipIndex];
    if (selectedOption?.isCustom) {
      // Custom tip is entered in base currency unit (e.g. "10.50" for $10.50).
      // parseFloat preserves decimals; parseInt drops everything after the dot
      // and would silently lose cents on values like "10.50".
      const customTip = parseFloat(customTipAmount) || 0;
      const tipCents = toSmallestUnit(customTip, currency);
      // Calculate percentage for custom tip
      const calcTipPct = subtotal > 0 ? Math.round((tipCents / subtotal) * 100) : 0;
      return { tipAmount: tipCents, grandTotal: subtotalWithTax + tipCents, tipPercentage: calcTipPct };
    }
    const tipPct = selectedOption?.value || 0;
    // Tip is calculated on subtotal (before tax)
    const tip = Math.round(subtotal * tipPct);
    return { tipAmount: tip, grandTotal: subtotalWithTax + tip, tipPercentage: Math.round(tipPct * 100) };
  }, [subtotal, taxAmount, selectedTipIndex, showTipScreen, tipOptions, customTipAmount, currency]);

  // Keep refs in sync for the beforeRemove handler
  useEffect(() => {
    currentValuesRef.current = {
      tipAmount,
      taxAmount,
      subtotal,
      grandTotal,
      paymentMethod,
      customerEmail,
      orderNotes,
      holdName,
    };
  }, [tipAmount, taxAmount, subtotal, grandTotal, paymentMethod, customerEmail, orderNotes, holdName]);

  // Pre-select "No tip" (always the last option) so the default Pay path
  // needs zero tip taps — percentages stay one tap away. Never auto-select a
  // nonzero tip. clearCart() resets selectedTipIndex to null, so each new
  // checkout re-defaults here.
  useEffect(() => {
    if (showTipScreen && selectedTipIndex === null && tipOptions.length > 0) {
      setSelectedTipIndex(tipOptions.length - 1);
    }
  }, [showTipScreen, selectedTipIndex, tipOptions.length, setSelectedTipIndex]);

  // Cart line removal with undo (decrement at qty 1 deletes the line)
  const handleDecrementItem = (item: CartItem) => {
    if (item.quantity === 1) {
      setRemovedItem(item);
    }
    decrementItem(item.cartKey);
  };

  const handleRemoveItem = (item: CartItem) => {
    setRemovedItem(item);
    removeItem(item.cartKey);
  };

  const handleUndoRemove = () => {
    if (removedItem) {
      addItem(removedItem.product, removedItem.quantity, removedItem.notes);
    }
    setRemovedItem(null);
  };

  const handleTipSelect = (index: number) => {
    setSelectedTipIndex(index);
    const selectedOption = tipOptions[index];
    if (selectedOption?.isCustom) {
      setShowCustomTipInput(true);
    } else {
      setShowCustomTipInput(false);
      setCustomTipAmount('');
    }
  };

  // Hold the current cart as a session (source='hold'). Replaces the legacy
  // /orders/{id}/hold path — holds are sessions with no table, so they share
  // the same edit + close-out UI as table sessions. Tip/tax are recomputed at
  // settle time from the catalog and items, so we don't pass them here.
  const handleHoldOrder = async () => {
    if (isQuickCharge) return; // Can't hold quick charges
    if (!selectedCatalog) {
      Alert.alert(t('errorTitle'), 'Pick a menu before holding an order.');
      return;
    }
    if (items.length === 0) {
      Alert.alert(t('errorTitle'), 'Add items to the cart before holding.');
      return;
    }
    if (customerEmail.trim() && !isValidEmailOrEmpty(customerEmail)) {
      setEmailError(t('pleaseEnterValidEmail'));
      return;
    }

    setIsHolding(true);
    try {
      const sessionItems = items.map((item) => ({
        catalogProductId: item.product.id,
        quantity: item.quantity,
        notes: item.notes,
      }));
      const displayName = holdName.trim() || undefined;
      await sessionsApi.create({
        catalogId: selectedCatalog.id,
        source: 'hold',
        holdName: displayName,
        customerEmail: customerEmail.trim() || undefined,
        orderNotes: orderNotes || undefined,
        items: sessionItems,
      });

      setShowHoldModal(false);
      clearCart();
      allowNavigationRef.current = true;
      navigation.goBack();

      Alert.alert(
        t('orderHeldTitle'),
        displayName
          ? t('orderHeldMessage', { name: displayName })
          : 'Order saved as a hold — find it in the Tabs tab.',
      );
    } catch (error: any) {
      logger.error('Hold order error:', error);
      const errorMessage =
        (typeof error?.error === 'string' && error.error) ||
        error?.message ||
        t('failedToHoldOrder');
      Alert.alert(t('errorTitle'), errorMessage);
    } finally {
      setIsHolding(false);
    }
  };

  // Handle closing checkout - the beforeRemove listener handles resumed order confirmation
  const handleClose = () => {
    navigation.goBack();
  };

  // Handle email change and clear error
  const handleEmailChange = (text: string) => {
    setCustomerEmail(text);
    if (emailError) {
      setEmailError(null);
    }
  };

  // Main payment handler - shows first-use modal if needed
  const handlePayment = async () => {
    // Validate email if provided
    if (customerEmail.trim() && !isValidEmailOrEmpty(customerEmail)) {
      setEmailError(t('pleaseEnterValidEmail'));
      return;
    }

    // Check if payment setup is complete
    if (connectStatus && !connectStatus.chargesEnabled) {
      Alert.alert(
        t('paymentSetupRequiredTitle'),
        t('paymentSetupRequiredMessage'),
        [
          { text: tc('cancel'), style: 'cancel' },
          { text: t('completeSetupButton'), onPress: () => navigation.navigate('StripeOnboarding') },
        ]
      );
      return;
    }

    // Check if terminal is warming up
    if (isWarming) {
      Alert.alert(
        t('preparingTerminalTitle'),
        t('preparingTerminalMessage'),
        [{ text: tc('ok') }]
      );
      return;
    }

    // Proceed with payment
    setIsProcessing(true);

    try {
      // Include email for receipt if provided
      const receiptEmail = customerEmail.trim() || undefined;

      // Build description based on checkout type
      const tipSuffix = tipAmount > 0 ? ` ${t('tipIncluded', { amount: formatCents(tipAmount, currency) })}` : '';
      const description = isQuickCharge
        ? `${quickChargeDescription || t('quickChargeDescription')}${tipSuffix}`
        : `${t('orderDescription', { itemCount: items.length })}${tipSuffix}`;

      // 1. Create the order
      let order;
      {
        const orderItems = isQuickCharge
          ? undefined
          : items.map((item) => ({
              productId: item.product.productId,
              categoryId: item.product.categoryId || undefined,
              name: item.product.name,
              quantity: item.quantity,
              unitPrice: item.product.price,
              notes: item.notes, // Include per-item notes
            }));

        // Get device ID for order tracking
        const deviceId = await getDeviceId();

        order = await ordersApi.create({
          catalogId: selectedCatalog?.id,
          items: orderItems,
          subtotal: subtotal,
          taxAmount: taxAmount,
          tipAmount: tipAmount,
          totalAmount: grandTotal,
          paymentMethod: paymentMethod,
          customerEmail: receiptEmail,
          isQuickCharge: isQuickCharge || false,
          description: isQuickCharge ? quickChargeDescription : undefined,
          deviceId,
          notes: orderNotes || undefined, // Include order-level notes
        });
      }

      // Handle cash payment - navigate to cash screen
      if (paymentMethod === 'cash') {
        navigation.navigate('CashPayment', {
          orderId: order.id,
          orderNumber: order.orderNumber,
          totalAmount: grandTotal,
          customerEmail: receiptEmail,
        });
        setIsProcessing(false);
        return;
      }

      // Handle split payment - navigate to split screen
      if (paymentMethod === 'split') {
        navigation.navigate('SplitPayment', {
          orderId: order.id,
          orderNumber: order.orderNumber,
          totalAmount: grandTotal,
          customerEmail: receiptEmail,
        });
        setIsProcessing(false);
        return;
      }

      // Check device compatibility (Apple TTPOi 1.1, 1.3)
      // If not compatible, show payment failed screen with option to enter card manually
      if (Platform.OS === 'ios' && !deviceCompatibility.isCompatible) {
        setIsProcessing(false);
        navigation.navigate('PaymentResult', {
          success: false,
          amount: grandTotal,
          paymentIntentId: '', // Will create new one for manual card entry
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerEmail: receiptEmail,
          errorMessage: deviceCompatibility.errorMessage || t('deviceNotSupportedMessage', { tapToPayLabel }),
        });
        return;
      }

      // 2. Create payment intent with tip included.
      //
      // Idempotency-Key derived from orderId + grandTotal so a double-tap of
      // "Pay" — or a transient retry by the API client — returns the same
      // PaymentIntent rather than charging twice. The API
      // (`/stripe/terminal/payment-intent`) honors this header and forwards
      // it to Stripe. If the user genuinely changes the amount (e.g. picks a
      // different tip and retries), the key changes too so a new PI is
      // created cleanly.
      const idempotencyKey = `pi-${order.id}-${grandTotal}`;
      const paymentIntent = await stripeTerminalApi.createPaymentIntent({
        amount: fromSmallestUnit(grandTotal, currency), // Convert smallest unit to base unit for API
        // Top-level tipAmount (base units, same conversion as `amount`) so the
        // API excludes the tip from the platform-fee base — tips go 100% to
        // the merchant. metadata.tipAmount below is display-only.
        tipAmount: fromSmallestUnit(tipAmount, currency),
        currency, // Multi-currency support — never assume USD
        description,
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          catalogId: selectedCatalog?.id || '',
          isQuickCharge: isQuickCharge ? 'true' : 'false',
          subtotal: subtotal.toString(),
          taxAmount: taxAmount.toString(),
          tipAmount: tipAmount.toString(),
        },
        receiptEmail,
      }, idempotencyKey);

      // 3. Link PaymentIntent to order (with reader tracking info)
      await ordersApi.linkPaymentIntent(order.id, paymentIntent.id, undefined, {
        readerId: preferredReader?.id,
        readerLabel: preferredReader?.label || undefined,
        readerType: preferredReader?.readerType || 'tap_to_pay',
      });

      // Navigate to payment processing screen
      navigation.navigate('PaymentProcessing', {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.clientSecret,
        stripeAccountId: paymentIntent.stripeAccountId,
        amount: grandTotal,
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerEmail: receiptEmail,
      });
    } catch (error: any) {
      logger.error('Payment error:', error);

      // Distinct UX for the fraud-gate path. The API returns 403 with
      // `code: 'ACCOUNT_UNDER_REVIEW'` (see /admin/account-reviews + the
      // connect-webhooks fraud counters) — surfacing the API's user-facing
      // message instead of a generic "Payment Error" prevents vendors from
      // looping back to Stripe onboarding (which won't fix anything; the
      // hold is on Rowie's side pending manual approval).
      const errorCode: string | undefined = error?.code || error?.details?.code;
      if (errorCode === 'ACCOUNT_UNDER_REVIEW') {
        const reviewMessage =
          error?.error ||
          error?.details?.error ||
          'Payments are temporarily on hold while your account is under review. Our team is reviewing your account and will be in touch shortly.';
        Alert.alert(t('accountUnderReviewTitle'), reviewMessage, [{ text: tc('ok') }]);
        return;
      }

      Alert.alert(
        t('paymentErrorTitle'),
        // ordersApi.create / stripeTerminalApi.createPaymentIntent /
        // ordersApi.linkPaymentIntent all go through apiClient and throw
        // ApiError {error, ...} — prefer `.error` so the API's reason
        // (e.g. "insufficient_funds", "subscription_inactive") isn't masked.
        error?.error || error?.message || t('paymentErrorMessage')
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel={t('closeCheckoutAccessibilityLabel')}
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>
            {t('checkoutTitle')}
          </Text>
          <View style={styles.headerRight}>
            {/* Hold Order Button (not for quick charge) */}
            {!isQuickCharge && items.length > 0 && (
              <TouchableOpacity
                style={styles.holdButton}
                onPress={() => {
                  if (customerEmail.trim() && !isValidEmailOrEmpty(customerEmail)) {
                    setEmailError(t('pleaseEnterValidEmail'));
                    return;
                  }
                  setShowHoldModal(true);
                }}
                disabled={isProcessing}
                accessibilityRole="button"
                accessibilityLabel={t('holdOrderAccessibilityLabel')}
                accessibilityHint={t('holdOrderAccessibilityHint')}
              >
                <Ionicons name="pause-circle-outline" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            {/* Clear Cart Button */}
            {!isQuickCharge && items.length > 0 ? (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => {
                  clearCart();
                  navigation.goBack();
                }}
                accessibilityRole="button"
                accessibilityLabel={t('clearCartAccessibilityLabel')}
                accessibilityHint={t('clearCartAccessibilityHint')}
              >
                <Text style={styles.clearButtonText} maxFontSizeMultiplier={1.3}>{t('clearButton')}</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 44 }} />
            )}
          </View>
        </View>

      {/* Setup Required Banner (charges not enabled) */}
      {showSetupBanner && <SetupRequiredBanner />}

      {/* Payouts Setup Banner (can accept payments but no payouts yet) */}
      {showPayoutsBanner && <PayoutsSetupBanner />}

      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {/* 1. Tip Selection (first) */}
        {showTipScreen && (
          <View style={styles.tipSection}>
            <Text style={styles.tipTitle} maxFontSizeMultiplier={1.3}>{t('addTipTitle')}</Text>
            <View style={styles.tipOptions}>
              {tipOptions.map((option, index) => {
                const isSelected = selectedTipIndex === index;
                const calculatedTip = option.value > 0 ? Math.round(subtotal * option.value) : 0;
                return (
                  <View key={index} style={styles.tipButton}>
                    <TouchableOpacity
                      style={[
                        styles.tipButtonInner,
                        isSelected && styles.tipButtonInnerSelected,
                      ]}
                      onPress={() => handleTipSelect(index)}
                      accessibilityRole="button"
                      accessibilityLabel={option.isCustom ? t('customTipAccessibilityLabel') : option.value === 0 ? t('noTipAccessibilityLabel') : t('tipAccessibilityLabel', { label: option.label, amount: calculatedTip > 0 ? formatCents(calculatedTip, currency) : '' })}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text
                        style={[
                          styles.tipButtonLabel,
                          isSelected && styles.tipButtonLabelSelected,
                        ]}
                        maxFontSizeMultiplier={1.3}
                      >
                        {option.label}
                      </Text>
                      {option.value > 0 && !option.isCustom && (
                        <Text
                          style={[
                            styles.tipButtonAmount,
                            isSelected && styles.tipButtonAmountSelected,
                          ]}
                          maxFontSizeMultiplier={1.3}
                        >
                          {formatCents(calculatedTip, currency)}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            {/* Custom Tip Input */}
            {showCustomTipInput && (
              <View style={styles.customTipContainer}>
                <Text style={styles.customTipLabel} maxFontSizeMultiplier={1.5}>{t('customTipAmountLabel')}</Text>
                <View style={styles.customTipInputRow}>
                  <Text style={styles.customTipDollar} maxFontSizeMultiplier={1.2}>{getCurrencySymbol(currency)}</Text>
                  <TextInput
                    style={styles.customTipInput}
                    placeholder={t('customTipPlaceholder')}
                    placeholderTextColor={colors.inputPlaceholder}
                    value={customTipAmount}
                    onChangeText={(text) => {
                      // Sanitize per currency: zero-decimal currencies (JPY,
                      // KRW, etc.) only accept whole numbers; everything else
                      // accepts up to one decimal point with up to 2 fractional
                      // digits. This prevents users from entering "1000.50" yen
                      // and getting silently rounded to 1001 yen.
                      if (isZeroDecimal(currency)) {
                        setCustomTipAmount(text.replace(/[^0-9]/g, ''));
                      } else {
                        // Allow digits + at most one dot + at most 2 decimals
                        const cleaned = text.replace(/[^0-9.]/g, '');
                        const parts = cleaned.split('.');
                        if (parts.length <= 2) {
                          setCustomTipAmount(parts.length === 2 ? `${parts[0]}.${parts[1].slice(0, 2)}` : parts[0]);
                        } else {
                          // Multiple dots — keep first, drop the rest
                          setCustomTipAmount(`${parts[0]}.${parts.slice(1).join('').slice(0, 2)}`);
                        }
                      }
                    }}
                    keyboardType={isZeroDecimal(currency) ? "number-pad" : "decimal-pad"}
                    autoFocus
                    accessibilityLabel={t('customTipAccessibilityLabelInput', { currency: currency.toUpperCase() })}
                  />
                </View>
              </View>
            )}
          </View>
        )}

        {/* 2. Customer Info (Email + Notes) - Collapsible */}
          <View style={styles.customerInfoSection}>
            <TouchableOpacity
              style={styles.customerInfoHeader}
              onPress={() => setShowCustomerInfo(!showCustomerInfo)}
              accessibilityRole="button"
              accessibilityLabel={showCustomerInfo ? t('collapseCustomerInfo') : t('expandCustomerInfo')}
              accessibilityState={{ expanded: showCustomerInfo }}
            >
              <View style={styles.customerInfoHeaderLeft}>
                <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.customerInfoTitle} maxFontSizeMultiplier={1.5}>
                  {customerEmail || orderNotes ? t('customerInfoTitle') : t('addCustomerInfoTitle')}
                </Text>
                {(customerEmail || orderNotes) && !showCustomerInfo && (
                  <View style={styles.customerInfoBadge}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                  </View>
                )}
              </View>
              <Ionicons
                name={showCustomerInfo ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
            {showCustomerInfo && (
              <View style={styles.customerInfoContent}>
                {promptForEmail && (
                  <View style={styles.customerInfoField}>
                    <TextInput
                      style={[styles.customerInfoInput, emailError && styles.inputError]}
                      placeholder={t('emailPlaceholder')}
                      placeholderTextColor={colors.textMuted}
                      value={customerEmail}
                      onChangeText={handleEmailChange}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      accessibilityLabel={t('emailAccessibilityLabel')}
                    />
                    {emailError && <Text style={styles.inputErrorText} maxFontSizeMultiplier={1.5} accessibilityRole="alert">{emailError}</Text>}
                  </View>
                )}
                <TextInput
                  style={styles.customerInfoNotesInput}
                  placeholder={t('orderNotesPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  value={orderNotes}
                  onChangeText={setOrderNotes}
                  multiline
                  numberOfLines={2}
                  maxLength={500}
                  accessibilityLabel={t('orderNotesAccessibilityLabel')}
                />
              </View>
            )}
          </View>

        {/* 3. Payment Method Selection */}
          <View style={styles.paymentMethodSection}>
            <Text style={styles.paymentMethodTitle} maxFontSizeMultiplier={1.3}>{t('paymentMethodTitle')}</Text>
            <View style={styles.paymentMethodOptions}>
              <TouchableOpacity
                style={[
                  styles.paymentMethodButton,
                  paymentMethod === 'tap_to_pay' && styles.paymentMethodButtonSelected,
                ]}
                onPress={() => setPaymentMethod('tap_to_pay')}
                accessibilityRole="button"
                accessibilityLabel={Platform.OS === 'ios' ? t('tapToPayAccessibilityLabel') : t('cardAccessibilityLabel')}
                accessibilityState={{ selected: paymentMethod === 'tap_to_pay' }}
              >
                {Platform.OS === 'ios' ? (
                  <SymbolView
                    name="wave.3.right.circle.fill"
                    size={22}
                    tintColor={paymentMethod === 'tap_to_pay' ? '#fff' : colors.text}
                    resizeMode="scaleAspectFit"
                    style={styles.paymentMethodIcon}
                  />
                ) : (
                  <Ionicons
                    name="phone-portrait-outline"
                    size={20}
                    color={paymentMethod === 'tap_to_pay' ? colors.onPrimary : colors.text}
                  />
                )}
                <Text
                  style={[
                    styles.paymentMethodButtonText,
                    paymentMethod === 'tap_to_pay' && styles.paymentMethodButtonTextSelected,
                  ]}
                  maxFontSizeMultiplier={1.3}
                >
                  {Platform.OS === 'ios' ? t('tapToPayButton') : t('tapToPayButtonAndroid')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.paymentMethodButton,
                  paymentMethod === 'cash' && styles.paymentMethodButtonSelected,
                ]}
                onPress={() => setPaymentMethod('cash')}
                accessibilityRole="button"
                accessibilityLabel={t('cashAccessibilityLabel')}
                accessibilityState={{ selected: paymentMethod === 'cash' }}
              >
                <Ionicons
                  name="cash-outline"
                  size={20}
                  color={paymentMethod === 'cash' ? colors.onPrimary : colors.text}
                />
                <Text
                  style={[
                    styles.paymentMethodButtonText,
                    paymentMethod === 'cash' && styles.paymentMethodButtonTextSelected,
                  ]}
                  maxFontSizeMultiplier={1.3}
                >
                  {t('cashButton')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.paymentMethodButton,
                  paymentMethod === 'split' && styles.paymentMethodButtonSelected,
                ]}
                onPress={() => setPaymentMethod('split')}
                accessibilityRole="button"
                accessibilityLabel={t('splitAccessibilityLabel')}
                accessibilityState={{ selected: paymentMethod === 'split' }}
              >
                <Ionicons
                  name="git-branch-outline"
                  size={20}
                  color={paymentMethod === 'split' ? colors.onPrimary : colors.text}
                />
                <Text
                  style={[
                    styles.paymentMethodButtonText,
                    paymentMethod === 'split' && styles.paymentMethodButtonTextSelected,
                  ]}
                  maxFontSizeMultiplier={1.3}
                >
                  {t('splitButton')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

        {/* 4. Order Summary with Totals */}
        <View style={styles.summaryCard}>
          {isQuickCharge ? (
            <>
              <View style={styles.totalsSection}>
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>{t('quickChargeLabel')}</Text>
                  <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(subtotal, currency)}</Text>
                </View>
                {taxAmount > 0 && (
                  <View style={styles.totalsRow}>
                    <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>{t('taxLabel', { rate: taxRate })}</Text>
                    <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(taxAmount, currency)}</Text>
                  </View>
                )}
                {tipAmount > 0 && (
                  <View style={styles.totalsRow}>
                    <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>{t('tipLabel', { percentage: tipPercentage })}</Text>
                    <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(tipAmount, currency)}</Text>
                  </View>
                )}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel} maxFontSizeMultiplier={1.3}>{t('totalLabel')}</Text>
                  <Text style={styles.totalAmount} maxFontSizeMultiplier={1.2} accessibilityRole="summary" accessibilityLabel={t('totalAccessibilityLabel', { amount: formatCents(grandTotal, currency) })}>{formatCents(grandTotal, currency)}</Text>
                </View>
              </View>
            </>
          ) : (
            <>
              {/* Itemized list with thumbnails and quantity controls */}
              {items.map((item) => {
                const renderRightActions = (
                  progress: Animated.AnimatedInterpolation<number>,
                  dragX: Animated.AnimatedInterpolation<number>
                ) => {
                  const scale = dragX.interpolate({
                    inputRange: [-60, -30, 0],
                    outputRange: [1, 0.9, 0.6],
                    extrapolate: 'clamp',
                  });
                  const opacity = dragX.interpolate({
                    inputRange: [-60, -30, 0],
                    outputRange: [1, 0.8, 0],
                    extrapolate: 'clamp',
                  });
                  return (
                    <TouchableOpacity
                      style={styles.deleteAction}
                      onPress={() => handleRemoveItem(item)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={t('removeFromCartAccessibilityLabel', { name: item.product.name })}
                    >
                      <Animated.View
                        style={[styles.deleteActionContent, { transform: [{ scale }], opacity }]}
                      >
                        <Ionicons name="trash" size={20} color="#fff" />
                      </Animated.View>
                    </TouchableOpacity>
                  );
                };

                return (
                  <Swipeable
                    key={item.cartKey}
                    renderRightActions={renderRightActions}
                    rightThreshold={40}
                    overshootRight={false}
                  >
                    <View style={styles.itemRow}>
                      <View style={styles.itemThumbnail}>
                        {item.product.imageUrl ? (
                          <Image source={{ uri: item.product.imageUrl }} style={styles.itemImage} />
                        ) : (
                          <View style={styles.itemImagePlaceholder}>
                            <Ionicons name="image-outline" size={14} color={colors.textMuted} />
                          </View>
                        )}
                      </View>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemName} maxFontSizeMultiplier={1.5} numberOfLines={2}>{item.product.name}</Text>
                        {item.notes ? (
                          <Text style={styles.itemNotes} maxFontSizeMultiplier={1.5} numberOfLines={1}>{item.notes}</Text>
                        ) : (
                          <Text style={styles.itemUnitPrice} maxFontSizeMultiplier={1.5}>{t('unitPriceEach', { price: formatCents(item.product.price, currency) })}</Text>
                        )}
                      </View>
                      <View style={styles.quantityControls}>
                        <TouchableOpacity
                          style={styles.quantityButton}
                          onPress={() => handleDecrementItem(item)}
                          hitSlop={QTY_HIT_SLOP}
                          accessibilityRole="button"
                          accessibilityLabel={item.quantity === 1 ? t('removeFromCartAccessibilityLabel', { name: item.product.name }) : t('decreaseQuantityAccessibilityLabel', { name: item.product.name })}
                        >
                          <Ionicons
                            name={item.quantity === 1 ? 'trash-outline' : 'remove'}
                            size={18}
                            color={item.quantity === 1 ? colors.error : colors.text}
                          />
                        </TouchableOpacity>
                        <Text style={styles.quantityText} maxFontSizeMultiplier={1.5} accessibilityRole="text" accessibilityLabel={t('quantityAccessibilityLabel', { quantity: item.quantity })}>{item.quantity}</Text>
                        <TouchableOpacity
                          style={styles.quantityButton}
                          onPress={() => incrementItem(item.cartKey)}
                          hitSlop={QTY_HIT_SLOP}
                          accessibilityRole="button"
                          accessibilityLabel={t('increaseQuantityAccessibilityLabel', { name: item.product.name })}
                        >
                          <Ionicons name="add" size={18} color={colors.text} />
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.itemPrice} maxFontSizeMultiplier={1.5} numberOfLines={1} adjustsFontSizeToFit>
                        {formatCents(item.product.price * item.quantity, currency)}
                      </Text>
                    </View>
                  </Swipeable>
                );
              })}
              {/* Totals */}
              <View style={styles.totalsSection}>
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>{t(itemCount === 1 ? 'subtotalWithCountSingular' : 'subtotalWithCount', { count: itemCount })}</Text>
                  <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(subtotal, currency)}</Text>
                </View>
                {taxAmount > 0 && (
                  <View style={styles.totalsRow}>
                    <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>{t('taxLabel', { rate: taxRate })}</Text>
                    <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(taxAmount, currency)}</Text>
                  </View>
                )}
                {tipAmount > 0 && (
                  <View style={styles.totalsRow}>
                    <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>{t('tipLabel', { percentage: tipPercentage })}</Text>
                    <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(tipAmount, currency)}</Text>
                  </View>
                )}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel} maxFontSizeMultiplier={1.3}>{t('totalLabel')}</Text>
                  <Text style={styles.totalAmount} maxFontSizeMultiplier={1.2} accessibilityRole="summary" accessibilityLabel={t('totalAccessibilityLabel', { amount: formatCents(grandTotal, currency) })}>{formatCents(grandTotal, currency)}</Text>
                </View>
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* Inline explanation when charges aren't enabled — the Pay button
          below is disabled instead of relying on a post-tap alert. */}
      {chargesDisabled && (
        <View style={styles.chargesDisabledHintRow} accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={14} color={colors.warning} />
          <Text style={styles.chargesDisabledHintText} maxFontSizeMultiplier={1.5}>
            {t('chargesDisabledPayHint')}
          </Text>
        </View>
      )}

      {/* Inline explanation when the device is offline — Pay is disabled */}
      {isOffline && !chargesDisabled && (
        <View style={styles.chargesDisabledHintRow} accessibilityRole="alert">
          <Ionicons name="cloud-offline-outline" size={14} color={colors.warning} />
          <Text style={styles.chargesDisabledHintText} maxFontSizeMultiplier={1.5}>
            {t('offlinePayHint')}
          </Text>
        </View>
      )}

      {/* Footer with Add to Table + Pay Button */}
      <View style={styles.footer}>
        {/* Add to Table button — shown when org has floor plans (future: check floorPlans.length > 0) */}
        {/* TODO: Add floor plan check and table picker modal
        <TouchableOpacity
          onPress={() => navigation.navigate('FloorPlan', { mode: 'assign', items, catalogId: selectedCatalog?.id })}
          style={[styles.addToTableButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
          accessibilityRole="button"
          accessibilityLabel="Add to table"
        >
          <Ionicons name="grid-outline" size={20} color={colors.primary} />
          <Text style={[styles.addToTableButtonText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>Add to Table</Text>
        </TouchableOpacity>
        */}
        <TouchableOpacity
          onPress={handlePayment}
          disabled={isProcessing || chargesDisabled || isOffline}
          activeOpacity={0.9}
          style={[
            styles.payButton,
            paymentMethod === 'cash' && styles.payButtonCash,
            paymentMethod === 'split' && styles.payButtonSplit,
            paymentMethod === 'tap_to_pay' && { backgroundColor: isDark ? '#fff' : '#1C1917' },
            (isProcessing || chargesDisabled || isOffline) && styles.payButtonDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isProcessing ? t('processingPaymentAccessibilityLabel') : paymentMethod === 'tap_to_pay' ? t('payButtonTapToPayAccessibilityLabel', { tapToPayLabel, amount: formatCents(grandTotal, currency) }) : paymentMethod === 'cash' ? t('payButtonCashAccessibilityLabel', { amount: formatCents(grandTotal, currency) }) : t('payButtonSplitAccessibilityLabel', { amount: formatCents(grandTotal, currency) })}
          accessibilityState={{ disabled: isProcessing || chargesDisabled || isOffline }}
        >
          {isProcessing ? (
            <ActivityIndicator color={paymentMethod === 'tap_to_pay' ? (isDark ? '#1C1917' : '#fff') : '#fff'} accessibilityLabel={t('processingPaymentAccessibilityLabel')} />
          ) : (
            <>
              {paymentMethod === 'tap_to_pay' ? (
                <>
                  {/* Apple HIG: SF Symbol wave.3.right.circle.fill for Tap to Pay on iPhone */}
                  {Platform.OS === 'ios' ? (
                    <SymbolView
                      name="wave.3.right.circle.fill"
                      size={24}
                      tintColor={isDark ? '#1C1917' : '#fff'}
                      resizeMode="scaleAspectFit"
                      style={styles.tapToPayIcon}
                    />
                  ) : (
                    <View style={styles.tapToPayIcon}>
                      <Ionicons name="wifi" size={22} color={isDark ? '#1C1917' : '#fff'} style={styles.tapToPayIconRotated} />
                    </View>
                  )}
                  {/* Apple HIG: "Tap to Pay on iPhone" copy + unambiguous amount
                      at the moment of payment (Apple TTPOi 3.1) */}
                  <Text style={[styles.payButtonText, { color: isDark ? '#1C1917' : '#fff' }]} maxFontSizeMultiplier={1.3} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {`${tapToPayLabel} · ${formatCents(grandTotal, currency)}`}
                  </Text>
                </>
              ) : paymentMethod === 'cash' ? (
                <>
                  <Ionicons name="cash-outline" size={22} color="#fff" />
                  <Text style={styles.payButtonText} maxFontSizeMultiplier={1.3} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {`${t('payWithCashButton')} · ${formatCents(grandTotal, currency)}`}
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons name="git-branch-outline" size={22} color={colors.onPrimary} />
                  <Text style={[styles.payButtonText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {`${t('splitPaymentButton')} · ${formatCents(grandTotal, currency)}`}
                  </Text>
                </>
              )}
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Hold Order Modal */}
      <Modal
        visible={showHoldModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowHoldModal(false)}
        onShow={() => {
          setTimeout(() => holdNameInputRef.current?.focus(), 100);
        }}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowHoldModal(false)}
          accessibilityRole="button"
          accessibilityLabel={t('closeHoldDialogAccessibilityLabel')}
        >
          <Pressable
            style={[styles.modalContent, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
            accessible={false}
            accessibilityRole="none"
          >
            <Text style={styles.modalTitle} maxFontSizeMultiplier={1.3}>{t('holdOrderModalTitle')}</Text>
            <Text style={styles.modalSubtitle} maxFontSizeMultiplier={1.5}>
              {t('holdOrderModalSubtitle')}
            </Text>
            <TextInput
              ref={holdNameInputRef}
              style={styles.holdNameInput}
              placeholder={t('holdNamePlaceholder')}
              placeholderTextColor={colors.textMuted}
              value={holdName}
              onChangeText={setHoldName}
              maxLength={50}
              accessibilityLabel={t('holdNameAccessibilityLabel')}
              accessibilityHint={t('holdNameAccessibilityHint')}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowHoldModal(false);
                  setHoldName('');
                }}
                accessibilityRole="button"
                accessibilityLabel={t('cancelHoldAccessibilityLabel')}
              >
                <Text style={styles.modalCancelButtonText} maxFontSizeMultiplier={1.3}>{tc('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmButton, isHolding && styles.modalConfirmButtonDisabled]}
                onPress={handleHoldOrder}
                disabled={isHolding}
                accessibilityRole="button"
                accessibilityLabel={isHolding ? t('holdingOrderAccessibilityLabel') : t('holdOrderAccessibilityLabel')}
                accessibilityState={{ disabled: isHolding }}
              >
                {isHolding ? (
                  <ActivityIndicator color="#fff" size="small" accessibilityLabel={t('holdingOrderAccessibilityLabel')} />
                ) : (
                  <>
                    <Ionicons name="pause-circle" size={18} color="#fff" />
                    <Text style={styles.modalConfirmButtonText} maxFontSizeMultiplier={1.3}>{t('holdOrderModalTitle')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      </KeyboardAvoidingView>

      {/* Removed-item undo snackbar (decrement at qty 1 / swipe-delete) */}
      <UndoSnackbar
        visible={!!removedItem}
        message={removedItem ? tc('removedFromCart', { name: removedItem.product.name }) : ''}
        onUndo={handleUndoRemove}
        onDismiss={() => setRemovedItem(null)}
        bottomOffset={insets.bottom + 88}
      />
      </View>
    </View>
  );
}

const createStyles = (colors: any, isDark: boolean) => {
  const headerBackground = isDark ? '#1C1917' : colors.background;

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: headerBackground,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    },
    closeButton: {
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
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
      letterSpacing: -0.3,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    holdButton: {
      width: 44,
      height: 44,
      borderRadius: 12,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    clearButton: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      borderRadius: 12,
    },
    clearButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.error,
    },
    scrollContent: {
      flex: 1,
    },
    content: {
      padding: 16,
      paddingBottom: 20,
    },
    summaryCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
    },
    // Itemized receipt styles
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 15,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 12,
    },
    deleteAction: {
      backgroundColor: colors.error,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 16,
      borderRadius: 12,
      marginLeft: -8,
    },
    deleteActionContent: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    itemThumbnail: {
      width: 36,
      height: 36,
      borderRadius: 8,
      overflow: 'hidden',
      marginRight: 10,
    },
    itemImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    itemImagePlaceholder: {
      width: '100%',
      height: '100%',
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    itemInfo: {
      flex: 1,
      marginRight: 8,
    },
    itemName: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.text,
      marginBottom: 2,
    },
    itemUnitPrice: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    quantityControls: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: 10,
    },
    quantityButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quantityText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      minWidth: 22,
      textAlign: 'center',
    },
    itemPrice: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      minWidth: 75,
      maxWidth: 100,
      textAlign: 'right',
      flexShrink: 0,
    },
    // Totals section styles (at bottom of order summary)
    totalsSection: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    totalsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    totalsLabel: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    totalsValue: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    totalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    totalLabel: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
    },
    totalAmount: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.text,
    },
    inputError: {
      borderColor: colors.error,
      borderWidth: 1.5,
    },
    inputErrorText: {
      fontSize: 13,
      color: colors.error,
      marginTop: 8,
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      paddingBottom: 12,
      gap: 10,
    },
    chargesDisabledHintRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 20,
      paddingTop: 10,
    },
    chargesDisabledHintText: {
      flexShrink: 1,
      fontSize: 13,
      fontWeight: '500',
      color: colors.warning,
    },
    payButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      borderRadius: 16,
      gap: 8,
      ...shadows.md,
      shadowColor: colors.primary,
      shadowOpacity: 0.3,
    },
    payButtonDisabled: {
      opacity: 0.5,
      shadowOpacity: 0,
    },
    payButtonText: {
      color: '#fff',
      fontSize: 18,
      fontWeight: '600',
    },
    tapToPayIcon: {
      width: 24,
      height: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tapToPayIconRotated: {
      transform: [{ rotate: '90deg' }],
    },
    // Tip section styles
    tipSection: {
      marginBottom: 16,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
    },
    tipTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: 12,
    },
    tipOptions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -4,
    },
    tipButton: {
      width: '33.33%',
      paddingHorizontal: 4,
      marginBottom: 8,
    },
    tipButtonInner: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      minHeight: 70,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tipButtonInnerSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    tipButtonLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    tipButtonLabelSelected: {
      color: colors.onPrimary,
    },
    tipButtonAmount: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 4,
    },
    tipButtonAmountSelected: {
      color: colors.onPrimary,
      opacity: 0.8,
    },
    // Custom tip styles
    customTipContainer: {
      marginTop: 10,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    customTipLabel: {
      fontSize: 14,
      color: colors.textSecondary,
      marginBottom: 12,
    },
    customTipInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    customTipDollar: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.text,
      marginRight: 8,
    },
    customTipInput: {
      flex: 1,
      fontSize: 24,
      fontWeight: '600',
      color: colors.text,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    // Item notes style
    itemNotes: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: colors.primary,
      fontStyle: 'italic',
    },
    // Customer info section styles (combined email + notes)
    customerInfoSection: {
      marginBottom: 16,
      backgroundColor: colors.card,
      borderRadius: 16,
      overflow: 'hidden',
    },
    customerInfoHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 14,
    },
    customerInfoHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    customerInfoTitle: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
    },
    customerInfoBadge: {
      marginLeft: 4,
    },
    customerInfoContent: {
      paddingHorizontal: 14,
      paddingBottom: 14,
      gap: 10,
    },
    customerInfoField: {
      gap: 4,
    },
    customerInfoInput: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.text,
    },
    customerInfoNotesInput: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.text,
      minHeight: 50,
      textAlignVertical: 'top',
    },
    // Payment method section styles
    paymentMethodSection: {
      marginBottom: 16,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
    },
    paymentMethodTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: 12,
    },
    paymentMethodOptions: {
      flexDirection: 'row',
      gap: 10,
    },
    paymentMethodButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: 44,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    paymentMethodButtonSelected: {
      backgroundColor: colors.primary,
    },
    paymentMethodButtonText: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.text,
    },
    paymentMethodIcon: {
      width: 22,
      height: 22,
    },
    paymentMethodButtonTextSelected: {
      color: colors.onPrimary,
    },
    // Pay button variants
    payButtonCash: {
      backgroundColor: colors.success,
    },
    payButtonSplit: {
      backgroundColor: colors.primary,
    },
    // Modal styles
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    modalContent: {
      width: '100%',
      maxWidth: 400,
      borderRadius: 24,
      padding: 24,
      ...shadows.lg,
    },
    modalTitle: {
      fontSize: 22,
      fontFamily: fonts.bold,
      color: colors.text,
      marginBottom: 8,
    },
    modalSubtitle: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      marginBottom: 20,
    },
    holdNameInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingHorizontal: 18,
      paddingVertical: 14,
      fontSize: 16,
      fontFamily: fonts.regular,
      color: colors.text,
      marginBottom: 20,
    },
    modalButtons: {
      flexDirection: 'row',
      gap: 12,
    },
    modalCancelButton: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    modalCancelButtonText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    modalConfirmButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: colors.primary,
    },
    modalConfirmButtonDisabled: {
      opacity: 0.6,
    },
    modalConfirmButtonText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: '#fff',
    },
  });
};
