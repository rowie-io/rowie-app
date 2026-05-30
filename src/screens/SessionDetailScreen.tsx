import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useSocketEvent } from '../context/SocketContext';
import { SocketEvents } from '../context/SocketContext';
import { sessionsApi, type SessionItem, type ItemStatus } from '../lib/api/sessions';
import { stripeTerminalApi } from '../lib/api';
import { useTerminal } from '../context/StripeTerminalContext';
import { formatCurrency, toSmallestUnit, fromSmallestUnit, isZeroDecimal } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { useTranslations } from '../lib/i18n';

type RouteParams = {
  SessionDetail: {
    sessionId: string;
  };
};

const STATUS_CONFIG: Record<string, { icon: string; color: string; labelKey: string }> = {
  pending: { icon: 'time-outline', color: '#78716C', labelKey: 'itemStatusPending' },
  sent: { icon: 'send-outline', color: '#3B82F6', labelKey: 'itemStatusSent' },
  preparing: { icon: 'flame-outline', color: '#F59E0B', labelKey: 'itemStatusPreparing' },
  ready: { icon: 'checkmark-circle-outline', color: '#22C55E', labelKey: 'itemStatusReady' },
  served: { icon: 'restaurant-outline', color: '#A8A29E', labelKey: 'itemStatusServed' },
};

export function SessionDetailScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'SessionDetail'>>();
  const { currency, organization } = useAuth();
  const { selectedCatalog } = useCatalog();
  const queryClient = useQueryClient();
  const { sessionId } = route.params;
  const t = useTranslations('sessionDetail');
  const { preferredReader } = useTerminal();

  // Tip modal state
  const [tipModalOpen, setTipModalOpen] = useState(false);
  const [selectedTipPct, setSelectedTipPct] = useState<number | null>(null);
  const [customTipText, setCustomTipText] = useState('');

  // Settle modal state. Sessions without a saved card (non-tab) need the
  // operator to pick a payment method on close — cash/tap/split — instead of
  // the previous one-click "always cash, no tip" path. Modal is opened from
  // the Settle button; submits via settleMutation below.
  const [settleModalOpen, setSettleModalOpen] = useState(false);
  const [settleMethod, setSettleMethod] = useState<'cash' | 'tap_to_pay' | 'split'>('tap_to_pay');
  const [settleTipText, setSettleTipText] = useState(''); // base-unit digits
  const [settleCashTenderedText, setSettleCashTenderedText] = useState(''); // base-unit digits
  const [settleSplitPieces, setSettleSplitPieces] = useState<Array<{ method: 'cash' | 'tap_to_pay'; amount: number }>>([]);
  const [settleSplitAddMethod, setSettleSplitAddMethod] = useState<'cash' | 'tap_to_pay'>('cash');
  const [settleSplitAddAmount, setSettleSplitAddAmount] = useState(''); // base-unit digits

  // Tip settings from the catalog — "Tip" screen only shown if enabled.
  // Defaults match the catalog's typical values when not set.
  const showTipScreen = selectedCatalog?.showTipScreen ?? true;
  const tipPercentages = selectedCatalog?.tipPercentages ?? [15, 18, 20, 25];
  const allowCustomTip = selectedCatalog?.allowCustomTip ?? true;

  const { data, isLoading, refetch, isError } = useQuery({
    queryKey: ['sessions', sessionId],
    queryFn: () => sessionsApi.get(sessionId),
  });

  const session = data?.session;
  const items = data?.items || [];
  const roundMeta = data?.rounds || [];

  // Already-paid: customer paid online (qr_menu pay_now batch or tableless
  // preorder pay_now). The API's settle handler detects this same condition
  // and skips the charge step — staff just need to close the session out.
  const alreadyPaid = !!session && session.paymentType === 'pay_now' && !!session.stripeChargeId;

  // Defense-in-depth: ignore SESSION_* emits for other orgs so a future
  // room-scoping regression can't silently refetch this device's session
  // detail with another org's payload.
  const orgIdRef = useRef(organization?.id);
  useEffect(() => {
    orgIdRef.current = organization?.id;
  }, [organization?.id]);
  const isMyOrg = useCallback((data: any): boolean => {
    if (!data?.organizationId) return true;
    return !!orgIdRef.current && data.organizationId === orgIdRef.current;
  }, []);

  // Real-time updates
  const handleSessionUpdate = useCallback((data: any) => {
    if (!isMyOrg(data)) return;
    refetch();
  }, [refetch, isMyOrg]);

  useSocketEvent(SocketEvents.SESSION_UPDATED, handleSessionUpdate);
  useSocketEvent(SocketEvents.SESSION_ITEMS_ADDED, handleSessionUpdate);
  useSocketEvent(SocketEvents.SESSION_SETTLED, handleSessionUpdate);
  // Without this, another device cancelling the session leaves this view on
  // stale "open" state until manual refresh — the global SocketEventHandlers
  // invalidates the list-shaped `['sessions']` key but not the detail-shaped
  // `['sessions', sessionId]` we read.
  useSocketEvent(SocketEvents.SESSION_CANCELLED, handleSessionUpdate);

  // Group items by round
  const rounds = useMemo(() => {
    const map = new Map<number, SessionItem[]>();
    for (const item of items) {
      if (!map.has(item.roundNumber)) map.set(item.roundNumber, []);
      map.get(item.roundNumber)!.push(item);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [items]);

  const roundNotesByNumber = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of roundMeta) {
      if (r.notes && r.notes.trim().length > 0) map.set(r.roundNumber, r.notes);
    }
    return map;
  }, [roundMeta]);

  // Mutations
  const updateStatusMutation = useMutation({
    mutationFn: ({ itemIds, status }: { itemIds: string[]; status: ItemStatus }) =>
      sessionsApi.updateItemStatus(sessionId, itemIds, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId] });
    },
  });

  // Edit-item state: long-pressing an item opens an action sheet that routes
  // into one of these modals (qty / notes) or fires removeItemMutation
  // directly with a confirm step.
  const [editingItem, setEditingItem] = useState<SessionItem | null>(null);
  const [editMode, setEditMode] = useState<'qty' | 'notes' | null>(null);
  const [qtyInput, setQtyInput] = useState('1');
  const [notesInput, setNotesInput] = useState('');

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: { quantity?: number; notes?: string | null } }) =>
      sessionsApi.updateItem(sessionId, itemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId] });
      setEditingItem(null);
      setEditMode(null);
    },
    onError: (err: any) => {
      Alert.alert('Update failed', err?.error || err?.message || 'Could not update the item.');
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => sessionsApi.removeItem(sessionId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId] });
    },
    onError: (err: any) => {
      Alert.alert('Remove failed', err?.error || err?.message || 'Could not remove the item.');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => sessionsApi.cancel(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      navigation.goBack();
    },
    // Bug fix: cancel was silent on failure — staff hits "Cancel session",
    // network blip / 409 race / 403 returns, screen does nothing. The user
    // assumes it worked and walks away. Surface the API error string via the
    // same shape closeTabMutation/settleCashMutation use below. The mobile
    // apiClient throws { error, statusCode, code } — `.error` not `.message`.
    onError: (err: any) => {
      Alert.alert(t('failedCancelTitle'), err?.error || err?.message || t('failedCancelMessage'));
    },
  });

  const closeTabMutation = useMutation({
    // tipAmount passed to API is in SMALLEST unit (cents) per the API contract.
    mutationFn: (tipAmountSmallestUnit: number) => sessionsApi.closeTab(sessionId, tipAmountSmallestUnit),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setTipModalOpen(false);
      setSelectedTipPct(null);
      setCustomTipText('');
      Alert.alert(t('closedTitle'), t('closedMessage'));
      navigation.goBack();
    },
    // Bug fix: the mobile apiClient throws { error, statusCode, code, details }
    // (see lib/api/client.ts:120-127) — NOT an Error instance. `err?.message`
    // is undefined so a card-decline / "Tab not found" / Stripe error fell
    // through to the generic translation, leaving the staff member guessing.
    // Prefer `err?.error` (server's `{ error: '...' }` body), then `.message`,
    // then the translation as a last resort. Mirrors the vendor close-tab fix
    // in rowie-vendor/app/[locale]/(authenticated)/tables/page.tsx:599-606.
    onError: (err: any) => {
      Alert.alert(t('failedCloseTitle'), err?.error || err?.message || t('failedCloseMessage'));
    },
  });

  // Compute the tip amount (in base unit — dollars) from the current selection.
  const sessionPreTipTotal = session ? session.subtotal + session.taxAmount : 0;
  const computedTipBase = useMemo(() => {
    if (selectedTipPct === null) return 0;
    if (selectedTipPct === -1) {
      // Custom tip input
      const parsed = parseFloat(customTipText || '0');
      if (isNaN(parsed) || parsed < 0) return 0;
      return parsed;
    }
    // Percentage of subtotal (NOT subtotal+tax — tipping on tax is rude)
    if (!session) return 0;
    const raw = session.subtotal * (selectedTipPct / 100);
    return isZeroDecimal(currency) ? Math.round(raw) : Math.round(raw * 100) / 100;
  }, [selectedTipPct, customTipText, session, currency]);

  const handleOpenCloseTabFlow = useCallback(() => {
    // If the menu has the tip screen disabled, skip straight to charging with tip=0.
    if (!showTipScreen) {
      Alert.alert(
        t('closeTabConfirmTitle'),
        t('closeTabConfirmMessage'),
        [
          { text: t('cancel'), style: 'cancel' },
          { text: t('closeTabConfirmAction'), onPress: () => closeTabMutation.mutate(0) },
        ],
      );
      return;
    }
    setSelectedTipPct(null);
    setCustomTipText('');
    setTipModalOpen(true);
  }, [showTipScreen, closeTabMutation, t]);

  const handleConfirmCloseTab = useCallback(() => {
    const tipCents = toSmallestUnit(computedTipBase, currency);
    closeTabMutation.mutate(tipCents);
  }, [computedTipBase, currency, closeTabMutation]);

  // Generic settle mutation. The payload shape depends on the picked method:
  //   cash       → { paymentMethod: 'cash', tipAmount, cashTendered? }
  //   tap_to_pay → { paymentMethod: 'tap_to_pay', tipAmount, stripePaymentIntentId }
  //                (Terminal SDK confirms the PI separately; PI ID is passed
  //                here just for the order linkage. v1 records pending and
  //                relies on the webhook to flip status — same pattern as
  //                the legacy POS checkout.)
  //   split      → { paymentMethod: 'split', tipAmount, payments: [...] }
  // sessionsApi.settle types this; the API validates the sum-of-pieces.
  const settleMutation = useMutation({
    mutationFn: (payload: Parameters<typeof sessionsApi.settle>[1]) =>
      sessionsApi.settle(sessionId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setSettleModalOpen(false);
      Alert.alert(t('settledTitle'), t('settledMessage'));
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert(t('failedSettleTitle'), err?.error || err?.message || t('failedSettleMessage'));
    },
  });

  // Tip parsed from the modal field. Empty / non-numeric → 0.
  const settleTipBase = useMemo(() => {
    const n = parseFloat(settleTipText);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [settleTipText]);
  const settleTipSmallest = useMemo(
    () => toSmallestUnit(settleTipBase, currency),
    [settleTipBase, currency],
  );
  // Pre-tip totals from the session (base units already).
  const settleSubtotalBase = session?.subtotal || 0;
  const settleTaxBase = session?.taxAmount || 0;
  const settlePreTipBase = settleSubtotalBase + settleTaxBase;
  const settlePreTipSmallest = useMemo(
    () => toSmallestUnit(settlePreTipBase, currency),
    [settlePreTipBase, currency],
  );
  const settleTotalBase = settlePreTipBase + settleTipBase;
  // Cash tendered + change for the modal cash mode.
  const settleCashTenderedBase = parseFloat(settleCashTenderedText) || 0;
  const settleCashTenderedSmallest = toSmallestUnit(settleCashTenderedBase, currency);
  const settleTotalSmallest = toSmallestUnit(settleTotalBase, currency);
  const settleCashChangeSmallest = Math.max(0, settleCashTenderedSmallest - settleTotalSmallest);
  // Split pieces — each amount is in smallest units (entered base, converted).
  const settleSplitTotalSmallest = settleSplitPieces.reduce((s, p) => s + p.amount, 0);
  const settleSplitRemainingSmallest = Math.max(0, settlePreTipSmallest - settleSplitTotalSmallest);
  const settleSplitAddAmountSmallest = toSmallestUnit(parseFloat(settleSplitAddAmount) || 0, currency);
  const settleSplitComplete =
    settleSplitPieces.length >= 2 && settleSplitTotalSmallest === settlePreTipSmallest;

  const settleSubmitDisabled = (() => {
    if (settleMutation.isPending) return true;
    if (settleMethod === 'cash') return settleCashTenderedSmallest < settleTotalSmallest;
    if (settleMethod === 'split') return !settleSplitComplete;
    return false; // tap_to_pay: enabled (reader interaction is out-of-scope v1)
  })();

  const handleSubmitSettle = useCallback(async () => {
    // tipAmount on /sessions/{id}/settle is in BASE units (dollars) — matches
    // sessions/orders DECIMAL columns and /menu/preorder. closeTab still uses
    // smallest units (see closeTabMutation above). cashTendered / split piece
    // amounts stay in smallest units (server compares them as integers).
    if (settleMethod === 'cash') {
      settleMutation.mutate({
        paymentMethod: 'cash',
        tipAmount: settleTipBase,
        cashTendered: settleCashTenderedSmallest || undefined,
      });
      return;
    }
    if (settleMethod === 'split') {
      settleMutation.mutate({
        paymentMethod: 'split',
        tipAmount: settleTipBase,
        payments: settleSplitPieces.map((p) => ({
          paymentMethod: p.method,
          amount: p.amount,
          cashTendered: p.method === 'cash' ? p.amount : undefined,
        })),
      });
      return;
    }
    // tap_to_pay — open the Terminal SDK flow. Mirror CheckoutScreen: create a
    // PaymentIntent for (subtotal + tax + tip), then hand off to
    // PaymentProcessing which runs the collect+confirm dance and (on success)
    // calls /sessions/{id}/settle with the confirmed PI id.
    if (!session) return;
    const totalSmallest = settleTotalSmallest;
    if (totalSmallest <= 0) {
      Alert.alert('Nothing to charge', 'This session has a zero total.');
      return;
    }
    try {
      setSettleModalOpen(false);
      const totalBase = fromSmallestUnit(totalSmallest, currency);
      const idempotencyKey = `pi-session-${sessionId}-${totalSmallest}-${settleTipSmallest}`;
      const paymentIntent = await stripeTerminalApi.createPaymentIntent({
        amount: totalBase,
        currency,
        description: `Settle ${session.tableLabel || session.holdName || session.sessionNumber}`,
        metadata: {
          sessionId,
          tableId: session.tableId || '',
          catalogId: session.catalogId || '',
          subtotal: session.subtotal.toString(),
          taxAmount: session.taxAmount.toString(),
          tipAmount: settleTipBase.toString(),
        },
      }, idempotencyKey);
      navigation.navigate('PaymentProcessing', {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.clientSecret,
        stripeAccountId: paymentIntent.stripeAccountId,
        amount: totalSmallest,
        sessionId,
        sessionTipAmount: settleTipBase,
      });
    } catch (e: any) {
      setSettleModalOpen(true);
      Alert.alert('Could not start payment', e?.error || e?.message || 'Unable to create payment intent.');
    }
  }, [settleMethod, settleTipBase, settleTipSmallest, settleCashTenderedSmallest, settleSplitPieces, settleMutation, session, settleTotalSmallest, sessionId, currency, navigation]);

  const handleSettle = useCallback(() => {
    // Reset modal state on open so a previous failed attempt's values don't
    // leak in. Default to Tap to Pay + no tip — matches the most common
    // in-person bar/restaurant close-out.
    setSettleMethod('tap_to_pay');
    setSettleTipText('');
    setSettleCashTenderedText('');
    setSettleSplitPieces([]);
    setSettleSplitAddMethod('cash');
    setSettleSplitAddAmount('');
    setSettleModalOpen(true);
  }, []);

  // Mark an already-paid session as picked up / complete. No tip, no payment
  // method picker — the API's settle handler short-circuits the charge step
  // when stripe_charge_id is set on a pay_now session and just closes the row.
  const handleMarkComplete = useCallback(() => {
    Alert.alert(
      t('markCompleteConfirmTitle'),
      t('markCompleteConfirmMessage'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('markCompleteConfirmAction'),
          onPress: () => settleMutation.mutate({ paymentMethod: 'card', tipAmount: 0 }),
        },
      ],
    );
  }, [settleMutation, t]);

  const markRoundStatus = useCallback((roundItems: SessionItem[], status: ItemStatus) => {
    const itemIds = roundItems.filter(i => i.status !== status).map(i => i.id);
    if (itemIds.length > 0) {
      updateStatusMutation.mutate({ itemIds, status });
    }
  }, [updateStatusMutation]);

  // Long-press on an item row → edit / remove action sheet. Disabled on
  // settled/cancelled sessions (API would 409 anyway) and on items that the
  // backend has marked uneditable (e.g. an already-charged tab pre-pay item
  // would 409 on DELETE — let the server be source of truth, the UI just
  // surfaces the error).
  const handleItemLongPress = useCallback((item: SessionItem) => {
    if (session?.status !== 'open') return;
    Alert.alert(
      `${item.quantity}× ${item.name}`,
      'Adjust this item before close-out.',
      [
        {
          text: 'Edit quantity',
          onPress: () => {
            setEditingItem(item);
            setQtyInput(String(item.quantity));
            setEditMode('qty');
          },
        },
        {
          text: 'Edit notes',
          onPress: () => {
            setEditingItem(item);
            setNotesInput(item.notes || '');
            setEditMode('notes');
          },
        },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Remove item?',
              `Remove ${item.quantity}× ${item.name} from this session?`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () => removeItemMutation.mutate(item.id),
                },
              ],
            );
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [session?.status, removeItemMutation]);

  const handleSubmitEdit = useCallback(() => {
    if (!editingItem) return;
    if (editMode === 'qty') {
      const n = parseInt(qtyInput, 10);
      if (!Number.isFinite(n) || n < 1) {
        Alert.alert('Invalid quantity', 'Quantity must be at least 1. Use Remove to delete the item instead.');
        return;
      }
      if (n === editingItem.quantity) {
        setEditingItem(null);
        setEditMode(null);
        return;
      }
      updateItemMutation.mutate({ itemId: editingItem.id, data: { quantity: n } });
      return;
    }
    if (editMode === 'notes') {
      const trimmed = notesInput.trim();
      if ((trimmed || null) === (editingItem.notes || null)) {
        setEditingItem(null);
        setEditMode(null);
        return;
      }
      updateItemMutation.mutate({
        itemId: editingItem.id,
        data: { notes: trimmed.length > 0 ? trimmed : null },
      });
    }
  }, [editingItem, editMode, qtyInput, notesInput, updateItemMutation]);

  const handleCancel = useCallback(() => {
    Alert.alert(
      t('cancelConfirmTitle'),
      t('cancelConfirmMessage'),
      [
        { text: t('cancelConfirmNo'), style: 'cancel' },
        { text: t('cancelConfirmYes'), style: 'destructive', onPress: () => cancelMutation.mutate() },
      ]
    );
  }, [cancelMutation, t]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel={t('loading')} />
        </View>
      </SafeAreaView>
    );
  }

  if (isError) {
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
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color="#EF4444" />
          <Text style={[styles.emptyText, { color: colors.text }]} maxFontSizeMultiplier={1.3} accessibilityRole="alert">
            {t('errorTitle')}
          </Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary, fontSize: 14 }]} maxFontSizeMultiplier={1.5}>
            {t('errorSubtitle')}
          </Text>
          <TouchableOpacity
            onPress={() => refetch()}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, backgroundColor: colors.primary, minHeight: 44 }}
            accessibilityRole="button"
            accessibilityLabel={t('retryAccessibilityLabel')}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
            <Text style={{ fontSize: 15, fontFamily: fonts.bold, color: '#fff' }} maxFontSizeMultiplier={1.3}>
              {t('retryButton')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
            {t('notFound')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const isOpen = session.status === 'open';
  const sourceLabel = (() => {
    if (session.source === 'qr_table' || session.source === 'qr_menu') return t('sourceQr');
    if (session.source === 'hold') return t('sourceHeld');
    if (session.source === 'tab') return t('sourceTab');
    return t('sourcePos');
  })();
  const statusLabel = (() => {
    if (session.status === 'open') return t('statusOpen');
    if (session.status === 'settling') return t('statusSettling');
    if (session.status === 'settled') return t('statusSettled');
    if (session.status === 'cancelled') return t('statusCancelled');
    return session.status;
  })();

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
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
            {session.tableLabel || session.holdName || session.sessionNumber}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
            {session.sessionNumber} · {sourceLabel}
          </Text>
        </View>
        <View style={styles.headerBadges}>
          {alreadyPaid && (
            <View style={[styles.statusBadge, { backgroundColor: '#22C55E20' }]}>
              <Text style={[styles.statusText, { color: '#22C55E' }]} maxFontSizeMultiplier={1.3}>
                {t('paidBadge')}
              </Text>
            </View>
          )}
          <View style={[styles.statusBadge, { backgroundColor: isOpen ? '#22C55E20' : '#78716C20' }]}>
            <Text style={[styles.statusText, { color: isOpen ? '#22C55E' : '#78716C' }]} maxFontSizeMultiplier={1.3}>
              {statusLabel}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Customer info */}
        {(session.customerName || session.customerEmail) && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {session.customerName && (
              <Text style={[styles.customerName, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {session.customerName}
              </Text>
            )}
            {session.customerEmail && (
              <Text style={[styles.customerEmail, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                {session.customerEmail}
              </Text>
            )}
          </View>
        )}

        {/* Items by round */}
        {rounds.map(([roundNum, roundItems]) => {
          const allServed = roundItems.every(i => i.status === 'served');
          const roundNotes = roundNotesByNumber.get(roundNum);
          return (
            <View key={roundNum} style={styles.roundSection}>
              <View style={styles.roundHeader}>
                <Text style={[styles.roundLabel, { color: colors.textMuted }]} maxFontSizeMultiplier={1.3}>
                  {t('roundLabel', { number: roundNum })}
                </Text>
                {isOpen && !allServed && (
                  <View style={styles.roundActions}>
                    <TouchableOpacity
                      onPress={() => markRoundStatus(roundItems, 'sent')}
                      style={[styles.roundActionBtn, { backgroundColor: '#3B82F620' }]}
                      accessibilityRole="button"
                      accessibilityLabel={t('markRoundSentLabel', { number: roundNum })}
                    >
                      <Text style={[styles.roundActionText, { color: '#3B82F6' }]} maxFontSizeMultiplier={1.3}>{t('roundActionSent')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => markRoundStatus(roundItems, 'ready')}
                      style={[styles.roundActionBtn, { backgroundColor: '#22C55E20' }]}
                      accessibilityRole="button"
                      accessibilityLabel={t('markRoundReadyLabel', { number: roundNum })}
                    >
                      <Text style={[styles.roundActionText, { color: '#22C55E' }]} maxFontSizeMultiplier={1.3}>{t('roundActionReady')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => markRoundStatus(roundItems, 'served')}
                      style={[styles.roundActionBtn, { backgroundColor: '#A8A29E20' }]}
                      accessibilityRole="button"
                      accessibilityLabel={t('markRoundServedLabel', { number: roundNum })}
                    >
                      <Text style={[styles.roundActionText, { color: '#A8A29E' }]} maxFontSizeMultiplier={1.3}>{t('roundActionServed')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {roundNotes && (
                  <View
                    style={[
                      styles.roundNotesBox,
                      { backgroundColor: colors.primary + '15', borderColor: colors.primary + '40' },
                    ]}
                    accessibilityRole="text"
                    accessibilityLabel={`${t('roundNotesLabel')}: ${roundNotes}`}
                  >
                    <Ionicons name="chatbox-ellipses-outline" size={14} color={colors.primary} />
                    <View style={styles.roundNotesTextWrap}>
                      <Text style={[styles.roundNotesLabel, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>
                        {t('roundNotesLabel')}
                      </Text>
                      <Text style={[styles.roundNotesText, { color: colors.text }]} maxFontSizeMultiplier={1.5}>
                        {roundNotes}
                      </Text>
                    </View>
                  </View>
                )}
                {roundItems.map((item) => {
                  const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.itemRow}
                      onLongPress={() => handleItemLongPress(item)}
                      disabled={!isOpen}
                      delayLongPress={350}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.quantity} ${item.name}. Long press to edit or remove.`}
                    >
                      <View style={styles.itemInfo}>
                        <Text style={[styles.itemName, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                          {item.quantity}× {item.name}
                        </Text>
                        {item.notes && (
                          <Text style={[styles.itemNotes, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                            {item.notes}
                          </Text>
                        )}
                      </View>
                      <View style={styles.itemRight}>
                        <Text style={[styles.itemPrice, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                          {formatCurrency(item.unitPrice * item.quantity, currency)}
                        </Text>
                        <View style={[styles.itemStatusBadge, { backgroundColor: config.color + '20' }]}>
                          <Ionicons name={config.icon as any} size={12} color={config.color} />
                          <Text style={[styles.itemStatusText, { color: config.color }]} maxFontSizeMultiplier={1.3}>
                            {t(config.labelKey)}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}

        {/* Totals */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>{t('subtotalLabel')}</Text>
            <Text style={[styles.totalValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{formatCurrency(session.subtotal, currency)}</Text>
          </View>
          {session.taxAmount > 0 && (
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>{t('taxLabel')}</Text>
              <Text style={[styles.totalValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{formatCurrency(session.taxAmount, currency)}</Text>
            </View>
          )}
          {session.tipAmount > 0 && (
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>{t('tipLabel')}</Text>
              <Text style={[styles.totalValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{formatCurrency(session.tipAmount, currency)}</Text>
            </View>
          )}
          <View style={[styles.totalRow, styles.grandTotalRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.grandTotalLabel, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{t('totalLabel')}</Text>
            <Text style={[styles.grandTotalValue, { color: colors.primary }]} maxFontSizeMultiplier={1.2}>
              {formatCurrency(session.subtotal + session.taxAmount, currency)}
            </Text>
          </View>
        </View>

        {/* Notes */}
        {session.orderNotes && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.notesLabel, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>{t('notesLabel')}</Text>
            <Text style={[styles.notesText, { color: colors.text }]} maxFontSizeMultiplier={1.5}>{session.orderNotes}</Text>
          </View>
        )}

        {/* Add more items (only while open). Routes to the Menu tab with this
            session pre-targeted; the cart's "Send" CTA there will append a new
            round directly to this session and return here. */}
        {isOpen && (
          <TouchableOpacity
            onPress={() => navigation.navigate('MainTabs', {
              screen: 'Menu',
              params: { screen: 'MenuHome', params: { sessionId: session.id } },
            })}
            style={[styles.addItemsButton, { borderColor: colors.border, backgroundColor: colors.surface }]}
            accessibilityRole="button"
            accessibilityLabel={t('addItemsAccessibilityLabel')}
          >
            <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
            <Text style={[styles.addItemsButtonText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              {t('addItems')}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Footer actions */}
      {isOpen && (
        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <TouchableOpacity
            onPress={handleCancel}
            style={[styles.cancelButton, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel={t('cancelSessionAccessibilityLabel')}
          >
            <Text style={[styles.cancelButtonText, { color: '#EF4444' }]} maxFontSizeMultiplier={1.3}>{t('cancel')}</Text>
          </TouchableOpacity>
          {session.source === 'tab' ? (
            <TouchableOpacity
              onPress={handleOpenCloseTabFlow}
              disabled={closeTabMutation.isPending || items.length === 0}
              style={[
                styles.settleButton,
                { backgroundColor: colors.primary },
                (closeTabMutation.isPending || items.length === 0) && { opacity: 0.5 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={items.length === 0 ? t('closeTabAccessibilityNoItems') : t('closeTabAccessibility')}
            >
              {closeTabMutation.isPending ? (
                <ActivityIndicator color="#fff" accessibilityLabel={t('chargingCardLabel')} />
              ) : (
                <>
                  <Ionicons name="wallet-outline" size={20} color="#fff" />
                  <Text style={styles.settleButtonText} maxFontSizeMultiplier={1.3}>{t('closeTabButton')}</Text>
                </>
              )}
            </TouchableOpacity>
          ) : alreadyPaid ? (
            <TouchableOpacity
              onPress={handleMarkComplete}
              disabled={settleMutation.isPending}
              style={[styles.settleButton, { backgroundColor: '#22C55E' }, settleMutation.isPending && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={t('markCompleteAccessibilityLabel')}
            >
              {settleMutation.isPending ? (
                <ActivityIndicator color="#fff" accessibilityLabel={t('settlingLabel')} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                  <Text style={styles.settleButtonText} maxFontSizeMultiplier={1.3}>{t('markCompleteButton')}</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleSettle}
              disabled={settleMutation.isPending}
              style={[styles.settleButton, { backgroundColor: colors.primary }, settleMutation.isPending && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={t('settleAccessibilityLabel')}
            >
              {settleMutation.isPending ? (
                <ActivityIndicator color="#fff" accessibilityLabel={t('settlingLabel')} />
              ) : (
                <>
                  <Ionicons name="cash-outline" size={20} color="#fff" />
                  <Text style={styles.settleButtonText} maxFontSizeMultiplier={1.3}>{t('settleButton')}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Tip entry modal for closing a tab — only shown when showTipScreen is enabled on the menu */}
      <Modal
        visible={tipModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setTipModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.tipModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.tipModalHeader}>
              <Text style={[styles.tipModalTitle, { color: colors.text }]} maxFontSizeMultiplier={1.2}>
                {t('addTipTitle')}
              </Text>
              <TouchableOpacity
                onPress={() => setTipModalOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={t('closeTipDialogLabel')}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.tipSubtotalLabel, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
              {t('subtotalPreview', { amount: session ? formatCurrency(session.subtotal, currency) : '' })}
            </Text>

            <View style={styles.tipOptionsGrid}>
              {tipPercentages.map((pct) => {
                const isActive = selectedTipPct === pct;
                const tipPreview = session ? session.subtotal * (pct / 100) : 0;
                return (
                  <TouchableOpacity
                    key={pct}
                    onPress={() => { setSelectedTipPct(pct); setCustomTipText(''); }}
                    style={[
                      styles.tipOption,
                      { borderColor: isActive ? colors.primary : colors.border, backgroundColor: isActive ? colors.primary + '15' : colors.surface },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t('tipPercentAccessibility', { pct })}
                    accessibilityState={{ selected: isActive }}
                  >
                    <Text style={[styles.tipOptionPct, { color: isActive ? colors.primary : colors.text }]} maxFontSizeMultiplier={1.2}>
                      {t('tipPercentLabel', { pct })}
                    </Text>
                    <Text style={[styles.tipOptionAmount, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                      {formatCurrency(tipPreview, currency)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {allowCustomTip && (
                <TouchableOpacity
                  onPress={() => setSelectedTipPct(-1)}
                  style={[
                    styles.tipOption,
                    { borderColor: selectedTipPct === -1 ? colors.primary : colors.border, backgroundColor: selectedTipPct === -1 ? colors.primary + '15' : colors.surface },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('customTipAccessibility')}
                  accessibilityState={{ selected: selectedTipPct === -1 }}
                >
                  <Text style={[styles.tipOptionPct, { color: selectedTipPct === -1 ? colors.primary : colors.text }]} maxFontSizeMultiplier={1.2}>
                    {t('customTip')}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => { setSelectedTipPct(0); setCustomTipText(''); }}
                style={[
                  styles.tipOption,
                  { borderColor: selectedTipPct === 0 ? colors.primary : colors.border, backgroundColor: selectedTipPct === 0 ? colors.primary + '15' : colors.surface },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('noTipAccessibility')}
                accessibilityState={{ selected: selectedTipPct === 0 }}
              >
                <Text style={[styles.tipOptionPct, { color: selectedTipPct === 0 ? colors.primary : colors.text }]} maxFontSizeMultiplier={1.2}>
                  {t('noTip')}
                </Text>
              </TouchableOpacity>
            </View>

            {selectedTipPct === -1 && (
              <View style={styles.customTipRow}>
                <Text style={[styles.customTipLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                  {t('customTipLabel')}
                </Text>
                <TextInput
                  value={customTipText}
                  onChangeText={(text) => {
                    // Only allow digits + optional decimal for 2-decimal currencies
                    const cleaned = isZeroDecimal(currency)
                      ? text.replace(/[^0-9]/g, '')
                      : text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                    setCustomTipText(cleaned);
                  }}
                  placeholder={t('customTipPlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  style={[styles.customTipInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                  accessibilityLabel={t('customTipAccessibility')}
                />
              </View>
            )}

            {/* Summary */}
            <View style={[styles.tipSummary, { borderTopColor: colors.border }]}>
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                  {t('subtotalPlusTax')}
                </Text>
                <Text style={[styles.totalValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {formatCurrency(sessionPreTipTotal, currency)}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                  {t('tipLabel')}
                </Text>
                <Text style={[styles.totalValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {formatCurrency(computedTipBase, currency)}
                </Text>
              </View>
              <View style={[styles.totalRow, { marginTop: 6 }]}>
                <Text style={[styles.grandTotalLabel, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {t('totalToCharge')}
                </Text>
                <Text style={[styles.grandTotalValue, { color: colors.primary }]} maxFontSizeMultiplier={1.2}>
                  {formatCurrency(sessionPreTipTotal + computedTipBase, currency)}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={handleConfirmCloseTab}
              disabled={selectedTipPct === null || closeTabMutation.isPending}
              style={[
                styles.chargeButton,
                { backgroundColor: colors.primary },
                (selectedTipPct === null || closeTabMutation.isPending) && { opacity: 0.5 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('chargeButtonAccessibility', { amount: formatCurrency(sessionPreTipTotal + computedTipBase, currency) })}
            >
              {closeTabMutation.isPending ? (
                <ActivityIndicator color="#fff" accessibilityLabel={t('chargingCardLabel')} />
              ) : (
                <>
                  <Ionicons name="wallet-outline" size={20} color="#fff" />
                  <Text style={styles.chargeButtonText} maxFontSizeMultiplier={1.3}>
                    {t('chargeButton', { amount: formatCurrency(sessionPreTipTotal + computedTipBase, currency) })}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Settle modal — opens when the operator taps Settle on a non-tab
          session. Three methods (cash/tap/split), shared tip entry, and
          method-specific fields (tendered for cash, piece-builder for split).
          Reuses tipModal styles where possible. */}
      <Modal
        visible={settleModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSettleModalOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.tipModalContent, { backgroundColor: colors.card, maxHeight: '90%' }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.tipModalHeader}>
              <Text style={[styles.tipModalTitle, { color: colors.text }]} maxFontSizeMultiplier={1.2}>
                {t('settleConfirmTitle')}
              </Text>
              <TouchableOpacity
                onPress={() => setSettleModalOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={t('cancel')}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Method picker */}
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
              {([
                { key: 'cash', labelKey: 'methodCash' },
                { key: 'tap_to_pay', labelKey: 'methodTap' },
                { key: 'split', labelKey: 'methodSplit' },
              ] as const).map((opt) => {
                const isActive = settleMethod === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => setSettleMethod(opt.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: isActive ? colors.primary : colors.border,
                      backgroundColor: isActive ? colors.primary + '15' : colors.surface,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontFamily: fonts.semiBold, fontSize: 13, color: isActive ? colors.primary : colors.text }} maxFontSizeMultiplier={1.3}>
                      {t(opt.labelKey)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Totals snapshot */}
            <View style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 12, marginBottom: 12, gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.textSecondary, fontSize: 13 }} maxFontSizeMultiplier={1.5}>{t('subtotalLabel')}</Text>
                <Text style={{ color: colors.text, fontSize: 13, fontFamily: fonts.medium }} maxFontSizeMultiplier={1.5}>{formatCurrency(settleSubtotalBase, currency)}</Text>
              </View>
              {settleTaxBase > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }} maxFontSizeMultiplier={1.5}>{t('taxLabel')}</Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontFamily: fonts.medium }} maxFontSizeMultiplier={1.5}>{formatCurrency(settleTaxBase, currency)}</Text>
                </View>
              )}
              {settleTipBase > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }} maxFontSizeMultiplier={1.5}>{t('tipLabel')}</Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontFamily: fonts.medium }} maxFontSizeMultiplier={1.5}>{formatCurrency(settleTipBase, currency)}</Text>
                </View>
              )}
              <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.text, fontSize: 14, fontFamily: fonts.semiBold }} maxFontSizeMultiplier={1.3}>{t('totalLabel')}</Text>
                <Text style={{ color: colors.text, fontSize: 14, fontFamily: fonts.bold }} maxFontSizeMultiplier={1.3}>{formatCurrency(settleTotalBase, currency)}</Text>
              </View>
            </View>

            {/* Tip entry — shared across methods. Optional. */}
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 4 }} maxFontSizeMultiplier={1.5}>{t('tipOptionalLabel')}</Text>
              <TextInput
                value={settleTipText}
                onChangeText={(text) => {
                  const cleaned = isZeroDecimal(currency)
                    ? text.replace(/[^0-9]/g, '')
                    : text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                  setSettleTipText(cleaned);
                }}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={[styles.customTipInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                accessibilityLabel={t('tipOptionalLabel')}
              />
            </View>

            {/* Cash mode: tendered + change */}
            {settleMethod === 'cash' && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 4 }} maxFontSizeMultiplier={1.5}>{t('cashTenderedLabel')}</Text>
                <TextInput
                  value={settleCashTenderedText}
                  onChangeText={(text) => {
                    const cleaned = isZeroDecimal(currency)
                      ? text.replace(/[^0-9]/g, '')
                      : text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                    setSettleCashTenderedText(cleaned);
                  }}
                  placeholder={String(settleTotalBase.toFixed(isZeroDecimal(currency) ? 0 : 2))}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  style={[styles.customTipInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                  accessibilityLabel={t('cashTenderedLabel')}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }} maxFontSizeMultiplier={1.5}>{t('changeLabel')}</Text>
                  <Text style={{ color: '#22C55E', fontSize: 13, fontFamily: fonts.semiBold }} maxFontSizeMultiplier={1.3}>
                    {formatCurrency(settleCashChangeSmallest / Math.pow(10, isZeroDecimal(currency) ? 0 : 2), currency)}
                  </Text>
                </View>
              </View>
            )}

            {/* Split mode: piece builder */}
            {settleMethod === 'split' && (
              <View style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }} maxFontSizeMultiplier={1.5}>{t('splitRemainingLabel')}</Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontFamily: fonts.semiBold }} maxFontSizeMultiplier={1.3}>
                    {formatCurrency(settleSplitRemainingSmallest / Math.pow(10, isZeroDecimal(currency) ? 0 : 2), currency)}
                  </Text>
                </View>

                {settleSplitPieces.length > 0 && (
                  <View style={{ marginBottom: 8 }}>
                    {settleSplitPieces.map((p, i) => (
                      <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, padding: 8, borderRadius: 8, marginBottom: 4 }}>
                        <Text style={{ color: colors.text, fontSize: 13 }} maxFontSizeMultiplier={1.5}>
                          {p.method === 'cash' ? t('methodCash') : t('methodTap')}
                        </Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 13 }} maxFontSizeMultiplier={1.3}>
                            {formatCurrency(p.amount / Math.pow(10, isZeroDecimal(currency) ? 0 : 2), currency)}
                          </Text>
                          <TouchableOpacity
                            onPress={() => setSettleSplitPieces(settleSplitPieces.filter((_, idx) => idx !== i))}
                            accessibilityRole="button"
                            accessibilityLabel={t('removePieceLabel')}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {settleSplitRemainingSmallest > 0 && (
                  <View style={{ gap: 6 }}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {(['cash', 'tap_to_pay'] as const).map((m) => {
                        const isActive = settleSplitAddMethod === m;
                        return (
                          <TouchableOpacity
                            key={m}
                            onPress={() => setSettleSplitAddMethod(m)}
                            style={{
                              flex: 1,
                              paddingVertical: 8,
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor: isActive ? colors.primary : colors.border,
                              backgroundColor: isActive ? colors.primary + '15' : colors.surface,
                              alignItems: 'center',
                            }}
                          >
                            <Text style={{ color: isActive ? colors.primary : colors.text, fontFamily: fonts.medium, fontSize: 12 }} maxFontSizeMultiplier={1.3}>
                              {m === 'cash' ? t('methodCash') : t('methodTap')}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TextInput
                        value={settleSplitAddAmount}
                        onChangeText={(text) => {
                          const cleaned = isZeroDecimal(currency)
                            ? text.replace(/[^0-9]/g, '')
                            : text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                          setSettleSplitAddAmount(cleaned);
                        }}
                        placeholder={t('pieceAmountPlaceholder')}
                        placeholderTextColor={colors.textMuted}
                        keyboardType="decimal-pad"
                        style={[styles.customTipInput, { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                        accessibilityLabel={t('pieceAmountPlaceholder')}
                      />
                      <TouchableOpacity
                        onPress={() => {
                          if (settleSplitAddAmountSmallest <= 0 || settleSplitAddAmountSmallest > settleSplitRemainingSmallest) return;
                          setSettleSplitPieces([...settleSplitPieces, { method: settleSplitAddMethod, amount: settleSplitAddAmountSmallest }]);
                          setSettleSplitAddAmount('');
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={t('addPieceLabel')}
                        disabled={settleSplitAddAmountSmallest <= 0 || settleSplitAddAmountSmallest > settleSplitRemainingSmallest}
                        style={{
                          paddingHorizontal: 14,
                          justifyContent: 'center',
                          borderRadius: 8,
                          backgroundColor: settleSplitAddAmountSmallest > 0 && settleSplitAddAmountSmallest <= settleSplitRemainingSmallest ? colors.primary : colors.border,
                        }}
                      >
                        <Text style={{ color: '#fff', fontFamily: fonts.semiBold, fontSize: 13 }} maxFontSizeMultiplier={1.3}>{t('addPieceLabel')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          setSettleSplitPieces([...settleSplitPieces, { method: settleSplitAddMethod, amount: settleSplitRemainingSmallest }]);
                          setSettleSplitAddAmount('');
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={t('addRemainingLabel')}
                        style={{
                          paddingHorizontal: 12,
                          justifyContent: 'center',
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: colors.border,
                        }}
                      >
                        <Text style={{ color: colors.text, fontFamily: fonts.medium, fontSize: 12 }} maxFontSizeMultiplier={1.3}>{t('addRemainingLabel')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            )}

            <TouchableOpacity
              onPress={handleSubmitSettle}
              disabled={settleSubmitDisabled}
              accessibilityRole="button"
              accessibilityLabel={t('settleConfirmAction')}
              style={{
                backgroundColor: settleSubmitDisabled ? colors.border : colors.primary,
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: 'center',
              }}
            >
              {settleMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontFamily: fonts.bold, fontSize: 15 }} maxFontSizeMultiplier={1.3}>{t('settleConfirmAction')}</Text>
              )}
            </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit-item modal — qty or notes. Reuses the tip-modal sheet styling
          so it doesn't introduce new visual primitives. */}
      <Modal
        visible={editingItem !== null && editMode !== null}
        transparent
        animationType="slide"
        onRequestClose={() => { setEditingItem(null); setEditMode(null); }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={[styles.tipModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.tipModalHeader}>
              <Text style={[styles.tipModalTitle, { color: colors.text }]} maxFontSizeMultiplier={1.2}>
                {editMode === 'qty' ? 'Edit quantity' : 'Edit notes'}
              </Text>
              <TouchableOpacity
                onPress={() => { setEditingItem(null); setEditMode(null); }}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {editingItem && (
              <Text style={[styles.tipSubtotalLabel, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
                {editingItem.name}
              </Text>
            )}

            {editMode === 'qty' ? (
              <TextInput
                value={qtyInput}
                onChangeText={setQtyInput}
                keyboardType="number-pad"
                maxLength={3}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  color: colors.text,
                  backgroundColor: colors.background,
                  fontSize: 18,
                  fontFamily: fonts.semiBold,
                  marginTop: 12,
                  textAlign: 'center',
                }}
                placeholder="Qty"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Quantity"
              />
            ) : (
              <TextInput
                value={notesInput}
                onChangeText={setNotesInput}
                multiline
                maxLength={500}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  color: colors.text,
                  backgroundColor: colors.background,
                  fontSize: 15,
                  fontFamily: fonts.regular,
                  marginTop: 12,
                  minHeight: 88,
                  textAlignVertical: 'top',
                }}
                placeholder="Item notes (e.g. no onions)"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Item notes"
              />
            )}

            <TouchableOpacity
              onPress={handleSubmitEdit}
              disabled={updateItemMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel="Save changes"
              style={{
                backgroundColor: updateItemMutation.isPending ? colors.border : colors.primary,
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: 'center',
                marginTop: 16,
              }}
            >
              {updateItemMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontFamily: fonts.bold, fontSize: 15 }} maxFontSizeMultiplier={1.3}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 18, fontFamily: fonts.bold },
  headerSubtitle: { fontSize: 12, fontFamily: fonts.regular, marginTop: 2 },
  headerBadges: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 12, fontFamily: fonts.semiBold, textTransform: 'capitalize' },
  content: { flex: 1 },
  contentContainer: { padding: 16, gap: 16, paddingBottom: 100 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  customerName: { fontSize: 16, fontFamily: fonts.semiBold },
  customerEmail: { fontSize: 14, fontFamily: fonts.regular },
  roundSection: { gap: 8 },
  roundHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  roundLabel: { fontSize: 12, fontFamily: fonts.semiBold, textTransform: 'uppercase', letterSpacing: 1 },
  roundActions: { flexDirection: 'row', gap: 6 },
  roundActionBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  roundActionText: { fontSize: 11, fontFamily: fonts.semiBold },
  roundNotesBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  roundNotesTextWrap: { flex: 1, gap: 2 },
  roundNotesLabel: { fontSize: 11, fontFamily: fonts.semiBold, textTransform: 'uppercase', letterSpacing: 0.8 },
  roundNotesText: { fontSize: 14, fontFamily: fonts.regular },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  itemInfo: { flex: 1, gap: 2 },
  itemName: { fontSize: 14, fontFamily: fonts.medium },
  itemNotes: { fontSize: 12, fontFamily: fonts.regular, fontStyle: 'italic' },
  itemRight: { alignItems: 'flex-end', gap: 4, marginLeft: 12 },
  itemPrice: { fontSize: 14, fontFamily: fonts.semiBold },
  itemStatusBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  itemStatusText: { fontSize: 10, fontFamily: fonts.semiBold },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: 14, fontFamily: fonts.regular },
  totalValue: { fontSize: 14, fontFamily: fonts.medium },
  grandTotalRow: { borderTopWidth: 1, paddingTop: 12, marginTop: 4 },
  grandTotalLabel: { fontSize: 16, fontFamily: fonts.bold },
  grandTotalValue: { fontSize: 18, fontFamily: fonts.bold },
  notesLabel: { fontSize: 12, fontFamily: fonts.semiBold, textTransform: 'uppercase', letterSpacing: 1 },
  notesText: { fontSize: 14, fontFamily: fonts.regular },
  footer: { flexDirection: 'row', padding: 16, gap: 12, borderTopWidth: 1 },
  cancelButton: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, borderWidth: 1 },
  cancelButtonText: { fontSize: 16, fontFamily: fonts.semiBold },
  settleButton: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14 },
  settleButtonText: { fontSize: 16, fontFamily: fonts.semiBold, color: '#fff' },
  emptyText: { fontSize: 16, fontFamily: fonts.semiBold, textAlign: 'center' },
  addItemsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    minHeight: 52,
  },
  addItemsButtonText: { fontSize: 15, fontFamily: fonts.semiBold },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  tipModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
    gap: 16,
    ...shadows.lg,
  },
  tipModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tipModalTitle: { fontSize: 20, fontFamily: fonts.bold },
  tipSubtotalLabel: { fontSize: 13, fontFamily: fonts.regular, textAlign: 'center' },
  tipOptionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
  },
  tipOption: {
    flexBasis: '30%',
    minHeight: 64,
    borderRadius: 14,
    borderWidth: 2,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tipOptionPct: { fontSize: 17, fontFamily: fonts.bold },
  tipOptionAmount: { fontSize: 11, fontFamily: fonts.regular },
  customTipRow: {
    gap: 6,
  },
  customTipLabel: { fontSize: 12, fontFamily: fonts.semiBold, textTransform: 'uppercase', letterSpacing: 0.5 },
  customTipInput: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 18,
    fontFamily: fonts.semiBold,
  },
  tipSummary: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 4,
  },
  chargeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 56,
    borderRadius: 16,
    ...shadows.md,
  },
  chargeButtonText: { fontSize: 16, fontFamily: fonts.bold, color: '#fff' },
});
