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
import { sessionsApi, floorPlansApi, type SessionItem, type ItemStatus } from '../lib/api/sessions';
import { stripeTerminalApi } from '../lib/api';
import { useTerminal } from '../context/StripeTerminalContext';
import { useTapToPayGuard } from '../hooks/useTapToPayGuard';
import { formatCurrency, toSmallestUnit, fromSmallestUnit, isZeroDecimal } from '../utils/currency';
import { fonts } from '../lib/fonts';
import { shadows } from '../lib/shadows';
import { useTranslations } from '../lib/i18n';
import { TipPicker, computeTipBase, CUSTOM_TIP } from '../components/TipPicker';

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

// Valid bulk-update targets ('pending' is an insert-time default, never a
// transition target) and the forward-only rank order the API enforces.
type RoundTargetStatus = 'sent' | 'preparing' | 'ready' | 'served';
const ITEM_STATUS_RANK: Record<ItemStatus, number> = {
  pending: 0,
  sent: 1,
  preparing: 2,
  ready: 3,
  served: 4,
};

// Round-header status chips: target status → visual identity.
const ROUND_CHIP_TARGETS: Array<{ status: RoundTargetStatus; color: string; labelKey: string }> = [
  { status: 'sent', color: '#3B82F6', labelKey: 'roundActionSent' },
  { status: 'ready', color: '#22C55E', labelKey: 'roundActionReady' },
  { status: 'served', color: '#A8A29E', labelKey: 'roundActionServed' },
];

// The API enforces a forward-only item state machine (a backward transition
// 409s the whole batch), so a post-hoc "Undo" that reverts the status is
// impossible. Instead a status tap commits after this grace window, with a
// Cancel snackbar shown until the request actually fires (delayed-commit
// pattern). Long enough to react, short enough to feel instant on the KDS.
const STATUS_COMMIT_DELAY_MS = 3500;

// Cash quick-tender denominations (base units) — matched to the cash payment
// screen's quick amounts. Zero-decimal currencies get a scaled-up set.
const CASH_DENOMINATIONS = [5, 10, 20, 50, 100];
const CASH_DENOMINATIONS_ZERO_DECIMAL = [500, 1000, 2000, 5000, 10000];

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
  const { guardCheckout } = useTapToPayGuard();

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
  // Same selection model as the close-tab tip modal (percent / custom / none)
  // so both flows share the TipPicker grid.
  const [settleTipPct, setSettleTipPct] = useState<number | null>(0);
  const [settleTipCustomText, setSettleTipCustomText] = useState('');
  const [settleCashTenderedText, setSettleCashTenderedText] = useState(''); // base-unit digits
  // v1 scope: split pieces are record-only — no per-piece charge is collected
  // here, so tap_to_pay is NOT offered (the API would record it as a pending
  // order_payment with no PaymentIntent ever created — a phantom tender).
  // Cash is the only piece method until per-piece Terminal collection lands.
  const [settleSplitPieces, setSettleSplitPieces] = useState<Array<{ method: 'cash'; amount: number }>>([]);
  const [settleSplitAddMethod, setSettleSplitAddMethod] = useState<'cash'>('cash');
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
    mutationFn: ({ itemIds, status }: { itemIds: string[]; status: RoundTargetStatus }) =>
      sessionsApi.updateItemStatus(sessionId, itemIds, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId] });
    },
    // The API 409s the whole batch on an invalid transition — without this the
    // kitchen buttons failed silently and staff assumed the round moved.
    onError: (err: any) => {
      Alert.alert(t('updateFailedTitle'), err?.error || err?.message || t('statusUpdateFailedMessage'));
    },
  });

  // ── Delayed-commit status changes (undo affordance) ──────────────────────
  // See STATUS_COMMIT_DELAY_MS above for why this isn't a true Undo.
  const [pendingStatus, setPendingStatus] = useState<{
    roundNumber: number;
    itemIds: string[];
    status: RoundTargetStatus;
  } | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStatusRef = useRef(pendingStatus);
  useEffect(() => {
    pendingStatusRef.current = pendingStatus;
  }, [pendingStatus]);

  const cancelPendingStatus = useCallback(() => {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    setPendingStatus(null);
  }, []);

  // Flush (commit immediately) rather than drop a pending change when the
  // screen unmounts — a tap made just before navigating away must not be lost.
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
        const p = pendingStatusRef.current;
        if (p) updateStatusMutation.mutate({ itemIds: p.itemIds, status: p.status });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      Alert.alert(t('updateFailedTitle'), err?.error || err?.message || t('updateFailedMessage'));
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => sessionsApi.removeItem(sessionId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId] });
    },
    onError: (err: any) => {
      Alert.alert(t('removeFailedTitle'), err?.error || err?.message || t('removeFailedMessage'));
    },
  });

  // Unmerge directly from this screen (finding: merge/unmerge shouldn't be
  // buried in the floor-plan long-press only).
  const unmergeMutation = useMutation({
    mutationFn: (tableId: string) => sessionsApi.unmergeTable(sessionId, tableId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['floor-plans'] });
    },
    onError: (err: any) => {
      Alert.alert(t('unmergeFailedTitle'), err?.error || err?.message || t('unmergeFailedMessage'));
    },
  });

  // Table labels for the unmerge sheet — only fetched when this session
  // actually has merged secondaries (cached from the floor-plan screen in the
  // common case, so this rarely costs a network hit).
  const mergedTableIds = session?.mergedTableIds || [];
  const { data: floorPlanDetail } = useQuery({
    queryKey: ['floor-plans', session?.floorPlanId],
    queryFn: () => floorPlansApi.get(session!.floorPlanId!),
    enabled: !!session?.floorPlanId && mergedTableIds.length > 0,
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
  // Percentage math lives in TipPicker's computeTipBase (shared with the
  // settle modal below).
  const sessionPreTipTotal = session ? session.subtotal + session.taxAmount : 0;
  const computedTipBase = useMemo(
    () => computeTipBase(selectedTipPct, customTipText, session?.subtotal || 0, currency),
    [selectedTipPct, customTipText, session?.subtotal, currency],
  );

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

  // Tip from the settle modal's TipPicker selection. Nothing picked → 0.
  const settleTipBase = useMemo(
    () => computeTipBase(settleTipPct, settleTipCustomText, session?.subtotal || 0, currency),
    [settleTipPct, settleTipCustomText, session?.subtotal, currency],
  );
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
    // Standard TTP gate: route the vendor to TapToPayEducation if the device
    // hasn't completed the enable flow yet. Matches Checkout / QuickCharge.
    if (!guardCheckout()) {
      setSettleModalOpen(false);
      return;
    }
    const totalSmallest = settleTotalSmallest;
    if (totalSmallest <= 0) {
      Alert.alert(t('nothingToChargeTitle'), t('nothingToChargeMessage'));
      return;
    }
    try {
      setSettleModalOpen(false);
      const totalBase = fromSmallestUnit(totalSmallest, currency);
      const idempotencyKey = `pi-session-${sessionId}-${totalSmallest}-${settleTipSmallest}`;
      const paymentIntent = await stripeTerminalApi.createPaymentIntent({
        amount: totalBase,
        // Top-level tip (base units, like `amount`) so the API excludes it
        // from the platform-fee base. metadata.tipAmount below is display-only.
        tipAmount: settleTipBase,
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
      Alert.alert(t('couldNotStartPaymentTitle'), e?.error || e?.message || t('couldNotStartPaymentMessage'));
    }
  }, [settleMethod, settleTipBase, settleTipSmallest, settleCashTenderedSmallest, settleSplitPieces, settleMutation, session, settleTotalSmallest, sessionId, currency, navigation, t, guardCheckout]);

  const handleSettle = useCallback(() => {
    // Reset modal state on open so a previous failed attempt's values don't
    // leak in. Default to Tap to Pay + no tip — matches the most common
    // in-person bar/restaurant close-out.
    setSettleMethod('tap_to_pay');
    setSettleTipPct(0);
    setSettleTipCustomText('');
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

  const markRoundStatus = useCallback((roundItems: SessionItem[], status: RoundTargetStatus, roundNumber: number) => {
    // The API's state machine is forward-only (pending → sent → preparing →
    // ready → served) and 409s the WHOLE batch if any item is already at or
    // past the target — so only send items strictly below the target rank.
    const targetRank = ITEM_STATUS_RANK[status];
    const itemIds = roundItems
      .filter((i) => {
        const rank = ITEM_STATUS_RANK[i.status];
        return rank !== undefined && rank < targetRank;
      })
      .map((i) => i.id);
    if (itemIds.length === 0) return;

    // Delayed commit: park the change behind a grace window with a Cancel
    // snackbar instead of firing immediately (backward transitions are
    // rejected server-side, so this is the only workable undo).
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    const prev = pendingStatusRef.current;
    if (prev && prev.roundNumber === roundNumber && prev.status === status) {
      // Second tap on the same pending chip → commit right away.
      setPendingStatus(null);
      updateStatusMutation.mutate({ itemIds, status });
      return;
    }
    if (prev) {
      // A different change was pending — flush it so it isn't silently lost.
      updateStatusMutation.mutate({ itemIds: prev.itemIds, status: prev.status });
    }
    setPendingStatus({ roundNumber, itemIds, status });
    pendingTimerRef.current = setTimeout(() => {
      pendingTimerRef.current = null;
      setPendingStatus(null);
      updateStatusMutation.mutate({ itemIds, status });
    }, STATUS_COMMIT_DELAY_MS);
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
      t('itemSheetMessage'),
      [
        {
          text: t('editQuantityAction'),
          onPress: () => {
            setEditingItem(item);
            setQtyInput(String(item.quantity));
            setEditMode('qty');
          },
        },
        {
          text: t('editNotesAction'),
          onPress: () => {
            setEditingItem(item);
            setNotesInput(item.notes || '');
            setEditMode('notes');
          },
        },
        {
          text: t('removeAction'),
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              t('removeConfirmTitle'),
              t('removeConfirmMessage', { quantity: item.quantity, name: item.name }),
              [
                { text: t('cancel'), style: 'cancel' },
                {
                  text: t('removeAction'),
                  style: 'destructive',
                  onPress: () => removeItemMutation.mutate(item.id),
                },
              ],
            );
          },
        },
        { text: t('cancel'), style: 'cancel' },
      ],
    );
  }, [session?.status, removeItemMutation, t]);

  const handleSubmitEdit = useCallback(() => {
    if (!editingItem) return;
    if (editMode === 'qty') {
      const n = parseInt(qtyInput, 10);
      if (!Number.isFinite(n) || n < 1) {
        Alert.alert(t('invalidQtyTitle'), t('invalidQtyMessage'));
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
  }, [editingItem, editMode, qtyInput, notesInput, updateItemMutation, t]);

  // "Add items" — shared by the persistent header button and the button at
  // the bottom of the item list. Routes to the Menu tab with this session
  // pre-targeted; the cart's "Send" CTA there appends a new round and
  // returns here.
  const handleAddItems = useCallback(() => {
    if (!session) return;
    navigation.navigate('MainTabs', {
      screen: 'Menu',
      params: { screen: 'MenuHome', params: { sessionId: session.id } },
    });
  }, [navigation, session]);

  // Table actions sheet (merge / unmerge) — exposes what the floor plan hides
  // behind a long-press. Merge navigates to the floor plan in merge mode;
  // unmerge lists this session's merged secondaries by label.
  const handleTableActions = useCallback(() => {
    if (!session || session.status !== 'open' || !session.tableId) return;
    const merged = session.mergedTableIds || [];
    const planTables = floorPlanDetail?.tables || [];
    const options: Array<{ text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }> = [
      {
        text: t('mergeAction'),
        onPress: () =>
          navigation.navigate('FloorPlan', {
            mergeSessionId: session.id,
            floorPlanId: session.floorPlanId || undefined,
          }),
      },
    ];
    for (const tid of merged) {
      const label = planTables.find((tbl) => tbl.id === tid)?.label || '';
      options.push({
        text: label ? t('unmergeLabelAction', { label }) : t('unmergeUnknownAction'),
        style: 'destructive',
        onPress: () => unmergeMutation.mutate(tid),
      });
    }
    options.push({ text: t('cancel'), style: 'cancel' });
    Alert.alert(session.tableLabel || t('tableActionsLabel'), '', options);
  }, [session, floorPlanDetail, navigation, unmergeMutation, t]);

  // Per-round collapse — fully-served rounds fold away by default so long
  // sessions read as a summary instead of a flat scroll. Tapping a round
  // header toggles it either way.
  const [roundExpandOverrides, setRoundExpandOverrides] = useState<Record<number, boolean>>({});
  const toggleRound = useCallback((roundNumber: number, currentlyExpanded: boolean) => {
    setRoundExpandOverrides((prev) => ({ ...prev, [roundNumber]: !currentlyExpanded }));
  }, []);

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
            <Ionicons name="refresh" size={18} color={colors.onPrimary} />
            <Text style={{ fontSize: 15, fontFamily: fonts.bold, color: colors.onPrimary }} maxFontSizeMultiplier={1.3}>
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
          {/* Persistent "+ Add" — the bottom-of-scroll button stays, but long
              sessions shouldn't require scrolling to add a round. */}
          {isOpen && (
            <TouchableOpacity
              onPress={handleAddItems}
              style={[styles.headerIconBtn, { backgroundColor: colors.primary + '18' }]}
              accessibilityRole="button"
              accessibilityLabel={t('addItemsAccessibilityLabel')}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="add" size={22} color={colors.primary} />
            </TouchableOpacity>
          )}
          {/* Table actions (merge / unmerge) for table-bound sessions. */}
          {isOpen && !!session.tableId && (
            <TouchableOpacity
              onPress={handleTableActions}
              style={[styles.headerIconBtn, { backgroundColor: colors.surface }]}
              accessibilityRole="button"
              accessibilityLabel={t('tableActionsLabel')}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
            </TouchableOpacity>
          )}
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

        {/* Items by round. Round headers carry count + subtotal; fully-served
            rounds are dimmed and collapsed by default (tap to expand). */}
        {rounds.map(([roundNum, roundItems]) => {
          const allServed = roundItems.every(i => i.status === 'served');
          const roundNotes = roundNotesByNumber.get(roundNum);
          const roundQty = roundItems.reduce((s, i) => s + i.quantity, 0);
          const roundSubtotal = roundItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
          const expanded = roundExpandOverrides[roundNum] ?? !allServed;
          const roundSummary = `${roundQty === 1 ? t('roundItemsSingular', { count: roundQty }) : t('roundItemsPlural', { count: roundQty })} · ${formatCurrency(roundSubtotal, currency)}`;
          return (
            <View key={roundNum} style={[styles.roundSection, allServed && styles.roundSectionServed]}>
              <TouchableOpacity
                style={styles.roundHeader}
                onPress={() => toggleRound(roundNum, expanded)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={expanded ? t('roundCollapseLabel', { number: roundNum }) : t('roundExpandLabel', { number: roundNum })}
                accessibilityState={{ expanded }}
              >
                <View style={styles.roundHeaderLeft}>
                  <Ionicons
                    name={expanded ? 'chevron-down' : 'chevron-forward'}
                    size={14}
                    color={colors.textMuted}
                  />
                  <Text style={[styles.roundLabel, { color: colors.textMuted }]} maxFontSizeMultiplier={1.3}>
                    {t('roundLabel', { number: roundNum })}
                  </Text>
                  <Text style={[styles.roundSummary, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
                    {roundSummary}
                  </Text>
                </View>
                {allServed && (
                  <Ionicons name="checkmark-done" size={16} color={colors.textMuted} />
                )}
              </TouchableOpacity>

              {/* Round status chips — ≥44pt targets. A chip shows as "done"
                  (filled + check) once every item is at/past its status, and
                  as pending while a delayed commit is counting down. */}
              {isOpen && !allServed && expanded && (
                <View style={styles.roundActions}>
                  {ROUND_CHIP_TARGETS.map(({ status, color, labelKey }) => {
                    const targetRank = ITEM_STATUS_RANK[status];
                    const done = roundItems.every((i) => (ITEM_STATUS_RANK[i.status] ?? 0) >= targetRank);
                    const isPending = pendingStatus?.roundNumber === roundNum && pendingStatus.status === status;
                    return (
                      <TouchableOpacity
                        key={status}
                        onPress={() => markRoundStatus(roundItems, status, roundNum)}
                        disabled={done || updateStatusMutation.isPending}
                        style={[
                          styles.roundActionBtn,
                          {
                            backgroundColor: done ? color + '30' : color + '15',
                            borderColor: isPending ? colors.primary : done ? color : color + '50',
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={t(`markRound${status === 'sent' ? 'Sent' : status === 'ready' ? 'Ready' : 'Served'}Label`, { number: roundNum })}
                        accessibilityState={{ selected: done, busy: isPending }}
                      >
                        {done && <Ionicons name="checkmark" size={14} color={color} />}
                        {isPending && <ActivityIndicator size="small" color={colors.primary} />}
                        <Text style={[styles.roundActionText, { color }]} maxFontSizeMultiplier={1.3}>
                          {t(labelKey)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {expanded && (
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
                        accessibilityLabel={`${item.quantity} ${item.name}`}
                      >
                        <View style={styles.itemInfo}>
                          <Text style={[styles.itemName, { color: colors.text }]} maxFontSizeMultiplier={1.3} numberOfLines={2}>
                            {item.quantity}× {item.name}
                          </Text>
                          {item.notes && (
                            <Text style={[styles.itemNotes, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5} numberOfLines={2}>
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
                        {/* Visible entry point to the same edit/remove sheet the
                            long-press opens — discoverability for finding #7. */}
                        {isOpen && (
                          <TouchableOpacity
                            onPress={() => handleItemLongPress(item)}
                            style={styles.itemMoreBtn}
                            accessibilityRole="button"
                            accessibilityLabel={t('itemActionsLabel', { name: item.name })}
                            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                          >
                            <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
                          </TouchableOpacity>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
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
            onPress={handleAddItems}
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
                <ActivityIndicator color={colors.onPrimary} accessibilityLabel={t('chargingCardLabel')} />
              ) : (
                <>
                  <Ionicons name="wallet-outline" size={20} color={colors.onPrimary} />
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
                <ActivityIndicator color={colors.onPrimary} accessibilityLabel={t('settlingLabel')} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color={colors.onPrimary} />
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
                <ActivityIndicator color={colors.onPrimary} accessibilityLabel={t('settlingLabel')} />
              ) : (
                <>
                  {/* Neutral icon — settle defaults to Tap to Pay, so a cash
                      glyph here misled operators. */}
                  <Ionicons name="card-outline" size={20} color={colors.onPrimary} />
                  <Text style={styles.settleButtonText} maxFontSizeMultiplier={1.3}>{t('settleButton')}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Delayed-commit snackbar — visible while a round status change is
          counting down to commit. Cancel aborts before the request fires. */}
      {pendingStatus && (
        <View
          style={[styles.snackbar, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityRole="alert"
        >
          <Text style={[styles.snackbarText, { color: colors.text }]} maxFontSizeMultiplier={1.3} numberOfLines={2}>
            {t('statusPendingSnackbar', {
              number: pendingStatus.roundNumber,
              status: t(STATUS_CONFIG[pendingStatus.status].labelKey),
            })}
          </Text>
          <TouchableOpacity
            onPress={cancelPendingStatus}
            style={styles.snackbarBtn}
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
          >
            <Text style={[styles.snackbarBtnText, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>
              {t('cancel')}
            </Text>
          </TouchableOpacity>
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

            <TipPicker
              subtotal={session?.subtotal || 0}
              currency={currency}
              percentages={tipPercentages}
              allowCustom={allowCustomTip}
              selectedPct={selectedTipPct}
              customText={customTipText}
              onSelect={(pct) => {
                setSelectedTipPct(pct);
                if (pct !== CUSTOM_TIP) setCustomTipText('');
              }}
              onCustomTextChange={setCustomTipText}
            />

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
                <ActivityIndicator color={colors.onPrimary} accessibilityLabel={t('chargingCardLabel')} />
              ) : (
                <>
                  <Ionicons name="wallet-outline" size={20} color={colors.onPrimary} />
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

            {/* Tip entry — shared across methods. Optional. Same percentage
                grid as the close-tab flow (finding #9). */}
            {showTipScreen && (
              <View style={{ marginBottom: 12, gap: 6 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }} maxFontSizeMultiplier={1.5}>{t('tipOptionalLabel')}</Text>
                <TipPicker
                  subtotal={session?.subtotal || 0}
                  currency={currency}
                  percentages={tipPercentages}
                  allowCustom={allowCustomTip}
                  selectedPct={settleTipPct}
                  customText={settleTipCustomText}
                  onSelect={(pct) => {
                    setSettleTipPct(pct);
                    if (pct !== CUSTOM_TIP) setSettleTipCustomText('');
                  }}
                  onCustomTextChange={setSettleTipCustomText}
                />
              </View>
            )}

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
                {/* Quick-tender chips — exact total + common denominations at
                    or above the total (finding #10). */}
                <View style={styles.quickTenderRow} accessibilityLabel={t('quickTenderLabel')}>
                  <TouchableOpacity
                    onPress={() =>
                      setSettleCashTenderedText(settleTotalBase.toFixed(isZeroDecimal(currency) ? 0 : 2))
                    }
                    style={[styles.quickTenderChip, { borderColor: colors.primary, backgroundColor: colors.primary + '15' }]}
                    accessibilityRole="button"
                    accessibilityLabel={t('exactAmountAccessibility', { amount: formatCurrency(settleTotalBase, currency) })}
                  >
                    <Text style={[styles.quickTenderText, { color: colors.primary }]} maxFontSizeMultiplier={1.3}>
                      {t('exactAmount')}
                    </Text>
                  </TouchableOpacity>
                  {(isZeroDecimal(currency) ? CASH_DENOMINATIONS_ZERO_DECIMAL : CASH_DENOMINATIONS)
                    .filter((d) => d >= settleTotalBase)
                    .map((d) => (
                      <TouchableOpacity
                        key={d}
                        onPress={() => setSettleCashTenderedText(String(d))}
                        style={[styles.quickTenderChip, { borderColor: colors.border, backgroundColor: colors.surface }]}
                        accessibilityRole="button"
                        accessibilityLabel={formatCurrency(d, currency)}
                      >
                        <Text style={[styles.quickTenderText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                          {formatCurrency(d, currency)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </View>
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
                    {formatCurrency(fromSmallestUnit(settleSplitRemainingSmallest, currency), currency)}
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
                      {/* v1: tap_to_pay intentionally excluded — record-only
                          pieces would create phantom pending tenders (see
                          settleSplitPieces state above). */}
                      {(['cash'] as const).map((m) => {
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
                {editMode === 'qty' ? t('editQuantityAction') : t('editNotesAction')}
              </Text>
              <TouchableOpacity
                onPress={() => { setEditingItem(null); setEditMode(null); }}
                accessibilityRole="button"
                accessibilityLabel={t('closeLabel')}
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
                placeholder={t('qtyPlaceholder')}
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={t('quantityLabel')}
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
                placeholder={t('notesPlaceholder')}
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={t('itemNotesLabel')}
              />
            )}

            <TouchableOpacity
              onPress={handleSubmitEdit}
              disabled={updateItemMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel={t('saveButton')}
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
                <Text style={{ color: '#fff', fontFamily: fonts.bold, fontSize: 15 }} maxFontSizeMultiplier={1.3}>{t('saveButton')}</Text>
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
  roundSectionServed: { opacity: 0.55 },
  roundHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  roundHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  roundLabel: { fontSize: 12, fontFamily: fonts.semiBold, textTransform: 'uppercase', letterSpacing: 1 },
  roundSummary: { fontSize: 12, fontFamily: fonts.medium, flexShrink: 1 },
  roundActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  roundActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  roundActionText: { fontSize: 13, fontFamily: fonts.semiBold },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemMoreBtn: {
    marginLeft: 8,
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snackbar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 96,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    ...shadows.lg,
  },
  snackbarText: { fontSize: 14, fontFamily: fonts.medium, flex: 1 },
  snackbarBtn: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  snackbarBtnText: { fontSize: 14, fontFamily: fonts.bold },
  quickTenderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  quickTenderChip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTenderText: { fontSize: 14, fontFamily: fonts.semiBold },
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
  // Dark stone on amber/green fills — white fails contrast (see colors.onPrimary)
  settleButtonText: { fontSize: 16, fontFamily: fonts.semiBold, color: '#1C1917' },
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
  chargeButtonText: { fontSize: 16, fontFamily: fonts.bold, color: '#1C1917' },
});
