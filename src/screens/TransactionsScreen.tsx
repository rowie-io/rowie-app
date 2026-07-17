// TODO(security): install expo-screen-capture and guard this screen with
// usePreventScreenCapture() — it lists card last4 and transaction amounts.
import React, { useState, useRef, useCallback, useEffect, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useSocketEvent, useSocket, SocketEvents } from '../context/SocketContext';
import { apiClient, Transaction, TransactionsListResponse } from '../lib/api';
import { formatCents } from '../utils/currency';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { useTranslations } from '../lib/i18n';
import logger from '../lib/logger';

// Held orders shown inline, no tab switching needed

type TransactionsScreenParams = {
  History: {
    initialTab?: string;
  };
};

// Empty state uses shared component
import { EmptyState } from '../components/EmptyState';

// Skeleton row for loading state
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
    <Animated.View style={{ opacity: pulseAnim, flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 20 }}>
      <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.border, marginRight: 14 }} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={{ width: '60%', height: 14, borderRadius: 7, backgroundColor: colors.border }} />
        <View style={{ width: '35%', height: 12, borderRadius: 6, backgroundColor: colors.border }} />
      </View>
      <View style={{ width: 60, height: 14, borderRadius: 7, backgroundColor: colors.border }} />
    </Animated.View>
  );
}

// Skeleton loading state
function LoadingTransactionsContent({ colors }: { colors: any; isDark: boolean }) {
  return (
    <View style={{ flex: 1, paddingTop: 16 }}>
      <View style={{ backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, marginHorizontal: 20, overflow: 'hidden' }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View key={i}>
            <SkeletonRow colors={colors} />
            {i < 5 && <View style={{ height: 1, backgroundColor: colors.divider, marginLeft: 74 }} />}
          </View>
        ))}
      </View>
    </View>
  );
}

type FilterType = 'all' | 'succeeded' | 'refunded' | 'failed';

// Animated transaction item component
const AnimatedTransactionItem = memo(function AnimatedTransactionItem({
  item,
  onPress,
  colors,
  styles,
  getStatusColor,
  getStatusLabel,
  formatDate,
  currency,
  t,
}: {
  item: Transaction;
  onPress: () => void;
  colors: any;
  styles: any;
  getStatusColor: (status: string) => string;
  getStatusLabel: (status: string) => string;
  formatDate: (timestamp: number) => string;
  currency: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // Rows carry their own currency (multi-currency history); the org's
  // current currency is only a fallback for older cached rows.
  const itemCurrency = item.currency || currency;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
      tension: 150,
      friction: 10,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 150,
      friction: 8,
    }).start();
  }, [scaleAnim]);

  const getMetaText = () => {
    if (item.sourceType === 'preorder') {
      const parts: string[] = [];
      if (item.customerName) parts.push(item.customerName);
      if (item.catalogName) parts.push(item.catalogName);
      if (item.itemCount && item.itemCount > 0) parts.push(item.itemCount > 1 ? t('itemCountPlural', { count: item.itemCount }) : t('itemCount', { count: item.itemCount }));
      return parts.join(' • ') || t('preorderLabel');
    }
    // Default: order
    if (item.paymentMethod?.type === 'cash') return t('paymentMethodCash');
    if (item.paymentMethod?.type === 'split') return t('paymentMethodSplitPayment');
    if (item.paymentMethod?.brand && item.paymentMethod?.last4)
      return t('paymentMethodCardBrandLast4', { brand: item.paymentMethod.brand.toUpperCase(), last4: item.paymentMethod.last4 });
    if (item.paymentMethod?.last4) return t('paymentMethodCardLast4', { last4: item.paymentMethod.last4 });
    return t('paymentMethodCard');
  };

  const getSourceBadge = () => {
    if (item.sourceType === 'preorder') {
      return { label: item.dailyNumber ? t('preorderWithNumber', { dailyNumber: item.dailyNumber }) : t('preorderLabel'), color: '#a855f7' };
    }
    if (item.sourceType === 'booking') {
      return { label: t('bookingLabel'), color: '#3B82F6' };
    }
    return null;
  };

  const sourceBadge = getSourceBadge();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={t('transactionAccessibilityLabel', { amount: formatCents(item.amount, itemCurrency), status: getStatusLabel(item.status), date: formatDate(item.created) }) + (item.sourceType === 'preorder' ? ', ' + t('preorderLabel').toLowerCase() : '')}
      accessibilityHint={t('transactionAccessibilityHint')}
    >
      <Animated.View style={[styles.transactionItem, { transform: [{ scale: scaleAnim }] }]}>
        <View style={styles.transactionLeft}>
          <View
            style={[
              styles.statusIndicator,
              { backgroundColor: getStatusColor(item.status) },
            ]}
          />
          <View style={styles.transactionInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text maxFontSizeMultiplier={1.3} style={styles.transactionAmount}>
                {formatCents(item.amount, itemCurrency)}
              </Text>
              {sourceBadge && (
                <View style={{
                  backgroundColor: sourceBadge.color + '20',
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 6,
                }}>
                  <Text maxFontSizeMultiplier={1.5} style={{
                    fontSize: 10,
                    fontFamily: fonts.semiBold,
                    color: sourceBadge.color,
                  }}>
                    {sourceBadge.label}
                  </Text>
                </View>
              )}
            </View>
            <Text maxFontSizeMultiplier={1.5} style={styles.transactionMeta}>
              {getMetaText()}
            </Text>
          </View>
        </View>
        <View style={styles.transactionRight}>
          <Text maxFontSizeMultiplier={1.5} style={styles.transactionDate}>{formatDate(item.created)}</Text>
          <Text maxFontSizeMultiplier={1.5} style={[styles.statusBadge, { color: getStatusColor(item.status) }]}>
            {getStatusLabel(item.status)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Animated.View>
    </Pressable>
  );
});

export function TransactionsScreen() {
  const { colors, isDark } = useTheme();
  const t = useTranslations('transactions');
  const tc = useTranslations('common');
  const { currency, organization } = useAuth();
  const { isConnected } = useSocket();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<TransactionsScreenParams, 'History'>>();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  // Debounced so the transactions query doesn't refire on every keystroke.
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const wasConnectedRef = useRef(isConnected);
  const hasEverConnectedRef = useRef(false);

  // Refetch when socket REconnects (not initial connection)
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current && hasEverConnectedRef.current) {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    }
    if (isConnected) hasEverConnectedRef.current = true;
    wasConnectedRef.current = isConnected;
  }, [isConnected, queryClient]);

  // Defense-in-depth: ignore ORDER_*/SESSION_* emits for other orgs so a
  // future room-scoping regression can't silently invalidate transactions
  // with another org's payload.
  const orgIdRef = useRef(organization?.id);
  useEffect(() => {
    orgIdRef.current = organization?.id;
  }, [organization?.id]);
  const isMyOrg = useCallback((data: any): boolean => {
    if (!data?.organizationId) return true;
    return !!orgIdRef.current && data.organizationId === orgIdRef.current;
  }, []);

  // Auto-refresh transactions when payment events occur
  const handlePaymentEvent = useCallback((data: any) => {
    if (!isMyOrg(data)) return;
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
  }, [queryClient, isMyOrg]);

  useSocketEvent(SocketEvents.ORDER_COMPLETED, handlePaymentEvent);
  useSocketEvent(SocketEvents.PAYMENT_RECEIVED, handlePaymentEvent);
  useSocketEvent(SocketEvents.ORDER_REFUNDED, handlePaymentEvent);
  useSocketEvent(SocketEvents.SESSION_SETTLED, handlePaymentEvent);
  useSocketEvent(SocketEvents.SESSION_CANCELLED, handlePaymentEvent);

  // Refetch stale data when the tab gains focus (catches any missed socket events)
  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    }, [queryClient])
  );

  // History shows all the org's transactions — not just whichever catalog
  // happens to be selected on the Menu tab. Filtering by selectedCatalog hid
  // most of the user's history (the default catalog frequently has zero sales
  // while every other one has plenty), so users opened History expecting a
  // full audit log and saw "No transactions yet" instead.
  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['transactions', filter, debouncedSearch],
    // Called directly through apiClient because the typed transactionsApi.list
    // helper doesn't expose the API's `search` parameter (server-side ILIKE
    // over customer name / email / receipt number, plus exact amount match).
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set('limit', '25');
      params.set('offset', String(pageParam));
      params.set('status', filter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      return apiClient.get<TransactionsListResponse>(
        `/stripe/connect/transactions?${params.toString()}`
      );
    },
    // The API paginates with offset (starting_after is accepted but ignored),
    // so the next page's offset is simply how many rows we've loaded so far.
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore || lastPage.data.length === 0) return undefined;
      return allPages.reduce((sum, page) => sum + page.data.length, 0);
    },
    initialPageParam: 0,
  });

  // Filtering is now done server-side via the status query parameter
  const transactions = data?.pages.flatMap((page) => page.data) || [];

  const styles = createStyles(colors, isDark);

  const getStatusColor = useCallback((status: string) => {
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
  }, [colors.success, colors.warning, colors.error, colors.textMuted]);

  const getStatusLabel = useCallback((status: string) => {
    switch (status) {
      case 'succeeded':
        return t('statusSucceeded');
      case 'refunded':
        return t('statusRefunded');
      case 'partially_refunded':
        return t('statusPartialRefund');
      case 'failed':
        return t('statusFailed');
      case 'pending':
        return t('statusPending');
      case 'cancelled':
        return t('statusCancelled');
      default:
        return status;
    }
  }, [t]);

  const formatDate = useCallback((timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }, []);

  const handleTransactionPress = useCallback((item: Transaction) => {
    // Detail/refund/receipt endpoints resolve the underlying source id
    // (orders / table_sessions / tickets), not the unified row id. Fall back
    // to `id` for older cached rows that predate sourceId.
    const sourceId = item.sourceId ?? item.id;
    if (item.sourceType === 'preorder') {
      navigation.navigate('TransactionDetail', { id: sourceId, sourceType: 'preorder' });
    } else {
      navigation.navigate('TransactionDetail', { id: sourceId });
    }
  }, [navigation]);

  const renderTransaction = useCallback(({ item }: { item: Transaction }) => (
    <AnimatedTransactionItem
      item={item}
      onPress={() => handleTransactionPress(item)}
      colors={colors}
      styles={styles}
      getStatusColor={getStatusColor}
      getStatusLabel={getStatusLabel}
      formatDate={formatDate}
      currency={currency}
      t={t}
    />
  ), [handleTransactionPress, colors, styles, getStatusColor, getStatusLabel, formatDate, currency, t]);

  const renderFooter = () => {
    if (!isFetchingNextPage) return null;
    return (
      <>
        {[1, 2, 3].map((i) => (
          <View key={i} style={styles.skeletonItem}>
            <View style={styles.skeletonLeft}>
              <View style={styles.skeletonDot} />
              <View style={styles.skeletonInfo}>
                <View style={[styles.skeletonBox, { width: 80, height: 20 }]} />
                <View style={[styles.skeletonBox, { width: 120, height: 14, marginTop: 6 }]} />
              </View>
            </View>
            <View style={styles.skeletonRight}>
              <View style={[styles.skeletonBox, { width: 50, height: 14 }]} />
              <View style={[styles.skeletonBox, { width: 70, height: 12, marginTop: 6 }]} />
            </View>
          </View>
        ))}
      </>
    );
  };

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  const handleRefresh = async () => {
    setIsManualRefreshing(true);
    await refetch();
    setIsManualRefreshing(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.headerContainer}>
          <Text maxFontSizeMultiplier={1.3} style={styles.title}>{t('historyTitle')}</Text>
        </View>

        {/* Search — amount, receipt number, customer name or email */}
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('searchPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            style={styles.searchInput}
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

        {/* Filter row */}
        <View style={styles.filterContainer}>
          {(['all', 'succeeded', 'refunded', 'failed'] as FilterType[]).map((f) => {
            const isActive = filter === f;
            return (
              <TouchableOpacity
                key={f}
                onPress={() => setFilter(f)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('filterAccessibilityLabel', { filter: f === 'all' ? t('filterAll').toLowerCase() : f })}
                accessibilityState={{ selected: isActive }}
                style={[
                  styles.filterTab,
                  {
                    backgroundColor: isActive ? colors.chipBgActive : colors.chipBg,
                    borderColor: isActive ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={[
                    styles.filterText,
                    { color: isActive ? colors.primary : colors.textSecondary },
                    isActive && { fontFamily: fonts.semiBold },
                  ]}
                >
                  {f === 'all' ? t('filterAll') : f === 'succeeded' ? t('filterSucceeded') : f === 'refunded' ? t('filterRefunded') : t('filterFailed')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>



        {/* Transactions list */}
        <>
            {isLoading ? (
              <LoadingTransactionsContent colors={colors} isDark={isDark} />
            ) : isError ? (
              <EmptyState
                icon="cloud-offline-outline"
                title={t('errorTitle')}
                subtitle={t('errorSubtitle')}
                actionLabel={t('retryButton')}
                onAction={() => refetch()}
              />
            ) : transactions.length === 0 ? (
              debouncedSearch.length > 0 ? (
                <EmptyState
                  icon="search-outline"
                  title={t('noResultsTitle')}
                  subtitle={t('noResultsSubtitle')}
                />
              ) : (
                <EmptyState
                  icon="receipt-outline"
                  title={t('emptyTitle')}
                  subtitle={t('emptySubtitle')}
                />
              )
            ) : (
              <FlatList
                data={transactions}
                renderItem={renderTransaction}
                keyExtractor={(item) => `${item.sourceType || 'order'}-${item.id}`}
                contentContainerStyle={[styles.list, { flexGrow: 1 }]}
                style={styles.listContainer}
                removeClippedSubviews
                // No getItemLayout: rows carry Dynamic Type text
                // (maxFontSizeMultiplier up to 1.5) + a wrap-capable meta line,
                // so row height is not fixed across accessibility font sizes.
                refreshControl={
                  <RefreshControl
                    refreshing={isManualRefreshing}
                    onRefresh={handleRefresh}
                    tintColor={colors.primary}
                  />
                }
                onEndReached={handleLoadMore}
                onEndReachedThreshold={0.5}
                ListFooterComponent={renderFooter}
              />
            )}
          </>
      </View>
    </View>
  );
}

const createStyles = (colors: any, isDark: boolean) => {
  const cardBackground = colors.card;
  const cardBorder = colors.border;

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 4,
    },
    title: {
      fontSize: 28,
      fontFamily: fonts.bold,
      color: colors.text,
      letterSpacing: -0.5,
    },
    heldBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      borderWidth: 1,
    },
    heldBadgeText: {
      fontSize: 13,
      fontFamily: fonts.semiBold,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 20,
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: cardBorder,
      backgroundColor: cardBackground,
      minHeight: 44,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      fontFamily: fonts.regular,
      color: colors.text,
      paddingVertical: 4,
    },
    filterContainer: {
      flexDirection: 'row',
      paddingHorizontal: 20,
      paddingVertical: 10,
      gap: 8,
    },
    filterTab: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 22,
      borderWidth: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterText: {
      fontSize: 13,
      fontFamily: fonts.medium,
    },
    list: {
      padding: 16,
      paddingTop: 12,
      paddingBottom: 20,
    },
    listContainer: {
      backgroundColor: 'transparent',
    },
    transactionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: cardBackground,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: cardBorder,
      padding: 16,
      marginBottom: 12,
      ...shadows.sm,
    },
    transactionLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    statusIndicator: {
      width: 10,
      height: 10,
      borderRadius: 5,
      marginRight: 14,
    },
    transactionInfo: {
      flex: 1,
    },
    transactionAmount: {
      fontSize: 18,
      fontFamily: fonts.semiBold,
      color: colors.text,
      marginBottom: 4,
    },
    transactionMeta: {
      fontSize: 13,
      fontFamily: fonts.regular,
      // textSecondary, not textMuted — this line carries the payment method
      // (brand + last4) which staff actively read when reconciling.
      color: colors.textSecondary,
    },
    transactionRight: {
      alignItems: 'flex-end',
      marginRight: 10,
    },
    transactionDate: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      marginBottom: 4,
    },
    statusBadge: {
      fontSize: 12,
      fontFamily: fonts.medium,
    },
    footerLoader: {
      paddingVertical: 20,
      alignItems: 'center',
    },
    // Skeleton styles
    skeletonList: {
      padding: 16,
      paddingTop: 12,
    },
    skeletonItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: cardBackground,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: cardBorder,
      padding: 16,
      marginBottom: 12,
    },
    skeletonLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    skeletonDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.border,
      marginRight: 14,
    },
    skeletonInfo: {
      flex: 1,
    },
    skeletonRight: {
      alignItems: 'flex-end',
    },
    skeletonBox: {
      backgroundColor: colors.border,
      borderRadius: 6,
    },
    // (tab bar removed — held orders shown inline)
    // Held orders styles
    heldOrderItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: cardBackground,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: cardBorder,
      padding: 16,
      marginBottom: 12,
      ...shadows.sm,
    },
    heldOrderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      gap: 12,
    },
    heldOrderInfo: {
      flex: 1,
    },
    heldOrderName: {
      fontSize: 16,
      fontFamily: fonts.semiBold,
      color: colors.text,
      marginBottom: 4,
    },
    heldOrderMeta: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
    },
    heldOrderRight: {
      alignItems: 'flex-end',
      marginRight: 10,
    },
    heldOrderTotal: {
      fontSize: 17,
      fontFamily: fonts.bold,
      color: colors.text,
      marginBottom: 4,
    },
    heldOrderTapText: {
      fontSize: 12,
      fontFamily: fonts.regular,
      color: colors.textMuted,
    },
    heldDeleteAction: {
      backgroundColor: colors.error,
      justifyContent: 'center',
      alignItems: 'center',
      width: 80,
      borderRadius: 16,
      marginLeft: 12,
    },
    heldDeleteText: {
      fontSize: 12,
      fontFamily: fonts.medium,
      color: '#fff',
      marginTop: 4,
    },
    emptyHeldContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 40,
      backgroundColor: 'transparent',
    },
    emptyHeldTitle: {
      fontSize: 20,
      fontFamily: fonts.semiBold,
      color: colors.text,
      marginTop: 16,
      marginBottom: 8,
    },
    emptyHeldSubtitle: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
    },
  });
};
