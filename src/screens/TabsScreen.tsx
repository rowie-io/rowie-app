import React, { useCallback, useEffect, useMemo, useRef } from 'react';
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
import { useTranslations } from '../lib/i18n';

export function TabsScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const { currency, organization } = useAuth();
  const queryClient = useQueryClient();
  const t = useTranslations('tabs');

  const { data, isLoading, refetch, isRefetching, isError } = useQuery({
    queryKey: ['sessions', 'tabs'],
    queryFn: sessionsApi.listTabs,
  });

  const tabs = data?.tabs || [];

  // Defense-in-depth: ignore SESSION_* emits for other orgs so a future
  // room-scoping regression can't silently invalidate this device's open
  // tabs cache with another org's session payload.
  const orgIdRef = useRef(organization?.id);
  useEffect(() => {
    orgIdRef.current = organization?.id;
  }, [organization?.id]);
  const isMyOrg = useCallback((data: any): boolean => {
    if (!data?.organizationId) return true;
    return !!orgIdRef.current && data.organizationId === orgIdRef.current;
  }, []);

  // Invalidate on session events
  const handleSessionChange = useCallback((data: any) => {
    if (!isMyOrg(data)) return;
    queryClient.invalidateQueries({ queryKey: ['sessions', 'tabs'] });
  }, [queryClient, isMyOrg]);

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
          accessibilityLabel={t('goBack')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
          {t('headerTitle')}
        </Text>
        <TouchableOpacity
          onPress={handleOpenTab}
          style={[styles.newButton, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel={t('openTabAccessibilityLabel')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="add" size={18} color="#1C1917" />
          <Text style={styles.newButtonText} maxFontSizeMultiplier={1.3}>
            {t('newButton')}
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={t('loadingTabs')} />
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
            <Ionicons name="refresh" size={18} color="#1C1917" />
            <Text style={styles.emptyButtonText} maxFontSizeMultiplier={1.3}>
              {t('retryButton')}
            </Text>
          </TouchableOpacity>
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
                {t('emptyTitle')}
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                {t('emptySubtitle')}
              </Text>
              <TouchableOpacity
                onPress={handleOpenTab}
                style={[styles.emptyButton, { backgroundColor: colors.primary }]}
                accessibilityRole="button"
                accessibilityLabel={t('openTabAccessibilityLabel')}
              >
                <Ionicons name="add" size={18} color="#1C1917" />
                <Text style={styles.emptyButtonText} maxFontSizeMultiplier={1.3}>
                  {t('emptyButton')}
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
  const t = useTranslations('tabs');
  const elapsed = useMemo(() => getElapsed(session.openedAt, t), [session.openedAt, t]);
  const displayName = session.holdName || session.customerName || session.sessionNumber;
  const itemWord = session.itemCount === 1 ? t('itemSingular') : t('itemPlural');
  const amount = formatCurrency(session.subtotal, currency);
  const itemCountText =
    session.itemCount === 1
      ? t('itemCountSingular', { count: session.itemCount })
      : t('itemCountPlural', { count: session.itemCount });

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityRole="button"
      accessibilityLabel={t('tabCardAccessibilityLabel', {
        displayName,
        count: session.itemCount,
        itemWord,
        amount,
      })}
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
            {itemCountText} · {elapsed}
          </Text>
        </View>
      </View>
      <View style={styles.cardRight}>
        <Text
          style={[styles.cardAmount, { color: colors.text }]}
          maxFontSizeMultiplier={1.2}
        >
          {amount}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
});

function getElapsed(dateString: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return t('timeSecondsAgo', { count: diff });
  if (diff < 3600) return t('timeMinutesAgo', { count: Math.floor(diff / 60) });
  if (diff < 86400) return t('timeHoursAgo', { count: Math.floor(diff / 3600) });
  return t('timeDaysAgo', { count: Math.floor(diff / 86400) });
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
