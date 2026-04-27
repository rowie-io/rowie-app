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
import { formatCurrency, toSmallestUnit, isZeroDecimal } from '../utils/currency';
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

  // Tip modal state
  const [tipModalOpen, setTipModalOpen] = useState(false);
  const [selectedTipPct, setSelectedTipPct] = useState<number | null>(null);
  const [customTipText, setCustomTipText] = useState('');

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

  // Group items by round
  const rounds = useMemo(() => {
    const map = new Map<number, SessionItem[]>();
    for (const item of items) {
      if (!map.has(item.roundNumber)) map.set(item.roundNumber, []);
      map.get(item.roundNumber)!.push(item);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [items]);

  // Mutations
  const updateStatusMutation = useMutation({
    mutationFn: ({ itemIds, status }: { itemIds: string[]; status: ItemStatus }) =>
      sessionsApi.updateItemStatus(sessionId, itemIds, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId] });
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

  // Non-tab settlement via cash (simple path). Tap-to-pay settlement would
  // require a dedicated checkout flow keyed to sessions — out of scope here.
  const settleCashMutation = useMutation({
    mutationFn: () => sessionsApi.settle(sessionId, { paymentMethod: 'cash', tipAmount: 0 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      Alert.alert(t('settledTitle'), t('settledMessage'));
      navigation.goBack();
    },
    // Bug fix: same `err.error` vs `err.message` issue — mobile apiClient
    // throws an object literal so cash-settle Stripe/payment failures were
    // showing the generic translation instead of the API's reason string.
    onError: (err: any) => {
      Alert.alert(t('failedSettleTitle'), err?.error || err?.message || t('failedSettleMessage'));
    },
  });

  const handleSettle = useCallback(() => {
    Alert.alert(
      t('settleConfirmTitle'),
      t('settleConfirmMessage'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('settleConfirmAction'), onPress: () => settleCashMutation.mutate() },
      ],
    );
  }, [settleCashMutation, t]);

  const markRoundStatus = useCallback((roundItems: SessionItem[], status: ItemStatus) => {
    const itemIds = roundItems.filter(i => i.status !== status).map(i => i.id);
    if (itemIds.length > 0) {
      updateStatusMutation.mutate({ itemIds, status });
    }
  }, [updateStatusMutation]);

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
            <Ionicons name="refresh" size={18} color="#1C1917" />
            <Text style={{ fontSize: 15, fontFamily: fonts.bold, color: '#1C1917' }} maxFontSizeMultiplier={1.3}>
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
        <View style={[styles.statusBadge, { backgroundColor: isOpen ? '#22C55E20' : '#78716C20' }]}>
          <Text style={[styles.statusText, { color: isOpen ? '#22C55E' : '#78716C' }]} maxFontSizeMultiplier={1.3}>
            {statusLabel}
          </Text>
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
                {roundItems.map((item) => {
                  const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
                  return (
                    <View key={item.id} style={styles.itemRow}>
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
                    </View>
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

        {/* Add more items (only while open) */}
        {isOpen && (
          <TouchableOpacity
            onPress={() => navigation.navigate('AddItemsToSession', {
              sessionId: session.id,
              displayName: session.tableLabel || session.holdName || session.sessionNumber,
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
                <ActivityIndicator color="#1C1917" accessibilityLabel={t('chargingCardLabel')} />
              ) : (
                <>
                  <Ionicons name="wallet-outline" size={20} color="#1C1917" />
                  <Text style={styles.settleButtonText} maxFontSizeMultiplier={1.3}>{t('closeTabButton')}</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleSettle}
              disabled={settleCashMutation.isPending}
              style={[styles.settleButton, { backgroundColor: colors.primary }, settleCashMutation.isPending && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={t('settleAccessibilityLabel')}
            >
              {settleCashMutation.isPending ? (
                <ActivityIndicator color="#1C1917" accessibilityLabel={t('settlingLabel')} />
              ) : (
                <>
                  <Ionicons name="cash-outline" size={20} color="#1C1917" />
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
                <ActivityIndicator color="#1C1917" accessibilityLabel={t('chargingCardLabel')} />
              ) : (
                <>
                  <Ionicons name="wallet-outline" size={20} color="#1C1917" />
                  <Text style={styles.chargeButtonText} maxFontSizeMultiplier={1.3}>
                    {t('chargeButton', { amount: formatCurrency(sessionPreTipTotal + computedTipBase, currency) })}
                  </Text>
                </>
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
  chargeButtonText: { fontSize: 16, fontFamily: fonts.bold, color: '#1C1917' },
});
