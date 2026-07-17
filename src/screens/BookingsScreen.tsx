import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Animated,
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
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { fonts } from '../lib/fonts';
import { useTranslations } from '../lib/i18n';

// Number of single-day chips in the strip (Today, Tomorrow, +5 weekdays).
const DAY_CHIP_COUNT = 7;

function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function todayISO(): string {
  return inDays(0);
}

// Skeleton row while the list loads — same pulse pattern as the
// Transactions screen so loading feels consistent across tabs.
function SkeletonRow({ colors }: { colors: any }) {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  return (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: pulseAnim },
      ]}
    >
      <View style={styles.cardRow}>
        <View style={[styles.iconBubble, { backgroundColor: colors.border }]} />
        <View style={{ flex: 1, gap: 8 }}>
          <View style={{ width: '55%', height: 14, borderRadius: 7, backgroundColor: colors.border }} />
          <View style={{ width: '35%', height: 12, borderRadius: 6, backgroundColor: colors.border }} />
        </View>
        <View style={{ width: 56, height: 14, borderRadius: 7, backgroundColor: colors.border }} />
      </View>
    </Animated.View>
  );
}

// 0..DAY_CHIP_COUNT-1 = single day offset from today; 'all' = next 30 days.
type DaySelection = number | 'all';

export function BookingsScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const { currency, organization } = useAuth();
  const queryClient = useQueryClient();
  const t = useTranslations('bookings');

  const [search, setSearch] = useState('');
  // Debounced so the bookings query doesn't refire on every keystroke.
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [selectedDay, setSelectedDay] = useState<DaySelection>(0);

  // Day strip drives the date window: a single day per chip, or the full
  // next-30-days view. Past bookings (older than today) are out of scope —
  // vendors would settle them the same day if at all.
  const { dateFrom, dateTo } = useMemo(() => {
    if (selectedDay === 'all') {
      return { dateFrom: todayISO(), dateTo: inDays(30) };
    }
    const day = inDays(selectedDay);
    return { dateFrom: day, dateTo: day };
  }, [selectedDay]);

  const dayChips = useMemo(() => {
    const chips: { key: DaySelection; label: string }[] = [];
    for (let i = 0; i < DAY_CHIP_COUNT; i++) {
      let label: string;
      if (i === 0) label = t('todayLabel');
      else if (i === 1) label = t('tomorrowLabel');
      else {
        const d = new Date(inDays(i) + 'T00:00:00');
        label = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
      }
      chips.push({ key: i, label });
    }
    chips.push({ key: 'all', label: t('next30DaysLabel') });
    return chips;
  }, [t]);

  const bookingsQuery = useQuery({
    queryKey: ['bookings', { dateFrom, dateTo, search: debouncedSearch }],
    queryFn: () => bookingsApi.list({ dateFrom, dateTo, search: debouncedSearch || undefined, limit: 100 }),
  });

  const isLoading = bookingsQuery.isLoading;
  const isRefetching = bookingsQuery.isRefetching;
  const isError = bookingsQuery.isError;
  const refetch = useCallback(async () => {
    await bookingsQuery.refetch();
  }, [bookingsQuery]);

  // Chronological by date + time — the natural run-of-show order for staff
  // working a day. Paid state stays visible on each card's badge.
  const bookings = useMemo(() => {
    const list = bookingsQuery.data?.bookings ?? [];
    return [...list]
      .filter((b) => b.status !== 'cancelled')
      .sort((a, b) => {
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

  // Stable renderItem + stable onPress so BookingCard's memo isn't defeated on
  // every socket-driven list refresh.
  const renderBooking = useCallback(
    ({ item }: { item: Booking }) => (
      <BookingCard booking={item} currency={currency} onPress={handleBookingPress} />
    ),
    [currency, handleBookingPress],
  );

  const isSearching = debouncedSearch.length > 0;

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

      {/* Day strip — pick the day being worked; defaults to today */}
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dayStrip}
        >
          {dayChips.map((chip) => {
            const isActive = selectedDay === chip.key;
            return (
              <TouchableOpacity
                key={String(chip.key)}
                onPress={() => setSelectedDay(chip.key)}
                accessibilityRole="button"
                accessibilityLabel={chip.label}
                accessibilityState={{ selected: isActive }}
                style={[
                  styles.dayChip,
                  {
                    backgroundColor: isActive ? colors.chipBgActive : colors.chipBg,
                    borderColor: isActive ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={[
                    styles.dayChipText,
                    { color: isActive ? colors.primary : colors.textSecondary },
                    isActive && { fontFamily: fonts.semiBold },
                  ]}
                >
                  {chip.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {isLoading ? (
        <View style={styles.listContent}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonRow key={i} colors={colors} />
          ))}
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
            <Ionicons name="refresh" size={18} color={colors.onPrimary} />
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
          renderItem={renderBooking}
          removeClippedSubviews
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.primary + '15' }]}>
                <Ionicons name={isSearching ? 'search-outline' : 'calendar-outline'} size={32} color={colors.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {isSearching ? t('emptySearchTitle') : selectedDay === 'all' ? t('emptyTitle') : t('emptyDayTitle')}
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                {isSearching ? t('emptySearchSubtitle') : selectedDay === 'all' ? t('emptySubtitle') : t('emptyDaySubtitle')}
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
  onPress: (booking: Booking) => void;
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
      onPress={() => onPress(booking)}
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
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: fonts.regular, paddingVertical: 4 },
  dayStrip: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
    flexDirection: 'row',
  },
  dayChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayChipText: { fontSize: 13, fontFamily: fonts.medium },
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
  // Dark stone on amber fill — white fails contrast (see colors.onPrimary)
  emptyButtonText: { color: '#1C1917', fontSize: 15, fontFamily: fonts.semiBold },
});
