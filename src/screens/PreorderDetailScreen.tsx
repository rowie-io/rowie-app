import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useSocketEvent, useSocket, SocketEvents } from '../context/SocketContext';
import { preordersApi, Preorder, PreorderStatus } from '../lib/api/preorders';
import { stripeTerminalApi } from '../lib/api/stripe-terminal';
import { usePreorders } from '../context/PreordersContext';
import { formatCurrency, toSmallestUnit } from '../utils/currency';
import { glass } from '../lib/colors';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';

interface RouteParams {
  preorderId: string;
}

const STATUS_FLOW: PreorderStatus[] = ['pending', 'preparing', 'ready', 'picked_up'];

function getStatusColor(status: PreorderStatus, colors: any): string {
  switch (status) {
    case 'pending':
      return colors.warning;
    case 'preparing':
      return '#8B5CF6'; // Purple
    case 'ready':
      return colors.success;
    case 'picked_up':
      return colors.textMuted;
    case 'cancelled':
      return colors.error;
    default:
      return colors.textSecondary;
  }
}

function getStatusLabel(status: PreorderStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'preparing':
      return 'Preparing';
    case 'ready':
      return 'Ready for Pickup';
    case 'picked_up':
      return 'Picked Up';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

function getNextAction(status: PreorderStatus): { label: string; nextStatus: PreorderStatus } | null {
  switch (status) {
    case 'pending':
      return { label: 'Start Preparing', nextStatus: 'preparing' };
    case 'preparing':
      return { label: 'Mark as Ready', nextStatus: 'ready' };
    case 'ready':
      return { label: 'Complete Pickup', nextStatus: 'picked_up' };
    default:
      return null;
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function PreorderDetailScreen() {
  const { colors, isDark } = useTheme();
  const { currency } = useAuth();
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { preorderId } = route.params as RouteParams;
  const { isConnected } = useSocket();
  const { refreshCounts } = usePreorders();
  const glassColors = isDark ? glass.dark : glass.light;
  const insets = useSafeAreaInsets();

  const [preorder, setPreorder] = useState<Preorder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const wasConnectedRef = useRef(isConnected);
  const hasEverConnectedRef = useRef(false);

  const styles = createStyles(colors, glassColors, isDark);

  const fetchPreorder = useCallback(async () => {
    try {
      const data = await preordersApi.get(preorderId);
      setPreorder(data);
    } catch (error) {
      Alert.alert('Error', 'Failed to load order details');
    } finally {
      setIsLoading(false);
    }
  }, [preorderId]);

  useFocusEffect(
    useCallback(() => {
      fetchPreorder();
    }, [fetchPreorder])
  );

  // Refetch when socket REconnects (not initial connection)
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current && hasEverConnectedRef.current) {
      fetchPreorder();
    }
    if (isConnected) hasEverConnectedRef.current = true;
    wasConnectedRef.current = isConnected;
  }, [isConnected, fetchPreorder]);

  // Listen for updates to this preorder
  const handlePreorderUpdated = useCallback((data: any) => {
    if (data.preorderId === preorderId) {
      fetchPreorder();
    }
  }, [preorderId, fetchPreorder]);

  useSocketEvent(SocketEvents.PREORDER_UPDATED, handlePreorderUpdated);

  const handleUpdateStatus = async (newStatus: PreorderStatus) => {
    if (!preorder || isUpdating) return;

    setIsUpdating(true);
    try {
      const updated = await preordersApi.updateStatus(preorder.id, newStatus);
      setPreorder(updated);
      refreshCounts();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update order status');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCompletePickup = async () => {
    if (!preorder || isUpdating) return;

    // For pay_at_pickup orders, we need to process payment first
    if (preorder.paymentType === 'pay_at_pickup') {
      Alert.alert(
        'Process Payment',
        `The customer needs to pay ${formatCurrency(preorder.totalAmount || 0, currency)}. Proceed with Tap to Pay?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Process Payment',
            onPress: async () => {
              try {
                setIsUpdating(true);

                // Create payment intent for the preorder amount (amount in dollars for API)
                const paymentIntent = await stripeTerminalApi.createPaymentIntent({
                  amount: preorder.totalAmount,
                  description: `Preorder #${preorder.dailyNumber}`,
                  metadata: {
                    preorderId: preorder.id,
                    orderNumber: preorder.orderNumber,
                    dailyNumber: String(preorder.dailyNumber),
                  },
                  receiptEmail: preorder.customerEmail,
                });

                // Navigate to payment processing screen
                // amount must be in cents for consistency with CheckoutScreen flow
                navigation.navigate('PaymentProcessing', {
                  paymentIntentId: paymentIntent.id,
                  clientSecret: paymentIntent.clientSecret,
                  stripeAccountId: paymentIntent.stripeAccountId,
                  amount: toSmallestUnit(preorder.totalAmount, currency),
                  customerEmail: preorder.customerEmail,
                  preorderId: preorder.id,
                });

                // The payment result will come back via navigation
                // We'll handle completion in useFocusEffect
                setIsUpdating(false);
              } catch (error: any) {
                setIsUpdating(false);
                Alert.alert('Error', error.message || 'Failed to create payment');
              }
            },
          },
        ]
      );
    } else {
      // For pay_now orders, just mark as complete
      setIsUpdating(true);
      try {
        const updated = await preordersApi.complete(preorder.id);
        setPreorder(updated);
        refreshCounts();
        Alert.alert('Success', 'Order marked as picked up!');
      } catch (error: any) {
        Alert.alert('Error', error.message || 'Failed to complete order');
      } finally {
        setIsUpdating(false);
      }
    }
  };

  const handleCancel = () => {
    if (!preorder || isCancelling) return;

    const isPaid = preorder.paymentType === 'pay_now' && preorder.stripePaymentIntentId;
    const formattedTotal = formatCurrency(preorder.totalAmount || 0, currency);
    Alert.alert(
      isPaid ? 'Cancel & Refund Order' : 'Cancel Order',
      isPaid
        ? `A refund of ${formattedTotal} will be issued to the customer's original payment method. This cannot be undone.`
        : 'Are you sure you want to cancel this order? No payment was collected.',
      [
        { text: 'Keep Order', style: 'cancel' },
        {
          text: isPaid ? 'Cancel & Refund' : 'Cancel Order',
          style: 'destructive',
          onPress: async () => {
            setIsCancelling(true);
            try {
              await preordersApi.cancel(preorder.id);
              refreshCounts();
              Alert.alert(
                isPaid ? 'Cancelled & Refunded' : 'Cancelled',
                isPaid
                  ? `Order cancelled. ${formattedTotal} refund issued to the customer.`
                  : 'Order has been cancelled.'
              );
              navigation.goBack();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to cancel order');
            } finally {
              setIsCancelling(false);
            }
          },
        },
      ]
    );
  };

  const handleCallCustomer = () => {
    if (preorder?.customerPhone) {
      Linking.openURL(`tel:${preorder.customerPhone}`);
    }
  };

  const handleEmailCustomer = () => {
    if (preorder?.customerEmail) {
      Linking.openURL(`mailto:${preorder.customerEmail}`);
    }
  };

  if (isLoading || !preorder) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>Order Details</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Loading order details" />
        </View>
      </SafeAreaView>
    );
  }

  const nextAction = getNextAction(preorder.status);
  const statusColor = getStatusColor(preorder.status, colors);
  const isComplete = preorder.status === 'picked_up' || preorder.status === 'cancelled';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>Order #{preorder.dailyNumber || '—'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + insets.bottom }]}>
        {/* Status Card */}
        <View style={styles.card}>
          <View style={styles.statusHeader}>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]} maxFontSizeMultiplier={1.5}>
                {getStatusLabel(preorder.status)}
              </Text>
            </View>
            {preorder.paymentType === 'pay_now' && (
              <View style={styles.paidBadge}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={styles.paidText} maxFontSizeMultiplier={1.5}>Paid Online</Text>
              </View>
            )}
            {preorder.paymentType === 'pay_at_pickup' && preorder.status !== 'picked_up' && (
              <View style={styles.unpaidBadge}>
                <Ionicons name="card-outline" size={16} color={colors.warning} />
                <Text style={styles.unpaidText} maxFontSizeMultiplier={1.5}>Pay at Pickup</Text>
              </View>
            )}
          </View>

          {/* Status Timeline */}
          <View style={styles.timeline}>
            {STATUS_FLOW.slice(0, -1).map((status, index) => {
              const currentIndex = STATUS_FLOW.indexOf(preorder.status);
              const isCompleted = index < currentIndex;
              const isCurrent = status === preorder.status;
              const dotColor = isCompleted || isCurrent ? colors.primary : colors.textMuted;

              return (
                <View key={status} style={styles.timelineItem}>
                  <View style={[styles.timelineDot, { backgroundColor: dotColor }]}>
                    {isCompleted && <Ionicons name="checkmark" size={12} color="#fff" />}
                  </View>
                  {index < STATUS_FLOW.length - 2 && (
                    <View style={[styles.timelineLine, isCompleted && { backgroundColor: colors.primary }]} />
                  )}
                  <Text style={[styles.timelineLabel, (isCompleted || isCurrent) && { color: colors.text }]} maxFontSizeMultiplier={1.5}>
                    {getStatusLabel(status)}
                  </Text>
                </View>
              );
            })}
          </View>

          <Text style={styles.orderDate} maxFontSizeMultiplier={1.5}>Ordered {preorder.createdAt ? formatDate(preorder.createdAt) : '—'}</Text>
        </View>

        {/* Customer Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle} maxFontSizeMultiplier={1.5}>Customer</Text>
          <View style={styles.customerInfo}>
            <Text style={styles.customerName} maxFontSizeMultiplier={1.3}>{preorder.customerName || 'Unknown Customer'}</Text>
            <Text style={styles.customerEmail} maxFontSizeMultiplier={1.5}>{preorder.customerEmail || 'No email'}</Text>
            {preorder.customerPhone && (
              <Text style={styles.customerPhone} maxFontSizeMultiplier={1.5}>{preorder.customerPhone}</Text>
            )}
          </View>
          <View style={styles.customerActions}>
            {preorder.customerPhone && (
              <TouchableOpacity style={styles.customerAction} onPress={handleCallCustomer} accessibilityRole="button" accessibilityLabel={`Call ${preorder.customerName || 'customer'}`}>
                <Ionicons name="call-outline" size={20} color={colors.primary} />
                <Text style={styles.customerActionText} maxFontSizeMultiplier={1.3}>Call</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.customerAction} onPress={handleEmailCustomer} accessibilityRole="button" accessibilityLabel={`Email ${preorder.customerName || 'customer'}`}>
              <Ionicons name="mail-outline" size={20} color={colors.primary} />
              <Text style={styles.customerActionText} maxFontSizeMultiplier={1.3}>Email</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Items Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle} maxFontSizeMultiplier={1.5}>Items</Text>
          {(preorder.items || []).map((item, index) => (
            <View key={item.id} style={[styles.itemRow, index > 0 && styles.itemRowBorder]}>
              <View style={styles.itemInfo}>
                <View style={styles.itemHeader}>
                  <Text style={styles.itemQuantity} maxFontSizeMultiplier={1.5}>{item.quantity}x</Text>
                  <Text style={styles.itemName} maxFontSizeMultiplier={1.5}>{item.name}</Text>
                </View>
                {item.notes && (
                  <Text style={styles.itemNotes} maxFontSizeMultiplier={1.5}>{item.notes}</Text>
                )}
              </View>
              <Text style={styles.itemPrice} maxFontSizeMultiplier={1.5}>
                {formatCurrency((item.unitPrice || 0) * (item.quantity || 0), currency)}
              </Text>
            </View>
          ))}

          {/* Order Notes */}
          {preorder.orderNotes && (
            <View style={styles.orderNotesSection}>
              <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.orderNotesText} maxFontSizeMultiplier={1.5}>{preorder.orderNotes}</Text>
            </View>
          )}
        </View>

        {/* Totals Card */}
        <View style={styles.card}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel} maxFontSizeMultiplier={1.5}>Subtotal</Text>
            <Text style={styles.totalValue} maxFontSizeMultiplier={1.5}>{formatCurrency(preorder.subtotal || 0, currency)}</Text>
          </View>
          {(preorder.taxAmount || 0) > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel} maxFontSizeMultiplier={1.5}>Tax</Text>
              <Text style={styles.totalValue} maxFontSizeMultiplier={1.5}>{formatCurrency(preorder.taxAmount || 0, currency)}</Text>
            </View>
          )}
          {(preorder.tipAmount || 0) > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel} maxFontSizeMultiplier={1.5}>Tip</Text>
              <Text style={styles.totalValue} maxFontSizeMultiplier={1.5}>{formatCurrency(preorder.tipAmount || 0, currency)}</Text>
            </View>
          )}
          <View style={[styles.totalRow, styles.totalRowFinal]}>
            <Text style={styles.totalLabelFinal} maxFontSizeMultiplier={1.3}>Total</Text>
            <Text style={styles.totalValueFinal} maxFontSizeMultiplier={1.3}>{formatCurrency(preorder.totalAmount || 0, currency)}</Text>
          </View>
        </View>

        {/* Cancel Button */}
        {!isComplete && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            disabled={isCancelling}
            accessibilityRole="button"
            accessibilityLabel="Cancel Order"
            accessibilityState={{ disabled: isCancelling }}
          >
            {isCancelling ? (
              <ActivityIndicator size="small" color={colors.error} accessibilityLabel="Cancelling order" />
            ) : (
              <>
                <Ionicons name="close-circle-outline" size={20} color={colors.error} />
                <Text style={styles.cancelButtonText} maxFontSizeMultiplier={1.3}>Cancel Order</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Action Button */}
      {nextAction && !isComplete && (
        <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
          <TouchableOpacity
            style={[styles.actionButton, isUpdating && styles.actionButtonDisabled]}
            onPress={() => {
              if (nextAction.nextStatus === 'picked_up') {
                handleCompletePickup();
              } else {
                handleUpdateStatus(nextAction.nextStatus);
              }
            }}
            disabled={isUpdating}
            accessibilityRole="button"
            accessibilityLabel={nextAction.label}
            accessibilityState={{ disabled: isUpdating }}
          >
            {isUpdating ? (
              <ActivityIndicator size="small" color="#fff" accessibilityLabel="Updating order status" />
            ) : (
              <>
                <Text style={styles.actionButtonText} maxFontSizeMultiplier={1.3}>{nextAction.label}</Text>
                {preorder.status === 'ready' && preorder.paymentType === 'pay_at_pickup' && (
                  <Text style={styles.actionButtonSubtext} maxFontSizeMultiplier={1.3}>
                    Collect {formatCurrency(preorder.totalAmount || 0, currency)} via Tap to Pay
                  </Text>
                )}
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
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
      borderBottomWidth: 1,
      borderBottomColor: glassColors.border,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: glassColors.backgroundElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: 16,
    },
    card: {
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: glassColors.border,
      marginBottom: 16,
      ...shadows.sm,
    },
    cardTitle: {
      fontSize: 14,
      fontFamily: fonts.semiBold,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 12,
    },
    statusHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 16,
      gap: 6,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    statusText: {
      fontSize: 14,
      fontFamily: fonts.semiBold,
    },
    paidBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    paidText: {
      fontSize: 13,
      fontFamily: fonts.semiBold,
      color: colors.success,
    },
    unpaidBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    unpaidText: {
      fontSize: 13,
      fontFamily: fonts.semiBold,
      color: colors.warning,
    },
    timeline: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    timelineItem: {
      alignItems: 'center',
      flex: 1,
    },
    timelineDot: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.textMuted,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 6,
    },
    timelineLine: {
      position: 'absolute',
      top: 12,
      left: '60%',
      right: '-40%',
      height: 2,
      backgroundColor: colors.textMuted + '40',
    },
    timelineLabel: {
      fontSize: 11,
      fontFamily: fonts.medium,
      color: colors.textMuted,
      textAlign: 'center',
    },
    orderDate: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    customerInfo: {
      marginBottom: 12,
    },
    customerName: {
      fontSize: 17,
      fontFamily: fonts.semiBold,
      color: colors.text,
      marginBottom: 4,
    },
    customerEmail: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      marginBottom: 2,
    },
    customerPhone: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
    },
    customerActions: {
      flexDirection: 'row',
      gap: 12,
    },
    customerAction: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 16,
      backgroundColor: colors.primary + '15',
      borderRadius: 8,
      gap: 6,
    },
    customerActionText: {
      fontSize: 14,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    itemRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingVertical: 12,
    },
    itemRowBorder: {
      borderTopWidth: 1,
      borderTopColor: glassColors.borderSubtle,
    },
    itemInfo: {
      flex: 1,
      marginRight: 16,
    },
    itemHeader: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
    },
    itemQuantity: {
      fontSize: 15,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    itemName: {
      fontSize: 16,
      fontFamily: fonts.medium,
      color: colors.text,
      flex: 1,
    },
    itemNotes: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      marginTop: 4,
      fontStyle: 'italic',
    },
    itemPrice: {
      fontSize: 15,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    orderNotesSection: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingTop: 12,
      marginTop: 12,
      borderTopWidth: 1,
      borderTopColor: glassColors.borderSubtle,
      gap: 8,
    },
    orderNotesText: {
      flex: 1,
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      fontStyle: 'italic',
    },
    totalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 6,
    },
    totalRowFinal: {
      paddingTop: 12,
      marginTop: 8,
      borderTopWidth: 1,
      borderTopColor: glassColors.border,
    },
    totalLabel: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
    },
    totalValue: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: colors.text,
    },
    totalLabelFinal: {
      fontSize: 17,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    totalValueFinal: {
      fontSize: 20,
      fontFamily: fonts.bold,
      color: colors.text,
    },
    cancelButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.error + '30',
      backgroundColor: colors.error + '10',
      gap: 8,
    },
    cancelButtonText: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.error,
    },
    footer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      padding: 16,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: glassColors.border,
    },
    actionButton: {
      backgroundColor: colors.primary,
      paddingVertical: 16,
      borderRadius: 12,
      alignItems: 'center',
    },
    actionButtonDisabled: {
      opacity: 0.6,
    },
    actionButtonText: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: '#fff',
    },
    actionButtonSubtext: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: 'rgba(255,255,255,0.8)',
      marginTop: 2,
    },
  });
