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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useTerminal } from '../context/StripeTerminalContext';
import { useSocketEvent, SocketEvents } from '../context/SocketContext';
import { bookingsApi, isBookingPaid, type Booking } from '../lib/api/bookings';
import { formatCurrency } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { useTranslations } from '../lib/i18n';
import logger from '../lib/logger';

type RouteParams = {
  BookingDetail: { bookingId: string };
};

export function BookingDetailScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'BookingDetail'>>();
  const { bookingId } = route.params;
  const { currency } = useAuth();
  const { isInitialized, isConnected, isProcessing: isTerminalProcessing } = useTerminal();
  const queryClient = useQueryClient();
  const t = useTranslations('bookings');

  const [isCreatingPI, setIsCreatingPI] = useState(false);

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

  const handleTakePayment = useCallback(async () => {
    if (!booking) return;

    if (!isInitialized || !isConnected) {
      Alert.alert(
        t('terminalNotReadyTitle'),
        t('terminalNotReadyMessage'),
        [
          { text: t('cancelButton'), style: 'cancel' },
          {
            text: t('setUpTapToPayButton'),
            onPress: () => navigation.navigate('TapToPaySettings'),
          },
        ],
      );
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
  }, [booking, isInitialized, isConnected, navigation, queryClient, bookingId, t]);

  if (bookingQuery.isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <Header onBack={() => navigation.goBack()} title={t('detailHeaderTitle')} colors={colors} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={t('loading')} />
        </View>
      </SafeAreaView>
    );
  }

  if (bookingQuery.isError || !booking) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <Header onBack={() => navigation.goBack()} title={t('detailHeaderTitle')} colors={colors} />
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <Header onBack={() => navigation.goBack()} title={t('detailHeaderTitle')} colors={colors} />

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
      </ScrollView>

      {!paid && booking.paymentType !== 'pay_now' ? (
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
              <ActivityIndicator size="small" color="#fff" accessibilityLabel={t('loading')} />
            ) : (
              <Ionicons name="card" size={20} color="#fff" />
            )}
            <Text style={styles.payButtonText} maxFontSizeMultiplier={1.3}>
              {t('takePaymentButton', { amount })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Header({ onBack, title, colors }: { onBack: () => void; title: string; colors: any }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
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
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
  },
  badgeText: { fontSize: 12, fontFamily: fonts.semiBold },
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
  footer: { padding: 16, borderTopWidth: 1 },
  payButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16, borderRadius: 14, minHeight: 52,
  },
  payButtonText: { color: '#fff', fontSize: 16, fontFamily: fonts.bold },
});
