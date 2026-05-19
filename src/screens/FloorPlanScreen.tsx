import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
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
import { useCart } from '../context/CartContext';
import { floorPlansApi, sessionsApi, type Table, type Session } from '../lib/api/sessions';
import { fonts } from '../lib/fonts';
import { useTranslations } from '../lib/i18n';
import { TableTile } from '../components/TableTile';
import { TABLE_STATUS_COLORS, type TableStatus } from '../lib/tableStatus';

type RouteParams = {
  FloorPlan: {
    mode?: 'view' | 'assign';
    floorPlanId?: string;
  };
};

// Legend covers the 5 live-runtime states. `merged` / `unavailable` exist on
// the vendor's editor canvas but aren't yet surfaced to the mobile POS.
const LEGEND_STATES: TableStatus[] = ['empty', 'active', 'aging', 'urgent', 'check_requested'];

export function FloorPlanScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'FloorPlan'>>();
  const { currentLocationId, subscription } = useAuth();
  const isProTier = subscription?.tier === 'pro' || subscription?.tier === 'enterprise';
  const { selectedCatalog } = useCatalog();
  const { serviceMode, setTable } = useCart();
  const queryClient = useQueryClient();
  const t = useTranslations('floorPlan');

  const [selectedFloorPlanId, setSelectedFloorPlanId] = useState<string | null>(
    route.params?.floorPlanId || null
  );

  // When the active location changes, drop the selected floor plan so the
  // auto-select effect picks the first plan from the new location's set.
  // The /floor-plans query cache is already cleared by LocationPickerScreen,
  // so the next query refetches against the new X-Location-Id.
  useEffect(() => {
    setSelectedFloorPlanId(null);
  }, [currentLocationId]);

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
  const floorPlanCanvasSize = useMemo(() => {
    const fp = floorPlanData?.floorPlan;
    // Fall back to a sensible default for legacy plans that didn't persist
    // width/height. 1000x700 matches the vendor editor's default canvas.
    return {
      width: Math.max(fp?.width || 0, 1000),
      height: Math.max(fp?.height || 0, 700),
    };
  }, [floorPlanData]);
  const sessions = sessionsData?.sessions || [];

  // Tick every 30s so the elapsed-time labels on each TableTile stay fresh
  // without forcing a refetch. Single state bump at this parent level.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Map sessions to tables. Index secondaries too so a QR scan on a merged
  // table (or a stray UI click on it during a merge race) lands on the right
  // session.
  const tableSessionMap = useMemo(() => {
    const map = new Map<string, Session>();
    for (const session of sessions) {
      if (session.tableId) map.set(session.tableId, session);
      (session.mergedTableIds || []).forEach((tid) => map.set(tid, session));
    }
    return map;
  }, [sessions]);

  // For merge rendering: the primary table of a merge inherits the sum of all
  // its merged secondaries' capacities (so seats around the perimeter reflect
  // the combined party). Secondaries get 0 (no seats — they're absorbed).
  const effectiveCapacities = useMemo(() => {
    const caps = new Map<string, number>();
    const byId = new Map(tables.map((t) => [t.id, t]));
    for (const session of sessions) {
      const merged = session.mergedTableIds || [];
      if (merged.length === 0 || !session.tableId) continue;
      const primaryCap = byId.get(session.tableId)?.capacity || 0;
      let extra = 0;
      for (const tid of merged) {
        extra += byId.get(tid)?.capacity || 0;
        caps.set(tid, 0);
      }
      caps.set(session.tableId, primaryCap + extra);
    }
    return caps;
  }, [sessions, tables]);

  // Merge-mode state — set when the operator picks "Merge with another table"
  // from a session's action sheet. While set, available tables pulse purple
  // and tapping one fires `POST /sessions/{id}/merge`. Cancelling via the
  // banner clears the state without mutating anything.
  const [mergeSessionId, setMergeSessionId] = useState<string | null>(null);
  const mergeMutation = useMutation({
    mutationFn: ({ sessionId, tableId }: { sessionId: string; tableId: string }) =>
      sessionsApi.mergeTables(sessionId, tableId),
    onSuccess: () => {
      setMergeSessionId(null);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['floor-plans'] });
    },
    onError: (err: any) => {
      Alert.alert('Merge failed', err?.error || err?.message || 'Could not merge that table.');
    },
  });

  const handleTablePress = useCallback((table: Table) => {
    // Merge mode short-circuits — tapping any available table merges it into
    // the source session instead of navigating.
    if (mergeSessionId) {
      const targetSession = tableSessionMap.get(table.id);
      if (targetSession || table.status === 'merged' || table.status === 'unavailable') {
        return; // not a valid merge target
      }
      mergeMutation.mutate({ sessionId: mergeSessionId, tableId: table.id });
      return;
    }
    const session = tableSessionMap.get(table.id);
    if (session) {
      navigation.navigate('SessionDetail', { sessionId: session.id });
      return;
    }
    // In Table Service mode the table tap is "pick this table for the next
    // order" — set cart attribution and bounce back to Menu. Sessions stay
    // available via long-press / SessionDetail navigation elsewhere.
    if (serviceMode === 'table_service') {
      setTable({ id: table.id, label: table.label });
      // goBack returns to whichever screen launched FloorPlan (typically the
      // mode-chip tap from MenuScreen). Avoids a fragile `.navigate('Menu')`
      // call that fails if the tab navigator isn't in scope.
      if (navigation.canGoBack()) {
        navigation.goBack();
      }
      return;
    }
    // Quick Service / management mode — offer to start a session
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
  }, [navigation, tableSessionMap, selectedCatalog, createSessionMutation, serviceMode, setTable, t, mergeSessionId, mergeMutation]);

  // Long-press on a table → per-table action sheet. For an occupied table the
  // primary action is "Merge with another table"; for a merged primary we
  // additionally offer to unmerge specific secondaries. Cancel always exits.
  const unmergeMutation = useMutation({
    mutationFn: ({ sessionId, tableId }: { sessionId: string; tableId: string }) =>
      sessionsApi.unmergeTable(sessionId, tableId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['floor-plans'] });
    },
    onError: (err: any) => {
      Alert.alert('Unmerge failed', err?.error || err?.message || 'Could not split that table.');
    },
  });

  const handleTableLongPress = useCallback((table: Table) => {
    if (mergeSessionId) return; // already in merge mode — long-press is a no-op
    const session = tableSessionMap.get(table.id);
    if (!session) return; // empty table: nothing to do via long-press (yet)
    const merged = session.mergedTableIds || [];
    const isPrimary = session.tableId === table.id;
    const options: Array<{ text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }> = [];
    if (isPrimary) {
      options.push({
        text: 'Merge with another table',
        onPress: () => setMergeSessionId(session.id),
      });
      if (merged.length > 0) {
        options.push({
          text: `Unmerge (${merged.length})`,
          style: 'destructive',
          onPress: () => {
            // Pop a follow-up sheet listing secondaries to unmerge. Most flows
            // only merge one extra table, so doing them one-tap is fine.
            const secondaryLabels = tables.filter((t) => merged.includes(t.id));
            const followUp: typeof options = secondaryLabels.map((s) => ({
              text: `Unmerge ${s.label}`,
              onPress: () => unmergeMutation.mutate({ sessionId: session.id, tableId: s.id }),
            }));
            followUp.push({ text: 'Cancel', style: 'cancel' });
            Alert.alert('Unmerge which table?', '', followUp);
          },
        });
      }
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    if (options.length === 1) return; // nothing actionable
    Alert.alert(`Table ${table.label}`, '', options);
  }, [mergeSessionId, tableSessionMap, tables, unmergeMutation]);

  // Pro gate — non-Pro accounts shouldn't be here even if they reach the
  // screen via a stale nav stack or a deeplink. Defensive sibling to the
  // mode-chip gate in MenuScreen. Only fire after the subscription has
  // actually loaded — otherwise on first paint `subscription` is undefined
  // (still hydrating from cache), we'd flash the gate, and the useQuery
  // refetch race would leave tables painted before sessions arrive.
  if (subscription && subscription.tier && !isProTier) {
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
          <Ionicons name="diamond-outline" size={48} color={colors.primary} />
          <Text
            style={[styles.emptyText, { color: colors.text, marginTop: 12 }]}
            maxFontSizeMultiplier={1.3}
            accessibilityRole="header"
          >
            Table service is Pro
          </Text>
          <Text
            style={[styles.emptySubtext, { color: colors.textSecondary, marginHorizontal: 20 }]}
            maxFontSizeMultiplier={1.5}
          >
            Upgrade to manage floor plans, tables, and table-side ordering.
          </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Upgrade' as never)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              marginTop: 16,
              paddingHorizontal: 22,
              paddingVertical: 12,
              borderRadius: 14,
              backgroundColor: colors.primary,
              minHeight: 44,
            }}
            accessibilityRole="button"
            accessibilityLabel="Upgrade to Pro"
          >
            <Ionicons name="diamond" size={16} color="#1C1917" />
            <Text style={{ fontSize: 15, fontFamily: fonts.bold, color: '#1C1917' }} maxFontSizeMultiplier={1.3}>
              Upgrade to Pro
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

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

      {/* Merge-mode banner — surfaces the pending merge so the operator can't
          forget they're in the middle of a multi-step action. Tapping any
          available table fires the merge. Cancel here exits without mutating. */}
      {mergeSessionId && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(168, 85, 247, 0.15)',
            borderColor: '#A855F7',
            borderWidth: 1,
            borderRadius: 12,
            marginHorizontal: 16,
            marginBottom: 8,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
          accessibilityRole="alert"
        >
          <Text
            style={{ color: '#E9D5FF', fontFamily: fonts.semiBold, fontSize: 13, flex: 1 }}
            maxFontSizeMultiplier={1.5}
          >
            Tap a free table to merge it in.
          </Text>
          <TouchableOpacity
            onPress={() => setMergeSessionId(null)}
            accessibilityRole="button"
            accessibilityLabel="Cancel merge"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ marginLeft: 12 }}
          >
            <Text style={{ color: '#F5F5F4', fontFamily: fonts.bold, fontSize: 13 }} maxFontSizeMultiplier={1.3}>
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Scrollable 2D canvas — outer vertical ScrollView wraps a horizontal
          one so both axes can pan. Content View is sized to the floor plan's
          authored dimensions so tables at their absolute (x,y) land in the
          right spot. */}
      {loadingTables ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={t('loadingTables')} />
        </View>
      ) : tables.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
            {t('noTablesOnFloorPlan')}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.canvasOuter}
          contentContainerStyle={styles.canvasOuterContent}
          refreshControl={
            <RefreshControl
              refreshing={refetchingTables}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            contentContainerStyle={styles.canvasInnerContent}
          >
            <View
              style={[
                styles.canvas,
                {
                  width: floorPlanCanvasSize.width,
                  height: floorPlanCanvasSize.height,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              {tables.map((table) => {
                const session = tableSessionMap.get(table.id) || null;
                const isAvailableTarget = !session && table.status !== 'merged' && table.status !== 'unavailable';
                return (
                  <TableTile
                    key={table.id}
                    table={table}
                    session={session}
                    onPress={() => handleTablePress(table)}
                    onLongPress={() => handleTableLongPress(table)}
                    now={tick}
                    effectiveCapacity={effectiveCapacities.get(table.id)}
                    mergeTargetMode={!!mergeSessionId && isAvailableTarget}
                  />
                );
              })}
            </View>
          </ScrollView>
        </ScrollView>
      )}

      {/* Legend — matches the vendor portal's runtime legend so a server
          reading the chip on phone and dashboard sees the same vocabulary. */}
      <View style={[styles.legend, { borderTopColor: colors.border }]}>
        {LEGEND_STATES.map((status) => {
          const palette = TABLE_STATUS_COLORS[status];
          return (
            <View key={status} style={styles.legendItem}>
              <View
                style={[
                  styles.legendDot,
                  {
                    backgroundColor: palette.fill,
                    borderColor: palette.border,
                    borderWidth: 1,
                  },
                ]}
              />
              <Text
                style={[styles.legendText, { color: colors.textSecondary }]}
                maxFontSizeMultiplier={1.5}
              >
                {palette.label}
              </Text>
            </View>
          );
        })}
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
  canvasOuter: {
    flex: 1,
  },
  canvasOuterContent: {
    padding: 12,
  },
  canvasInnerContent: {
    paddingRight: 12,
  },
  canvas: {
    position: 'relative',
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
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
