import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  RefreshControl,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useDevice } from '../context/DeviceContext';
import { useSocketEvent, SocketEvents } from '../context/SocketContext';
import { ordersApi, Order } from '../lib/api';
import { formatCents } from '../utils/currency';
import { glass } from '../lib/colors';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { useTapToPayGuard } from '../hooks';

function formatTimeAgo(dateString: string): string {
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

export function HeldOrdersScreen() {
  const { colors, isDark } = useTheme();
  const { currency } = useAuth();
  const { deviceId } = useDevice();
  const navigation = useNavigation<any>();
  const { guardCheckout } = useTapToPayGuard();
  const glassColors = isDark ? glass.dark : glass.light;

  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);

  const styles = createStyles(colors, glassColors, isDark);

  const fetchHeldOrders = useCallback(async () => {
    try {
      const response = await ordersApi.listHeld(deviceId || undefined);
      setOrders(response.orders);
    } catch (error: any) {
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [deviceId]);

  // Refresh when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      fetchHeldOrders();
    }, [fetchHeldOrders])
  );

  // Listen for order updates via socket (new held orders, resumed orders, etc.)
  const handleOrderUpdated = useCallback((data: any) => {
    // Refresh held orders when any order is updated (held or resumed)
    if (data.status === 'held' || data.status === 'pending') {
      fetchHeldOrders();
    }
  }, [fetchHeldOrders]);

  const handleOrderCreated = useCallback((data: any) => {
    // Refresh if a new held order is created
    if (data.status === 'held') {
      fetchHeldOrders();
    }
  }, [fetchHeldOrders]);

  const handleOrderDeleted = useCallback((data: any) => {
    // Remove the deleted order from the list
    if (data.orderId) {
      setOrders(prev => prev.filter(o => o.id !== data.orderId));
    }
  }, []);

  useSocketEvent(SocketEvents.ORDER_UPDATED, handleOrderUpdated);
  useSocketEvent(SocketEvents.ORDER_CREATED, handleOrderCreated);
  useSocketEvent(SocketEvents.ORDER_DELETED, handleOrderDeleted);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchHeldOrders();
  };

  const handleResumeOrder = async (order: Order) => {
    if (isResuming) return; // Prevent double-tap
    if (!guardCheckout()) return;

    setIsResuming(true);
    try {
      const resumedOrder = await ordersApi.resume(order.id);
      // Navigate to checkout with the resumed order
      navigation.navigate('Checkout', {
        resumedOrderId: order.id,
        resumedOrder: resumedOrder,
      });
    } catch (error: any) {
      Alert.alert('Error', error.error || error.message || 'Failed to resume order');
    } finally {
      setIsResuming(false);
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
              setOrders(prev => prev.filter(o => o.id !== order.id));
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to cancel order');
            }
          },
        },
      ]
    );
  };

  const renderRightActions = (order: Order) => {
    return (
      <TouchableOpacity
        style={styles.deleteAction}
        onPress={() => handleCancelOrder(order)}
        accessibilityRole="button"
        accessibilityLabel={`Cancel order ${order.holdName || order.orderNumber}`}
      >
        <Ionicons name="trash-outline" size={24} color="#fff" />
        <Text style={styles.deleteActionText} maxFontSizeMultiplier={1.3}>Cancel</Text>
      </TouchableOpacity>
    );
  };

  const renderOrderItem = ({ item }: { item: Order }) => {
    const itemCount = item.itemCount || item.items?.length || 0;

    return (
      <Swipeable
        renderRightActions={() => renderRightActions(item)}
        overshootRight={false}
      >
        <TouchableOpacity
          style={[styles.orderCard, isResuming && styles.orderCardDisabled]}
          onPress={() => handleResumeOrder(item)}
          activeOpacity={0.7}
          disabled={isResuming}
          accessibilityRole="button"
          accessibilityLabel={`${item.holdName || `Order ${item.orderNumber}`}, ${(item.itemCount || item.items?.length || 0)} items, ${formatCents(item.totalAmount, currency)}`}
          accessibilityHint="Double tap to resume this order"
        >
          <View style={styles.orderHeader}>
            <View style={styles.orderTitleRow}>
              <Ionicons name="time-outline" size={20} color={colors.primary} />
              <Text style={styles.orderName} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {item.holdName || `Order #${item.orderNumber}`}
              </Text>
            </View>
            <Text style={styles.orderTime} maxFontSizeMultiplier={1.5}>
              {item.heldAt ? formatTimeAgo(item.heldAt) : ''}
            </Text>
          </View>

          <View style={styles.orderDetails}>
            <View style={styles.orderInfo}>
              <Text style={styles.itemCount} maxFontSizeMultiplier={1.5}>
                {itemCount} {itemCount === 1 ? 'item' : 'items'}
              </Text>
              {item.notes && (
                <View style={styles.notesIndicator}>
                  <Ionicons name="document-text-outline" size={14} color={colors.textSecondary} />
                  <Text style={styles.notesText} numberOfLines={1} maxFontSizeMultiplier={1.5}>
                    {item.notes}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.orderTotal} maxFontSizeMultiplier={1.3}>
              {formatCents(item.totalAmount, currency)}
            </Text>
          </View>

          <View style={styles.resumeHint}>
            <Text style={styles.resumeHintText} maxFontSizeMultiplier={1.3}>Tap to resume</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </View>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="pause-circle-outline" size={64} color={colors.textMuted} />
      <Text style={styles.emptyTitle} maxFontSizeMultiplier={1.3}>No Held Orders</Text>
      <Text style={styles.emptySubtitle} maxFontSizeMultiplier={1.5}>
        Orders you put on hold will appear here.{'\n'}
        Tap "Hold Order" at checkout to save an order for later.
      </Text>
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingContent colors={colors} isDark={isDark} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        renderItem={renderOrderItem}
        contentContainerStyle={[
          styles.listContent,
          orders.length === 0 && styles.emptyListContent,
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
    </SafeAreaView>
  );
}

const createStyles = (colors: any, glassColors: typeof glass.dark, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
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
    orderCardDisabled: {
      opacity: 0.5,
    },
    orderHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    orderTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    orderName: {
      fontSize: 17,
      fontFamily: fonts.semiBold,
      color: colors.text,
      flex: 1,
    },
    orderTime: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
    },
    orderDetails: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginBottom: 12,
    },
    orderInfo: {
      flex: 1,
    },
    itemCount: {
      fontSize: 15,
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
    resumeHint: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: glassColors.borderSubtle,
      gap: 4,
    },
    resumeHintText: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.textMuted,
    },
    deleteAction: {
      backgroundColor: colors.error,
      justifyContent: 'center',
      alignItems: 'center',
      width: 80,
      borderRadius: 16,
      marginLeft: 12,
    },
    deleteActionText: {
      fontSize: 12,
      fontFamily: fonts.medium,
      color: '#fff',
      marginTop: 4,
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
