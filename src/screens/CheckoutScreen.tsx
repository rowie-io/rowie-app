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
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { useTheme } from '../context/ThemeContext';
import { useCart, CartItem, PaymentMethodType } from '../context/CartContext';
import { useCatalog } from '../context/CatalogContext';
import { useAuth } from '../context/AuthContext';
import { useTerminal } from '../context/StripeTerminalContext';
import { stripeTerminalApi, ordersApi } from '../lib/api';
import { getDeviceId } from '../lib/device';
import { glass } from '../lib/colors';
import { shadows } from '../lib/shadows';
import { fonts } from '../lib/fonts';
import { PayoutsSetupBanner } from '../components/PayoutsSetupBanner';
import { SetupRequiredBanner } from '../components/SetupRequiredBanner';
import logger from '../lib/logger';
import { isValidEmailOrEmpty } from '../lib/validation';
import { formatCents, getCurrencySymbol, toSmallestUnit, fromSmallestUnit } from '../utils/currency';


// Apple TTPOi 5.4: Use region-correct copy
const TAP_TO_PAY_LABEL = Platform.OS === 'ios' ? 'Tap to Pay on iPhone' : 'Tap to Pay';

interface TipOption {
  label: string;
  value: number;
  isCustom?: boolean;
}

type RouteParams = {
  Checkout: {
    total: number;
    isQuickCharge?: boolean;
    quickChargeDescription?: string;
    resumedOrderId?: string;
    resumedOrder?: any;
  };
};

export function CheckoutScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'Checkout'>>();
  const glassColors = isDark ? glass.dark : glass.light;
  const { items, itemCount, clearCart, incrementItem, decrementItem, removeItem, subtotal: cartSubtotal, orderNotes, setOrderNotes, customerEmail, setCustomerEmail, paymentMethod, setPaymentMethod, selectedTipIndex, setSelectedTipIndex, customTipAmount, setCustomTipAmount, showCustomTipInput, setShowCustomTipInput } = useCart();
  const { selectedCatalog } = useCatalog();
  const { isPaymentReady, connectLoading, connectStatus, currency } = useAuth();
  const { deviceCompatibility, isInitialized: isTerminalInitialized, isWarming, preferredReader } = useTerminal();

  // Catalog data is automatically updated via socket events in CatalogContext

  const [emailError, setEmailError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

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

  const { total: routeTotal, isQuickCharge, quickChargeDescription, resumedOrderId, resumedOrder } = route.params;
  const styles = createStyles(colors, glassColors, isDark);

  // NOTE: Do NOT clear cart on unmount — only clear after explicit hold/delete/complete actions

  // Initialize state from resumed order
  useEffect(() => {
    if (resumedOrder) {
      // Set customer email
      if (resumedOrder.customerEmail) {
        setCustomerEmail(resumedOrder.customerEmail);
      }

      // Set order notes
      if (resumedOrder.notes || resumedOrder.customerEmail) {
        if (resumedOrder.notes) setOrderNotes(resumedOrder.notes);
        setShowCustomerInfo(true);
      }

      // Set payment method
      if (resumedOrder.paymentMethod) {
        const methodMap: Record<string, PaymentMethodType> = {
          tap_to_pay: 'tap_to_pay',
          cash: 'cash',
          card: 'tap_to_pay',
          split: 'split',
        };
        setPaymentMethod(methodMap[resumedOrder.paymentMethod] || 'tap_to_pay');
      }

      // Note: Tip is already handled via the tipAmount/grandTotal calculation
      // We don't need to set selectedTipIndex since we use the stored tipAmount directly
    }
  }, [resumedOrder]);

  // Use cart subtotal for regular checkout (items can be modified), route total for quick charge
  // For resumed orders, use the order's subtotal
  const subtotal = resumedOrder
    ? resumedOrder.subtotal
    : isQuickCharge
      ? routeTotal
      : cartSubtotal;

  // Navigate back if cart becomes empty (not for quick charge or resumed orders)
  useEffect(() => {
    if (!isQuickCharge && !resumedOrder && items.length === 0) {
      navigation.goBack();
    }
  }, [items.length, isQuickCharge, resumedOrder, navigation]);

  // Track whether we're allowing navigation (set to true after user confirms in dialog)
  const allowNavigationRef = useRef(false);

  // Intercept back navigation for resumed orders (hardware back button, swipe gesture)
  useEffect(() => {
    if (!resumedOrder || !resumedOrderId) return;

    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      // If navigation was allowed programmatically, let it happen
      if (allowNavigationRef.current) {
        allowNavigationRef.current = false;
        return;
      }

      // Prevent default navigation
      e.preventDefault();

      // Show confirmation dialog
      Alert.alert(
        'What would you like to do?',
        'This order needs to be held or deleted.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Delete Order',
            style: 'destructive',
            onPress: async () => {
              try {
                await ordersApi.cancel(resumedOrderId);
                clearCart();
                allowNavigationRef.current = true;
                navigation.dispatch(e.data.action);
              } catch (error: any) {
                logger.error('Delete order error:', error);
                Alert.alert('Error', error.error || error.message || 'Failed to delete order');
              }
            },
          },
          {
            text: 'Hold Order',
            onPress: async () => {
              try {
                const vals = currentValuesRef.current;
                const emailValid = vals.customerEmail.trim() && isValidEmailOrEmpty(vals.customerEmail) ? vals.customerEmail.trim() : undefined;
                const holdUpdates = {
                  tipAmount: vals.tipAmount,
                  taxAmount: vals.taxAmount,
                  subtotal: vals.subtotal,
                  totalAmount: vals.grandTotal,
                  paymentMethod: vals.paymentMethod,
                  customerEmail: emailValid,
                  notes: vals.orderNotes || null,
                };
                logger.log('[RE-HOLD DEBUG] beforeRemove hold updates:', JSON.stringify(holdUpdates, null, 2));
                logger.log('[RE-HOLD DEBUG] holdName:', vals.holdName || resumedOrder.holdName);
                const result = await ordersApi.hold(resumedOrderId, vals.holdName || resumedOrder.holdName, holdUpdates);
                logger.log('[RE-HOLD DEBUG] hold API result:', JSON.stringify({ id: result.id, paymentMethod: result.paymentMethod, tipAmount: result.tipAmount, totalAmount: result.totalAmount }));
                clearCart();
                allowNavigationRef.current = true;
                navigation.dispatch(e.data.action);
              } catch (error: any) {
                logger.error('Re-hold order error:', error);
                Alert.alert('Error', error.error || error.message || 'Failed to hold order');
              }
            },
          },
        ]
      );
    });

    return unsubscribe;
  }, [resumedOrder, resumedOrderId, navigation]);

  // Show setup required banner when charges aren't enabled
  const showSetupBanner = !connectLoading && connectStatus && !connectStatus.chargesEnabled;

  // Show payouts banner when charges are enabled but payouts aren't (user can still accept payments)
  const showPayoutsBanner = !connectLoading && isPaymentReady && connectStatus && !connectStatus.payoutsEnabled;

  // Use catalog settings for tip, email, and tax
  const showTipScreen = selectedCatalog?.showTipScreen ?? true;
  const promptForEmail = selectedCatalog?.promptForEmail ?? true;
  const tipPercentages = selectedCatalog?.tipPercentages ?? [15, 18, 20, 25];
  const allowCustomTip = selectedCatalog?.allowCustomTip ?? true;
  // Tax rate stored as whole number percentage (e.g., 5 for 5%)
  // For resumed orders, calculate from stored values
  const taxRate = useMemo(() => {
    if (resumedOrder && resumedOrder.subtotal > 0) {
      // Calculate tax rate from stored tax amount and subtotal
      return Math.round((resumedOrder.taxAmount / resumedOrder.subtotal) * 100);
    }
    return selectedCatalog?.taxRate ?? 0;
  }, [resumedOrder, selectedCatalog?.taxRate]);

  // Calculate tax amount (based on subtotal) - use resumed order's tax if available
  const taxAmount = useMemo(() => {
    if (resumedOrder) return resumedOrder.taxAmount;
    if (taxRate <= 0) return 0;
    return Math.round(subtotal * (taxRate / 100));
  }, [subtotal, taxRate, resumedOrder]);

  // Build tip options
  const tipOptions: TipOption[] = useMemo(() => {
    const options: TipOption[] = tipPercentages.map((pct: number) => ({
      label: `${pct}%`,
      value: pct / 100,
    }));
    // Add custom tip option if allowed
    if (allowCustomTip) {
      options.push({ label: 'Custom', value: -1, isCustom: true });
    }
    // Always add no tip option
    options.push({ label: 'No Tip', value: 0 });
    return options;
  }, [tipPercentages, allowCustomTip]);

  // Calculate tip and grand total (subtotal + tax + tip) - use resumed order values if available
  const { tipAmount, grandTotal, tipPercentage } = useMemo(() => {
    // For resumed orders, use the stored values
    if (resumedOrder) {
      // Calculate tip percentage from stored values
      const calcTipPct = resumedOrder.subtotal > 0
        ? Math.round((resumedOrder.tipAmount / resumedOrder.subtotal) * 100)
        : 0;
      return {
        tipAmount: resumedOrder.tipAmount,
        grandTotal: resumedOrder.totalAmount,
        tipPercentage: calcTipPct,
      };
    }

    const subtotalWithTax = subtotal + taxAmount;
    if (!showTipScreen || selectedTipIndex === null) {
      return { tipAmount: 0, grandTotal: subtotalWithTax, tipPercentage: 0 };
    }
    const selectedOption = tipOptions[selectedTipIndex];
    if (selectedOption?.isCustom) {
      const customTip = parseInt(customTipAmount, 10) || 0;
      // Custom tip is entered in base unit, convert to smallest unit
      const tipCents = toSmallestUnit(customTip, currency);
      // Calculate percentage for custom tip
      const calcTipPct = subtotal > 0 ? Math.round((tipCents / subtotal) * 100) : 0;
      return { tipAmount: tipCents, grandTotal: subtotalWithTax + tipCents, tipPercentage: calcTipPct };
    }
    const tipPct = selectedOption?.value || 0;
    // Tip is calculated on subtotal (before tax)
    const tip = Math.round(subtotal * tipPct);
    return { tipAmount: tip, grandTotal: subtotalWithTax + tip, tipPercentage: Math.round(tipPct * 100) };
  }, [subtotal, taxAmount, selectedTipIndex, showTipScreen, tipOptions, customTipAmount, resumedOrder, currency]);

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

  // Handle hold order
  const handleHoldOrder = async () => {
    if (isQuickCharge) return; // Can't hold quick charges

    // Validate email if provided
    if (customerEmail.trim() && !isValidEmailOrEmpty(customerEmail)) {
      setEmailError('Please enter a valid email address');
      return;
    }

    logger.log('Hold order: Starting hold process', { isResumedOrder: !!resumedOrderId });
    setIsHolding(true);
    try {
      let orderId: string;
      let orderNumber: string;

      if (resumedOrderId) {
        // Re-hold the existing resumed order with updated fields
        const holdUpdates = {
          tipAmount: tipAmount,
          taxAmount: taxAmount,
          subtotal: subtotal,
          totalAmount: grandTotal,
          paymentMethod: paymentMethod,
          customerEmail: customerEmail.trim() || undefined,
          notes: orderNotes || null,
        };
        logger.log('[RE-HOLD DEBUG] handleHoldOrder updates:', JSON.stringify(holdUpdates, null, 2));
        logger.log('[RE-HOLD DEBUG] holdName:', holdName.trim() || resumedOrder?.holdName);

        const heldOrder = await ordersApi.hold(resumedOrderId, holdName.trim() || resumedOrder?.holdName || undefined, holdUpdates);
        logger.log('[RE-HOLD DEBUG] hold API result:', JSON.stringify({ id: heldOrder.id, paymentMethod: heldOrder.paymentMethod, tipAmount: heldOrder.tipAmount, totalAmount: heldOrder.totalAmount }));

        orderId = heldOrder.id;
        orderNumber = heldOrder.orderNumber;

        logger.log('Hold order: Re-hold API returned', { orderId, status: heldOrder.status });

        if (heldOrder.status !== 'held') {
          throw new Error(`Order hold failed - status is ${heldOrder.status}`);
        }
      } else {
        // New order: create then hold
        const deviceId = await getDeviceId();
        logger.log('Hold order: Got device ID:', deviceId);

        const orderItems = items.map((item) => ({
          productId: item.product.productId,
          categoryId: item.product.categoryId || undefined,
          name: item.product.name,
          quantity: item.quantity,
          unitPrice: item.product.price,
          notes: item.notes,
        }));

        const createOrderParams = {
          catalogId: selectedCatalog?.id,
          items: orderItems,
          subtotal: subtotal,
          taxAmount: taxAmount,
          tipAmount: tipAmount,
          totalAmount: grandTotal,
          paymentMethod: paymentMethod,
          customerEmail: customerEmail.trim() || undefined,
          deviceId,
          notes: orderNotes || undefined,
          holdName: holdName.trim() || undefined,
        };

        logger.log('Hold order: Creating order with params:', JSON.stringify(createOrderParams, null, 2));

        const order = await ordersApi.create(createOrderParams);
        logger.log('Hold order: Order created', { orderId: order.id, orderNumber: order.orderNumber, status: order.status });

        const heldOrder = await ordersApi.hold(order.id, holdName.trim() || undefined);
        orderId = heldOrder.id;
        orderNumber = heldOrder.orderNumber;

        logger.log('Hold order: Hold API returned', { orderId, status: heldOrder.status });

        if (heldOrder.status !== 'held') {
          throw new Error(`Order hold failed - status is ${heldOrder.status}`);
        }
      }

      logger.log('Order held successfully:', { orderId });

      // Close modal first
      setShowHoldModal(false);

      // Clear cart before navigating
      clearCart();

      // Allow navigation past the beforeRemove guard for resumed orders
      allowNavigationRef.current = true;

      // Close checkout screen and go back to menu
      navigation.goBack();

      // Show confirmation
      Alert.alert(
        'Order Held',
        `Order "${holdName.trim() || resumedOrder?.holdName || `#${orderNumber}`}" has been saved. You can resume it from the History tab.`
      );
    } catch (error: any) {
      logger.error('Hold order error:', error);
      logger.error('Hold order error details:', {
        message: error.message,
        error: error.error,
        statusCode: error.statusCode,
        code: error.code,
        details: error.details,
      });

      // Extract error message properly - error.error might be an object (ZodError)
      let errorMessage = 'Failed to hold order';
      if (typeof error.error === 'string') {
        errorMessage = error.error;
      } else if (error.error?.issues) {
        // Zod validation error - extract the issues
        const issues = error.error.issues;
        logger.error('Zod validation issues:', JSON.stringify(issues, null, 2));
        errorMessage = issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join(', ');
      } else if (error.message) {
        errorMessage = error.message;
      }

      Alert.alert('Error', errorMessage);
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
      setEmailError('Please enter a valid email address');
      return;
    }

    // Check if payment setup is complete
    if (connectStatus && !connectStatus.chargesEnabled) {
      Alert.alert(
        'Payment Setup Required',
        'You need to complete your payment setup before accepting payments.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Complete Setup', onPress: () => navigation.navigate('StripeOnboarding') },
        ]
      );
      return;
    }

    // Check if terminal is warming up
    if (isWarming) {
      Alert.alert(
        'Preparing Terminal',
        'Please wait while Tap to Pay is being prepared...',
        [{ text: 'OK' }]
      );
      return;
    }

    // Proceed with payment
    setIsProcessing(true);

    try {
      // Include email for receipt if provided
      const receiptEmail = customerEmail.trim() || undefined;

      // Build description based on checkout type
      const description = isQuickCharge
        ? `${quickChargeDescription || 'Quick Charge'}${tipAmount > 0 ? ` (includes ${formatCents(tipAmount, currency)} tip)` : ''}`
        : resumedOrder
          ? `${resumedOrder.holdName || 'Resumed Order'} - ${resumedOrder.items?.length || 0} items${tipAmount > 0 ? ` (includes ${formatCents(tipAmount, currency)} tip)` : ''}`
          : `Order - ${items.length} items${tipAmount > 0 ? ` (includes ${formatCents(tipAmount, currency)} tip)` : ''}`;

      // 1. Get or create order in database
      let order;
      if (resumedOrder) {
        // Use existing resumed order
        order = resumedOrder;
      } else {
        // Create new order
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
          errorMessage: deviceCompatibility.errorMessage || `This device does not support ${TAP_TO_PAY_LABEL}.`,
        });
        return;
      }

      // 2. Create payment intent with tip included
      const paymentIntent = await stripeTerminalApi.createPaymentIntent({
        amount: fromSmallestUnit(grandTotal, currency), // Convert smallest unit to base unit for API
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
      });

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
      Alert.alert(
        'Payment Error',
        error.message || 'Failed to initiate payment. Please try again.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
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
            accessibilityLabel="Close checkout"
          >
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>
            {resumedOrder ? 'Resume Order' : 'Checkout'}
          </Text>
          <View style={styles.headerRight}>
            {/* Hold Order Button (not for quick charge or resumed orders) */}
            {!isQuickCharge && !resumedOrder && items.length > 0 && (
              <TouchableOpacity
                style={styles.holdButton}
                onPress={() => {
                  if (customerEmail.trim() && !isValidEmailOrEmpty(customerEmail)) {
                    setEmailError('Please enter a valid email address');
                    return;
                  }
                  setShowHoldModal(true);
                }}
                disabled={isProcessing}
                accessibilityRole="button"
                accessibilityLabel="Hold order"
                accessibilityHint="Save this order to complete later"
              >
                <Ionicons name="pause-circle-outline" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            {/* Clear Cart Button */}
            {!isQuickCharge && !resumedOrder && items.length > 0 ? (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => {
                  clearCart();
                  navigation.goBack();
                }}
                accessibilityRole="button"
                accessibilityLabel="Clear cart"
                accessibilityHint="Remove all items and go back"
              >
                <Text style={styles.clearButtonText} maxFontSizeMultiplier={1.3}>Clear</Text>
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
        {/* 1. Tip Selection (first) - hide for resumed orders since tip is already set */}
        {showTipScreen && !resumedOrder && (
          <View style={styles.tipSection}>
            <Text style={styles.tipTitle} maxFontSizeMultiplier={1.3}>Add a Tip</Text>
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
                      accessibilityLabel={option.isCustom ? 'Custom tip' : option.value === 0 ? 'No tip' : `${option.label} tip${calculatedTip > 0 ? `, ${formatCents(calculatedTip, currency)}` : ''}`}
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
                <Text style={styles.customTipLabel} maxFontSizeMultiplier={1.5}>Custom amount:</Text>
                <View style={styles.customTipInputRow}>
                  <Text style={styles.customTipDollar} maxFontSizeMultiplier={1.2}>{getCurrencySymbol(currency)}</Text>
                  <TextInput
                    style={styles.customTipInput}
                    placeholder="0"
                    placeholderTextColor={colors.inputPlaceholder}
                    value={customTipAmount}
                    onChangeText={setCustomTipAmount}
                    keyboardType="number-pad"
                    autoFocus
                    accessibilityLabel={`Custom tip amount in ${currency.toUpperCase()}`}
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
              accessibilityLabel={showCustomerInfo ? 'Collapse customer info' : 'Expand customer info'}
              accessibilityState={{ expanded: showCustomerInfo }}
            >
              <View style={styles.customerInfoHeaderLeft}>
                <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.customerInfoTitle} maxFontSizeMultiplier={1.5}>
                  {customerEmail || orderNotes ? 'Customer Info' : 'Add Customer Info'}
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
                      placeholder="Email for receipt (optional)"
                      placeholderTextColor={colors.textMuted}
                      value={customerEmail}
                      onChangeText={handleEmailChange}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      accessibilityLabel="Customer email for receipt"
                    />
                    {emailError && <Text style={styles.inputErrorText} maxFontSizeMultiplier={1.5} accessibilityRole="alert">{emailError}</Text>}
                  </View>
                )}
                <TextInput
                  style={styles.customerInfoNotesInput}
                  placeholder="Order notes (optional)"
                  placeholderTextColor={colors.textMuted}
                  value={orderNotes}
                  onChangeText={setOrderNotes}
                  multiline
                  numberOfLines={2}
                  maxLength={500}
                  accessibilityLabel="Order notes"
                />
              </View>
            )}
          </View>

        {/* 3. Payment Method Selection */}
          <View style={styles.paymentMethodSection}>
            <Text style={styles.paymentMethodTitle} maxFontSizeMultiplier={1.3}>Payment Method</Text>
            <View style={styles.paymentMethodOptions}>
              <TouchableOpacity
                style={[
                  styles.paymentMethodButton,
                  paymentMethod === 'tap_to_pay' && styles.paymentMethodButtonSelected,
                ]}
                onPress={() => setPaymentMethod('tap_to_pay')}
                accessibilityRole="button"
                accessibilityLabel={Platform.OS === 'ios' ? 'Tap to Pay' : 'Card payment'}
                accessibilityState={{ selected: paymentMethod === 'tap_to_pay' }}
              >
                <Ionicons
                  name="phone-portrait-outline"
                  size={20}
                  color={paymentMethod === 'tap_to_pay' ? '#fff' : colors.text}
                />
                <Text
                  style={[
                    styles.paymentMethodButtonText,
                    paymentMethod === 'tap_to_pay' && styles.paymentMethodButtonTextSelected,
                  ]}
                  maxFontSizeMultiplier={1.3}
                >
                  {Platform.OS === 'ios' ? 'Tap to Pay' : 'Card'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.paymentMethodButton,
                  paymentMethod === 'cash' && styles.paymentMethodButtonSelected,
                ]}
                onPress={() => setPaymentMethod('cash')}
                accessibilityRole="button"
                accessibilityLabel="Cash payment"
                accessibilityState={{ selected: paymentMethod === 'cash' }}
              >
                <Ionicons
                  name="cash-outline"
                  size={20}
                  color={paymentMethod === 'cash' ? '#fff' : colors.text}
                />
                <Text
                  style={[
                    styles.paymentMethodButtonText,
                    paymentMethod === 'cash' && styles.paymentMethodButtonTextSelected,
                  ]}
                  maxFontSizeMultiplier={1.3}
                >
                  Cash
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.paymentMethodButton,
                  paymentMethod === 'split' && styles.paymentMethodButtonSelected,
                ]}
                onPress={() => setPaymentMethod('split')}
                accessibilityRole="button"
                accessibilityLabel="Split payment"
                accessibilityState={{ selected: paymentMethod === 'split' }}
              >
                <Ionicons
                  name="git-branch-outline"
                  size={20}
                  color={paymentMethod === 'split' ? '#fff' : colors.text}
                />
                <Text
                  style={[
                    styles.paymentMethodButtonText,
                    paymentMethod === 'split' && styles.paymentMethodButtonTextSelected,
                  ]}
                  maxFontSizeMultiplier={1.3}
                >
                  Split
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
                  <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>Quick Charge</Text>
                  <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(subtotal, currency)}</Text>
                </View>
                {taxAmount > 0 && (
                  <View style={styles.totalsRow}>
                    <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>Tax ({taxRate}%)</Text>
                    <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(taxAmount, currency)}</Text>
                  </View>
                )}
                {tipAmount > 0 && (
                  <View style={styles.totalsRow}>
                    <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>Tip ({tipPercentage}%)</Text>
                    <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(tipAmount, currency)}</Text>
                  </View>
                )}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel} maxFontSizeMultiplier={1.3}>Total</Text>
                  <Text style={styles.totalAmount} maxFontSizeMultiplier={1.2} accessibilityRole="summary" accessibilityLabel={`Total ${formatCents(grandTotal, currency)}`}>{formatCents(grandTotal, currency)}</Text>
                </View>
              </View>
            </>
          ) : resumedOrder ? (
            <>
              {/* Resumed order items (read-only) */}
              {resumedOrder.items?.map((item: any) => (
                <View key={item.id} style={styles.itemRow}>
                  <View style={styles.itemThumbnail}>
                    {item.imageUrl ? (
                      <Image source={{ uri: item.imageUrl }} style={styles.itemImage} />
                    ) : (
                      <View style={styles.itemImagePlaceholder}>
                        <Ionicons name="cube-outline" size={14} color={colors.textMuted} />
                      </View>
                    )}
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemName} maxFontSizeMultiplier={1.5} numberOfLines={1}>{item.name}</Text>
                    {item.notes ? (
                      <Text style={styles.itemNotes} maxFontSizeMultiplier={1.5} numberOfLines={1}>{item.notes}</Text>
                    ) : (
                      <Text style={styles.itemUnitPrice} maxFontSizeMultiplier={1.5}>{formatCents(item.unitPrice, currency)} each</Text>
                    )}
                  </View>
                  <View style={styles.quantityControls}>
                    <Text style={styles.quantityText} maxFontSizeMultiplier={1.5}>x{item.quantity}</Text>
                  </View>
                  <Text style={styles.itemPrice} maxFontSizeMultiplier={1.5} numberOfLines={1} adjustsFontSizeToFit>
                    {formatCents(item.unitPrice * item.quantity, currency)}
                  </Text>
                </View>
              ))}
              {/* Totals */}
              <View style={styles.totalsSection}>
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>Subtotal</Text>
                  <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(subtotal, currency)}</Text>
                </View>
                {taxAmount > 0 && (
                  <View style={styles.totalsRow}>
                    <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>Tax ({taxRate}%)</Text>
                    <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(taxAmount, currency)}</Text>
                  </View>
                )}
                {tipAmount > 0 && (
                  <View style={styles.totalsRow}>
                    <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>Tip ({tipPercentage}%)</Text>
                    <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(tipAmount, currency)}</Text>
                  </View>
                )}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel} maxFontSizeMultiplier={1.3}>Total</Text>
                  <Text style={styles.totalAmount} maxFontSizeMultiplier={1.2} accessibilityRole="summary" accessibilityLabel={`Total ${formatCents(grandTotal, currency)}`}>{formatCents(grandTotal, currency)}</Text>
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
                      onPress={() => removeItem(item.cartKey)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${item.product.name} from cart`}
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
                        <Text style={styles.itemName} maxFontSizeMultiplier={1.5} numberOfLines={1}>{item.product.name}</Text>
                        {item.notes ? (
                          <Text style={styles.itemNotes} maxFontSizeMultiplier={1.5} numberOfLines={1}>{item.notes}</Text>
                        ) : (
                          <Text style={styles.itemUnitPrice} maxFontSizeMultiplier={1.5}>{formatCents(item.product.price, currency)} each</Text>
                        )}
                      </View>
                      <View style={styles.quantityControls}>
                        <TouchableOpacity
                          style={styles.quantityButton}
                          onPress={() => decrementItem(item.cartKey)}
                          accessibilityRole="button"
                          accessibilityLabel={item.quantity === 1 ? `Remove ${item.product.name}` : `Decrease ${item.product.name} quantity`}
                        >
                          <Ionicons
                            name={item.quantity === 1 ? 'trash-outline' : 'remove'}
                            size={16}
                            color={item.quantity === 1 ? colors.error : colors.text}
                          />
                        </TouchableOpacity>
                        <Text style={styles.quantityText} maxFontSizeMultiplier={1.5} accessibilityRole="text" accessibilityLabel={`Quantity ${item.quantity}`}>{item.quantity}</Text>
                        <TouchableOpacity
                          style={styles.quantityButton}
                          onPress={() => incrementItem(item.cartKey)}
                          accessibilityRole="button"
                          accessibilityLabel={`Increase ${item.product.name} quantity`}
                        >
                          <Ionicons name="add" size={16} color={colors.text} />
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
                  <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>Subtotal ({itemCount} items)</Text>
                  <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(subtotal, currency)}</Text>
                </View>
                {taxAmount > 0 && (
                  <View style={styles.totalsRow}>
                    <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>Tax ({taxRate}%)</Text>
                    <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(taxAmount, currency)}</Text>
                  </View>
                )}
                {tipAmount > 0 && (
                  <View style={styles.totalsRow}>
                    <Text style={styles.totalsLabel} maxFontSizeMultiplier={1.5}>Tip ({tipPercentage}%)</Text>
                    <Text style={styles.totalsValue} maxFontSizeMultiplier={1.5}>{formatCents(tipAmount, currency)}</Text>
                  </View>
                )}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel} maxFontSizeMultiplier={1.3}>Total</Text>
                  <Text style={styles.totalAmount} maxFontSizeMultiplier={1.2} accessibilityRole="summary" accessibilityLabel={`Total ${formatCents(grandTotal, currency)}`}>{formatCents(grandTotal, currency)}</Text>
                </View>
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* Footer with Pay Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          onPress={handlePayment}
          disabled={isProcessing}
          activeOpacity={0.9}
          style={[
            styles.payButton,
            paymentMethod === 'cash' && styles.payButtonCash,
            paymentMethod === 'split' && styles.payButtonSplit,
            paymentMethod === 'tap_to_pay' && { backgroundColor: isDark ? '#fff' : '#1C1917' },
            isProcessing && styles.payButtonDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isProcessing ? 'Processing payment' : paymentMethod === 'tap_to_pay' ? `${TAP_TO_PAY_LABEL}, ${formatCents(grandTotal, currency)}` : paymentMethod === 'cash' ? `Pay with cash, ${formatCents(grandTotal, currency)}` : `Split payment, ${formatCents(grandTotal, currency)}`}
          accessibilityState={{ disabled: isProcessing }}
        >
          {isProcessing ? (
            <ActivityIndicator color={paymentMethod === 'tap_to_pay' ? (isDark ? '#1C1917' : '#fff') : '#fff'} accessibilityLabel="Processing payment" />
          ) : (
            <>
              {paymentMethod === 'tap_to_pay' ? (
                <>
                  {/* Apple TTPOi 5.5: Contactless payment icon (wave symbol) */}
                  <View style={styles.tapToPayIcon}>
                    <Ionicons name="wifi" size={22} color={isDark ? '#1C1917' : '#fff'} style={styles.tapToPayIconRotated} />
                  </View>
                  {/* Apple TTPOi 5.4: Region-correct copy */}
                  <Text style={[styles.payButtonText, { color: isDark ? '#1C1917' : '#fff' }]} maxFontSizeMultiplier={1.3}>{TAP_TO_PAY_LABEL}</Text>
                </>
              ) : paymentMethod === 'cash' ? (
                <>
                  <Ionicons name="cash-outline" size={22} color="#fff" />
                  <Text style={styles.payButtonText} maxFontSizeMultiplier={1.3}>Pay with Cash</Text>
                </>
              ) : (
                <>
                  <Ionicons name="git-branch-outline" size={22} color="#fff" />
                  <Text style={styles.payButtonText} maxFontSizeMultiplier={1.3}>Split Payment</Text>
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
          accessibilityLabel="Close hold order dialog"
        >
          <Pressable
            style={[styles.modalContent, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
            accessibilityRole="none"
          >
            <Text style={styles.modalTitle} maxFontSizeMultiplier={1.3}>Hold Order</Text>
            <Text style={styles.modalSubtitle} maxFontSizeMultiplier={1.5}>
              Give this order a name so you can find it later
            </Text>
            <TextInput
              ref={holdNameInputRef}
              style={styles.holdNameInput}
              placeholder="e.g., Table 5, John's order"
              placeholderTextColor={colors.textMuted}
              value={holdName}
              onChangeText={setHoldName}
              maxLength={50}
              accessibilityLabel="Order name"
              accessibilityHint="Give this order a name so you can find it later"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowHoldModal(false);
                  setHoldName('');
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel hold order"
              >
                <Text style={styles.modalCancelButtonText} maxFontSizeMultiplier={1.3}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmButton, isHolding && styles.modalConfirmButtonDisabled]}
                onPress={handleHoldOrder}
                disabled={isHolding}
                accessibilityRole="button"
                accessibilityLabel={isHolding ? 'Holding order' : 'Hold order'}
                accessibilityState={{ disabled: isHolding }}
              >
                {isHolding ? (
                  <ActivityIndicator color="#fff" size="small" accessibilityLabel="Holding order" />
                ) : (
                  <>
                    <Ionicons name="pause-circle" size={18} color="#fff" />
                    <Text style={styles.modalConfirmButtonText} maxFontSizeMultiplier={1.3}>Hold Order</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      </KeyboardAvoidingView>
      </View>
    </View>
  );
}

const createStyles = (colors: any, glassColors: typeof glass.dark, isDark: boolean) => {
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
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: glassColors.border,
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
      backgroundColor: glassColors.backgroundElevated,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: glassColors.border,
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
      backgroundColor: glassColors.backgroundElevated,
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
      borderBottomColor: glassColors.border,
      backgroundColor: glassColors.backgroundElevated,
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
      backgroundColor: glassColors.background,
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
      color: colors.textMuted,
    },
    quantityControls: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: glassColors.background,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: glassColors.border,
      marginRight: 10,
    },
    quantityButton: {
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quantityText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      minWidth: 20,
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
      borderTopColor: glassColors.border,
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
      borderTopColor: glassColors.border,
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
      paddingBottom: 32,
      gap: 10,
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
      backgroundColor: glassColors.backgroundElevated,
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
      backgroundColor: glassColors.background,
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
      color: '#fff',
    },
    tipButtonAmount: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 4,
    },
    tipButtonAmountSelected: {
      color: 'rgba(255, 255, 255, 0.8)',
    },
    // Custom tip styles
    customTipContainer: {
      marginTop: 10,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: glassColors.border,
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
      backgroundColor: glassColors.background,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: glassColors.border,
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
      backgroundColor: glassColors.backgroundElevated,
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
      backgroundColor: glassColors.background,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.text,
    },
    customerInfoNotesInput: {
      backgroundColor: glassColors.background,
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
      backgroundColor: glassColors.backgroundElevated,
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
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: glassColors.background,
    },
    paymentMethodButtonSelected: {
      backgroundColor: colors.primary,
    },
    paymentMethodButtonText: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.text,
    },
    paymentMethodButtonTextSelected: {
      color: '#fff',
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
      backgroundColor: glassColors.background,
      borderWidth: 1,
      borderColor: glassColors.border,
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
