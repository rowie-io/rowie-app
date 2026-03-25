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
import { glass } from '../lib/colors';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { StarBackground } from '../components/StarBackground';

type TabType = 'new' | 'preparing' | 'ready';

const TABS: { key: TabType; label: string; statuses: PreorderStatus[] }[] = [
  { key: 'new', label: 'New', statuses: ['pending'] },
  { key: 'preparing', label: 'Making', statuses: ['preparing'] },
  { key: 'ready', label: 'Ready', statuses: ['ready'] },
];

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
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

function getStatusLabel(status: PreorderStatus): string {
  switch (status) {
    case 'pending':
      return 'New Order';
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

// Central glowing star for loading
function GlowingStar({ size = 32, color, glowColor, pulseAnim }: { size?: number; color: string; glowColor: string; pulseAnim: Animated.Value }) {
  return (
    <Animated.View style={{
      width: size * 2,
      height: size * 2,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: pulseAnim,
      transform: [{ scale: pulseAnim }],
    }}>
      <View style={{
        position: 'absolute',
        width: size * 1.5,
        height: size * 1.5,
        borderRadius: size,
        backgroundColor: glowColor,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: size,
      }} />
      <View style={{
        position: 'absolute',
        width: 3,
        height: size,
        backgroundColor: color,
        borderRadius: 1.5,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
      }} />
      <View style={{
        position: 'absolute',
        width: size,
        height: 3,
        backgroundColor: color,
        borderRadius: 1.5,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 8,
      }} />
      <View style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: color,
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 10,
      }} />
    </Animated.View>
  );
}

// Loading state with glowing star animation
function LoadingContent({ colors, isDark }: { colors: any; isDark: boolean }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.7)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 8000,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const starColor = isDark ? '#fff' : colors.primary;
  const glowColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(99,102,241,0.2)';

  return (
    <Animated.View style={[loadingStyles.container, { opacity: fadeAnim }]}>
      <Animated.View style={{ transform: [{ rotate: rotation }] }}>
        <GlowingStar size={36} color={starColor} glowColor={glowColor} pulseAnim={pulseAnim} />
      </Animated.View>
    </Animated.View>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  const glassColors = isDark ? glass.dark : glass.light;

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

  const styles = createStyles(colors, glassColors, isDark);

  const fetchPreorders = useCallback(async () => {
    if (!selectedCatalog) return;
    try {
      const tab = TABS.find(t => t.key === activeTab)!;
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
        accessibilityLabel={`Order ${item.dailyNumber}, ${item.customerName || 'Customer'}, ${getStatusLabel(item.status)}, ${formatCurrency(item.totalAmount || 0, currency)}`}
        accessibilityHint="Double tap to view order details"
      >
        <View style={styles.orderHeader}>
          <View style={styles.orderTitleRow}>
            <Text style={styles.orderNumber} maxFontSizeMultiplier={1.3}>#{item.dailyNumber}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]} maxFontSizeMultiplier={1.5}>
                {getStatusLabel(item.status)}
              </Text>
            </View>
          </View>
          <View style={styles.orderTimeRow}>
            <Text style={styles.orderTime} maxFontSizeMultiplier={1.5}>{item.createdAt ? formatTimeAgo(item.createdAt) : '—'}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </View>
        </View>

        <View style={styles.customerRow}>
          <Ionicons name="person-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.customerName} maxFontSizeMultiplier={1.5}>{item.customerName || 'Customer'}</Text>
          {item.paymentType === 'pay_now' && (
            <View style={styles.paidBadge}>
              <Ionicons name="checkmark-circle" size={14} color={colors.success} />
              <Text style={styles.paidText} maxFontSizeMultiplier={1.5}>Paid</Text>
            </View>
          )}
          {item.paymentType === 'pay_at_pickup' && (
            <View style={styles.unpaidBadge}>
              <Ionicons name="card-outline" size={14} color={colors.warning} />
              <Text style={styles.unpaidText} maxFontSizeMultiplier={1.5}>Pay at Pickup</Text>
            </View>
          )}
        </View>

        <View style={styles.orderDetails}>
          <View style={styles.orderInfo}>
            <Text style={styles.itemCount} maxFontSizeMultiplier={1.5}>
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
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
    const emptyConfig: Record<TabType, { title: string; subtitle: string }> = {
      new: {
        title: 'No New Orders',
        subtitle: 'New orders will appear here.',
      },
      preparing: {
        title: 'No Orders In Progress',
        subtitle: 'In-progress orders will appear here.',
      },
      ready: {
        title: 'No Orders Ready',
        subtitle: 'Completed orders will appear here.',
      },
    };
    const config = emptyConfig[activeTab];

    return (
      <View style={styles.emptyState}>
        <Ionicons name="receipt-outline" size={64} color={colors.textMuted} />
        <Text style={styles.emptyTitle} maxFontSizeMultiplier={1.3}>{config.title}</Text>
        <Text style={styles.emptySubtitle} maxFontSizeMultiplier={1.5}>{config.subtitle}</Text>
      </View>
    );
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <Text style={styles.headerTitle} maxFontSizeMultiplier={1.3}>Orders</Text>
      <View style={styles.tabBar}>
        {TABS.map(tab => {
          const count = tabCounts[tab.key];
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
              accessibilityRole="button"
              accessibilityLabel={`${tab.label}${typeof count === 'number' && count > 0 ? `, ${count} orders` : ''}`}
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]} maxFontSizeMultiplier={1.3}>
                {tab.label}
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
      <StarBackground colors={colors} isDark={isDark}>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          {renderHeader()}
          <LoadingContent colors={colors} isDark={isDark} />
        </View>
      </StarBackground>
    );
  }

  return (
    <StarBackground colors={colors} isDark={isDark}>
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
    </StarBackground>
  );
}

const createStyles = (colors: any, glassColors: typeof glass.dark, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: 'transparent',
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
      backgroundColor: glassColors.backgroundElevated,
      borderWidth: 1,
      borderColor: glassColors.border,
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
      backgroundColor: glassColors.backgroundElevated,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: glassColors.border,
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
