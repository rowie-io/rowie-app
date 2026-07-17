import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useTerminal } from '../context/StripeTerminalContext';
import { useSocketEvent, SocketEvents } from '../context/SocketContext';
import { useTapToPayGuard } from '../hooks/useTapToPayGuard';
import { bookingsApi, isBookingPaid, type Booking, type BookingStatus } from '../lib/api/bookings';
import { apiClient } from '../lib/api/client';
import { ConfirmModal } from '../components/ConfirmModal';
import { formatCurrency } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { useTranslations } from '../lib/i18n';
import logger from '../lib/logger';

type RouteParams = {
  BookingDetail: { bookingId: string };
};

// Targets the API accepts per current status (PATCH /bookings/{id}/status —
// see rowie-api bookings.ts validTransitions). 'seated' does not exist in the
// booking_status enum; confirmed bookings go straight to completed / no_show.
const STATUS_ACTIONS: Partial<Record<BookingStatus, BookingStatus[]>> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  partially_refunded: ['completed', 'no_show', 'cancelled'],
};

export function BookingDetailScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'BookingDetail'>>();
  const { bookingId } = route.params;
  const { currency, user } = useAuth();
  const { isProcessing: isTerminalProcessing } = useTerminal();
  const { guardCheckout } = useTapToPayGuard();
  const queryClient = useQueryClient();
  const t = useTranslations('bookings');

  const [isCreatingPI, setIsCreatingPI] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  // Which status button is in flight — drives the per-button spinner.
  const [pendingStatus, setPendingStatus] = useState<BookingStatus | null>(null);

  const bookingQuery = useQuery({
    queryKey: ['bookings', bookingId],
    queryFn: () => bookingsApi.get(bookingId),
  });

  const booking: Booking | undefined = bookingQuery.data?.booking;

  // Live-update if the webhook marks the booking paid while this screen is open.
  const handleBookingUpdated = useCallback(
    (data: any) => {
      if (data?.bookingId === bookingId) {
        queryClient.invalidateQueries({ queryKey: ['bookings', bookingId] });
        queryClient.invalidateQueries({ queryKey: ['bookings'] });
      }
    },
    [bookingId, queryClient],
  );
  useSocketEvent(SocketEvents.BOOKING_UPDATED, handleBookingUpdated);
  // Cancel / complete transitions are emitted as their own events, not
  // BOOKING_UPDATED — subscribe to both so the screen doesn't go stale.
  useSocketEvent(SocketEvents.BOOKING_CANCELLED, handleBookingUpdated);
  useSocketEvent(SocketEvents.BOOKING_COMPLETED, handleBookingUpdated);

  // API-side the route is owner/admin-only (403 otherwise) — hide the
  // buttons entirely for staff so they never hit a dead end.
  const canManageStatus = user?.role === 'owner' || user?.role === 'admin';

  const statusMutation = useMutation({
    mutationFn: ({ status, cancellationReason }: { status: BookingStatus; cancellationReason?: string }) =>
      apiClient.patch<{ booking: Booking }>(`/bookings/${bookingId}/status`, {
        status,
        ...(cancellationReason ? { cancellationReason } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings', bookingId] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
    onError: (error: any) => {
      // apiClient throws ApiError {error, ...} — prefer `.error` so the API's
      // reason (e.g. invalid transition) isn't masked.
      Alert.alert(t('statusUpdateErrorTitle'), error?.error || error?.message || t('statusUpdateErrorMessage'));
    },
    onSettled: () => {
      setPendingStatus(null);
    },
  });

  const applyStatus = useCallback((status: BookingStatus) => {
    if (statusMutation.isPending) return;
    setPendingStatus(status);
    statusMutation.mutate({ status });
  }, [statusMutation]);

  const confirmCancel = useCallback(() => {
    setShowCancelConfirm(false);
    setPendingStatus('cancelled');
    statusMutation.mutate({ status: 'cancelled' });
  }, [statusMutation]);

  const handleTakePayment = useCallback(async () => {
    if (!booking) return;

    // Same gate the Checkout flow uses: on iOS, if the device hasn't run the
    // Tap to Pay education / enable flow yet, send the vendor there first.
    // Android + web are no-ops in the guard.
    if (!guardCheckout()) {
      return;
    }

    setIsCreatingPI(true);
    try {
      const pi = await bookingsApi.createTerminalPaymentIntent(booking.id);
      navigation.navigate('PaymentProcessing', {
        paymentIntentId: pi.id,
        clientSecret: pi.clientSecret,
        stripeAccountId: pi.stripeAccountId,
        amount: pi.amount,
        bookingId: booking.id,
        customerEmail: booking.customerEmail || undefined,
      });
    } catch (error: any) {
      logger.error('Failed to create booking PI', error);
      const code = error?.code || error?.details?.code;
      if (code === 'ACCOUNT_UNDER_REVIEW') {
        Alert.alert(t('accountUnderReviewTitle'), error?.message || error?.error || t('accountUnderReviewMessage'));
      } else if (code === 'ALREADY_PAID') {
        Alert.alert(t('alreadyPaidTitle'), t('alreadyPaidMessage'));
        queryClient.invalidateQueries({ queryKey: ['bookings', bookingId] });
      } else {
        Alert.alert(t('paymentErrorTitle'), error?.message || error?.error || t('paymentErrorMessage'));
      }
    } finally {
      setIsCreatingPI(false);
    }
  }, [booking, guardCheckout, navigation, queryClient, bookingId, t]);

  if (bookingQuery.isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <Header onBack={() => navigation.goBack()} title={t('detailHeaderTitle')} colors={colors} backLabel={t('goBack')} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={t('loading')} />
        </View>
      </SafeAreaView>
    );
  }

  if (bookingQuery.isError || !booking) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <Header onBack={() => navigation.goBack()} title={t('detailHeaderTitle')} colors={colors} backLabel={t('goBack')} />
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.text }]} maxFontSizeMultiplier={1.3} accessibilityRole="alert">
            {t('errorTitle')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const paid = isBookingPaid(booking);
  const cardCurrency = booking.currency || currency;
  const amount = formatCurrency(booking.totalAmount, cardCurrency);
  const subtotal = formatCurrency(booking.price, cardCurrency);
  const tax = formatCurrency(booking.taxAmount, cardCurrency);

  const statusMeta = getStatusMeta(booking.status, colors, t);
  const availableActions = canManageStatus ? (STATUS_ACTIONS[booking.status] ?? []) : [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <Header onBack={() => navigation.goBack()} title={t('detailHeaderTitle')} colors={colors} backLabel={t('goBack')} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconBubble, { backgroundColor: colors.primary + '15' }]}>
              <Ionicons name="person" size={22} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.customerName, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {booking.customerName}
              </Text>
              <Text style={[styles.bookingNumber, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                #{booking.bookingNumber}
              </Text>
            </View>
            <View style={styles.badgeColumn}>
              <View
                style={[
                  styles.badge,
                  paid ? { backgroundColor: '#22C55E20' } : { backgroundColor: colors.primary + '20' },
                ]}
              >
                <Ionicons
                  name={paid ? 'checkmark-circle' : 'time-outline'}
                  size={14}
                  color={paid ? '#22C55E' : colors.primary}
                />
                <Text
                  style={[styles.badgeText, { color: paid ? '#22C55E' : colors.primary }]}
                  maxFontSizeMultiplier={1.3}
                >
                  {paid ? t('paidBadge') : t('unpaidBadge')}
                </Text>
              </View>
              <View style={[styles.badge, { backgroundColor: statusMeta.color + '20' }]}>
                <View style={[styles.statusDot, { backgroundColor: statusMeta.color }]} />
                <Text style={[styles.badgeText, { color: statusMeta.color }]} maxFontSizeMultiplier={1.3}>
                  {statusMeta.label}
                </Text>
              </View>
            </View>
          </View>

          {booking.customerEmail ? (
            <DetailRow icon="mail-outline" label={booking.customerEmail} colors={colors} />
          ) : null}
          {booking.customerPhone ? (
            <DetailRow icon="call-outline" label={booking.customerPhone} colors={colors} />
          ) : null}
          {booking.serviceName ? (
            <DetailRow icon="cut-outline" label={booking.serviceName} colors={colors} />
          ) : null}
          <DetailRow
            icon="calendar-outline"
            label={`${booking.bookingDate} · ${formatTime(booking.startTime)} – ${formatTime(booking.endTime)}`}
            colors={colors}
          />

          {booking.customerNotes ? (
            <View style={[styles.notesBox, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
              <Text style={[styles.notesLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                {t('customerNotesLabel')}
              </Text>
              <Text style={[styles.notesText, { color: colors.text }]} maxFontSizeMultiplier={1.5}>
                {booking.customerNotes}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
            {t('paymentSummaryTitle')}
          </Text>
          <AmountRow label={t('subtotalLabel')} value={subtotal} colors={colors} />
          {booking.taxAmount > 0 ? (
            <AmountRow label={t('taxLabel')} value={tax} colors={colors} />
          ) : null}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <AmountRow label={t('totalLabel')} value={amount} colors={colors} bold />
          <Text style={[styles.paymentTypeNote, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
            {booking.paymentType === 'pay_now' ? t('paymentTypePayNow') : t('paymentTypePayAtAppointment')}
          </Text>
        </View>

        {/* Status actions — contextual to the current booking state */}
        {availableActions.length > 0 ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
              {t('actionsTitle')}
            </Text>
            {availableActions.includes('confirmed') && (
              <StatusActionButton
                icon="checkmark-circle-outline"
                label={t('confirmAction')}
                variant="primary"
                colors={colors}
                loading={pendingStatus === 'confirmed'}
                disabled={statusMutation.isPending}
                onPress={() => applyStatus('confirmed')}
              />
            )}
            {availableActions.includes('completed') && (
              <StatusActionButton
                icon="checkmark-done-outline"
                label={t('completeAction')}
                variant="primary"
                colors={colors}
                loading={pendingStatus === 'completed'}
                disabled={statusMutation.isPending}
                onPress={() => applyStatus('completed')}
              />
            )}
            {availableActions.includes('no_show') && (
              <StatusActionButton
                icon="eye-off-outline"
                label={t('noShowAction')}
                variant="secondary"
                colors={colors}
                loading={pendingStatus === 'no_show'}
                disabled={statusMutation.isPending}
                onPress={() => applyStatus('no_show')}
              />
            )}
            {availableActions.includes('cancelled') && (
              <StatusActionButton
                icon="close-circle-outline"
                label={t('cancelAction')}
                variant="destructive"
                colors={colors}
                loading={pendingStatus === 'cancelled'}
                disabled={statusMutation.isPending}
                onPress={() => setShowCancelConfirm(true)}
              />
            )}
          </View>
        ) : null}
      </ScrollView>

      {!paid && booking.paymentType !== 'pay_now' && booking.status !== 'cancelled' ? (
        <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <TouchableOpacity
            onPress={handleTakePayment}
            disabled={isCreatingPI || isTerminalProcessing}
            style={[
              styles.payButton,
              {
                backgroundColor: colors.primary,
                opacity: isCreatingPI || isTerminalProcessing ? 0.6 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('takePaymentAccessibilityLabel', { amount })}
          >
            {isCreatingPI ? (
              <ActivityIndicator size="small" color={colors.onPrimary} accessibilityLabel={t('loading')} />
            ) : (
              <Ionicons name="card" size={20} color={colors.onPrimary} />
            )}
            <Text style={styles.payButtonText} maxFontSizeMultiplier={1.3}>
              {t('takePaymentButton', { amount })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <ConfirmModal
        visible={showCancelConfirm}
        title={t('cancelConfirmTitle')}
        message={paid ? t('cancelConfirmMessagePaid', { name: booking.customerName }) : t('cancelConfirmMessage', { name: booking.customerName })}
        confirmText={t('cancelConfirmButton')}
        cancelText={t('keepBookingButton')}
        confirmStyle="destructive"
        onConfirm={confirmCancel}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </SafeAreaView>
  );
}

function getStatusMeta(
  status: BookingStatus,
  colors: any,
  t: (k: string) => string,
): { label: string; color: string } {
  switch (status) {
    case 'pending':
      return { label: t('statusPending'), color: colors.warning };
    case 'confirmed':
      return { label: t('statusConfirmed'), color: '#3B82F6' };
    case 'completed':
      return { label: t('statusCompleted'), color: colors.success };
    case 'cancelled':
      return { label: t('statusCancelled'), color: colors.error };
    case 'no_show':
      return { label: t('statusNoShow'), color: colors.textMuted };
    case 'partially_refunded':
      return { label: t('statusPartiallyRefunded'), color: colors.warning };
    default:
      return { label: status, color: colors.textMuted };
  }
}

function StatusActionButton({
  icon,
  label,
  variant,
  colors,
  loading,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  variant: 'primary' | 'secondary' | 'destructive';
  colors: any;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const backgroundColor =
    variant === 'primary' ? colors.primary : variant === 'destructive' ? colors.errorBg : 'transparent';
  const contentColor =
    variant === 'primary' ? '#fff' : variant === 'destructive' ? colors.error : colors.text;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.statusActionButton,
        { backgroundColor },
        variant === 'secondary' && { borderWidth: 1, borderColor: colors.border },
        disabled && !loading && { opacity: 0.5 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={contentColor} />
      ) : (
        <Ionicons name={icon} size={20} color={contentColor} />
      )}
      <Text style={[styles.statusActionText, { color: contentColor }]} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Header({ onBack, title, colors, backLabel }: { onBack: () => void; title: string; colors: any; backLabel: string }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
        {title}
      </Text>
      <View style={{ width: 24 }} />
    </View>
  );
}

function DetailRow({
  icon,
  label,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  colors: any;
}) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={16} color={colors.textSecondary} />
      <Text style={[styles.detailText, { color: colors.text }]} maxFontSizeMultiplier={1.5} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function AmountRow({
  label,
  value,
  colors,
  bold,
}: {
  label: string;
  value: string;
  colors: any;
  bold?: boolean;
}) {
  return (
    <View style={styles.amountRow}>
      <Text
        style={[
          styles.amountLabel,
          { color: bold ? colors.text : colors.textSecondary, fontFamily: bold ? fonts.semiBold : fonts.regular },
        ]}
        maxFontSizeMultiplier={1.5}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.amountValue,
          { color: colors.text, fontFamily: bold ? fonts.bold : fonts.regular },
        ]}
        maxFontSizeMultiplier={1.3}
      >
        {value}
      </Text>
    </View>
  );
}

function formatTime(hms: string | null | undefined): string {
  if (!hms) return '';
  const parts = String(hms).split(':');
  if (parts.length < 2) return String(hms);
  let h = parseInt(parts[0], 10);
  const m = parts[1];
  const am = h < 12;
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${am ? 'AM' : 'PM'}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { fontSize: 18, fontFamily: fonts.bold },
  content: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  errorText: { fontSize: 16, fontFamily: fonts.semiBold },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBubble: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  customerName: { fontSize: 17, fontFamily: fonts.bold },
  bookingNumber: { fontSize: 13, fontFamily: fonts.regular, marginTop: 2 },
  badgeColumn: { alignItems: 'flex-end', gap: 6 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  badgeText: { fontSize: 12, fontFamily: fonts.semiBold },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailText: { flex: 1, fontSize: 14, fontFamily: fonts.regular },
  notesBox: {
    marginTop: 6, padding: 10,
    borderRadius: 10, borderWidth: 1, gap: 4,
  },
  notesLabel: { fontSize: 12, fontFamily: fonts.semiBold, textTransform: 'uppercase', letterSpacing: 0.5 },
  notesText: { fontSize: 14, fontFamily: fonts.regular, lineHeight: 19 },
  sectionTitle: {
    fontSize: 12, fontFamily: fonts.semiBold,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
  },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  amountLabel: { fontSize: 14 },
  amountValue: { fontSize: 14 },
  divider: { height: 1, marginVertical: 4 },
  paymentTypeNote: { fontSize: 12, fontFamily: fonts.regular, marginTop: 6 },
  statusActionButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 13, borderRadius: 12, minHeight: 48,
  },
  statusActionText: { fontSize: 15, fontFamily: fonts.semiBold },
  footer: { padding: 16, borderTopWidth: 1 },
  payButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16, borderRadius: 14, minHeight: 52,
  },
  // Dark stone on amber fill — white fails contrast (see colors.onPrimary)
  payButtonText: { color: '#1C1917', fontSize: 16, fontFamily: fonts.bold },
});
