import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Modal,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useTranslations } from '../lib/i18n';
import { transactionsApi, preordersApi } from '../lib/api';
import { formatCents, formatCurrency } from '../utils/currency';
import { fonts } from '../lib/fonts';

type RouteParams = {
  TransactionDetail: { id: string; sourceType?: 'order' | 'preorder' };
};

export function TransactionDetailScreen() {
  const { colors, isDark } = useTheme();
  const { currency } = useAuth();
  const t = useTranslations('transactions');
  const tc = useTranslations('common');
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RouteParams, 'TransactionDetail'>>();
  const queryClient = useQueryClient();

  const { id, sourceType } = route.params;

  const [showRefundModal, setShowRefundModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [resultMessage, setResultMessage] = useState({ title: '', message: '', isError: false });
  const [showReceiptInput, setShowReceiptInput] = useState(false);
  const [receiptEmail, setReceiptEmail] = useState('');
  const [sendingReceipt, setSendingReceipt] = useState(false);

  // Fetch order detail (default)
  const { data: transaction, isLoading: isLoadingTransaction } = useQuery({
    queryKey: ['transaction', id],
    queryFn: () => transactionsApi.get(id),
    enabled: sourceType !== 'preorder',
  });

  // Fetch preorder detail
  const { data: preorder, isLoading: isLoadingPreorder } = useQuery({
    queryKey: ['preorder', id],
    queryFn: () => preordersApi.get(id),
    enabled: sourceType === 'preorder',
  });

  const isLoading = sourceType === 'preorder' ? isLoadingPreorder : isLoadingTransaction;

  const refundMutation = useMutation({
    mutationFn: () => transactionsApi.refund(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transaction', id] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      if (sourceType === 'preorder') {
        queryClient.invalidateQueries({ queryKey: ['preorder', id] });
        queryClient.invalidateQueries({ queryKey: ['preorders'] });
      }
      setShowRefundModal(false);
      setResultMessage({ title: t('refundSuccessTitle'), message: t('refundSuccessMessage'), isError: false });
      setShowResultModal(true);
    },
    onError: (error: any) => {
      setShowRefundModal(false);
      setResultMessage({ title: t('refundErrorTitle'), message: error.message || t('refundErrorMessage'), isError: true });
      setShowResultModal(true);
    },
  });

  const handleRefund = () => {
    setShowRefundModal(true);
  };

  const confirmRefund = () => {
    refundMutation.mutate();
  };

  const handleViewReceipt = () => {
    if (transaction?.receiptUrl) {
      Linking.openURL(transaction.receiptUrl);
    }
  };

  const handleSendReceipt = async () => {
    const email = receiptEmail.trim() || transaction?.customerEmail;
    if (!email) {
      setShowReceiptInput(true);
      return;
    }

    setSendingReceipt(true);
    try {
      await transactionsApi.sendReceipt(id, email);
      setShowReceiptInput(false);
      setReceiptEmail('');
      setResultMessage({ title: t('receiptSentTitle'), message: t('receiptSentMessage', { email }), isError: false });
      setShowResultModal(true);
    } catch (error: any) {
      setResultMessage({ title: t('receiptErrorTitle'), message: error.message || t('receiptErrorMessage'), isError: true });
      setShowResultModal(true);
    } finally {
      setSendingReceipt(false);
    }
  };

  const styles = createStyles(colors);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'succeeded':
        return colors.success;
      case 'refunded':
      case 'partially_refunded':
        return colors.warning;
      case 'failed':
      case 'cancelled':
        return colors.error;
      default:
        return colors.textMuted;
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Preorder detail view
  if (sourceType === 'preorder') {
    if (!preorder) {
      return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.centered}>
            <Text maxFontSizeMultiplier={1.5} style={styles.errorText}>{t('detailPreorderNotFound')}</Text>
          </View>
        </View>
      );
    }

    const preorderStatusColor = preorder.status === 'picked_up' ? colors.success
      : preorder.status === 'cancelled' ? colors.error
      : colors.warning;
    const preorderStatusLabel = preorder.status === 'picked_up' ? t('detailPreorderCompleted')
      : preorder.status === 'cancelled' ? t('detailPreorderCancelled')
      : preorder.status.charAt(0).toUpperCase() + preorder.status.slice(1);

    return (
      <View style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={t('goBackAccessibilityLabel')}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.3} style={styles.headerTitle}>{t('detailHeaderPreorder')}</Text>
          <View style={{ width: 44 }} />
        </View>
        <ScrollView style={styles.content}>
          <View style={styles.amountCard}>
            <Text maxFontSizeMultiplier={1.5} style={styles.amountLabel}>{t('detailPreorderTotalLabel')}</Text>
            <Text maxFontSizeMultiplier={1.2} style={styles.amount}>{formatCurrency(preorder.totalAmount, currency)}</Text>
            <View style={[styles.statusBadge, { backgroundColor: preorderStatusColor + '20' }]}>
              <View style={[styles.statusDot, { backgroundColor: preorderStatusColor }]} />
              <Text maxFontSizeMultiplier={1.5} style={[styles.statusText, { color: preorderStatusColor }]}>{preorderStatusLabel}</Text>
            </View>
            {preorder.dailyNumber > 0 && (
              <View style={{ marginTop: 8, backgroundColor: '#a855f720', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 }}>
                <Text maxFontSizeMultiplier={1.5} style={{ fontSize: 14, fontFamily: fonts.semiBold, color: '#a855f7' }}>#{preorder.dailyNumber}</Text>
              </View>
            )}
          </View>
          <View style={styles.section}>
            <Text maxFontSizeMultiplier={1.5} style={styles.sectionTitle}>{t('detailSectionDetails')}</Text>
            <View style={styles.detailRow}>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelOrderNumber')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{preorder.orderNumber}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelCustomer')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{preorder.customerName}</Text>
            </View>
            {preorder.customerEmail && (
              <View style={styles.detailRow}>
                <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelEmail')}</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{preorder.customerEmail}</Text>
              </View>
            )}
            {preorder.customerPhone && (
              <View style={styles.detailRow}>
                <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelPhone')}</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{preorder.customerPhone}</Text>
              </View>
            )}
            <View style={styles.detailRow}>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelCatalog')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{preorder.catalogName}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelPayment')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{preorder.paymentType === 'pay_now' ? t('detailPaymentPaidOnline') : t('detailPaymentPayAtPickup')}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelPlaced')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{new Date(preorder.createdAt).toLocaleString()}</Text>
            </View>
            {preorder.pickedUpAt && (
              <View style={styles.detailRow}>
                <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelPickedUp')}</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{new Date(preorder.pickedUpAt).toLocaleString()}</Text>
              </View>
            )}
          </View>
          {preorder.items.length > 0 && (
            <View style={styles.section}>
              <Text maxFontSizeMultiplier={1.5} style={styles.sectionTitle}>{t('detailSectionItems')}</Text>
              {preorder.items.map((item) => (
                <View key={item.id} style={styles.detailRow}>
                  <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{item.quantity}x {item.name}</Text>
                  <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{formatCurrency(item.unitPrice * item.quantity, currency)}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.section}>
            <Text maxFontSizeMultiplier={1.5} style={styles.sectionTitle}>{t('detailSectionTotals')}</Text>
            <View style={styles.detailRow}>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelSubtotal')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{formatCurrency(preorder.subtotal, currency)}</Text>
            </View>
            {preorder.taxAmount > 0 && (
              <View style={styles.detailRow}>
                <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelTax')}</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{formatCurrency(preorder.taxAmount, currency)}</Text>
              </View>
            )}
            {preorder.tipAmount > 0 && (
              <View style={styles.detailRow}>
                <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelTip')}</Text>
                <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{formatCurrency(preorder.tipAmount, currency)}</Text>
              </View>
            )}
          </View>
          {preorder.orderNotes && (
            <View style={styles.section}>
              <Text maxFontSizeMultiplier={1.5} style={styles.sectionTitle}>{t('detailSectionNotes')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={[styles.detailValue, { textAlign: 'left', maxWidth: '100%' }]}>{preorder.orderNotes}</Text>
            </View>
          )}
          {/* Refund action for non-cancelled preorders */}
          {preorder.status !== 'cancelled' && (
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.actionButton, styles.refundButton]}
                onPress={handleRefund}
                disabled={refundMutation.isPending}
                accessibilityRole="button"
                accessibilityLabel={t('issueRefundAccessibilityLabel', { amount: formatCurrency(preorder.totalAmount, currency) })}
                accessibilityState={{ disabled: refundMutation.isPending }}
              >
                {refundMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.error} accessibilityLabel={t('processingRefund')} />
                ) : (
                  <>
                    <Ionicons name="arrow-undo-outline" size={20} color={colors.error} />
                    <Text maxFontSizeMultiplier={1.3} style={[styles.actionButtonText, { color: colors.error }]}>
                      {t('issueRefund')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
        {/* Refund Confirmation Modal */}
        <Modal
          visible={showRefundModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowRefundModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalIconContainer}>
                <Ionicons name="arrow-undo" size={32} color={colors.error} />
              </View>
              <Text maxFontSizeMultiplier={1.3} style={styles.modalTitle}>{t('refundModalTitle')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.modalMessage}>
                {t('refundModalMessagePreorder', { amount: formatCurrency(preorder.totalAmount, currency) })}
              </Text>
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonCancel]}
                  onPress={() => setShowRefundModal(false)}
                  disabled={refundMutation.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={t('refundModalCancel')}
                >
                  <Text maxFontSizeMultiplier={1.3} style={styles.modalButtonCancelText}>{t('refundModalCancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonDestructive]}
                  onPress={confirmRefund}
                  disabled={refundMutation.isPending}
                  accessibilityRole="button"
                  accessibilityLabel={t('refundModalConfirm')}
                  accessibilityState={{ disabled: refundMutation.isPending }}
                >
                  {refundMutation.isPending ? (
                    <ActivityIndicator size="small" color="#fff" accessibilityLabel={t('processingRefund')} />
                  ) : (
                    <Text maxFontSizeMultiplier={1.3} style={styles.modalButtonDestructiveText}>{t('refundModalConfirm')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        {/* Result Modal */}
        <Modal
          visible={showResultModal}
          transparent
          animationType="fade"
          onRequestClose={() => { setShowResultModal(false); navigation.goBack(); }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={[styles.modalIconContainer, { backgroundColor: resultMessage.isError ? colors.errorBg : colors.successBg }]}>
                <Ionicons
                  name={resultMessage.isError ? 'close-circle' : 'checkmark-circle'}
                  size={32}
                  color={resultMessage.isError ? colors.error : colors.success}
                />
              </View>
              <Text maxFontSizeMultiplier={1.3} style={styles.modalTitle}>{resultMessage.title}</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.modalMessage}>{resultMessage.message}</Text>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonPrimary, { marginTop: 20, flex: 0, width: '100%' }]}
                onPress={() => { setShowResultModal(false); navigation.goBack(); }}
                accessibilityRole="button"
                accessibilityLabel={tc('ok')}
              >
                <Text maxFontSizeMultiplier={1.3} style={styles.modalButtonPrimaryText}>{tc('ok')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
      </View>
    );
  }

  // Default: Order detail view
  if (!transaction) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.centered}>
          <Text maxFontSizeMultiplier={1.5} style={styles.errorText}>{t('detailTransactionNotFound')}</Text>
        </View>
      </View>
    );
  }

  const canRefund =
    transaction.status === 'succeeded' && transaction.amountRefunded === 0;

  return (
    <View style={{ flex: 1 }}>
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('goBackAccessibilityLabel')}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text maxFontSizeMultiplier={1.3} style={styles.headerTitle}>{t('detailHeaderTransaction')}</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView style={styles.content}>
        {/* Amount Card */}
        <View style={styles.amountCard}>
          <Text maxFontSizeMultiplier={1.5} style={styles.amountLabel}>{t('detailAmountLabel')}</Text>
          <Text maxFontSizeMultiplier={1.2} style={styles.amount}>
            {formatCents(transaction.amount, currency)}
          </Text>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: getStatusColor(transaction.status) + '20' },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                { backgroundColor: getStatusColor(transaction.status) },
              ]}
            />
            <Text
              maxFontSizeMultiplier={1.5}
              style={[styles.statusText, { color: getStatusColor(transaction.status) }]}
            >
              {transaction.status.charAt(0).toUpperCase() +
                transaction.status.slice(1).replace('_', ' ')}
            </Text>
          </View>
        </View>

        {/* Details Section */}
        <View style={styles.section}>
          <Text maxFontSizeMultiplier={1.5} style={styles.sectionTitle}>{t('detailSectionDetails')}</Text>

          <View style={styles.detailRow}>
            <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelDate')}</Text>
            <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{formatDate(transaction.created)}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelTransactionId')}</Text>
            <Text maxFontSizeMultiplier={1.5} style={styles.detailValue} numberOfLines={1}>
              {transaction.id}
            </Text>
          </View>

          {transaction.description && (
            <View style={styles.detailRow}>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelDescription')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{transaction.description}</Text>
            </View>
          )}

          {transaction.paymentMethod && (
            <View style={styles.detailRow}>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelPaymentMethod')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>
                {transaction.paymentMethod.type === 'cash'
                  ? t('paymentMethodCash')
                  : transaction.paymentMethod.type === 'split'
                  ? t('paymentMethodSplitPayment')
                  : transaction.paymentMethod.brand && transaction.paymentMethod.last4
                  ? t('paymentMethodCardBrandLast4', { brand: transaction.paymentMethod.brand.toUpperCase(), last4: transaction.paymentMethod.last4 })
                  : transaction.paymentMethod.last4
                  ? t('paymentMethodCardLast4', { last4: transaction.paymentMethod.last4 })
                  : t('paymentMethodCard')}
              </Text>
            </View>
          )}

          {transaction.cashTendered != null && transaction.cashTendered > 0 && (
            <View style={styles.detailRow}>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelCashTendered')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{formatCents(transaction.cashTendered, currency)}</Text>
            </View>
          )}

          {transaction.cashChange != null && transaction.cashChange > 0 && (
            <View style={styles.detailRow}>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelChangeGiven')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{formatCents(transaction.cashChange, currency)}</Text>
            </View>
          )}

          {transaction.customerEmail && (
            <View style={styles.detailRow}>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelCustomerEmail')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailValue}>{transaction.customerEmail}</Text>
            </View>
          )}

          {transaction.amountRefunded > 0 && (
            <View style={styles.detailRow}>
              <Text maxFontSizeMultiplier={1.5} style={styles.detailLabel}>{t('detailLabelAmountRefunded')}</Text>
              <Text maxFontSizeMultiplier={1.5} style={[styles.detailValue, { color: colors.warning }]}>
                {formatCents(transaction.amountRefunded, currency)}
              </Text>
            </View>
          )}
        </View>

        {/* Payment Breakdown (for split payments) */}
        {transaction.orderPayments && transaction.orderPayments.length > 1 && (
          <View style={styles.section}>
            <Text maxFontSizeMultiplier={1.5} style={styles.sectionTitle}>{t('detailSectionPaymentBreakdown')}</Text>
            {transaction.orderPayments.map((payment) => (
              <View key={payment.id} style={styles.paymentBreakdownItem}>
                <View style={styles.paymentBreakdownLeft}>
                  <Ionicons
                    name={
                      payment.paymentMethod === 'cash'
                        ? 'cash-outline'
                        : payment.paymentMethod === 'tap_to_pay'
                        ? 'phone-portrait-outline'
                        : 'card-outline'
                    }
                    size={18}
                    color={colors.textSecondary}
                  />
                  <Text maxFontSizeMultiplier={1.5} style={styles.paymentBreakdownMethod}>
                    {payment.paymentMethod === 'cash'
                      ? t('detailPaymentBreakdownCash')
                      : payment.paymentMethod === 'tap_to_pay'
                      ? t('detailPaymentBreakdownTapToPay')
                      : t('detailPaymentBreakdownCard')}
                  </Text>
                </View>
                <Text maxFontSizeMultiplier={1.5} style={styles.paymentBreakdownAmount}>
                  {formatCents(payment.amount, currency)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Refunds Section */}
        {transaction.refunds && transaction.refunds.length > 0 && (
          <View style={styles.section}>
            <Text maxFontSizeMultiplier={1.5} style={styles.sectionTitle}>{t('detailSectionRefundHistory')}</Text>
            {transaction.refunds.map((refund) => (
              <View key={refund.id} style={styles.refundItem}>
                <View>
                  <Text maxFontSizeMultiplier={1.5} style={styles.refundAmount}>
                    -{formatCents(refund.amount, currency)}
                  </Text>
                  <Text maxFontSizeMultiplier={1.5} style={styles.refundDate}>
                    {formatDate(refund.created)}
                  </Text>
                </View>
                <Text
                  maxFontSizeMultiplier={1.5}
                  style={[
                    styles.refundStatus,
                    { color: refund.status === 'succeeded' ? colors.success : colors.warning },
                  ]}
                >
                  {refund.status}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          {transaction.receiptUrl && (
            <TouchableOpacity style={styles.actionButton} onPress={handleViewReceipt} accessibilityRole="link" accessibilityLabel={t('viewReceipt')} accessibilityHint={t('viewReceiptAccessibilityHint')}>
              <Ionicons name="receipt-outline" size={20} color={colors.text} />
              <Text maxFontSizeMultiplier={1.3} style={styles.actionButtonText}>{t('viewReceipt')}</Text>
            </TouchableOpacity>
          )}

          {transaction.status === 'succeeded' && (
            <>
              {showReceiptInput ? (
                <View style={styles.receiptInputContainer}>
                  <TextInput
                    style={styles.receiptEmailInput}
                    value={receiptEmail}
                    onChangeText={setReceiptEmail}
                    placeholder={t('emailPlaceholder')}
                    placeholderTextColor={colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel={t('emailAccessibilityLabel')}
                  />
                  <TouchableOpacity
                    style={styles.sendReceiptConfirmButton}
                    onPress={handleSendReceipt}
                    disabled={sendingReceipt || !receiptEmail.trim()}
                    accessibilityRole="button"
                    accessibilityLabel={t('sendReceiptAccessibilityLabel')}
                    accessibilityState={{ disabled: sendingReceipt || !receiptEmail.trim() }}
                  >
                    {sendingReceipt ? (
                      <ActivityIndicator size="small" color="#fff" accessibilityLabel={t('sendingReceipt')} />
                    ) : (
                      <Ionicons name="send" size={18} color="#fff" />
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.actionButton} onPress={handleSendReceipt} accessibilityRole="button" accessibilityLabel={t('sendReceiptAccessibilityLabel')}>
                  <Ionicons name="mail-outline" size={20} color={colors.text} />
                  <Text maxFontSizeMultiplier={1.3} style={styles.actionButtonText}>{t('sendReceipt')}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {canRefund && (
            <TouchableOpacity
              style={[styles.actionButton, styles.refundButton]}
              onPress={handleRefund}
              disabled={refundMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel={t('issueRefundAccessibilityLabel', { amount: formatCents(transaction.amount, currency) })}
              accessibilityState={{ disabled: refundMutation.isPending }}
            >
              {refundMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.error} accessibilityLabel={t('processingRefund')} />
              ) : (
                <>
                  <Ionicons name="arrow-undo-outline" size={20} color={colors.error} />
                  <Text maxFontSizeMultiplier={1.3} style={[styles.actionButtonText, { color: colors.error }]}>
                    {t('issueRefund')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* Refund Confirmation Modal */}
      <Modal
        visible={showRefundModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRefundModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalIconContainer}>
              <Ionicons name="arrow-undo" size={32} color={colors.error} />
            </View>
            <Text maxFontSizeMultiplier={1.3} style={styles.modalTitle}>{t('refundModalTitle')}</Text>
            <Text maxFontSizeMultiplier={1.5} style={styles.modalMessage}>
              {t('refundModalMessageTransaction')}
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => setShowRefundModal(false)}
                disabled={refundMutation.isPending}
                accessibilityRole="button"
                accessibilityLabel={t('refundModalCancel')}
              >
                <Text maxFontSizeMultiplier={1.3} style={styles.modalButtonCancelText}>{t('refundModalCancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonDestructive]}
                onPress={confirmRefund}
                disabled={refundMutation.isPending}
                accessibilityRole="button"
                accessibilityLabel={t('refundModalConfirm')}
                accessibilityState={{ disabled: refundMutation.isPending }}
              >
                {refundMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" accessibilityLabel={t('processingRefund')} />
                ) : (
                  <Text maxFontSizeMultiplier={1.3} style={styles.modalButtonDestructiveText}>{t('refundModalConfirm')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Result Modal */}
      <Modal
        visible={showResultModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowResultModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={[styles.modalIconContainer, { backgroundColor: resultMessage.isError ? colors.errorBg : colors.successBg }]}>
              <Ionicons
                name={resultMessage.isError ? 'close-circle' : 'checkmark-circle'}
                size={32}
                color={resultMessage.isError ? colors.error : colors.success}
              />
            </View>
            <Text maxFontSizeMultiplier={1.3} style={styles.modalTitle}>{resultMessage.title}</Text>
            <Text maxFontSizeMultiplier={1.5} style={styles.modalMessage}>{resultMessage.message}</Text>
            <TouchableOpacity
              style={[styles.modalButton, styles.modalButtonPrimary, { marginTop: 20, flex: 0, width: '100%' }]}
              onPress={() => setShowResultModal(false)}
              accessibilityRole="button"
              accessibilityLabel={tc('ok')}
            >
              <Text maxFontSizeMultiplier={1.3} style={styles.modalButtonPrimaryText}>{tc('ok')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
    </View>
  );
}

const createStyles = (colors: any) => {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 56,
      paddingHorizontal: 16,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
    },
    backButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerTitle: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    content: {
      flex: 1,
    },
    amountCard: {
      alignItems: 'center',
      paddingVertical: 32,
      paddingHorizontal: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    amountLabel: {
      fontSize: 14,
      color: colors.textSecondary,
      marginBottom: 8,
    },
    amount: {
      fontSize: 48,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 16,
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginRight: 6,
    },
    statusText: {
      fontSize: 14,
      fontWeight: '500',
    },
    section: {
      padding: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 16,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
    },
    detailLabel: {
      fontSize: 15,
      color: colors.textSecondary,
    },
    detailValue: {
      fontSize: 15,
      color: colors.text,
      fontWeight: '500',
      maxWidth: '60%',
      textAlign: 'right',
    },
    refundItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
    },
    refundAmount: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.warning,
    },
    refundDate: {
      fontSize: 13,
      color: colors.textMuted,
      marginTop: 2,
    },
    refundStatus: {
      fontSize: 13,
      fontWeight: '500',
    },
    actions: {
      padding: 20,
      gap: 12,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      paddingVertical: 14,
      borderRadius: 12,
      gap: 8,
    },
    actionButtonText: {
      fontSize: 16,
      fontWeight: '500',
      color: colors.text,
    },
    refundButton: {
      backgroundColor: colors.errorBg,
    },
    receiptInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    receiptEmailInput: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 16,
      color: colors.text,
    },
    paymentBreakdownItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    paymentBreakdownLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    paymentBreakdownMethod: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: colors.text,
    },
    paymentBreakdownAmount: {
      fontSize: 15,
      fontFamily: fonts.semiBold,
      color: colors.text,
    },
    sendReceiptConfirmButton: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      padding: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    errorText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    modalContent: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 24,
      width: '100%',
      maxWidth: 340,
      alignItems: 'center',
    },
    modalIconContainer: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.errorBg,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    modalMessage: {
      fontSize: 15,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
    },
    modalButtons: {
      flexDirection: 'row',
      marginTop: 24,
      gap: 12,
      width: '100%',
    },
    modalButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 12,
      gap: 8,
    },
    modalButtonCancel: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    modalButtonCancelText: {
      fontSize: 16,
      fontWeight: '500',
      color: colors.text,
    },
    modalButtonDestructive: {
      backgroundColor: colors.errorBg,
    },
    modalButtonDestructiveText: {
      fontSize: 16,
      fontWeight: '500',
      color: colors.error,
    },
    modalButtonPrimary: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    modalButtonPrimaryText: {
      fontSize: 16,
      fontFamily: fonts.medium,
      color: colors.text,
    },
  });
};
