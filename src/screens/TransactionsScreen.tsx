import React, { useState, useRef, useCallback, useEffect, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Pressable,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useDevice } from '../context/DeviceContext';
import { useSocketEvent, useSocket, SocketEvents } from '../context/SocketContext';
import { transactionsApi, Transaction, ordersApi, Order } from '../lib/api';
import { getDeviceId } from '../lib/device';
import { formatCents } from '../utils/currency';
import { glass } from '../lib/colors';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { Swipeable } from 'react-native-gesture-handler';
import { useTapToPayGuard } from '../hooks';

type TabType = 'transactions' | 'held';

type TransactionsScreenParams = {
  History: {
    initialTab?: TabType;
  };
};

// Empty state content (no longer needs star background - parent has it)
function EmptyTransactionsContent({ colors, isDark }: { colors: any; isDark: boolean }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View style={[emptyStyles.container, { opacity: fadeAnim }]}>
      <View style={emptyStyles.content}>
        <View style={[emptyStyles.iconContainer, {
          backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(245,158,11,0.1)',
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(245,158,11,0.15)'
        }]}>
          <Ionicons name="receipt-outline" size={44} color={isDark ? 'rgba(255,255,255,0.95)' : colors.primary} />
        </View>
        <Text maxFontSizeMultiplier={1.2} style={[emptyStyles.title, { color: isDark ? '#fff' : colors.text }]}>
          No transactions yet
        </Text>
        <Text maxFontSizeMultiplier={1.5} style={[emptyStyles.subtitle, { color: isDark ? 'rgba(255,255,255,0.55)' : colors.textSecondary }]}>
          Transactions will appear here after you accept payments
        </Text>
      </View>
    </Animated.View>
  );
}

const emptyStyles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    zIndex: 10,
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
  },
  title: {
    fontSize: 24,
    fontFamily: fonts.bold,
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: fonts.regular,
    textAlign: 'center',
    lineHeight: 22,
  },
});

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

// Loading state content (no longer needs star background - parent has it)
function LoadingTransactionsContent({ colors, isDark }: { colors: any; isDark: boolean }) {
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
  const glowColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(245,158,11,0.2)';

  return (
    <Animated.View style={[emptyStyles.container, { opacity: fadeAnim }]}>
      <View style={emptyStyles.content}>
        <Animated.View style={{ transform: [{ rotate: rotation }] }}>
          <GlowingStar size={36} color={starColor} glowColor={glowColor} pulseAnim={pulseAnim} />
        </Animated.View>
      </View>
    </Animated.View>
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
}: {
  item: Transaction;
  onPress: () => void;
  colors: any;
  styles: any;
  getStatusColor: (status: string) => string;
  getStatusLabel: (status: string) => string;
  formatDate: (timestamp: number) => string;
  currency: string;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

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
      if (item.itemCount && item.itemCount > 0) parts.push(`${item.itemCount} item${item.itemCount > 1 ? 's' : ''}`);
      return parts.join(' • ') || 'Preorder';
    }
    // Default: order
    if (item.paymentMethod?.type === 'cash') return 'Cash';
    if (item.paymentMethod?.type === 'split') return 'Split Payment';
    if (item.paymentMethod?.brand && item.paymentMethod?.last4)
      return `${item.paymentMethod.brand.toUpperCase()} ****${item.paymentMethod.last4}`;
    if (item.paymentMethod?.last4) return `Card ****${item.paymentMethod.last4}`;
    return 'Card payment';
  };

  const getSourceBadge = () => {
    if (item.sourceType === 'preorder') {
      return { label: item.dailyNumber ? `Preorder #${item.dailyNumber}` : 'Preorder', color: '#a855f7' };
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
      accessibilityLabel={`Transaction ${formatCents(item.amount, currency)}, ${getStatusLabel(item.status)}, ${formatDate(item.created)}${item.sourceType === 'preorder' ? ', preorder' : ''}`}
      accessibilityHint="View transaction details"
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
                {formatCents(item.amount, currency)}
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
  const { currency } = useAuth();
  const { selectedCatalog } = useCatalog();
  const { deviceId } = useDevice();
  const { isConnected } = useSocket();
  const navigation = useNavigation<any>();
  const { guardCheckout } = useTapToPayGuard();
  const route = useRoute<RouteProp<TransactionsScreenParams, 'History'>>();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const glassColors = isDark ? glass.dark : glass.light;
  const [activeTab, setActiveTab] = useState<TabType>('transactions');
  const [filter, setFilter] = useState<FilterType>('all');
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const wasConnectedRef = useRef(isConnected);
  const hasEverConnectedRef = useRef(false);

  // Held orders state - seed from prefetch cache if available
  const prefetchedHeld = queryClient.getQueryData<{ orders: Order[] }>(['held-orders', deviceId]);
  const [heldOrders, setHeldOrders] = useState<Order[]>(prefetchedHeld?.orders || []);
  const [isLoadingHeld, setIsLoadingHeld] = useState(false);
  const [isRefreshingHeld, setIsRefreshingHeld] = useState(false);
  const hasFetchedHeldRef = useRef(!!prefetchedHeld);

  // Handle initialTab route param - switch tabs when navigating with initialTab
  useEffect(() => {
    const initialTab = route.params?.initialTab;
    if (initialTab) {
      setActiveTab(initialTab);
      // Force refresh if switching to held tab
      if (initialTab === 'held') {
        setIsLoadingHeld(true);
        // Small delay to ensure state update happens first
        setTimeout(() => {
          ordersApi.listHeld(deviceId || undefined).then(response => {
            setHeldOrders(response.orders);
            setIsLoadingHeld(false);
          }).catch(error => {
            setIsLoadingHeld(false);
          });
        }, 100);
      }
      // Clear the param to prevent re-triggering on subsequent focuses
      navigation.setParams({ initialTab: undefined });
    }
  }, [route.params?.initialTab, navigation, deviceId]);

  // Fetch held orders
  const fetchHeldOrders = useCallback(async () => {
    try {
      const response = await ordersApi.listHeld(deviceId || undefined);
      hasFetchedHeldRef.current = true;
      setHeldOrders(response.orders);
    } catch (error: any) {
    } finally {
      setIsLoadingHeld(false);
      setIsRefreshingHeld(false);
    }
  }, [deviceId]);

  // Load held orders on first visit only - socket events keep it in sync after that
  useEffect(() => {
    if (activeTab === 'held' && !hasFetchedHeldRef.current) {
      setIsLoadingHeld(true);
      fetchHeldOrders();
    }
  }, [activeTab]);

  // Refetch when socket REconnects (not initial connection)
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current && hasEverConnectedRef.current) {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      fetchHeldOrders();
    }
    if (isConnected) hasEverConnectedRef.current = true;
    wasConnectedRef.current = isConnected;
  }, [isConnected, queryClient, activeTab, fetchHeldOrders]);

  // Auto-refresh transactions when payment events occur
  const handlePaymentEvent = useCallback((data: any) => {
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
  }, [queryClient]);

  useSocketEvent(SocketEvents.ORDER_COMPLETED, handlePaymentEvent);
  useSocketEvent(SocketEvents.PAYMENT_RECEIVED, handlePaymentEvent);
  useSocketEvent(SocketEvents.ORDER_REFUNDED, handlePaymentEvent);
  useSocketEvent(SocketEvents.PREORDER_COMPLETED, handlePaymentEvent);
  useSocketEvent(SocketEvents.PREORDER_CANCELLED, handlePaymentEvent);

  // Listen for held order updates via socket
  const handleHeldOrderUpdated = useCallback((data: any) => {
    // Refresh held orders when any order is held or resumed
    if (data.status === 'held' || data.status === 'pending') {
      fetchHeldOrders();
    }
  }, [fetchHeldOrders]);

  const handleHeldOrderCreated = useCallback((data: any) => {
    // Refresh if a new held order is created
    if (data.status === 'held') {
      fetchHeldOrders();
    }
  }, [fetchHeldOrders]);

  const handleHeldOrderDeleted = useCallback((data: any) => {
    // Remove the deleted order from the list
    if (data.orderId) {
      setHeldOrders(prev => prev.filter(o => o.id !== data.orderId));
    }
  }, []);

  useSocketEvent(SocketEvents.ORDER_UPDATED, handleHeldOrderUpdated);
  useSocketEvent(SocketEvents.ORDER_CREATED, handleHeldOrderCreated);
  useSocketEvent(SocketEvents.ORDER_DELETED, handleHeldOrderDeleted);

  // Refetch stale data when the tab gains focus (catches any missed socket events)
  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    }, [queryClient])
  );

  const {
    data,
    isLoading,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['transactions', selectedCatalog?.id, filter],
    queryFn: ({ pageParam }) =>
      transactionsApi.list({
        limit: 25,
        starting_after: pageParam,
        catalog_id: selectedCatalog?.id,
        status: filter,
      }),
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore || lastPage.data.length === 0) return undefined;
      return lastPage.data[lastPage.data.length - 1].id;
    },
    initialPageParam: undefined as string | undefined,
  });

  // Filtering is now done server-side via the status query parameter
  const transactions = data?.pages.flatMap((page) => page.data) || [];

  const styles = createStyles(colors, glassColors, isDark);

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
        return 'Succeeded';
      case 'refunded':
        return 'Refunded';
      case 'partially_refunded':
        return 'Partial Refund';
      case 'failed':
        return 'Failed';
      case 'pending':
        return 'Pending';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  }, []);

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
    if (item.sourceType === 'preorder') {
      navigation.navigate('TransactionDetail', { id: item.id, sourceType: 'preorder' });
    } else {
      navigation.navigate('TransactionDetail', { id: item.id });
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
    />
  ), [handleTransactionPress, colors, styles, getStatusColor, getStatusLabel, formatDate, currency]);

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

  const handleRefreshHeld = async () => {
    setIsRefreshingHeld(true);
    await fetchHeldOrders();
  };

  const handleResumeOrder = async (order: Order) => {
    if (!guardCheckout()) return;
    try {
      const resumedOrder = await ordersApi.resume(order.id);
      navigation.navigate('Checkout', {
        resumedOrderId: order.id,
        resumedOrder: resumedOrder,
      });
    } catch (error: any) {
      Alert.alert('Error', error.error || error.message || 'Failed to resume order');
    }
  };

  const handleCancelOrder = async (order: Order) => {
    Alert.alert(
      'Cancel Order',
      `Are you sure you want to cancel "${order.holdName || `Order #${order.orderNumber}`}"?`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Order',
          style: 'destructive',
          onPress: async () => {
            try {
              await ordersApi.cancel(order.id);
              setHeldOrders(prev => prev.filter(o => o.id !== order.id));
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to cancel order');
            }
          },
        },
      ]
    );
  };

  const formatTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const renderHeldOrder = ({ item }: { item: Order }) => {
    const itemCount = item.itemCount || item.items?.length || 0;

    const renderRightActions = () => (
      <TouchableOpacity
        style={styles.heldDeleteAction}
        onPress={() => handleCancelOrder(item)}
        accessibilityRole="button"
        accessibilityLabel={`Cancel ${item.holdName || `Order ${item.orderNumber}`}`}
      >
        <Ionicons name="trash-outline" size={22} color="#fff" />
        <Text maxFontSizeMultiplier={1.3} style={styles.heldDeleteText}>Cancel</Text>
      </TouchableOpacity>
    );

    return (
      <Swipeable
        renderRightActions={renderRightActions}
        overshootRight={false}
      >
        <TouchableOpacity
          style={styles.heldOrderItem}
          onPress={() => handleResumeOrder(item)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${item.holdName || `Order ${item.orderNumber}`}, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}, ${formatCents(item.totalAmount, currency)}`}
          accessibilityHint="Tap to resume this order"
        >
          <View style={styles.heldOrderLeft}>
            <Ionicons name="time-outline" size={20} color={colors.primary} />
            <View style={styles.heldOrderInfo}>
              <Text maxFontSizeMultiplier={1.5} style={styles.heldOrderName} numberOfLines={1}>
                {item.holdName || `Order #${item.orderNumber}`}
              </Text>
              <Text maxFontSizeMultiplier={1.5} style={styles.heldOrderMeta}>
                {itemCount} {itemCount === 1 ? 'item' : 'items'} • {item.heldAt ? formatTimeAgo(item.heldAt) : ''}
              </Text>
            </View>
          </View>
          <View style={styles.heldOrderRight}>
            <Text maxFontSizeMultiplier={1.3} style={styles.heldOrderTotal}>
              {formatCents(item.totalAmount, currency)}
            </Text>
            <Text maxFontSizeMultiplier={1.5} style={styles.heldOrderTapText}>Tap to resume</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </Swipeable>
    );
  };

  const renderEmptyHeld = () => (
    <View style={styles.emptyHeldContainer}>
      <Ionicons name="pause-circle-outline" size={64} color={colors.textMuted} />
      <Text maxFontSizeMultiplier={1.3} style={styles.emptyHeldTitle}>No Held Orders</Text>
      <Text maxFontSizeMultiplier={1.5} style={styles.emptyHeldSubtitle}>
        Orders you put on hold will appear here.{'\n'}
        Tap "Hold Order" at checkout to save an order for later.
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.headerContainer}>
          <Text maxFontSizeMultiplier={1.3} style={styles.title}>History</Text>
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'transactions' && styles.tabActive]}
              onPress={() => setActiveTab('transactions')}
              accessibilityRole="button"
              accessibilityLabel="Transactions"
              accessibilityState={{ selected: activeTab === 'transactions' }}
            >
              <Text maxFontSizeMultiplier={1.3} style={[styles.tabText, activeTab === 'transactions' && styles.tabTextActive]}>
                Transactions
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'held' && styles.tabActive]}
              onPress={() => setActiveTab('held')}
              accessibilityRole="button"
              accessibilityLabel={`Held Orders${heldOrders.length > 0 ? `, ${heldOrders.length} orders` : ''}`}
              accessibilityState={{ selected: activeTab === 'held' }}
            >
              <Text maxFontSizeMultiplier={1.3} style={[styles.tabText, activeTab === 'held' && styles.tabTextActive]}>
                Held Orders
              </Text>
              {heldOrders.length > 0 && (
                <View style={styles.tabBadge}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.tabBadgeText}>{heldOrders.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {activeTab === 'held' ? (
          // Held Orders Tab
          isLoadingHeld ? (
            <LoadingTransactionsContent colors={colors} isDark={isDark} />
          ) : heldOrders.length === 0 ? (
            renderEmptyHeld()
          ) : (
            <FlatList
              data={heldOrders}
              renderItem={renderHeldOrder}
              keyExtractor={(item) => item.id}
              contentContainerStyle={[styles.list, { flexGrow: 1 }]}
              style={styles.listContainer}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshingHeld}
                  onRefresh={handleRefreshHeld}
                  tintColor={colors.primary}
                />
              }
            />
          )
        ) : (
          // Transactions Tab
          <>
            {/* Filter Tabs */}
            <View style={styles.filterContainer}>
              {(['all', 'succeeded', 'refunded', 'failed'] as FilterType[]).map((f) => {
                const isActive = filter === f;
                // Use solid colors in dark mode to prevent stars showing through
                const filterColors = isDark ? {
                  all: { bg: 'rgba(245, 158, 11, 0.06)', border: '#44403C', text: colors.primary },
                  succeeded: { bg: '#0a1a0f', border: '#0f2a17', text: colors.success },
                  refunded: { bg: '#1a1408', border: '#2a200d', text: colors.warning },
                  failed: { bg: '#1a0a0a', border: '#2a0f0f', text: colors.error },
                } : {
                  all: { bg: colors.primary + '20', border: colors.primary + '40', text: colors.primary },
                  succeeded: { bg: colors.success + '20', border: colors.success + '40', text: colors.success },
                  refunded: { bg: colors.warning + '20', border: colors.warning + '40', text: colors.warning },
                  failed: { bg: colors.error + '20', border: colors.error + '40', text: colors.error },
                };
                const colorSet = filterColors[f];

                return (
                  <TouchableOpacity
                    key={f}
                    style={[
                      styles.filterTab,
                      isActive && { backgroundColor: colorSet.bg, borderColor: colorSet.border },
                    ]}
                    onPress={() => setFilter(f)}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter by ${f === 'all' ? 'all statuses' : f}`}
                    accessibilityState={{ selected: isActive }}
                  >
                    <Text
                      maxFontSizeMultiplier={1.3}
                      style={[
                        styles.filterText,
                        isActive && { color: colorSet.text, fontFamily: fonts.semiBold },
                      ]}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {isLoading ? (
              <LoadingTransactionsContent colors={colors} isDark={isDark} />
            ) : transactions.length === 0 ? (
              <EmptyTransactionsContent colors={colors} isDark={isDark} />
            ) : (
              <FlatList
                data={transactions}
                renderItem={renderTransaction}
                keyExtractor={(item) => `${item.sourceType || 'order'}-${item.id}`}
                contentContainerStyle={[styles.list, { flexGrow: 1 }]}
                style={styles.listContainer}
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
        )}
      </View>
    </View>
  );
}

const createStyles = (colors: any, glassColors: typeof glass.dark, isDark: boolean) => {
  // Card backgrounds - solid colors matching the stone-800 brand palette
  const cardBackground = isDark ? '#292524' : 'rgba(255,255,255,0.85)';
  const cardBorder = isDark ? '#292524' : 'rgba(0,0,0,0.08)';

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerContainer: {
      paddingTop: 4,
    },
    title: {
      fontSize: 22,
      fontFamily: fonts.bold,
      color: colors.text,
      letterSpacing: -0.3,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    filterContainer: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 8,
      backgroundColor: 'transparent',
    },
    filterTab: {
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 16,
      backgroundColor: cardBackground,
      borderWidth: 1.5,
      borderColor: cardBorder,
    },
    filterText: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
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
      color: colors.textMuted,
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
      backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
      marginRight: 14,
    },
    skeletonInfo: {
      flex: 1,
    },
    skeletonRight: {
      alignItems: 'flex-end',
    },
    skeletonBox: {
      backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
      borderRadius: 6,
    },
    // Tab bar styles
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
      backgroundColor: 'rgba(255,255,255,0.3)',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
    },
    tabBadgeText: {
      fontSize: 12,
      fontFamily: fonts.semiBold,
      color: '#fff',
    },
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
