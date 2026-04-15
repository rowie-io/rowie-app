import React, { useCallback, useMemo, useState } from 'react';
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

type RouteParams = {
  SessionDetail: {
    sessionId: string;
  };
};

const STATUS_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  pending: { icon: 'time-outline', color: '#78716C', label: 'Pending' },
  sent: { icon: 'send-outline', color: '#3B82F6', label: 'Sent' },
  preparing: { icon: 'flame-outline', color: '#F59E0B', label: 'Preparing' },
  ready: { icon: 'checkmark-circle-outline', color: '#22C55E', label: 'Ready' },
  served: { icon: 'restaurant-outline', color: '#A8A29E', label: 'Served' },
};

export function SessionDetailScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'SessionDetail'>>();
  const { currency } = useAuth();
  const { selectedCatalog } = useCatalog();
  const queryClient = useQueryClient();
  const { sessionId } = route.params;

  // Tip modal state
  const [tipModalOpen, setTipModalOpen] = useState(false);
  const [selectedTipPct, setSelectedTipPct] = useState<number | null>(null);
  const [customTipText, setCustomTipText] = useState('');

  // Tip settings from the catalog — "Tip" screen only shown if enabled.
  // Defaults match the catalog's typical values when not set.
  const showTipScreen = selectedCatalog?.showTipScreen ?? true;
  const tipPercentages = selectedCatalog?.tipPercentages ?? [15, 18, 20, 25];
  const allowCustomTip = selectedCatalog?.allowCustomTip ?? true;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['sessions', sessionId],
    queryFn: () => sessionsApi.get(sessionId),
  });

  const session = data?.session;
  const items = data?.items || [];

  // Real-time updates
  const handleSessionUpdate = useCallback(() => {
    refetch();
  }, [refetch]);

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
  });

  const closeTabMutation = useMutation({
    // tipAmount passed to API is in SMALLEST unit (cents) per the API contract.
    mutationFn: (tipAmountSmallestUnit: number) => sessionsApi.closeTab(sessionId, tipAmountSmallestUnit),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setTipModalOpen(false);
      setSelectedTipPct(null);
      setCustomTipText('');
      Alert.alert('Tab closed', 'Payment charged successfully.');
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert('Failed to close tab', err?.message || 'Could not charge the saved card.');
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
        'Close Tab',
        'Charge the saved card for the full amount?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Charge Now', onPress: () => closeTabMutation.mutate(0) },
        ],
      );
      return;
    }
    setSelectedTipPct(null);
    setCustomTipText('');
    setTipModalOpen(true);
  }, [showTipScreen, closeTabMutation]);

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
      Alert.alert('Session settled', 'Order recorded as cash payment.');
      navigation.goBack();
    },
    onError: (err: any) => {
      Alert.alert('Failed to settle', err?.message || 'Could not settle session.');
    },
  });

  const handleSettle = useCallback(() => {
    Alert.alert(
      'Settle Session',
      'Mark this session as settled (cash payment)?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Settle', onPress: () => settleCashMutation.mutate() },
      ],
    );
  }, [settleCashMutation]);

  const markRoundStatus = useCallback((roundItems: SessionItem[], status: ItemStatus) => {
    const itemIds = roundItems.filter(i => i.status !== status).map(i => i.id);
    if (itemIds.length > 0) {
      updateStatusMutation.mutate({ itemIds, status });
    }
  }, [updateStatusMutation]);

  const handleCancel = useCallback(() => {
    Alert.alert(
      'Cancel Session',
      'Are you sure you want to cancel this session?',
      [
        { text: 'No', style: 'cancel' },
        { text: 'Yes, Cancel', style: 'destructive', onPress: () => cancelMutation.mutate() },
      ]
    );
  }, [cancelMutation]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Loading" />
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
            Session not found
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const isOpen = session.status === 'open';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
            {session.tableLabel || session.holdName || session.sessionNumber}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
            {session.sessionNumber} · {session.source === 'qr_table' || session.source === 'qr_menu' ? 'QR' : session.source === 'hold' ? 'Held' : session.source === 'tab' ? 'Tab' : 'POS'}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: isOpen ? '#22C55E20' : '#78716C20' }]}>
          <Text style={[styles.statusText, { color: isOpen ? '#22C55E' : '#78716C' }]} maxFontSizeMultiplier={1.3}>
            {session.status}
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
                  Round {roundNum}
                </Text>
                {isOpen && !allServed && (
                  <View style={styles.roundActions}>
                    <TouchableOpacity
                      onPress={() => markRoundStatus(roundItems, 'sent')}
                      style={[styles.roundActionBtn, { backgroundColor: '#3B82F620' }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Mark round ${roundNum} as sent`}
                    >
                      <Text style={[styles.roundActionText, { color: '#3B82F6' }]} maxFontSizeMultiplier={1.3}>Sent</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => markRoundStatus(roundItems, 'ready')}
                      style={[styles.roundActionBtn, { backgroundColor: '#22C55E20' }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Mark round ${roundNum} as ready`}
                    >
                      <Text style={[styles.roundActionText, { color: '#22C55E' }]} maxFontSizeMultiplier={1.3}>Ready</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => markRoundStatus(roundItems, 'served')}
                      style={[styles.roundActionBtn, { backgroundColor: '#A8A29E20' }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Mark round ${roundNum} as served`}
                    >
                      <Text style={[styles.roundActionText, { color: '#A8A29E' }]} maxFontSizeMultiplier={1.3}>Served</Text>
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
                            {config.label}
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
            <Text style={[styles.totalLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>Subtotal</Text>
            <Text style={[styles.totalValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{formatCurrency(session.subtotal, currency)}</Text>
          </View>
          {session.taxAmount > 0 && (
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>Tax</Text>
              <Text style={[styles.totalValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{formatCurrency(session.taxAmount, currency)}</Text>
            </View>
          )}
          {session.tipAmount > 0 && (
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>Tip</Text>
              <Text style={[styles.totalValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>{formatCurrency(session.tipAmount, currency)}</Text>
            </View>
          )}
          <View style={[styles.totalRow, styles.grandTotalRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.grandTotalLabel, { color: colors.text }]} maxFontSizeMultiplier={1.3}>Total</Text>
            <Text style={[styles.grandTotalValue, { color: colors.primary }]} maxFontSizeMultiplier={1.2}>
              {formatCurrency(session.subtotal + session.taxAmount, currency)}
            </Text>
          </View>
        </View>

        {/* Notes */}
        {session.orderNotes && (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.notesLabel, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>Notes</Text>
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
            accessibilityLabel="Add items to this session"
          >
            <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
            <Text style={[styles.addItemsButtonText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
              Add Items
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
            accessibilityLabel="Cancel session"
          >
            <Text style={[styles.cancelButtonText, { color: '#EF4444' }]} maxFontSizeMultiplier={1.3}>Cancel</Text>
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
              accessibilityLabel={items.length === 0 ? 'No items to charge — cancel instead' : 'Close tab and charge saved card'}
            >
              {closeTabMutation.isPending ? (
                <ActivityIndicator color="#1C1917" accessibilityLabel="Charging card" />
              ) : (
                <>
                  <Ionicons name="wallet-outline" size={20} color="#1C1917" />
                  <Text style={styles.settleButtonText} maxFontSizeMultiplier={1.3}>Close Tab</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleSettle}
              disabled={settleCashMutation.isPending}
              style={[styles.settleButton, { backgroundColor: colors.primary }, settleCashMutation.isPending && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="Settle session as cash"
            >
              {settleCashMutation.isPending ? (
                <ActivityIndicator color="#1C1917" accessibilityLabel="Settling session" />
              ) : (
                <>
                  <Ionicons name="cash-outline" size={20} color="#1C1917" />
                  <Text style={styles.settleButtonText} maxFontSizeMultiplier={1.3}>Settle</Text>
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
                Add Tip
              </Text>
              <TouchableOpacity
                onPress={() => setTipModalOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close tip dialog"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.tipSubtotalLabel, { color: colors.textMuted }]} maxFontSizeMultiplier={1.5}>
              Subtotal: {session ? formatCurrency(session.subtotal, currency) : ''}
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
                    accessibilityLabel={`Tip ${pct}%`}
                    accessibilityState={{ selected: isActive }}
                  >
                    <Text style={[styles.tipOptionPct, { color: isActive ? colors.primary : colors.text }]} maxFontSizeMultiplier={1.2}>
                      {pct}%
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
                  accessibilityLabel="Custom tip amount"
                  accessibilityState={{ selected: selectedTipPct === -1 }}
                >
                  <Text style={[styles.tipOptionPct, { color: selectedTipPct === -1 ? colors.primary : colors.text }]} maxFontSizeMultiplier={1.2}>
                    Custom
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
                accessibilityLabel="No tip"
                accessibilityState={{ selected: selectedTipPct === 0 }}
              >
                <Text style={[styles.tipOptionPct, { color: selectedTipPct === 0 ? colors.primary : colors.text }]} maxFontSizeMultiplier={1.2}>
                  No Tip
                </Text>
              </TouchableOpacity>
            </View>

            {selectedTipPct === -1 && (
              <View style={styles.customTipRow}>
                <Text style={[styles.customTipLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                  Custom amount
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
                  placeholder="0.00"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  style={[styles.customTipInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                  accessibilityLabel="Custom tip amount"
                />
              </View>
            )}

            {/* Summary */}
            <View style={[styles.tipSummary, { borderTopColor: colors.border }]}>
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                  Subtotal + Tax
                </Text>
                <Text style={[styles.totalValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {formatCurrency(sessionPreTipTotal, currency)}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.5}>
                  Tip
                </Text>
                <Text style={[styles.totalValue, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  {formatCurrency(computedTipBase, currency)}
                </Text>
              </View>
              <View style={[styles.totalRow, { marginTop: 6 }]}>
                <Text style={[styles.grandTotalLabel, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                  Total to charge
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
              accessibilityLabel={`Charge saved card ${formatCurrency(sessionPreTipTotal + computedTipBase, currency)}`}
            >
              {closeTabMutation.isPending ? (
                <ActivityIndicator color="#1C1917" accessibilityLabel="Charging card" />
              ) : (
                <>
                  <Ionicons name="wallet-outline" size={20} color="#1C1917" />
                  <Text style={styles.chargeButtonText} maxFontSizeMultiplier={1.3}>
                    Charge {formatCurrency(sessionPreTipTotal + computedTipBase, currency)}
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
