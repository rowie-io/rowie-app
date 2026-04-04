import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Animated,
  Vibration,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useSocketEvent, useSocket, SocketEvents } from '../context/SocketContext';
import { usePreorders } from '../context/PreordersContext';
import { useCatalog } from '../context/CatalogContext';
import { preordersApi, Preorder, PreorderStatus } from '../lib/api/preorders';
import { formatCurrency } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { EmptyState } from '../components/EmptyState';
import { shadows } from '../lib/shadows';
import { useTranslations } from '../lib/i18n';
type TabType = 'new' | 'preparing' | 'ready';

const TAB_LABEL_KEYS: Record<TabType, string> = {
  new: 'tabNew',
  preparing: 'tabMaking',
  ready: 'tabReady',
};

const TAB_STATUSES: { key: TabType; statuses: PreorderStatus[] }[] = [
  { key: 'new', statuses: ['pending'] },
  { key: 'preparing', statuses: ['preparing'] },
  { key: 'ready', statuses: ['ready'] },
];

function formatTimeAgo(dateString: string, t: (key: string, params?: Record<string, string>) => string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffMins < 1) return t('timeJustNow');
  if (diffMins < 60) return t('timeMinutesAgo', { minutes: String(diffMins) });
  if (diffHours < 24) return t('timeHoursAgo', { hours: String(diffHours) });
  return t('timeDaysAgo', { days: String(Math.floor(diffHours / 24)) });
}

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
      return t('statusNewOrder');
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
    <Animated.View style={{ opacity: pulseAnim, flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.border, marginRight: 12 }} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={{ width: '55%', height: 13, borderRadius: 6, backgroundColor: colors.border }} />
        <View style={{ width: '30%', height: 11, borderRadius: 5, backgroundColor: colors.border }} />
      </View>
      <View style={{ width: 50, height: 13, borderRadius: 6, backgroundColor: colors.border }} />
    </Animated.View>
  );
}

// Skeleton loading state
function LoadingContent({ colors }: { colors: any; isDark: boolean }) {
  return (
    <View style={loadingStyles.container}>
      <View style={{ backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, marginHorizontal: 20, overflow: 'hidden', width: '100%', maxWidth: 400, alignSelf: 'center' }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i}>
            <SkeletonRow colors={colors} />
            {i < 3 && <View style={{ height: 1, backgroundColor: colors.divider, marginLeft: 64 }} />}
          </View>
        ))}
      </View>
    </View>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingTop: 16,
    backgroundColor: 'transparent',
  },
});

export function PreordersScreen() {
  const { colors, isDark } = useTheme();
  const { currency } = useAuth();
  const navigation = useNavigation<any>();
  const { isConnected } = useSocket();
  const { counts, refreshCounts } = usePreorders();
  const { selectedCatalog } = useCatalog();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const t = useTranslations('preorders');
  // Seed from prefetch cache if available
  const prefetchedPending = queryClient.getQueryData<{ preorders: Preorder[] }>(['preorders', 'pending']);

  const [activeTab, setActiveTab] = useState<TabType>('new');
  const [preorders, setPreorders] = useState<Preorder[]>(prefetchedPending?.preorders || []);
  const [isLoading, setIsLoading] = useState(!prefetchedPending);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const wasConnectedRef = useRef(isConnected);
  const hasEverConnectedRef = useRef(false);

  // Per-tab cache so switching tabs is instant
  const tabCacheRef = useRef<Record<string, Preorder[]>>(
    prefetchedPending?.preorders ? { new: prefetchedPending.preorders } : {}
  );

  // Derive tab counts from context (with safety check)
  const tabCounts = {
    new: counts?.pending || 0,
    preparing: counts?.preparing || 0,
    ready: counts?.ready || 0,
  };

  const styles = createStyles(colors, isDark);

  const fetchPreorders = useCallback(async () => {
    if (!selectedCatalog) return;
    try {
      const tab = TAB_STATUSES.find(ts => ts.key === activeTab)!;
      const response = await preordersApi.list({ status: tab.statuses, catalogId: selectedCatalog.id });
      tabCacheRef.current[activeTab] = response.preorders;
      setPreorders(response.preorders);
    } catch (error) {
      // Silently ignore
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [activeTab, selectedCatalog]);

  // Clear per-tab cache when catalog changes
  const prevCatalogIdRef = useRef(selectedCatalog?.id);
  useEffect(() => {
    if (selectedCatalog?.id !== prevCatalogIdRef.current) {
      tabCacheRef.current = {};
      prevCatalogIdRef.current = selectedCatalog?.id;
    }
  }, [selectedCatalog]);

  // On tab switch: show cached data immediately, refetch in background
  useEffect(() => {
    const cached = tabCacheRef.current[activeTab];
    if (cached) {
      setPreorders(cached);
      setIsLoading(false);
    } else {
      setPreorders([]);
      setIsLoading(true);
    }
    fetchPreorders();
  }, [activeTab, fetchPreorders]);

  // Refetch list + counts when screen gains focus (e.g. navigating back from detail)
  useFocusEffect(
    useCallback(() => {
      tabCacheRef.current = {};
      fetchPreorders();
      refreshCounts();
    }, [fetchPreorders, refreshCounts])
  );

  // Refetch when socket REconnects (not initial connection)
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current && hasEverConnectedRef.current) {
      fetchPreorders();
      refreshCounts();
    }
    if (isConnected) hasEverConnectedRef.current = true;
    wasConnectedRef.current = isConnected;
  }, [isConnected, fetchPreorders, refreshCounts]);

  // Listen for preorder events via socket - clear all tab caches and refetch
  const handlePreorderCreated = useCallback((_data: any) => {
    // Play notification sound/vibration for new orders
    if (Platform.OS !== 'web') {
      Vibration.vibrate([0, 200, 100, 200]);
    }
    tabCacheRef.current = {};
    fetchPreorders();
  }, [fetchPreorders]);

  const handlePreorderChanged = useCallback((_data: any) => {
    tabCacheRef.current = {};
    fetchPreorders();
  }, [fetchPreorders]);

  useSocketEvent(SocketEvents.PREORDER_CREATED, handlePreorderCreated);
  useSocketEvent(SocketEvents.PREORDER_UPDATED, handlePreorderChanged);
  useSocketEvent(SocketEvents.PREORDER_COMPLETED, handlePreorderChanged);
  useSocketEvent(SocketEvents.PREORDER_CANCELLED, handlePreorderChanged);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchPreorders();
    refreshCounts();
  };

  const handlePreorderPress = (preorder: Preorder) => {
    navigation.navigate('PreorderDetail', { preorderId: preorder.id });
  };

  const renderPreorderItem = ({ item }: { item: Preorder }) => {
    const itemCount = item.items?.length || 0;
    const statusColor = getStatusColor(item.status, colors);

    return (
      <TouchableOpacity
        style={styles.orderCard}
        onPress={() => handlePreorderPress(item)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={t('orderAccessibilityLabel', { dailyNumber: String(item.dailyNumber), customerName: item.customerName || t('customerFallbackName'), statusLabel: getStatusLabel(item.status, t), total: formatCurrency(item.totalAmount || 0, currency) })}
        accessibilityHint={t('orderAccessibilityHint')}
      >
        <View style={styles.orderHeader}>
          <View style={styles.orderTitleRow}>
            <Text style={styles.orderNumber} maxFontSizeMultiplier={1.3}>#{item.dailyNumber}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]} maxFontSizeMultiplier={1.5}>
                {getStatusLabel(item.status, t)}
              </Text>
            </View>
          </View>
          <View style={styles.orderTimeRow}>
            <Text style={styles.orderTime} maxFontSizeMultiplier={1.5}>{item.createdAt ? formatTimeAgo(item.createdAt, t) : '—'}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </View>
        </View>

        <View style={styles.customerRow}>
          <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.customerName} maxFontSizeMultiplier={1.5}>{item.customerName || t('customerFallbackName')}</Text>
          {item.tableIdentifier && (
            <View style={styles.tableBadge}>
              <Ionicons name="restaurant-outline" size={12} color={colors.textSecondary} />
              <Text style={styles.tableBadgeText} maxFontSizeMultiplier={1.5}>{item.tableIdentifier}</Text>
            </View>
          )}
          {item.paymentType === 'pay_now' && (
            <View style={styles.paidBadge}>
              <Ionicons name="checkmark-circle" size={14} color={colors.success} />
              <Text style={styles.paidText} maxFontSizeMultiplier={1.5}>{t('paidBadgeText')}</Text>
            </View>
          )}
          {item.paymentType === 'pay_at_pickup' && (
            <View style={styles.unpaidBadge}>
              <Ionicons name="card-outline" size={14} color={colors.warning} />
              <Text style={styles.unpaidText} maxFontSizeMultiplier={1.5}>{t('payAtPickupBadgeText')}</Text>
            </View>
          )}
        </View>

        <View style={styles.orderDetails}>
          <View style={styles.orderInfo}>
            <Text style={styles.itemCount} maxFontSizeMultiplier={1.5}>
              {itemCount === 1 ? t('itemCountSingular', { count: String(itemCount) }) : t('itemCountPlural', { count: String(itemCount) })}
            </Text>
            {item.orderNotes && (
              <View style={styles.notesIndicator}>
                <Ionicons name="document-text-outline" size={14} color={colors.textSecondary} />
                <Text style={styles.notesText} numberOfLines={1} maxFontSizeMultiplier={1.5}>
                  {item.orderNotes}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.orderTotal} maxFontSizeMultiplier={1.3}>
            {formatCurrency(item.totalAmount || 0, currency)}
          </Text>
        </View>

      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => {
    const emptyConfig: Record<TabType, { titleKey: string; subtitleKey: string }> = {
      new: {
        titleKey: 'emptyNewOrdersTitle',
        subtitleKey: 'emptyNewOrdersSubtitle',
      },
      preparing: {
        titleKey: 'emptyPreparingTitle',
        subtitleKey: 'emptyPreparingSubtitle',
      },
      ready: {
        titleKey: 'emptyReadyTitle',
        subtitleKey: 'emptyReadySubtitle',
      },
    };
    const config = emptyConfig[activeTab];

    return (
      <EmptyState
        icon="receipt-outline"
        title={t(config.titleKey)}
        subtitle={t(config.subtitleKey)}
      />
    );
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>{t('headerTitle')}</Text>
      <View style={styles.tabBar}>
        {TAB_STATUSES.map(tab => {
          const count = tabCounts[tab.key];
          const isActive = activeTab === tab.key;
          const label = t(TAB_LABEL_KEYS[tab.key]);
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
              accessibilityRole="button"
              accessibilityLabel={typeof count === 'number' && count > 0 ? t('tabAccessibilityLabel', { label, count: String(count) }) : label}
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]} maxFontSizeMultiplier={1.3}>
                {label}
              </Text>
              {typeof count === 'number' && count > 0 ? (
                <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
                  <Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]} maxFontSizeMultiplier={1.3}>
                    {String(count)}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  if (isLoading && preorders.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          {renderHeader()}
          <LoadingContent colors={colors} isDark={isDark} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {renderHeader()}
        <FlatList
          data={preorders}
          keyExtractor={(item) => item.id}
          renderItem={renderPreorderItem}
          contentContainerStyle={[
            styles.listContent,
            preorders.length === 0 && styles.emptyListContent,
          ]}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          showsVerticalScrollIndicator={false}
        />
      </View>
    </View>
  );
}

const createStyles = (colors: any, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerContainer: {
      paddingTop: 4,
    },
    headerTitle: {
      fontSize: 22,
      fontFamily: fonts.bold,
      color: colors.text,
      letterSpacing: -0.3,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    tabBar: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      gap: 12,
    },
    tab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tabActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    tabText: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
    },
    tabTextActive: {
      color: '#fff',
      fontFamily: fonts.semiBold,
    },
    tabBadge: {
      backgroundColor: colors.primary + '20',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
    },
    tabBadgeActive: {
      backgroundColor: 'rgba(255,255,255,0.3)',
    },
    tabBadgeText: {
      fontSize: 12,
      fontFamily: fonts.semiBold,
      color: colors.primary,
    },
    tabBadgeTextActive: {
      color: '#fff',
    },
    listContent: {
      padding: 16,
      gap: 12,
    },
    emptyListContent: {
      flex: 1,
    },
    orderCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadows.sm,
    },
    orderHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 10,
    },
    orderTimeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    orderTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    orderNumber: {
      fontSize: 18,
      fontFamily: fonts.bold,
      color: colors.text,
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 12,
      gap: 4,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    statusText: {
      fontSize: 12,
      fontFamily: fonts.semiBold,
    },
    orderTime: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
    },
    customerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
      gap: 6,
    },
    customerName: {
      fontSize: 15,
      fontFamily: fonts.medium,
      color: colors.text,
      flex: 1,
    },
    tableBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.border,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 8,
    },
    tableBadgeText: {
      fontSize: 11,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
    },
    paidBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    paidText: {
      fontSize: 12,
      fontFamily: fonts.semiBold,
      color: colors.success,
    },
    unpaidBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    unpaidText: {
      fontSize: 12,
      fontFamily: fonts.semiBold,
      color: colors.warning,
    },
    orderDetails: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
    },
    orderInfo: {
      flex: 1,
    },
    itemCount: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
      marginBottom: 4,
    },
    notesIndicator: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    notesText: {
      fontSize: 13,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      flex: 1,
    },
    orderTotal: {
      fontSize: 20,
      fontFamily: fonts.bold,
      color: colors.text,
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 40,
    },
    emptyTitle: {
      fontSize: 20,
      fontFamily: fonts.semiBold,
      color: colors.text,
      marginTop: 16,
      marginBottom: 8,
    },
    emptySubtitle: {
      fontSize: 15,
      fontFamily: fonts.regular,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
    },
  });
