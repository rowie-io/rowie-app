import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useSocketEvent, SocketEvents } from '../context/SocketContext';
import { bookingsApi, isBookingPaid, type Booking } from '../lib/api/bookings';
import { formatCurrency } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { useTranslations } from '../lib/i18n';

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function BookingsScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const { currency, organization } = useAuth();
  const queryClient = useQueryClient();
  const t = useTranslations('bookings');

  const [search, setSearch] = useState('');

  // Today + the next 30 days. Past bookings (older than today) are out of
  // scope — vendors would settle them the same day if at all.
  const dateFrom = useMemo(() => todayISO(), []);
  const dateTo = useMemo(() => inDays(30), []);

  const bookingsQuery = useQuery({
    queryKey: ['bookings', { dateFrom, dateTo, search }],
    queryFn: () => bookingsApi.list({ dateFrom, dateTo, search, limit: 100 }),
  });

  const isLoading = bookingsQuery.isLoading;
  const isRefetching = bookingsQuery.isRefetching;
  const isError = bookingsQuery.isError;
  const refetch = useCallback(async () => {
    await bookingsQuery.refetch();
  }, [bookingsQuery]);

  // Sort: unpaid first (vendor's actionable items), then by date+time.
  const bookings = useMemo(() => {
    const list = bookingsQuery.data?.bookings ?? [];
    return [...list]
      .filter((b) => b.status !== 'cancelled')
      .sort((a, b) => {
        const aPaid = isBookingPaid(a) ? 1 : 0;
        const bPaid = isBookingPaid(b) ? 1 : 0;
        if (aPaid !== bPaid) return aPaid - bPaid;
        const aKey = `${a.bookingDate} ${a.startTime}`;
        const bKey = `${b.bookingDate} ${b.startTime}`;
        return aKey.localeCompare(bKey);
      });
  }, [bookingsQuery.data]);

  // Defense-in-depth: ignore BOOKING_* emits from other orgs.
  const orgIdRef = useRef(organization?.id);
  useEffect(() => {
    orgIdRef.current = organization?.id;
  }, [organization?.id]);
  const isMyOrg = useCallback((data: any): boolean => {
    if (!data?.organizationId) return true;
    return !!orgIdRef.current && data.organizationId === orgIdRef.current;
  }, []);

  const handleBookingChange = useCallback(
    (data: any) => {
      if (!isMyOrg(data)) return;
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
    [queryClient, isMyOrg],
  );

  useSocketEvent(SocketEvents.BOOKING_CREATED, handleBookingChange);
  useSocketEvent(SocketEvents.BOOKING_UPDATED, handleBookingChange);
  useSocketEvent(SocketEvents.BOOKING_CANCELLED, handleBookingChange);
  useSocketEvent(SocketEvents.BOOKING_COMPLETED, handleBookingChange);

  const handleBookingPress = useCallback(
    (booking: Booking) => {
      navigation.navigate('BookingDetail', { bookingId: booking.id });
    },
    [navigation],
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('goBack')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
          {t('headerTitle')}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={[styles.searchRow, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('searchPlaceholder')}
          placeholderTextColor={colors.textSecondary}
          style={[styles.searchInput, { color: colors.text }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel={t('searchAccessibilityLabel')}
          maxFontSizeMultiplier={1.5}
        />
        {search.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearch('')}
            accessibilityRole="button"
            accessibilityLabel={t('clearSearchAccessibilityLabel')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={t('loading')} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <View style={[styles.emptyIcon, { backgroundColor: '#EF444420' }]}>
            <Ionicons name="cloud-offline-outline" size={32} color="#EF4444" />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3} accessibilityRole="alert">
            {t('errorTitle')}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
            {t('errorSubtitle')}
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            style={[styles.emptyButton, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
            accessibilityLabel={t('retryAccessibilityLabel')}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
            <Text style={styles.emptyButtonText} maxFontSizeMultiplier={1.3}>
              {t('retryButton')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <BookingCard
              booking={item}
              currency={currency}
              onPress={() => handleBookingPress(item)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.primary + '15' }]}>
                <Ionicons name="calendar-outline" size={32} color={colors.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {t('emptyTitle')}
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                {t('emptySubtitle')}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

interface BookingCardProps {
  booking: Booking;
  currency: string;
  onPress: () => void;
}

const BookingCard = React.memo(function BookingCard({ booking, currency, onPress }: BookingCardProps) {
  const { colors } = useTheme();
  const t = useTranslations('bookings');
  const paid = isBookingPaid(booking);
  const cardCurrency = booking.currency || currency;
  const amount = formatCurrency(booking.totalAmount, cardCurrency);
  const time = formatTime(booking.startTime);
  const dateLabel = formatDateLabel(booking.bookingDate, t);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      accessibilityRole="button"
      accessibilityLabel={`${booking.customerName}, ${time}, ${amount}, ${paid ? t('paidBadge') : t('unpaidBadge')}`}
    >
      <View style={styles.cardRow}>
        <View style={[styles.iconBubble, { backgroundColor: colors.primary + '15' }]}>
          <Ionicons name="calendar" size={20} color={colors.primary} />
        </View>
        <View style={styles.cardBody}>
          <View style={styles.cardTopRow}>
            <Text style={[styles.cardName, { color: colors.text }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
              {booking.customerName}
            </Text>
            <Text style={[styles.cardAmount, { color: colors.text }]} maxFontSizeMultiplier={1.2}>
              {amount}
            </Text>
          </View>
          <Text style={[styles.cardMeta, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5} numberOfLines={1}>
            {dateLabel} · {time}
            {booking.serviceName ? ` · ${booking.serviceName}` : ''}
          </Text>
          <View style={styles.cardBottomRow}>
            <View
              style={[
                styles.badge,
                paid
                  ? { backgroundColor: '#22C55E20' }
                  : { backgroundColor: colors.primary + '20' },
              ]}
            >
              <Ionicons
                name={paid ? 'checkmark-circle' : 'time-outline'}
                size={12}
                color={paid ? '#22C55E' : colors.primary}
              />
              <Text
                style={[
                  styles.badgeText,
                  { color: paid ? '#22C55E' : colors.primary },
                ]}
                maxFontSizeMultiplier={1.3}
              >
                {paid ? t('paidBadge') : t('unpaidBadge')}
              </Text>
            </View>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
});

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

function formatDateLabel(dateISO: string, t: (k: string) => string): string {
  const today = todayISO();
  if (dateISO === today) return t('todayLabel');
  if (dateISO === inDays(1)) return t('tomorrowLabel');
  const d = new Date(dateISO + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: fonts.regular, paddingVertical: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  listContent: { padding: 16, gap: 10, flexGrow: 1 },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBubble: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  cardBody: { flex: 1, gap: 4 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardName: { fontSize: 15, fontFamily: fonts.semiBold, flex: 1 },
  cardAmount: { fontSize: 15, fontFamily: fonts.semiBold },
  cardMeta: { fontSize: 13, fontFamily: fonts.regular },
  cardBottomRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  badgeText: { fontSize: 11, fontFamily: fonts.semiBold },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 64 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  emptyTitle: { fontSize: 18, fontFamily: fonts.bold, marginBottom: 8, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, fontFamily: fonts.regular, marginBottom: 24, textAlign: 'center' },
  emptyButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12,
  },
  emptyButtonText: { color: '#fff', fontSize: 15, fontFamily: fonts.semiBold },
});
