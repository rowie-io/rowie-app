import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  FlatList,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { floorPlansApi, sessionsApi, type Table, type Session } from '../lib/api/sessions';
import { formatCurrency } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { useTranslations } from '../lib/i18n';

type RouteParams = {
  FloorPlan: {
    mode?: 'view' | 'assign';
    floorPlanId?: string;
  };
};

const STATUS_COLORS: Record<string, string> = {
  available: '#22C55E',
  occupied: '#F59E0B',
  reserved: '#A855F7',
  cleaning: '#78716C',
};

export function FloorPlanScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'FloorPlan'>>();
  const { currency } = useAuth();
  const { selectedCatalog } = useCatalog();
  const queryClient = useQueryClient();
  const t = useTranslations('floorPlan');

  const [selectedFloorPlanId, setSelectedFloorPlanId] = useState<string | null>(
    route.params?.floorPlanId || null
  );

  // Create a new session on an unoccupied table
  const createSessionMutation = useMutation({
    mutationFn: (tableId: string) => {
      if (!selectedCatalog) throw new Error('No catalog selected');
      return sessionsApi.create({
        catalogId: selectedCatalog.id,
        tableId,
        source: 'pos',
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['floor-plans'] });
      navigation.navigate('SessionDetail', { sessionId: result.session.id });
    },
    onError: (err: any) => {
      // If the race landed on an already-open session, just navigate there.
      const existingSessionId = err?.details?.existingSessionId;
      if (err?.code === 'TABLE_ALREADY_HAS_SESSION' && existingSessionId) {
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        navigation.navigate('SessionDetail', { sessionId: existingSessionId });
        return;
      }
      Alert.alert(t('failedStartSessionTitle'), err?.error || err?.message || t('failedStartSessionMessage'));
    },
  });

  // Fetch floor plans
  const { data: floorPlansData, isLoading: loadingPlans, isError: floorPlansError, refetch: refetchPlans } = useQuery({
    queryKey: ['floor-plans'],
    queryFn: floorPlansApi.list,
  });

  const floorPlans = useMemo(() => floorPlansData?.floorPlans || [], [floorPlansData]);

  // Auto-select first floor plan once loaded
  useEffect(() => {
    if (!selectedFloorPlanId && floorPlans.length > 0) {
      setSelectedFloorPlanId(floorPlans[0].id);
    }
  }, [floorPlans, selectedFloorPlanId]);

  // Fetch tables for selected floor plan
  const { data: floorPlanData, isLoading: loadingTables, refetch: refetchTables, isRefetching: refetchingTables } = useQuery({
    queryKey: ['floor-plans', selectedFloorPlanId],
    queryFn: () => floorPlansApi.get(selectedFloorPlanId!),
    enabled: !!selectedFloorPlanId,
  });

  // Fetch active sessions
  const { data: sessionsData, refetch: refetchSessions } = useQuery({
    queryKey: ['sessions', { status: 'open' }],
    queryFn: () => sessionsApi.list({ status: 'open', limit: 50 }),
  });

  const handleRefresh = useCallback(() => {
    refetchTables();
    refetchSessions();
  }, [refetchTables, refetchSessions]);

  const tables = floorPlanData?.tables || [];
  const sessions = sessionsData?.sessions || [];

  // Map sessions to tables
  const tableSessionMap = useMemo(() => {
    const map = new Map<string, Session>();
    for (const session of sessions) {
      if (session.tableId) {
        map.set(session.tableId, session);
      }
    }
    return map;
  }, [sessions]);

  const handleTablePress = useCallback((table: Table) => {
    const session = tableSessionMap.get(table.id);
    if (session) {
      navigation.navigate('SessionDetail', { sessionId: session.id });
      return;
    }
    // No active session — offer to start one
    if (!selectedCatalog) {
      Alert.alert(t('noMenuTitle'), t('noMenuMessage'));
      return;
    }
    Alert.alert(
      t('startSessionPromptTitle', { label: table.label }),
      t('startSessionPromptMessage'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('startSessionAction'), onPress: () => createSessionMutation.mutate(table.id) },
      ],
    );
  }, [navigation, tableSessionMap, selectedCatalog, createSessionMutation, t]);

  if (loadingPlans) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={t('loading')} />
        </View>
      </SafeAreaView>
    );
  }

  if (floorPlansError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel={t('goBack')}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
            {t('headerTitle')}
          </Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color="#EF4444" />
          <Text style={[styles.emptyText, { color: colors.text }]} maxFontSizeMultiplier={1.5} accessibilityRole="alert">
            {t('errorTitle')}
          </Text>
          <Text style={[styles.emptySubtext, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
            {t('errorSubtitle')}
          </Text>
          <TouchableOpacity
            onPress={() => refetchPlans()}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, backgroundColor: colors.primary, minHeight: 44 }}
            accessibilityRole="button"
            accessibilityLabel={t('retryAccessibilityLabel')}
          >
            <Ionicons name="refresh" size={18} color="#1C1917" />
            <Text style={{ fontSize: 15, fontFamily: fonts.bold, color: '#1C1917' }} maxFontSizeMultiplier={1.3}>
              {t('retryButton')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (floorPlans.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel={t('goBack')}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
            {t('headerTitle')}
          </Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.center}>
          <Ionicons name="grid-outline" size={48} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
            {t('noFloorPlansTitle')}
          </Text>
          <Text style={[styles.emptySubtext, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
            {t('noFloorPlansSubtitle')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('goBack')}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
          {t('headerTitle')}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Floor plan tabs */}
      {floorPlans.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsContainer}
        >
          {floorPlans.map((fp) => (
            <TouchableOpacity
              key={fp.id}
              onPress={() => setSelectedFloorPlanId(fp.id)}
              style={[
                styles.tab,
                {
                  backgroundColor: selectedFloorPlanId === fp.id ? colors.primary : colors.surface,
                  borderColor: selectedFloorPlanId === fp.id ? colors.primary : colors.border,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={fp.name}
              accessibilityState={{ selected: selectedFloorPlanId === fp.id }}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: selectedFloorPlanId === fp.id ? '#1C1917' : colors.textSecondary },
                ]}
                maxFontSizeMultiplier={1.3}
              >
                {fp.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Table grid */}
      {loadingTables ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={t('loadingTables')} />
        </View>
      ) : (
        <FlatList
          data={tables}
          numColumns={3}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.gridContainer}
          refreshControl={
            <RefreshControl
              refreshing={refetchingTables}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item: table }) => {
            const session = tableSessionMap.get(table.id);
            const statusColor = STATUS_COLORS[table.status] || STATUS_COLORS.available;
            const translatedStatus = t(
              `status${table.status.charAt(0).toUpperCase()}${table.status.slice(1)}`,
            );
            const tableAccessibilityLabel = session
              ? t('tableAccessibilityLabelWithSession', {
                  label: table.label,
                  status: translatedStatus,
                  count: session.itemCount,
                })
              : t('tableAccessibilityLabel', {
                  label: table.label,
                  status: translatedStatus,
                });

            return (
              <TouchableOpacity
                style={[
                  styles.tableCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: session ? statusColor : colors.border,
                    borderWidth: session ? 2 : 1,
                  },
                ]}
                onPress={() => handleTablePress(table)}
                accessibilityRole="button"
                accessibilityLabel={tableAccessibilityLabel}
              >
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.tableLabel, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {table.label}
                </Text>
                <Text style={[styles.tableCapacity, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                  {t('seats', { count: table.capacity })}
                </Text>
                {session && (
                  <Text style={[styles.tableAmount, { color: colors.primary }]} maxFontSizeMultiplier={1.2}>
                    {formatCurrency(session.subtotal, currency)}
                  </Text>
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                {t('noTablesOnFloorPlan')}
              </Text>
            </View>
          }
        />
      )}

      {/* Legend */}
      <View style={[styles.legend, { borderTopColor: colors.border }]}>
        {Object.keys(STATUS_COLORS).map((status) => (
          <View key={status} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS[status] }]} />
            <Text style={[styles.legendText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
              {t(`legend${status.charAt(0).toUpperCase()}${status.slice(1)}`)}
            </Text>
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
  },
  tabsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  tabText: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
  gridContainer: {
    padding: 16,
    gap: 12,
  },
  tableCard: {
    flex: 1,
    margin: 4,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    minHeight: 100,
    gap: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 4,
  },
  tableLabel: {
    fontSize: 16,
    fontFamily: fonts.bold,
  },
  tableCapacity: {
    fontSize: 12,
    fontFamily: fonts.regular,
  },
  tableAmount: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    marginTop: 4,
  },
  emptyText: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    fontFamily: fonts.regular,
    textAlign: 'center',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
    fontFamily: fonts.regular,
  },
});
