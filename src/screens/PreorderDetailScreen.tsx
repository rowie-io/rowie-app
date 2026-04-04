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
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { useTranslations } from '../lib/i18n';

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

function getStatusLabel(status: PreorderStatus, t: (key: string) => string): string {
  switch (status) {
    case 'pending':
      return t('statusPending');
    case 'preparing':
      return t('statusPreparing');
    case 'ready':
      return t('statusReadyForPickup');
    case 'picked_up':
      return t('statusPickedUp');
    case 'cancelled':
      return t('statusCancelled');
    default:
      return status;
  }
}

function getNextAction(status: PreorderStatus, t: (key: string, params?: Record<string, string>) => string): { label: string; nextStatus: PreorderStatus } | null {
  switch (status) {
    case 'pending':
      return { label: t('actionStartPreparing'), nextStatus: 'preparing' };
    case 'preparing':
      return { label: t('actionMarkAsReady'), nextStatus: 'ready' };
    case 'ready':
      return { label: t('actionCompletePickup'), nextStatus: 'picked_up' };
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
  const insets = useSafeAreaInsets();
  const t = useTranslations('preorders');
  const tc = useTranslations('common');

  const [preorder, setPreorder] = useState<Preorder | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const wasConnectedRef = useRef(isConnected);
  const hasEverConnectedRef = useRef(false);

  const styles = createStyles(colors, isDark);

  const fetchPreorder = useCallback(async () => {
    try {
      const data = await preordersApi.get(preorderId);
      setPreorder(data);
    } catch (error) {
      Alert.alert(t('errorAlertTitle'), t('errorLoadOrderDetails'));
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
      Alert.alert(t('errorAlertTitle'), error.message || t('errorUpdateStatusDefault'));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCompletePickup = async () => {
    if (!preorder || isUpdating) return;

    // For pay_at_pickup orders, we need to process payment first
    if (preorder.paymentType === 'pay_at_pickup') {
      Alert.alert(
        t('processPaymentTitle'),
        t('processPaymentMessage', { amount: formatCurrency(preorder.totalAmount || 0, currency) }),
        [
          { text: tc('cancel'), style: 'cancel' },
          {
            text: t('processPaymentConfirm'),
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
                Alert.alert(t('errorAlertTitle'), error.message || t('errorCreatePaymentDefault'));
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
        Alert.alert(t('successAlertTitle'), t('orderMarkedPickedUp'));
      } catch (error: any) {
        Alert.alert(t('errorAlertTitle'), error.message || t('errorCompleteOrderDefault'));
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
      isPaid ? t('cancelAndRefundTitle') : t('cancelOrderTitle'),
      isPaid
        ? t('cancelAndRefundMessage', { amount: formattedTotal })
        : t('cancelOrderMessage'),
      [
        { text: t('keepOrderButton'), style: 'cancel' },
        {
          text: isPaid ? t('cancelAndRefundButton') : t('cancelOrderButton'),
          style: 'destructive',
          onPress: async () => {
            setIsCancelling(true);
            try {
              await preordersApi.cancel(preorder.id);
              refreshCounts();
              Alert.alert(
                isPaid ? t('cancelledAndRefundedTitle') : t('cancelledTitle'),
                isPaid
                  ? t('cancelledAndRefundedMessage', { amount: formattedTotal })
                  : t('cancelledMessage')
              );
              navigation.goBack();
            } catch (error: any) {
              Alert.alert(t('errorAlertTitle'), error.message || t('errorCancelOrderDefault'));
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
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityRole="button" accessibilityLabel={t('goBackAccessibilityLabel')}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>{t('detailHeaderTitleLoading')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={tc('loading')} />
        </View>
      </SafeAreaView>
    );
  }

  const nextAction = getNextAction(preorder.status, t);
  const statusColor = getStatusColor(preorder.status, colors);
  const isComplete = preorder.status === 'picked_up' || preorder.status === 'cancelled';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityRole="button" accessibilityLabel={t('goBackAccessibilityLabel')}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>{t('detailHeaderTitle', { dailyNumber: String(preorder.dailyNumber || '—') })}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + insets.bottom }]}>
        {/* Status Card */}
        <View style={styles.card}>
          <View style={styles.statusHeader}>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]} maxFontSizeMultiplier={1.5}>
                {getStatusLabel(preorder.status, t)}
              </Text>
            </View>
            {preorder.paymentType === 'pay_now' && (
              <View style={styles.paidBadge}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={styles.paidText} maxFontSizeMultiplier={1.5}>{t('paidOnlineText')}</Text>
              </View>
            )}
            {preorder.paymentType === 'pay_at_pickup' && preorder.status !== 'picked_up' && (
              <View style={styles.unpaidBadge}>
                <Ionicons name="card-outline" size={16} color={colors.warning} />
                <Text style={styles.unpaidText} maxFontSizeMultiplier={1.5}>{t('payAtPickupBadgeText')}</Text>
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
                    {getStatusLabel(status, t)}
                  </Text>
                </View>
              );
            })}
          </View>

          <Text style={styles.orderDate} maxFontSizeMultiplier={1.5}>{t('orderedPrefix', { date: preorder.createdAt ? formatDate(preorder.createdAt) : '—' })}</Text>
        </View>

        {/* Customer Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle} maxFontSizeMultiplier={1.5}>{t('customerCardTitle')}</Text>
          <View style={styles.customerInfo}>
            <View style={styles.customerNameRow}>
              <Text style={styles.customerName} maxFontSizeMultiplier={1.3}>{preorder.customerName || t('unknownCustomerName')}</Text>
              {preorder.tableIdentifier && (
                <View style={styles.tableBadge}>
                  <Ionicons name="restaurant-outline" size={13} color={colors.textSecondary} />
                  <Text style={styles.tableBadgeText} maxFontSizeMultiplier={1.5}>{preorder.tableIdentifier}</Text>
                </View>
              )}
            </View>
            <Text style={styles.customerEmail} maxFontSizeMultiplier={1.5}>{preorder.customerEmail || t('noEmailText')}</Text>
            {preorder.customerPhone && (
              <Text style={styles.customerPhone} maxFontSizeMultiplier={1.5}>{preorder.customerPhone}</Text>
            )}
          </View>
          <View style={styles.customerActions}>
            {preorder.customerPhone && (
              <TouchableOpacity style={styles.customerAction} onPress={handleCallCustomer} accessibilityRole="button" accessibilityLabel={`${t('callButtonText')} ${preorder.customerName || t('customerFallbackName')}`}>
                <Ionicons name="call-outline" size={20} color={colors.primary} />
                <Text style={styles.customerActionText} maxFontSizeMultiplier={1.3}>{t('callButtonText')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.customerAction} onPress={handleEmailCustomer} accessibilityRole="button" accessibilityLabel={`${t('emailButtonText')} ${preorder.customerName || t('customerFallbackName')}`}>
              <Ionicons name="mail-outline" size={20} color={colors.primary} />
              <Text style={styles.customerActionText} maxFontSizeMultiplier={1.3}>{t('emailButtonText')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Items Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle} maxFontSizeMultiplier={1.5}>{t('itemsCardTitle')}</Text>
          {(preorder.items || []).map((item, index) => (
            <View key={item.id} style={[styles.itemRow, index > 0 && styles.itemRowBorder]}>
              <View style={styles.itemInfo}>
                <View style={styles.itemHeader}>
                  <Text style={styles.itemQuantity} maxFontSizeMultiplier={1.5}>{t('quantityPrefix', { quantity: String(item.quantity) })}</Text>
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
            <Text style={styles.totalLabel} maxFontSizeMultiplier={1.5}>{t('subtotalLabel')}</Text>
            <Text style={styles.totalValue} maxFontSizeMultiplier={1.5}>{formatCurrency(preorder.subtotal || 0, currency)}</Text>
          </View>
          {(preorder.taxAmount || 0) > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel} maxFontSizeMultiplier={1.5}>{t('taxLabel')}</Text>
              <Text style={styles.totalValue} maxFontSizeMultiplier={1.5}>{formatCurrency(preorder.taxAmount || 0, currency)}</Text>
            </View>
          )}
          {(preorder.tipAmount || 0) > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel} maxFontSizeMultiplier={1.5}>{t('tipLabel')}</Text>
              <Text style={styles.totalValue} maxFontSizeMultiplier={1.5}>{formatCurrency(preorder.tipAmount || 0, currency)}</Text>
            </View>
          )}
          <View style={[styles.totalRow, styles.totalRowFinal]}>
            <Text style={styles.totalLabelFinal} maxFontSizeMultiplier={1.3}>{t('totalLabel')}</Text>
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
            accessibilityLabel={t('cancelOrderButtonText')}
            accessibilityState={{ disabled: isCancelling }}
          >
            {isCancelling ? (
              <ActivityIndicator size="small" color={colors.error} accessibilityLabel={tc('loading')} />
            ) : (
              <>
                <Ionicons name="close-circle-outline" size={20} color={colors.error} />
                <Text style={styles.cancelButtonText} maxFontSizeMultiplier={1.3}>{t('cancelOrderButtonText')}</Text>
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
              <ActivityIndicator size="small" color="#fff" accessibilityLabel={tc('loading')} />
            ) : (
              <>
                <Text style={styles.actionButtonText} maxFontSizeMultiplier={1.3}>{nextAction.label}</Text>
                {preorder.status === 'ready' && preorder.paymentType === 'pay_at_pickup' && (
                  <Text style={styles.actionButtonSubtext} maxFontSizeMultiplier={1.3}>
                    {t('actionCollectViaTapToPay', { amount: formatCurrency(preorder.totalAmount || 0, currency) })}
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

const createStyles = (colors: any, isDark: boolean) =>
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
      borderBottomColor: colors.border,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
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
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
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
    customerNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    customerName: {
      fontSize: 17,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    tableBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.border,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
    },
    tableBadgeText: {
      fontSize: 12,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
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
      borderTopColor: colors.borderSubtle,
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
      borderTopColor: colors.borderSubtle,
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
      borderTopColor: colors.border,
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
      borderTopColor: colors.border,
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
