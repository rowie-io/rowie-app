import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useCart } from '../context/CartContext';
import { useSocketEvent, SocketEvents } from '../context/SocketContext';
import { floorPlansApi, sessionsApi, type Table, type Session } from '../lib/api/sessions';
import { fonts } from '../lib/fonts';
import { useTranslations } from '../lib/i18n';
import { TableTile } from '../components/TableTile';
import { EmptyState } from '../components/EmptyState';
import { TABLE_STATUS_COLORS, type TableStatus } from '../lib/tableStatus';

type RouteParams = {
  FloorPlan: {
    mode?: 'view' | 'send';
    floorPlanId?: string;
    /** Entering with this set starts merge mode for the given session —
     *  used by SessionDetail's "Merge with another table" action. */
    mergeSessionId?: string;
  };
};

/** AsyncStorage flag for the one-time "hold a table for more options" hint. */
const LONG_PRESS_HINT_KEY = 'rowie_fp_longpress_hint_dismissed';

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
  const { items: cartItems, itemCount: cartItemCount, clearCart, orderNotes } = useCart();
  const queryClient = useQueryClient();
  const t = useTranslations('floorPlan');

  // "Send mode" — entered from MenuScreen's 'Send to table' CTA with items in
  // the cart. While in this mode, a tap on any table commits the cart as a
  // new round on that table's session (creating one if the table is empty).
  const isSendMode = route.params?.mode === 'send' && cartItemCount > 0;

  const [selectedFloorPlanId, setSelectedFloorPlanId] = useState<string | null>(
    route.params?.floorPlanId || null
  );

  // Persist the selected floor-plan tab per-location so going to SessionDetail
  // (or any other screen) and coming back lands the user on the same plan
  // they were viewing. The auto-select effect below validates the restored id
  // against the freshly-fetched plans list — if the persisted plan was deleted
  // or moved we silently fall back to the first available.
  const flpStorageKey = currentLocationId ? `rowie_floor_plan_${currentLocationId}` : null;

  // When the active location changes, drop the in-memory selection then load
  // whatever was persisted for the new location. The /floor-plans query cache
  // is already cleared by LocationPickerScreen, so the next query refetches
  // against the new X-Location-Id.
  useEffect(() => {
    setSelectedFloorPlanId(null);
    if (!flpStorageKey) return;
    AsyncStorage.getItem(flpStorageKey).then((saved) => {
      if (saved) setSelectedFloorPlanId(saved);
    }).catch(() => {});
  }, [currentLocationId, flpStorageKey]);

  // Persist on every explicit pick. Wrap setter so the storage write is
  // a single call-site update, not scattered across handlers.
  const pickFloorPlan = useCallback((id: string) => {
    setSelectedFloorPlanId(id);
    if (flpStorageKey) AsyncStorage.setItem(flpStorageKey, id).catch(() => {});
  }, [flpStorageKey]);

  // Create a new (empty) session on an unoccupied table — used outside of
  // send-mode when a server just wants to seat people without ordering yet.
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

  // Send the current cart to a table as a new round. If the table already has
  // an open session, append; otherwise create a fresh session with the items
  // pre-loaded. On success we clear the cart and bounce back to Menu.
  const sendMutation = useMutation({
    mutationFn: async (table: Table) => {
      if (!selectedCatalog) throw new Error('No catalog selected');
      const payload = cartItems.map((it) => ({
        catalogProductId: it.product.id,
        quantity: it.quantity,
        notes: it.notes,
      }));
      // Kitchen note for this round — taken from cart's orderNotes which the
      // Menu screen lets the operator edit before tapping Send. Empty string
      // → undefined so we don't write blank notes rows.
      const kitchenNote = orderNotes.trim() || undefined;
      const existing = tableSessionMap.get(table.id);
      if (existing) {
        await sessionsApi.addItems(existing.id, payload, kitchenNote);
        return { tableLabel: table.label, sessionId: existing.id };
      }
      const result = await sessionsApi.create({
        catalogId: selectedCatalog.id,
        tableId: table.id,
        source: 'pos',
        items: payload,
        roundNotes: kitchenNote,
      });
      return { tableLabel: table.label, sessionId: result.session.id };
    },
    onSuccess: ({ tableLabel }) => {
      clearCart();
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['floor-plans'] });
      if (navigation.canGoBack()) navigation.goBack();
      Alert.alert('Sent', `Sent to ${tableLabel}.`);
    },
    onError: (err: any) => {
      // Race: someone else opened a session on this table between our cache
      // and the create call. Retry as addItems against the returned session.
      const existingSessionId = err?.details?.existingSessionId;
      if (err?.code === 'TABLE_ALREADY_HAS_SESSION' && existingSessionId) {
        const payload = cartItems.map((it) => ({
          catalogProductId: it.product.id,
          quantity: it.quantity,
          notes: it.notes,
        }));
        sessionsApi
          .addItems(existingSessionId, payload, orderNotes.trim() || undefined)
          .then(() => {
            clearCart();
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            if (navigation.canGoBack()) navigation.goBack();
            Alert.alert('Sent', 'Order sent to the existing tab on that table.');
          })
          .catch((e2) => Alert.alert('Send failed', e2?.error || e2?.message || 'Could not send items.'));
        return;
      }
      Alert.alert('Send failed', err?.error || err?.message || 'Could not send items.');
    },
  });

  // Fetch floor plans
  const { data: floorPlansData, isLoading: loadingPlans, isError: floorPlansError, refetch: refetchPlans } = useQuery({
    queryKey: ['floor-plans'],
    queryFn: floorPlansApi.list,
  });

  const floorPlans = useMemo(() => floorPlansData?.floorPlans || [], [floorPlansData]);

  // Auto-select a floor plan once the list loads. If a persisted selection
  // is still in the list, keep it. Otherwise (deleted/moved plan, or first
  // visit), default to the first available so the canvas always renders.
  useEffect(() => {
    if (floorPlans.length === 0) return;
    if (selectedFloorPlanId && floorPlans.some((fp) => fp.id === selectedFloorPlanId)) return;
    setSelectedFloorPlanId(floorPlans[0].id);
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

  // Refetch on every focus. FloorPlan stays mounted underneath stacked
  // screens like SessionDetail and PaymentProcessing, so refetchOnMount
  // doesn't re-run when the user returns. Without this, a session settled
  // on a stacked screen leaves the table looking active until the next
  // pull-to-refresh / socket event. Socket events normally handle it, but
  // the Terminal SDK flow occasionally drops the socket so this is a
  // safety net.
  useFocusEffect(
    useCallback(() => {
      refetchTables();
      refetchSessions();
    }, [refetchTables, refetchSessions]),
  );

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

  // OS reduce-motion — read once + subscribe. Passed to tiles so the
  // new-items pulse degrades to a static highlight ring.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  // New-items pulse: when SESSION_ITEMS_ADDED lands for a table on this floor,
  // briefly highlight that tile so a fresh round draws the eye. The global
  // SocketEventHandlers already invalidates the sessions query (badge count
  // updates); this only drives the transient attention cue.
  const [pulseTableId, setPulseTableId] = useState<string | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleItemsAdded = useCallback((data: any) => {
    if (!data?.tableId) return;
    setPulseTableId(data.tableId);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = setTimeout(() => setPulseTableId(null), 2600);
  }, []);
  useSocketEvent(SocketEvents.SESSION_ITEMS_ADDED, handleItemsAdded);
  useEffect(() => () => {
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
  }, []);

  // One-time discoverability hint for the long-press table actions (merge /
  // unmerge). Shown under the legend until dismissed.
  const [showLongPressHint, setShowLongPressHint] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(LONG_PRESS_HINT_KEY).then((v) => {
      if (!v) setShowLongPressHint(true);
    }).catch(() => {});
  }, []);
  const dismissLongPressHint = useCallback(() => {
    setShowLongPressHint(false);
    AsyncStorage.setItem(LONG_PRESS_HINT_KEY, '1').catch(() => {});
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

  // SessionDetail's "Merge with another table" action navigates here with
  // `mergeSessionId` set — enter merge mode as if the operator had picked it
  // from the long-press sheet.
  useEffect(() => {
    if (route.params?.mergeSessionId) {
      setMergeSessionId(route.params.mergeSessionId);
    }
  }, [route.params?.mergeSessionId]);

  const mergeMutation = useMutation({
    mutationFn: ({ sessionId, tableId }: { sessionId: string; tableId: string }) =>
      sessionsApi.mergeTables(sessionId, tableId),
    onSuccess: () => {
      setMergeSessionId(null);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['floor-plans'] });
    },
    onError: (err: any) => {
      Alert.alert(t('mergeFailedTitle'), err?.error || err?.message || t('mergeFailedMessage'));
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
    // Send mode: tap shows a native confirm before committing. Prevents an
    // accidental tap on the wrong table from firing a kitchen ticket. The
    // existing session (if any) gets a new round; an empty table opens a
    // fresh POS session with the cart items as round 1.
    if (isSendMode) {
      if (table.status === 'merged' || table.status === 'unavailable') return;
      const existing = tableSessionMap.get(table.id);
      const verb = existing ? 'Add to' : 'Start';
      Alert.alert(
        `${verb} ${table.label}?`,
        `${verb === 'Add to' ? 'Append' : 'Send'} ${cartItemCount} item${cartItemCount === 1 ? '' : 's'} ${existing ? `to the open tab on ${table.label}` : `as a new session on ${table.label}`}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: existing ? 'Add round' : 'Send', onPress: () => sendMutation.mutate(table) },
        ],
      );
      return;
    }
    const session = tableSessionMap.get(table.id);
    if (session) {
      navigation.navigate('SessionDetail', { sessionId: session.id });
      return;
    }
    // Empty table, no send pending. Offer to start an empty session so the
    // server can seat the party before taking any orders.
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
  }, [navigation, tableSessionMap, selectedCatalog, createSessionMutation, t, mergeSessionId, mergeMutation, isSendMode, sendMutation, cartItemCount]);

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
      Alert.alert(t('unmergeFailedTitle'), err?.error || err?.message || t('unmergeFailedMessage'));
    },
  });

  const handleTableLongPress = useCallback((table: Table) => {
    if (mergeSessionId) return; // already in merge mode — long-press is a no-op
    const session = tableSessionMap.get(table.id);
    if (!session) return; // empty table: nothing to do via long-press (yet)
    // Long-press has been discovered — stop showing the hint.
    dismissLongPressHint();
    const merged = session.mergedTableIds || [];
    const isPrimary = session.tableId === table.id;
    const options: Array<{ text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }> = [];
    if (isPrimary) {
      options.push({
        text: t('mergeAction'),
        onPress: () => setMergeSessionId(session.id),
      });
      if (merged.length > 0) {
        options.push({
          text: t('unmergeCountAction', { count: merged.length }),
          style: 'destructive',
          onPress: () => {
            // Pop a follow-up sheet listing secondaries to unmerge. Most flows
            // only merge one extra table, so doing them one-tap is fine.
            const secondaryLabels = tables.filter((tbl) => merged.includes(tbl.id));
            const followUp: typeof options = secondaryLabels.map((s) => ({
              text: t('unmergeLabelAction', { label: s.label }),
              onPress: () => unmergeMutation.mutate({ sessionId: session.id, tableId: s.id }),
            }));
            followUp.push({ text: t('cancel'), style: 'cancel' });
            Alert.alert(t('unmergeTitle'), '', followUp);
          },
        });
      }
    }
    options.push({ text: t('cancel'), style: 'cancel' });
    if (options.length === 1) return; // nothing actionable
    Alert.alert(t('tableSheetTitle', { label: table.label }), '', options);
  }, [mergeSessionId, tableSessionMap, tables, unmergeMutation, t, dismissLongPressHint]);

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
        <EmptyState
          icon="grid-outline"
          title={t('noFloorPlansTitle')}
          subtitle={t('noFloorPlansSubtitle')}
        />
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
          style={styles.tabsScroll}
          contentContainerStyle={styles.tabsContainer}
        >
          {floorPlans.map((fp) => (
            <TouchableOpacity
              key={fp.id}
              onPress={() => pickFloorPlan(fp.id)}
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

      {/* Send-mode banner — when the user arrived here via 'Send to table'
          with items in their cart. Tapping any table commits the cart as a
          round on that table's session. Cancel exits without mutating. */}
      {isSendMode && !mergeSessionId && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            borderColor: colors.primary,
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
            style={{ color: '#FDE68A', fontFamily: fonts.semiBold, fontSize: 13, flex: 1 }}
            maxFontSizeMultiplier={1.5}
          >
            {`Tap a table to send ${cartItemCount} item${cartItemCount === 1 ? '' : 's'}.`}
          </Text>
          <TouchableOpacity
            onPress={() => navigation.canGoBack() && navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Cancel send"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ marginLeft: 12 }}
            disabled={sendMutation.isPending}
          >
            <Text style={{ color: '#F5F5F4', fontFamily: fonts.bold, fontSize: 13 }} maxFontSizeMultiplier={1.3}>
              {sendMutation.isPending ? 'Sending…' : 'Cancel'}
            </Text>
          </TouchableOpacity>
        </View>
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
            {t('mergeBannerText')}
          </Text>
          <TouchableOpacity
            onPress={() => setMergeSessionId(null)}
            accessibilityRole="button"
            accessibilityLabel={t('cancelMergeLabel')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ marginLeft: 12 }}
          >
            <Text style={{ color: '#F5F5F4', fontFamily: fonts.bold, fontSize: 13 }} maxFontSizeMultiplier={1.3}>
              {t('cancel')}
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
        <EmptyState
          icon="restaurant-outline"
          title={t('noTablesOnFloorPlan')}
          subtitle={t('noTablesSubtitle')}
        />
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
                    pulse={pulseTableId === table.id}
                    reduceMotion={reduceMotion}
                  />
                );
              })}
            </View>
          </ScrollView>
        </ScrollView>
      )}

      {/* Legend — matches the vendor portal's runtime legend so a server
          reading the chip on phone and dashboard sees the same vocabulary.
          Swatches mirror the tile treatment (fill + 2px border + status
          glyph) so they're actually matchable against the canvas. */}
      <View style={[styles.legendWrap, { borderTopColor: colors.border }]}>
        <View style={styles.legend}>
          {LEGEND_STATES.map((status) => {
            const palette = TABLE_STATUS_COLORS[status];
            return (
              <View key={status} style={styles.legendItem}>
                <View
                  style={[
                    styles.legendSwatch,
                    {
                      backgroundColor: palette.fill,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  {palette.icon && (
                    <Ionicons
                      name={palette.icon as keyof typeof Ionicons.glyphMap}
                      size={9}
                      color={status === 'check_requested' ? palette.text : palette.border}
                    />
                  )}
                </View>
                <Text
                  style={[styles.legendText, { color: colors.textSecondary }]}
                  maxFontSizeMultiplier={1.5}
                >
                  {t(`tableStatus_${status}`)}
                </Text>
              </View>
            );
          })}
        </View>
        {/* One-time discoverability hint for long-press table actions. */}
        {showLongPressHint && (
          <View style={styles.hintRow}>
            <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
            <Text
              style={[styles.hintText, { color: colors.textSecondary }]}
              maxFontSizeMultiplier={1.5}
            >
              {t('longPressHint')}
            </Text>
            <TouchableOpacity
              onPress={dismissLongPressHint}
              accessibilityRole="button"
              accessibilityLabel={t('dismissHintLabel')}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}
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
  tabsScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  tabsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    alignItems: 'center',
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
  legendWrap: {
    borderTopWidth: 1,
    paddingVertical: 10,
    gap: 6,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 14,
    rowGap: 6,
    paddingHorizontal: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendSwatch: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendText: {
    fontSize: 12,
    fontFamily: fonts.regular,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
  },
  hintText: {
    fontSize: 12,
    fontFamily: fonts.regular,
  },
});
