import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
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
import { sessionsApi, type Session } from '../lib/api/sessions';
import { formatCurrency } from '../utils/currency';
import { fonts } from '../lib/fonts';

export function TabsScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const { currency } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['sessions', 'tabs'],
    queryFn: sessionsApi.listTabs,
  });

  const tabs = data?.tabs || [];

  // Invalidate on session events
  const handleSessionChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['sessions', 'tabs'] });
  }, [queryClient]);

  useSocketEvent(SocketEvents.SESSION_CREATED, handleSessionChange);
  useSocketEvent(SocketEvents.SESSION_UPDATED, handleSessionChange);
  useSocketEvent(SocketEvents.SESSION_SETTLED, handleSessionChange);
  useSocketEvent(SocketEvents.SESSION_CANCELLED, handleSessionChange);

  const handleOpenTab = useCallback(() => {
    navigation.navigate('OpenTab');
  }, [navigation]);

  const handleTabPress = useCallback(
    (session: Session) => {
      navigation.navigate('SessionDetail', { sessionId: session.id });
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
          accessibilityLabel="Go back"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
          Tabs
        </Text>
        <TouchableOpacity
          onPress={handleOpenTab}
          style={[styles.newButton, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel="Open a new tab"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="add" size={18} color="#1C1917" />
          <Text style={styles.newButtonText} maxFontSizeMultiplier={1.3}>
            New
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Loading tabs" />
        </View>
      ) : (
        <FlatList
          data={tabs}
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
            <TabCard session={item} currency={currency} onPress={() => handleTabPress(item)} />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.primary + '15' }]}>
                <Ionicons name="wallet-outline" size={32} color={colors.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                No open tabs
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                Tap "New" to start a tab. The guest taps their card and it's saved for later.
              </Text>
              <TouchableOpacity
                onPress={handleOpenTab}
                style={[styles.emptyButton, { backgroundColor: colors.primary }]}
                accessibilityRole="button"
                accessibilityLabel="Open a new tab"
              >
                <Ionicons name="add" size={18} color="#1C1917" />
                <Text style={styles.emptyButtonText} maxFontSizeMultiplier={1.3}>
                  Open a Tab
                </Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

interface TabCardProps {
  session: Session;
  currency: string;
  onPress: () => void;
}

const TabCard = React.memo(function TabCard({ session, currency, onPress }: TabCardProps) {
  const { colors } = useTheme();
  const elapsed = useMemo(() => getElapsed(session.openedAt), [session.openedAt]);
  const displayName = session.holdName || session.customerName || session.sessionNumber;

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityRole="button"
      accessibilityLabel={`Tab ${displayName}, ${session.itemCount} items, ${formatCurrency(session.subtotal, currency)}`}
    >
      <View style={styles.cardLeft}>
        <View style={[styles.cardIcon, { backgroundColor: colors.primary + '20' }]}>
          <Ionicons name="wallet" size={20} color={colors.primary} />
        </View>
        <View style={styles.cardInfo}>
          <Text
            style={[styles.cardName, { color: colors.text }]}
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          <Text
            style={[styles.cardMeta, { color: colors.textMuted }]}
            maxFontSizeMultiplier={1.5}
            numberOfLines={1}
          >
            {session.itemCount} {session.itemCount === 1 ? 'item' : 'items'} · {elapsed}
          </Text>
        </View>
      </View>
      <View style={styles.cardRight}>
        <Text
          style={[styles.cardAmount, { color: colors.text }]}
          maxFontSizeMultiplier={1.2}
        >
          {formatCurrency(session.subtotal, currency)}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
});

function getElapsed(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { fontSize: 18, fontFamily: fonts.bold },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    minHeight: 44,
  },
  newButtonText: { fontSize: 14, fontFamily: fonts.bold, color: '#1C1917' },
  listContent: { padding: 16, gap: 12, flexGrow: 1 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    minHeight: 72,
    marginBottom: 12,
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: { flex: 1, gap: 2 },
  cardName: { fontSize: 15, fontFamily: fonts.semiBold },
  cardMeta: { fontSize: 12, fontFamily: fonts.regular },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 12 },
  cardAmount: { fontSize: 16, fontFamily: fonts.bold },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 18, fontFamily: fonts.bold, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, fontFamily: fonts.regular, textAlign: 'center', lineHeight: 20 },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    minHeight: 44,
    marginTop: 8,
  },
  emptyButtonText: { fontSize: 15, fontFamily: fonts.bold, color: '#1C1917' },
});
